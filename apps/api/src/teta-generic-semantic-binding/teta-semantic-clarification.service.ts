import type {
  ApprovalReuseStatus,
  SemanticEvidenceStatus,
  SemanticReusePolicyFile,
  TetaSemanticClarification,
  TetaSemanticClarificationCandidate,
} from './teta-generic-semantic-binding.types';
import { resolveApprovalReuse } from './teta-generic-semantic-binding.policy';

function cand(
  partial: Omit<
    TetaSemanticClarificationCandidate,
    'selectionRequired' | 'selectionDoesNotAuthorizeExecution'
  >,
): TetaSemanticClarificationCandidate {
  return {
    ...partial,
    selectionRequired: true,
    selectionDoesNotAuthorizeExecution: true,
  };
}

export function clarificationDepartment(): TetaSemanticClarification {
  return {
    clarificationId: 'clarify:department',
    subject: 'dział',
    question: 'Co masz na myśli przez „dział”?',
    candidates: [
      cand({
        candidateId: 'ou_candidate',
        businessConceptKey: 'organizational_unit',
        roleKey: 'organizational_unit',
        label: 'jednostka organizacyjna',
        whyPlausible: 'Possible structural meaning; reuse not auto-approved for generic scope',
        evidenceStatus: 'partial',
        approvalReuseStatus: 'approved_scope_restricted',
        applicability: 'candidate_only',
        temporalMeaning: null,
      }),
      cand({
        candidateId: 'other_department',
        businessConceptKey: null,
        roleKey: null,
        label: 'inne znaczenie działu',
        whyPlausible: 'Unresolved alternative without approved binding',
        evidenceStatus: 'missing',
        approvalReuseStatus: 'not_approved',
        applicability: 'unbound',
        temporalMeaning: null,
      }),
    ],
  };
}

export function clarificationEmploymentDate(): TetaSemanticClarification {
  return {
    clarificationId: 'clarify:employment_date',
    subject: 'data zatrudnienia',
    question: 'Którą datę zatrudnienia masz na myśli?',
    candidates: [
      cand({
        candidateId: 'first_employment',
        businessConceptKey: null,
        roleKey: null,
        label: 'pierwsza data zatrudnienia',
        whyPlausible: 'Unbound meaning; no approved Stage 3D role',
        evidenceStatus: 'missing',
        approvalReuseStatus: 'not_approved',
        applicability: 'unbound',
        temporalMeaning: null,
      }),
      cand({
        candidateId: 'current_contract_start',
        businessConceptKey: null,
        roleKey: null,
        label: 'początek bieżącej umowy',
        whyPlausible: 'Unbound meaning; active_employment is filter_only, not date attribute',
        evidenceStatus: 'missing',
        approvalReuseStatus: 'not_approved',
        applicability: 'unbound',
        temporalMeaning: 'current_contract',
      }),
    ],
  };
}

export function clarificationCompensation(): TetaSemanticClarification {
  return {
    clarificationId: 'clarify:compensation',
    subject: 'wynagrodzenie',
    question: 'Które znaczenie wynagrodzenia masz na myśli?',
    candidates: [
      cand({
        candidateId: 'base_salary',
        businessConceptKey: null,
        roleKey: null,
        label: 'wynagrodzenie zasadnicze',
        whyPlausible: 'Unbound clarification vocabulary',
        evidenceStatus: 'missing',
        approvalReuseStatus: 'not_approved',
        applicability: 'unbound',
        temporalMeaning: null,
      }),
      cand({
        candidateId: 'payroll_result',
        businessConceptKey: null,
        roleKey: null,
        label: 'wynik naliczenia / lista',
        whyPlausible: 'Unbound; Stage 3I/3J engines are not schema bindings',
        evidenceStatus: 'missing',
        approvalReuseStatus: 'not_approved',
        applicability: 'unbound',
        temporalMeaning: null,
      }),
      cand({
        candidateId: 'employee_cost',
        businessConceptKey: null,
        roleKey: null,
        label: 'koszt pracownika',
        whyPlausible: 'Unbound clarification vocabulary',
        evidenceStatus: 'missing',
        approvalReuseStatus: 'not_approved',
        applicability: 'unbound',
        temporalMeaning: null,
      }),
    ],
  };
}

/**
 * S4: two candidates whose approvalReuseStatus comes from the policy evaluator
 * under an explicit non-production fixturePolicyOverride.
 */
export function clarificationTwoApprovedCandidates(
  policy: SemanticReusePolicyFile,
): TetaSemanticClarification {
  if (!policy.fixturePolicyOverride || policy.fixturePolicyOverride.productionPolicy !== false) {
    throw new Error('s4_requires_explicit_fixture_policy_override');
  }
  const reuseA = resolveApprovalReuse('synthetic_role_a', 'generic_test', policy);
  const reuseB = resolveApprovalReuse('synthetic_role_b', 'generic_test', policy);
  const evidence = (r: ApprovalReuseStatus): SemanticEvidenceStatus =>
    r === 'approved_exact_scope' || r === 'approved_reusable_role' ? 'proven' : 'partial';

  return {
    clarificationId: 'clarify:two_approved',
    subject: 'ambiguous_role',
    question: 'Które znaczenie wybrać?',
    fixturePolicyOverride: {
      id: policy.fixturePolicyOverride.id,
      productionPolicy: false,
    },
    candidates: [
      cand({
        candidateId: 'a',
        businessConceptKey: 'concept_a',
        roleKey: 'synthetic_role_a',
        label: 'znaczenie A',
        whyPlausible: 'Policy-evaluated synthetic candidate A',
        evidenceStatus: evidence(reuseA),
        approvalReuseStatus: reuseA,
        applicability: 'generic',
        temporalMeaning: null,
      }),
      cand({
        candidateId: 'b',
        businessConceptKey: 'concept_b',
        roleKey: 'synthetic_role_b',
        label: 'znaczenie B',
        whyPlausible: 'Policy-evaluated synthetic candidate B',
        evidenceStatus: evidence(reuseB),
        approvalReuseStatus: reuseB,
        applicability: 'generic',
        temporalMeaning: null,
      }),
    ],
  };
}

export function evidenceFromReuse(reuse: ApprovalReuseStatus): SemanticEvidenceStatus {
  if (reuse === 'approved_exact_scope' || reuse === 'approved_reusable_role') return 'proven';
  if (reuse === 'approved_scope_restricted' || reuse === 'approved_scope_mismatch') return 'partial';
  return 'missing';
}
