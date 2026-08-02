import fs from 'fs';
import path from 'path';
import {
  STAGE3K2B2A_GAP_RESOLUTION_POLICY_VERSION,
  sha256,
  stableStringify,
  type CollectorType,
  type GapType,
} from './teta-gap.types';

export interface GapResolutionPolicy {
  policyId: string;
  policyVersion: string;
  description: string;
  automaticGapTypes: GapType[];
  conditionalHumanGapTypes: GapType[];
  requiredCollectorSequenceP1: CollectorType[];
  requiredCollectorSequenceP2: CollectorType[];
  minimumEvidenceFacts: Record<string, string[]>;
  featureFamilyIndependenceRules: Record<string, boolean>;
  boundedApplicabilityRules: {
    defaultRequireCanonicalAcrossAllTetaHr: boolean;
    supportedBoundedAllowed: boolean;
    supportedBoundedMayList: string[];
    formCountIsNotGenericProof: boolean;
  };
  staleRules: Record<string, boolean>;
  reevaluationConditions: Record<string, boolean>;
  gapResolutionRules: {
    actualReevaluationRequired: boolean;
    realPackFixtureExclusion: boolean;
    viewGrainRequiresKeyPreservation: boolean;
    scopeInheritanceRequiresDependencyEvidence: boolean;
    confirmedDependentRoleRequiresTypedRelation: boolean;
    humanBusinessSamenessDoesNotProveRowUniqueness: boolean;
  };
  humanRequestRequires: Record<string, boolean>;
  collectorBounds: {
    maxDepth: number;
    maxCandidates: number;
    conflictPolicy: string;
    allowedNodeTypes: string[];
    allowedEdgeTypes: string[];
  };
  pilotCandidates: string[];
  deferredCandidates: string[];
}

export interface LoadedGapResolutionPolicy {
  policy: GapResolutionPolicy;
  policyHash: string;
  policyPath: string;
}

export function defaultGapResolutionPolicyPath(repoRoot: string): string {
  return path.join(
    repoRoot,
    'apps/api/config/teta-semantic-evidence-gap-resolution-policy-v1.json',
  );
}

export function loadGapResolutionPolicy(repoRoot: string): LoadedGapResolutionPolicy {
  const policyPath = defaultGapResolutionPolicyPath(repoRoot);
  const raw = fs.readFileSync(policyPath, 'utf8');
  const policy = JSON.parse(raw) as GapResolutionPolicy;
  const errors = validateGapResolutionPolicy(policy);
  if (errors.length) {
    throw new Error(`gap_resolution_policy_invalid:${errors.join(',')}`);
  }
  return {
    policy,
    policyHash: sha256(stableStringify(policy)),
    policyPath: path.relative(repoRoot, policyPath).replace(/\\/g, '/'),
  };
}

export function validateGapResolutionPolicy(policy: GapResolutionPolicy): string[] {
  const errors: string[] = [];
  if (policy.policyVersion !== STAGE3K2B2A_GAP_RESOLUTION_POLICY_VERSION) {
    errors.push(
      `version_mismatch:${policy.policyVersion}!=${STAGE3K2B2A_GAP_RESOLUTION_POLICY_VERSION}`,
    );
  }
  if (!policy.requiredCollectorSequenceP1?.includes('competing_root_collector')) {
    errors.push('p1_sequence_missing_competing_root_collector');
  }
  if (policy.boundedApplicabilityRules?.defaultRequireCanonicalAcrossAllTetaHr === true) {
    errors.push('must_not_require_canonical_across_all_teta_hr_by_default');
  }
  if (!policy.humanRequestRequires?.allAllowedOfflineCollectorsCompleted) {
    errors.push('human_requires_collectors_completed');
  }
  if (!policy.humanRequestRequires?.blockingGapStillOpen) {
    errors.push('human_requires_blocking_gap_open');
  }
  if (!policy.featureFamilyIndependenceRules?.sharedGatewayObservationNotIndependent) {
    errors.push('shared_gateway_independence_rule_required');
  }
  const rules = policy.gapResolutionRules;
  if (!rules) {
    errors.push('gap_resolution_rules_missing');
  } else {
    for (const k of [
      'actualReevaluationRequired',
      'realPackFixtureExclusion',
      'viewGrainRequiresKeyPreservation',
      'scopeInheritanceRequiresDependencyEvidence',
      'confirmedDependentRoleRequiresTypedRelation',
      'humanBusinessSamenessDoesNotProveRowUniqueness',
    ] as const) {
      if (rules[k] !== true) errors.push(`gap_rule_required:${k}`);
    }
  }
  if (policy.reevaluationConditions?.actualReevaluationRequired !== true) {
    errors.push('reevaluation_actual_required_flag_missing');
  }
  return errors;
}
