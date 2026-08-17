import type { Stage4ResolutionResult } from '../teta-application-first-evidence-resolver-v2';
import type { Stage5Result } from '../teta-clarification-engine-stage5';

export type EvaluationState =
  | 'ANSWERED_EXECUTED'
  | 'CLARIFICATION_REQUIRED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'RESOLVED_BUT_NO_EXECUTOR'
  | 'UNSUPPORTED_REQUEST'
  | 'ERROR';

export type RecognizedCapabilityId =
  | 'employee_current_position'
  | 'employee_surname_prefix'
  | 'employee_surname_prefix_with_position'
  | null;

export type BusinessSlots = {
  employeeNumber?: string;
  surnamePrefix?: string;
};

export type EvalSafetyCounters = {
  arbitraryBusinessSqlGenerated: number;
  llmGeneratedSql: number;
  unregisteredExecutorCalls: number;
  dmlStatementsExecuted: number;
  ddlStatementsExecuted: number;
  plsqlBlocksExecuted: number;
  twgPhysicalSeedCount: number;
  hardcodedTwgMappings: number;
  goldenTwgMappingsUsed: number;
  localModelCalls: number;
  remoteModelCalls: number;
  runtimeCopilotDependencies: number;
};

export function emptyEvalSafetyCounters(): EvalSafetyCounters {
  return {
    arbitraryBusinessSqlGenerated: 0,
    llmGeneratedSql: 0,
    unregisteredExecutorCalls: 0,
    dmlStatementsExecuted: 0,
    ddlStatementsExecuted: 0,
    plsqlBlocksExecuted: 0,
    twgPhysicalSeedCount: 0,
    hardcodedTwgMappings: 0,
    goldenTwgMappingsUsed: 0,
    localModelCalls: 0,
    remoteModelCalls: 0,
    runtimeCopilotDependencies: 0,
  };
}

export type IntentMatch = {
  capabilityId: RecognizedCapabilityId;
  businessSlots: BusinessSlots;
  canonicalQuestion: string | null;
  businessConcept: string;
  confidence: 'high' | 'low';
};

export type Stage4Summary = {
  resolutionStatus: string;
  clarificationNeeded: boolean;
  semanticAnchorsFound: number;
  bindingHypothesesBuilt: number;
  connectedHypotheses: number;
  falseStrongBindings: number;
};

export type Stage5Summary = {
  clarificationRequired: boolean;
  technicalGapOnly: boolean;
  resolvableByUser: boolean;
  clarificationReason: string | null;
  selectedDimension: string | null;
  questionText: string | null;
  choiceLabels: string[];
};

export type ExecutorSummary = {
  executorId: string | null;
  pilotStatus: string | null;
  rowCount: number | null;
  businessSelectStatementsExecuted: number;
};

export type EvalInteractionTrace = {
  timestamp: string;
  rawQuestion: string;
  recognizedCapability: RecognizedCapabilityId;
  businessSlots: BusinessSlots;
  evaluationState: EvaluationState;
  userFacingAnswer: string;
  clarification: Stage5Summary['questionText'];
  stage4: Stage4Summary;
  stage5: Stage5Summary;
  executor: ExecutorSummary;
  durationMs: number;
  falseStrongBindings: number;
  error: string | null;
  userVerdict: string | null;
  safetyCounters: EvalSafetyCounters;
  stage4Full?: Stage4ResolutionResult;
  stage5Full?: Stage5Result;
  executorFull?: Record<string, unknown>;
  renderedRows?: string[][];
};

export type UserVerdict =
  | 'pass'
  | 'wrong'
  | 'blocked'
  | 'clarification-good'
  | 'clarification-bad';
