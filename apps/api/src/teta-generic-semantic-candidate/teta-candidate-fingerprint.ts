import { sha256, stableStringify } from './teta-generic-semantic-candidate.contract';
import type {
  TetaGenericSemanticBindingCandidate,
  TetaGenericSemanticBindingDecision,
} from './teta-generic-semantic-candidate.types';

/** Payload used for semantic candidate identity (excludes evaluation policy / actor / decision). */
export type CandidateFingerprintPayload = {
  conceptKey: string;
  roleKey: string;
  semanticMeaning: string;
  relationMeaning: string | null;
  valueKind: string;
  resultGrain: string;
  applicability: TetaGenericSemanticBindingCandidate['applicability'];
  temporalPolicy: TetaGenericSemanticBindingCandidate['temporalPolicy'];
  evidenceBundle: Array<{
    family: string;
    lineageKey: string;
    strength: string;
    supports: string[];
  }>;
  graphSourceHash: string;
  dependencyVector: TetaGenericSemanticBindingCandidate['dependencyVector'];
  knownGaps: string[];
  ambiguities: string[];
  conflicts: string[];
  identitySemantics?: TetaGenericSemanticBindingCandidate['identitySemantics'];
  displaySemantics?: TetaGenericSemanticBindingCandidate['displaySemantics'];
  scopeAssessment?: TetaGenericSemanticBindingCandidate['scopeAssessment'];
  resultGrainAssessment?: TetaGenericSemanticBindingCandidate['resultGrainAssessment'];
  requiredBindingDependencies?: TetaGenericSemanticBindingCandidate['requiredBindingDependencies'];
};

export function buildCandidateFingerprintPayload(
  c: Partial<TetaGenericSemanticBindingCandidate> &
    Pick<
      TetaGenericSemanticBindingCandidate,
      | 'conceptKey'
      | 'roleKey'
      | 'semanticMeaning'
      | 'relationMeaning'
      | 'valueKind'
      | 'resultGrain'
      | 'applicability'
      | 'temporalPolicy'
      | 'underlyingEvidenceRefs'
      | 'graphSourceHash'
      | 'dependencyVector'
      | 'knownGaps'
      | 'ambiguities'
      | 'conflicts'
    >,
): CandidateFingerprintPayload {
  const evidenceBundle = [...(c.underlyingEvidenceRefs ?? [])]
    .map((e) => ({
      family: e.family,
      lineageKey: e.lineageKey,
      strength: e.strength,
      supports: [...e.supports].sort(),
    }))
    .sort((a, b) =>
      `${a.family}:${a.lineageKey}`.localeCompare(`${b.family}:${b.lineageKey}`),
    );
  return {
    conceptKey: c.conceptKey,
    roleKey: c.roleKey,
    semanticMeaning: c.semanticMeaning,
    relationMeaning: c.relationMeaning,
    valueKind: c.valueKind,
    resultGrain: c.resultGrain,
    applicability: c.applicability,
    temporalPolicy: c.temporalPolicy,
    evidenceBundle,
    graphSourceHash: c.graphSourceHash,
    dependencyVector: c.dependencyVector,
    knownGaps: [...c.knownGaps].sort(),
    ambiguities: [...c.ambiguities].sort(),
    conflicts: [...c.conflicts].sort(),
    identitySemantics: c.identitySemantics,
    displaySemantics: c.displaySemantics,
    scopeAssessment: c.scopeAssessment,
    resultGrainAssessment: c.resultGrainAssessment,
    requiredBindingDependencies: c.requiredBindingDependencies,
  };
}

export function computeCandidateFingerprint(payload: CandidateFingerprintPayload): string {
  return sha256(stableStringify(payload));
}

export function computeCandidateEvaluationFingerprint(
  input:
    | {
        candidateFingerprint: string;
        policyId: string;
        policyVersion: string;
        policyContentHash: string;
      }
    | string,
  policyVersionOrUnused?: string,
): string {
  if (typeof input === 'string') {
    // Legacy test overload: (fingerprint, policyVersion)
    return sha256(
      stableStringify({
        candidateFingerprint: input,
        policyId: 'legacy',
        policyVersion: policyVersionOrUnused ?? 'legacy',
        policyContentHash: policyVersionOrUnused ?? 'legacy',
      }),
    );
  }
  return sha256(
    stableStringify({
      candidateFingerprint: input.candidateFingerprint,
      policyId: input.policyId,
      policyVersion: input.policyVersion,
      policyContentHash: input.policyContentHash,
    }),
  );
}

export function computeDecisionFingerprint(input: {
  candidateFingerprint: string;
  candidateEvaluationFingerprint: string;
  actor: string;
  decision: string;
  reason: string;
  policyVersion: string;
  dependencyVector: TetaGenericSemanticBindingDecision['dependencyVector'];
}): string {
  return sha256(stableStringify(input));
}
