/**
 * Runtime/result validation for Stage 3K.2A semantic binding DTOs.
 */
export {
  scanRuntimeDtoLeaks,
  scanRuntimeSafeDtoLeaks,
  stableStringify,
  toRuntimeSafeSemanticDto,
  validateBindingResultContract,
  computePlanningEligibility,
  withPlanningEligibility,
  derivePlanningReadiness,
  isRequiredForPlanning,
  collectPlanningReadinessStrictCounters,
} from './teta-generic-semantic-binding.contract';
export type {
  RuntimeLeakCounters,
  PlanningReadinessStrictCounters,
} from './teta-generic-semantic-binding.contract';
