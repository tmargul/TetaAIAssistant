import fs from 'fs';
import path from 'path';
import {
  fingerprint,
  STAGE3K2B2B2B1_POLICY_VERSION,
  TRANSFORM_PROFILE_ID,
  TRANSFORM_PROFILE_VERSION,
} from './teta-view-metadata.types';

export interface MetadataPolicy {
  policyId: string;
  policyVersion: string;
  firstSliceTargets: string[];
  boundedObjectCount: number;
  allowedObjectType: string;
  allowedCandidateId: string;
  transformProfile: {
    id: string;
    version: string;
    rules: string[];
    forbiddenRules?: string[];
  };
  vendorArtifactRootId: string;
  vendorArtifactRelativeRoot: string;
  allowedMetadataStatementTemplateIds: string[];
  allowedAcquisitionModes: string[];
  legalFailClosedOutcomes: string[];
  rulesApplied: string[];
  failClosed: Record<string, boolean>;
  dualExecutionFlagsRequired: string[];
}

export const defaultMetadataPolicyPath = (root: string) =>
  path.join(root, 'apps/api/config/teta-candidate-scoped-view-metadata-export-policy-v1.json');

const REQUIRED_RULES = [
  'exact_identity',
  'transform_profile_required',
  'raw_hash_authority',
  'envelope_required',
  'path_containment',
  'atomic_write',
  'closed_statements',
  'legal_fail_closed',
  'no_graph_promotion',
  'no_approval',
  'no_row_data',
  'no_ddl_execution',
  'session_edition_not_application_edition',
  'verified_exact_requires_edition_and_database_identity',
  'manifest_after_payload',
];

const REQUIRED_FAIL_CLOSED = [
  'approvalForbidden',
  'graphPromotionForbidden',
  'rowDataForbidden',
  'dmlForbidden',
  'ddlExecutionForbidden',
  'wildcardMetadataForbidden',
  'nameSimilarityFallbackForbidden',
  'globalMetadataScanForbidden',
  'regexOnlyEnvelopeAuthoritativeForbidden',
  'canonicalHashAsIntegrityForbidden',
  'sessionEditionAsApplicationEditionForbidden',
];

export function validateMetadataPolicy(p: MetadataPolicy): string[] {
  const errors: string[] = [];
  if (p.policyVersion !== STAGE3K2B2B2B1_POLICY_VERSION) errors.push('version_mismatch');
  if (p.firstSliceTargets?.join(',') !== 'P1') errors.push('first_slice_not_p1');
  if (p.boundedObjectCount !== 1) errors.push('bounded_object_count');
  if (p.allowedObjectType !== 'VIEW') errors.push('object_type');
  if (p.allowedCandidateId !== 'cand:P1:employee') errors.push('candidate');
  if (
    p.transformProfile?.id !== TRANSFORM_PROFILE_ID ||
    p.transformProfile.version !== TRANSFORM_PROFILE_VERSION
  ) {
    errors.push('transform_profile_invalid');
  }
  if (!p.transformProfile?.rules?.includes('strip_utf8_bom')) errors.push('missing_bom_rule');
  if (!p.transformProfile?.rules?.includes('crlf_to_lf')) errors.push('missing_crlf_rule');
  for (const r of REQUIRED_RULES) if (!p.rulesApplied?.includes(r)) errors.push(`missing_rule:${r}`);
  for (const f of REQUIRED_FAIL_CLOSED) if (p.failClosed?.[f] !== true) errors.push(`fail_closed:${f}`);
  for (const id of [
    'exact_object_identity_lookup',
    'exact_view_ddl_export',
    'exact_fragment_completeness_lookup',
  ]) {
    if (!p.allowedMetadataStatementTemplateIds?.includes(id)) errors.push(`missing_template:${id}`);
  }
  return errors;
}

export function loadMetadataPolicy(root: string) {
  const policyPath = defaultMetadataPolicyPath(root);
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as MetadataPolicy;
  const errors = validateMetadataPolicy(policy);
  if (errors.length) throw new Error(`metadata_policy_invalid:${errors.join(',')}`);
  return {
    policy,
    policyHash: fingerprint(policy),
    policyPath: path.relative(root, policyPath).replace(/\\/g, '/'),
  };
}
