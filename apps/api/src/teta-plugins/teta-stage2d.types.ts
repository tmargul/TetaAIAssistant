/** Stage 2D / 2D.1 types — SqlJoin graph + semantic normalization. */

export type Stage2dConfidence =
  | 'confirmed_from_il'
  | 'confirmed_from_literal'
  | 'confirmed_from_stage2b'
  | 'inherited_from_base_type'
  | 'probable'
  | 'manual_required'
  | 'unresolved'
  | 'conflicting';

export type Stage2dConditionStatus =
  | 'explicit_literal'
  | 'explicit_reconstructed'
  | 'inherited_from_base'
  | 'supplied_by_addcolumn_overload'
  | 'added_later'
  | 'framework_default'
  | 'not_provided_in_il'
  | 'unresolved_dynamic';

export type Stage2dDatasetTableStatus =
  | 'confirmed_from_il'
  | 'confirmed_from_stage2b'
  | 'inherited_from_base_type'
  | 'unresolved';

export type Stage2dEvidenceItem = {
  method?: string | null;
  offset?: string | null;
  assignment?: string | null;
  opcode?: string | null;
  resolvedMember?: string | null;
};

export type Stage2dJoinCondition = {
  leftAlias?: string | null;
  leftColumn?: string | null;
  operator?: string | null;
  rightAlias?: string | null;
  rightColumn?: string | null;
  confidence?: Stage2dConfidence | string | null;
};

export type Stage2dJoin = {
  joinedObject?: string | null;
  /** Original alias spelling from IL. */
  alias?: string | null;
  rawAlias?: string | null;
  normalizedAlias?: string | null;
  joinType?: string | null;
  condition?: Stage2dJoinCondition | null;
  rawCondition?: string | null;
  conditionStatus?: Stage2dConditionStatus | string | null;
  sourceApi?: string | null;
  sourceApis?: string[] | null;
  inheritanceKind?: 'declared' | 'inherited' | null;
  declaredOnType?: string | null;
  inheritedByType?: string | null;
  sourceAssembly?: string | null;
  alternatives?: Array<Record<string, unknown>> | null;
  confidence?: Stage2dConfidence | string | null;
  evidence?: Stage2dEvidenceItem[] | null;
};

export type Stage2dMainSource = {
  objectName?: string | null;
  alias?: string | null;
  objectKind?: string | null;
  source?: string | null;
  confidence?: Stage2dConfidence | string | null;
  evidence?: Stage2dEvidenceItem[] | null;
};

export type Stage2dCalculatedDeps = {
  referencedAliases?: string[] | null;
  referencedColumns?: string[] | null;
  referencedPackages?: string[] | null;
  referencedFunctions?: string[] | null;
  referencedSubqueryObjects?: string[] | null;
};

export type Stage2dProjectedColumn = {
  sourceAlias?: string | null;
  sourceColumn?: string | null;
  expression?: string | null;
  /** Explicit second arg of AddColumn when present. */
  datasetColumn?: string | null;
  datasetColumnExplicit?: string | null;
  effectiveDatasetColumn?: string | null;
  effectiveDatasetColumnStatus?:
    | 'explicit'
    | 'framework_derived'
    | 'unresolved'
    | string
    | null;
  calculated?: boolean | null;
  calculatedDependencies?: Stage2dCalculatedDeps | null;
  confidence?: Stage2dConfidence | string | null;
  evidence?: Stage2dEvidenceItem[] | null;
};

export type Stage2dDatasetColumn = {
  name?: string | null;
  sourceAlias?: string | null;
  sourceColumn?: string | null;
  expression?: string | null;
  calculated?: boolean | null;
  fromJoin?: boolean | null;
  confidence?: Stage2dConfidence | string | null;
  evidence?: Stage2dEvidenceItem[] | null;
};

export type Stage2dDatasetModel = {
  declaringType?: string | null;
  assemblyName?: string | null;
  resolvedDllPath?: string | null;
  technicalRole?: string | null;
  baseType?: string | null;
  inheritanceChain?: string[] | null;
  datasetTable?: string | null;
  datasetTableStatus?: Stage2dDatasetTableStatus | string | null;
  datasetTableEvidence?: Stage2dEvidenceItem[] | null;
  mainSource?: Stage2dMainSource | null;
  joins?: Stage2dJoin[] | null;
  declaredJoins?: Stage2dJoin[] | null;
  inheritedJoins?: Stage2dJoin[] | null;
  effectiveJoins?: Stage2dJoin[] | null;
  projectedColumns?: Stage2dProjectedColumn[] | null;
  datasetColumns?: Stage2dDatasetColumn[] | null;
  confidence?: Stage2dConfidence | string | null;
  evidence?: Stage2dEvidenceItem[] | null;
  stage2d1Normalized?: boolean | null;
};

export type Stage2dBatchRequest = {
  searchRoots?: string[] | null;
  assemblies?: Array<{
    assemblyName?: string | null;
    types?: string[] | null;
    referencedByForms?: string[] | null;
  }> | null;
};

export type Stage2dBatchResult = {
  ok?: boolean;
  error?: string | null;
  assemblies?: Array<Record<string, unknown>> | null;
  datasets?: Stage2dDatasetModel[] | null;
};

export type Stage2dResult = {
  dllPath?: string | null;
  assemblyName?: string | null;
  ok?: boolean;
  error?: string | null;
  datasets?: Stage2dDatasetModel[] | null;
};

export type Stage2dAuditSummary = {
  assembliesResolved: number;
  assembliesMissing: number;
  datasetsAnalyzed: number;
  datasetsWithJoins: number;
  datasetsWithMainSource: number;
  joinCount: number;
  joinsWithParsedCondition: number;
  joinsWithUnknownType: number;
  projectedColumnCount: number;
  calculatedColumnCount: number;
  datasetColumnCount: number;
  joinColumns: number;
  confirmedFromIl: number;
  probable: number;
  manualRequired: number;
  // Stage 2D.1
  datasetTableColumnMisclassificationsFixed: number;
  datasetsWithConfirmedDatasetTable: number;
  datasetsWithUnresolvedDatasetTable: number;
  datasetsWithConfirmedMainSource: number;
  datasetsWithUnresolvedMainSource: number;
  joinsExplicitCondition: number;
  joinsInheritedCondition: number;
  joinsConditionAddedLater: number;
  joinsFrameworkDefault: number;
  joinsDynamicUnresolved: number;
  joinsNotProvidedInIl: number;
  joinsSuppliedByAddColumn: number;
  duplicateJoinEvidenceMerged: number;
  conflictingJoinDefinitions: number;
  inheritedJoins: number;
  projectedColumnsWithoutExplicitDatasetAlias: number;
  calculatedExpressionDependenciesParsed: number;
};

/** Stage 2B gateway snapshot used only as read-only evidence for 2D.1. */
export type Stage2dStage2bGatewayHint = {
  gatewayType?: string | null;
  datasetTable?: string | null;
  viewName?: string | null;
  baseTableName?: string | null;
  alias?: string | null;
  declaringType?: string | null;
};

export type Stage2dStage2bTypeHint = {
  fullName?: string | null;
  baseType?: string | null;
  inheritanceChain?: string[] | null;
  gateways?: Stage2dStage2bGatewayHint[] | null;
  datasetTables?: Array<{ name?: string | null }> | null;
};
