export const STAGE3J2F_RUNTIME_VERSION = 'stage3j2f-v1' as const;
export const TETA_RUNTIME_KNOWLEDGE_UNIT_CONTRACT_VERSION = 'teta-runtime-knowledge-unit-v1' as const;
export const TETA_RUNTIME_KNOWLEDGE_PACK_CONTRACT_VERSION = 'teta-runtime-knowledge-pack-v1' as const;
export const TETA_GROUNDED_ANSWER_PLAN_CONTRACT_VERSION = 'teta-grounded-answer-plan-v1' as const;
export const TETA_INTERNAL_ANSWER_TRACE_CONTRACT_VERSION = 'teta-internal-answer-trace-v1' as const;
export const TETA_KNOWLEDGE_ACCESS_CONTEXT_CONTRACT_VERSION = 'teta-knowledge-access-context-v1' as const;
export const TETA_VISIBLE_CITATION_CONTRACT_VERSION = 'teta-visible-citation-v1' as const;
export const TETA_CLIENT_ANSWER_PAYLOAD_CONTRACT_VERSION = 'teta-client-answer-payload-v1' as const;

export type SourceOwnership = 'vendor' | 'client' | 'public_authority' | 'unknown';
export type SourceVisibility = 'hidden' | 'cite_exact' | 'cite_when_relevant';
export type CitationPolicy = 'forbidden' | 'required' | 'optional';
export type QuotePolicy = 'forbidden' | 'allowed_if_authorized' | 'allowed_if_current_and_relevant';
export type DistributionClass =
  | 'vendor_audit_only'
  | 'client_runtime_safe'
  | 'client_local'
  | 'public_runtime';

export type KnowledgeMode = 'approved_canonical' | 'source_backed_direct' | 'source_backed_partial';

export type RuntimeAnswerStatus =
  | 'approved_canonical'
  | 'source_backed_direct'
  | 'source_backed_partial'
  | 'insufficient_knowledge'
  | 'blocked_by_scope'
  | 'blocked_by_conflict'
  | 'blocked_by_currentness'
  | 'blocked_by_access_policy';

export type ClaimCompleteness = 'complete' | 'partial' | 'fragmentary';
export type ClientScope = 'global' | 'client_specific' | 'not_applicable';
export type CurrentnessStatus =
  | 'verified_for_scope'
  | 'not_verified'
  | 'historical'
  | 'not_applicable';

export type RiskClass =
  | 'normal_product_knowledge'
  | 'configuration_sensitive'
  | 'payroll_sensitive'
  | 'legal_or_regulatory'
  | 'security_sensitive';

export type SourceBackedEligibility =
  | 'eligible_direct'
  | 'eligible_partial'
  | 'blocked_heading_only'
  | 'blocked_fragment_without_subject'
  | 'blocked_unknown_scope'
  | 'blocked_conflict'
  | 'blocked_currentness'
  | 'blocked_client_scope'
  | 'blocked_source_policy'
  | 'blocked_access_policy';

export type Answerability = 'answerable' | 'partially_answerable' | 'insufficient' | 'blocked';

export type VisibilityAudience =
  | 'all_client_users'
  | 'hr_only'
  | 'payroll_only'
  | 'administrators'
  | 'named_roles';

export type Sensitivity = 'normal' | 'internal' | 'confidential' | 'restricted';

export type RuntimeRoutingReason =
  | 'approved_runtime_knowledge'
  | 'source_backed_runtime_knowledge'
  | 'partial_runtime_knowledge'
  | 'insufficient_runtime_knowledge'
  | 'runtime_knowledge_blocked';

export type SourcePolicyBlock = {
  sourceOwnership: SourceOwnership;
  sourceVisibility: SourceVisibility;
  citationPolicy: CitationPolicy;
  quotePolicy: QuotePolicy;
  distributionClass: DistributionClass;
};

export type KnowledgeAccessContextV1 = {
  contractVersion: typeof TETA_KNOWLEDGE_ACCESS_CONTEXT_CONTRACT_VERSION;
  tenantId: string;
  userId: string;
  roles: string[];
  organizationUnitIds: string[];
  productEntitlements: string[];
  permissionIds: string[];
};

export type ClientAccessPolicy = {
  tenantId: string;
  visibilityAudience: VisibilityAudience;
  allowedRoles: string[];
  allowedPermissionIds: string[];
  sensitivity: Sensitivity;
};

export type RuntimeApplicability = {
  platformId: string | null;
  productFamilyIds: string[];
  productSurfaceIds: string[];
  domainIds: string[];
  businessAreaIds: string[];
  productVersionHints: string[];
  temporalContextIds: string[];
  clientScope: ClientScope;
  currentnessStatus: CurrentnessStatus;
};

export type RuntimeAnswerPolicy = {
  mayAnswer: boolean;
  mayStateAsUniversal: boolean;
  mustDisclosePartiality: boolean;
  mustDiscloseCurrentness: boolean;
  mustRequestClarification: boolean;
};

export type VisibleCitationV1 = {
  citationId: string;
  sourceOwnership: 'client' | 'public_authority';
  displayTitle: string;
  sectionLabel: string | null;
  articleLabel: string | null;
  pageLabel: string | null;
  revisionLabel: string | null;
  validFrom: string | null;
  validTo: string | null;
  currentnessStatus: CurrentnessStatus;
  accessConfirmed: boolean;
};

export type RuntimeKnowledgeUnitV1 = {
  contractVersion: typeof TETA_RUNTIME_KNOWLEDGE_UNIT_CONTRACT_VERSION;
  runtimeKnowledgeUnitId: string;
  runtimeKnowledgeRevisionId: string;
  knowledgeMode: KnowledgeMode;
  recordKind: string;
  subject: { canonicalKey: string; label: string };
  claim: {
    normalizedText: string;
    answerableText: string;
    completeness: ClaimCompleteness;
  };
  applicability: RuntimeApplicability;
  riskClass: RiskClass;
  sourcePolicy: SourcePolicyBlock;
  accessPolicy: ClientAccessPolicy | null;
  internalProvenanceToken: string;
  visibleCitationDescriptor: VisibleCitationV1 | null;
  answerPolicy: RuntimeAnswerPolicy;
  warnings: string[];
  eligibility?: SourceBackedEligibility;
  synthetic?: boolean;
};

export type GroundedClaimV1 = {
  claimId: string;
  text: string;
  knowledgeMode: KnowledgeMode | RuntimeAnswerStatus;
  supportStrength: 'strong' | 'partial' | 'weak' | 'none';
  applicability: RuntimeApplicability;
  riskClass: RiskClass;
  internalSupportRefs: string[];
  visibleCitationRefs: string[];
  requiredDisclosure: string[];
  blockedReasons: string[];
};

export type GroundedAnswerPlanV1 = {
  contractVersion: typeof TETA_GROUNDED_ANSWER_PLAN_CONTRACT_VERSION;
  answerPlanId: string;
  query: {
    normalizedIntent: string;
    productContext: Record<string, unknown>;
    accessContextFingerprintSha256: string;
  };
  answerability: Answerability;
  claims: GroundedClaimV1[];
  visibleCitations: VisibleCitationV1[];
  internalTraceId: string;
  presentation: {
    answerNaturally: boolean;
    mentionKnowledgeBaseByDefault: boolean;
    mustDisclosePartiality: boolean;
    mustDiscloseCurrentness: boolean;
    mustDiscloseConflict: boolean;
    mustAskClarifyingQuestion: boolean;
  };
  warnings: string[];
  routingReason?: RuntimeRoutingReason;
  runtimeStatus?: RuntimeAnswerStatus;
};

export type InternalAnswerTraceV1 = {
  contractVersion: typeof TETA_INTERNAL_ANSWER_TRACE_CONTRACT_VERSION;
  internalTraceId: string;
  answerPlanId: string;
  runtimeKnowledgeUnitRefs: string[];
  approvedRecordRefs: string[];
  candidateOccurrenceRefs: string[];
  evidenceRefs: string[];
  sourceRevisionRefs: string[];
  decisionEventRefs: string[];
  accessDecisions: Array<Record<string, unknown>>;
  visibilityDecisions: Array<Record<string, unknown>>;
  blockedClaims: Array<Record<string, unknown>>;
  renderFingerprintSha256: string;
};

export type ClientAnswerPayloadV1 = {
  contractVersion: typeof TETA_CLIENT_ANSWER_PAYLOAD_CONTRACT_VERSION;
  answer: string;
  answerability: Answerability;
  visibleSources: VisibleCitationV1[];
  warnings: string[];
};

export type VendorRuntimePackV1 = {
  contractVersion: typeof TETA_RUNTIME_KNOWLEDGE_PACK_CONTRACT_VERSION;
  packKind: 'vendor_runtime';
  packId: string;
  units: RuntimeKnowledgeUnitV1[];
  fingerprintSha256: string;
};

export type VendorAuditPackV1 = {
  contractVersion: typeof TETA_RUNTIME_KNOWLEDGE_PACK_CONTRACT_VERSION;
  packKind: 'vendor_audit';
  packId: string;
  units: Array<Record<string, unknown>>;
  denyTokens: string[];
  fingerprintSha256: string;
};

export type ClientRuntimePackV1 = {
  contractVersion: typeof TETA_RUNTIME_KNOWLEDGE_PACK_CONTRACT_VERSION;
  packKind: 'client_runtime';
  packId: string;
  units: RuntimeKnowledgeUnitV1[];
  fingerprintSha256: string;
};

export type PublicRuntimePackV1 = {
  contractVersion: typeof TETA_RUNTIME_KNOWLEDGE_PACK_CONTRACT_VERSION;
  packKind: 'public_runtime';
  packId: string;
  units: RuntimeKnowledgeUnitV1[];
  fingerprintSha256: string;
};

export type RuntimeIndexDocument = {
  unitId: string;
  revisionId: string;
  knowledgeMode: KnowledgeMode;
  subjectKey: string;
  subjectLabel: string;
  answerableText: string;
  aliases: string[];
  productFamilyIds: string[];
  productSurfaceIds: string[];
  domainIds: string[];
  businessAreaIds: string[];
  clientScope: ClientScope;
  tenantId: string | null;
  roles: string[];
  currentnessStatus: CurrentnessStatus;
  riskClass: RiskClass;
  ownership: SourceOwnership;
  visibility: SourceVisibility;
  searchableText: string;
};

export type RetrievalQuery = {
  query: string;
  productFamily?: string | null;
  productSurface?: string | null;
  domain?: string | null;
  tenantId?: string | null;
  roles?: string[];
  accessContext?: KnowledgeAccessContextV1 | null;
};

export type RetrievalHit = {
  unit: RuntimeKnowledgeUnitV1;
  rankBucket: string;
  score: number;
};

export type ModelContextEnvelope = {
  structuredEvidenceEnvelope: true;
  sanitizedClaims: Array<{
    claimId: string;
    text: string;
    knowledgeMode: string;
    completeness: string;
    applicability: RuntimeApplicability;
    requiredWarnings: string[];
    citationPlaceholder: string | null;
  }>;
  forbiddenDisclosurePolicy: string[];
};

export type GroundedAnswerGeneratorInput = {
  sanitizedClaims: ModelContextEnvelope['sanitizedClaims'];
  visibleCitationPlaceholders: string[];
  requiredDisclosures: string[];
  forbiddenDisclosurePolicy: string[];
};

export type GroundedAnswerGeneratorOutput = {
  answerText: string;
  usedClaimIds: string[];
  citationPlaceholdersUsed: string[];
  disclosureFlags: string[];
};

export interface TetaGroundedAnswerGenerator {
  generate(
    input: GroundedAnswerGeneratorInput,
  ): Promise<GroundedAnswerGeneratorOutput> | GroundedAnswerGeneratorOutput;
}
