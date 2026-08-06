import { createHash } from 'crypto';

export const P1_VERTICAL_QUESTION =
  'Podaj imię, nazwisko, numer ewidencyjny i datę urodzenia pracowników, których nazwisko zaczyna się na literę A.';

export const P1_VERTICAL_GATE_ENV = 'TETA_ENABLE_P1_EMPLOYEE_VERTICAL_PILOT';

export const P1_VERTICAL_CANDIDATE_ID = 'cand:P1:employee' as const;
export const P1_VERTICAL_OWNER = 'TETA_ADMIN' as const;
export const P1_VERTICAL_OBJECT = 'NT_KP_PRC_PRACOWNICY' as const;
export const P1_VERTICAL_OBJECT_TYPE = 'VIEW' as const;

export const P1_VERTICAL_INTENT = 'p1_employee_vertical_pilot' as const;
export const P1_VERTICAL_SUBJECT = 'employee_surname_prefix' as const;

export const P1_VERTICAL_LOGICAL_FIELDS = [
  'employee_first_name',
  'employee_last_name',
  'employee_number',
  'employee_birth_date',
] as const;

export type P1VerticalLogicalField = (typeof P1_VERTICAL_LOGICAL_FIELDS)[number];

export type FieldResolutionStatus =
  | 'resolved_exact'
  | 'missing'
  | 'ambiguous'
  | 'stale'
  | 'conflicting';

export type PilotFieldBinding = {
  logicalField: P1VerticalLogicalField;
  physicalColumn: string | null;
  resolutionStatus: FieldResolutionStatus;
  evidenceRefs: string[];
  resolutionFingerprint: string;
  displayHeader: string;
};

export type PilotStatus =
  | 'implemented_and_real_readonly_smoke_awaiting_user_validation'
  | 'implemented_and_real_readonly_smoke_completed'
  | 'blocked_missing_exact_field_binding'
  | 'blocked_exact_source_unavailable'
  | 'blocked_oracle_unavailable'
  | 'blocked_gate_disabled'
  | 'blocked_phase_a_failed'
  | 'blocked_question_mismatch'
  | 'dry_run_ok_awaiting_phase_b';

export type BusinessResultValidationStatus =
  | 'pending_user_comparison_with_teta'
  | 'accepted_by_user_comparison_with_teta';

/** Repo-safe accepted outcome after user comparison with Teta (no PII). */
export const P1_VERTICAL_ACCEPTED_OUTCOME = {
  pilotStatus: 'implemented_and_real_readonly_smoke_completed' as const,
  businessResultValidationStatus: 'accepted_by_user_comparison_with_teta' as const,
  pilotTechnicalStatus: 'passed' as const,
  pilotBusinessStatus: 'passed' as const,
  validatedRowCount: 8,
  surnameValidationResult: 'all_rows_and_values_confirmed_correct' as const,
  sqlSafetyOk: true,
  exactOracleTarget: `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`,
  fieldMappings: [
    { logicalField: 'employee_first_name', physicalColumn: 'IMIE', resolutionStatus: 'resolved_exact' },
    { logicalField: 'employee_last_name', physicalColumn: 'NAZWISKO', resolutionStatus: 'resolved_exact' },
    { logicalField: 'employee_number', physicalColumn: 'NR_EWIDENCYJNY', resolutionStatus: 'resolved_exact' },
    {
      logicalField: 'employee_birth_date',
      physicalColumn: 'DATA_URODZENIA',
      resolutionStatus: 'resolved_exact',
    },
  ] as const,
  pilotOnly: true,
  pilotSourceKind: 'vendor_local_vertical_pilot_source' as const,
  candidateApprovalStatus: 'not_approved' as const,
  productionBindingCreated: false,
  reusePolicyModified: false,
  planningEligibilityModified: false,
  nextProductSlice: 'p1_employee_report_minimal_generalization' as const,
} as const;

export const P1_VERTICAL_STRICT_ZERO_KEYS = [
  'guessedPhysicalColumns',
  'ambiguousColumnsAutoSelected',
  'missingColumnsIgnored',
  'surnamePrefixEmbeddedInSql',
  'unboundUserLiterals',
  'selectStarUsed',
  'additionalOracleSourcesUsed',
  'unexpectedJoinsAdded',
  'legacyAgentSqlUsed',
  'modelGeneratedSqlUsed',
  'modelModifiedCompiledSql',
  'fallbackOracleObjectSelected',
  'tPracFallbackUsed',
  'employeeNumberConvertedToNumber',
  'leadingZerosRemoved',
  'birthDateTimeExposed',
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

export type P1VerticalSafetyCounters = Record<
  (typeof P1_VERTICAL_STRICT_ZERO_KEYS)[number],
  number
>;

export const emptyP1VerticalCounters = (): P1VerticalSafetyCounters =>
  Object.fromEntries(P1_VERTICAL_STRICT_ZERO_KEYS.map((k) => [k, 0])) as P1VerticalSafetyCounters;

export const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export const fingerprint = (v: unknown) =>
  sha256(
    JSON.stringify(v, (_, x) =>
      x && typeof x === 'object' && !Array.isArray(x)
        ? Object.fromEntries(
            Object.keys(x as object)
              .sort()
              .map((k) => [k, (x as Record<string, unknown>)[k]]),
          )
        : x,
    ),
  );

export function assertP1VerticalStrictZeros(counters: P1VerticalSafetyCounters): string[] {
  return P1_VERTICAL_STRICT_ZERO_KEYS.filter((k) => (counters[k] ?? 0) !== 0).map(
    (k) => `strict_nonzero:${k}=${counters[k]}`,
  );
}

/** Escape user prefix for Oracle LIKE with ESCAPE '\'. */
export function escapeLikePrefix(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
