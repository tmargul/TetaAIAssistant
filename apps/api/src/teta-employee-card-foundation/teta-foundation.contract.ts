import {
  emptySafetyCounters,
  type Stage3k2b2b1SafetyCounters,
  type TetaEmployeeMasterSourceCandidate,
} from './teta-foundation.types';

export function assertStrictZeros(counters: Stage3k2b2b1SafetyCounters): string[] {
  const errors: string[] = [];
  for (const [k, v] of Object.entries(counters)) {
    if (v !== 0) errors.push(`strict_nonzero:${k}=${v}`);
  }
  return errors;
}

export function validateMasterSourceCandidate(c: TetaEmployeeMasterSourceCandidate): string[] {
  const errors: string[] = [];
  if (c.businessGrain !== 'one_row_per_employee_card_or_master_record') {
    errors.push('invalid_business_grain');
  }
  if (
    c.businessGrain === ('one_row_per_natural_person' as string) ||
    c.businessGrain === ('one_row_per_person' as string)
  ) {
    errors.push('person_grain_forbidden');
  }
  if (
    c.semanticSourceKind === 'table' &&
    c.runtimeAccessEligibility !== 'requires_separate_access_binding' &&
    c.runtimeAccessEligibility !== 'blocked' &&
    c.runtimeAccessEligibility !== 'not_evaluated'
  ) {
    if (c.runtimeAccessEligibility === 'eligible_after_separate_approval') {
      // still not auto-runtime; ok
    }
  }
  if (c.runtimeExecutionAccessObjectRef != null && c.runtimeAccessEligibility === 'not_evaluated') {
    errors.push('runtime_access_object_without_eligibility');
  }
  if (
    c.applicationAnchorRefs.some((x) => x.startsWith('form:')) &&
    c.applicationDataSurfaceRefs.some((x) => x.startsWith('form:'))
  ) {
    errors.push('form_anchor_cannot_be_data_surface');
  }
  if (
    c.applicationDataSurfaceStatus === 'confirmed' &&
    c.applicationDataSurfaceRefs.length === 0
  ) {
    errors.push('confirmed_data_surface_requires_reference');
  }
  return errors;
}

export function mergeCounters(
  a: Stage3k2b2b1SafetyCounters,
  b: Stage3k2b2b1SafetyCounters,
): Stage3k2b2b1SafetyCounters {
  const out = emptySafetyCounters();
  for (const k of Object.keys(out) as (keyof Stage3k2b2b1SafetyCounters)[]) {
    out[k] = a[k] + b[k];
  }
  return out;
}

export { emptySafetyCounters };
