import { createHash } from 'crypto';
import {
  fingerprint,
  P1_VERTICAL_GATE_ENV,
  P1_VERTICAL_OBJECT,
  P1_VERTICAL_OWNER,
} from './teta-p1-vertical-pilot.types';
import {
  P1_CURRENT_POSITION_DICTIONARY,
  P1_CURRENT_POSITION_SOURCE,
} from './teta-p1-current-position.types';

export { P1_VERTICAL_GATE_ENV, fingerprint, P1_VERTICAL_OBJECT, P1_VERTICAL_OWNER };
export { P1_CURRENT_POSITION_DICTIONARY, P1_CURRENT_POSITION_SOURCE };

export const P1_SURNAME_POSITION_SCENARIO_ID =
  'employee_surname_prefix_with_current_position_report' as const;

export const P1_SURNAME_POSITION_QUESTION =
  'Podaj imię, nazwisko, numer ewidencyjny i aktualne stanowisko pracowników, których nazwisko zaczyna się na literę A.';

export const P1_SURNAME_POSITION_INTENT = 'p1_employee_vertical_pilot' as const;
export const P1_SURNAME_POSITION_SUBJECT =
  'employee_surname_prefix_with_current_position' as const;

export const P1_SURNAME_POSITION_PREFIX = 'A';
export const P1_SURNAME_POSITION_MAX_ROWS = 500;

/** Accepted surname-prefix pilot distinct employee count for letter A. */
export const P1_SURNAME_POSITION_REFERENCE_BASE_EMPLOYEE_COUNT = 8;

export type SurnamePositionPilotStatus =
  | 'implemented_and_real_readonly_smoke_completed'
  | 'implemented_and_real_readonly_smoke_awaiting_user_validation'
  | 'blocked_missing_exact_field_binding'
  | 'blocked_missing_exact_current_position_binding'
  | 'blocked_exact_source_unavailable'
  | 'blocked_oracle_unavailable'
  | 'blocked_gate_disabled'
  | 'blocked_phase_a_failed'
  | 'blocked_question_mismatch'
  | 'dry_run_ok_awaiting_phase_b'
  | 'blocked_employee_preserving_join_violation';

export type SurnamePositionBusinessValidationStatus =
  | 'pending_user_comparison_with_teta'
  | 'accepted_by_user_comparison_with_teta';

/** Repo-safe accepted outcome after user comparison with Teta (no PII / no position names). */
export const P1_SURNAME_POSITION_ACCEPTED_OUTCOME = {
  pilotStatus: 'implemented_and_real_readonly_smoke_completed' as const,
  businessResultValidationStatus: 'accepted_by_user_comparison_with_teta' as const,
  pilotTechnicalStatus: 'passed' as const,
  pilotBusinessStatus: 'passed' as const,
  employeeSetValidationStatus: 'all_expected_employees_preserved' as const,
  currentPositionValidationStatus:
    'all_returned_position_values_confirmed_correct' as const,
  employeePreservingJoinValidationStatus:
    'accepted_real_employee_set_with_and_without_positions' as const,
  employeeSetConfirmedCorrect: true,
  currentPositionValuesConfirmedCorrect: true,
  employeesWithoutCurrentPositionConfirmedCorrect: true,
  employeePreservingJoinConfirmed: true,
  validatedEmployeeDistinctCount: 8,
  validatedReturnedRowCount: 8,
  validatedWithoutCurrentPositionCount: 2,
  validatedSingleCurrentPositionCount: 6,
  validatedMultipleCurrentPositionCount: 0,
  missingPositionDictionaryNames: 0,
  testPrefix: P1_SURNAME_POSITION_PREFIX,
  sqlSha256: '6e07a4b046d64ed85ec55059e1d35a345cf30ce1dd3ef784b0a04972b7421559',
  sqlSafetyOk: true,
  acceptedBindings: {
    employeeSource: `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
    employeeFields: {
      employee_first_name: 'IMIE',
      employee_last_name: 'NAZWISKO',
      employee_number: 'NR_EWIDENCYJNY',
      employee_identity: 'ID',
    },
    currentPositionSource: `${P1_VERTICAL_OWNER}.${P1_CURRENT_POSITION_SOURCE}`,
    currentPositionFields: {
      position_employee_reference: 'PRAC_ID',
      position_dictionary_reference: 'SSTN_ID',
      position_valid_from: 'DATA_OD',
      position_valid_to: 'DATA_DO',
    },
    positionDictionary: `${P1_VERTICAL_OWNER}.${P1_CURRENT_POSITION_DICTIONARY}`,
    dictionaryFields: {
      position_dictionary_identity: 'ID',
      current_position_name: 'NAZWA',
    },
    joins: {
      employeeToPosition: 'ID=PRAC_ID',
      positionToDictionary: 'SSTN_ID=ID',
      employeeToPositionJoinType: 'left' as const,
      positionToDictionaryJoinType: 'left' as const,
      drivingSource: 'employee' as const,
    },
    temporal: {
      placement: 'join_on' as const,
      rule: 'DATA_OD <= TRUNC(SYSDATE) AND (DATA_DO IS NULL OR DATA_DO >= TRUNC(SYSDATE))',
      inclusiveStart: true,
      inclusiveEnd: true,
    },
    whereOnly: 'employee_last_name_starts_with' as const,
  },
  pilotOnly: true,
  pilotSourceKind: 'vendor_local_vertical_pilot_source' as const,
  candidateApprovalStatus: 'not_approved' as const,
  productionBindingCreated: false,
  reusePolicyModified: false,
  planningEligibilityModified: false,
  nextProductSlice: 'employee_current_time_work_group_by_employee_number' as const,
} as const;

export const P1_SURNAME_POSITION_STRICT_ZERO_KEYS = [
  'employeeDroppedBecauseNoCurrentPosition',
  'employeeDroppedByTemporalWherePredicate',
  'innerJoinUsedForCurrentPosition',
  'innerJoinUsedForPositionDictionary',
  'historicalPositionReturnedAsCurrent',
  'futurePositionReturnedAsCurrent',
  'historicalPositionUsedAsFallback',
  'positionIdShownAsPositionName',
  'firstCurrentPositionAutoSelected',
  'fetchFirstUsedToHideMultiplicity',
  'rowNumberUsedToHideMultiplicity',
  'maxDateUsedToHideMultiplicity',
  'distinctUsedToHideMultiplicity',
  'baseEmployeeCountChangedUnexpectedly',
  'returnedEmployeeDistinctCountMismatch',
  'employeePrefixEmbeddedInSql',
  'unboundUserLiterals',
  'selectStarUsed',
  'additionalUnexpectedSourcesUsed',
  'fallbackOracleObjectSelected',
  'tPracFallbackUsed',
  'legacyAgentSqlUsed',
  'modelGeneratedSqlUsed',
  'modelModifiedCompiledSql',
  'pilotExecutedWithoutExplicitGate',
  'pilotBindingPersistedAsProductionBinding',
  'pilotBindingAddedToStage3D',
  'pilotBindingAddedToReusePolicy',
  'pilotMarkedGenericReusable',
  'stage3dProductionBindingsAdded',
  'stage3dProductionBindingsModified',
  'reusePolicyEntriesAdded',
  'reusePolicyEntriesModified',
  'planningEligibleBindingsAdded',
  'realDecisionEventsApplied',
  'realApprovedGenericBindingsCreated',
  'employeeNumberConvertedToNumber',
  'leadingZerosRemoved',
  'dmlStatementsExecuted',
  'ddlStatementsExecuted',
  'plsqlBlocksExecuted',
  'commits',
  'localModelCalls',
  'remoteModelCalls',
  'qdrantCalls',
  'embeddingCalls',
] as const;

export type SurnamePositionSafetyCounters = Record<
  (typeof P1_SURNAME_POSITION_STRICT_ZERO_KEYS)[number],
  number
>;

export const emptySurnamePositionCounters = (): SurnamePositionSafetyCounters =>
  Object.fromEntries(
    P1_SURNAME_POSITION_STRICT_ZERO_KEYS.map((k) => [k, 0]),
  ) as SurnamePositionSafetyCounters;

export function assertSurnamePositionStrictZeros(
  counters: SurnamePositionSafetyCounters,
): string[] {
  return P1_SURNAME_POSITION_STRICT_ZERO_KEYS.filter((k) => (counters[k] ?? 0) !== 0).map(
    (k) => `strict_nonzero:${k}=${counters[k]}`,
  );
}

export const sha256SurnamePosition = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');
