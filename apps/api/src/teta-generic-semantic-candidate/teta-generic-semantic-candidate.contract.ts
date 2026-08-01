import { createHash } from 'crypto';
import {
  STAGE3K2B1_CONTRACT_VERSION,
  STAGE3K2B1_COVERAGE_TARGET_VERSION,
  STAGE3K2B1_DECISION_CONTRACT_VERSION,
  type ExpectedValueKind,
  type IndependentEvidenceFamily,
  type RiskClass,
  type TetaGenericSemanticBindingCandidate,
  type TetaSemanticCoverageTarget,
} from './teta-generic-semantic-candidate.types';

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
    return out;
  }
  return value;
}

const ORACLE_NAME_RE =
  /\b(NT_[A-Z0-9_]+|TETA_ADMIN|NR_EWIDENCYJNY|DATA_OD|DATA_DO|SSTN_ID|JEOR_ID|PRAC_ID)\b/i;
const GRAPH_ID_RE =
  /\b(oracle-object:|oracle-column:|oracle-package:|form:|control:|join:)/i;

export function validateCoverageTarget(target: TetaSemanticCoverageTarget): string[] {
  const errors: string[] = [];
  if (target.contractVersion !== STAGE3K2B1_COVERAGE_TARGET_VERSION) {
    errors.push('coverage_target_version_mismatch');
  }
  for (const req of [
    'targetId',
    'conceptKey',
    'roleKey',
    'semanticMeaning',
    'expectedResultGrain',
    'expectedValueKind',
    'riskClass',
    'requiredDataDomain',
    'candidateSearchPolicy',
  ] as const) {
    if (!(target as Record<string, unknown>)[req]) errors.push(`missing:${req}`);
  }
  if (!target.applicabilityHint) errors.push('missing:applicabilityHint');
  const blob = JSON.stringify(target);
  if (ORACLE_NAME_RE.test(blob) || GRAPH_ID_RE.test(blob)) {
    errors.push('coverage_target_must_not_contain_oracle_or_graph_ids');
  }
  return errors;
}

export function validateCandidate(candidate: TetaGenericSemanticBindingCandidate): string[] {
  const errors: string[] = [];
  if (candidate.contractVersion !== STAGE3K2B1_CONTRACT_VERSION) {
    errors.push('candidate_version_mismatch');
  }
  if (!candidate.candidateFingerprint) errors.push('missing:candidateFingerprint');
  if (!candidate.candidateEvaluationFingerprint) {
    errors.push('missing:candidateEvaluationFingerprint');
  }
  if (candidate.candidateFingerprint === candidate.candidateEvaluationFingerprint) {
    // Allowed only if policy version somehow collapses — normally they differ.
  }
  if (candidate.readyForHumanReview && candidate.reviewPackStatus !== 'generated') {
    // legacy: pack generation flag
  }
  if (
    candidate.evidenceAssessment === 'sufficient_for_decision' &&
    candidate.approvalReadiness !== 'ready_for_approval_decision'
  ) {
    errors.push('sufficient_for_decision_requires_ready_for_approval_decision');
  }
  if (
    candidate.evidenceAssessment === 'sufficient_for_decision' &&
    candidate.evaluationTrace?.blockingReasons?.length
  ) {
    errors.push('sufficient_for_decision_with_blocking_reasons');
  }
  // Never "approved" as assessment
  if ((candidate.candidateEvidenceAssessment as string) === 'approved') {
    errors.push('assessment_must_not_be_approved');
  }
  if ((candidate.evidenceAssessment as string) === 'approved') {
    errors.push('evidence_assessment_must_not_be_approved');
  }
  return errors;
}

export function assertNoProductionMutation(counters: {
  stage3dProductionBindingsAdded: number;
  stage3dProductionBindingsModified: number;
  reusePolicyEntriesAdded: number;
  reusePolicyEntriesModified: number;
  realDecisionEventsApplied: number;
  realApprovedGenericBindingsCreated: number;
  planningEligibleBindingsAdded: number;
}): string[] {
  const errors: string[] = [];
  for (const [k, v] of Object.entries(counters)) {
    if (v !== 0) errors.push(`production_mutation_nonzero:${k}=${v}`);
  }
  return errors;
}

export const INDEPENDENT_EVIDENCE_FAMILIES: IndependentEvidenceFamily[] = [
  'oracle_metadata_ddl',
  'application_form_control',
  'dataset_gateway_join',
  'sqljoin_reconstruction',
  'lookup_display_path',
  'help_semantic_mapping',
  'package_dependency',
];

export function isIndependentEvidenceFamily(v: string): v is IndependentEvidenceFamily {
  return (INDEPENDENT_EVIDENCE_FAMILIES as string[]).includes(v);
}

/** Map Stage 3A / Stage 3D graph node id prefixes to technical evidence families. */
export function familyFromGraphNodeId(nodeId: string): IndependentEvidenceFamily | null {
  if (nodeId.startsWith('oracle-object:') || nodeId.startsWith('oracle-column:')) {
    return 'oracle_metadata_ddl';
  }
  if (nodeId.startsWith('form:') || nodeId.startsWith('control:')) {
    return 'application_form_control';
  }
  if (nodeId.startsWith('join:')) {
    // Dataset gateway joins (BO.*) vs reconstructed SQL join nodes share join: prefix;
    // Stage 3D evidenceType distinguishes when available; default gateway for BO joins.
    if (nodeId.includes('.BO.') || nodeId.includes('bos')) return 'dataset_gateway_join';
    return 'sqljoin_reconstruction';
  }
  if (nodeId.startsWith('oracle-package:')) return 'package_dependency';
  if (nodeId.startsWith('help:')) return 'help_semantic_mapping';
  if (nodeId.startsWith('lookup:') || nodeId.startsWith('value-path:')) {
    return 'lookup_display_path';
  }
  return null;
}

export function familyFromEvidenceType(evidenceType: string | undefined | null): IndependentEvidenceFamily | null {
  if (!evidenceType) return null;
  if (evidenceType === 'vendor_confirmed_relation') return 'dataset_gateway_join';
  if (evidenceType === 'reconstructed_sql_join') return 'sqljoin_reconstruction';
  if (evidenceType === 'lookup_display_path') return 'lookup_display_path';
  return null;
}

export const RISK_CLASSES: RiskClass[] = [
  'normal_reference',
  'temporal_sensitive',
  'configuration_sensitive',
  'payroll_sensitive',
  'identity_sensitive',
];

export const VALUE_KINDS: ExpectedValueKind[] = [
  'business_value',
  'foreign_key_identity',
  'display_business_value',
  'identity_string',
  'identity_number',
  'boolean_existence',
];

export { STAGE3K2B1_CONTRACT_VERSION, STAGE3K2B1_DECISION_CONTRACT_VERSION };
