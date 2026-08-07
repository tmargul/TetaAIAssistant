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

export const P1_TIME_WORK_GROUP_SCENARIO_ID =
  'employee_current_time_work_group_by_employee_number' as const;

export const P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER = '00069';
export const P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER_PATTERN = /^[0-9]+$/;

export function buildTimeWorkGroupExactQuestion(employeeNumber: string): string {
  return `Podaj grupę czasu pracy pracownika o numerze ewidencyjnym ${employeeNumber}.`;
}

export function validateTimeWorkGroupEmployeeNumber(raw: string): string {
  const value = String(raw);
  if (!P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER_PATTERN.test(value)) {
    throw new Error(`invalid_employee_number:${value}`);
  }
  return value;
}

export const P1_TIME_WORK_GROUP_QUESTION = buildTimeWorkGroupExactQuestion(
  P1_TIME_WORK_GROUP_EMPLOYEE_NUMBER,
);

export const P1_TIME_WORK_GROUP_INTENT = 'p1_employee_vertical_pilot' as const;
export const P1_TIME_WORK_GROUP_SUBJECT = 'employee_current_time_work_group' as const;
export const P1_TIME_WORK_GROUP_MAX_ROWS = 50;

export type TimeWorkGroupPilotStatus =
  | 'blocked_missing_exact_time_work_group_binding'
  | 'blocked_gate_disabled'
  | 'blocked_question_mismatch'
  | 'blocked_exact_source_unavailable'
  | 'blocked_missing_exact_field_binding'
  | 'blocked_phase_a_failed'
  | 'blocked_oracle_unavailable'
  | 'dry_run_ok_awaiting_phase_b'
  | 'implemented_and_real_readonly_smoke_awaiting_user_validation';

export type TimeWorkGroupResolutionStatus =
  | 'resolved_exact'
  | 'missing'
  | 'ambiguous'
  | 'stale'
  | 'conflicting'
  | 'semantically_unproven'
  | 'technically_unproven';

export type TimeWorkGroupCurrentnessMode =
  | 'effective_date_range'
  | 'current_snapshot_source'
  | 'exact_current_flag'
  | 'unresolved';

export type TimeWorkGroupCandidate = {
  candidateRef: string;
  applicationAnchorRefs: string[];
  assignmentObject: string | null;
  employeeRelationPath: Array<{
    sourceObject: string | null;
    sourceColumn: string | null;
    targetObject: string | null;
    targetColumn: string | null;
    relationType: string;
    evidenceRefs: string[];
    resolutionStatus: TimeWorkGroupResolutionStatus;
  }>;
  groupReferenceColumn: string | null;
  dictionaryObject: string | null;
  dictionaryIdColumn: string | null;
  dictionaryNameColumn: string | null;
  temporalColumns: string[];
  grainAssessment: string;
  cardinalityAssessment: string;
  semanticEvidenceRefs: string[];
  technicalEvidenceRefs: string[];
  resolutionStatus: TimeWorkGroupResolutionStatus;
  blockingGaps: string[];
  notes?: string[];
};

export const P1_TIME_WORK_GROUP_STRICT_ZERO_KEYS = [
  'guessedTimeWorkGroupSource',
  'guessedTimeWorkGroupDictionary',
  'guessedEmployeeAssignmentJoin',
  'guessedCurrentnessRule',
  'broadOracleObjectSearches',
  'broadOracleColumnSearches',
  'fullNdjsonScans',
  'unboundedGraphSearches',
  'candidateSelectedByNameSimilarity',
  'candidateSelectedByShortestPath',
  'technicalBindingAcceptedWithoutSemanticProof',
  'semanticLabelAcceptedWithoutTechnicalPath',
  'ambiguousCandidateAutoSelected',
  'missingEvidenceIgnored',
  'employeeNumberConvertedToNumber',
  'leadingZerosRemoved',
  'employeeNumberEmbeddedInSql',
  'unboundUserLiterals',
  'historicalAssignmentReturnedAsCurrent',
  'futureAssignmentReturnedAsCurrent',
  'latestAssignmentUsedAsCurrentFallback',
  'firstAssignmentAutoSelected',
  'fetchFirstUsedToHideMultiplicity',
  'rowNumberUsedToHideMultiplicity',
  'maxDateUsedToHideMultiplicity',
  'groupIdShownAsGroupName',
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
  'businessSelectStatementsExecuted',
  'businessRowsRead',
] as const;

export type TimeWorkGroupSafetyCounters = Record<
  (typeof P1_TIME_WORK_GROUP_STRICT_ZERO_KEYS)[number],
  number
>;

export const emptyTimeWorkGroupCounters = (): TimeWorkGroupSafetyCounters =>
  Object.fromEntries(
    P1_TIME_WORK_GROUP_STRICT_ZERO_KEYS.map((k) => [k, 0]),
  ) as TimeWorkGroupSafetyCounters;

export function assertTimeWorkGroupStrictZeros(
  counters: TimeWorkGroupSafetyCounters,
): string[] {
  return P1_TIME_WORK_GROUP_STRICT_ZERO_KEYS.filter((k) => (counters[k] ?? 0) !== 0).map(
    (k) => `strict_nonzero:${k}=${counters[k]}`,
  );
}

export const sha256TimeWorkGroup = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/** Exact Stage2B type names allowed for bounded discovery (not name-similarity search). */
export const P1_TIME_WORK_GROUP_STAGE2B_ALLOWLIST = [
  'Teta.Sumo.Personel.bosPersonelSlowniki.MTG.GrupyCzasuPracyMTG',
  'Teta.Sumo.Personel.bosPersonelSlowniki.TG.GrupyCzasuPracyTG',
  'Teta.Sumo.Personel.bosPersonelSlowniki.BO.GrupyCzasuPracyBO',
  'Teta.Sumo.Personel.bosUmowy.BO.UmowyBO',
  'Teta.Sumo.Personel.bosPracownik.TG.GrupaCzasuPracyQuestionnairesTG',
  'Teta.Sumo.Personel.bosPracownikImp.TG.WorkingTimeGroupsTG',
  'Teta.Sumo.Personel.bosPracownikImp.BO.WorkingTimeGroupsBO',
] as const;
