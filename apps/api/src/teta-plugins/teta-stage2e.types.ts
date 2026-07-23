/** Stage 2E — Canonical Knowledge Graph types. */

export const STAGE2E_IDENTITY_VERSION = 'teta-aia-canonical-id-v1';

export type Stage2eCanonicalConfidence =
  | 'confirmed'
  | 'probable'
  | 'candidate'
  | 'conflicting'
  | 'unresolved';

export type Stage2eNodeType =
  | 'plugin_registry_entry'
  | 'assembly'
  | 'dotnet_type'
  | 'application_form'
  | 'help_document'
  | 'help_section'
  | 'help_field'
  | 'ui_control'
  | 'action_control'
  | 'target_binding'
  | 'lookup_binding'
  | 'data_source'
  | 'business_object'
  | 'data_factory'
  | 'gateway'
  | 'dataset'
  | 'dataset_column'
  | 'main_source'
  | 'join'
  | 'projected_column'
  | 'calculated_column'
  | 'oracle_object'
  | 'oracle_column'
  | 'oracle_package'
  | 'oracle_procedure'
  | 'oracle_function'
  | 'oracle_argument'
  | 'oracle_dependency'
  | 'oracle_constraint';

export type Stage2eDomain =
  | 'application'
  | 'dotnet'
  | 'dataset'
  | 'oracle'
  | 'help'
  | 'canonical-graph-technical';

export type Stage2eEdgeType =
  | 'REGISTERED_AS'
  | 'IMPLEMENTED_BY'
  | 'HAS_HELP'
  | 'HAS_SECTION'
  | 'DESCRIBES'
  | 'HAS_CONTROL'
  | 'LABEL_FOR'
  | 'BINDS_TARGET'
  | 'BINDS_LOOKUP'
  | 'DISPLAYS_FROM'
  | 'USES_DATASOURCE'
  | 'USES_BO'
  | 'USES_DF'
  | 'RESOLVES_TO_GATEWAY'
  | 'PRODUCES_DATASET'
  | 'READS_FROM'
  | 'JOINS_TO'
  | 'PROJECTS'
  | 'DERIVED_FROM'
  | 'MAPS_TO_ORACLE_OBJECT'
  | 'MAPS_TO_ORACLE_COLUMN'
  | 'MAPS_TO_DATASET_COLUMN'
  | 'HAS_DATASET_COLUMN'
  | 'RESOLVES_TO_ORACLE_COLUMN'
  | 'RESOLVES_SYNONYM_TO'
  | 'USES_PACKAGE'
  | 'CALLS_FUNCTION'
  | 'CALLS_PROCEDURE'
  | 'DEPENDS_ON'
  | 'VALIDATED_BY_ORACLE'
  | 'INHERITS_FROM'
  | 'FOREIGN_KEY_TO'
  | 'REFERENCES'
  | 'PRIMARY_KEY_OF'
  | 'UNIQUE_KEY_OF'
  | 'HAS_PROCEDURE'
  | 'HAS_FUNCTION'
  | 'HAS_ARGUMENT'
  | 'HAS_COLUMN';

export type Stage2eEvidence = {
  kind?: string | null;
  assembly?: string | null;
  type?: string | null;
  method?: string | null;
  offset?: string | null;
  assignment?: string | null;
  view?: string | null;
  owner?: string | null;
  name?: string | null;
  sourceArtifact?: string | null;
  sourceRecordId?: string | null;
  [key: string]: unknown;
};

export type Stage2eProvenance = {
  sourceStage: string;
  sourceArtifact: string;
  sourceRecordId?: string | null;
  evidence?: Stage2eEvidence[];
};

export type Stage2eNode = {
  id: string;
  type: Stage2eNodeType | string;
  domain?: Stage2eDomain | string;
  name: string;
  canonicalName: string;
  sourceStage: string[];
  confidence: Stage2eCanonicalConfidence | string;
  sourceConfidence?: string | null;
  evidence: Stage2eEvidence[];
  provenance?: Stage2eProvenance[];
  attributes: Record<string, unknown>;
  identityVersion: string;
  orphanStatus?: string | null;
  semanticNormalization?: {
    originalNodeType?: string;
    normalizedNodeType?: string;
    reason?: string;
    sourceStage?: string;
    invalidOracleCandidateClass?: string;
  } | null;
};

export type Stage2eEdge = {
  id: string;
  type: Stage2eEdgeType | string;
  from: string;
  to: string;
  confidence: Stage2eCanonicalConfidence | string;
  sourceConfidence?: string | null;
  sourceStage: string[];
  evidence: Stage2eEvidence[];
  provenance?: Stage2eProvenance[];
  attributes: Record<string, unknown>;
  identityVersion: string;
};

export type Stage2eConflict = {
  conflictType: string;
  subjectId: string;
  alternatives: unknown[];
  evidence: Stage2eEvidence[];
  resolutionStatus: 'unresolved' | 'resolved' | string;
};

export type Stage2eOracleValidationStatus =
  | 'confirmed'
  | 'missing_in_current_db'
  | 'multiple_owners'
  | 'synonym_resolved'
  | 'invalid_object'
  | 'not_checked';

export type Stage2eGraph = {
  metadata: {
    generatedAt: string;
    identityVersion: string;
    stages: string[];
    oracleEnabled: boolean;
    limit?: number | null;
  };
  summary: Record<string, number | string | boolean | null>;
  nodes: Stage2eNode[];
  edges: Stage2eEdge[];
  conflicts: Stage2eConflict[];
  referenceChains: Record<string, unknown>;
  formEvidenceChains?: unknown[];
  audit: Record<string, unknown>;
};

export type Stage2eBuildOptions = {
  repoRoot: string;
  limit?: number | null;
  oracleEnabled?: boolean;
  strict?: boolean;
};
