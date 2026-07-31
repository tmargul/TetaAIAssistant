import type { LegacyLlmSqlFallbackPolicy } from './teta-logical-readonly-request.types';
import { STAGE3K1_LEGACY_FENCE_POLICY_VERSION } from './teta-logical-readonly-request.types';

export const LEGACY_LLM_SQL_FENCE_POLICY: LegacyLlmSqlFallbackPolicy = {
  policyVersion: STAGE3K1_LEGACY_FENCE_POLICY_VERSION,
  allowedForGenericReadonly: false,
  migrationStatus: 'fenced_not_removed',
  fallbackAfterGenericBlocked: false,
  fallbackAfterGenericUnsupported: false,
  fallbackAfterGenericAmbiguous: false,
};

export function evaluateLegacyFenceCounters(policy: LegacyLlmSqlFallbackPolicy): {
  legacyFallbackAllowedForGeneric: number;
  legacyFallbackAfterBlocked: number;
  legacyFallbackAfterUnsupported: number;
  legacyFallbackAfterAmbiguous: number;
} {
  return {
    legacyFallbackAllowedForGeneric: policy.allowedForGenericReadonly ? 1 : 0,
    legacyFallbackAfterBlocked: policy.fallbackAfterGenericBlocked ? 1 : 0,
    legacyFallbackAfterUnsupported: policy.fallbackAfterGenericUnsupported ? 1 : 0,
    legacyFallbackAfterAmbiguous: policy.fallbackAfterGenericAmbiguous ? 1 : 0,
  };
}
