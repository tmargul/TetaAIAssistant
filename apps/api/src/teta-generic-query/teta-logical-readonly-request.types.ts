/**
 * Stage 3K.1 — Generic readonly query intent & logical request types.
 * Ends BEFORE Stage 3C plan / SQL / Oracle.
 */

import type { QueryCapabilityId } from './teta-query-capability.types';

export const STAGE3K1_CONTRACT_VERSION = 'teta-logical-readonly-request-v1';
export const STAGE3K1_INTENT = 'generic_readonly_query' as const;
export const STAGE3K1_LANGUAGE_CONFIG_VERSION = 'teta-aia-generic-query-language-pl-v1';
export const STAGE3K1_ROUTING_CONFIG_VERSION = 'teta-aia-generic-query-routing-v1';
export const STAGE3K1_CAPABILITIES_CONFIG_VERSION = 'teta-aia-generic-query-capabilities-v1';
export const STAGE3K1_LEGACY_FENCE_POLICY_VERSION = 'teta-aia-legacy-llm-sql-fence-v1';
export const STAGE3K1_ANALYSIS_CONTRACT_VERSION = 'teta-generic-query-analysis-v1';

export type GenericReadonlyIntent = typeof STAGE3K1_INTENT;

export type ConceptResolutionStatus = 'resolved' | 'ambiguous' | 'unresolved';

export type InterpretationStatus =
  | 'resolved'
  | 'needs_clarification'
  | 'unresolved'
  | 'rejected';

export type CapabilitySupportLevel =
  | 'supported'
  | 'partially_supported'
  | 'unsupported'
  | 'not_applicable';

/**
 * Stage 3K.1 ends before Stage 3C / business auth / orchestrator rewire.
 * capabilityStatus=supported must NOT be read as execution readiness.
 */
export type ExecutionEligibility =
  | 'not_evaluated'
  | 'blocked'
  | 'eligible'
  | 'not_applicable';

/** @deprecated Prefer interpretationStatus + capabilityStatus. Kept as derived convenience. */
export type LogicalRequestStatus =
  | 'resolved'
  | 'needs_clarification'
  | 'unsupported'
  | 'unresolved';

export type LogicalAnswerShape =
  | 'single_value'
  | 'single_record'
  | 'list'
  | 'table'
  | 'aggregate'
  | 'unknown';

export type TemporalScopeKind = 'current' | 'history' | 'as_of' | 'date_range' | 'unspecified';

export type FieldRole = 'projection' | 'grouping' | 'ordering';

export type RoutingWinner =
  | 'dedicated_deterministic_engine'
  | 'payroll_engine'
  | 'application_help'
  | 'runtime_knowledge_3j2f'
  | 'generic_readonly_query'
  | 'clarification'
  | 'unsupported'
  | 'rejected'
  | 'unknown';

export type AnalysisKind = 'delegated' | 'rejected' | 'generic';

export type LogicalConceptRef = {
  /** Canonical business concept only — never a pseudo ambiguity key. */
  conceptKey: string | null;
  /** Surface / resolution meaning (may be non-canonical). */
  surfaceMeaningKey: string | null;
  surfaceText: string;
  resolutionStatus: ConceptResolutionStatus;
};

export type LogicalRequestedField = LogicalConceptRef & {
  role: FieldRole;
};

export type LogicalFilterOperator =
  | 'equals'
  | 'comparison'
  | 'date_range'
  | 'is_null'
  | 'is_not_null'
  | 'like'
  | 'in'
  | 'matches_identity'
  | 'existence_absent'
  | 'unknown';

export type LogicalFilterValue =
  | { kind: 'literal'; text: string }
  | { kind: 'identity'; rawText: string }
  | { kind: 'date'; isoDate: string }
  | { kind: 'date_range'; from?: string; to?: string }
  | { kind: 'number'; value: number }
  | { kind: 'empty' };

export type LogicalFilter = {
  filterId: string;
  conceptKey: string | null;
  surfaceMeaningKey: string | null;
  surfaceText: string;
  operator: LogicalFilterOperator;
  value: LogicalFilterValue;
  resolutionStatus: ConceptResolutionStatus;
  temporalMeaning: TemporalScopeKind | null;
};

export type LogicalRelation = {
  conceptKey: string | null;
  surfaceMeaningKey: string | null;
  surfaceText: string;
  resolutionStatus: ConceptResolutionStatus;
};

export type LogicalTemporalScope = {
  kind: TemporalScopeKind;
  value: { asOf?: string; from?: string; to?: string } | null;
  resolutionStatus: ConceptResolutionStatus | 'resolved';
  surfaceText: string | null;
};

export type LogicalAggregation = {
  requested: boolean;
  operations: Array<'count' | 'sum' | 'avg' | 'min' | 'max'>;
  groupBy: LogicalRequestedField[];
};

export type LogicalOrdering = {
  conceptKey: string | null;
  surfaceMeaningKey: string | null;
  surfaceText: string;
  direction: 'ascending' | 'descending' | 'unspecified';
  resolutionStatus: ConceptResolutionStatus;
};

export type ClarificationBindingStatus = 'bound' | 'unbound' | 'known_config' | 'known_gap';

export type LogicalClarificationCandidate = {
  candidateId: string;
  conceptKey: string | null;
  label: string;
  meaning: string;
  reason: string;
  evidenceStatus: 'known_in_config' | 'known_gap' | 'unresolved_alternative' | 'unbound_meaning';
  bindingStatus: ClarificationBindingStatus;
  selectionRequired: true;
  selectionDoesNotAuthorizeExecution: boolean;
};

export type LogicalClarification = {
  clarificationId: string;
  subject: string;
  question: string;
  candidates: LogicalClarificationCandidate[];
};

export type RoutingDecision = {
  winner: RoutingWinner;
  precedenceApplied: RoutingWinner[];
  reason: string;
  matchedCapability?: string | null;
  genericReadonlyCandidate: boolean;
  dedicatedRouteWins: boolean;
  payrollRouteWins: boolean;
  helpRouteWins: boolean;
  knowledgeRouteWins: boolean;
  productionOrchestratorRewired: false;
};

export type LegacyLlmSqlFallbackPolicy = {
  policyVersion: typeof STAGE3K1_LEGACY_FENCE_POLICY_VERSION;
  allowedForGenericReadonly: false;
  migrationStatus: 'fenced_not_removed';
  fallbackAfterGenericBlocked: false;
  fallbackAfterGenericUnsupported: false;
  fallbackAfterGenericAmbiguous: false;
};

export type EvidenceHint = {
  kind: 'lexicon' | 'business_language' | 'pattern' | 'routing' | 'capability' | 'adapter';
  ref: string;
  note: string;
};

export type LogicalReadonlyRequest = {
  contractVersion: typeof STAGE3K1_CONTRACT_VERSION;
  requestId: string;
  intent: GenericReadonlyIntent;
  rootEntity: LogicalConceptRef;
  requestedFields: LogicalRequestedField[];
  filters: LogicalFilter[];
  relations: LogicalRelation[];
  temporalScope: LogicalTemporalScope;
  aggregation: LogicalAggregation;
  ordering: LogicalOrdering[];
  limit: number | null;
  answerShape: LogicalAnswerShape;
  interpretationStatus: InterpretationStatus;
  capabilityStatus: CapabilitySupportLevel;
  /** Derived convenience — see deriveLegacyStatus. */
  status: LogicalRequestStatus;
  clarifications: LogicalClarification[];
  unsupportedCapabilities: QueryCapabilityId[];
  recognizedCapabilities: QueryCapabilityId[];
  routingDecision: RoutingDecision;
  evidenceHints: EvidenceHint[];
  legacyLlmSqlFallbackPolicy: LegacyLlmSqlFallbackPolicy;
  inputFingerprintSha256: string;
  semanticFingerprintSha256: string;
  logicalRequestFingerprintSha256: string;
};

export type GenericQueryAnalysisResult = {
  contractVersion: typeof STAGE3K1_ANALYSIS_CONTRACT_VERSION;
  analysisKind: AnalysisKind;
  requestId: string;
  inputFingerprintSha256: string;
  queryNormalized: string;
  routingDecision: RoutingDecision;
  interpretationStatus: InterpretationStatus | 'delegated';
  capabilityStatus: CapabilitySupportLevel;
  /**
   * Offline fence: Stage 3K.1 never marks generic requests eligible for execution.
   * capabilityStatus=supported ≠ execute.
   */
  executionEligibility: ExecutionEligibility;
  logicalRequest: LogicalReadonlyRequest | null;
  mutationRejected: boolean;
  rawSqlRejected: boolean;
  promptInjectionRejected: boolean;
  legacyLlmSqlFallbackPolicy: LegacyLlmSqlFallbackPolicy;
};

export type ClassifyResult = {
  queryNormalized: string;
  routing: RoutingDecision;
  intentCandidate: GenericReadonlyIntent | null;
  markers: string[];
};

export const FORBIDDEN_LOGICAL_REQUEST_KEYS = [
  'sql',
  'sqlText',
  'select',
  'from',
  'whereSql',
  'joinSql',
  'procedureName',
  'oracleObjectName',
  'rawOracleColumn',
] as const;

export function deriveLegacyStatus(
  interpretation: InterpretationStatus,
  capability: CapabilitySupportLevel,
): LogicalRequestStatus {
  if (interpretation === 'rejected') return 'unsupported';
  if (interpretation === 'needs_clarification') return 'needs_clarification';
  if (interpretation === 'unresolved') return 'unresolved';
  if (capability === 'unsupported' || capability === 'partially_supported') return 'unsupported';
  return 'resolved';
}
