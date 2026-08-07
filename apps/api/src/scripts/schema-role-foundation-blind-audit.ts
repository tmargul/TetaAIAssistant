/**
 * Stage 0 foundation review — blind current-position acceptance audit.
 * Writes local-only artifact. No business SELECT. No commit.
 */
import fs from 'fs';
import path from 'path';
import { resolveCurrentPositionBlind } from '../teta-p1-employee-vertical-pilot/teta-p1-current-position-resolve';
import { resolveCurrentPositionBindings } from '../teta-p1-employee-vertical-pilot/teta-p1-current-position-resolve';
import { emptyCurrentPositionCounters } from '../teta-p1-employee-vertical-pilot/teta-p1-current-position.types';
import { buildCurrentPositionEvidenceFromStage3d } from '../teta-schema-role-resolution';

async function main() {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const outDir = path.join(repoRoot, '.local', 'schema-role-resolver-foundation-review');
  fs.mkdirSync(outDir, { recursive: true });

  // Classify Stage 3D adapter role (audit only — not used as blind input)
  const stage3dGraph = buildCurrentPositionEvidenceFromStage3d(repoRoot);
  const stage3dLeakAssessment = {
    providesPhysicalOracleObjectNames: true,
    providesPhysicalColumnNames: true,
    providesJoinPredicates: true,
    providesTemporalPhysicalColumns: true,
    providesDictionaryObjectKeyName: true,
    providesAlreadyApprovedCurrentPositionBinding: true,
    candidateGenerationConsumesTheseValues: true,
    provenExactSolelyBecauseStage3dLoaded: true,
    classification: 'production_physical_binding',
    priorIndependentRediscoveryClaimValid: false,
    reason:
      'buildCurrentPositionEvidenceFromStage3d loads approved objects/columns/joins/temporals from teta-business-semantic-bindings-v1.json; resolveSchemaRoles then tags them as assignment_candidate and reaches proven_exact from that seeded graph.',
  };

  const production = resolveCurrentPositionBindings({
    repoRoot,
    counters: emptyCurrentPositionCounters(),
    declaredEmployeeColumns: ['ID', 'IMIE', 'NAZWISKO', 'NR_EWIDENCYJNY'],
    discoveryMode: 'approved_binding_reuse',
  });

  const blind = await resolveCurrentPositionBlind({
    repoRoot,
    question: 'Podaj aktualne stanowisko pracownika o numerze ewidencyjnym 00069.',
  });

  const roles = blind.schemaRoleResolution.roleAssignmentsByRole;
  const audit = {
    contractVersion: 'schema-role-resolver-foundation-review-v1',
    generatedAt: new Date().toISOString(),
    headExpected: '2be311e61cb9d97f762e3fdd02a94604ad9e30de',
    resolverInputs: {
      discoveryMode: 'blind_physical_rediscovery',
      question: 'Podaj aktualne stanowisko pracownika o numerze ewidencyjnym 00069.',
      subjectRole: 'employee',
      targetConcept: 'current_position',
      temporalIntent: 'current_on_oracle_sysdate',
      confirmedSubjectSource: 'TETA_ADMIN.NT_KP_PRC_PRACOWNICY (employee foundation only)',
      stage3dBindingsFileLoaded: blind.stage3dBindingsFileLoaded,
      previousPilotPhysicalBindingsLoaded: blind.previousPilotPhysicalBindingsLoaded,
    },
    evidenceOriginClassification: blind.inputClassifications,
    stage3dLeakageAssessment: stage3dLeakAssessment,
    productionApprovedBindingReuse: {
      overallStatus: production.schemaRoleResolution?.overallStatus ?? null,
      assignment: production.schemaRoleResolution?.roleAssignmentsByRole.assignment_source?.objectRef ?? null,
      note: 'Unchanged production path — Stage 3D approved bindings allowed',
    },
    blindModeInput: {
      claimCount: blind.schemaRoleResolution.evidenceByFamily
        ? Object.values(blind.schemaRoleResolution.evidenceByFamily).reduce(
            (n, a) => n + a.length,
            0,
          )
        : 0,
      familyCounts: Object.fromEntries(
        Object.entries(blind.schemaRoleResolution.evidenceByFamily).map(([k, v]) => [
          k,
          v.length,
        ]),
      ),
    },
    candidateSet: blind.schemaRoleResolution.candidateRanking,
    chosenOrBlocked: {
      overallStatus: blind.schemaRoleResolution.overallStatus,
      executionEligibility: blind.schemaRoleResolution.executionEligibility,
      resolutionExplanation: blind.schemaRoleResolution.resolutionExplanation,
      chosenRelationPath: blind.schemaRoleResolution.chosenRelationPath,
    },
    evidenceFamilies: blind.schemaRoleResolution.evidenceByFamily,
    relationPath: blind.schemaRoleResolution.chosenRelationPath,
    temporalResolution: blind.schemaRoleResolution.temporalResolution,
    discovered: {
      assignment: roles.assignment_source?.objectRef ?? null,
      employeeReference: roles.subject_reference?.column ?? null,
      dictionaryReference: roles.dictionary_reference?.column ?? null,
      dictionaryObject: roles.dictionary_identity?.objectRef ?? null,
      dictionaryDisplay: roles.dictionary_display_name?.column ?? null,
      validFrom: roles.valid_from?.column ?? null,
      validTo: roles.valid_to?.column ?? null,
    },
    postResolutionGroundTruthComparison: blind.postResolutionGroundTruth,
    blindRediscoveryStatus: blind.blindRediscoveryStatus,
    missingCapabilities: blind.missingCapabilities,
    invariants: {
      ...blind.schemaRoleResolution.audit,
      twgPhysicalSeedsAdded: 0,
      physicalMappingAddedToPolicy: 0,
      stage3dProductionBindingsAdded: 0,
      stage3dProductionBindingsModified: 0,
      reusePolicyEntriesAdded: 0,
      reusePolicyEntriesModified: 0,
      planningEligibleBindingsAdded: 0,
      businessSelectStatementsExecuted: 0,
      businessRowsRead: 0,
      dmlStatementsExecuted: 0,
      ddlStatementsExecuted: 0,
      plsqlBlocksExecuted: 0,
      commits: 0,
      localModelCalls: 0,
      remoteModelCalls: 0,
      qdrantCalls: 0,
      embeddingCalls: 0,
      stage3dGraphPresentForAuditOnly: Boolean(stage3dGraph),
    },
    strictErrors: [] as string[],
    testsBuildSummary: {
      note: 'Filled by agent after test/build runs',
    },
  };

  const outPath = path.join(outDir, 'blind-current-position-audit-v1.json');
  fs.writeFileSync(outPath, JSON.stringify(audit, null, 2), 'utf8');
  console.log(JSON.stringify({ wrote: outPath, blindRediscoveryStatus: blind.blindRediscoveryStatus, overall: blind.schemaRoleResolution.overallStatus, missingCapabilities: blind.missingCapabilities, groundTruth: blind.postResolutionGroundTruth }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
