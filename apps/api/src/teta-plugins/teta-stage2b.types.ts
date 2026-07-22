/** Stage 2B — bos DLL / gateway / Oracle mapping types. */

export type Stage2bConfidence =
  | 'confirmed_from_il'
  | 'confirmed_from_getter_il'
  | 'confirmed_from_constant'
  | 'confirmed_from_metadata'
  | 'confirmed_in_oracle'
  | 'confirmed_in_dll_not_found_in_oracle'
  | 'probable_from_naming'
  | 'candidate_string'
  | 'conflicting'
  | 'ambiguous_owner'
  | 'invalid_object_type'
  | 'oracle_not_checked'
  | 'oracle_unavailable';

export type Stage2bEvidenceItem = {
  method?: string | null;
  offset?: string | null;
  assignment?: string | null;
  opcode?: string | null;
  resolvedMember?: string | null;
};

export type BosAssemblyResolution = {
  assemblyName?: string | null;
  resolvedPath?: string | null;
  resolutionStatus?: string | null;
  candidatePaths?: string[] | null;
  referencedByForms?: string[] | null;
  referencedTypes?: string[] | null;
  fileHashSha256?: string | null;
  fileVersion?: string | null;
  fileSize?: number | null;
};

export type GatewayDescriptor = {
  gatewayType?: string | null;
  gatewayKind?: string | null;
  declaringType?: string | null;
  assemblyName?: string | null;
  datasetTable?: string | null;
  alias?: string | null;
  viewName?: string | null;
  baseTableName?: string | null;
  packageName?: string | null;
  rawPackageName?: string | null;
  normalizedPackageName?: string | null;
  packageKind?: string | null;
  operations?: Record<
    string,
    {
      kind?: string | null;
      methodName?: string | null;
      packageProcedure?: string | null;
      sql?: string | null;
      confidence?: string | null;
      evidence?: Stage2bEvidenceItem[] | null;
    }
  > | null;
  confidence?: string | null;
  evidence?: Stage2bEvidenceItem[] | null;
  oracleViewStatus?: string | null;
  oracleTableStatus?: string | null;
  oraclePackageStatus?: string | null;
};

export type DatasetTableFact = {
  name?: string | null;
  source?: string | null;
  declaringType?: string | null;
  confidence?: string | null;
  columns?: Array<{
    name?: string | null;
    dataType?: string | null;
    isPrimaryKey?: boolean | null;
    readOnly?: boolean | null;
    confidence?: string | null;
  }> | null;
  evidence?: Stage2bEvidenceItem[] | null;
};

export type BosTypeAnalysis = {
  fullName?: string | null;
  namespace?: string | null;
  name?: string | null;
  assemblyName?: string | null;
  resolvedDllPath?: string | null;
  baseType?: string | null;
  inheritanceChain?: string[] | null;
  interfaces?: string[] | null;
  technicalRole?: string | null;
  roleConfidence?: string | null;
  roleEvidence?: string[] | null;
  typeResolutionStatus?: string | null;
  getters?: Array<{
    propertyName?: string | null;
    value?: unknown;
    alternatives?: unknown[] | null;
    declaringType?: string | null;
    method?: string | null;
    offset?: string | null;
    confidence?: string | null;
    evidence?: Stage2bEvidenceItem[] | null;
  }> | null;
  constructorFacts?: Array<{
    declaringType?: string | null;
    method?: string | null;
    offset?: string | null;
    calledMember?: string | null;
    calledType?: string | null;
    arguments?: unknown[] | null;
    confidence?: string | null;
    evidence?: Stage2bEvidenceItem[] | null;
  }> | null;
  gateways?: GatewayDescriptor[] | null;
  datasetTables?: DatasetTableFact[] | null;
  relatedGatewayTypes?: string[] | null;
  referencedByForms?: string[] | null;
};

export type RelationEdge2b = {
  relationType?: string | null;
  from?: string | null;
  to?: string | null;
  confidence?: string | null;
  evidence?: string[] | null;
};

export type LookupBindingSplit = {
  control?: string | null;
  formType?: string | null;
  targetBinding?: {
    datasetTable?: string | null;
    dataMember?: string | null;
  } | null;
  lookupBinding?: {
    datasetTable?: string | null;
    valueMember?: string | null;
    displayMember?: string | null;
    lookupClass?: string | null;
    pluginAssembly?: string | null;
  } | null;
  confidence?: string | null;
  evidence?: string[] | null;
};

export type Stage2bResult = {
  dllPath?: string | null;
  assemblyName?: string | null;
  ok: boolean;
  error?: string | null;
  errorDetail?: string | null;
  resolution?: BosAssemblyResolution | null;
  types?: BosTypeAnalysis[] | null;
};

export type Stage2bBatchRequest = {
  searchRoots?: string[] | null;
  assemblies?: Array<{
    assemblyName?: string | null;
    types?: string[] | null;
    referencedByForms?: string[] | null;
  }> | null;
};

export type Stage2bBatchResult = {
  ok: boolean;
  error?: string | null;
  assemblies?: BosAssemblyResolution[] | null;
  types?: BosTypeAnalysis[] | null;
  gateways?: GatewayDescriptor[] | null;
  relations?: RelationEdge2b[] | null;
};

export type Stage2bAuditSummary = {
  bosDllReferenced: number;
  bosDllResolved: number;
  bosDllMissing: number;
  bosDllDuplicateDifferentHash: number;
  bosDllUnreadable: number;
  boTypesRequested: number;
  boTypesFound: number;
  dfTypesRequested: number;
  dfTypesFound: number;
  gatewayTypes: number;
  datasetTables: number;
  views: number;
  baseTables: number;
  packages: number;
  packageOperations: number;
  confirmedOracleObjects: number;
  objectsMissingInOracle: number;
  formDatasourceGatewayDatasetConfirmed: number;
  formColumnOracleColumnConfirmed: number;
  lookupConflictsResolvedSemantically: number;
  unresolvedLookupConflicts: number;
  candidateStringsNotPromoted: number;
  inheritanceChainsResolved: number;
};

export type Stage2bLinkedChain = {
  formType?: string | null;
  control?: string | null;
  dataMember?: string | null;
  formDatasetTable?: string | null;
  boOrDf?: string | null;
  gatewayType?: string | null;
  viewName?: string | null;
  baseTableName?: string | null;
  packageName?: string | null;
  oracleColumnStatus?: string | null;
  confidence?: string | null;
  evidence?: string[] | null;
};
