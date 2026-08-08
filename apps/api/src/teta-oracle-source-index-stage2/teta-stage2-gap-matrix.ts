export type Stage2GapRow = {
  mechanism: string;
  existingExtractor: string;
  coverageStatus:
    | 'already_complete'
    | 'partially_extracted'
    | 'not_extracted'
    | 'runtime_only'
    | 'not_applicable';
  missingInformation: string;
  plannedChange: string;
};

export const STAGE2_GAP_MATRIX: Stage2GapRow[] = [
  {
    mechanism: 'Oracle object inventory',
    existingExtractor: 'OracleMetadataSourceProvider ALL_OBJECTS',
    coverageStatus: 'already_complete',
    missingInformation: 'none for indexed owners',
    plannedChange: 'Keep filesystem provider as alternate corpus',
  },
  {
    mechanism: 'View FROM/JOIN lineage',
    existingExtractor: 'ALL_VIEWS.TEXT + Stage2 parsers',
    coverageStatus: 'already_complete',
    missingInformation: 'LONG truncation edge cases; DBMS_METADATA LOB handling optional',
    plannedChange: 'Prefer ALL_VIEWS with STRING fetchInfo; GET_DDL fallback when permitted',
  },
  {
    mechanism: 'Wrapped PACKAGE BODY unwrap',
    existingExtractor: 'OraclePlsqlUnwrapProvider stub',
    coverageStatus: 'not_extracted',
    missingInformation: 'existingUnwrapToolFound=false — no in-repo algorithm',
    plannedChange: 'Architect must supply/approve unwrap tool; then adapter only',
  },
  {
    mechanism: 'Package SPEC/BODY linkage',
    existingExtractor: 'name match SPEC_BODY_OF',
    coverageStatus: 'already_complete',
    missingInformation: 'none',
    plannedChange: 'Keep distinct oracle-package vs oracle-package-body identities',
  },
  {
    mechanism: 'Static DML / CALLS from plaintext',
    existingExtractor: 'Stage2 parsers on ALL_SOURCE plaintext',
    coverageStatus: 'partially_extracted',
    missingInformation: 'Wrapped bodies (~80%) lack plaintext; plaintext SELECT→READS recovered (programReadEdges>0)',
    plannedChange: 'After unwrap tool: reparse; strengthen SELECT indexing',
  },
  {
    mechanism: 'ALL_DEPENDENCIES REFERENCES',
    existingExtractor: 'Oracle metadata',
    coverageStatus: 'already_complete',
    missingInformation: 'Not promoted to READ/WRITE without parser evidence',
    plannedChange: 'Keep multi-provenance merge',
  },
  {
    mechanism: 'Trigger ATTACHED_TO',
    existingExtractor: 'ALL_TRIGGERS',
    coverageStatus: 'already_complete',
    missingInformation: 'none for indexed owners',
    plannedChange: 'none',
  },
  {
    mechanism: 'EXECUTE IMMEDIATE / DBMS_SQL',
    existingExtractor: 'runtime boundary detector',
    coverageStatus: 'runtime_only',
    missingInformation: 'runtime SQL text',
    plannedChange: 'HAS_RUNTIME_BOUNDARY; no guessing',
  },
  {
    mechanism: 'Parameter→column / business validations',
    existingExtractor: 'n/a',
    coverageStatus: 'not_applicable',
    missingInformation: 'deferred to Targeted Write-Path Analyzer',
    plannedChange: 'Do not implement in Stage 2',
  },
  {
    mechanism: 'Copilot at runtime',
    existingExtractor: 'forbidden',
    coverageStatus: 'not_applicable',
    missingInformation: 'none',
    plannedChange: 'runtimeCopilotDependencies must remain 0',
  },
];
