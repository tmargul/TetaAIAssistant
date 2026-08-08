import type { Stage3GapRow } from './teta-stage3.types';

/**
 * Architect B1 gap matrix for the Targeted Write-Path Analyzer. Mirrors the
 * Stage 2 shape for continuity; covers what the target-driven analyzer does
 * and does not attempt to resolve statically.
 */
export const STAGE3_GAP_MATRIX: Stage3GapRow[] = [
  {
    mechanism: 'WRITES_TO writer discovery for a single target object',
    existingExtractor: 'streamLoadWritesToIndex over Stage2 oracle-source-edges-v1.ndjson',
    coverageStatus: 'already_complete',
    missingInformation: 'none for objects present in the Stage2 static edge set',
    plannedChange: 'none',
  },
  {
    mechanism: 'INSERT column-list ↔ VALUES positional mapping',
    existingExtractor: 'parseInsertColumnMappings (teta-stage3-dml-map.ts)',
    coverageStatus: 'already_complete',
    missingInformation: 'dynamic column/values lists (bind-only INSERT ... VALUES (:1,:2,...))',
    plannedChange: 'classify as unresolved rather than guessing',
  },
  {
    mechanism: 'UPDATE SET vs WHERE role distinction',
    existingExtractor: 'parseUpdateSetMappings (teta-stage3-dml-map.ts)',
    coverageStatus: 'already_complete',
    missingInformation: 'multi-table UPDATE (subquery SET) is treated as transformed/unresolved',
    plannedChange: 'none — conservative by design',
  },
  {
    mechanism: 'DELETE row selectors',
    existingExtractor: 'parseDeleteSelectors (teta-stage3-dml-map.ts)',
    coverageStatus: 'already_complete',
    missingInformation: 'none for simple WHERE predicates',
    plannedChange: 'none',
  },
  {
    mechanism: 'Record field assignment chains (r_x.field := p_y.field)',
    existingExtractor: 'parseRecordFieldAssignments (teta-stage3-dml-map.ts)',
    coverageStatus: 'partially_extracted',
    missingInformation: 'multi-hop record chains beyond one assignment hop are marked transformed',
    plannedChange: 'defer deeper chain resolution to a future stage',
  },
  {
    mechanism: '%TYPE declarations vs actual READS_FROM',
    existingExtractor: 'classifyExpression excludes %TYPE-only declarations',
    coverageStatus: 'already_complete',
    missingInformation: 'none',
    plannedChange: 'none — %TYPE never promoted to a READS_FROM edge',
  },
  {
    mechanism: 'Validation / assertion call detection',
    existingExtractor: 'extractDirectCalls + /validate|assert|istnieje|check|sprawdz/i filter',
    coverageStatus: 'partially_extracted',
    missingInformation: 'semantic meaning of the validation is not inferred — structural only',
    plannedChange: 'none in Stage 3 — no business-rule inference',
  },
  {
    mechanism: 'Lookup SELECT in validation context (VALIDATES_AGAINST)',
    existingExtractor: 'extractProgramSqlReads scoped to validation call bodies',
    coverageStatus: 'partially_extracted',
    missingInformation: 'only deterministic FROM/JOIN lookups; CTE/dynamic lookups excluded',
    plannedChange: 'none — kept conservative',
  },
  {
    mechanism: 'Bounded reverse CALLS traversal (writer → caller chain)',
    existingExtractor: 'reverse index built lazily for visited writer packages only',
    coverageStatus: 'already_complete',
    missingInformation: 'callers beyond maxDepth are recorded as analysisTruncated, not silently dropped',
    plannedChange: 'none',
  },
  {
    mechanism: 'Package family classification (DAC/DAE/DEF/AGD/AGL)',
    existingExtractor: 'suffix-based structural classifier (classifyPackageFamily)',
    coverageStatus: 'already_complete',
    missingInformation: 'packages without a recognized suffix classified OTHER',
    plannedChange: 'none',
  },
  {
    mechanism: 'Stage1 GATEWAY_HAS_DAC_PACKAGE_REFERENCE attachment',
    existingExtractor: 'loadStage1DacEdges scoped to writer package names',
    coverageStatus: 'already_complete',
    missingInformation: 'gateways whose DAC edge is missing from Stage1 (not extracted) are absent',
    plannedChange: 'none — Stage1 is the source of truth for gateway references',
  },
  {
    mechanism: 'BEFORE/AFTER hook detection',
    existingExtractor: '/before|after|przed|po_|hook/i on DAE-like caller names, structural only',
    coverageStatus: 'runtime_only',
    missingInformation: 'actual trigger/hook execution order is not observed statically',
    plannedChange: 'record as sideEffectCalls only; never assert ordering',
  },
  {
    mechanism: 'EXECUTE IMMEDIATE / DBMS_SQL dynamic writes',
    existingExtractor: 'detectDynamicBoundaries (reused from Stage2 parsers)',
    coverageStatus: 'runtime_only',
    missingInformation: 'runtime SQL text',
    plannedChange: 'record as HAS_RUNTIME_BOUNDARY analog; no guessing',
  },
  {
    mechanism: 'Wrapped / missing package body source',
    existingExtractor: 'sourceStatus=unavailable branch → partial_exact_path/source_unavailable',
    coverageStatus: 'partially_extracted',
    missingInformation: 'wrapped bodies not present in Stage2 unwrap output remain opaque',
    plannedChange: 'optional oracle_metadata targeted fetch for the specific writer package only',
  },
  {
    mechanism: 'Name-similarity-only parameter mapping',
    existingExtractor: 'explicitly rejected — every mapping requires positional/explicit provenance',
    coverageStatus: 'not_applicable',
    missingInformation: 'none — by design, never inferred from name similarity alone',
    plannedChange: 'objectSelectedByNameSimilarityOnly audit counter enforced at 0',
  },
  {
    mechanism: 'Business SQL / model / RAG inference',
    existingExtractor: 'forbidden',
    coverageStatus: 'not_applicable',
    missingInformation: 'none',
    plannedChange: 'runtimeCopilotDependencies, localModelCalls, remoteModelCalls, ragCalls, qdrantCalls, embeddingCalls, businessSelectStatementsExecuted must remain 0',
  },
  {
    mechanism: 'Evidence Resolver v2 / cross-stage synthesis',
    existingExtractor: 'n/a',
    coverageStatus: 'not_applicable',
    missingInformation: 'deferred to Stage 4',
    plannedChange: 'do not implement in Stage 3',
  },
  {
    mechanism: 'Generic/metadata-driven DML frameworks (thin _DEF body with no literal DML)',
    existingExtractor:
      'Stage3 records source_unavailable / runtime_boundary / dmlOperations=[] when the writer body genuinely lacks static INSERT/UPDATE/DELETE after unwrap; never invents column mappings from PACKAGE spec field names',
    coverageStatus: 'runtime_only',
    missingInformation:
      'when a shared runtime engine owns the final DML and the writer body has no literal SQL, Stage3 stops at the structural path (DAC→DAE→DEF) with unresolved deep mappings',
    plannedChange:
      'keep fail-closed; do not infer via name similarity between DEF spec fields and target columns',
  },
];
