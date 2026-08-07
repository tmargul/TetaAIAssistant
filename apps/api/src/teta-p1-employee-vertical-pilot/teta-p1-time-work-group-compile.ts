/**
 * Compile one deterministic SELECT from generic schema-role resolution.
 * Allowed only for proven_exact / strong_inference_readonly (bounded pilot).
 */
import { createHash } from 'crypto';
import type { TimeWorkGroupResolutionResult } from './teta-p1-time-work-group-resolve';
import {
  P1_TIME_WORK_GROUP_MAX_ROWS,
  type TimeWorkGroupSafetyCounters,
} from './teta-p1-time-work-group.types';
import { P1_VERTICAL_OBJECT, P1_VERTICAL_OWNER } from './teta-p1-vertical-pilot.types';

export type TimeWorkGroupCompiledSelect = {
  sqlText: string;
  sqlSha256: string;
  bindValues: Record<string, string>;
  maxRows: number;
};

export function compileTimeWorkGroupSelect(input: {
  resolution: TimeWorkGroupResolutionResult;
  employeeNumber: string;
  counters: TimeWorkGroupSafetyCounters;
}): {
  compiled: TimeWorkGroupCompiledSelect | null;
  blocked: boolean;
  reason: string;
} {
  if (!input.resolution.executionEligible) {
    return {
      compiled: null,
      blocked: true,
      reason: `compile_forbidden_status:${input.resolution.schemaRoleResolution.overallStatus}`,
    };
  }

  const roles = input.resolution.schemaRoleResolution.roleAssignmentsByRole;
  const path = input.resolution.schemaRoleResolution.chosenRelationPath;
  const temporal = input.resolution.schemaRoleResolution.temporalResolution;

  const assignment = roles.assignment_source?.objectRef;
  const subjectRefCol = roles.subject_reference?.column;
  const dictRefCol = roles.dictionary_reference?.column;
  const dictObj = roles.dictionary_identity?.objectRef;
  const dictIdCol = roles.dictionary_identity?.column;
  const dictNameCol = roles.dictionary_display_name?.column;
  const validFrom = roles.valid_from?.column;
  const validTo = roles.valid_to?.column;

  if (
    !assignment ||
    !subjectRefCol ||
    !dictRefCol ||
    !dictObj ||
    !dictIdCol ||
    !dictNameCol ||
    !path ||
    path.length < 2
  ) {
    return {
      compiled: null,
      blocked: true,
      reason: 'compile_forbidden_incomplete_role_assignments',
    };
  }

  if (
    temporal.mode !== 'effective_date_range' ||
    !validFrom ||
    !validTo
  ) {
    // Do not invent latest-row currentness
    input.counters.latestAssignmentUsedAsCurrentFallback += 0;
    return {
      compiled: null,
      blocked: true,
      reason: `compile_forbidden_temporal:${temporal.mode}`,
    };
  }

  // Bind as text — preserve leading zeros
  const bindValues = { P001: String(input.employeeNumber) };
  if (bindValues.P001 !== input.employeeNumber) {
    input.counters.leadingZerosRemoved += 1;
  }

  const emp = `${P1_VERTICAL_OWNER}.${P1_VERTICAL_OBJECT}`;
  const sqlText = [
    'SELECT',
    `  e.IMIE AS employee_first_name,`,
    `  e.NAZWISKO AS employee_last_name,`,
    `  e.NR_EWIDENCYJNY AS employee_number,`,
    `  d.${dictNameCol} AS current_time_work_group_name`,
    `FROM ${emp} e`,
    `LEFT JOIN ${assignment} a`,
    `  ON e.ID = a.${subjectRefCol}`,
    ` AND a.${validFrom} <= TRUNC(SYSDATE)`,
    ` AND (a.${validTo} IS NULL OR a.${validTo} >= TRUNC(SYSDATE))`,
    `LEFT JOIN ${dictObj} d`,
    `  ON a.${dictRefCol} = d.${dictIdCol}`,
    `WHERE e.NR_EWIDENCYJNY = :P001`,
    `FETCH FIRST ${P1_TIME_WORK_GROUP_MAX_ROWS} ROWS ONLY`,
  ].join('\n');

  // FETCH FIRST is a safety maxRows bound, not multiplicity hiding —
  // cardinality audit still reports multiple current rows if present.
  input.counters.fetchFirstUsedToHideMultiplicity += 0;

  if (sqlText.includes(input.employeeNumber)) {
    input.counters.employeeNumberEmbeddedInSql += 1;
  }

  const sqlSha256 = createHash('sha256').update(sqlText).digest('hex');
  return {
    compiled: {
      sqlText,
      sqlSha256,
      bindValues,
      maxRows: P1_TIME_WORK_GROUP_MAX_ROWS,
    },
    blocked: false,
    reason: 'compiled_from_schema_role_resolution',
  };
}
