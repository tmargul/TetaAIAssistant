import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  loadBusinessLanguage,
  loadSemanticBindings,
} from '../teta-business-semantics/teta-semantic-bindings-loader';
import { loadBusinessOntology } from '../teta-business-semantics/teta-business-ontology-loader';
import type {
  ApprovalReuseStatus,
  SemanticBindingCapabilitiesFile,
  SemanticReusePolicyFile,
} from './teta-generic-semantic-binding.types';
import {
  STAGE3K2A_CAPABILITIES_VERSION,
  STAGE3K2A_REUSE_POLICY_VERSION,
} from './teta-generic-semantic-binding.types';
import type {
  BusinessLanguageFile,
  BusinessOntologyFile,
  SemanticBindingsFile,
} from '../teta-business-semantics/teta-business-semantics.types';

export type Stage3k2aConfigs = {
  reusePolicy: SemanticReusePolicyFile;
  capabilities: SemanticBindingCapabilitiesFile;
  ontology: BusinessOntologyFile;
  bindings: SemanticBindingsFile;
  language: BusinessLanguageFile;
};

export function defaultApiConfigDir(repoRoot: string): string {
  return path.join(repoRoot, 'apps', 'api', 'config');
}

export function loadReusePolicy(filePath: string): SemanticReusePolicyFile {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as SemanticReusePolicyFile;
  if (raw.version !== STAGE3K2A_REUSE_POLICY_VERSION) {
    throw new Error(`reuse_policy_version_mismatch:${raw.version}`);
  }
  return raw;
}

export function loadCapabilities(filePath: string): SemanticBindingCapabilitiesFile {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as SemanticBindingCapabilitiesFile;
  if (raw.version !== STAGE3K2A_CAPABILITIES_VERSION) {
    throw new Error(`capabilities_version_mismatch:${raw.version}`);
  }
  return raw;
}

export function loadStage3k2aConfigs(repoRoot: string): {
  ok: boolean;
  configs?: Stage3k2aConfigs;
  errors: string[];
} {
  const dir = defaultApiConfigDir(repoRoot);
  const errors: string[] = [];
  const paths = {
    reuse: path.join(dir, 'teta-generic-semantic-reuse-policy-v1.json'),
    capabilities: path.join(dir, 'teta-generic-semantic-binding-capabilities-v1.json'),
    ontology: path.join(dir, 'teta-business-ontology-v1.json'),
    bindings: path.join(dir, 'teta-business-semantic-bindings-v1.json'),
    language: path.join(dir, 'teta-business-language-pl-v1.json'),
  };
  for (const [k, p] of Object.entries(paths)) {
    if (!existsSync(p)) errors.push(`missing:${k}`);
  }
  if (errors.length) return { ok: false, errors };

  try {
    const reusePolicy = loadReusePolicy(paths.reuse);
    const capabilities = loadCapabilities(paths.capabilities);
    const ontology = loadBusinessOntology(paths.ontology);
    const bindings = loadSemanticBindings(paths.bindings);
    const language = loadBusinessLanguage(paths.language);
    return {
      ok: true,
      configs: { reusePolicy, capabilities, ontology, bindings, language },
      errors: [],
    };
  } catch (e) {
    return { ok: false, errors: [String(e)] };
  }
}

export function resolveApprovalReuse(
  roleKey: string,
  subject: string,
  policy: SemanticReusePolicyFile,
): ApprovalReuseStatus {
  const entry = policy.reusableRoles.find((r) => r.roleKey === roleKey);
  if (entry) {
    if (entry.reuseKind === 'approved_exact_scope') {
      if (entry.allowedSubjects?.length && !entry.allowedSubjects.includes(subject)) {
        return 'approved_scope_mismatch';
      }
      return 'approved_exact_scope';
    }
    return 'approved_reusable_role';
  }
  if (policy.restrictedSubjects.includes(subject)) {
    return 'approved_scope_restricted';
  }
  return 'not_approved';
}

export function isPlanningReadyReuse(status: ApprovalReuseStatus): boolean {
  return status === 'approved_exact_scope' || status === 'approved_reusable_role';
}

/** Explicit non-production fixture policy for S4 ambiguity (must go through resolveApprovalReuse). */
export const SYNTHETIC_S4_TWO_REUSABLE_ROLES_POLICY: SemanticReusePolicyFile = {
  version: STAGE3K2A_REUSE_POLICY_VERSION,
  defaultReuse: 'deny',
  restrictedSubjects: [],
  reusableRoles: [
    { roleKey: 'synthetic_role_a', reuseKind: 'approved_reusable_role' },
    { roleKey: 'synthetic_role_b', reuseKind: 'approved_reusable_role' },
  ],
  notes: ['fixturePolicyOverride:synthetic_two_reusable_roles'],
  fixturePolicyOverride: {
    id: 'synthetic_two_reusable_roles',
    productionPolicy: false,
  },
};

/** Synthetic policy proving planningReadiness=ready ≠ executionEligibility. */
export const SYNTHETIC_PLANNING_READY_POLICY: SemanticReusePolicyFile = {
  version: STAGE3K2A_REUSE_POLICY_VERSION,
  defaultReuse: 'deny',
  restrictedSubjects: [],
  reusableRoles: [{ roleKey: 'employee', reuseKind: 'approved_reusable_role' }],
  notes: ['fixturePolicyOverride:synthetic_planning_ready'],
  fixturePolicyOverride: {
    id: 'synthetic_planning_ready',
    productionPolicy: false,
  },
};
