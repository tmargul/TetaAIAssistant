/** Stage 2A technical form bindings — independent of Etap 1 status logic. */

export type Stage2aConfidence =
  | 'confirmed_from_il'
  | 'confirmed_from_metadata'
  | 'probable_from_local_sequence'
  | 'candidate'
  | 'conflicting';

export type Stage2aEvidenceItem = {
  method?: string | null;
  offset?: string | null;
  assignment?: string | null;
  opcode?: string | null;
  resolvedMember?: string | null;
};

export type Stage2aControl = {
  fieldName?: string | null;
  fieldType?: string | null;
  declaringType?: string | null;
  inheritedFromType?: string | null;
  createdInMethod?: string | null;
  constructorType?: string | null;
  controlKind?: string | null;
  confidence?: Stage2aConfidence | string | null;
  assignedProperties?: Array<{
    property?: string | null;
    value?: unknown;
    method?: string | null;
    confidence?: string | null;
  }> | null;
  evidence?: string[] | null;
};

export type Stage2aFormBinding = {
  formIdentity?: string | null;
  registryId?: string | null;
  guid?: string | null;
  formType?: string | null;
  pluginType?: string | null;
  declaredOnType?: string | null;
  assembly?: string | null;
  resolvedDllPath?: string | null;
  hasInitializeComponent?: boolean;
  controls?: Stage2aControl[] | null;
  dataSources?: Array<{
    name?: string | null;
    kind?: string | null;
    relatedDf?: string | null;
    relatedAssembly?: string | null;
    relatedControl?: string | null;
    confidence?: string | null;
    declaredOnType?: string | null;
    inheritedFromType?: string | null;
  }> | null;
  businessObjects?: Array<{
    fullType?: string | null;
    assembly?: string | null;
    logicalName?: string | null;
    confidence?: string | null;
    evidence?: Stage2aEvidenceItem[] | null;
  }> | null;
  dataFactories?: Array<{
    fullType?: string | null;
    assembly?: string | null;
    logicalName?: string | null;
    confidence?: string | null;
    evidence?: Stage2aEvidenceItem[] | null;
  }> | null;
  assemblies?: Array<{
    name?: string | null;
    role?: string | null;
    confidence?: string | null;
    evidence?: string[] | null;
  }> | null;
  bindings?: Array<{
    control?: string | null;
    controlType?: string | null;
    binding?: Record<string, unknown> | null;
    dataMember?: unknown;
    datasetTable?: unknown;
    format?: unknown;
    valueMember?: unknown;
    displayMember?: unknown;
    parameterName?: unknown;
    filterExpression?: unknown;
    idColumn?: unknown;
    parentIdColumn?: unknown;
    alternatives?: unknown[] | null;
    propertyBindings?: Record<string, unknown> | null;
    confidence?: string | null;
    declaredOnType?: string | null;
    inheritedFromType?: string | null;
    evidence?: Stage2aEvidenceItem[] | null;
  }> | null;
  dataOperations?: Array<{
    operationKind?: string | null;
    target?: string | null;
    targetType?: string | null;
    key?: string | null;
    value?: unknown;
    method?: string | null;
    offset?: string | null;
    confidence?: string | null;
    evidence?: Stage2aEvidenceItem[] | null;
  }> | null;
  uiControls?: Stage2aControl[] | null;
  dataObjects?: Stage2aControl[] | null;
  businessObjectFields?: Stage2aControl[] | null;
  constants?: Stage2aControl[] | null;
  technicalFields?: Stage2aControl[] | null;
  syntheticTargets?: Stage2aControl[] | null;
  filters?: Array<{
    expression?: string | null;
    control?: string | null;
    dataSource?: string | null;
    confidence?: string | null;
    evidence?: Stage2aEvidenceItem[] | null;
  }> | null;
  lookups?: Array<{
    pluginAssembly?: string | null;
    lookupClass?: string | null;
    control?: string | null;
    confidence?: string | null;
    evidence?: Stage2aEvidenceItem[] | null;
  }> | null;
  relations?: Array<{
    relationType?: string | null;
    from?: string | null;
    to?: string | null;
    confidence?: string | null;
    sourceMethod?: string | null;
    sourceOffsets?: string[] | null;
    evidence?: string[] | null;
  }> | null;
  propertyAssignments?: Array<{
    control?: string | null;
    property?: string | null;
    value?: unknown;
    method?: string | null;
    offset?: string | null;
    assignment?: string | null;
    confidence?: string | null;
  }> | null;
  constructorCalls?: Array<{
    constructorType?: string | null;
    arguments?: unknown[] | null;
    method?: string | null;
    offset?: string | null;
    confidence?: string | null;
  }> | null;
  unresolvedEvidence?: Array<{
    kind?: string | null;
    message?: string | null;
    declaringType?: string | null;
  }> | null;
  conflicts?: Array<{
    subject?: string | null;
    message?: string | null;
    confidence?: string | null;
  }> | null;
};

export type Stage2aDllResult = {
  dllPath: string;
  ok: boolean;
  error?: string | null;
  errorDetail?: string | null;
  forms?: Stage2aFormBinding[] | null;
};

export type Stage2aRequest = {
  dllPath: string;
  match: string[];
  pluginsRoot?: string | null;
};

export type Stage2aAuditSummary = {
  formsAnalyzed: number;
  formsWithInitializeComponent: number;
  formsWithControlBinding: number;
  /** @deprecated use uiControlCount */
  controlCount: number;
  uiControlCount?: number;
  dataObjectCount?: number;
  technicalFieldCount?: number;
  constantCount?: number;
  syntheticTargetCount?: number;
  confirmedBindings: number;
  probableBindings: number;
  candidateOnly: number;
  businessObjectCount: number;
  dataFactoryCount: number;
  bosDllCount: number;
  dataSourceCount: number;
  lookupCount: number;
  filterCount: number;
  conflictCount: number;
  formsWithoutTechnicalKnowledge: number;
  // Stage 2A.1 anomaly stats (optional on legacy dumps)
  bindingsWithMultipleDataMembers?: number;
  formatValuesPreviouslyMisclassified?: number;
  parameterNamesPreviouslyMisclassified?: number;
  syntheticItemTargetsRemoved?: number;
  nonUiFieldsRemovedFromControls?: number;
  formDfCount?: number;
  controlDfCount?: number;
  columnDfCount?: number;
  datasourceDfCount?: number;
  uncertainDfRelations?: number;
};
