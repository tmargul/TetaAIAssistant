/**
 * Stage 3D — Canonical Business Semantics Layer types.
 * Does not generate SQL or connect to Oracle.
 */

export const STAGE3D_CONTRACT_VERSION = 'teta-aia-business-semantics-v1';
export const STAGE3D_ONTOLOGY_VERSION = 'teta-aia-business-ontology-v1';
export const STAGE3D_BINDINGS_VERSION = 'teta-aia-business-semantic-bindings-v1';
export const STAGE3D_LANGUAGE_VERSION = 'teta-aia-business-language-pl-v1';
export const STAGE3D_IDENTITY_VERSION = 'teta-aia-canonical-id-v1';

export type SemanticBindingStatus =
  | 'discovered'
  | 'approved'
  | 'ambiguous'
  | 'unresolved'
  | 'rejected'
  | 'stale'
  | 'invalid';

export type SemanticEvidenceType =
  | 'vendor_confirmed_relation'
  | 'reconstructed_sql_join'
  | 'foreign_key'
  | 'confirmed_gateway_join'
  | 'canonical_graph_path'
  | 'vendor_assertion'
  | 'form_gateway_path';

export type OntologySourceRole = {
  role: string;
  kind: 'required' | 'supporting' | 'enrichment';
  description?: string;
  searchTerms?: string[];
  formNameFragments?: string[];
  semanticTags?: string[];
};

export type OntologyProjectionRole = {
  role: string;
  sourceRole: string;
  preferDisplayText?: boolean;
  description?: string;
  labelHints?: string[];
};

export type OntologyRelationRole = {
  role: string;
  leftSourceRole: string;
  rightSourceRole: string;
  joinType: 'inner' | 'left';
  required?: boolean;
  enrichment?: boolean;
  description?: string;
};

export type OntologyValuePathRole = {
  role: string;
  projectionRole: string;
  description?: string;
};

export type OntologyTemporalRole = {
  role: string;
  type: 'half_open_date_interval' | 'effective_on_date';
  description?: string;
};

export type BusinessOntologySubject = {
  subject: string;
  intent: string;
  sourceRoles: OntologySourceRole[];
  projectionRoles: OntologyProjectionRole[];
  relationRoles: OntologyRelationRole[];
  valuePathRoles: OntologyValuePathRole[];
  temporalRoles: OntologyTemporalRole[];
};

export type BusinessOntologyFile = {
  version: string;
  identityVersion: string;
  subjects: BusinessOntologySubject[];
};

export type SemanticSourceBinding = {
  role: string;
  status: SemanticBindingStatus;
  logicalObjectNodeId: string | null;
  accessObjectNodeId: string | null;
  businessReason: string;
  evidenceNodeIds?: string[];
  evidenceEdgeIds?: string[];
  formNodeIds?: string[];
  candidateNodeIds?: string[];
  enrichment?: boolean;
  supporting?: boolean;
};

export type SemanticProjectionBinding = {
  role: string;
  status: SemanticBindingStatus;
  sourceRole: string;
  oracleColumnNodeId: string | null;
  datasetColumnNodeId?: string | null;
  displayLabel?: string | null;
  businessReason: string;
  evidenceNodeIds?: string[];
  evidenceEdgeIds?: string[];
  viaValuePathRole?: string | null;
};

export type SemanticRelationPredicate = {
  leftOracleColumnNodeId: string;
  operator: 'equals';
  rightOracleColumnNodeId: string;
};

export type SemanticRelationBinding = {
  role: string;
  status: SemanticBindingStatus;
  leftSourceRole: string;
  rightSourceRole: string;
  joinType: 'inner' | 'left';
  predicates: SemanticRelationPredicate[];
  evidenceType: SemanticEvidenceType | null;
  joinNodeId?: string | null;
  businessReason: string;
  evidenceNodeIds?: string[];
  evidenceEdgeIds?: string[];
  required?: boolean;
  enrichment?: boolean;
  /** Keep structural fact in registry but do not use as authoritative projection join. */
  projectionUsage?: 'authoritative' | 'not_used_for_this_projection' | 'supporting';
};

export type SemanticValuePathStep = {
  sourceRole: string;
  columnNodeId?: string | null;
  displayColumnNodeId?: string | null;
  note?: string;
};

export type SemanticValuePathBinding = {
  role: string;
  status: SemanticBindingStatus;
  projectionRole: string;
  steps: SemanticValuePathStep[];
  displayColumnNodeId: string | null;
  displaySourceRole: string | null;
  authoritativeStartSourceRole?: string | null;
  businessReason: string;
  evidenceNodeIds?: string[];
  evidenceEdgeIds?: string[];
};

export type SemanticTemporalBinding = {
  role: string;
  status: SemanticBindingStatus;
  type: 'half_open_date_interval' | 'effective_on_date';
  clock: 'oracle_sysdate';
  columnBusinessRole?: string | null;
  columnOracleNodeId?: string | null;
  sourceRole?: string | null;
  validFromColumnNodeId?: string | null;
  validToColumnNodeId?: string | null;
  openEndedEndAllowed?: boolean;
  startInclusive?: boolean;
  endInclusive?: boolean;
  assertionKind?: 'structural_confirmed' | 'vendor_business_assertion';
  businessReason: string;
  evidenceNodeIds?: string[];
  evidenceEdgeIds?: string[];
};

export type SemanticFormBinding = {
  role: string;
  status: SemanticBindingStatus;
  formNodeId: string | null;
  businessReason: string;
};

export type SubjectSemanticBindings = {
  subject: string;
  sources: SemanticSourceBinding[];
  projections: SemanticProjectionBinding[];
  relations: SemanticRelationBinding[];
  valuePaths: SemanticValuePathBinding[];
  temporals: SemanticTemporalBinding[];
  forms?: SemanticFormBinding[];
};

export type SemanticBindingsFile = {
  version: string;
  identityVersion: string;
  graphSourceHash: string;
  subjects: SubjectSemanticBindings[];
};

export type BusinessLanguageFile = {
  version: string;
  labels: Record<string, string>;
  roleDescriptions: Record<string, string>;
  clarificationHints?: Record<string, string>;
};

export type DiscoveryCandidate = {
  nodeId: string;
  scoreRank: number;
  matchKind: string;
  owner: string | null;
  objectType: string | null;
  name: string | null;
};

export type DiscoveryResult = {
  subject: string;
  role: string;
  kind: 'source' | 'projection' | 'relation' | 'value_path' | 'temporal' | 'form';
  status: SemanticBindingStatus;
  candidates: DiscoveryCandidate[];
  selectedNodeId: string | null;
  warnings: string[];
};

export type ValidationIssue = {
  code: string;
  severity: 'error' | 'warning';
  subject?: string;
  role?: string;
  message: string;
  nodeId?: string | null;
};

export type ValidationResult = {
  ok: boolean;
  graphSourceHash: string | null;
  registryGraphSourceHash: string | null;
  identityVersion: string | null;
  issues: ValidationIssue[];
  stale: boolean;
  approvedBindingCount: number;
  invalidBindingCount: number;
};

export type SubjectSemanticResolution = {
  contractVersion: typeof STAGE3D_CONTRACT_VERSION;
  subject: string;
  graphSourceHash: string | null;
  identityVersion: string;
  status: 'ready' | 'partial' | 'stale' | 'invalid' | 'unresolved';
  sources: SemanticSourceBinding[];
  projections: SemanticProjectionBinding[];
  relations: SemanticRelationBinding[];
  valuePaths: SemanticValuePathBinding[];
  temporals: SemanticTemporalBinding[];
  forms: SemanticFormBinding[];
  validation: ValidationResult;
  warnings: string[];
};

export type Stage3dAuditReport = {
  contractVersion: string;
  ontologyVersion: string;
  bindingsVersion: string;
  languageVersion: string;
  identityVersion: string;
  graphSourceHash: string | null;
  graphIndexSchemaVersion: string | null;
  subjectsValidated: number;
  approvedBindings: number;
  staleBindings: number;
  invalidBindings: number;
  unresolvedRoles: number;
  ambiguousRoles: number;
  validationOk: boolean;
  referenceBhpPlanStatus: string | null;
  positionNamePath: string[] | null;
  examinationTypeNamePath: string[] | null;
  organizationalUnitNamePath: string[] | null;
  activeEmployeeMechanism: string | null;
  currentPositionTemporalMechanism: string | null;
  currentPositionTemporalBindingsRequired: number;
  currentPositionTemporalBindingsApproved: number;
  currentPositionFiltersResolved: number;
  currentPositionFiltersMissing: number;
  historicalPositionLeakRisk: number;
  competingOrganizationalUnitPaths: number;
  projectionPathsWithMultipleAuthoritativeSources: number;
  finalSqlGenerated: number;
  sqlExecuted: number;
  oracleConnections: number;
  qdrantCalls: number;
  embeddingCalls: number;
  llmCalls: number;
  agentCalls: number;
  strictErrors: string[];
  deterministicCheckOk: boolean;
  referenceResults: Record<string, unknown>;
  generatedAt: string;
};

/** Minimal Stage 3A client surface used by Stage 3D (no NDJSON). */
export type Stage3dGraphClient = {
  getNodeById(id: string): import('../teta-plugins/teta-stage3a.types').GraphNodeView | null;
  resolveNode(input: {
    id?: string;
    name?: string;
    domain?: string;
    nodeType?: string;
    owner?: string;
    objectType?: string;
  }): import('../teta-plugins/teta-stage3a.types').GraphResolverResult;
  resolveForm(input: {
    guid?: string;
    fullTypeName?: string;
    nameFragment?: string;
  }): import('../teta-plugins/teta-stage3a.types').GraphResolverResult;
};
