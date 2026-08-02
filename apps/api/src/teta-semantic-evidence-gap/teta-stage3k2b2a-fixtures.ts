import {
  STAGE3K2B2A_COLLECTOR_VERSION,
  STAGE3K2B2A_CONTRACT_VERSION,
  type CollectorType,
  type TetaApplicationFeatureFamilyEvidence,
  type TetaSemanticEvidenceGap,
  type TetaSemanticEvidenceObservation,
} from './teta-gap.types';

export const FIXTURE_GRAPH_SOURCE_HASH =
  '2e7f0b7e323f0703cbea3f8f9d2b709590899edfb789f1ee5943496c717f73c3';

export const P1_CANDIDATE_ID = 'cand:P1:employee';
export const P2_CANDIDATE_ID = 'cand:P2:employee_identity.employee_number';
export const P1_CANDIDATE_FINGERPRINT =
  '348b9f76b05e770ac7321fc09bfb2bc333d03dea99e6e78f5fd18ecde37f1327';
export const P2_CANDIDATE_FINGERPRINT =
  'd82ac7e7c6997b1973eb9e3a284951e972c6399c036e8c695f8793917d275997';

/** Classified registries — not form-name inference */
export const FEATURE_FAMILY_REGISTRY: TetaApplicationFeatureFamilyEvidence[] = [
  {
    featureFamilyKey: 'occupational_health_examinations',
    productFamily: 'teta_hr',
    productSurface: 'teta_desktop',
    businessArea: 'occupational_health',
    formRefs: ['form:bhp-exam-card'],
    gatewayRefs: ['gateway:bhp-exam-bo'],
    originObservationGroups: ['obs:gateway:bhp-exam-bo'],
    classificationEvidence: [
      'product_registry:teta_hr',
      'business_area_registry:occupational_health',
      'plugin_ownership:plgBadaniaBHP',
    ],
    classificationStatus: 'classified',
  },
  {
    featureFamilyKey: 'personnel_employee_master',
    productFamily: 'teta_hr',
    productSurface: 'teta_desktop',
    businessArea: 'personnel',
    formRefs: ['form:employee-card'],
    gatewayRefs: ['gateway:employee-master-bo'],
    originObservationGroups: ['obs:gateway:employee-master-bo'],
    classificationEvidence: [
      'product_registry:teta_hr',
      'business_area_registry:personnel',
      'plugin_ownership:plgKadry',
      'application_hierarchy:personel/kartoteka',
    ],
    classificationStatus: 'classified',
  },
  {
    featureFamilyKey: 'payroll_employee_reference',
    productFamily: 'teta_hr',
    productSurface: 'teta_desktop',
    businessArea: 'payroll',
    formRefs: ['form:payroll-list'],
    gatewayRefs: ['gateway:payroll-list-bo'],
    originObservationGroups: ['obs:gateway:payroll-list-bo'],
    classificationEvidence: [
      'product_registry:teta_hr',
      'business_area_registry:payroll',
      'plugin_ownership:plgPlace',
    ],
    classificationStatus: 'classified',
  },
];

/** Same gateway shared by two forms — must NOT count as two independent families */
export const SHARED_GATEWAY_FORMS = {
  gatewayRef: 'gateway:shared-bhp-bo',
  observationGroup: 'obs:gateway:shared-bhp-bo',
  formRefs: ['form:bhp-view-a', 'form:bhp-view-b'],
};

export function initialGapsP1(): TetaSemanticEvidenceGap[] {
  return [
    {
      contractVersion: STAGE3K2B2A_CONTRACT_VERSION,
      gapId: 'gap:P1:scope',
      candidateId: P1_CANDIDATE_ID,
      gapType: 'scope_applicability_gap',
      blockingRuleId: 'scope.unprovenBlocks',
      description: 'Scope expansion from BHP home to bounded_teta_hr unproven',
      requiredEvidence: ['bounded_feature_family_usage', 'classified_independent_families'],
      currentEvidenceRefs: ['ev:prior:bhp-employee'],
      resolutionStatus: 'collectable_offline',
      resolutionRisk: 'scope_overclaim',
      allowedCollectors: [
        'stage3a_anchor_trace_collector',
        'form_usage_collector',
        'gateway_lineage_collector',
        'cross_form_usage_collector',
        'scope_usage_collector',
        'competing_root_collector',
        'help_semantic_label_collector',
        'constraint_metadata_collector',
      ],
      humanExpertiseMode: 'conditional_after_offline_collection',
      dependencyGapIds: [],
    },
    {
      contractVersion: STAGE3K2B2A_CONTRACT_VERSION,
      gapId: 'gap:P1:grain',
      candidateId: P1_CANDIDATE_ID,
      gapType: 'result_grain_gap',
      blockingRuleId: 'grain.employeeGrainEvidence',
      description: 'Employee grain only partial from BHP context',
      requiredEvidence: ['employee_grain_support', 'pk_or_duplicate_model'],
      currentEvidenceRefs: ['ev:prior:bhp-employee'],
      resolutionStatus: 'collectable_offline',
      resolutionRisk: 'wrong_grain',
      allowedCollectors: [
        'stage3a_anchor_trace_collector',
        'constraint_metadata_collector',
        'gateway_lineage_collector',
      ],
      humanExpertiseMode: 'conditional_after_offline_collection',
      dependencyGapIds: [],
    },
  ];
}

export function initialGapsP2(): TetaSemanticEvidenceGap[] {
  return [
    {
      contractVersion: STAGE3K2B2A_CONTRACT_VERSION,
      gapId: 'gap:P2:dependency',
      candidateId: P2_CANDIDATE_ID,
      gapType: 'dependency_gap',
      blockingRuleId: 'identity.employeeGrainDependency',
      description: 'P1 employee dependency pending',
      requiredEvidence: ['employee_grain_dependency_satisfied'],
      currentEvidenceRefs: ['ev:prior:bhp-employee-number'],
      resolutionStatus: 'collectable_offline',
      resolutionRisk: 'orphan_identity',
      allowedCollectors: ['dependency_evidence_collector'],
      humanExpertiseMode: 'not_required',
      dependencyGapIds: ['gap:P1:scope', 'gap:P1:grain'],
    },
    {
      contractVersion: STAGE3K2B2A_CONTRACT_VERSION,
      gapId: 'gap:P2:scope',
      candidateId: P2_CANDIDATE_ID,
      gapType: 'scope_applicability_gap',
      blockingRuleId: 'scope.unprovenBlocks',
      description: 'Identity facet scope unproven beyond BHP',
      requiredEvidence: ['bounded_feature_family_usage'],
      currentEvidenceRefs: ['ev:prior:bhp-employee-number'],
      resolutionStatus: 'collectable_offline',
      resolutionRisk: 'scope_overclaim',
      allowedCollectors: [
        'help_semantic_label_collector',
        'form_usage_collector',
        'gateway_lineage_collector',
        'scope_usage_collector',
        'constraint_metadata_collector',
        'dependency_evidence_collector',
      ],
      humanExpertiseMode: 'conditional_after_offline_collection',
      dependencyGapIds: ['gap:P1:scope'],
    },
    {
      contractVersion: STAGE3K2B2A_CONTRACT_VERSION,
      gapId: 'gap:P2:identity',
      candidateId: P2_CANDIDATE_ID,
      gapType: 'identity_facet_gap',
      blockingRuleId: 'identity.exactSemanticEvidence',
      description: 'Confirm label/path/string/leading-zero and uniqueness domain',
      requiredEvidence: [
        'semantic_label',
        'string_datatype',
        'leading_zero_preservation',
        'negative_distinction',
      ],
      currentEvidenceRefs: ['ev:prior:bhp-employee-number'],
      resolutionStatus: 'collectable_offline',
      resolutionRisk: 'wrong_identity_facet',
      allowedCollectors: [
        'help_semantic_label_collector',
        'form_usage_collector',
        'gateway_lineage_collector',
        'constraint_metadata_collector',
      ],
      humanExpertiseMode: 'conditional_after_offline_collection',
      dependencyGapIds: [],
    },
    {
      contractVersion: STAGE3K2B2A_CONTRACT_VERSION,
      gapId: 'gap:P2:uniqueness',
      candidateId: P2_CANDIDATE_ID,
      gapType: 'uniqueness_gap',
      blockingRuleId: 'identity.uniquenessUnknown',
      description: 'Uniqueness domain unknown; do not invent',
      requiredEvidence: ['uniqueness_domain_business_rule'],
      currentEvidenceRefs: [],
      resolutionStatus: 'open',
      resolutionRisk: 'exact_one_unsafe',
      allowedCollectors: ['constraint_metadata_collector'],
      humanExpertiseMode: 'conditional_after_offline_collection',
      dependencyGapIds: ['gap:P2:identity'],
    },
  ];
}

export function obs(
  partial: Omit<TetaSemanticEvidenceObservation, 'collectorVersion' | 'graphSourceHash' | 'sourceStageVersion'> & {
    collectorVersion?: string;
    graphSourceHash?: string;
    sourceStageVersion?: string;
  },
): TetaSemanticEvidenceObservation {
  return {
    graphSourceHash: FIXTURE_GRAPH_SOURCE_HASH,
    sourceStageVersion: 'stage3a-index-v1',
    collectorVersion: STAGE3K2B2A_COLLECTOR_VERSION,
    ...partial,
  };
}

export const P1_COLLECTORS: CollectorType[] = [
  'stage3a_anchor_trace_collector',
  'form_usage_collector',
  'gateway_lineage_collector',
  'cross_form_usage_collector',
  'scope_usage_collector',
  'competing_root_collector',
  'help_semantic_label_collector',
  'constraint_metadata_collector',
];

export const P2_COLLECTORS: CollectorType[] = [
  'help_semantic_label_collector',
  'form_usage_collector',
  'gateway_lineage_collector',
  'dependency_evidence_collector',
  'constraint_metadata_collector',
  'scope_usage_collector',
];
