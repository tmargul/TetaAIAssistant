import fs from 'fs';
import path from 'path';
import {
  STAGE3K2B2A_CONTRACT_VERSION,
  STAGE3K2B2A_GAP_RESOLUTION_POLICY_VERSION,
  sha256,
  stableStringify,
  type TetaHumanDomainEvidenceObservation,
} from './teta-gap.types';

const RECORDED_AT = '2026-08-01T18:00:00.000Z';

function humanObs(
  partial: Omit<
    TetaHumanDomainEvidenceObservation,
    'contractVersion' | 'factKind' | 'actorRole' | 'recordedAt' | 'policyVersion' | 'fingerprint'
  >,
): TetaHumanDomainEvidenceObservation {
  const base = {
    contractVersion: STAGE3K2B2A_CONTRACT_VERSION,
    factKind: 'human_confirmed_business_rule' as const,
    actorRole: 'vendor_domain_expert' as const,
    recordedAt: RECORDED_AT,
    policyVersion: STAGE3K2B2A_GAP_RESOLUTION_POLICY_VERSION,
    ...partial,
  };
  return {
    ...base,
    fingerprint: sha256(stableStringify(base)),
  };
}

/** Vendor domain expert answers H1–H5 — not approvals */
export function buildPilotHumanDomainEvidence(): TetaHumanDomainEvidenceObservation[] {
  return [
    humanObs({
      observationId: 'human:H1:employee-same-master-bounded',
      candidateId: 'cand:P1:employee',
      gapId: 'gap:P1:scope',
      businessRuleKey: 'employee_same_master_in_bounded_areas',
      businessRuleStatement:
        'In personnel, payroll, and occupational_health, “pracownik” means the same primary employee master card.',
      applicability: {
        productFamily: 'teta_hr',
        businessAreas: ['personnel', 'payroll', 'occupational_health'],
      },
      possibleExceptions: [
        'Do not auto-extend to all Teta HR modules',
        'Other areas require separate applicability evidence',
      ],
      effectOnCandidate: 'supports_bounded_scope_confirmation',
      effectOnScope: 'supported_bounded_confirmed',
      effectOnGrain: 'none_business_sameness_not_row_uniqueness',
      effectOnIdentity: 'none',
      dependencyVector: ['gap:P1:scope', 'collectors:P1:completed'],
    }),
    humanObs({
      observationId: 'human:H2:training-participant-dependent',
      candidateId: 'cand:P1:employee',
      gapId: 'gap:P1:scope',
      businessRuleKey: 'training_participant_depends_on_employee',
      businessRuleStatement:
        'training_participant is not an independent or competing person root; every training participant must depend on an existing employee via an employee-identifier relation. Physical path is established from the graph, not from a hardcoded FK name.',
      applicability: {
        productFamily: 'teta_hr',
        businessAreas: ['personnel', 'payroll', 'occupational_health'],
      },
      possibleExceptions: [
        'If graph cannot confirm the dependency relation → dependency_gap (not competing root)',
      ],
      effectOnCandidate: 'reclassify_training_participant_as_dependent_employee_role',
      effectOnScope: 'none',
      effectOnGrain: 'none',
      effectOnIdentity: 'participant_not_alternate_person_root',
      dependencyVector: ['person_root_scan', 'employee_master'],
    }),
    humanObs({
      observationId: 'human:H3:employee-number-string-leading-zeros',
      candidateId: 'cand:P2:employee_identity.employee_number',
      gapId: 'gap:P2:identity',
      businessRuleKey: 'employee_number_string_leading_zeros_significant',
      businessRuleStatement:
        'employee_number is a textual value; leading zeros are significant (“00122” ≠ “122”); must not convert to NUMBER.',
      applicability: { productFamily: 'teta_hr' },
      possibleExceptions: [],
      effectOnCandidate: 'datatype_string_confirmed',
      effectOnScope: 'none',
      effectOnGrain: 'none',
      effectOnIdentity: 'leading_zeros_significant',
      dependencyVector: ['gap:P2:identity'],
    }),
    humanObs({
      observationId: 'human:H4:composite-employee-card-identity',
      candidateId: 'cand:P2:employee_identity.employee_number',
      gapId: 'gap:P2:uniqueness',
      businessRuleKey: 'employee_card_identity_composite_whole_database',
      businessRuleStatement:
        'employee_number alone is not a guaranteed unique employee-card identity. Unique card identity is employee_number + employee_card_number with uniquenessScope=whole_database and firmScoped=false (does not depend on FIRM_ID).',
      applicability: {
        productFamily: 'teta_hr',
        uniquenessScope: 'whole_database',
      },
      possibleExceptions: [],
      effectOnCandidate: 'composite_identity_required',
      effectOnScope: 'none',
      effectOnGrain: 'exact_one_requires_composite',
      effectOnIdentity: 'composite_employee_card_identity',
      dependencyVector: ['gap:P2:uniqueness', 'design:P6', 'design:P7'],
    }),
    humanObs({
      observationId: 'human:H5:reemployment-number-retention',
      candidateId: 'cand:P2:employee_identity.employee_number',
      gapId: 'gap:P2:uniqueness',
      businessRuleKey: 'reemployment_employee_number_may_same_or_different',
      businessRuleStatement:
        'On reemployment, employee_number may stay the same or change; most often it stays the same while employee_card_number differs — not an immutable rule. Do not infer same-person from employee_number alone.',
      applicability: { productFamily: 'teta_hr' },
      possibleExceptions: [
        'same employee_number + new employee_card_number allowed',
        'different employee_number + new employee_card_number allowed',
      ],
      effectOnCandidate: 'no_same_person_inference_from_number_alone',
      effectOnScope: 'none',
      effectOnGrain: 'none',
      effectOnIdentity: 'reemployment_configuration_dependent',
      dependencyVector: ['gap:P2:uniqueness', 'human:H4'],
    }),
  ];
}

export function writeHumanEvidenceLocal(repoRoot: string): string[] {
  const dir = path.join(repoRoot, '.local', 'stage3k2b2a', 'human-evidence');
  fs.mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (const obs of buildPilotHumanDomainEvidence()) {
    const fp = path.join(dir, `${obs.observationId.replace(/:/g, '_')}.json`);
    fs.writeFileSync(fp, JSON.stringify(obs, null, 2), 'utf8');
    paths.push(fp);
  }
  const summary = {
    factKind: 'human_confirmed_business_rule',
    notApproval: true,
    notStage3dMutation: true,
    notReusePolicyActivation: true,
    rules: buildPilotHumanDomainEvidence().map((o) => ({
      key: o.businessRuleKey,
      statement: o.businessRuleStatement,
      applicability: o.applicability,
      effects: {
        candidate: o.effectOnCandidate,
        scope: o.effectOnScope,
        grain: o.effectOnGrain,
        identity: o.effectOnIdentity,
      },
    })),
  };
  const summaryPath = path.join(dir, 'human-evidence-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  paths.push(summaryPath);
  return paths;
}

export const EMPLOYEE_CARD_IDENTITY_MODEL = {
  components: ['employee_number', 'employee_card_number'] as [
    'employee_number',
    'employee_card_number',
  ],
  uniquenessScope: 'whole_database' as const,
  firmScoped: false as const,
  designTargets: {
    P6: 'employee_card_number' as const,
    P7: 'employee_card_identity' as const,
    status: 'design_candidate_dependency_not_approved' as const,
  },
};

export const AMBIGUITY_SURNAME_FIXTURE = {
  fixtureId: 'amb:family-vs-employee-surname',
  question: 'Podaj nazwisko z Członkowie rodziny.',
  candidateRoles: ['employee.surname', 'family_member.surname'],
  expected: 'needs_clarification' as const,
  suggestedClarification:
    'Czy chodzi o nazwisko pracownika, czy nazwisko członka rodziny?',
  autoSelected: false as const,
  screenshotMayIdentifyFormOnly: true,
  screenshotMustNotProveDatabaseColumn: true,
};

export const EMPTY_RESULT_FIXTURES = [
  {
    fixtureId: 'E1',
    semanticResolutionStatus: 'resolved' as const,
    executionStatus: 'completed_empty' as const,
    dataAvailabilityStatus: 'no_matching_rows' as const,
    notes: ['valid_mapping_zero_rows_not_mapping_failure'],
  },
  {
    fixtureId: 'E2',
    semanticResolutionStatus: 'blocked' as const,
    executionStatus: 'not_executed' as const,
    dataAvailabilityStatus: 'mapping_invalid' as const,
    notes: ['invalid_semantic_mapping_blocked_before_execution'],
  },
  {
    fixtureId: 'E3',
    semanticResolutionStatus: 'resolved' as const,
    executionStatus: 'completed_empty' as const,
    dataAvailabilityStatus: 'no_matching_rows' as const,
    notes: ['old_database_current_date_predicate_valid_empty'],
  },
  {
    fixtureId: 'E4',
    semanticResolutionStatus: 'resolved' as const,
    executionStatus: 'completed_with_rows' as const,
    dataAvailabilityStatus: 'rows_present' as const,
    notes: ['historical_period_same_semantic_binding'],
  },
];
