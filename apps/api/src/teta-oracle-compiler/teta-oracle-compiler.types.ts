/**
 * Stage 3E — deterministic Oracle SELECT compiler contracts.
 *
 * Consumes a Stage 3C `TetaReadOnlyQueryPlan` (planStatus=ready_for_compilation) and produces
 * a single read-only Oracle 19c SELECT statement. Never connects to Oracle and never executes SQL.
 */
import type {
  QueryFilter,
  TetaReadOnlyQueryPlan,
} from '../teta-query-planner/teta-query-plan.types';

export const STAGE3E_CONTRACT_VERSION = 'teta-aia-oracle-select-v1';
export const STAGE3E_DIALECT = 'oracle19c';
export const STAGE3E_SOURCE_PLAN_CONTRACT_VERSION = 'teta-aia-readonly-query-plan-v1';

/** Row-producing aliases are S01, S02, … in `sources[]` order. */
export const STAGE3E_SOURCE_ALIAS_PREFIX = 'S';
/** Filter-only aliases are E01, E02, … and may appear only inside an EXISTS subquery. */
export const STAGE3E_EXISTENCE_ALIAS_PREFIX = 'E';
/** Bind placeholders are :P001, :P002, … in order of first appearance. */
export const STAGE3E_BIND_PREFIX = 'P';

export const STAGE3E_MAX_ROWS = 500;
export const STAGE3E_MAX_COLUMNS = 20;
export const STAGE3E_MAX_STATEMENT_TIMEOUT_MS = 30000;

/** Owners that may appear in compiled SQL. Everything else is rejected as unsafe. */
export const STAGE3E_ALLOWED_OWNERS = ['TETA_ADMIN', 'TETA_ADMIN_P'] as const;
/** Owners that must never reach a compiled statement. */
export const STAGE3E_FORBIDDEN_OWNERS = ['HRM', 'UNKNOWN'] as const;

export type OracleCompileStatus =
  | 'compiled'
  | 'rejected_not_ready'
  | 'rejected_invalid_plan'
  | 'rejected_unsafe'
  | 'rejected_unsupported';

export type OracleCompileRejection = {
  code: string;
  message: string;
};

export type OracleCompileWarning = {
  code: string;
  message: string;
};

/**
 * Stage 3C cannot express user-supplied literals. Stage 3E accepts this extension shape so bind
 * planning can be exercised without touching the Stage 3C contract; Stage 3C never emits it.
 */
export type UserLiteralFilter = {
  filterRole: string;
  type: 'user_literal_equals';
  status: 'resolved' | 'missing' | 'incomplete';
  columnOracleNodeId: string | null;
  sourceRole?: string | null;
  literal: { kind: 'string' | 'number' | 'date'; value: string | number };
  provenanceNodeIds: string[];
  provenanceEdgeIds: string[];
};

export type CompilableQueryFilter = QueryFilter | UserLiteralFilter;

export type CompilableQueryPlan = Omit<TetaReadOnlyQueryPlan, 'filters'> & {
  filters: CompilableQueryFilter[];
};

export type TetaOracleSelectCompilationRequest = {
  queryPlan: CompilableQueryPlan;
  expectedIntent: string;
  expectedSubject: string;
  dialect?: string;
};

/**
 * `row_source` entries appear in FROM/JOIN and may be projected. `filter_only` entries exist only
 * as the FROM of a correlated EXISTS subquery.
 */
export type CompiledSourceUsage = 'row_source' | 'filter_only';

export type CompiledSourceAlias = {
  alias: string;
  ordinal: number;
  usage: CompiledSourceUsage;
  sourceRole: string;
  accessObjectNodeId: string;
  accessOwner: string;
  accessObjectType: string;
  accessObjectName: string;
  qualifiedName: string;
  logicalObjectNodeId: string | null;
  logicalOwner: string | null;
  logicalObjectName: string | null;
  enrichment: boolean;
};

export type AccessColumnMappingKind = 'identical' | 'access_owner_remap';

export type CompiledAccessColumn = {
  logicalColumnNodeId: string;
  accessColumnNodeId: string;
  sourceRole: string;
  alias: string;
  owner: string;
  objectName: string;
  columnName: string;
  qualifiedExpression: string;
  mappingKind: AccessColumnMappingKind;
  evidenceEdgeIds: string[];
};

export type CompiledProjection = {
  ordinal: number;
  businessRole: string;
  resultAlias: string;
  expression: string;
  sourceRole: string;
  logicalColumnNodeId: string;
  accessColumnNodeId: string;
  displayLabel: string | null;
};

export type CompiledJoinStep = {
  ordinal: number;
  joinId: string;
  joinKeyword: 'INNER JOIN' | 'LEFT JOIN';
  joinType: 'inner' | 'left';
  joinedSourceRole: string;
  joinedAlias: string;
  joinedQualifiedName: string;
  anchorSourceRole: string;
  anchorAlias: string;
  onConditions: string[];
  enrichment: boolean;
};

export type CompiledJoinTree = {
  rootSourceRole: string;
  rootAlias: string;
  rootQualifiedName: string;
  steps: CompiledJoinStep[];
  edgeCount: number;
  sourceCount: number;
  acyclic: boolean;
  connected: boolean;
};

export type CompiledPredicatePlacement = 'where' | 'join_on';

export type CompiledPredicate = {
  ordinal: number;
  filterRole: string;
  filterType: string;
  kind: string;
  sql: string;
  /** Set when the predicate renders across several lines (correlated EXISTS). */
  sqlLines?: string[];
  placement: CompiledPredicatePlacement;
  targetJoinId: string | null;
  accessColumnNodeIds: string[];
  bindNames: string[];
};

/**
 * A qualifying condition compiled as `EXISTS (SELECT 1 FROM … WHERE correlation AND temporal)`.
 * Using EXISTS instead of a join is what keeps the report grain intact when the qualifying source
 * can match several rows per report row.
 */
export type CompiledExistenceFilter = {
  ordinal: number;
  filterRole: string;
  relationRole: string;
  temporalFilterRole: string | null;
  correlatedSourceRole: string;
  correlatedAlias: string;
  filterOnlySourceRole: string;
  existenceAlias: string;
  existenceQualifiedName: string;
  correlationConditions: string[];
  temporalConditions: string[];
  preservesReportGrain: true;
  sql: string;
  sqlLines: string[];
  accessColumnNodeIds: string[];
};

export type CompiledOrdering = {
  ordinal: number;
  orderRole: string;
  businessRole: string;
  expression: string;
  direction: 'ASC' | 'DESC';
  accessColumnNodeId: string;
};

export type CompiledBind = {
  ordinal: number;
  name: string;
  placeholder: string;
  filterRole: string;
  valueKind: 'user_literal' | 'report_period_parameter';
  oracleType: 'string' | 'number' | 'date';
  semanticType?: 'positive_integer_days' | 'local_date' | 'user_literal';
  sourceParameterId?:
    | 'report_period_days'
    | 'report_period_start_date'
    | 'report_period_end_date'
    | null;
};

export type CompiledSqlValidationCheck =
  | 'starts_with_select'
  | 'single_statement'
  | 'no_semicolon'
  | 'no_sql_comments'
  | 'no_optimizer_hints'
  | 'no_select_star'
  | 'no_dml_or_ddl'
  | 'no_plsql_block'
  | 'no_for_update'
  | 'no_with_clause'
  | 'no_db_link'
  | 'no_set_operator'
  | 'no_into_clause'
  | 'all_columns_qualified'
  | 'no_unbound_user_literals'
  | 'no_trailing_semicolon'
  | 'lf_newlines_only'
  | 'no_trailing_whitespace'
  | 'row_limit_present'
  | 'no_distinct'
  | 'controlled_exists_only'
  | 'no_in_subquery'
  | 'filter_only_aliases_confined_to_exists';

export type CompiledSqlValidation = {
  ok: boolean;
  checks: Record<CompiledSqlValidationCheck, boolean>;
  violations: Array<{ code: string; message: string }>;
};

export type Stage3eAuditCounters = {
  statementsCompiled: number;
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
  selectStar: number;
  unqualifiedColumns: number;
  sqlComments: number;
  optimizerHints: number;
  semicolons: number;
  dmlStatements: number;
  plsqlBlocks: number;
  dbLinks: number;
  forUpdateClauses: number;
  withClauses: number;
  multipleStatements: number;
  unboundUserLiterals: number;
  cartesianJoins: number;
  crossJoins: number;
  selfJoins: number;
  cyclicJoinGraphs: number;
  invalidIdentifiers: number;
  missingAccessColumns: number;
  forbiddenOwnerReferences: number;
  logicalObjectsUsedInSql: number;
  /** 1 when the source plan declares the report grain, 0 otherwise. */
  reportGrainDefined: number;
  rowProducingSources: number;
  filterOnlySources: number;
  existenceFiltersCompiled: number;
  /** Must stay 0: a filter-only source in the main tree could multiply report rows. */
  filterOnlySourcesInMainJoinTree: number;
  filterOnlyAliasesOutsideExists: number;
  filterOnlySourcesProjected: number;
  filterOnlySourcesUsedForOrdering: number;
  unprovenFilterJoinCardinality: number;
  possibleReportRowMultiplication: number;
  distinctAddedToHideMultiplicity: number;
  arbitrarySubqueriesDetected: number;
  uncorrelatedExistsDetected: number;
  existsWithoutSemanticEvidence: number;
  uncontrolledSubqueries: number;
  inSubqueries: number;
  distinctClauses: number;
};

export type TetaCompiledOracleSelect = {
  contractVersion: typeof STAGE3E_CONTRACT_VERSION;
  compileStatus: OracleCompileStatus;
  dialect: typeof STAGE3E_DIALECT;
  sourcePlanContractVersion: string;
  intent: string;
  subject: string | null;
  sqlText: string | null;
  sqlSha256: string | null;
  binds: CompiledBind[];
  sources: CompiledSourceAlias[];
  accessColumns: CompiledAccessColumn[];
  projections: CompiledProjection[];
  joinTree: CompiledJoinTree | null;
  predicates: CompiledPredicate[];
  existenceFilters: CompiledExistenceFilter[];
  ordering: CompiledOrdering[];
  reportGrain: string | null;
  limits: {
    maxRows: number;
    maxColumns: number;
    statementTimeoutMs: number;
  };
  validation: CompiledSqlValidation;
  warnings: OracleCompileWarning[];
  rejection: OracleCompileRejection | null;
  evidence: {
    graphSourceHash: string | null;
    nodeIds: string[];
    edgeIds: string[];
  };
  executionPolicy: {
    sqlExecutionAllowed: false;
    oracleConnectionAllowed: false;
    oracleWriteAllowed: false;
    fileReadAllowed: false;
    reason: string;
  };
  audit: {
    deterministic: true;
    compilerDurationMs: number;
    generatedAt?: string;
    compilerContractVersion: string;
    sourcePlanContractVersion: string;
    semanticBindingsVersion: string | null;
    graphSourceHash: string | null;
    graphIndexSchemaVersion: string | null;
    sourceCount: number;
    joinCount: number;
    projectionCount: number;
    predicateCount: number;
    existenceFilterCount: number;
    orderingCount: number;
    bindCount: number;
    accessColumnRemaps: number;
  } & Stage3eAuditCounters;
};

export type Stage3eReferenceResult = {
  reference: string;
  description: string;
  compileStatus: OracleCompileStatus;
  rejectionCode: string | null;
  sqlSha256: string | null;
  validationOk: boolean;
  notes: string[];
};

export type Stage3eAuditReport = {
  contractVersion: string;
  dialect: string;
  sourcePlanContractVersion: string;
  semanticBindingsVersion: string | null;
  graphSourceHash: string | null;
  graphIndexSchemaVersion: string | null;
  liveSourcePlanStatus: string;
  liveCompileStatus: OracleCompileStatus;
  liveSqlSha256: string | null;
  liveSqlLineCount: number;
  liveSourceCount: number;
  liveJoinCount: number;
  liveProjectionCount: number;
  livePredicateCount: number;
  liveOrderingCount: number;
  liveBindCount: number;
  liveAccessColumnRemaps: number;
  liveValidationOk: boolean;
  liveReportGrain: string | null;
  liveRowProducingSources: number;
  liveFilterOnlySources: number;
  liveExistenceFilterCount: number;
  referencesTested: number;
  referencesPassed: number;
  referenceResults: Stage3eReferenceResult[];
  counters: Stage3eAuditCounters;
  deterministicCheckOk: boolean;
  /** Artifacts whose recorded SHA-256 differs from a fresh hash of the compiled statement. */
  sqlArtifactHashMismatches: number;
  /** Artifacts whose stored SQL text differs byte-for-byte from the compiled statement. */
  sqlArtifactTextMismatches: number;
  sessionContextHashMismatch: number;
  artifactHashChecks: Array<{
    artifact: string;
    hashOk: boolean;
    textOk: boolean | null;
    detail: string;
  }>;
  typecheckErrors: number;
  strictErrors: string[];
  generatedAt: string;
};
