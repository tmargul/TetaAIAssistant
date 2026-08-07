/**
 * Optional Stage 0 blind diagnostics after Stage 1 — diagnostic only, not Stage 1 acceptance.
 * No business SQL. No TWG physical seeds.
 */
import fs from 'fs';
import path from 'path';
import { resolveSchemaRoles } from '../teta-schema-role-resolution/teta-schema-role-resolver';
import { buildBlindCurrentPositionEvidenceFromApplicationGraph } from '../teta-schema-role-resolution/teta-schema-role-evidence-blind-current-position';
import type { LogicalRoleId } from '../teta-schema-role-resolution/teta-schema-role-resolution.types';

const REQUIRED: LogicalRoleId[] = [
  'subject_identity',
  'assignment_source',
  'subject_reference',
  'dictionary_reference',
  'dictionary_identity',
  'dictionary_display_name',
  'valid_from',
  'valid_to',
];

async function main() {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const outDir = path.join(repoRoot, '.local', 'application-code-graph-stage1');
  fs.mkdirSync(outDir, { recursive: true });

  const blind = await buildBlindCurrentPositionEvidenceFromApplicationGraph(repoRoot);
  const currentPosition = resolveSchemaRoles({
    question: 'Podaj aktualne stanowisko pracownika o numerze ewidencyjnym 00069.',
    subjectRole: 'employee',
    targetConcept: 'current_position',
    requiredRoles: REQUIRED,
    discoveryMode: 'blind_physical_rediscovery',
    confirmedSubjectSource: {
      owner: 'TETA_ADMIN',
      objectType: 'VIEW',
      objectName: 'NT_KP_PRC_PRACOWNICY',
      identityColumn: 'ID',
      businessNumberColumn: 'NR_EWIDENCYJNY',
    },
    temporalIntent: 'current_on_oracle_sysdate',
    evidenceGraph: blind.graph,
  });

  const blindRediscoveryStatus =
    currentPosition.overallStatus === 'proven_exact'
      ? 'passed'
      : currentPosition.overallStatus === 'insufficient'
        ? 'unchanged_insufficient'
        : currentPosition.overallStatus === 'ambiguous'
          ? 'ambiguous'
          : currentPosition.overallStatus === 'conflicting'
            ? 'conflicting'
            : 'improved_but_insufficient';

  fs.writeFileSync(
    path.join(outDir, 'current-position-blind-diagnostic-v1.json'),
    JSON.stringify(
      {
        diagnosticOnly: true,
        stage1AcceptanceRequired: false,
        blindRediscoveryStatus,
        resolverStatus: currentPosition.overallStatus,
        note: 'Stage 1 ACE not yet consumed by Stage 0 blind evidence builder; expect unchanged_insufficient until Evidence Resolver v2 wires ACE paths',
        stage3dBindingsFileLoaded: blind.stage3dBindingsFileLoaded,
        audit: currentPosition.audit,
      },
      null,
      2,
    ),
  );

  const twg = resolveSchemaRoles({
    question: 'Grupa czasu pracy pracownika',
    subjectRole: 'employee',
    targetConcept: 'time_work_group',
    requiredRoles: REQUIRED,
    discoveryMode: 'blind_physical_rediscovery',
    confirmedSubjectSource: {
      owner: 'TETA_ADMIN',
      objectType: 'VIEW',
      objectName: 'NT_KP_PRC_PRACOWNICY',
      identityColumn: 'ID',
    },
    evidenceGraph: { objects: [], relations: [], claims: [] },
  });

  fs.writeFileSync(
    path.join(outDir, 'twg-blind-diagnostic-v1.json'),
    JSON.stringify(
      {
        diagnosticOnly: true,
        stage1AcceptanceRequired: false,
        twgBlindResolutionStatus: twg.overallStatus,
        note: 'TWG remains future unseen domain; no L_GR_CZ_PRACY / PRAC_ID / GR_CZ_ID seeds',
        audit: twg.audit,
      },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        currentPosition: blindRediscoveryStatus,
        twg: twg.overallStatus,
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
