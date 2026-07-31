/**
 * Stage 3K.2A — Generic semantic binding contract types.
 * Ends BEFORE Stage 3C plan / SQL / Oracle execution.
 */
import type { SemanticBindingStatus } from '../teta-business-semantics/teta-business-semantics.types';

export const STAGE3K2A_CONTRACT_VERSION = 'teta-aia-generic-semantic-binding-v1';
export const STAGE3K2A_REUSE_POLICY_VERSION = 'teta-aia-generic-semantic-reuse-policy-v1';
export const STAGE3K2A_CAPABILITIES_VERSION = 'teta-aia-generic-semantic-binding-capabilities-v1';

export type { SemanticBindingStatus };

export type ApprovalReuseStatus =
  | 'approved_exact_scope'
  | 'approved_reusable_role'
  | 'approved_scope_restricted'
  | 'approved_scope_mismatch'
  | 'not_approved';

export type SemanticEvidenceStatus = 'proven' | 'partial' | 'missing' | 'conflicting';

export type SemanticBindingResultStatus =
  | 'semantically_bound'
  | 'partially_bound'
  | 'needs_clarification'
  | 'unresolved'
  | 'delegated'
  | 'rejected';

export type ExecutionEligibility =
  | 'not_evaluated'
  | 'blocked'
  | 'eligible'
  | 'not_applicable';

/** Planning fence — distinct from executionEligibility. */
export type PlanningEligibility =
  | 'eligible'
  | 'blocked_scope'
  | 'blocked_unapproved'
  | 'blocked_unresolved'
  | 'blocked_ambiguous'
  | 'blocked_stale'
  | 'blocked_invalid'
  | 'not_applicable';

/**
 * Planner handoff readiness — distinct from resultStatus (semantic knowledge)
 * and from executionEligibility.
 *
 * `partial` is reserved for future optional-gap cases (all required planning-eligible,
 * only non-critical/optional elements unresolved). Under current 3K.2A production
 * deny policy it does not occur for K fixtures.
 */
export type PlanningReadiness = 'ready' | 'partial' | 'blocked' | 'not_applicable';

export type ValueKind =
  | 'business_value'
  | 'foreign_key_identity'
  | 'display_business_value';

export type RelationUsageKind =
  | 'row_producing'
  | 'filter_only'
  | 'lookup_display'
  | 'temporal_qualifier'
  | 'supporting_only';

export type DependencyVector = {
  graphSourceHash: string;
  ontologyVersion: string;
  semanticBindingsVersion: string;
  businessLanguageVersion: string;
  lexiconVersion: string | null;
  stage3k1ContractVersion: string;
  stage3k2BindingContractVersion: string;
  semanticReusePolicyVersion: string;
};

export type TetaSemanticElementBinding = {
  logicalElementId: string;
  surfaceText: string;
  surfaceMeaningKey: string | null;
  requestedConceptKey: string | null;
  resolvedBusinessConceptKey: string | null;
  resolvedRoleKey: string | null;
  bindingStatus: SemanticBindingStatus;
  evidenceStatus: SemanticEvidenceStatus;
  approvalReuseStatus: ApprovalReuseStatus;
  planningEligibility: PlanningEligibility;
  selectionRequired: boolean;
  applicability: {
    subjectScope: string | null;
    genericReuseAllowed: boolean;
  };
  temporalSemantics: string | null;
  /** Logical target this temporal (or binding) is scoped to. */
  temporalLogicalTarget: string | null;
  relationUsage: RelationUsageKind | null;
  valueKind: ValueKind | null;
  /** Internal provenance only — stripped by toRuntimeSafeSemanticDto. */
  approvedBindingRefs: string[];
  /** Opt-out of graphSourceHash staleness; must be policy-validated. */
  dependencyIndependent: boolean;
  requiredAuthorizationScopes: string[];
  requiredDataDomains: string[];
  warnings: string[];
};

export type TetaSemanticClarificationCandidate = {
  candidateId: string;
  businessConceptKey: string | null;
  roleKey: string | null;
  label: string;
  whyPlausible: string;
  evidenceStatus: SemanticEvidenceStatus;
  approvalReuseStatus: ApprovalReuseStatus;
  applicability: string;
  temporalMeaning: string | null;
  selectionRequired: true;
  selectionDoesNotAuthorizeExecution: true;
};

export type TetaSemanticClarification = {
  clarificationId: string;
  subject: string;
  question: string;
  candidates: TetaSemanticClarificationCandidate[];
  /** Present only for synthetic fixture policies (e.g. S4). */
  fixturePolicyOverride?: {
    id: string;
    productionPolicy: false;
  };
};

/** Opaque diagnostic entry — audit/evidence only. */
export type TetaSemanticDiagnosticCandidate = {
  diagnosticId: string;
  status: 'discovered';
  opaque: true;
  retainedForDiagnostics: true;
  exposedInRuntime: false;
  usedForPlanning: false;
};

/** Audit-only — never embed in runtime/client DTO. */
export type TetaSemanticEvidenceTrace = {
  contractVersion: typeof STAGE3K2A_CONTRACT_VERSION;
  graphSourceHash: string | null;
  expectedGraphSourceHash: string | null;
  stage3dBindingRefs: string[];
  graphNodeIds: string[];
  graphEdgeIds: string[];
  graphPathIds: string[];
  conflicts: string[];
  validationReasons: string[];
  diagnosticCandidates: TetaSemanticDiagnosticCandidate[];
};

export type TetaGenericSemanticBindingRequest = {
  contractVersion: typeof STAGE3K2A_CONTRACT_VERSION;
  sourceAnalysisFingerprint: string;
  policyVersion: string;
  dependencyVector: DependencyVector;
};

/**
 * Internal semantic result (server-side). May include approvedBindingRefs.
 * Use toRuntimeSafeSemanticDto() for client-safe projection.
 */
export type TetaGenericSemanticBindingResult = {
  contractVersion: typeof STAGE3K2A_CONTRACT_VERSION;
  sourceAnalysisFingerprint: string;
  resultStatus: SemanticBindingResultStatus;
  rootBinding: TetaSemanticElementBinding | null;
  fieldBindings: TetaSemanticElementBinding[];
  filterBindings: TetaSemanticElementBinding[];
  relationBindings: TetaSemanticElementBinding[];
  temporalBinding: TetaSemanticElementBinding | null;
  aggregationTargets: TetaSemanticElementBinding[];
  orderingTarget: TetaSemanticElementBinding | null;
  resultGrain: string | null;
  clarifications: TetaSemanticClarification[];
  warnings: string[];
  executionEligibility: ExecutionEligibility;
  planningReadiness: PlanningReadiness;
  dependencyVector: DependencyVector;
  semanticBindingInputFingerprint: string;
  semanticBindingResultFingerprint: string;
};

/** Client/runtime-safe element — no internal provenance IDs. */
export type RuntimeSafeSemanticElementBinding = Omit<
  TetaSemanticElementBinding,
  'approvedBindingRefs' | 'dependencyIndependent'
>;

export type RuntimeSafeSemanticBindingResult = {
  contractVersion: typeof STAGE3K2A_CONTRACT_VERSION;
  sourceAnalysisFingerprint: string;
  resultStatus: SemanticBindingResultStatus;
  rootBinding: RuntimeSafeSemanticElementBinding | null;
  fieldBindings: RuntimeSafeSemanticElementBinding[];
  filterBindings: RuntimeSafeSemanticElementBinding[];
  relationBindings: RuntimeSafeSemanticElementBinding[];
  temporalBinding: RuntimeSafeSemanticElementBinding | null;
  aggregationTargets: RuntimeSafeSemanticElementBinding[];
  orderingTarget: RuntimeSafeSemanticElementBinding | null;
  resultGrain: string | null;
  clarifications: TetaSemanticClarification[];
  warnings: string[];
  executionEligibility: ExecutionEligibility;
  planningReadiness: PlanningReadiness;
  dependencyVector: DependencyVector;
  semanticBindingInputFingerprint: string;
  semanticBindingResultFingerprint: string;
};

export type SemanticReusePolicyFile = {
  version: string;
  defaultReuse: 'deny' | 'allow_listed';
  restrictedSubjects: string[];
  reusableRoles: Array<{
    roleKey: string;
    reuseKind: 'approved_reusable_role' | 'approved_exact_scope';
    allowedSubjects?: string[];
  }>;
  notes?: string[];
  /** Explicit non-production fixture override marker. */
  fixturePolicyOverride?: {
    id: string;
    productionPolicy: false;
  };
};

export type SemanticBindingCapabilitiesFile = {
  version: string;
  diagnosticRoles: string[];
  missingSemantics: string[];
  planningReadyRequires: string[];
  notes?: string[];
};

export type GraphEvidenceValidator = {
  graphSourceHash: string | null;
  nodeExists: (nodeId: string) => boolean;
};
