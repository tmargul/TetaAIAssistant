/**
 * Stage 5 — Application-Language Clarification Engine contracts.
 * Contract: teta-aia-clarification-engine-stage5-v1
 */

export const STAGE5_CONTRACT_VERSION = 'teta-aia-clarification-engine-stage5-v1';
export const STAGE5_SOURCE_STAGE = 'CLARIFY-S5';

export type UserResolvableDimension =
  | 'which_application_surface'
  | 'which_form'
  | 'which_tab'
  | 'which_business_entity'
  | 'which_record_kind'
  | 'which_assignment_type'
  | 'current_vs_history'
  | 'which_date_context'
  | 'which_organizational_context'
  | 'which_component_type';

export type TechnicalOnlyDimension =
  | 'missing_application_technical_path'
  | 'missing_oracle_relation'
  | 'missing_column_relation'
  | 'missing_lookup_binding'
  | 'missing_temporal_implementation'
  | 'runtime_only_binding'
  | 'source_unavailable'
  | 'conflicting_technical_evidence'
  | 'which_assignment_source_technical';

export type AmbiguityDimensionKind = 'user_resolvable' | 'technical_only';

export type ClassifiedAmbiguityDimension = {
  dimensionId: string;
  kind: AmbiguityDimensionKind;
  userResolvableDimension?: UserResolvableDimension;
  technicalOnlyDimension?: TechnicalOnlyDimension;
  sourceDimension: string;
  reason: string;
  separatesHypotheses: number;
  applicationEvidenceRefs: string[];
};

export type ChoiceEvidenceQuality =
  | 'exact_application_surface'
  | 'strong_application_surface'
  | 'insufficient_surface_evidence';

export type SurfaceChoiceSourceType =
  | 'application_surface'
  | 'form_title'
  | 'tab_title'
  | 'application_anchor'
  | 'pa_label'
  | 'moduleHint'
  | 'lexicon_token'
  | 'fallback_token'
  | 'other';

export type ClarificationChoice = {
  choiceId: string;
  /** User-facing label — application/business language only. */
  label: string;
  /** Hidden canonical application id (form/tab/module), never shown raw if technical. */
  canonicalApplicationId?: string | null;
  applicationSurfaceCanonicalId?: string | null;
  supportingHypothesisIds?: string[];
  supportingApplicationEvidenceIds?: string[];
  hypothesesRetained?: string[];
  hypothesesEliminated?: string[];
  choiceEvidenceQuality?: ChoiceEvidenceQuality;
  semanticEffect: ClarificationSemanticEffect;
  evidenceRefs: string[];
};

export type ClarificationSemanticEffect = {
  applicationContext?: string | null;
  formScope?: string | null;
  tabScope?: string | null;
  moduleScope?: string | null;
  applicationSurfaceId?: string | null;
  temporalIntent?: 'current' | 'history' | 'none' | null;
  businessEntity?: string | null;
  assignmentType?: string | null;
  componentType?: string | null;
  recordKind?: string | null;
};

export type ClarificationQuestion = {
  clarificationId: string;
  dimension: UserResolvableDimension;
  question: string;
  choices: ClarificationChoice[];
  freeTextAllowed: boolean;
};

export type ClarificationAnswer = {
  clarificationId: string;
  selectedChoiceId: string;
  optionalFreeText?: string | null;
};

export type ClarificationRequestState = {
  originalRequest: string;
  resolvedDimensions: string[];
  pendingDimensions: string[];
  clarificationHistory: Array<{
    clarificationId: string;
    dimension: string;
    selectedChoiceId: string;
    appliedAt: string;
  }>;
};

export type SurfacePartitionMetrics = {
  surfaceCandidatesReceived: number;
  surfaceCandidatesEvidenceBacked: number;
  surfaceCandidatesRejected: number;
  lexiconOnlySurfaceCandidatesRejected: number;
  moduleHintOnlySurfaceCandidatesRejected: number;
  surfaceCandidatesWithHypothesisSupport: number;
  surfacePartitionsBuilt: number;
  surfacePartitionsUseful: number;
  surfacePartitionsNonDiscriminating: number;
  eligibleFormChoices: number;
  suppressedFormChoices: number;
  choicesWithUncertaintyReduction: number;
  choicesWithoutUncertaintyReduction: number;
  duplicateSurfacesCollapsed: number;
  indistinguishableSurfaceChoicesSuppressed: number;
  hypothesesBefore: number;
  partitionByChoice: Record<string, string[]>;
  expectedRemainingHypotheses: Record<string, number>;
  informationGainScore: number;
};

export type Stage5Metrics = {
  stage4ResultsConsumed: number;
  ambiguityDimensionsReceived: number;
  userResolvableDimensions: number;
  technicalOnlyDimensions: number;
  questionsPlanned: number;
  questionsSuppressed: number;
  hypothesesBeforeClarification: number;
  hypothesesAfterClarification: number;
  clarificationAnswersApplied: number;
  stage4RerunsAfterClarification: number;
  technicalTokensScanned: number;
  technicalTokensLeaked: number;
  analysisDurationMs: number;
  stage4RediscoveryCallsFromStage5: number;
  oracleCallsFromStage5: number;
  surfaceCandidatesReceived: number;
  surfaceCandidatesEvidenceBacked: number;
  surfaceCandidatesRejected: number;
  lexiconOnlySurfaceCandidatesRejected: number;
  moduleHintOnlySurfaceCandidatesRejected: number;
  surfaceCandidatesWithHypothesisSupport: number;
  surfacePartitionsBuilt: number;
  surfacePartitionsUseful: number;
  surfacePartitionsNonDiscriminating: number;
  eligibleFormChoices: number;
  suppressedFormChoices: number;
  choicesWithUncertaintyReduction: number;
  choicesWithoutUncertaintyReduction: number;
  duplicateSurfacesCollapsed: number;
  indistinguishableSurfaceChoicesSuppressed: number;
};

export type Stage5Audit = {
  scenarioSpecificClarificationBranches: number;
  hardcodedCurrentPositionClarification: number;
  hardcodedPayrollClarification: number;
  hardcodedTwgClarification: number;
  hardcodedBhpClarification: number;
  lexiconTokenUsedAsUserFacingChoice: number;
  moduleHintOnlyChoices: number;
  physicalMappingInjectedByClarification: number;
  goldenPhysicalMappingUsedInClarification: number;
  forceSemanticDimensionProductionReachable: number;
  syntheticDimensionInjectedIntoProduction: number;
  technicalTokensLeakedToUserFacingClarification: number;
  runtimeCopilotDependencies: number;
  localModelCalls: number;
  remoteModelCalls: number;
  businessSelectStatementsExecuted: number;
  businessRowsRead: number;
  dmlStatementsExecuted: number;
  ddlStatementsExecuted: number;
  plsqlBlocksExecuted: number;
};

export type Stage5Result = {
  contractVersion: typeof STAGE5_CONTRACT_VERSION;
  sourceStage: typeof STAGE5_SOURCE_STAGE;
  clarificationRequired: boolean;
  clarificationReason: string;
  resolvableByUser: boolean;
  technicalGapOnly: boolean;
  ambiguityDimensions: ClassifiedAmbiguityDimension[];
  selectedDimension: UserResolvableDimension | null;
  question: ClarificationQuestion | null;
  choices: ClarificationChoice[];
  freeTextAllowed: boolean;
  resolvedDimensions: string[];
  pendingDimensions: string[];
  rejectedClarifications: Array<{ dimension: string; reason: string }>;
  evidencePreserved: string[];
  requestState: ClarificationRequestState;
  enrichedSemanticContext: ClarificationSemanticEffect | null;
  metrics: Stage5Metrics;
  audit: Stage5Audit;
  strictErrors: string[];
};

export const emptyStage5Metrics = (): Stage5Metrics => ({
  stage4ResultsConsumed: 0,
  ambiguityDimensionsReceived: 0,
  userResolvableDimensions: 0,
  technicalOnlyDimensions: 0,
  questionsPlanned: 0,
  questionsSuppressed: 0,
  hypothesesBeforeClarification: 0,
  hypothesesAfterClarification: 0,
  clarificationAnswersApplied: 0,
  stage4RerunsAfterClarification: 0,
  technicalTokensScanned: 0,
  technicalTokensLeaked: 0,
  analysisDurationMs: 0,
  stage4RediscoveryCallsFromStage5: 0,
  oracleCallsFromStage5: 0,
  surfaceCandidatesReceived: 0,
  surfaceCandidatesEvidenceBacked: 0,
  surfaceCandidatesRejected: 0,
  lexiconOnlySurfaceCandidatesRejected: 0,
  moduleHintOnlySurfaceCandidatesRejected: 0,
  surfaceCandidatesWithHypothesisSupport: 0,
  surfacePartitionsBuilt: 0,
  surfacePartitionsUseful: 0,
  surfacePartitionsNonDiscriminating: 0,
  eligibleFormChoices: 0,
  suppressedFormChoices: 0,
  choicesWithUncertaintyReduction: 0,
  choicesWithoutUncertaintyReduction: 0,
  duplicateSurfacesCollapsed: 0,
  indistinguishableSurfaceChoicesSuppressed: 0,
});

export const emptyStage5Audit = (): Stage5Audit => ({
  scenarioSpecificClarificationBranches: 0,
  hardcodedCurrentPositionClarification: 0,
  hardcodedPayrollClarification: 0,
  hardcodedTwgClarification: 0,
  hardcodedBhpClarification: 0,
  lexiconTokenUsedAsUserFacingChoice: 0,
  moduleHintOnlyChoices: 0,
  physicalMappingInjectedByClarification: 0,
  goldenPhysicalMappingUsedInClarification: 0,
  forceSemanticDimensionProductionReachable: 0,
  syntheticDimensionInjectedIntoProduction: 0,
  technicalTokensLeakedToUserFacingClarification: 0,
  runtimeCopilotDependencies: 0,
  localModelCalls: 0,
  remoteModelCalls: 0,
  businessSelectStatementsExecuted: 0,
  businessRowsRead: 0,
  dmlStatementsExecuted: 0,
  ddlStatementsExecuted: 0,
  plsqlBlocksExecuted: 0,
});
