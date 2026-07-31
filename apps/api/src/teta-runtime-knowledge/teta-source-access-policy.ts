import type {
  ClientAccessPolicy,
  KnowledgeAccessContextV1,
  RuntimeKnowledgeUnitV1,
  TETA_KNOWLEDGE_ACCESS_CONTEXT_CONTRACT_VERSION,
} from './teta-runtime-knowledge.types';
import { loadAccessPolicyConfig } from './teta-runtime-source-policy.service';

export type AccessDecision = {
  allowed: boolean;
  reason:
    | 'allowed'
    | 'missing_access_context'
    | 'cross_tenant'
    | 'role_denied'
    | 'permission_denied'
    | 'audience_denied'
    | 'not_client_owned';
};

export function fingerprintAccessContext(ctx: KnowledgeAccessContextV1 | null | undefined): string {
  if (!ctx) return 'access:none';
  const roles = [...ctx.roles].sort().join(',');
  const perms = [...ctx.permissionIds].sort().join(',');
  return `access:${ctx.tenantId}:${ctx.userId}:${roles}:${perms}`;
}

export function evaluateClientAccess(opts: {
  unit: Pick<RuntimeKnowledgeUnitV1, 'sourcePolicy' | 'accessPolicy'>;
  accessContext: KnowledgeAccessContextV1 | null | undefined;
  repoRoot?: string;
}): AccessDecision {
  const ownership = opts.unit.sourcePolicy.sourceOwnership;
  if (ownership !== 'client') {
    return { allowed: true, reason: 'not_client_owned' };
  }

  const cfg = loadAccessPolicyConfig(opts.repoRoot);
  if (!opts.accessContext) {
    if (cfg.missingAccessContextBlocksClientKnowledge) {
      return { allowed: false, reason: 'missing_access_context' };
    }
  }

  const access = opts.unit.accessPolicy;
  if (!access) {
    return { allowed: false, reason: 'missing_access_context' };
  }

  const ctx = opts.accessContext;
  if (!ctx) return { allowed: false, reason: 'missing_access_context' };

  if (cfg.crossTenantAlwaysBlocked && access.tenantId !== ctx.tenantId) {
    return { allowed: false, reason: 'cross_tenant' };
  }

  if (access.allowedRoles.length > 0) {
    const ok = access.allowedRoles.some((r) => ctx.roles.includes(r));
    if (!ok) return { allowed: false, reason: 'role_denied' };
  }

  if (access.allowedPermissionIds.length > 0) {
    const ok = access.allowedPermissionIds.some((p) => ctx.permissionIds.includes(p));
    if (!ok) return { allowed: false, reason: 'permission_denied' };
  }

  switch (access.visibilityAudience) {
    case 'all_client_users':
      return { allowed: true, reason: 'allowed' };
    case 'hr_only':
      return ctx.roles.includes('hr') || ctx.roles.includes('hr_only')
        ? { allowed: true, reason: 'allowed' }
        : { allowed: false, reason: 'audience_denied' };
    case 'payroll_only':
      return ctx.roles.includes('payroll') || ctx.roles.includes('payroll_only')
        ? { allowed: true, reason: 'allowed' }
        : { allowed: false, reason: 'audience_denied' };
    case 'administrators':
      return ctx.roles.includes('admin') || ctx.roles.includes('administrators')
        ? { allowed: true, reason: 'allowed' }
        : { allowed: false, reason: 'audience_denied' };
    case 'named_roles':
      return access.allowedRoles.some((r) => ctx.roles.includes(r))
        ? { allowed: true, reason: 'allowed' }
        : { allowed: false, reason: 'audience_denied' };
    default:
      return { allowed: false, reason: 'audience_denied' };
  }
}

export function makeAccessContext(
  partial: Partial<KnowledgeAccessContextV1> & { tenantId: string; userId: string },
): KnowledgeAccessContextV1 {
  return {
    contractVersion: 'teta-knowledge-access-context-v1' as typeof TETA_KNOWLEDGE_ACCESS_CONTEXT_CONTRACT_VERSION,
    tenantId: partial.tenantId,
    userId: partial.userId,
    roles: partial.roles ?? [],
    organizationUnitIds: partial.organizationUnitIds ?? [],
    productEntitlements: partial.productEntitlements ?? [],
    permissionIds: partial.permissionIds ?? [],
  };
}

export function defaultClientAccessPolicy(
  tenantId: string,
  audience: ClientAccessPolicy['visibilityAudience'] = 'all_client_users',
): ClientAccessPolicy {
  return {
    tenantId,
    visibilityAudience: audience,
    allowedRoles:
      audience === 'hr_only'
        ? ['hr', 'hr_only']
        : audience === 'payroll_only'
          ? ['payroll', 'payroll_only']
          : audience === 'administrators'
            ? ['admin', 'administrators']
            : [],
    allowedPermissionIds: [],
    sensitivity: audience === 'hr_only' ? 'internal' : 'normal',
  };
}
