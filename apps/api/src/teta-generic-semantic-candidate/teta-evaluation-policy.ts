import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { sha256, stableStringify } from './teta-generic-semantic-candidate.contract';
import {
  STAGE3K2B1_CANDIDATE_EVALUATION_POLICY_VERSION,
  type RiskClass,
} from './teta-generic-semantic-candidate.types';

export type RiskClassPolicy = {
  minimumIndependentObservationGroups: number;
  requiredSemanticEvidenceClasses: string[];
  requireScopeAssessmentWhenExpanding?: boolean;
  requireGrainAssessment?: boolean;
  requireCardinalityResolved?: boolean;
  requireBusinessMeaningBeyondDdl?: boolean;
  requireIdentityFacetSeparation?: boolean;
  requireExactIdentitySemanticEvidence?: boolean;
  ddlAloneDoesNotProveIdentityMeaning?: boolean;
  requireEmployeeGrainDependency?: boolean;
};

export type CandidateEvaluationPolicyFile = {
  policyId: string;
  policyVersion: string;
  description?: string;
  allowedEvidenceStrengths: string[];
  strengthsSufficientForDecision: string[];
  strengthsBlockedForDecision: string[];
  riskClasses: Record<RiskClass, RiskClassPolicy>;
  scopeExpansion: {
    unprovenBlocksSufficientForDecision: boolean;
    partialBlocksSufficientForDecision: boolean;
    conflictingBlocksSufficientForDecision: boolean;
    requireExplicitAssessment: boolean;
    unprovenMustAppearInKnownGaps: boolean;
  };
  grainCardinality: {
    unresolvedCardinalityBlocksSufficientForDecision: boolean;
    requireExplicitGrainAssessment: boolean;
    employeeRequiresEmployeeGrainEvidence: boolean;
    identityRequiresEmployeeGrainDependency: boolean;
    displayRequiresPositionGrainOrIdentityLink: boolean;
  };
  ambiguityConflict: {
    anyAmbiguityBlocksSufficientForDecision: boolean;
    anyConflictBlocksSufficientForDecision: boolean;
  };
  stale: {
    graphHashMismatchYieldsStale: boolean;
    staleBlocksApproval: boolean;
  };
  sufficientForDecision: {
    allBlockingRulesMustPass: boolean;
    readyForApprovalDecisionRequiresSufficientEvidence: boolean;
    neverMeansApprovedOrReusable: boolean;
  };
  needsMoreEvidence: {
    whenAnyBlockingRuleFails: boolean;
    whenInferredOrHeuristicOnly: boolean;
    whenScopeUnprovenOnExpansion: boolean;
    whenCardinalityUnresolved: boolean;
    whenIdentitySemanticMissing: boolean;
    whenGrainAssessmentMissingOrFailed: boolean;
  };
  dependencies: {
    inactiveRequiredDependencyBlocksReuseActivation: boolean;
    pendingDependencyMustAppearInKnownGaps: boolean;
    planningComposableRequiresSatisfiedDependencies: boolean;
  };
  notes?: string[];
};

export type LoadedEvaluationPolicy = {
  policy: CandidateEvaluationPolicyFile;
  policyPath: string;
  policyHash: string;
  evaluationPolicyLoadedFromVersionedConfig: true;
};

export function defaultEvaluationPolicyPath(repoRoot: string): string {
  return path.join(
    repoRoot,
    'apps',
    'api',
    'config',
    'teta-generic-semantic-candidate-evaluation-policy-v1.json',
  );
}

export function hashEvaluationPolicy(policy: CandidateEvaluationPolicyFile): string {
  return sha256(stableStringify(policy));
}

export function loadCandidateEvaluationPolicy(repoRoot: string): LoadedEvaluationPolicy {
  const policyPath = defaultEvaluationPolicyPath(repoRoot);
  if (!existsSync(policyPath)) {
    throw new Error(`evaluation_policy_missing:${policyPath}`);
  }
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as CandidateEvaluationPolicyFile;
  if (policy.policyVersion !== STAGE3K2B1_CANDIDATE_EVALUATION_POLICY_VERSION) {
    throw new Error(
      `evaluation_policy_version_mismatch:${policy.policyVersion}!=${STAGE3K2B1_CANDIDATE_EVALUATION_POLICY_VERSION}`,
    );
  }
  if (!policy.policyId) throw new Error('evaluation_policy_missing_policyId');
  for (const rc of [
    'normal_reference',
    'temporal_sensitive',
    'configuration_sensitive',
    'payroll_sensitive',
    'identity_sensitive',
  ] as RiskClass[]) {
    if (!policy.riskClasses[rc]) throw new Error(`evaluation_policy_missing_risk_class:${rc}`);
  }
  return {
    policy,
    policyPath,
    policyHash: hashEvaluationPolicy(policy),
    evaluationPolicyLoadedFromVersionedConfig: true,
  };
}
