/**
 * Generic evidence-based schema role resolution.
 * Logical roles in → physical candidates out. No scenario-seeded Oracle objects.
 */

export type EvidenceFamily =
  | 'application_semantic'
  | 'application_technical'
  | 'oracle_structural'
  | 'schema_convention'
  | 'implementation_usage'
  | 'documentation_semantic';

export type SchemaRoleResolutionStatus =
  | 'proven_exact'
  | 'strong_inference_readonly'
  | 'ambiguous'
  | 'conflicting'
  | 'insufficient'
  | 'stale';

export type ExecutionEligibility =
  | 'eligible_for_bounded_readonly'
  | 'eligible_for_bounded_readonly_pilot'
  | 'blocked';

export type TemporalResolutionMode =
  | 'effective_date_range'
  | 'current_snapshot_source'
  | 'exact_current_flag'
  | 'requires_non_select_business_logic'
  | 'unresolved';

export type LogicalRoleId =
  | 'subject_identity'
  | 'subject_display_first_name'
  | 'subject_display_last_name'
  | 'subject_business_number'
  | 'assignment_source'
  | 'subject_reference'
  | 'dictionary_reference'
  | 'dictionary_identity'
  | 'dictionary_display_name'
  | 'valid_from'
  | 'valid_to'
  | 'current_flag'
  | 'assignment_identity'
  | 'assignment_grain';

export type SchemaRoleDiscoveryMode =
  | 'approved_binding_reuse'
  | 'blind_physical_rediscovery';

export type EvidenceOriginClassification =
  | 'logical_only'
  | 'semantic_application_anchor'
  | 'generic_graph_evidence'
  | 'generic_schema_convention'
  | 'production_physical_binding'
  | 'expected_ground_truth_only'
  | 'test_fixture_only';

export type SchemaRoleResolverInput = {
  question: string;
  subjectRole: string;
  targetConcept: string;
  requiredRoles: LogicalRoleId[];
  /**
   * Runtime vs acceptance separation:
   * - approved_binding_reuse: may use Stage 3D approved physical bindings (production)
   * - blind_physical_rediscovery: must NOT receive Stage 3D / prior-pilot physical seeds
   */
  discoveryMode?: SchemaRoleDiscoveryMode;
  /** Confirmed subject source only — never assignment/dictionary physical seeds. */
  confirmedSubjectSource?: {
    owner: string;
    objectType: string;
    objectName: string;
    identityColumn?: string;
    businessNumberColumn?: string;
    firstNameColumn?: string;
    lastNameColumn?: string;
  };
  /** Optional pre-discovered application anchors (logical/UI only). */
  applicationAnchors?: Array<{
    formRef?: string;
    controlName?: string;
    datasetName?: string;
    relationName?: string;
    label?: string;
    evidenceRefs: string[];
  }>;
  temporalIntent?: 'current_on_oracle_sysdate' | 'none';
  /** Injected evidence graph for tests / offline adapters — no human Oracle seeds in pilots. */
  evidenceGraph?: SchemaEvidenceGraph;
  ambiguityMargin?: number;
};

export type EvidenceClaim = {
  family: EvidenceFamily;
  claimType: string;
  subject?: string;
  object?: string;
  column?: string;
  roleHint?: LogicalRoleId | string;
  weight: number;
  provenance: string[];
  notes?: string;
};

export type EvidenceObject = {
  objectRef: string;
  owner?: string;
  objectType?: string;
  objectName: string;
  columns?: Array<{
    name: string;
    dataType?: string;
    nullable?: boolean;
    isPk?: boolean;
    isFk?: boolean;
    references?: string | null;
  }>;
  tags?: string[];
};

export type EvidenceRelation = {
  fromObject: string;
  fromColumn: string;
  toObject: string;
  toColumn: string;
  relationType: string;
  provenance: string[];
  family: EvidenceFamily;
};

export type SchemaEvidenceGraph = {
  objects: EvidenceObject[];
  relations: EvidenceRelation[];
  claims: EvidenceClaim[];
  documentationClaims?: EvidenceClaim[];
};

export type RoleAssignment = {
  role: LogicalRoleId;
  objectRef: string | null;
  column: string | null;
  status: SchemaRoleResolutionStatus;
  evidenceFamiliesSatisfied: EvidenceFamily[];
  evidenceFamiliesMissing: EvidenceFamily[];
  supportingEvidenceRefs: string[];
  contradictingEvidenceRefs: string[];
  explanation: string;
};

export type CandidateObjectAssessment = {
  objectRef: string;
  proposedRoles: LogicalRoleId[];
  status: SchemaRoleResolutionStatus;
  auxiliaryScore: number;
  evidenceFamiliesSatisfied: EvidenceFamily[];
  evidenceFamiliesMissing: EvidenceFamily[];
  supportingEvidenceRefs: string[];
  contradictingEvidenceRefs: string[];
  competingCandidates: string[];
  resolutionExplanation: string;
};

export type RelationPathStep = {
  fromObject: string;
  fromColumn: string;
  toObject: string;
  toColumn: string;
  relationType: string;
  status: SchemaRoleResolutionStatus;
  evidenceRefs: string[];
};

export type TemporalResolution = {
  mode: TemporalResolutionMode;
  validFrom?: { objectRef: string; column: string } | null;
  validTo?: { objectRef: string; column: string } | null;
  currentFlag?: { objectRef: string; column: string; activeValue?: string } | null;
  evidenceFamiliesSatisfied: EvidenceFamily[];
  supportingEvidenceRefs: string[];
  explanation: string;
};

export type SchemaRoleResolutionResult = {
  contractVersion: 'teta-schema-role-resolution-v1';
  input: {
    subjectRole: string;
    targetConcept: string;
    requiredRoles: LogicalRoleId[];
    question: string;
  };
  logicalRoles: LogicalRoleId[];
  candidateObjects: CandidateObjectAssessment[];
  candidateRoleAssignments: RoleAssignment[];
  evidenceByFamily: Record<EvidenceFamily, EvidenceClaim[]>;
  candidateRanking: Array<{ objectRef: string; status: SchemaRoleResolutionStatus; score: number }>;
  competingCandidates: string[];
  resolutionStatuses: Record<string, SchemaRoleResolutionStatus>;
  chosenRelationPath: RelationPathStep[] | null;
  temporalResolution: TemporalResolution;
  roleAssignmentsByRole: Partial<Record<LogicalRoleId, RoleAssignment>>;
  executionEligibility: ExecutionEligibility;
  overallStatus: SchemaRoleResolutionStatus;
  resolutionExplanation: string;
  audit: {
    scenarioSpecificPhysicalMappings: number;
    humanProvidedOracleObjectSeeds: number;
    humanProvidedJoinColumnSeeds: number;
    expectedMappingUsedAsResolverInput: number;
    columnNameAloneAcceptedAsProof: number;
    objectNameAloneAcceptedAsProof: number;
    documentationAloneAcceptedAsPhysicalMapping: number;
    modelOutputAcceptedAsPhysicalMapping: number;
    ambiguousCandidateAutoSelected: number;
    conflictingEvidenceIgnored: number;
    latestRowUsedAsCurrentFallback: number;
    discoveryMode: SchemaRoleDiscoveryMode;
    blindModeStage3dPhysicalBindingsLoaded: number;
    blindModePreviousPilotPhysicalBindingsLoaded: number;
    blindModeExpectedOracleObjectsLoaded: number;
    blindModeExpectedJoinColumnsLoaded: number;
    blindModeExpectedDictionaryLoaded: number;
    blindModeExpectedTemporalColumnsLoaded: number;
    groundTruthUsedBeforeResolution: number;
  };
};

/** Technical families that can satisfy strong_inference_readonly (excl. convention-only). */
export const SCHEMA_ROLE_TECHNICAL_FAMILIES: EvidenceFamily[] = [
  'application_technical',
  'oracle_structural',
  'implementation_usage',
];

/** Convention is an independent family but never counts alone as technical proof. */
export const SCHEMA_ROLE_CONVENTION_FAMILY: EvidenceFamily = 'schema_convention';

export const SCHEMA_ROLE_SEMANTIC_FAMILIES: EvidenceFamily[] = [
  'application_semantic',
  'documentation_semantic',
];
