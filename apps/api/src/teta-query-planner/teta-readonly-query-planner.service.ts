/**
 * Stage 3C — TetaReadOnlyQueryPlannerService.
 * Converts Stage 3B TetaEvidencePlan → typed TetaReadOnlyQueryPlan (no SQL).
 */
import { STAGE3B_CONTRACT_VERSION } from '../teta-planner/teta-stage3b.types';
import { STAGE3A_INDEX_SCHEMA_VERSION } from '../teta-plugins/teta-stage3a.types';
import {
  extractSubject,
  gatePlanningRequest,
  sortLex,
} from './teta-query-plan-contract';
import {
  STAGE3C_CONTRACT_VERSION,
  STAGE3C_REPORT_TEMPLATE_VERSION,
  STAGE3C_SAFETY_POLICY_VERSION,
  STAGE3C_SUPPORTED_INTENT,
  type TetaReadOnlyQueryPlan,
  type TetaReadOnlyQueryPlanningRequest,
} from './teta-query-plan.types';
import type { ReportQueryTemplatesFile } from './teta-report-template.types';
import { getReportTemplate } from './teta-report-template-loader';
import type { QuerySafetyPolicy } from './teta-query-safety-policy';
import { countRawSqlFragments } from './teta-query-safety-policy';
import { resolveSources } from './teta-query-source-resolver';
import { resolveColumns } from './teta-query-column-resolver';
import { planJoins, sourcesAreConnected } from './teta-query-join-planner';
import { planFilters } from './teta-query-filter-planner';
import { planOrdering } from './teta-query-projection-planner';
import type { Stage3cGraphClient } from './teta-query-graph-client';
import type { TetaBusinessRoleResolver } from '../teta-business-semantics/teta-business-role-resolver';
import { buildStage3cSemanticPackage } from '../teta-business-semantics/teta-stage3c-semantic-adapter';
import type { SemanticTemporalBinding } from '../teta-business-semantics/teta-business-semantics.types';

export type QueryPlannerOptions = {
  templates: ReportQueryTemplatesFile;
  safety: QuerySafetyPolicy;
  graph: Stage3cGraphClient | null;
  graphSourceHash: string | null;
  graphIndexSchemaVersion?: string | null;
  /** Optional Stage 3D business semantics resolver (does not change Stage 3C contracts). */
  semanticResolver?: TetaBusinessRoleResolver | null;
};

function emptySideEffectAudit() {
  return {
    finalSqlGenerated: 0,
    sqlExecuted: 0,
    oracleConnections: 0,
    oracleWrites: 0,
    businessDataRowsRead: 0,
    xlsxFilesRead: 0,
    qdrantCalls: 0,
    embeddingCalls: 0,
    llmCalls: 0,
    agentCalls: 0,
    rawSqlFragments: 0,
    selectStar: 0,
    unboundUserLiterals: 0,
    unknownOwnerAutoSelections: 0,
    hrmOwnerAutoSelections: 0,
    unsupportedOwnerAutoSelections: 0,
    baseTableSelectionsWithoutGraphPath: 0,
    equalCandidatesAutoSelected: 0,
    cartesianJoins: 0,
  };
}

function basePlan(partial: Partial<TetaReadOnlyQueryPlan> & Pick<TetaReadOnlyQueryPlan, 'planStatus' | 'intent' | 'subject'>): TetaReadOnlyQueryPlan {
  return {
    contractVersion: STAGE3C_CONTRACT_VERSION,
    sources: [],
    joins: [],
    projections: [],
    filters: [],
    ordering: [],
    limits: { maxRows: 500, maxColumns: 20, statementTimeoutMs: 30000 },
    authorization: {
      status: 'deferred',
      assumedOracleUser: 'TETA_ADMIN',
      filtersApplied: false,
      reason: 'Authorization will be implemented in a later stage.',
    },
    unresolvedSelections: [],
    warnings: [],
    evidence: {
      graphSourceHash: null,
      nodeIds: [],
      edgeIds: [],
      paths: [],
      conflicts: [],
    },
    executionPolicy: {
      sqlCompilationAllowed: false,
      sqlExecutionAllowed: false,
      oracleConnectionAllowed: false,
      oracleWriteAllowed: false,
      fileReadAllowed: false,
      reason: 'Stage 3C creates a typed plan only.',
    },
    audit: {
      deterministic: true,
      plannerDurationMs: 0,
      reportTemplateVersion: STAGE3C_REPORT_TEMPLATE_VERSION,
      safetyPolicyVersion: STAGE3C_SAFETY_POLICY_VERSION,
      stage3bContractVersion: STAGE3B_CONTRACT_VERSION,
      graphIndexSchemaVersion: STAGE3A_INDEX_SCHEMA_VERSION,
      graphSourceHash: null,
      ...emptySideEffectAudit(),
    },
    rejection: null,
    ...partial,
  };
}

export class TetaReadOnlyQueryPlannerService {
  constructor(private readonly options: QueryPlannerOptions) {}

  plan(request: TetaReadOnlyQueryPlanningRequest): TetaReadOnlyQueryPlan {
    const started = Date.now();
    const gate = gatePlanningRequest(request, this.options.graphSourceHash);
    const subject = extractSubject(request.evidencePlan, request.expectedSubject);

    if (!gate.ok) {
      const plan = basePlan({
        planStatus: gate.planStatus,
        intent: request.evidencePlan?.intent?.type ?? request.expectedIntent,
        subject,
        limits: {
          maxRows: this.options.safety.maxRows,
          maxColumns: this.options.safety.maxColumns,
          statementTimeoutMs: this.options.safety.statementTimeoutMs,
        },
        authorization: {
          status: 'deferred',
          assumedOracleUser: this.options.safety.authorization.assumedOracleUser,
          filtersApplied: false,
          reason: this.options.safety.authorization.reason,
        },
        executionPolicy: {
          ...this.options.safety.executionPolicyDefaults,
        },
        evidence: {
          graphSourceHash: this.options.graphSourceHash,
          nodeIds: [],
          edgeIds: [],
          paths: [],
          conflicts: [],
        },
        rejection: { code: gate.code, message: gate.message },
        unresolvedSelections:
          gate.planStatus === 'needs_selection'
            ? (request.evidencePlan.ambiguities ?? [])
                .filter((a) => a.blocksPlanning !== false)
                .map((a) => ({
                  subject: a.subject,
                  reason: a.message,
                  candidateNodeIds: [...(a.candidateIds ?? [])].sort(),
                  blocksPlanning: true,
                }))
            : [],
      });
      plan.audit.plannerDurationMs = Date.now() - started;
      plan.audit.generatedAt = new Date().toISOString();
      plan.audit.graphSourceHash = this.options.graphSourceHash;
      plan.audit.graphIndexSchemaVersion =
        this.options.graphIndexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION;
      plan.audit.rawSqlFragments = countRawSqlFragments(plan);
      return plan;
    }

    // selectionRequiredBeforeExecution must not be ignored — record as unresolved technical selection
    const preSelections =
      request.evidencePlan.selectionRequiredBeforeExecution
        ? (request.evidencePlan.ambiguities ?? [])
            .filter((a) => a.selectionRequiredBeforeExecution)
            .map((a) => ({
              subject: a.subject,
              reason: a.message,
              candidateNodeIds: [...(a.candidateIds ?? [])].sort(),
              blocksPlanning: a.blocksPlanning !== false,
            }))
        : [];

    const blockingAmbiguities = (request.evidencePlan.ambiguities ?? []).filter(
      (a) => a.blocksPlanning !== false,
    );
    if (blockingAmbiguities.length || request.evidencePlan.planningStatus === 'ambiguous') {
      if (blockingAmbiguities.length) {
        const plan = basePlan({
          planStatus: 'needs_selection',
          intent: STAGE3C_SUPPORTED_INTENT,
          subject,
          limits: {
            maxRows: this.options.safety.maxRows,
            maxColumns: this.options.safety.maxColumns,
            statementTimeoutMs: this.options.safety.statementTimeoutMs,
          },
          authorization: {
            status: 'deferred',
            assumedOracleUser: this.options.safety.authorization.assumedOracleUser,
            filtersApplied: false,
            reason: this.options.safety.authorization.reason,
          },
          executionPolicy: { ...this.options.safety.executionPolicyDefaults },
          unresolvedSelections: blockingAmbiguities.map((a) => ({
            subject: a.subject,
            reason: a.message,
            candidateNodeIds: [...(a.candidateIds ?? [])].sort(),
            blocksPlanning: true,
          })),
          rejection: {
            code: 'blocking_ambiguity',
            message: 'Blocking ambiguity from Stage 3B; no automatic selection',
          },
          evidence: {
            graphSourceHash: this.options.graphSourceHash,
            nodeIds: [],
            edgeIds: [],
            paths: [],
            conflicts: [],
          },
        });
        plan.audit.plannerDurationMs = Date.now() - started;
        plan.audit.generatedAt = new Date().toISOString();
        plan.audit.graphSourceHash = this.options.graphSourceHash;
        plan.audit.rawSqlFragments = countRawSqlFragments(plan);
        return plan;
      }
    }

    if (!this.options.graph) {
      const plan = basePlan({
        planStatus: 'needs_graph_resolution',
        intent: STAGE3C_SUPPORTED_INTENT,
        subject,
        warnings: [{ code: 'graph_client_missing', message: 'Stage 3A graph client is not available' }],
        rejection: { code: 'graph_client_missing', message: 'Canonical graph resolver required' },
      });
      plan.audit.plannerDurationMs = Date.now() - started;
      plan.audit.generatedAt = new Date().toISOString();
      return plan;
    }

    const template = getReportTemplate(this.options.templates, subject!);
    if (!template) {
      const plan = basePlan({
        planStatus: 'unsupported',
        intent: STAGE3C_SUPPORTED_INTENT,
        subject,
        rejection: {
          code: 'missing_report_template',
          message: `No report template for subject ${subject}`,
        },
      });
      plan.audit.plannerDurationMs = Date.now() - started;
      plan.audit.generatedAt = new Date().toISOString();
      return plan;
    }

    const semanticPkg =
      this.options.semanticResolver && subject
        ? buildStage3cSemanticPackage(this.options.semanticResolver, subject)
        : null;

    const roleOrder = [
      ...template.requiredSourceRoles,
      ...((semanticPkg?.additionalSourceRoles ?? []).filter(
        (r) => !template.requiredSourceRoles.includes(r),
      )),
    ];

    const sourceResult = resolveSources({
      client: this.options.graph,
      roles: template.sourceRoleResolutions,
      roleOrder,
      policy: this.options.safety,
      evidencePlan: request.evidencePlan,
      semanticSources: semanticPkg?.sourcesByRole ?? null,
    });

    const columnResult = resolveColumns({
      client: this.options.graph,
      projections: template.projectionRoleResolutions,
      projectionOrder: template.requiredProjectionRoles,
      sources: sourceResult.sources,
      semanticProjections: semanticPkg?.projectionsByRole ?? null,
    });

    const joinResult = planJoins({
      client: this.options.graph,
      joinSpecs: template.requiredJoins,
      sources: sourceResult.sources,
      semanticRelations: semanticPkg?.relations ?? null,
    });

    const semanticTemporals = new Map<string, SemanticTemporalBinding>();
    if (semanticPkg && this.options.semanticResolver && subject) {
      for (const filterRole of template.requiredFilters) {
        const t = this.options.semanticResolver.getApprovedTemporal(subject, filterRole);
        if (t) semanticTemporals.set(filterRole, t);
      }
    }

    const filterResult = planFilters({
      client: this.options.graph,
      filterSpecs: template.filterResolutions,
      filterOrder: template.requiredFilters,
      projections: columnResult.projections,
      sources: sourceResult.sources,
      semanticTemporals: semanticTemporals.size ? semanticTemporals : null,
    });

    const ordering = planOrdering({
      orderingSpecs: template.orderingResolutions,
      orderingOrder: template.defaultOrdering,
      projections: columnResult.projections,
    });

    const connectivity = sourcesAreConnected(sourceResult.sources, joinResult.joins);

    const unresolvedSelections = [
      ...preSelections,
      ...sourceResult.unresolvedSelections,
      ...columnResult.unresolvedSelections,
    ];

    const warnings: TetaReadOnlyQueryPlan['warnings'] = [];

    // Forbidden: examination type filter must not appear
    if (filterResult.filters.some((f) => /examination_type/i.test(f.filterRole))) {
      warnings.push({
        code: 'unexpected_examination_type_filter',
        message: 'Report must include all examination types; type filter is forbidden',
      });
    }

    const allSourcesResolved = template.requiredSourceRoles.every((r) =>
      sourceResult.sources.some((s) => s.sourceRole === r && s.status === 'resolved'),
    );
    const allProjectionsResolved = template.requiredProjectionRoles.every((r) =>
      columnResult.projections.some((p) => p.businessRole === r && p.status === 'resolved'),
    );
    const requiredJoinsOk = template.requiredJoins
      .filter((j) => j.required)
      .every((j) =>
        joinResult.joins.some(
          (x) =>
            x.leftSourceRole === j.leftSourceRole &&
            x.rightSourceRole === j.rightSourceRole &&
            x.status === 'resolved' &&
            x.predicates.length > 0,
        ),
      );
    const filtersOk = template.requiredFilters.every((r) =>
      filterResult.filters.some((f) => f.filterRole === r && f.status === 'resolved'),
    );
    const enrichmentLeftOk = template.requiredJoins
      .filter((j) => j.enrichment)
      .every((j) =>
        joinResult.joins.some(
          (x) =>
            x.leftSourceRole === j.leftSourceRole &&
            x.rightSourceRole === j.rightSourceRole &&
            (x.status !== 'resolved' || x.joinType === 'left'),
        ),
      );

    const blockingSelection = unresolvedSelections.some((u) => u.blocksPlanning);
    const equalAuto =
      sourceResult.unresolvedSelections.some((u) => u.reason.includes('equal')) &&
      sourceResult.sources.some((s) => s.status === 'resolved' && s.candidateNodeIds.length > 1)
        ? 0
        : 0;

    let planStatus: TetaReadOnlyQueryPlan['planStatus'] = 'ready_for_compilation';
    if (blockingSelection) {
      planStatus = 'needs_selection';
    } else if (
      !allSourcesResolved ||
      !allProjectionsResolved ||
      !requiredJoinsOk ||
      !filtersOk ||
      !connectivity.connected ||
      joinResult.cartesianJoins > 0 ||
      !enrichmentLeftOk
    ) {
      planStatus = 'needs_graph_resolution';
    }

    if (!enrichmentLeftOk) {
      warnings.push({
        code: 'enrichment_join_not_left',
        message: 'Position/org-unit enrichment joins must use left join so missing enrichment does not drop employees',
      });
    }

    const nodeIds = sortLex([
      ...sourceResult.sources.flatMap((s) => [
        ...(s.logicalObject ? [s.logicalObject.nodeId] : []),
        ...(s.accessObject ? [s.accessObject.nodeId] : []),
        ...s.provenanceNodeIds,
        ...s.pathNodeIds,
      ]),
      ...columnResult.projections.flatMap((p) => [
        ...(p.oracleColumnNodeId ? [p.oracleColumnNodeId] : []),
        ...p.provenanceNodeIds,
      ]),
      ...joinResult.joins.flatMap((j) => j.pathNodeIds),
      ...filterResult.filters.flatMap((f) => f.provenanceNodeIds),
    ]);
    const edgeIds = sortLex([
      ...sourceResult.sources.flatMap((s) => s.provenanceEdgeIds),
      ...columnResult.projections.flatMap((p) => p.provenanceEdgeIds),
      ...joinResult.joins.flatMap((j) => j.provenanceEdgeIds),
      ...filterResult.filters.flatMap((f) => f.provenanceEdgeIds),
    ]);

    const plan = basePlan({
      planStatus,
      intent: STAGE3C_SUPPORTED_INTENT,
      subject,
      sources: sourceResult.sources,
      joins: joinResult.joins,
      projections: columnResult.projections,
      filters: filterResult.filters,
      ordering,
      limits: {
        maxRows: this.options.safety.maxRows,
        maxColumns: this.options.safety.maxColumns,
        statementTimeoutMs: this.options.safety.statementTimeoutMs,
      },
      authorization: {
        status: 'deferred',
        assumedOracleUser: this.options.safety.authorization.assumedOracleUser,
        filtersApplied: false,
        reason: this.options.safety.authorization.reason,
      },
      unresolvedSelections,
      warnings,
      evidence: {
        graphSourceHash: this.options.graphSourceHash,
        nodeIds,
        edgeIds,
        paths: [],
        conflicts: [],
      },
      executionPolicy: { ...this.options.safety.executionPolicyDefaults },
      rejection: null,
    });

    plan.audit.plannerDurationMs = Date.now() - started;
    plan.audit.generatedAt = new Date().toISOString();
    plan.audit.graphSourceHash = this.options.graphSourceHash;
    plan.audit.graphIndexSchemaVersion =
      this.options.graphIndexSchemaVersion ?? STAGE3A_INDEX_SCHEMA_VERSION;
    plan.audit.unknownOwnerAutoSelections = sourceResult.metrics.unknownOwnerAutoSelections;
    plan.audit.hrmOwnerAutoSelections = sourceResult.metrics.hrmOwnerAutoSelections;
    plan.audit.unsupportedOwnerAutoSelections = sourceResult.metrics.unsupportedOwnerAutoSelections;
    plan.audit.baseTableSelectionsWithoutGraphPath =
      sourceResult.metrics.baseTableSelectionsWithoutGraphPath;
    plan.audit.equalCandidatesAutoSelected =
      sourceResult.metrics.equalCandidatesAutoSelected + equalAuto;
    plan.audit.cartesianJoins = joinResult.cartesianJoins;
    plan.audit.rawSqlFragments = countRawSqlFragments(plan);
    plan.audit.selectStar = 0;

    // Never allow ready if safety counters fired
    if (
      plan.planStatus === 'ready_for_compilation' &&
      (plan.audit.unknownOwnerAutoSelections > 0 ||
        plan.audit.hrmOwnerAutoSelections > 0 ||
        plan.audit.baseTableSelectionsWithoutGraphPath > 0 ||
        plan.audit.equalCandidatesAutoSelected > 0 ||
        plan.audit.cartesianJoins > 0 ||
        plan.audit.rawSqlFragments > 0 ||
        columnResult.projections.length > plan.limits.maxColumns)
    ) {
      plan.planStatus = 'invalid';
      plan.warnings.push({
        code: 'safety_policy_violation',
        message: 'Plan violated Stage 3C safety counters',
      });
    }

    return plan;
  }
}
