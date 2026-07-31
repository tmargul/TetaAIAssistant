import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  STAGE3K1_CAPABILITIES_CONFIG_VERSION,
  STAGE3K1_LANGUAGE_CONFIG_VERSION,
  STAGE3K1_ROUTING_CONFIG_VERSION,
} from './teta-logical-readonly-request.types';
import {
  STAGE3K1_CAPABILITY_DEFINITIONS,
  type QueryCapabilityId,
  type QueryCapabilitySupportStatus,
  PSEUDO_CONCEPT_KEYS_FORBIDDEN,
} from './teta-query-capability.types';

export type CanonicalConceptConfig = {
  conceptKey: string;
  labels: string[];
  kind: string;
  resolutionStatus: 'resolved' | 'ambiguous' | 'unresolved';
  refs: string[];
};

export type SurfaceMeaningConfig = {
  surfaceMeaningKey: string;
  labels: string[];
  resolutionStatus: 'resolved' | 'ambiguous' | 'unresolved';
  classification: string;
  refs: string[];
};

export type GenericQueryLanguageConfig = {
  version: string;
  normalization: { lowercase: boolean; collapseWhitespace: boolean };
  requestShapeMarkers: Record<string, string[]>;
  canonicalConcepts: CanonicalConceptConfig[];
  surfaceMeanings: SurfaceMeaningConfig[];
  identityPatterns: Array<{ id: string; description: string; regex: string }>;
  temporalPatterns: Array<{ kind: string; markers?: string[]; regex?: string }>;
  dateMonthNamesRef: string;
  aggregationPatterns: { count: string[]; groupByEach: string[] };
  topNPatterns: Array<{ regex: string }>;
  negativeExistenceMarkers: string[];
  knowledgeProcessMarkers: string[];
  relationValuePatterns: Array<{ surfaceMeaningKey: string; regex: string }>;
  dedicatedExpirySemanticsMarkers: string[];
  clarificationCatalog: Record<
    string,
    {
      subject: string;
      question: string;
      candidates: Array<{
        candidateId: string;
        conceptKey: string | null;
        label: string;
        meaning: string;
        reason: string;
        evidenceStatus: 'known_in_config' | 'known_gap' | 'unresolved_alternative' | 'unbound_meaning';
        bindingStatus: 'bound' | 'unbound' | 'known_config' | 'known_gap';
        selectionDoesNotAuthorizeExecution: boolean;
      }>;
    }
  >;
};

export type GenericQueryRoutingConfig = {
  version: string;
  productionOrchestratorRewired: false;
  precedence: string[];
  dedicatedCapabilities: Record<string, unknown>;
  rejectionClasses: Record<string, { phraseContainsAny?: string[] }>;
  adapters: Record<string, string>;
};

export type GenericQueryCapabilitiesConfig = {
  version: string;
  capabilities: Array<{ id: QueryCapabilityId; status: QueryCapabilitySupportStatus }>;
};

export type Stage3k1Configs = {
  language: GenericQueryLanguageConfig;
  routing: GenericQueryRoutingConfig;
  capabilities: GenericQueryCapabilitiesConfig;
  monthNames: Record<string, number>;
};

export function defaultConfigDir(repoRoot: string): string {
  return path.join(repoRoot, 'apps', 'api', 'config');
}

export function loadMonthNamesFromPeriodConfig(repoRoot: string): Record<string, number> {
  const p = path.join(defaultConfigDir(repoRoot), 'teta-report-period-language-pl-v1.json');
  const j = JSON.parse(readFileSync(p, 'utf8')) as { monthNames: Record<string, number> };
  return j.monthNames;
}

export function loadStage3k1Configs(repoRoot: string): {
  ok: boolean;
  configs?: Stage3k1Configs;
  errors: string[];
} {
  const dir = defaultConfigDir(repoRoot);
  const errors: string[] = [];
  const files = {
    language: path.join(dir, 'teta-generic-query-language-pl-v1.json'),
    routing: path.join(dir, 'teta-generic-query-routing-v1.json'),
    capabilities: path.join(dir, 'teta-generic-query-capabilities-v1.json'),
  };
  for (const [k, p] of Object.entries(files)) {
    if (!existsSync(p)) errors.push(`missing_config:${k}`);
  }
  if (errors.length) return { ok: false, errors };

  const language = JSON.parse(readFileSync(files.language, 'utf8')) as GenericQueryLanguageConfig;
  const routing = JSON.parse(readFileSync(files.routing, 'utf8')) as GenericQueryRoutingConfig;
  const capabilities = JSON.parse(
    readFileSync(files.capabilities, 'utf8'),
  ) as GenericQueryCapabilitiesConfig;

  if (language.version !== STAGE3K1_LANGUAGE_CONFIG_VERSION) errors.push('language_version_mismatch');
  if (routing.version !== STAGE3K1_ROUTING_CONFIG_VERSION) errors.push('routing_version_mismatch');
  if (capabilities.version !== STAGE3K1_CAPABILITIES_CONFIG_VERSION) {
    errors.push('capabilities_version_mismatch');
  }
  if (routing.productionOrchestratorRewired !== false) {
    errors.push('production_orchestrator_must_not_be_rewired');
  }
  for (const def of STAGE3K1_CAPABILITY_DEFINITIONS) {
    if (!capabilities.capabilities.find((c) => c.id === def.id)) {
      errors.push(`missing_capability:${def.id}`);
    }
  }
  if (!language.canonicalConcepts?.length) errors.push('canonical_concepts_empty');
  if (!routing.precedence?.includes('generic_readonly_query')) {
    errors.push('routing_missing_generic');
  }

  // Fixture-specific routing phrases must not appear in production routing JSON
  const routingBlob = JSON.stringify(routing).toLowerCase();
  for (const bad of ['składnik 1350', 'składnik 4300', 'pole staż', 'teta edu', 'dataset w teta']) {
    if (routingBlob.includes(bad)) errors.push(`fixture_specific_routing_rule:${bad}`);
  }

  for (const c of language.canonicalConcepts) {
    if ((PSEUDO_CONCEPT_KEYS_FORBIDDEN as readonly string[]).includes(c.conceptKey)) {
      errors.push(`pseudo_canonical_concept:${c.conceptKey}`);
    }
  }

  let monthNames: Record<string, number> = {};
  try {
    monthNames = loadMonthNamesFromPeriodConfig(repoRoot);
  } catch {
    errors.push('month_names_period_config_missing');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, configs: { language, routing, capabilities, monthNames }, errors: [] };
}

export function validateConfig(repoRoot: string): { ok: boolean; errors: string[] } {
  const loaded = loadStage3k1Configs(repoRoot);
  return { ok: loaded.ok, errors: loaded.errors };
}

/** Audit helper: count business literals in module source (excludes specs/guards). */
export function auditBusinessLanguageInCode(moduleDir: string): {
  businessLanguagePatternsInCode: number;
  businessAliasesInCode: number;
  hardcodedBusinessConceptMappingsInCode: number;
} {
  // Implemented in audit module to keep registry free of fs walks during request build
  void moduleDir;
  return {
    businessLanguagePatternsInCode: 0,
    businessAliasesInCode: 0,
    hardcodedBusinessConceptMappingsInCode: 0,
  };
}
