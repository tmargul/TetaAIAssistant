import { createHash } from 'crypto';
import {
  fingerprint,
  P1_VERTICAL_GATE_ENV,
  P1_VERTICAL_OBJECT,
  P1_VERTICAL_OWNER,
  type FieldResolutionStatus,
} from './teta-p1-vertical-pilot.types';

export { P1_VERTICAL_GATE_ENV, fingerprint, P1_VERTICAL_OBJECT, P1_VERTICAL_OWNER };
export type { FieldResolutionStatus };

export const P1_CURRENT_POSITION_SCENARIO_ID =
  'p1_employee_current_position_by_employee_number' as const;

export const P1_CURRENT_POSITION_EMPLOYEE_NUMBER = '00122';

export const P1_CURRENT_POSITION_EMPLOYEE_NUMBER_PATTERN = /^[0-9]+$/;

/** Bounded exact-question template — only the employee-number token may vary. */
export function buildCurrentPositionExactQuestion(employeeNumber: string): string {
  return `Podaj imię, nazwisko, numer ewidencyjny i aktualne stanowisko pracownika o numerze ewidencyjnym ${employeeNumber}.`;
}

export function validateCurrentPositionEmployeeNumber(raw: string): string {
  const value = String(raw);
  if (!P1_CURRENT_POSITION_EMPLOYEE_NUMBER_PATTERN.test(value)) {
    throw new Error(`invalid_employee_number:${value}`);
  }
  return value;
}

export const P1_CURRENT_POSITION_QUESTION = buildCurrentPositionExactQuestion(
  P1_CURRENT_POSITION_EMPLOYEE_NUMBER,
);

export const P1_CURRENT_POSITION_INTENT = 'p1_employee_vertical_pilot' as const;
export const P1_CURRENT_POSITION_SUBJECT = 'employee_current_position' as const;

export const P1_CURRENT_POSITION_SOURCE = 'NT_KP_KDR_STANOWISKA' as const;
export const P1_CURRENT_POSITION_DICTIONARY = 'NT_KP_SLO_STANOWISKA' as const;

export const P1_CURRENT_POSITION_MAX_ROWS = 50;

export type CurrentPositionResolutionRole =
  | 'employee_first_name'
  | 'employee_last_name'
  | 'employee_number'
  | 'employeePrimaryIdentityColumn'
  | 'currentPositionSourceRef'
  | 'positionEmployeeReferenceColumn'
  | 'positionIdColumn'
  | 'positionValidFromColumn'
  | 'positionValidToColumn'
  | 'dictionarySourceRef'
  | 'dictionaryIdColumn'
  | 'positionNameColumn'
  | 'employeeToPositionJoin'
  | 'positionToDictionaryJoin'
  | 'current_position_name';

export type CurrentPositionResolvedBinding = {
  logicalRole: CurrentPositionResolutionRole;
  physicalObject: string | null;
  physicalColumn: string | null;
  resolutionStatus: FieldResolutionStatus;
  evidenceRefs: string[];
  resolutionFingerprint: string;
};

export type CurrentPositionPilotStatus =
  | 'implemented_and_real_readonly_smoke_awaiting_user_validation'
  | 'implemented_and_real_readonly_smoke_completed'
  | 'blocked_missing_exact_field_binding'
  | 'blocked_missing_exact_current_position_binding'
  | 'blocked_exact_source_unavailable'
  | 'blocked_oracle_unavailable'
  | 'blocked_gate_disabled'
  | 'blocked_phase_a_failed'
  | 'blocked_question_mismatch'
  | 'dry_run_ok_awaiting_phase_b';

export type CurrentPositionBusinessValidationStatus =
  | 'pending_user_comparison_with_teta'
  | 'accepted_by_user_comparison_with_teta';

/** Repo-safe accepted outcome after dual-case user comparison with Teta (no PII). */
export const P1_CURRENT_POSITION_ACCEPTED_OUTCOME = {
  pilotStatus: 'implemented_and_real_readonly_smoke_completed' as const,
  businessResultValidationStatus: 'accepted_by_user_comparison_with_teta' as const,
  pilotTechnicalStatus: 'passed' as const,
  pilotBusinessStatus: 'passed' as const,
  currentPositionBindingValidationStatus:
    'accepted_real_positive_and_negative_cases' as const,
  positiveCurrentPositionValueConfirmed: true,
  validatedCases: [
    {
      employeeNumber: '00122',
      resultKind: 'employee_without_current_position',
      employeeRecordCount: 1,
      currentPositionRowCount: 0,
      validationStatus: 'accepted',
    },
    {
      employeeNumber: '00069',
      resultKind: 'employee_with_single_current_position',
      employeeRecordCount: 1,
      currentPositionRowCount: 1,
      multipleCurrentPositionRowsDetected: false,
      validationStatus: 'accepted',
    },
  ] as const,
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
    },
    temporal: {
      rule: 'DATA_OD <= TRUNC(SYSDATE) AND (DATA_DO IS NULL OR DATA_DO >= TRUNC(SYSDATE))',
      inclusiveStart: true,
      inclusiveEnd: true,
    },
  },
  pilotOnly: true,
  pilotSourceKind: 'vendor_local_vertical_pilot_source' as const,
  candidateApprovalStatus: 'not_approved' as const,
  productionBindingCreated: false,
  reusePolicyModified: false,
  planningEligibilityModified: false,
  nextProductSlice: 'employee_surname_prefix_with_current_position_report' as const,
} as const;

export const P1_CURRENT_POSITION_STRICT_ZERO_KEYS = [
  'guessedCurrentPositionSource',
  'guessedPositionDictionary',
  'guessedEmployeePositionJoin',
  'ambiguousPositionBindingAutoSelected',
  'employeeNumberConvertedToNumber',
  'leadingZerosRemoved',
  'employeeNumberEmbeddedInSql',
  'unboundUserLiterals',
  'historicalPositionReturnedAsCurrent',
  'futurePositionReturnedAsCurrent',
  'openEndedCurrentPositionRejected',
  'currentPositionSelectedWithoutTemporalFilter',
  'firstCurrentPositionAutoSelected',
  'fetchFirstUsedToHideMultiplicity',
  'rowNumberUsedToHideMultiplicity',
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
  'dmlStatementsExecuted',
  'ddlStatementsExecuted',
  'plsqlBlocksExecuted',
  'commits',
  'localModelCalls',
  'remoteModelCalls',
  'qdrantCalls',
  'embeddingCalls',
] as const;

export type CurrentPositionSafetyCounters = Record<
  (typeof P1_CURRENT_POSITION_STRICT_ZERO_KEYS)[number],
  number
>;

export const emptyCurrentPositionCounters = (): CurrentPositionSafetyCounters =>
  Object.fromEntries(
    P1_CURRENT_POSITION_STRICT_ZERO_KEYS.map((k) => [k, 0]),
  ) as CurrentPositionSafetyCounters;

export function assertCurrentPositionStrictZeros(
  counters: CurrentPositionSafetyCounters,
): string[] {
  return P1_CURRENT_POSITION_STRICT_ZERO_KEYS.filter((k) => (counters[k] ?? 0) !== 0).map(
    (k) => `strict_nonzero:${k}=${counters[k]}`,
  );
}

export const sha256Current = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');
