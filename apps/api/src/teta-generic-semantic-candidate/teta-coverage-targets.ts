import {
  STAGE3K2B1_COVERAGE_TARGET_VERSION,
  type TetaSemanticCoverageTarget,
} from './teta-generic-semantic-candidate.types';

const BASE_APPLICABILITY = {
  productFamily: 'teta_hr',
  productSurface: 'generic_semantic_readonly',
  businessArea: 'workforce',
  clientScope: 'bounded_teta_hr',
  versionScope: 'v1_pilot',
} as const;

/** Real pilot coverage targets P1–P4 only. No Oracle names. */
export const PILOT_COVERAGE_TARGETS: TetaSemanticCoverageTarget[] = [
  {
    contractVersion: STAGE3K2B1_COVERAGE_TARGET_VERSION,
    targetId: 'P1',
    conceptKey: 'employee',
    roleKey: 'employee',
    semanticMeaning: 'Canonical employee subject / master person record in Teta HR.',
    expectedResultGrain: 'one_row_per_employee',
    expectedValueKind: 'business_value',
    riskClass: 'normal_reference',
    requiredDataDomain: 'hr_employee_master',
    applicabilityHint: { ...BASE_APPLICABILITY },
    temporalRequirement: null,
    displayRequirement: null,
    candidateSearchPolicy: 'approved_anchors_only',
  },
  {
    contractVersion: STAGE3K2B1_COVERAGE_TARGET_VERSION,
    targetId: 'P2',
    conceptKey: 'employee_identity',
    roleKey: 'employee_identity.employee_number',
    semanticMeaning:
      'Employee registry number identity facet; string-preserving including leading zeros; not internal id; not surname.',
    expectedResultGrain: 'one_value_per_employee',
    expectedValueKind: 'identity_string',
    riskClass: 'identity_sensitive',
    requiredDataDomain: 'hr_employee_identity',
    applicabilityHint: { ...BASE_APPLICABILITY },
    temporalRequirement: null,
    displayRequirement: null,
    candidateSearchPolicy: 'approved_anchors_only',
  },
  {
    contractVersion: STAGE3K2B1_COVERAGE_TARGET_VERSION,
    targetId: 'P3',
    conceptKey: 'current_position',
    roleKey: 'current_position',
    semanticMeaning:
      'Employee current position assignment relation with open-ended temporal interval; display is separate.',
    expectedResultGrain: 'zero_or_one_per_employee',
    expectedValueKind: 'business_value',
    riskClass: 'temporal_sensitive',
    requiredDataDomain: 'hr_position_assignment',
    applicabilityHint: { ...BASE_APPLICABILITY },
    temporalRequirement: 'effective_on_report_clock_open_ended_end_allowed',
    displayRequirement: 'separate_from_relation',
    candidateSearchPolicy: 'approved_anchors_only',
  },
  {
    contractVersion: STAGE3K2B1_COVERAGE_TARGET_VERSION,
    targetId: 'P4',
    conceptKey: 'position_name',
    roleKey: 'position_name',
    semanticMeaning:
      'Business display name of a position via foreign identity lookup; not the foreign key identity itself.',
    expectedResultGrain: 'one_value_per_employee',
    expectedValueKind: 'display_business_value',
    riskClass: 'normal_reference',
    requiredDataDomain: 'hr_position_dictionary',
    applicabilityHint: { ...BASE_APPLICABILITY },
    temporalRequirement: null,
    displayRequirement: 'lookup_display_path_required',
    candidateSearchPolicy: 'approved_anchors_only',
  },
];

export function getPilotTarget(targetId: string): TetaSemanticCoverageTarget | undefined {
  return PILOT_COVERAGE_TARGETS.find((t) => t.targetId === targetId);
}

export function listPilotTargetIds(): string[] {
  return PILOT_COVERAGE_TARGETS.map((t) => t.targetId);
}
