/**
 * Stage 3D — audit report + artifacts.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import type { TetaBusinessRoleResolver } from './teta-business-role-resolver';
import type { TetaReadOnlyQueryPlannerService } from '../teta-query-planner/teta-readonly-query-planner.service';
import type { TetaEvidencePlannerService } from '../teta-planner/teta-evidence-planner.service';
import {
  STAGE3C_SUPPORTED_INTENT,
  STAGE3C_SUPPORTED_SUBJECT,
  type TetaReadOnlyQueryPlan,
} from '../teta-query-planner/teta-query-plan.types';
import { resolveValuePath } from './teta-semantic-value-path-resolver';
import { resolveTemporalRule } from './teta-semantic-temporal-rule-resolver';
import {
  STAGE3D_BINDINGS_VERSION,
  STAGE3D_CONTRACT_VERSION,
  STAGE3D_IDENTITY_VERSION,
  STAGE3D_LANGUAGE_VERSION,
  STAGE3D_ONTOLOGY_VERSION,
  type Stage3dAuditReport,
} from './teta-business-semantics.types';

export const STAGE3D_REFERENCE_BHP_QUESTION =
  'Zrób raport pracowników, którym kończą się badania BHP w tym miesiącu.';

export function runStage3dAudit(input: {
  semanticResolver: TetaBusinessRoleResolver;
  queryPlanner: TetaReadOnlyQueryPlannerService;
  evidencePlanner: TetaEvidencePlannerService;
  graphSourceHash: string | null;
  graphIndexSchemaVersion: string | null;
}): Stage3dAuditReport {
  const strictErrors: string[] = [];
  const validation = input.semanticResolver.validateRegistry();
  const resolution = input.semanticResolver.resolveSubject(STAGE3C_SUPPORTED_SUBJECT);

  if (!validation.ok) {
    for (const issue of validation.issues.filter((i) => i.severity === 'error')) {
      strictErrors.push(`${issue.code}: ${issue.message}`);
    }
  }
  if (validation.stale) {
    strictErrors.push('bindings registry is stale vs current graphSourceHash');
  }
  if (resolution.status !== 'ready') {
    strictErrors.push(`subject resolution status=${resolution.status}; expected ready`);
  }

  const positionVp = resolveValuePath(
    input.semanticResolver.getApprovedValuePath(STAGE3C_SUPPORTED_SUBJECT, 'position_name'),
  );
  const examTypeVp = resolveValuePath(
    input.semanticResolver.getApprovedValuePath(
      STAGE3C_SUPPORTED_SUBJECT,
      'examination_type_name',
    ),
  );
  const orgUnitVp = resolveValuePath(
    input.semanticResolver.getApprovedValuePath(
      STAGE3C_SUPPORTED_SUBJECT,
      'organizational_unit_name',
    ),
  );
  if (positionVp.status !== 'resolved') {
    strictErrors.push('position_name value path not resolved');
  }
  if (examTypeVp.status !== 'resolved') {
    strictErrors.push('examination_type_name value path not resolved');
  }
  if (orgUnitVp.status !== 'resolved') {
    strictErrors.push('organizational_unit_name value path not resolved');
  }
  if (
    orgUnitVp.status === 'resolved' &&
    orgUnitVp.pathSummary[0] &&
    !orgUnitVp.pathSummary[0].startsWith('current_position:')
  ) {
    strictErrors.push('organizational_unit_name does not start from current_position');
  }

  const active = resolveTemporalRule(
    input.semanticResolver.getApprovedTemporal(
      STAGE3C_SUPPORTED_SUBJECT,
      'employee_active_on_oracle_sysdate',
    ),
  );
  if (active.type !== 'effective_on_date' || active.status !== 'resolved') {
    strictErrors.push('employee_active_on_oracle_sysdate temporal not resolved');
  }

  const currentPositionTemporalBindingsRequired = 1;
  const positionTemporalBinding = input.semanticResolver.getApprovedTemporal(
    STAGE3C_SUPPORTED_SUBJECT,
    'current_position_on_oracle_sysdate',
  );
  const positionTemporal = resolveTemporalRule(positionTemporalBinding);
  const currentPositionTemporalBindingsApproved =
    positionTemporalBinding?.status === 'approved' &&
    positionTemporal.type === 'effective_on_date' &&
    positionTemporal.status === 'resolved'
      ? 1
      : 0;
  if (currentPositionTemporalBindingsApproved !== 1) {
    strictErrors.push('current_position_on_oracle_sysdate temporal not approved/resolved');
  }
  if (
    positionTemporal.type === 'effective_on_date' &&
    positionTemporal.sourceRole !== 'current_position'
  ) {
    strictErrors.push('current_position temporal must use sourceRole=current_position');
  }

  const evidencePlan = input.evidencePlanner.plan({ question: STAGE3D_REFERENCE_BHP_QUESTION });
  const queryPlan = input.queryPlanner.plan({
    evidencePlan,
    expectedIntent: STAGE3C_SUPPORTED_INTENT,
    expectedSubject: STAGE3C_SUPPORTED_SUBJECT,
    runtimeAssumptions: {
      oracleUser: 'TETA_ADMIN',
      authorizationEnforcement: 'deferred',
      dateClock: 'oracle_sysdate',
    },
  });

  if (queryPlan.planStatus !== 'ready_for_compilation') {
    strictErrors.push(
      `reference BHP planStatus=${queryPlan.planStatus}; expected ready_for_compilation`,
    );
  }
  if (queryPlan.audit.finalSqlGenerated !== 0) strictErrors.push('finalSqlGenerated != 0');
  if (queryPlan.audit.sqlExecuted !== 0) strictErrors.push('sqlExecuted != 0');
  if (queryPlan.audit.oracleConnections !== 0) strictErrors.push('oracleConnections != 0');
  if (queryPlan.audit.qdrantCalls !== 0) strictErrors.push('qdrantCalls != 0');
  if (queryPlan.audit.llmCalls !== 0) strictErrors.push('llmCalls != 0');
  if (queryPlan.audit.agentCalls !== 0) strictErrors.push('agentCalls != 0');
  if (queryPlan.contractVersion !== 'teta-aia-readonly-query-plan-v1') {
    strictErrors.push('Stage 3C contractVersion changed unexpectedly');
  }

  const posProj = queryPlan.projections.find((p) => p.businessRole === 'position_name');
  if (posProj?.oracleColumnNodeId !== positionVp.displayColumnNodeId) {
    strictErrors.push('position_name projection does not use value-path display column');
  }
  const examProj = queryPlan.projections.find((p) => p.businessRole === 'examination_type_name');
  if (examProj?.oracleColumnNodeId !== examTypeVp.displayColumnNodeId) {
    strictErrors.push('examination_type_name projection does not use value-path display column');
  }

  const activeFilter = queryPlan.filters.find(
    (f) => f.filterRole === 'employee_active_on_oracle_sysdate',
  );
  if (!activeFilter || activeFilter.status !== 'resolved') {
    strictErrors.push('active employee filter not resolved in Stage 3C plan');
  }

  const positionFilter = queryPlan.filters.find(
    (f) => f.filterRole === 'current_position_on_oracle_sysdate',
  );
  const currentPositionFiltersResolved =
    positionFilter?.status === 'resolved' ? 1 : 0;
  const currentPositionFiltersMissing = currentPositionFiltersResolved === 1 ? 0 : 1;
  const historicalPositionLeakRisk =
    queryPlan.sources.some((s) => s.sourceRole === 'current_position' && s.status === 'resolved') &&
    currentPositionFiltersResolved !== 1
      ? 1
      : 0;

  if (currentPositionFiltersMissing !== 0) {
    strictErrors.push('current_position_on_oracle_sysdate filter missing or incomplete');
  }
  if (historicalPositionLeakRisk !== 0) {
    strictErrors.push('historicalPositionLeakRisk: current_position without temporal filter');
  }
  if (positionFilter && positionFilter.status === 'resolved') {
    if (positionFilter.type !== 'effective_on_date') {
      strictErrors.push('current position filter must be effective_on_date');
    } else if (positionFilter.sourceRole !== 'current_position') {
      strictErrors.push('current position filter sourceRole must be current_position');
    }
  }

  const requiredFilters = [
    'examination_valid_to_in_current_month',
    'employee_active_on_oracle_sysdate',
    'current_position_on_oracle_sysdate',
  ];
  for (const role of requiredFilters) {
    const f = queryPlan.filters.find((x) => x.filterRole === role);
    if (!f || f.status !== 'resolved') {
      strictErrors.push(`Reference A: filter ${role} not resolved`);
    }
  }

  const empToOu = queryPlan.joins.filter(
    (j) =>
      j.leftSourceRole === 'employee' &&
      j.rightSourceRole === 'organizational_unit' &&
      j.status === 'resolved',
  );
  const posToOu = queryPlan.joins.filter(
    (j) =>
      j.leftSourceRole === 'current_position' &&
      j.rightSourceRole === 'organizational_unit' &&
      j.status === 'resolved',
  );
  const competingOrganizationalUnitPaths =
    empToOu.length > 0 && posToOu.length > 0 ? empToOu.length + posToOu.length : empToOu.length > 0 ? 1 : 0;
  const projectionPathsWithMultipleAuthoritativeSources =
    empToOu.length > 0 && posToOu.length > 0 ? 1 : 0;

  if (competingOrganizationalUnitPaths !== 0) {
    strictErrors.push('competingOrganizationalUnitPaths != 0');
  }
  if (projectionPathsWithMultipleAuthoritativeSources !== 0) {
    strictErrors.push('projectionPathsWithMultipleAuthoritativeSources != 0');
  }
  if (posToOu.length !== 1) {
    strictErrors.push('expected exactly one current_position→organizational_unit join');
  }

  const ouVpBinding = input.semanticResolver.getApprovedValuePath(
    STAGE3C_SUPPORTED_SUBJECT,
    'organizational_unit_name',
  );
  if (ouVpBinding?.authoritativeStartSourceRole !== 'current_position') {
    strictErrors.push('organizational_unit_name authoritativeStartSourceRole must be current_position');
  }

  const activeEmployeeMechanism =
    active.type === 'effective_on_date'
      ? `effective_on_date on active_employment DATA_OD/DATA_DO (openEndedEndAllowed=${active.openEndedEndAllowed}); join employee.ID = active_employment.PRAC_ID`
      : null;

  const currentPositionTemporalMechanism =
    positionTemporal.type === 'effective_on_date'
      ? `effective_on_date on current_position DATA_OD/DATA_DO (openEndedEndAllowed=${positionTemporal.openEndedEndAllowed}, startInclusive=${positionTemporal.startInclusive}, endInclusive=${positionTemporal.endInclusive}, clock=oracle_sysdate)`
      : null;

  if (currentPositionTemporalBindingsRequired !== 1) {
    strictErrors.push('currentPositionTemporalBindingsRequired != 1');
  }
  if (currentPositionTemporalBindingsApproved !== 1) {
    strictErrors.push('currentPositionTemporalBindingsApproved != 1');
  }
  if (currentPositionFiltersResolved !== 1) {
    strictErrors.push('currentPositionFiltersResolved != 1');
  }
  if (currentPositionFiltersMissing !== 0) {
    strictErrors.push('currentPositionFiltersMissing != 0');
  }

  const report: Stage3dAuditReport = {
    contractVersion: STAGE3D_CONTRACT_VERSION,
    ontologyVersion: STAGE3D_ONTOLOGY_VERSION,
    bindingsVersion: STAGE3D_BINDINGS_VERSION,
    languageVersion: STAGE3D_LANGUAGE_VERSION,
    identityVersion: STAGE3D_IDENTITY_VERSION,
    graphSourceHash: input.graphSourceHash,
    graphIndexSchemaVersion: input.graphIndexSchemaVersion,
    subjectsValidated: input.semanticResolver.bindings.subjects.length,
    approvedBindings: validation.approvedBindingCount,
    staleBindings: validation.stale ? validation.approvedBindingCount : 0,
    invalidBindings: validation.invalidBindingCount,
    unresolvedRoles: resolution.sources.filter((s) => s.status === 'unresolved').length,
    ambiguousRoles: resolution.sources.filter((s) => s.status === 'ambiguous').length,
    validationOk: validation.ok,
    referenceBhpPlanStatus: queryPlan.planStatus,
    positionNamePath: positionVp.pathSummary,
    examinationTypeNamePath: examTypeVp.pathSummary,
    organizationalUnitNamePath: orgUnitVp.pathSummary,
    activeEmployeeMechanism,
    currentPositionTemporalMechanism,
    currentPositionTemporalBindingsRequired,
    currentPositionTemporalBindingsApproved,
    currentPositionFiltersResolved,
    currentPositionFiltersMissing,
    historicalPositionLeakRisk,
    competingOrganizationalUnitPaths,
    projectionPathsWithMultipleAuthoritativeSources,
    finalSqlGenerated: queryPlan.audit.finalSqlGenerated,
    sqlExecuted: queryPlan.audit.sqlExecuted,
    oracleConnections: queryPlan.audit.oracleConnections,
    qdrantCalls: queryPlan.audit.qdrantCalls,
    embeddingCalls: queryPlan.audit.embeddingCalls,
    llmCalls: queryPlan.audit.llmCalls,
    agentCalls: queryPlan.audit.agentCalls,
    strictErrors,
    deterministicCheckOk: true,
    referenceResults: {
      A: {
        evidencePlanningStatus: evidencePlan.planningStatus,
        queryPlanStatus: queryPlan.planStatus,
        sources: queryPlan.sources.map((s) => ({
          role: s.sourceRole,
          status: s.status,
          logical: s.logicalObject?.nodeId ?? null,
          access: s.accessObject?.nodeId ?? null,
        })),
        projections: queryPlan.projections.map((p) => ({
          role: p.businessRole,
          status: p.status,
          column: p.oracleColumnNodeId,
        })),
        joins: queryPlan.joins.map((j) => ({
          id: j.joinId,
          status: j.status,
          predicates: j.predicates.length,
          left: j.leftSourceRole,
          right: j.rightSourceRole,
        })),
        filters: queryPlan.filters.map((f) => ({
          role: f.filterRole,
          status: f.status,
          type: f.type,
          sourceRole: f.type === 'effective_on_date' ? f.sourceRole ?? null : null,
        })),
        positionNamePath: positionVp.pathSummary,
        examinationTypeNamePath: examTypeVp.pathSummary,
        organizationalUnitNamePath: orgUnitVp.pathSummary,
        activeEmployeeMechanism,
        currentPositionTemporalMechanism,
        authoritativeOrganizationalUnitPath: orgUnitVp.pathSummary,
        competingOrganizationalUnitPaths,
      },
      validation,
      resolutionStatus: resolution.status,
    },
    generatedAt: new Date().toISOString(),
  };

  return report;
}

export function writeStage3dAuditArtifacts(
  report: Stage3dAuditReport,
  repoRoot: string,
  referencePlan?: TetaReadOnlyQueryPlan | null,
): void {
  const docsDir = path.join(repoRoot, 'docs');
  const localDir = path.join(repoRoot, '.local');
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
  if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

  const md = renderStage3dAuditMarkdown(report, referencePlan);
  writeFileSync(path.join(docsDir, 'AIA_BUSINESS_SEMANTICS_STAGE3D.md'), md, 'utf8');
  writeFileSync(
    path.join(docsDir, 'AIA_BUSINESS_SEMANTICS_STAGE3D.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
  writeFileSync(
    path.join(localDir, 'AIA_BUSINESS_SEMANTICS_STAGE3D.audit.json'),
    JSON.stringify({ report, referencePlan: referencePlan ?? null }, null, 2),
    'utf8',
  );
}

function renderStage3dAuditMarkdown(
  report: Stage3dAuditReport,
  referencePlan?: TetaReadOnlyQueryPlan | null,
): string {
  return `# AIA Business Semantics — Stage 3D

Generated: ${report.generatedAt}

## Summary

| Field | Value |
|------|-------|
| Contract | \`${report.contractVersion}\` |
| Ontology | \`${report.ontologyVersion}\` |
| Bindings | \`${report.bindingsVersion}\` |
| Identity | \`${report.identityVersion}\` |
| Graph hash | \`${report.graphSourceHash}\` |
| Validation OK | ${report.validationOk} |
| Reference BHP planStatus | \`${report.referenceBhpPlanStatus}\` |
| Approved bindings | ${report.approvedBindings} |
| Strict errors | ${report.strictErrors.length} |

## Value paths

- **position_name:** ${(report.positionNamePath ?? []).join(' → ') || '(none)'}
- **examination_type_name:** ${(report.examinationTypeNamePath ?? []).join(' → ') || '(none)'}
- **organizational_unit_name (authoritative):** ${(report.organizationalUnitNamePath ?? []).join(' → ') || '(none)'}

## Temporal mechanisms

### Active employee

${report.activeEmployeeMechanism ?? '(none)'}

### Current position

${report.currentPositionTemporalMechanism ?? '(none)'}

## Patch metrics (current position / OU)

| Metric | Value |
|--------|-------|
| currentPositionTemporalBindingsRequired | ${report.currentPositionTemporalBindingsRequired} |
| currentPositionTemporalBindingsApproved | ${report.currentPositionTemporalBindingsApproved} |
| currentPositionFiltersResolved | ${report.currentPositionFiltersResolved} |
| currentPositionFiltersMissing | ${report.currentPositionFiltersMissing} |
| historicalPositionLeakRisk | ${report.historicalPositionLeakRisk} |
| competingOrganizationalUnitPaths | ${report.competingOrganizationalUnitPaths} |
| projectionPathsWithMultipleAuthoritativeSources | ${report.projectionPathsWithMultipleAuthoritativeSources} |

## Live filters (Reference A)

${
  ((report.referenceResults.A as { filters?: Array<{ role: string; status: string }> })?.filters ?? [])
    .map((f) => `- \`${f.role}\` (${f.status})`)
    .join('\n') || '_none_'
}

## Side-effect counters

| Counter | Value |
|---------|-------|
| finalSqlGenerated | ${report.finalSqlGenerated} |
| sqlExecuted | ${report.sqlExecuted} |
| oracleConnections | ${report.oracleConnections} |
| qdrantCalls | ${report.qdrantCalls} |
| llmCalls | ${report.llmCalls} |
| agentCalls | ${report.agentCalls} |

## Strict errors

${
  report.strictErrors.length
    ? report.strictErrors.map((e) => `- ${e}`).join('\n')
    : '_none_'
}

## Reference plan (live)

\`\`\`json
${JSON.stringify(
  {
    planStatus: referencePlan?.planStatus ?? report.referenceBhpPlanStatus,
    sources: referencePlan?.sources?.map((s) => s.sourceRole) ?? [],
    projections: referencePlan?.projections?.map((p) => p.businessRole) ?? [],
    filters: referencePlan?.filters?.map((f) => f.filterRole) ??
      ((report.referenceResults.A as { filters?: Array<{ role: string }> })?.filters ?? []).map(
        (f) => f.role,
      ),
    joins: referencePlan?.joins?.map((j) => `${j.leftSourceRole}→${j.rightSourceRole}`) ?? [],
  },
  null,
  2,
)}
\`\`\`

## Notes

- Stage 3D binds business roles to canonical graph node IDs (JSON registry only).
- Stage 3C contract versions / safety policy / plan status enums are unchanged.
- Current position requires \`current_position_on_oracle_sysdate\` (historical leak risk otherwise).
- \`organizational_unit_name\` authoritative path starts at \`current_position\`; employee→OU is supporting/not used for projection.
- No SQL generation, Oracle data reads, Qdrant, embeddings, LLM, or agent calls.
`;
}
