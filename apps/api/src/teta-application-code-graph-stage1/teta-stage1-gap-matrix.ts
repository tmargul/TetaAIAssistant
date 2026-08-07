/**
 * Gap matrix: Stage 1 ACE vs existing Stage 2A–2E / 3A extractors.
 * coverageStatus values per architect contract.
 */
export type GapCoverageStatus =
  | 'already_complete'
  | 'partially_extracted'
  | 'extracted_but_not_connected'
  | 'extracted_but_semantically_lost'
  | 'not_extracted'
  | 'runtime_only'
  | 'not_applicable';

export type GapMatrixRow = {
  mechanism: string;
  existingExtractor: string;
  existingNodeType: string;
  existingEdgeType: string;
  existingProvenance: string;
  coverageStatus: GapCoverageStatus;
  missingInformation: string;
  plannedChange: string;
};

export const GAP_MATRIX_V1: GapMatrixRow[] = [
  {
    mechanism: 'Grid/DataSourceTableName',
    existingExtractor: 'Stage2A',
    existingNodeType: 'dataset / ui_control',
    existingEdgeType: 'BINDS_TARGET / USES_DATASOURCE',
    existingProvenance: 'IL InitializeComponent property assignment',
    coverageStatus: 'partially_extracted',
    missingInformation: 'Not always emitted as traversable FORM→DATASET path with ACE provenance schema',
    plannedChange: 'Materialize CONTROL_BINDS_DATASET / form dataset edges with Stage1 provenance',
  },
  {
    mechanism: 'Bindings.Table / Bindings.Column',
    existingExtractor: 'Stage2A',
    existingNodeType: 'target_binding',
    existingEdgeType: 'BINDS_TARGET',
    existingProvenance: 'confirmed_from_il',
    coverageStatus: 'already_complete',
    missingInformation: 'none for binding facts',
    plannedChange: 'Reuse; map to CONTROL_BINDS_* with provenance',
  },
  {
    mechanism: 'Lookup.ParentTable / LookupTableName',
    existingExtractor: 'Stage2A / Stage2C',
    existingNodeType: 'lookup_binding',
    existingEdgeType: 'BINDS_LOOKUP',
    existingProvenance: 'partial IL + help',
    coverageStatus: 'partially_extracted',
    missingInformation: 'Target FK vs lookup display often collapsed in later stages',
    plannedChange: 'Keep LOOKUP_USES_OBJECT with separate target/key/display attributes',
  },
  {
    mechanism: 'JOINClauseDefinition / ColumnRelation',
    existingExtractor: 'Stage2A (limited) / Stage2D',
    existingNodeType: 'join',
    existingEdgeType: 'JOINS_TO',
    existingProvenance: 'IL when present',
    coverageStatus: 'partially_extracted',
    missingInformation: 'Many joins conditionStatus=not_provided_in_il',
    plannedChange: 'Parse simple ON; mark unresolved otherwise; no guessing',
  },
  {
    mechanism: 'BusinessObjectReference',
    existingExtractor: 'Stage2A',
    existingNodeType: 'business_object',
    existingEdgeType: 'USES_BO',
    existingProvenance: 'IL literal type+assembly',
    coverageStatus: 'already_complete',
    missingInformation: 'none when literal present',
    plannedChange: 'Reuse as FORM_USES_BUSINESS_OBJECT',
  },
  {
    mechanism: 'ProxyHelper.GetBusinessObject',
    existingExtractor: 'Stage2A/2B (occasional evidence)',
    existingNodeType: 'business_object',
    existingEdgeType: 'USES_BO',
    existingProvenance: 'call site without resolved type',
    coverageStatus: 'runtime_only',
    missingInformation: 'runtime BO type',
    plannedChange: 'HAS_RUNTIME_BOUNDARY boundaryType=proxy_factory',
  },
  {
    mechanism: 'DF Gateway / BO MainGateway / BO Add(gateway)',
    existingExtractor: 'Stage2B',
    existingNodeType: 'gateway',
    existingEdgeType: 'RESOLVES_TO_GATEWAY',
    existingProvenance: 'IL constructor/Add evidence',
    coverageStatus: 'extracted_but_not_connected',
    missingInformation: 'Stage2B kind=chain harvested Oracle names only in Stage2E ingest — path hops not traversable',
    plannedChange: 'Emit BUSINESS_OBJECT_USES_GATEWAY + dataset hops with independent provenance',
  },
  {
    mechanism: 'TG/MTG TableName / TableAlias / ViewName / BaseTableName',
    existingExtractor: 'Stage2B',
    existingNodeType: 'oracle_object / gateway',
    existingEdgeType: 'MAPS_TO_ORACLE_OBJECT',
    existingProvenance: 'set_TableName literal',
    coverageStatus: 'partially_extracted',
    missingInformation: 'Dataset ctor arg not always linked as first-class edge',
    plannedChange: 'GATEWAY_BINDS_DATASET from ::.ctor(null,\"Dataset\") + GATEWAY_READS_FROM_ORACLE_OBJECT',
  },
  {
    mechanism: 'DictionaryTableName / DictionaryTableAlias',
    existingExtractor: 'Stage2B (rare in corpus)',
    existingNodeType: 'oracle_object',
    existingEdgeType: 'BINDS_LOOKUP / MAPS_TO_ORACLE_OBJECT',
    existingProvenance: 'property literal when present',
    coverageStatus: 'not_extracted',
    missingInformation: '0 DictionaryTableName hits in current Stage2B full artifact',
    plannedChange: 'Parse set_DictionaryTableName when present; LOOKUP_USES_OBJECT',
  },
  {
    mechanism: 'SumoCommandBuilder DAC package',
    existingExtractor: 'Stage2B',
    existingNodeType: 'oracle_package',
    existingEdgeType: 'USES_PACKAGE',
    existingProvenance: 'constructor package literal',
    coverageStatus: 'already_complete',
    missingInformation: 'DAC body (deferred to Roadmap Stage 3 write-path)',
    plannedChange: 'GATEWAY_HAS_DAC_PACKAGE_REFERENCE only; no DAC/DAE/DEF body analysis',
  },
  {
    mechanism: 'Relation / AddRelation exact keys',
    existingExtractor: 'Stage2B evidence strings',
    existingNodeType: 'none first-class',
    existingEdgeType: 'none',
    existingProvenance: 'IL call text',
    coverageStatus: 'not_extracted',
    missingInformation: 'parent/child column lists not materialized as graph edges',
    plannedChange: 'APPLICATION_RELATION with keyResolutionStatus resolved|unresolved',
  },
  {
    mechanism: 'AddDefaultRelation',
    existingExtractor: 'none in current corpus (0 hits)',
    existingNodeType: 'none',
    existingEdgeType: 'none',
    existingProvenance: 'n/a',
    coverageStatus: 'not_extracted',
    missingInformation: 'framework default keys',
    plannedChange: 'Store relationMechanism=default_relation keyResolutionStatus=unresolved',
  },
  {
    mechanism: 'JoinDefinition / SqlSelectCommand.AddJoin',
    existingExtractor: 'Stage2D / Stage2B evidence',
    existingNodeType: 'join',
    existingEdgeType: 'JOINS_TO',
    existingProvenance: 'IL; often null ON',
    coverageStatus: 'partially_extracted',
    missingInformation: '~4671 joins not_provided_in_il in Stage2D audit',
    plannedChange: 'Reuse Stage2D; parse simple A.COL=B.COL; else unresolved',
  },
  {
    mechanism: 'AddWhereCondition cross-object',
    existingExtractor: 'Stage2D (limited)',
    existingNodeType: 'join / condition',
    existingEdgeType: 'JOINS_TO',
    existingProvenance: 'IL when captured',
    coverageStatus: 'partially_extracted',
    missingInformation: 'not always classified as relation',
    plannedChange: 'APPLICATION_JOIN when deterministic; else unresolved',
  },
  {
    mechanism: 'Inheritance (declared/inherited/effective)',
    existingExtractor: 'Stage2A inheritedFromType; Stage2B baseType',
    existingNodeType: 'dotnet_type',
    existingEdgeType: 'INHERITS_FROM',
    existingProvenance: 'metadata',
    coverageStatus: 'partially_extracted',
    missingInformation: 'effective config provenance not preserved across flatten',
    plannedChange: 'INHERITS_CONFIGURATION + configurationScope declared|inherited; no silent conflict resolution',
  },
  {
    mechanism: 'Late-binding gateway / dynamic SQL / FillCommandPrepared',
    existingExtractor: 'Stage2B evidence (present)',
    existingNodeType: 'none',
    existingEdgeType: 'none',
    existingProvenance: 'call site text',
    coverageStatus: 'runtime_only',
    missingInformation: 'runtime values',
    plannedChange: 'HAS_RUNTIME_BOUNDARY; do not invent gateway/oracle',
  },
  {
    mechanism: 'Stage2E canonical IDs / Stage3A index',
    existingExtractor: 'Stage2E / Stage3A',
    existingNodeType: 'canonical graph',
    existingEdgeType: 'existing edge vocabulary',
    existingProvenance: 'multi-stage',
    coverageStatus: 'already_complete',
    missingInformation: 'ACE path materialization feeder',
    plannedChange: 'Reuse teta-aia-canonical-id-v1; sourceStage=ACE-S1; no second graph',
  },
];
