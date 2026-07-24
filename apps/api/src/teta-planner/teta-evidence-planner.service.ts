/**
 * Stage 3B / 3B.1 — EvidencePlannerService.
 * Client of CanonicalGraphResolverService; never reads NDJSON / builds SQL.
 *
 * Stage 3B.1: form-scoped field resolution, evidence applicability,
 * no irrelevant global ambiguities, clarification for ambiguity.
 */
import type { GraphCandidate, GraphResolverResult } from '../teta-plugins/teta-stage3a.types';
import { normalizeGraphSearchTerm } from '../teta-plugins/teta-stage3a.normalize';
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
  type PlannerQueryTiming,
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
    field?: string;
  }): GraphResolverResult;
  getEvidenceSubgraph?(input: {
    startNodeIds: string[];
    allowedEdgeTypes?: string[];
    direction?: 'out' | 'in' | 'both';
    maxDepth?: number;
    maxNodes?: number;
  }): GraphResolverResult;
};

export type EvidencePlannerOptions = {
  configs: PlannerConfigs;
  resolver: Stage3aResolverClient | null;
  graphSourceHash: string | null;
};

function mergeGraph(into: ResolvedGraphEvidence, result: GraphResolverResult): void {
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

/** Unique Stage 3A candidate usable for scoping (not picking among equals). */
function uniqueCandidateId(result: GraphResolverResult | null): string | null {
  if (!result) return null;
  if (result.status === 'resolved' && result.selectedNodeId) return result.selectedNodeId;
  if (result.candidates.length === 1) return result.candidates[0]!.nodeId;
  return null;
}

function guidFromFormNodeId(formNodeId: string | null): string | null {
  if (!formNodeId) return null;
  const m = /^form:([0-9a-fA-F-]{36}):/.exec(formNodeId);
  return m ? m[1]!.toLowerCase() : null;
}

function guidFromPlugin(result: GraphResolverResult): string | null {
  const id = uniqueCandidateId(result);
  if (!id) return null;
  if (id.startsWith('plugin:')) {
    const g = id.slice('plugin:'.length).toLowerCase();
    if (/^[0-9a-f-]{36}$/.test(g)) return g;
  }
  const node = result.nodes.find((n) => n.id === id);
  const attrs = (node?.attributes ?? {}) as Record<string, unknown>;
  const g = String(attrs.guid ?? attrs.registryGuid ?? '').toLowerCase().replace(/[{}]/g, '');
  if (/^[0-9a-f-]{36}$/.test(g)) return g;
  // plugin canonicalName sometimes is the GUID
  const cn = String(node?.canonicalName ?? '').toLowerCase();
  if (/^[0-9a-f-]{36}$/.test(cn)) return cn;
  return null;
}

function classNameFromPlugin(result: GraphResolverResult): string | null {
  const id = uniqueCandidateId(result);
  if (!id) return null;
  const node = result.nodes.find((n) => n.id === id);
  const attrs = (node?.attributes ?? {}) as Record<string, unknown>;
  const cn = String(attrs.className ?? attrs.fullTypeName ?? '').trim();
  return cn || null;
}

type TimedCall = {
  result: GraphResolverResult;
  ms: number;
};

function timedResolve(fn: () => GraphResolverResult): TimedCall {
  const t0 = Date.now();
  const result = fn();
  return { result, ms: Date.now() - t0 };
}

export class TetaEvidencePlannerService {
  constructor(private readonly options: EvidencePlannerOptions) {}

  plan(rawRequest: TetaPlanningRequest): TetaEvidencePlan {
    const started = Date.now();
    const request = normalizePlanningRequest(rawRequest);
    const configs = this.options.configs;

    let graphQueriesExecuted = 0;
    let scopedFieldQueries = 0;
    let unscopedFieldQueries = 0;
    let resolvedForms = 0;
    let resolvedFormScopedFields = 0;
    let irrelevantGlobalAmbiguities = 0;
    const timing: PlannerQueryTiming = {
      resolveFormMs: 0,
      resolveFieldMs: 0,
      resolveNodeMs: 0,
      otherMs: 0,
    };

    const ambiguities: AmbiguityRecord[] = [];
    const resolvedGraphEvidence: ResolvedGraphEvidence = {
      nodes: [],
      edges: [],
      paths: [],
      conflicts: [],
      warnings: [],
    };
    let selectionRequiredBeforeExecution = false;

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
    const missingEntities = computeMissingEntities(intentResult.type, intentDef, entities);
    let evidenceRequirements = buildEvidenceRequirements(
      intentResult.type,
      configs.evidenceTemplates,
      entities,
    );

    const formGuidEnt = entitiesOf(entities, 'formGuid')[0]?.normalizedValue;
    const formNameEnt = entitiesOf(entities, 'formName')[0]?.rawValue;
    const fieldLabel = entitiesOf(entities, 'fieldLabel')[0]?.rawValue;
    const controlName = entitiesOf(entities, 'controlName')[0]?.rawValue;
    const hasFormScope = !!(formGuidEnt || formNameEnt);

    let formResult: GraphResolverResult | null = null;
    let fieldResult: GraphResolverResult | null = null;
    let helpResult: GraphResolverResult | null = null;
    let traceResult: GraphResolverResult | null = null;
    let formNodeId: string | null = null;
    let formGuid: string | null = formGuidEnt ?? null;
    let fieldKind: 'data_field' | 'action' | 'unknown' = 'unknown';

    if (
      this.options.resolver &&
      (intentResult.type === 'explain_application_field' ||
        intentResult.type === 'trace_application_to_oracle')
    ) {
      const resolver = this.options.resolver;

      // --- 1. Resolve form first (GUID → exact type → display name via plugin) ---
      if (hasFormScope) {
        const formResolved = this.resolveFormScoped(
          resolver,
          formGuidEnt,
          formNameEnt,
          timing,
          (n) => {
            graphQueriesExecuted += n;
          },
        );
        formResult = formResolved.formResult;
        formNodeId = formResolved.formNodeId;
        formGuid = formResolved.formGuid ?? formGuid;
        mergeGraph(resolvedGraphEvidence, formResult);
        if (formResolved.pluginResult) mergeGraph(resolvedGraphEvidence, formResolved.pluginResult);

        if (formNodeId) {
          resolvedForms += 1;
        } else if (formResult.candidates.length > 1) {
          ambiguities.push({
            kind: 'ambiguous',
            subject: 'form',
            message: 'multiple_forms_match',
            candidateIds: formResult.candidates.map((c) => c.nodeId),
            blocksPlanning: true,
          });
        } else if (formResolved.pluginResult && formResolved.pluginResult.candidates.length > 1) {
          ambiguities.push({
            kind: 'ambiguous',
            subject: 'form',
            message: 'multiple_forms_match',
            candidateIds: formResolved.pluginResult.candidates.map((c) => c.nodeId),
            blocksPlanning: true,
          });
        }
      }

      // --- 2. Field: scoped if form known; else group as field_scope_missing (no global search) ---
      if (fieldLabel || controlName) {
        if (formNodeId) {
          const scopedFormId = formNodeId;
          scopedFieldQueries += 1;
          const fr = timedResolve(() =>
            resolver.resolveField({
              formNodeId: scopedFormId,
              label: fieldLabel,
              controlName,
            }),
          );
          timing.resolveFieldMs += fr.ms;
          graphQueriesExecuted += 1;
          fieldResult = fr.result;
          mergeGraph(resolvedGraphEvidence, fieldResult);

          // Prefer exact help_field scoped to this form.
          // Global resolveNode(name=label) is capped (~50) and misses among 1000+ "Wartość".
          if (fieldLabel && formGuid && formNodeId) {
            const labelNorm = normalizeGraphSearchTerm(fieldLabel).normalizedAscii;
            let scopedHelp: GraphCandidate[] = [];

            const helpDocId = formNodeId.replace(/^form:/, 'help-doc:');
            if (resolver.getEvidenceSubgraph) {
              const sg = timedResolve(() =>
                resolver.getEvidenceSubgraph!({
                  startNodeIds: [helpDocId],
                  allowedEdgeTypes: ['DESCRIBES'],
                  direction: 'out',
                  maxDepth: 1,
                  maxNodes: 200,
                }),
              );
              timing.otherMs += sg.ms;
              graphQueriesExecuted += 1;
              mergeGraph(resolvedGraphEvidence, sg.result);
              scopedHelp = sg.result.nodes
                .filter((n) => n.type === 'help_field')
                .filter((n) => normalizeGraphSearchTerm(n.name ?? n.canonicalName).normalizedAscii === labelNorm)
                .map((n) => ({
                  nodeId: n.id,
                  scoreRank: 5,
                  matchKind: 'exact_label_in_form_help_doc',
                  confidence: n.confidence,
                  domain: n.domain,
                  type: n.type,
                  canonicalName: n.canonicalName,
                  name: n.name,
                }));
            }

            if (scopedHelp.length === 0) {
              // Fallback: global name search + form GUID filter (may miss when >50 homonyms)
              const hr = timedResolve(() =>
                resolver.resolveNode({ name: fieldLabel, nodeType: 'help_field' }),
              );
              timing.resolveNodeMs += hr.ms;
              graphQueriesExecuted += 1;
              scopedHelp = hr.result.candidates.filter((c) => {
                if (!c.nodeId.toLowerCase().includes(formGuid!.toLowerCase())) return false;
                const nameNorm = normalizeGraphSearchTerm(c.name ?? c.canonicalName).normalizedAscii;
                return nameNorm === labelNorm;
              });
            }

            if (scopedHelp.length === 1) {
              const helpId = scopedHelp[0]!.nodeId;
              const byId = timedResolve(() => resolver.resolveNode({ id: helpId }));
              timing.resolveNodeMs += byId.ms;
              graphQueriesExecuted += 1;
              helpResult = {
                ...byId.result,
                status: 'resolved',
                selectedNodeId: helpId,
                candidates: scopedHelp,
              };
              mergeGraph(resolvedGraphEvidence, helpResult);
              resolvedFormScopedFields += 1;
              fieldKind = 'data_field';
            } else if (scopedHelp.length > 1) {
              helpResult = {
                status: 'ambiguous',
                query: { op: 'scopedHelp' },
                selectedNodeId: null,
                candidates: scopedHelp,
                nodes: [],
                edges: [],
                paths: [],
                conflicts: [],
                warnings: [],
                provenance: [],
                audit: {},
              };
              ambiguities.push({
                kind: 'ambiguous',
                subject: 'field',
                message: 'multiple_fields_match',
                candidateIds: scopedHelp.map((c) => c.nodeId),
                blocksPlanning: true,
              });
            }
          }

          // Interpret Stage 3A field result without creating irrelevant action_parameter ambiguities
          const exactField = this.classifyFieldResult(fieldResult, helpResult);
          fieldKind = exactField.kind;
          if (exactField.uniqueFieldId) {
            if (!helpResult?.selectedNodeId) resolvedFormScopedFields += 1;
          } else if (exactField.ambiguousControls && !helpResult?.selectedNodeId) {
            ambiguities.push({
              kind: 'ambiguous',
              subject: 'field',
              message: 'multiple_fields_match',
              candidateIds: exactField.candidateIds,
              blocksPlanning: true,
            });
          } else if (exactField.ambiguousControls && helpResult?.selectedNodeId) {
            // Token-matched controls are noise when exact help_field is unique — do not block plan
          }

          // Trace only when form+field uniquely identified
          if (helpResult?.selectedNodeId || exactField.uniqueFieldId) {
            const tr = timedResolve(() =>
              resolver.traceFieldToOracle({
                formNodeId: scopedFormId,
                label: fieldLabel,
                controlName: exactField.controlName ?? controlName,
                field: fieldLabel,
              }),
            );
            timing.otherMs += tr.ms;
            graphQueriesExecuted += 1;
            traceResult = tr.result;
            mergeGraph(resolvedGraphEvidence, traceResult);
            if (traceResult.conflicts.length) {
              ambiguities.push({
                kind: 'conflicting',
                subject: 'oracle_path',
                message: 'conflicts_on_oracle_path',
                conflictIds: traceResult.conflicts.map((c) => c.conflictId),
                blocksPlanning: true,
              });
            }
          }
        } else {
          // No form scope: do NOT run global multi-type field search (perf + noise)
          unscopedFieldQueries += 0; // explicitly avoided
          ambiguities.push({
            kind: 'ambiguous',
            subject: 'field_scope_missing',
            message: 'field_scope_missing',
            blocksPlanning: true,
          });
        }
      }

      evidenceRequirements = this.applyApplicationFieldEvidence(
        evidenceRequirements,
        {
          formResult,
          formNodeId,
          fieldResult,
          helpResult,
          traceResult,
          fieldKind,
        },
        ambiguities,
      );
    }

    // --- Import validation: keep candidates, don't auto-pick owner/type ---
    if (this.options.resolver && intentResult.type === 'validate_import_file') {
      const resolver = this.options.resolver;
      const tableEvidence: Array<Record<string, unknown>> = [];
      for (const table of entitiesOf(entities, 'targetTable')) {
        const rr = timedResolve(() =>
          resolver.resolveNode({
            name: table.normalizedValue,
            nodeType: 'oracle_object',
          }),
        );
        timing.resolveNodeMs += rr.ms;
        graphQueriesExecuted += 1;
        mergeGraph(resolvedGraphEvidence, rr.result);
        const selectionRequired =
          rr.result.status !== 'resolved' || rr.result.candidates.length !== 1;
        if (selectionRequired) selectionRequiredBeforeExecution = true;
        tableEvidence.push({
          businessTarget: table.normalizedValue,
          canonicalCandidates: rr.result.candidates,
          selectionRequiredBeforeExecution: selectionRequired,
          graphStatus: rr.result.status,
        });
        if (rr.result.candidates.length > 1) {
          ambiguities.push({
            kind: 'ambiguous',
            subject: `targetTable:${table.normalizedValue}`,
            message: 'oracle_object_name_ambiguous_across_owners_types',
            candidateIds: rr.result.candidates.map((c) => c.nodeId),
            blocksPlanning: false,
            selectionRequiredBeforeExecution: true,
          });
        }
      }
      evidenceRequirements = evidenceRequirements.map((req) => {
        if (String(req.graphQuery?.op) !== 'resolveOracleTablesFromEntities') return req;
        return {
          ...req,
          status: selectionRequiredBeforeExecution ? 'ambiguous' : 'resolved',
          missingReason: selectionRequiredBeforeExecution
            ? 'canonical_oracle_identity_selection_required_before_execution'
            : null,
          graphResolution: {
            status: selectionRequiredBeforeExecution ? 'ambiguous' : 'resolved',
            selectedNodeId: null,
            candidates: tableEvidence,
            selectionRequiredBeforeExecution,
          },
        };
      });
    }

    // --- Report BHP: structural graph queries from config terms ---
    if (this.options.resolver && intentResult.type === 'build_employee_report') {
      const resolver = this.options.resolver;
      const subject = entitiesOf(entities, 'reportSubject')[0];
      const subjectCfg = configs.language.reportSubjects.find(
        (s) => s.id === subject?.normalizedValue,
      );
      const terms = [
        subject?.rawValue,
        ...(subjectCfg?.graphSearchTerms ?? []),
      ].filter((t): t is string => !!t && String(t).trim().length > 0);

      let anyResolved = false;
      let anyAmbiguous = false;
      const reportCandidates: GraphCandidate[] = [];

      for (const term of [...new Set(terms)]) {
        const nr = timedResolve(() => resolver.resolveNode({ name: term }));
        timing.resolveNodeMs += nr.ms;
        graphQueriesExecuted += 1;
        mergeGraph(resolvedGraphEvidence, nr.result);
        if (nr.result.status === 'resolved') anyResolved = true;
        if (nr.result.status === 'ambiguous' || nr.result.candidates.length > 1) {
          anyAmbiguous = true;
          reportCandidates.push(...nr.result.candidates);
        } else if (nr.result.status === 'resolved' && nr.result.selectedNodeId) {
          reportCandidates.push(...nr.result.candidates);
        }

        const fr = timedResolve(() => resolver.resolveForm({ nameFragment: term }));
        timing.resolveFormMs += fr.ms;
        graphQueriesExecuted += 1;
        mergeGraph(resolvedGraphEvidence, fr.result);
        if (fr.result.status === 'resolved') anyResolved = true;
        if (fr.result.candidates.length > 1) {
          anyAmbiguous = true;
          reportCandidates.push(...fr.result.candidates);
        }
      }

      if (anyAmbiguous) {
        const ids = [...new Set(reportCandidates.map((c) => c.nodeId))].sort();
        ambiguities.push({
          kind: 'ambiguous',
          subject: 'report_graph_sources',
          message: 'multiple_structural_sources_for_report_subject',
          candidateIds: ids.slice(0, 40),
          blocksPlanning: false,
          selectionRequiredBeforeExecution: true,
        });
        selectionRequiredBeforeExecution = true;
      }

      evidenceRequirements = evidenceRequirements.map((req) => {
        if (req.evidenceType === 'business_event_source' || req.evidenceType === 'employee_source') {
          if (anyResolved) {
            return {
              ...req,
              status: req.runtimeSourceRequired ? 'deferred' : 'resolved',
              missingReason: req.runtimeSourceRequired ? 'runtime_source_required' : null,
              graphResolution: {
                status: anyResolved ? 'resolved' : anyAmbiguous ? 'ambiguous' : 'unresolved',
                selectedNodeId: null,
                candidates: reportCandidates.slice(0, 40),
              },
            };
          }
          if (anyAmbiguous) {
            return {
              ...req,
              status: 'ambiguous',
              graphResolution: {
                status: 'ambiguous',
                selectedNodeId: null,
                candidates: reportCandidates.slice(0, 40),
              },
            };
          }
        }
        // runtime employee values stay deferred
        if (req.runtimeSourceRequired && req.status !== 'unavailable') {
          return { ...req, status: 'deferred', missingReason: 'runtime_source_required' };
        }
        return req;
      });
    }

    ambiguities.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return a.subject.localeCompare(b.subject);
    });

    const clarificationQuestions = buildClarificationQuestions(
      missingEntities,
      ambiguities,
      intentDef,
      configs,
      entities,
    );
    const clarificationQuestionsForAmbiguities = clarificationQuestions.filter((q) =>
      ['field_scope_missing', 'form_ambiguous', 'field_ambiguous'].includes(q.entityType),
    ).length;

    let planningStatus = derivePlanningStatus({
      intent: intentResult.type,
      missing: missingEntities,
      ambiguities,
      evidence: evidenceRequirements,
    });
    if (intentResult.type === 'unsupported') planningStatus = 'unsupported';

    // ready means plan complete for next evidence stage — never SQL-ready
    if (planningStatus === 'ready') {
      resolvedGraphEvidence.warnings.push(
        'planningStatus_ready_does_not_allow_sql_generation_or_execution',
      );
    }

    resolvedGraphEvidence.nodes.sort((a, b) =>
      String((a as { id?: string }).id ?? '').localeCompare(String((b as { id?: string }).id ?? '')),
    );
    resolvedGraphEvidence.edges.sort((a, b) =>
      String((a as { id?: string }).id ?? '').localeCompare(String((b as { id?: string }).id ?? '')),
    );

    const evidenceNotApplicable = evidenceRequirements.filter(
      (e) => e.status === 'not_applicable',
    ).length;

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
      selectionRequiredBeforeExecution,
      executionPolicy: {
        sqlGenerationAllowed: false,
        sqlExecutionAllowed: false,
        fileReadAllowed: false,
        oracleWriteAllowed: false,
        reason: 'Stage 3B planning only — ready ≠ SQL execution',
      },
      audit: {
        deterministic: true,
        graphSourceHash: this.options.graphSourceHash,
        plannerConfigVersion: STAGE3B_PLANNER_CONFIG_VERSION,
        plannerDurationMs: Date.now() - started,
        generatedAt: new Date().toISOString(),
        graphQueriesExecuted,
        scopedFieldQueries,
        unscopedFieldQueries,
        resolvedForms,
        resolvedFormScopedFields,
        irrelevantGlobalAmbiguities,
        clarificationQuestionsForAmbiguities,
        evidenceNotApplicable,
        queryTimingMs: timing,
        guessedEntities: 0,
        autoResolvedAmbiguities: 0,
        sqlGenerated: 0,
        sqlExecuted: 0,
        filesRead: 0,
        oracleWrites: 0,
      },
    };
  }

  /**
   * Form resolution order (3B.1):
   * 1) formGuid → resolveForm
   * 2) display name → plugin_registry_entry (exact) → GUID/className → resolveForm
   * 3) nameFragment on application_form (last)
   * Never pick first of many candidates.
   */
  private resolveFormScoped(
    resolver: Stage3aResolverClient,
    formGuid: string | undefined,
    formName: string | undefined,
    timing: PlannerQueryTiming,
    bump: (n: number) => void,
  ): {
    formResult: GraphResolverResult;
    formNodeId: string | null;
    formGuid: string | null;
    pluginResult: GraphResolverResult | null;
  } {
    let pluginResult: GraphResolverResult | null = null;

    if (formGuid) {
      const fr = timedResolve(() => resolver.resolveForm({ guid: formGuid }));
      timing.resolveFormMs += fr.ms;
      bump(1);
      return {
        formResult: fr.result,
        formNodeId: uniqueCandidateId(fr.result),
        formGuid: formGuid.toLowerCase(),
        pluginResult: null,
      };
    }

    if (formName) {
      // Prefer PA display name on plugin_registry_entry (exact Polish title)
      const plugin = timedResolve(() =>
        resolver.resolveNode({ name: formName, nodeType: 'plugin_registry_entry' }),
      );
      timing.resolveNodeMs += plugin.ms;
      bump(1);
      pluginResult = plugin.result;

      const g = guidFromPlugin(plugin.result);
      const className = classNameFromPlugin(plugin.result);
      if (g && plugin.result.candidates.length === 1) {
        const byGuid = timedResolve(() => resolver.resolveForm({ guid: g }));
        timing.resolveFormMs += byGuid.ms;
        bump(1);
        const formNodeId = uniqueCandidateId(byGuid.result);
        return {
          formResult: byGuid.result,
          formNodeId,
          formGuid: g,
          pluginResult,
        };
      }
      if (className && plugin.result.candidates.length === 1) {
        const byType = timedResolve(() => resolver.resolveForm({ fullTypeName: className }));
        timing.resolveFormMs += byType.ms;
        bump(1);
        return {
          formResult: byType.result,
          formNodeId: uniqueCandidateId(byType.result),
          formGuid: guidFromFormNodeId(uniqueCandidateId(byType.result)),
          pluginResult,
        };
      }

      // Fallback: fragment on application_form (often class short name, not Polish title)
      const frag = timedResolve(() => resolver.resolveForm({ nameFragment: formName }));
      timing.resolveFormMs += frag.ms;
      bump(1);
      const formNodeId = uniqueCandidateId(frag.result);
      return {
        formResult: frag.result.candidates.length ? frag.result : plugin.result,
        formNodeId,
        formGuid: guidFromFormNodeId(formNodeId) ?? g,
        pluginResult,
      };
    }

    return {
      formResult: {
        status: 'unresolved',
        query: { op: 'resolveForm' },
        selectedNodeId: null,
        candidates: [],
        nodes: [],
        edges: [],
        paths: [],
        conflicts: [],
        warnings: [],
        provenance: [],
        audit: {},
      },
      formNodeId: null,
      formGuid: null,
      pluginResult: null,
    };
  }

  private classifyFieldResult(
    fieldResult: GraphResolverResult | null,
    helpResult: GraphResolverResult | null,
  ): {
    kind: 'data_field' | 'action' | 'unknown';
    uniqueFieldId: string | null;
    controlName?: string;
    ambiguousControls: boolean;
    candidateIds: string[];
  } {
    if (helpResult?.selectedNodeId) {
      return {
        kind: 'data_field',
        uniqueFieldId: helpResult.selectedNodeId,
        ambiguousControls: false,
        candidateIds: [],
      };
    }
    if (!fieldResult) {
      return {
        kind: 'unknown',
        uniqueFieldId: null,
        ambiguousControls: false,
        candidateIds: [],
      };
    }
    const exact = fieldResult.candidates.filter(
      (c) =>
        c.scoreRank <= 8 ||
        c.matchKind === 'exact_label_in_form' ||
        c.matchKind === 'exact_control_in_form',
    );
    const actions = fieldResult.candidates.filter((c) => c.type === 'action_control');
    const controls = fieldResult.candidates.filter((c) => c.type === 'ui_control');

    if (exact.length === 1) {
      const c = exact[0]!;
      return {
        kind: c.type === 'action_control' ? 'action' : 'data_field',
        uniqueFieldId: c.nodeId,
        controlName: c.name ?? undefined,
        ambiguousControls: false,
        candidateIds: [c.nodeId],
      };
    }
    if (fieldResult.status === 'resolved' && fieldResult.selectedNodeId) {
      const sel = fieldResult.candidates.find((c) => c.nodeId === fieldResult.selectedNodeId);
      return {
        kind: sel?.type === 'action_control' ? 'action' : 'data_field',
        uniqueFieldId: fieldResult.selectedNodeId,
        controlName: sel?.name ?? undefined,
        ambiguousControls: false,
        candidateIds: [fieldResult.selectedNodeId],
      };
    }
    // Token matches only — ambiguous controls, not actions unless only actions
    if (controls.length > 1 && actions.length === 0) {
      return {
        kind: 'data_field',
        uniqueFieldId: null,
        ambiguousControls: true,
        candidateIds: controls.map((c) => c.nodeId),
      };
    }
    if (actions.length === 1 && controls.length === 0) {
      return {
        kind: 'action',
        uniqueFieldId: actions[0]!.nodeId,
        controlName: actions[0]!.name ?? undefined,
        ambiguousControls: false,
        candidateIds: [actions[0]!.nodeId],
      };
    }
    return {
      kind: 'unknown',
      uniqueFieldId: uniqueCandidateId(fieldResult),
      ambiguousControls: fieldResult.candidates.length > 1,
      candidateIds: fieldResult.candidates.map((c) => c.nodeId),
    };
  }

  private applyApplicationFieldEvidence(
    requirements: EvidenceRequirement[],
    ctx: {
      formResult: GraphResolverResult | null;
      formNodeId: string | null;
      fieldResult: GraphResolverResult | null;
      helpResult: GraphResolverResult | null;
      traceResult: GraphResolverResult | null;
      fieldKind: 'data_field' | 'action' | 'unknown';
    },
    ambiguities: AmbiguityRecord[],
  ): EvidenceRequirement[] {
    const setRes = (
      req: EvidenceRequirement,
      status: EvidenceRequirement['status'],
      resolution: EvidenceRequirement['graphResolution'],
      missingReason: string | null = null,
    ): EvidenceRequirement => ({
      ...req,
      status,
      missingReason,
      graphResolution: resolution,
    });

    return requirements.map((req) => {
      if (req.evidenceType === 'form' || req.evidenceType === 'help_document') {
        if (ctx.formNodeId) {
          return setRes(req, 'resolved', {
            status: 'resolved',
            selectedNodeId: ctx.formNodeId,
            candidates: ctx.formResult?.candidates ?? [],
          });
        }
        if (ctx.formResult && ctx.formResult.candidates.length > 1) {
          return setRes(req, 'ambiguous', {
            status: 'ambiguous',
            selectedNodeId: null,
            candidates: ctx.formResult.candidates,
          });
        }
        return setRes(req, 'missing', {
          status: 'unresolved',
          selectedNodeId: null,
          candidates: ctx.formResult?.candidates ?? [],
        }, 'form_not_resolved');
      }

      if (req.evidenceType === 'help_field') {
        if (ctx.helpResult?.selectedNodeId) {
          return setRes(req, 'resolved', {
            status: 'resolved',
            selectedNodeId: ctx.helpResult.selectedNodeId,
            candidates: ctx.helpResult.candidates,
          });
        }
        if (ctx.helpResult?.status === 'ambiguous') {
          return setRes(req, 'ambiguous', {
            status: 'ambiguous',
            selectedNodeId: null,
            candidates: ctx.helpResult.candidates,
          });
        }
        if (ambiguities.some((a) => a.subject === 'field_scope_missing')) {
          return setRes(req, 'missing', {
            status: 'unresolved',
            selectedNodeId: null,
            candidates: [],
          }, 'field_scope_missing');
        }
        return setRes(req, 'missing', {
          status: 'unresolved',
          selectedNodeId: null,
          candidates: [],
        }, 'help_field_not_uniquely_resolved');
      }

      if (req.evidenceType === 'control') {
        if (ctx.fieldKind === 'action') {
          return setRes(req, 'not_applicable', {
            status: 'not_applicable',
            selectedNodeId: null,
            candidates: [],
          }, 'resolved_object_is_action_not_ui_control');
        }
        const exact = (ctx.fieldResult?.candidates ?? []).filter(
          (c) =>
            c.type === 'ui_control' &&
            (c.scoreRank <= 8 ||
              c.matchKind === 'exact_control_in_form' ||
              c.matchKind === 'exact_label_in_form'),
        );
        if (exact.length === 1) {
          return setRes(req, 'resolved', {
            status: 'resolved',
            selectedNodeId: exact[0]!.nodeId,
            candidates: exact,
          });
        }
        if (ctx.helpResult?.selectedNodeId) {
          // Help uniquely identifies the field; control link may be incomplete in Stage 3A
          return setRes(req, 'deferred', {
            status: 'deferred',
            selectedNodeId: null,
            candidates: (ctx.fieldResult?.candidates ?? []).filter((c) => c.type === 'ui_control'),
          }, 'control_link_not_unique_via_stage3a');
        }
        if (ambiguities.some((a) => a.subject === 'field_scope_missing')) {
          return setRes(req, 'missing', null, 'field_scope_missing');
        }
        if ((ctx.fieldResult?.candidates.filter((c) => c.type === 'ui_control').length ?? 0) > 1) {
          return setRes(req, 'ambiguous', {
            status: 'ambiguous',
            selectedNodeId: null,
            candidates: ctx.fieldResult!.candidates.filter((c) => c.type === 'ui_control'),
          });
        }
        return setRes(req, 'missing', {
          status: 'unresolved',
          selectedNodeId: null,
          candidates: ctx.fieldResult?.candidates ?? [],
        });
      }

      if (req.evidenceType === 'action_parameter') {
        if (ctx.fieldKind === 'data_field' || ctx.helpResult?.selectedNodeId) {
          return setRes(req, 'not_applicable', {
            status: 'not_applicable',
            selectedNodeId: null,
            candidates: [],
          }, 'resolved_object_is_not_action_control');
        }
        if (ctx.fieldKind === 'action') {
          return setRes(req, 'deferred', {
            status: 'deferred',
            selectedNodeId: ctx.fieldResult?.selectedNodeId ?? null,
            candidates: (ctx.fieldResult?.candidates ?? []).filter((c) => c.type === 'action_control'),
          }, 'action_parameter_lookup_deferred');
        }
        if (ambiguities.some((a) => a.subject === 'field_scope_missing')) {
          return setRes(req, 'not_applicable', null, 'field_scope_missing_no_action_search');
        }
        return setRes(req, 'not_applicable', null, 'action_parameter_not_searched_for_data_field');
      }

      if (
        req.evidenceType === 'target_binding' ||
        req.evidenceType === 'lookup_binding' ||
        req.evidenceType === 'dataset_columns' ||
        req.evidenceType === 'oracle_columns' ||
        req.evidenceType === 'provenance'
      ) {
        if (ctx.fieldKind === 'action' && req.evidenceType !== 'provenance') {
          return setRes(req, 'not_applicable', null, 'not_applicable_for_action');
        }
        if (ctx.traceResult) {
          const hasNodes = ctx.traceResult.nodes.length > 0;
          return setRes(
            req,
            ctx.traceResult.status === 'resolved' || hasNodes ? 'resolved' : 'deferred',
            {
              status: ctx.traceResult.status,
              selectedNodeId: ctx.traceResult.selectedNodeId,
              candidates: ctx.traceResult.candidates,
              truncated: ctx.traceResult.truncated === true,
            },
          );
        }
        if (ctx.helpResult?.selectedNodeId || ctx.formNodeId) {
          return setRes(req, 'deferred', null, 'trace_not_available_or_incomplete');
        }
        return req;
      }

      return req;
    });
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
      selectionRequiredBeforeExecution: false,
      executionPolicy: {
        sqlGenerationAllowed: false,
        sqlExecutionAllowed: false,
        fileReadAllowed: false,
        oracleWriteAllowed: false,
        reason: 'Stage 3B planning only — ready ≠ SQL execution',
      },
      audit: {
        deterministic: true,
        graphSourceHash: this.options.graphSourceHash,
        plannerConfigVersion: STAGE3B_PLANNER_CONFIG_VERSION,
        plannerDurationMs: Date.now() - started,
        generatedAt: new Date().toISOString(),
        graphQueriesExecuted: 0,
        scopedFieldQueries: 0,
        unscopedFieldQueries: 0,
        resolvedForms: 0,
        resolvedFormScopedFields: 0,
        irrelevantGlobalAmbiguities: 0,
        clarificationQuestionsForAmbiguities: 0,
        evidenceNotApplicable: 0,
        queryTimingMs: { resolveFormMs: 0, resolveFieldMs: 0, resolveNodeMs: 0, otherMs: 0 },
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
