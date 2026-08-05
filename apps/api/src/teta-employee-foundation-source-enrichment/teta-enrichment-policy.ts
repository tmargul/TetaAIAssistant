import fs from 'fs';
import path from 'path';
import {
  STAGE3K2B2B2A_POLICY_VERSION,
  sha256,
  stableStringify,
} from './teta-enrichment.types';

export interface EnrichmentPolicy {
  policyId: string;
  policyVersion: string;
  description: string;
  viewDefinitionCompletenessRequired: boolean;
  unsupportedConstructsBlockKeyPreservation: boolean;
  candidateScopedAllowlistRequired: boolean;
  partialDataSurfaceNotConfirmed: boolean;
  ambiguousDataSurfaceRequiresSelection: boolean;
  rawTechnicalMetadataContainment: boolean;
  previewGraphCannotBecomeActive: boolean;
  syntheticArtifactsExcludedFromRealAssessment: boolean;
  missingArtifactIsFailClosedNotFailure: boolean;
  notParsedMeansNotEvaluated: boolean;
  zeroCandidatesAreNotUnambiguous: boolean;
  activeGraphImmutabilityRequiresContentHash: boolean;
  validatedPreviewRequiresNonEmptyDelta: boolean;
  allowlistRequiresObservedBounds: boolean;
  syntheticAndRealMetricsSeparated: boolean;
  requestAvailabilityDoesNotProveSemanticAttribution: boolean;
  provenRequiresCompleteness: string[];
  provenRequiresParseStatus: string;
  maxIncompleteKeyPreservation: string;
  missingDefinitionYields: string;
  dependsOnPlusBasePkMaxStatus: string;
  firstSliceTargets: string[];
  deferredTargets: string[];
  collectorBounds: {
    maxDepth: number;
    maxNodes: number;
    maxEdges: number;
    maxCandidates: number;
  };
  allowedNodeTypes: string[];
  allowedEdgeTypes: string[];
  prohibitedFallbacks: string[];
  rulesApplied: string[];
  failClosed: Record<string, boolean>;
}

const REQUIRED_PATCH_RULES = [
  'notParsedMeansNotEvaluated',
  'zeroCandidatesAreNotUnambiguous',
  'activeGraphImmutabilityRequiresContentHash',
  'validatedPreviewRequiresNonEmptyDelta',
  'allowlistRequiresObservedBounds',
  'syntheticAndRealMetricsSeparated',
  'requestAvailabilityDoesNotProveSemanticAttribution',
] as const;

export function defaultEnrichmentPolicyPath(repoRoot: string): string {
  return path.join(
    repoRoot,
    'apps/api/config/teta-employee-foundation-source-enrichment-policy-v1.json',
  );
}

export function validateEnrichmentPolicy(policy: EnrichmentPolicy): string[] {
  const errors: string[] = [];
  if (policy.policyVersion !== STAGE3K2B2B2A_POLICY_VERSION) errors.push('version_mismatch');
  if (policy.viewDefinitionCompletenessRequired !== true) {
    errors.push('view_definition_completeness_required');
  }
  if (policy.candidateScopedAllowlistRequired !== true) {
    errors.push('allowlist_required');
  }
  if (policy.partialDataSurfaceNotConfirmed !== true) {
    errors.push('partial_surface_not_confirmed_required');
  }
  if (policy.previewGraphCannotBecomeActive !== true) {
    errors.push('preview_cannot_become_active_required');
  }
  if (policy.syntheticArtifactsExcludedFromRealAssessment !== true) {
    errors.push('synthetic_excluded_required');
  }
  for (const rule of REQUIRED_PATCH_RULES) {
    if ((policy as unknown as Record<string, unknown>)[rule] !== true) {
      errors.push(`missing_rule:${rule}`);
    }
  }
  if (!Array.isArray(policy.rulesApplied) || policy.rulesApplied.length < REQUIRED_PATCH_RULES.length) {
    errors.push('rules_applied_incomplete');
  }
  for (const rule of REQUIRED_PATCH_RULES) {
    if (!policy.rulesApplied?.includes(rule)) errors.push(`rules_applied_missing:${rule}`);
  }
  if (policy.failClosed?.approvalForbidden !== true) errors.push('approval_forbidden');
  if (policy.failClosed?.sqlExecutionForbidden !== true) errors.push('sql_execution_forbidden');
  return errors;
}

export function loadEnrichmentPolicy(repoRoot: string): {
  policy: EnrichmentPolicy;
  policyHash: string;
  policyPath: string;
} {
  const policyPath = defaultEnrichmentPolicyPath(repoRoot);
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as EnrichmentPolicy;
  const errors = validateEnrichmentPolicy(policy);
  if (errors.length) throw new Error(`enrichment_policy_invalid:${errors.join(',')}`);
  return {
    policy,
    policyHash: sha256(stableStringify(policy)),
    policyPath: path.relative(repoRoot, policyPath).replace(/\\/g, '/'),
  };
}
