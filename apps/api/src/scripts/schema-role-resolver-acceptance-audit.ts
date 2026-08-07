import path from 'path';
import {
  resolveCurrentPositionBindings,
  validateCurrentPositionAgainstAccepted,
} from '../teta-p1-employee-vertical-pilot/teta-p1-current-position-resolve';
import { emptyCurrentPositionCounters } from '../teta-p1-employee-vertical-pilot/teta-p1-current-position.types';
import { resolveTimeWorkGroupBindings } from '../teta-p1-employee-vertical-pilot/teta-p1-time-work-group-resolve';
import { emptyTimeWorkGroupCounters } from '../teta-p1-employee-vertical-pilot/teta-p1-time-work-group.types';

async function main() {
  const repo = path.resolve(__dirname, '../../../..');
  const declared = ['ID', 'IMIE', 'NAZWISKO', 'NR_EWIDENCYJNY'];
  const cp = resolveCurrentPositionBindings({
    repoRoot: repo,
    counters: emptyCurrentPositionCounters(),
    declaredEmployeeColumns: declared,
  });
  const v = validateCurrentPositionAgainstAccepted(cp.schemaRoleResolution!);
  const twg = await resolveTimeWorkGroupBindings({
    repoRoot: repo,
    counters: emptyTimeWorkGroupCounters(),
    declaredEmployeeColumns: declared,
  });
  console.log(
    JSON.stringify(
      {
        currentPosition: {
          overall: cp.schemaRoleResolution?.overallStatus,
          eligibility: cp.schemaRoleResolution?.executionEligibility,
          validation: v,
          assignment: cp.schemaRoleResolution?.roleAssignmentsByRole.assignment_source,
          subjectRef: cp.schemaRoleResolution?.roleAssignmentsByRole.subject_reference,
          dictRef: cp.schemaRoleResolution?.roleAssignmentsByRole.dictionary_reference,
          dictId: cp.schemaRoleResolution?.roleAssignmentsByRole.dictionary_identity,
          dictName: cp.schemaRoleResolution?.roleAssignmentsByRole.dictionary_display_name,
          temporal: cp.schemaRoleResolution?.temporalResolution,
          ranking: cp.schemaRoleResolution?.candidateRanking,
          audit: cp.schemaRoleResolution?.audit,
        },
        twg: {
          overall: twg.schemaRoleResolution.overallStatus,
          eligibility: twg.schemaRoleResolution.executionEligibility,
          ranking: twg.schemaRoleResolution.candidateRanking,
          explanation: twg.schemaRoleResolution.resolutionExplanation,
          roles: twg.schemaRoleResolution.roleAssignmentsByRole,
          temporal: twg.schemaRoleResolution.temporalResolution,
          audit: twg.schemaRoleResolution.audit,
          selected: twg.selectedCandidateRef,
          dictEvidence: twg.fieldBindings.find((b) => b.logicalRole === 'dictionarySourceRef'),
          familyCounts: Object.fromEntries(
            Object.entries(twg.schemaRoleResolution.evidenceByFamily).map(([k, v]) => [
              k,
              v.length,
            ]),
          ),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
