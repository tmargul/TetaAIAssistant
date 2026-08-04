import fs from 'fs';
import path from 'path';
import {
  STAGE3K2B2B1_POLICY_VERSION,
  sha256,
  stableStringify,
} from './teta-foundation.types';

export interface FoundationEvidencePolicy {
  policyId: string;
  policyVersion: string;
  description: string;
  p1BusinessGrain: string;
  forbiddenGrainLabels: string[];
  directMasterSource: Record<string, unknown>;
  viewKeyPreservation: Record<string, unknown>;
  typedRelationAttribution: Record<string, unknown>;
  p6SemanticEvidence: Record<string, unknown>;
  sameRecordProof: Record<string, unknown>;
  compositeIdentity: Record<string, unknown>;
  scopeGrainSeparation: Record<string, unknown>;
  applicationSurfaceSeparation: Record<string, unknown>;
  evaluationIntegrity: Record<string, unknown>;
  p6StatusModel: Record<string, unknown>;
  sourceGapPolicy: Record<string, unknown>;
  phaseGates: Record<string, unknown>;
  staleness: Record<string, unknown>;
  failClosed: Record<string, unknown>;
  collectorBounds: {
    maxDepth: number;
    maxCandidates: number;
    conflictPolicy: string;
    allowedNodeTypes: string[];
    allowedEdgeTypes: string[];
  };
  pilotTargets: string[];
  deferredTargets: string[];
}

export function defaultFoundationPolicyPath(repoRoot: string): string {
  return path.join(
    repoRoot,
    'apps/api/config/teta-employee-card-foundation-evidence-policy-v1.json',
  );
}

export function loadFoundationEvidencePolicy(repoRoot: string): {
  policy: FoundationEvidencePolicy;
  policyHash: string;
  policyPath: string;
} {
  const policyPath = defaultFoundationPolicyPath(repoRoot);
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as FoundationEvidencePolicy;
  const errors = validateFoundationEvidencePolicy(policy);
  if (errors.length) throw new Error(`foundation_policy_invalid:${errors.join(',')}`);
  return {
    policy,
    policyHash: sha256(stableStringify(policy)),
    policyPath: path.relative(repoRoot, policyPath).replace(/\\/g, '/'),
  };
}

export function validateFoundationEvidencePolicy(policy: FoundationEvidencePolicy): string[] {
  const errors: string[] = [];
  if (policy.policyVersion !== STAGE3K2B2B1_POLICY_VERSION) {
    errors.push('version_mismatch');
  }
  if (policy.p1BusinessGrain !== 'one_row_per_employee_card_or_master_record') {
    errors.push('invalid_p1_business_grain');
  }
  if (policy.viewKeyPreservation?.basePkViaDependsOnAloneInsufficient !== true) {
    errors.push('base_pk_alone_must_be_insufficient');
  }
  if (policy.directMasterSource?.baseTableNotAutoRuntimeAccess !== true) {
    errors.push('base_table_must_not_auto_runtime');
  }
  if (policy.scopeGrainSeparation?.p2ScopeIndependentOfP1Grain !== true) {
    errors.push('scope_grain_separation_required');
  }
  if (policy.compositeIdentity?.h4SetsBusinessUniquenessOnly !== true) {
    errors.push('h4_business_only_required');
  }
  if (policy.phaseGates?.p6RequiresEmployeeMasterAnchor !== true) {
    errors.push('p6_anchor_gate_required');
  }
  if (policy.phaseGates?.p7RequiresP2P6SameRecord !== true) {
    errors.push('p7_same_record_gate_required');
  }
  if (policy.sameRecordProof?.sameRecordRequiredBeforeCompositeExactOne !== true) {
    errors.push('same_record_before_exact_one_required');
  }
  if (policy.applicationSurfaceSeparation?.formAnchorIsNotDataSurface !== true) {
    errors.push('form_anchor_not_data_surface_required');
  }
  if (policy.evaluationIntegrity?.actualEvaluationMustBeDistinguishedFromDiscovery !== true) {
    errors.push('evaluation_vs_discovery_distinction_required');
  }
  if (policy.p6StatusModel?.p6DiscoveryStatusSeparateFromUsageEligibility !== true) {
    errors.push('p6_status_split_required');
  }
  if (policy.sourceGapPolicy?.sourceGapRequestGeneration !== true) {
    errors.push('source_gap_request_generation_required');
  }
  if (policy.failClosed?.approvalForbidden !== true) {
    errors.push('approval_must_be_forbidden');
  }
  return errors;
}
