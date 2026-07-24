/**
 * Stage 3C — typed read-only query plan contracts.
 * Does not generate or execute SQL.
 */

export const STAGE3C_CONTRACT_VERSION = 'teta-aia-readonly-query-plan-v1';
export const STAGE3C_REPORT_TEMPLATE_VERSION = 'teta-aia-report-query-templates-v1';
export const STAGE3C_SAFETY_POLICY_VERSION = 'teta-aia-query-safety-policy-v1';

export const STAGE3C_SUPPORTED_INTENT = 'build_employee_report' as const;
export const STAGE3C_SUPPORTED_SUBJECT = 'occupational_health_examinations' as const;

export type QueryPlanStatus =
  | 'ready_for_compilation'
  | 'needs_graph_resolution'
  | 'needs_selection'
  | 'needs_user_clarification'
  | 'unsupported'
  | 'invalid';

export type SourceResolutionStatus = 'resolved' | 'ambiguous' | 'missing' | 'conflicting';
export type ColumnResolutionStatus = 'resolved' | 'ambiguous' | 'missing' | 'conflicting';

export type OracleObjectType = 'TABLE' | 'VIEW' | 'SYNONYM' | string;

export type QueryLogicalObject = {
  nodeId: string;
  owner: string;
  objectType: OracleObjectType;
  objectName: string;
  canonical: boolean;
};

export type QueryAccessObject = {
  nodeId: string;
  owner: string;
  objectType: OracleObjectType;
  objectName: string;
};

export type QuerySource = {
  sourceRole: string;
  status: SourceResolutionStatus;
  logicalObject: QueryLogicalObject | null;
  accessObject: QueryAccessObject | null;
  selectionReason: string;
  candidateNodeIds: string[];
  provenanceNodeIds: string[];
  provenanceEdgeIds: string[];
  pathNodeIds: string[];
  enrichment?: boolean;
};

export type QueryColumnRef = {
  businessRole: string;
  status: ColumnResolutionStatus;
  sourceRole: string;
  datasetColumnNodeId: string | null;
  oracleColumnNodeId: string | null;
  owner: string | null;
  objectName: string | null;
  columnName: string | null;
  displayLabel: string | null;
  provenanceNodeIds: string[];
  provenanceEdgeIds: string[];
  pathNodeIds: string[];
  candidateNodeIds?: string[];
};

export type QueryJoinPredicate = {
  leftOracleColumnNodeId: string;
  operator: 'equals';
  rightOracleColumnNodeId: string;
};

export type QueryJoinEvidenceType =
  | 'foreign_key'
  | 'reconstructed_sql_join'
  | 'confirmed_gateway_join'
  | 'canonical_graph_path';

export type QueryJoin = {
  joinId: string;
  leftSourceRole: string;
  rightSourceRole: string;
  joinType: 'inner' | 'left';
  predicates: QueryJoinPredicate[];
  evidenceType: QueryJoinEvidenceType | null;
  provenanceEdgeIds: string[];
  pathNodeIds: string[];
  status: 'resolved' | 'missing' | 'unproven';
  required: boolean;
  enrichment?: boolean;
};

export type DateBoundary = {
  clock: 'oracle_sysdate';
  transform: 'month_start' | 'next_month_start' | 'identity';
  inclusive: boolean;
};

export type QueryFilter =
  | {
      filterRole: string;
      type: 'half_open_date_interval';
      status: 'resolved' | 'missing' | 'incomplete';
      columnOracleNodeId: string | null;
      columnBusinessRole?: string;
      lowerBoundary: DateBoundary;
      upperBoundary: DateBoundary;
      provenanceNodeIds: string[];
      provenanceEdgeIds: string[];
    }
  | {
      filterRole: string;
      type: 'effective_on_date';
      status: 'resolved' | 'missing' | 'incomplete';
      clock: 'oracle_sysdate';
      resolvedPredicates: Array<{
        kind: string;
        leftOracleColumnNodeId?: string;
        operator?: string;
        right?: DateBoundary | { clock: 'oracle_sysdate'; transform: 'identity'; inclusive: boolean };
        provenanceEdgeIds?: string[];
      }>;
      sourceRole?: string | null;
      missingReason?: string | null;
      provenanceNodeIds: string[];
      provenanceEdgeIds: string[];
    };

export type QueryOrdering = {
  orderRole: string;
  status: 'resolved' | 'missing';
  oracleColumnNodeId: string | null;
  direction: 'ascending' | 'descending';
  businessRole: string;
};

export type QueryUnresolvedSelection = {
  subject: string;
  reason: string;
  candidateNodeIds: string[];
  blocksPlanning: boolean;
};

export type QueryPlanWarning = {
  code: string;
  message: string;
};

export type TetaReadOnlyQueryPlanningRequest = {
  evidencePlan: import('../teta-planner/teta-stage3b.types').TetaEvidencePlan;
  expectedIntent: typeof STAGE3C_SUPPORTED_INTENT | string;
  expectedSubject: typeof STAGE3C_SUPPORTED_SUBJECT | string;
  runtimeAssumptions?: {
    oracleUser?: string;
    authorizationEnforcement?: 'deferred' | string;
    dateClock?: 'oracle_sysdate' | string;
  };
};

export type TetaReadOnlyQueryPlan = {
  contractVersion: typeof STAGE3C_CONTRACT_VERSION;
  planStatus: QueryPlanStatus;
  intent: string;
  subject: string | null;
  sources: QuerySource[];
  joins: QueryJoin[];
  projections: QueryColumnRef[];
  filters: QueryFilter[];
  ordering: QueryOrdering[];
  limits: {
    maxRows: number;
    maxColumns: number;
    statementTimeoutMs: number;
  };
  authorization: {
    status: 'deferred';
    assumedOracleUser: string;
    filtersApplied: false;
    reason: string;
  };
  unresolvedSelections: QueryUnresolvedSelection[];
  warnings: QueryPlanWarning[];
  evidence: {
    graphSourceHash: string | null;
    nodeIds: string[];
    edgeIds: string[];
    paths: unknown[];
    conflicts: unknown[];
  };
  executionPolicy: {
    sqlCompilationAllowed: false;
    sqlExecutionAllowed: false;
    oracleConnectionAllowed: false;
    oracleWriteAllowed: false;
    fileReadAllowed: false;
    reason: string;
  };
  audit: {
    deterministic: true;
    plannerDurationMs: number;
    generatedAt?: string;
    reportTemplateVersion: string;
    safetyPolicyVersion: string;
    stage3bContractVersion: string | null;
    graphIndexSchemaVersion: string | null;
    graphSourceHash: string | null;
    finalSqlGenerated: number;
    sqlExecuted: number;
    oracleConnections: number;
    oracleWrites: number;
    businessDataRowsRead: number;
    xlsxFilesRead: number;
    qdrantCalls: number;
    embeddingCalls: number;
    llmCalls: number;
    agentCalls: number;
    rawSqlFragments: number;
    selectStar: number;
    unboundUserLiterals: number;
    unknownOwnerAutoSelections: number;
    hrmOwnerAutoSelections: number;
    unsupportedOwnerAutoSelections: number;
    baseTableSelectionsWithoutGraphPath: number;
    equalCandidatesAutoSelected: number;
    cartesianJoins: number;
  };
  rejection?: {
    code: string;
    message: string;
  } | null;
};

export type Stage3cAuditReport = {
  contractVersion: string;
  reportTemplateVersion: string;
  safetyPolicyVersion: string;
  stage3bContractVersion: string | null;
  graphIndexSchemaVersion: string | null;
  graphSourceHash: string | null;
  plansTested: number;
  plansReadyForCompilation: number;
  plansNeedsGraphResolution: number;
  plansNeedsSelection: number;
  plansUnsupported: number;
  plansInvalid: number;
  sourceRolesRequired: number;
  sourceRolesResolved: number;
  sourceRolesAmbiguous: number;
  sourceRolesMissing: number;
  projectionsRequired: number;
  projectionsResolved: number;
  projectionsAmbiguous: number;
  projectionsMissing: number;
  joinsRequired: number;
  joinsResolved: number;
  joinsMissing: number;
  unprovenJoinPredicates: number;
  cartesianJoins: number;
  disconnectedSourceGraphs: number;
  filtersRequired: number;
  filtersResolved: number;
  filtersMissing: number;
  filtersWithoutColumnEvidence: number;
  unknownOwnerAutoSelections: number;
  hrmOwnerAutoSelections: number;
  unsupportedOwnerAutoSelections: number;
  baseTableSelectionsWithoutGraphPath: number;
  equalCandidatesAutoSelected: number;
  selectStarPlans: number;
  plansOverRowLimit: number;
  plansOverColumnLimit: number;
  invalidTimeoutPlans: number;
  rawSqlFragments: number;
  unboundUserLiterals: number;
  finalSqlGenerated: number;
  sqlExecuted: number;
  oracleConnections: number;
  oracleWrites: number;
  businessDataRowsRead: number;
  xlsxFilesRead: number;
  qdrantCalls: number;
  embeddingCalls: number;
  llmCalls: number;
  agentCalls: number;
  averagePlanningTimeMs: number;
  maxPlanningTimeMs: number;
  deterministicCheckOk: boolean;
  strictErrors: string[];
  referenceResults: Record<string, unknown>;
  generatedAt: string;
};
