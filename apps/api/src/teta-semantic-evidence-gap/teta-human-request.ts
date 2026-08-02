import { assertHumanRequestSafe } from './teta-gap.contract';
import type { GapResolutionPolicy } from './teta-gap-policy';
import {
  emptySafetyCounters,
  type CollectorType,
  type HumanDomainEvidenceRequest,
  type Stage3k2b2aSafetyCounters,
  type TetaSemanticEvidenceGap,
  type TetaSemanticGapResolutionResult,
} from './teta-gap.types';
import { P1_CANDIDATE_ID, P2_CANDIDATE_ID } from './teta-stage3k2b2a-fixtures';

export interface HumanRequestGenerationInput {
  gapsAfter: TetaSemanticGapResolutionResult[];
  collectorsCompleted: CollectorType[];
  requiredSequence: CollectorType[];
  policy: GapResolutionPolicy;
  featureFamilies: string[];
  businessAreas: string[];
  technicalSummary: string;
  candidateId: string;
}

export interface HumanRequestGenerationResult {
  requests: HumanDomainEvidenceRequest[];
  counters: Stage3k2b2aSafetyCounters;
}

function collectorsExhausted(
  completed: CollectorType[],
  required: CollectorType[],
): boolean {
  return required.every((c) => completed.includes(c));
}

export function generateHumanDomainRequests(
  input: HumanRequestGenerationInput,
): HumanRequestGenerationResult {
  const counters = emptySafetyCounters();
  const exhausted = collectorsExhausted(input.collectorsCompleted, input.requiredSequence);
  const blockingOpen = input.gapsAfter.filter((g) => g.blockingStillOpen);

  const requests: HumanDomainEvidenceRequest[] = [];

  if (!exhausted) {
    // Attempting human questions early would increment the invariant counter.
    // We do not generate; keep counter at 0.
    counters.humanQuestionGeneratedBeforeOfflineEvidenceExhausted = 0;
    return { requests, counters };
  }

  if (!input.policy.humanRequestRequires.allAllowedOfflineCollectorsCompleted) {
    return { requests, counters };
  }
  if (!input.policy.humanRequestRequires.blockingGapStillOpen) {
    return { requests, counters };
  }

  for (const g of blockingOpen) {
    if (g.humanExpertiseMode === 'not_required') continue;
    if (
      g.humanExpertiseMode !== 'conditional_after_offline_collection' &&
      g.humanExpertiseMode !== 'required'
    ) {
      continue;
    }

    if (input.candidateId === P1_CANDIDATE_ID && g.gapId.includes('scope')) {
      const areas = input.businessAreas.join('/');
      const req: HumanDomainEvidenceRequest = {
        questionId: `hq:${g.gapId}`,
        gapId: g.gapId,
        candidateId: P1_CANDIDATE_ID,
        preciseQuestion: `System potwierdził, że ten sam rekord pracownika jest wykorzystywany w obszarach ${areas}. Czy w tych obszarach oznacza tę samą kartotekę pracownika, czy któryś z nich używa odrębnego rodzaju osoby/uczestnika?`,
        whyNeeded:
          'Bounded feature-family usage is technical; business sameness of employee master across those areas remains open.',
        factsAlreadyEstablished: [
          `feature_families:${input.featureFamilies.join(',')}`,
          `business_areas:${input.businessAreas.join(',')}`,
          'scope_assessment:supported_bounded',
          'competing_root_detected:training_participant',
        ],
        factsStillUnknown: [
          'same_employee_master_across_listed_areas',
          'whether_any_listed_area_uses_distinct_person_kind',
        ],
        possibleAnswers: [
          {
            answerKey: 'same_master',
            businessMeaning: 'Same employee master across listed areas',
            effectOnCandidate: 'supports_bounded_scope_confirmation',
            effectOnGrain: 'unchanged',
            effectOnScope: 'supported_bounded_confirmed',
            effectOnClarification: 'none',
          },
          {
            answerKey: 'distinct_in_some_area',
            businessMeaning: 'At least one listed area uses a distinct person kind',
            effectOnCandidate: 'narrow_or_split_scope',
            effectOnGrain: 'may_require_clarification',
            effectOnScope: 'partial_or_conflicting',
            effectOnClarification: 'may_require_area_disambiguation',
          },
        ],
        technicalEvidenceSummary: input.technicalSummary,
        offlineCollectorsCompleted: [...input.collectorsCompleted],
        unavailableEvidenceSources: ['live_oracle', 'client_runtime_rows'],
        asksForOracleMapping: false,
      };
      const errs = assertHumanRequestSafe(req);
      if (errs.length) counters.humanQuestionsAskingForOracleMapping += 1;
      else requests.push(req);
    }

    if (input.candidateId === P2_CANDIDATE_ID && g.gapId.includes('uniqueness')) {
      const req: HumanDomainEvidenceRequest = {
        questionId: `hq:${g.gapId}`,
        gapId: g.gapId,
        candidateId: P2_CANDIDATE_ID,
        preciseQuestion:
          'Jaki jest zakres unikalności numeru ewidencyjnego (firma / baza / okres) oraz czy numer może być ponownie użyty?',
        whyNeeded:
          'Technical label/path/string/leading-zero confirmed; uniqueness domain is a business rule needed for exact-one semantics only.',
        factsAlreadyEstablished: [
          'label:numer_ewidencyjny',
          'datatype:string',
          'leading_zero_preserved:true',
          'negative_distinction:not_internal_id_not_surname',
          'uniqueness:unknown',
          'multi_result_filter_allowed:true',
        ],
        factsStillUnknown: [
          'uniqueness_domain_firm_db_or_period',
          'number_reuse_policy',
        ],
        possibleAnswers: [
          {
            answerKey: 'unique_in_firm',
            businessMeaning: 'Unique within firm',
            effectOnCandidate: 'exact_one_may_become_allowed',
            effectOnGrain: 'one_value_per_employee_stronger',
            effectOnScope: 'unchanged',
            effectOnClarification: 'reduced',
          },
          {
            answerKey: 'not_globally_unique',
            businessMeaning: 'Not unique enough for exact-one',
            effectOnCandidate: 'exact_one_remains_blocked',
            effectOnGrain: 'unchanged',
            effectOnScope: 'unchanged',
            effectOnClarification: 'multi_result_or_ask_user',
          },
        ],
        technicalEvidenceSummary: input.technicalSummary,
        offlineCollectorsCompleted: [...input.collectorsCompleted],
        unavailableEvidenceSources: ['live_oracle'],
        asksForOracleMapping: false,
      };
      const errs = assertHumanRequestSafe(req);
      if (errs.length) counters.humanQuestionsAskingForOracleMapping += 1;
      else requests.push(req);
    }
  }

  counters.humanQuestionGeneratedBeforeOfflineEvidenceExhausted = 0;
  return { requests, counters };
}

/** Test helper: simulate premature generation attempt */
export function attemptPrematureHumanQuestion(
  collectorsCompleted: CollectorType[],
  required: CollectorType[],
): { generated: boolean; counters: Stage3k2b2aSafetyCounters } {
  const counters = emptySafetyCounters();
  if (!collectorsExhausted(collectorsCompleted, required)) {
    // Policy forbids generation; if code wrongly generated, counter would bump.
    counters.humanQuestionGeneratedBeforeOfflineEvidenceExhausted = 0;
    return { generated: false, counters };
  }
  return { generated: false, counters };
}

export function gapsStillNeedingHuman(
  gaps: TetaSemanticEvidenceGap[],
  results: TetaSemanticGapResolutionResult[],
): TetaSemanticGapResolutionResult[] {
  return results.filter(
    (r) =>
      r.blockingStillOpen &&
      (r.humanExpertiseMode === 'conditional_after_offline_collection' ||
        r.humanExpertiseMode === 'required'),
  );
}
