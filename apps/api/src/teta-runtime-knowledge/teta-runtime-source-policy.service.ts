import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type {
  CitationPolicy,
  QuotePolicy,
  SourceOwnership,
  SourcePolicyBlock,
  SourceVisibility,
  DistributionClass,
} from './teta-runtime-knowledge.types';

export type SourcePolicyConfig = {
  contractVersion: string;
  defaultsByOwnership: Record<string, SourcePolicyBlock>;
  unknownOwnershipBlocksRuntimeUse: boolean;
  forbiddenVendorPhrases: string[];
  vendorSelfReferencePatterns: string[];
};

export type OwnershipRegistryEntry = {
  logicalSourceIdPattern: string;
  sourceOwnership: SourceOwnership;
  clientDocumentClass: 'normative' | 'analysis' | null;
  visibilityAudience: string | null;
  sensitivity: string | null;
};

export type OwnershipRegistryConfig = {
  contractVersion: string;
  entries: OwnershipRegistryEntry[];
};

export function defaultRuntimeConfigDir(repoRoot?: string): string {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  return path.join(root, 'apps', 'api', 'config', 'teta-runtime-knowledge');
}

export function loadJsonConfig<T>(fileName: string, repoRoot?: string): T {
  const p = path.join(defaultRuntimeConfigDir(repoRoot), fileName);
  if (!existsSync(p)) throw new Error(`missing runtime config: ${fileName}`);
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

export function loadSourcePolicyConfig(repoRoot?: string): SourcePolicyConfig {
  return loadJsonConfig<SourcePolicyConfig>('teta-runtime-source-policy-v1.json', repoRoot);
}

export function loadOwnershipRegistry(repoRoot?: string): OwnershipRegistryConfig {
  return loadJsonConfig<OwnershipRegistryConfig>('teta-source-ownership-registry-v1.json', repoRoot);
}

export function loadAccessPolicyConfig(repoRoot?: string) {
  return loadJsonConfig<Record<string, unknown>>('teta-runtime-access-policy-v1.json', repoRoot);
}

export function loadRankingPolicyConfig(repoRoot?: string) {
  return loadJsonConfig<Record<string, unknown>>('teta-runtime-ranking-policy-v1.json', repoRoot);
}

export function loadRiskPolicyConfig(repoRoot?: string) {
  return loadJsonConfig<Record<string, unknown>>('teta-runtime-risk-policy-v1.json', repoRoot);
}

export function loadPresentationConfig(repoRoot?: string) {
  return loadJsonConfig<Record<string, unknown>>('teta-runtime-answer-presentation-v1.json', repoRoot);
}

export function validateRuntimeConfigs(repoRoot?: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const required = [
    'teta-runtime-source-policy-v1.json',
    'teta-runtime-access-policy-v1.json',
    'teta-runtime-ranking-policy-v1.json',
    'teta-runtime-risk-policy-v1.json',
    'teta-runtime-answer-presentation-v1.json',
    'teta-source-ownership-registry-v1.json',
    'teta-stage3j2f-pilot-cases-v1.json',
    'teta-stage3j2f-fixture-cases-v1.json',
  ];
  for (const f of required) {
    const p = path.join(defaultRuntimeConfigDir(repoRoot), f);
    if (!existsSync(p)) errors.push(`missing_config:${f}`);
  }
  try {
    const policy = loadSourcePolicyConfig(repoRoot);
    const vendor = policy.defaultsByOwnership.vendor;
    if (!vendor || vendor.sourceVisibility !== 'hidden') errors.push('vendor_not_hidden');
    if (!vendor || vendor.citationPolicy !== 'forbidden') errors.push('vendor_citation_not_forbidden');
    if (!vendor || vendor.quotePolicy !== 'forbidden') errors.push('vendor_quote_not_forbidden');
    const pub = policy.defaultsByOwnership.public_authority;
    if (!pub || pub.citationPolicy !== 'required' || pub.sourceVisibility !== 'cite_exact') {
      errors.push('public_authority_citation_policy_invalid');
    }
  } catch (e) {
    errors.push(`config_load_failed:${String(e)}`);
  }
  return { ok: errors.length === 0, errors };
}

export function vendorSourcePolicy(repoRoot?: string): SourcePolicyBlock {
  return { ...loadSourcePolicyConfig(repoRoot).defaultsByOwnership.vendor };
}

export function clientSourcePolicy(
  documentClass: 'normative' | 'analysis',
  repoRoot?: string,
): SourcePolicyBlock {
  const cfg = loadSourcePolicyConfig(repoRoot);
  const key = documentClass === 'normative' ? 'client_normative' : 'client_analysis';
  return { ...cfg.defaultsByOwnership[key] };
}

export function publicAuthoritySourcePolicy(repoRoot?: string): SourcePolicyBlock {
  return { ...loadSourcePolicyConfig(repoRoot).defaultsByOwnership.public_authority };
}

export function isValidVisibilityCombination(policy: SourcePolicyBlock): boolean {
  if (policy.sourceOwnership === 'unknown') return false;
  if (policy.sourceOwnership === 'vendor') {
    return (
      policy.sourceVisibility === 'hidden' &&
      policy.citationPolicy === 'forbidden' &&
      policy.quotePolicy === 'forbidden'
    );
  }
  if (policy.sourceOwnership === 'public_authority') {
    return policy.sourceVisibility === 'cite_exact' && policy.citationPolicy === 'required';
  }
  if (policy.sourceOwnership === 'client') {
    return (
      (policy.sourceVisibility === 'cite_exact' && policy.citationPolicy === 'required') ||
      (policy.sourceVisibility === 'cite_when_relevant' &&
        (policy.citationPolicy === 'optional' || policy.citationPolicy === 'required'))
    );
  }
  return false;
}

export function assertPolicyFields(policy: {
  sourceOwnership: SourceOwnership;
  sourceVisibility: SourceVisibility;
  citationPolicy: CitationPolicy;
  quotePolicy: QuotePolicy;
  distributionClass: DistributionClass;
}): SourcePolicyBlock {
  return { ...policy };
}
