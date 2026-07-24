/**
 * Stage 3B — shared types (intent / evidence planning).
 * Does not modify Stage 1–3A extractors, graph, or index.
 */

export const STAGE3B_CONTRACT_VERSION = 'teta-aia-evidence-plan-v1';
export const STAGE3B_PLANNER_CONFIG_VERSION = 'teta-aia-planner-config-v1';

export type PlannerIntentType =
  | 'explain_payroll_component'
  | 'validate_import_file'
  | 'build_employee_report'
  | 'explain_application_field'
  | 'trace_application_to_oracle'
  | 'unsupported'
  | 'unknown';

export type PlanningStatus =
  | 'ready'
  | 'needs_clarification'
  | 'ambiguous'
  | 'unsupported'
  | 'invalid';

export type EntityConfidence = 'exact' | 'contextual' | 'partial';
export type EntityValidationStatus = 'valid' | 'ambiguous' | 'invalid' | 'not_checked';
export type EntitySource = 'question' | 'context' | 'hint';

export type PlannerEntityType =
  | 'employeeNumber'
  | 'employeeId'
  | 'employeeName'
  | 'componentCode'
  | 'componentValue'
  | 'payrollNumber'
  | 'payrollType'
  | 'payrollPeriod'
  | 'dateRange'
  | 'relativeDateRange'
  | 'formGuid'
  | 'formName'
  | 'fieldLabel'
  | 'controlName'
  | 'fileName'
  | 'fileType'
  | 'targetTable'
  | 'targetColumn'
  | 'reportSubject'
  | 'requestedOutput'
  | 'oracleObjectName'
  | 'oracleOwner'
  | 'oracleObjectType';

export const ALL_PLANNER_ENTITY_TYPES: PlannerEntityType[] = [
  'employeeNumber',
  'employeeId',
  'employeeName',
  'componentCode',
  'componentValue',
  'payrollNumber',
  'payrollType',
  'payrollPeriod',
  'dateRange',
  'relativeDateRange',
  'formGuid',
  'formName',
  'fieldLabel',
  'controlName',
  'fileName',
  'fileType',
  'targetTable',
  'targetColumn',
  'reportSubject',
  'requestedOutput',
  'oracleObjectName',
  'oracleOwner',
  'oracleObjectType',
];

export type EvidenceItemStatus =
  | 'resolved'
  | 'missing'
  | 'ambiguous'
  | 'conflicting'
  | 'unavailable'
  | 'deferred'
  | 'not_applicable';

export type AmbiguityKind = 'missing' | 'ambiguous' | 'conflicting' | 'unavailable' | 'deferred';

export type PlannerEntity = {
  type: PlannerEntityType;
  rawValue: string;
  normalizedValue: string;
  source: EntitySource;
  sourceStart: number;
  sourceEnd: number;
  confidence: EntityConfidence;
  validationStatus: EntityValidationStatus;
  attributes?: Record<string, unknown>;
};

export type MissingEntity = {
  type: PlannerEntityType | string;
  reason: string;
  requiredForIntent: boolean;
};

export type AmbiguityRecord = {
  kind: AmbiguityKind;
  subject: string;
  message: string;
  candidateIds?: string[];
  conflictIds?: string[];
  /** When false, recorded for later execution selection but does not block planningStatus=ready. */
  blocksPlanning?: boolean;
  selectionRequiredBeforeExecution?: boolean;
};

export type EvidenceRequirement = {
  evidenceType: string;
  required: boolean;
  graphQuery: Record<string, unknown> | null;
  graphResolution: {
    status: string | null;
    selectedNodeId: string | null;
    /** For multi-node evidence (columns, etc.) */
    selectedNodeIds?: string[];
    pathNodeIds?: string[];
    pathEdgeIds?: string[];
    paths?: unknown[];
    candidates: unknown[];
    truncated?: boolean;
    businessTarget?: string;
    canonicalCandidates?: unknown[];
    selectionRequiredBeforeExecution?: boolean;
  } | null;
  runtimeSourceRequired: boolean;
  status: EvidenceItemStatus;
  missingReason: string | null;
  warnings: string[];
  notes?: string | null;
};

export type ResolvedGraphEvidence = {
  nodes: unknown[];
  edges: unknown[];
  paths: unknown[];
  conflicts: unknown[];
  warnings: string[];
};

export type ClarificationQuestion = {
  entityType: string;
  question: string;
};

export type ExecutionPolicy = {
  sqlGenerationAllowed: false;
  sqlExecutionAllowed: false;
  fileReadAllowed: false;
  oracleWriteAllowed: false;
  reason: string;
};

export type TetaPlanningRequest = {
  question: string;
  language?: 'pl';
  conversationContext?: {
    employeeIdentifiers?: string[];
    payrollContext?: Record<string, unknown> | null;
    formContext?: { formGuid?: string; formName?: string } | null;
    fileContext?: { fileName?: string; fileType?: string } | null;
  };
  hints?: {
    expectedIntent?: PlannerIntentType | null;
    formGuid?: string | null;
    formName?: string | null;
  };
};

export type PlannerQueryTiming = {
  resolveFormMs: number;
  resolveFieldMs: number;
  resolveNodeMs: number;
  otherMs: number;
};

export type TetaEvidencePlan = {
  contractVersion: typeof STAGE3B_CONTRACT_VERSION;
  planningStatus: PlanningStatus;
  intent: {
    type: PlannerIntentType;
    confidence: EntityConfidence | 'none';
    matchedSignals: string[];
  };
  question: {
    raw: string;
    language: 'pl';
  };
  entities: PlannerEntity[];
  missingEntities: MissingEntity[];
  ambiguities: AmbiguityRecord[];
  evidenceRequirements: EvidenceRequirement[];
  resolvedGraphEvidence: ResolvedGraphEvidence;
  clarificationQuestions: ClarificationQuestion[];
  selectionRequiredBeforeExecution: boolean;
  executionPolicy: ExecutionPolicy;
  audit: {
    deterministic: true;
    graphSourceHash: string | null;
    plannerConfigVersion: string;
    plannerDurationMs: number;
    generatedAt?: string;
    graphQueriesExecuted: number;
    scopedFieldQueries: number;
    unscopedFieldQueries: number;
    resolvedForms: number;
    resolvedFormScopedFields: number;
    irrelevantGlobalAmbiguities: number;
    clarificationQuestionsForAmbiguities: number;
    evidenceNotApplicable: number;
    queryTimingMs: PlannerQueryTiming;
    guessedEntities: number;
    autoResolvedAmbiguities: number;
    sqlGenerated: number;
    sqlExecuted: number;
    filesRead: number;
    oracleWrites: number;
  };
};

export type Stage3bAuditReport = {
  contractVersion: string;
  plannerConfigVersion: string;
  graphIndexSchemaVersion: string | null;
  graphSourceHash: string | null;
  questionsTested: number;
  intentsResolved: number;
  intentsUnknown: number;
  intentsUnsupported: number;
  plansReady: number;
  plansNeedsClarification: number;
  plansAmbiguous: number;
  plansInvalid: number;
  entitiesExtracted: number;
  graphQueriesExecuted: number;
  graphResolved: number;
  graphAmbiguous: number;
  graphUnresolved: number;
  graphConflicting: number;
  graphResolvedEvidence: number;
  graphAmbiguousEvidence: number;
  graphUnresolvedEvidence: number;
  scopedFieldQueries: number;
  unscopedFieldQueries: number;
  irrelevantGlobalAmbiguities: number;
  clarificationQuestionsForAmbiguities: number;
  evidenceNotApplicable: number;
  resolvedForms: number;
  resolvedFormScopedFields: number;
  resolvedEvidenceWithoutNodeOrPath: number;
  evidenceSelectedNodeTypeMismatch: number;
  fieldEvidenceOutsideResolvedPath: number;
  bindingResolvedWithoutResolvedControl: number;
  lookupResolvedWithoutLookupEdge: number;
  helpDocumentPointingToForm: number;
  missingRequiredEvidence: number;
  deferredEvidence: number;
  guessedEntities: number;
  autoResolvedAmbiguities: number;
  sqlGenerated: number;
  sqlExecuted: number;
  filesRead: number;
  oracleWrites: number;
  averagePlanningTimeMs: number;
  maxPlanningTimeMs: number;
  referenceResults: Record<string, unknown>;
  diagnosis: Record<string, unknown>;
  strictErrors: string[];
  deterministicCheckOk: boolean;
  generatedAt: string;
};
