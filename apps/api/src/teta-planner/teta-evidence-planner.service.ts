/**
 * Stage 3B — EvidencePlannerService.
 * Client of CanonicalGraphResolverService; never reads NDJSON / builds SQL.
 */
import type { GraphResolverResult } from '../teta-plugins/teta-stage3a.types';
import type { PlannerConfigs } from './teta-intent-catalog';
import { getIntentDef } from './teta-intent-extractor';
import { extractIntent } from './teta-intent-extractor';
import { entitiesOf, extractEntities, hasEntity } from './teta-entity-extractor';
import { buildEvidenceRequirements } from './teta-evidence-template';
import {
  buildClarificationQuestions,
  computeMissingEntities,
  derivePlanningStatus,
} from './teta-planner-validation';
import { normalizePlanningRequest } from './teta-task-contract';
import {
  STAGE3B_CONTRACT_VERSION,
  STAGE3B_PLANNER_CONFIG_VERSION,
  type AmbiguityRecord,
  type EvidenceRequirement,
  type ResolvedGraphEvidence,
  type TetaEvidencePlan,
  type TetaPlanningRequest,
} from './teta-stage3b.types';

/** Minimal Stage 3A client surface used by the planner. */
export type Stage3aResolverClient = {
  resolveForm(input: {
    guid?: string;
    fullTypeName?: string;
    nameFragment?: string;
  }): GraphResolverResult;
  resolveField(input: {
    formNodeId?: string;
    formGuid?: string;
    formTypeName?: string;
    label?: string;
    controlName?: string;
  }): GraphResolverResult;
  resolveNode(input: {
    id?: string;
    name?: string;
    domain?: string;
    nodeType?: string;
    owner?: string;
    objectType?: string;
  }): GraphResolverResult;
  traceFieldToOracle(input: {
    formNodeId?: string;
    formGuid?: string;
    formTypeName?: string;
    label?: string;
    controlName?: string;
  }): GraphResolverResult;
};

export type EvidencePlannerOptions = {
  configs: PlannerConfigs;
  resolver: Stage3aResolverClient | null;
  graphSourceHash: string | null;
};

function mergeGraph(
  into: ResolvedGraphEvidence,
  result: GraphResolverResult,
): void {
  const nodeIds = new Set((into.nodes as Array<{ id: string }>).map((n) => n.id));
  for (const n of result.nodes) {
    if (!nodeIds.has(n.id)) {
      into.nodes.push(n);
      nodeIds.add(n.id);
    }
  }
  const edgeIds = new Set((into.edges as Array<{ id: string }>).map((e) => e.id));
  for (const e of result.edges) {
    if (!edgeIds.has(e.id)) {
      into.edges.push(e);
      edgeIds.add(e.id);
    }
  }
  into.paths.push(...result.paths);
  into.conflicts.push(...result.conflicts);
  into.warnings.push(...result.warnings);
}

function applyGraphStatus(
  req: EvidenceRequirement,
  result: GraphResolverResult,
  ambiguities: AmbiguityRecord[],
): void {
  req.graphResolution = {
    status: result.status,
    selectedNodeId: result.selectedNodeId,
    candidates: result.candidates,
    truncated: result.truncated === true,
  };
  if (result.status === 'ambiguous') {
    req.status = 'ambiguous';
    ambiguities.push({
      kind: 'ambiguous',
      subject: req.evidenceType,
      message: `Stage 3A returned ambiguous for ${req.evidenceType}`,
      candidateIds: result.candidates.map((c) => c.nodeId),
    });
  } else if (result.status === 'conflicting') {
    req.status = 'conflicting';
    ambiguities.push({
      kind: 'conflicting',
      subject: req.evidenceType,
      message: `Stage 3A returned conflicting for ${req.evidenceType}`,
      conflictIds: result.conflicts.map((c) => c.conflictId),
    });
  } else if (result.status === 'resolved') {
    if (req.status === 'missing' || req.status === 'deferred') {
      // graph structural evidence resolved; runtime still deferred if required
      req.status = req.runtimeSourceRequired ? 'deferred' : 'resolved';
      if (req.runtimeSourceRequired) {
        req.missingReason = 'runtime_source_required';
      } else {
        req.missingReason = null;
      }
    }
  } else if (result.status === 'unresolved' || result.status === 'invalid') {
    if (req.required && req.status !== 'deferred' && req.status !== 'unavailable') {
      req.status = 'missing';
      req.missingReason = req.missingReason ?? `graph_${result.status}`;
    }
  }
  if (result.conflicts.length) {
    ambiguities.push({
      kind: 'conflicting',
      subject: req.evidenceType,
      message: 'conflicts_present_in_graph_result',
      conflictIds: result.conflicts.map((c) => c.conflictId),
    });
    if (req.status === 'resolved') req.status = 'conflicting';
  }
}

export class TetaEvidencePlannerService {
  constructor(private readonly options: EvidencePlannerOptions) {}

  plan(rawRequest: TetaPlanningRequest): TetaEvidencePlan {
    const started = Date.now();
    const request = normalizePlanningRequest(rawRequest);
    const configs = this.options.configs;

    let graphQueriesExecuted = 0;
    const ambiguities: AmbiguityRecord[] = [];
    const resolvedGraphEvidence: ResolvedGraphEvidence = {
      nodes: [],
      edges: [],
      paths: [],
      conflicts: [],
      warnings: [],
    };

    if (!request.question.trim()) {
      return this.finishEmpty(started, 'invalid', 'unknown');
    }

    const intentResult = extractIntent(
      request.question,
      configs,
      request.hints?.expectedIntent ?? null,
    );
    const intentDef = getIntentDef(configs, intentResult.type);
    const entities = extractEntities(request, configs, intentResult.type);

    // Field without form → ambiguity for explain_application_field
    if (
      intentResult.type === 'explain_application_field' &&
      hasEntity(entities, ['fieldLabel']) &&
      !hasEntity(entities, ['formName', 'formGuid'])
    ) {
      ambiguities.push({
        kind: 'ambiguous',
        subject: 'fieldLabel',
        message: 'field_label_without_form_scope',
      });
    }

    const missingEntities = computeMissingEntities(intentResult.type, intentDef, entities);
    let evidenceRequirements = buildEvidenceRequirements(
      intentResult.type,
      configs.evidenceTemplates,
      entities,
    );

    // Graph enrichment via Stage 3A (no auto-pick on ambiguous)
    if (
      this.options.resolver &&
      (intentResult.type === 'explain_application_field' ||
        intentResult.type === 'trace_application_to_oracle' ||
        intentResult.type === 'validate_import_file' ||
        intentResult.type === 'build_employee_report')
    ) {
      const resolver = this.options.resolver;
      const formGuid = entitiesOf(entities, 'formGuid')[0]?.normalizedValue;
      const formName = entitiesOf(entities, 'formName')[0]?.rawValue;
      const fieldLabel = entitiesOf(entities, 'fieldLabel')[0]?.rawValue;
      const controlName = entitiesOf(entities, 'controlName')[0]?.rawValue;

      let formResult: GraphResolverResult | null = null;
      let fieldResult: GraphResolverResult | null = null;
      let traceResult: GraphResolverResult | null = null;

      if (formGuid || formName) {
        formResult = resolver.resolveForm({
          guid: formGuid,
          nameFragment: formName,
        });
        graphQueriesExecuted += 1;
        mergeGraph(resolvedGraphEvidence, formResult);
        if (formResult.status === 'ambiguous') {
          ambiguities.push({
            kind: 'ambiguous',
            subject: 'form',
            message: 'multiple_forms_match',
            candidateIds: formResult.candidates.map((c) => c.nodeId),
          });
        }
      }

      if (fieldLabel || controlName) {
        fieldResult = resolver.resolveField({
          formGuid,
          formTypeName: undefined,
          formNodeId: formResult?.selectedNodeId ?? undefined,
          label: fieldLabel,
          controlName,
        });
        graphQueriesExecuted += 1;
        mergeGraph(resolvedGraphEvidence, fieldResult);
        if (fieldResult.status === 'ambiguous') {
          ambiguities.push({
            kind: 'ambiguous',
            subject: 'field',
            message: 'multiple_fields_match',
            candidateIds: fieldResult.candidates.map((c) => c.nodeId),
          });
        } else if (fieldResult.status === 'conflicting') {
          ambiguities.push({
            kind: 'conflicting',
            subject: 'field',
            message: 'field_graph_conflict',
            conflictIds: fieldResult.conflicts.map((c) => c.conflictId),
          });
        }

        if (
          formResult?.status === 'resolved' ||
          (formGuid && fieldResult.status !== 'unresolved')
        ) {
          traceResult = resolver.traceFieldToOracle({
            formGuid,
            formNodeId: formResult?.selectedNodeId ?? undefined,
            label: fieldLabel,
            controlName,
          });
          graphQueriesExecuted += 1;
          mergeGraph(resolvedGraphEvidence, traceResult);
          if (traceResult.status === 'ambiguous') {
            ambiguities.push({
              kind: 'ambiguous',
              subject: 'oracle_path',
              message: 'ambiguous_oracle_path',
              candidateIds: traceResult.candidates.map((c) => c.nodeId),
            });
          }
          if (traceResult.conflicts.length) {
            ambiguities.push({
              kind: 'conflicting',
              subject: 'oracle_path',
              message: 'conflicts_on_oracle_path',
              conflictIds: traceResult.conflicts.map((c) => c.conflictId),
            });
          }
        }
      }

      // Import tables — resolve each without merging by name alone
      if (intentResult.type === 'validate_import_file') {
        for (const table of entitiesOf(entities, 'targetTable')) {
          const r = resolver.resolveNode({
            name: table.normalizedValue,
            nodeType: 'oracle_object',
          });
          graphQueriesExecuted += 1;
          mergeGraph(resolvedGraphEvidence, r);
          if (r.status === 'ambiguous') {
            ambiguities.push({
              kind: 'ambiguous',
              subject: `targetTable:${table.normalizedValue}`,
              message: 'oracle_object_name_ambiguous_across_owners_types',
              candidateIds: r.candidates.map((c) => c.nodeId),
            });
          }
        }
      }

      evidenceRequirements = evidenceRequirements.map((req) => {
        const next = { ...req };
        if (!req.graphQuery) return next;
        const op = String(req.graphQuery.op ?? '');
        if (op === 'resolveForm' && formResult) applyGraphStatus(next, formResult, ambiguities);
        else if (op === 'resolveField' && fieldResult) applyGraphStatus(next, fieldResult, ambiguities);
        else if (op === 'traceFieldToOracle' && traceResult) {
          applyGraphStatus(next, traceResult, ambiguities);
        } else if (op === 'resolveOracleTablesFromEntities') {
          const tables = entitiesOf(entities, 'targetTable');
          if (tables.length) {
            next.status = ambiguities.some((a) => a.subject.startsWith('targetTable:'))
              ? 'ambiguous'
              : 'deferred';
            next.missingReason = 'oracle_metadata_lookup_deferred_to_later_stage';
            next.graphResolution = {
              status: next.status,
              selectedNodeId: null,
              candidates: tables.map((t) => ({ table: t.normalizedValue })),
            };
          }
        }
        return next;
      });
    }

    // Sort ambiguities stably
    ambiguities.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return a.subject.localeCompare(b.subject);
    });

    const clarificationQuestions = buildClarificationQuestions(
      missingEntities,
      intentDef,
      configs,
    );

    let planningStatus = derivePlanningStatus({
      intent: intentResult.type,
      missing: missingEntities,
      ambiguities,
      evidence: evidenceRequirements,
    });

    if (intentResult.type === 'unsupported') {
      planningStatus = 'unsupported';
    }

    // Sort graph nodes/edges if they have ids
    resolvedGraphEvidence.nodes.sort((a, b) => {
      const ia = String((a as { id?: string }).id ?? '');
      const ib = String((b as { id?: string }).id ?? '');
      return ia.localeCompare(ib);
    });
    resolvedGraphEvidence.edges.sort((a, b) => {
      const ia = String((a as { id?: string }).id ?? '');
      const ib = String((b as { id?: string }).id ?? '');
      return ia.localeCompare(ib);
    });

    return {
      contractVersion: STAGE3B_CONTRACT_VERSION,
      planningStatus,
      intent: {
        type: intentResult.type,
        confidence: intentResult.confidence,
        matchedSignals: [...intentResult.matchedSignals].sort(),
      },
      question: { raw: request.question, language: 'pl' },
      entities,
      missingEntities,
      ambiguities,
      evidenceRequirements,
      resolvedGraphEvidence,
      clarificationQuestions,
      executionPolicy: {
        sqlGenerationAllowed: false,
        sqlExecutionAllowed: false,
        fileReadAllowed: false,
        oracleWriteAllowed: false,
        reason: 'Stage 3B planning only',
      },
      audit: {
        deterministic: true,
        graphSourceHash: this.options.graphSourceHash,
        plannerConfigVersion: STAGE3B_PLANNER_CONFIG_VERSION,
        plannerDurationMs: Date.now() - started,
        generatedAt: new Date().toISOString(),
        graphQueriesExecuted,
        guessedEntities: 0,
        autoResolvedAmbiguities: 0,
        sqlGenerated: 0,
        sqlExecuted: 0,
        filesRead: 0,
        oracleWrites: 0,
      },
    };
  }

  private finishEmpty(
    started: number,
    status: TetaEvidencePlan['planningStatus'],
    intent: TetaEvidencePlan['intent']['type'],
  ): TetaEvidencePlan {
    return {
      contractVersion: STAGE3B_CONTRACT_VERSION,
      planningStatus: status,
      intent: { type: intent, confidence: 'none', matchedSignals: [] },
      question: { raw: '', language: 'pl' },
      entities: [],
      missingEntities: [],
      ambiguities: [],
      evidenceRequirements: [],
      resolvedGraphEvidence: { nodes: [], edges: [], paths: [], conflicts: [], warnings: [] },
      clarificationQuestions: [],
      executionPolicy: {
        sqlGenerationAllowed: false,
        sqlExecutionAllowed: false,
        fileReadAllowed: false,
        oracleWriteAllowed: false,
        reason: 'Stage 3B planning only',
      },
      audit: {
        deterministic: true,
        graphSourceHash: this.options.graphSourceHash,
        plannerConfigVersion: STAGE3B_PLANNER_CONFIG_VERSION,
        plannerDurationMs: Date.now() - started,
        generatedAt: new Date().toISOString(),
        graphQueriesExecuted: 0,
        guessedEntities: 0,
        autoResolvedAmbiguities: 0,
        sqlGenerated: 0,
        sqlExecuted: 0,
        filesRead: 0,
        oracleWrites: 0,
      },
    };
  }
}
