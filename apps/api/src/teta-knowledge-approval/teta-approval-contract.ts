import type { DecisionKind, ReviewerRole } from './teta-approval.types';

export const DECISION_KINDS: DecisionKind[] = [
  'approve',
  'approve_with_scope',
  'approve_merged_record',
  'approve_as_variants',
  'approve_supported_subset',
  'reject',
  'defer',
  'request_more_evidence',
  'supersede',
  'revoke',
  'close_gap_as_no_evidence',
];

export const REVIEWER_ROLES: ReviewerRole[] = [
  'knowledge_reviewer',
  'product_expert',
  'technical_expert',
  'legal_reviewer',
  'vendor_admin',
];

export const APPROVAL_KINDS_CREATING_RECORDS: DecisionKind[] = [
  'approve',
  'approve_with_scope',
  'approve_merged_record',
  'approve_as_variants',
  'approve_supported_subset',
  'supersede',
];

export const STAGE_BOUNDARY_ZERO_FIELDS = [
  'realAutoApprovals',
  'approvedLexiconEntriesCreated',
  'approvedBusinessSemanticsBindingsCreated',
  'ragChunksGenerated',
  'qdrantCalls',
  'embeddingCalls',
  'localModelCalls',
  'remoteModelCalls',
  'ocrCalls',
  'imageAnalysisCalls',
  'oracleConnectionsOpened',
  'oracleStatementsExecuted',
  'sqlCompiled',
  'sqlExecuted',
  'formulasExecuted',
  'clientKnowledgePacksBuilt',
  'finalChatAnswersGenerated',
  'stage3kStarted',
  'rawSourcesReadByStage3j2e',
  'stage3j2cBatchesModified',
  'stage3j2dRunsModified',
  'candidateOccurrencesDeleted',
  'evidenceEntriesDeleted',
  'realDecisionEventsApplied',
  'realApprovedRecordsCreated',
] as const;

export const APPLICABILITY_SAFEGUARD_ZERO_FIELDS = [
  'tetaEduApprovedAsTetaHr',
  'tetaMeApprovedAsStandaloneDomain',
  'clientSpecificApprovedAsGlobal',
  'historicalApprovedAsCurrent',
  'versionSpecificApprovedAsUniversal',
  'unknownApplicabilityApprovedWithoutExplicitScope',
  'regulatoryClaimApprovedCurrentWithoutLegalReview',
  'customerExampleApprovedAsGlobal',
  'approvalsWithUnresolvedConflict',
  'conflictsAutoResolvedByApprovalWorkflow',
  'conflictingEvidenceDiscarded',
] as const;

export const PRIVACY_ZERO_FIELDS = [
  'reviewerIdsWrittenToRepoDocs',
  'realReviewPacksWrittenToRepo',
  'realEvidenceExcerptsWrittenToRepo',
  'realDecisionEventsWrittenToRepo',
  'realApprovedRecordsWrittenToRepo',
  'absolutePathsWrittenToRepoDocs',
  'customerNamesWrittenToRepoDocs',
] as const;

export const MAX_EXCERPT_CHARS = 800;

export function isDecisionKind(value: string): value is DecisionKind {
  return (DECISION_KINDS as string[]).includes(value);
}

export function isReviewerRole(value: string): value is ReviewerRole {
  return (REVIEWER_ROLES as string[]).includes(value);
}

export function emptyStageBoundaryCounters(): Record<(typeof STAGE_BOUNDARY_ZERO_FIELDS)[number], number> {
  return Object.fromEntries(STAGE_BOUNDARY_ZERO_FIELDS.map((k) => [k, 0])) as Record<
    (typeof STAGE_BOUNDARY_ZERO_FIELDS)[number],
    number
  >;
}

export function emptySafeguardCounters(): Record<(typeof APPLICABILITY_SAFEGUARD_ZERO_FIELDS)[number], number> {
  return Object.fromEntries(APPLICABILITY_SAFEGUARD_ZERO_FIELDS.map((k) => [k, 0])) as Record<
    (typeof APPLICABILITY_SAFEGUARD_ZERO_FIELDS)[number],
    number
  >;
}

export function emptyPrivacyCounters(): Record<(typeof PRIVACY_ZERO_FIELDS)[number], number> {
  return Object.fromEntries(PRIVACY_ZERO_FIELDS.map((k) => [k, 0])) as Record<(typeof PRIVACY_ZERO_FIELDS)[number], number>;
}
