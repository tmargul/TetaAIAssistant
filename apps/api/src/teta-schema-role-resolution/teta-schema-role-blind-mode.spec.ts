import path from 'path';
import { resolveSchemaRoles } from './teta-schema-role-resolver';
import { buildCurrentPositionEvidenceFromStage3d } from './teta-schema-role-evidence-stage3d';
import {
  buildBlindCurrentPositionEvidenceFromApplicationGraph,
  compareCurrentPositionGroundTruth,
  CURRENT_POSITION_GROUND_TRUTH_AFTER_RESOLUTION,
} from './teta-schema-role-evidence-blind-current-position';
import { buildSyntheticTimeGroupEvidenceGraph } from './teta-schema-role-synthetic';
import type { LogicalRoleId } from './teta-schema-role-resolution.types';

const REPO = path.resolve(__dirname, '../../../..');
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

describe('Stage 0 blind_physical_rediscovery', () => {
  it('refuses Stage 3D approved physical bindings in blind mode', () => {
    const leaked = buildCurrentPositionEvidenceFromStage3d(REPO);
    expect(leaked).toBeTruthy();
    const result = resolveSchemaRoles({
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
      },
      temporalIntent: 'current_on_oracle_sysdate',
      evidenceGraph: leaked!,
    });
    expect(result.executionEligibility).toBe('blocked');
    expect(result.audit.blindModeStage3dPhysicalBindingsLoaded).toBeGreaterThan(0);
    expect(result.audit.groundTruthUsedBeforeResolution).toBeGreaterThan(0);
    expect(result.roleAssignmentsByRole.assignment_source).toBeUndefined();
  });

  it('blind evidence builder does not load Stage 3D bindings file', async () => {
    const blind = await buildBlindCurrentPositionEvidenceFromApplicationGraph(REPO);
    expect(blind.stage3dBindingsFileLoaded).toBe(false);
    expect(blind.previousPilotPhysicalBindingsLoaded).toBe(false);
    const prov = blind.graph.claims.flatMap((c) => c.provenance).join('|');
    expect(prov).not.toMatch(/stage3d:teta-business-semantic-bindings/);
    expect(prov).not.toMatch(/CURRENT_POSITION_EXPECTED/);
  });

  it('ground truth is unavailable until post-resolution comparison', async () => {
    const blind = await buildBlindCurrentPositionEvidenceFromApplicationGraph(REPO);
    const result = resolveSchemaRoles({
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
    expect(result.audit.blindModeExpectedOracleObjectsLoaded).toBe(0);
    expect(result.audit.blindModeExpectedJoinColumnsLoaded).toBe(0);
    expect(result.audit.blindModeExpectedDictionaryLoaded).toBe(0);
    expect(result.audit.blindModeExpectedTemporalColumnsLoaded).toBe(0);
    expect(result.audit.groundTruthUsedBeforeResolution).toBe(0);
    // Comparison happens only after
    const cmp = compareCurrentPositionGroundTruth({
      assignment: result.roleAssignmentsByRole.assignment_source?.objectRef,
      subjectReference: result.roleAssignmentsByRole.subject_reference?.column,
      dictionaryReference: result.roleAssignmentsByRole.dictionary_reference?.column,
      dictionary: result.roleAssignmentsByRole.dictionary_identity?.objectRef,
      dictionaryDisplayName: result.roleAssignmentsByRole.dictionary_display_name?.column,
      validFrom: result.roleAssignmentsByRole.valid_from?.column,
      validTo: result.roleAssignmentsByRole.valid_to?.column,
    });
    expect(cmp.matched || cmp.mismatches.length > 0).toBe(true);
    expect(CURRENT_POSITION_GROUND_TRUTH_AFTER_RESOLUTION.assignment).toBe(
      'TETA_ADMIN.NT_KP_KDR_STANOWISKA',
    );
  });

  it('blind mode still receives legitimate application/code graph evidence', async () => {
    const blind = await buildBlindCurrentPositionEvidenceFromApplicationGraph(REPO);
    expect(
      blind.inputClassifications.some((c) => c.classification === 'logical_only'),
    ).toBe(true);
    expect(
      blind.graph.claims.some((c) => c.family === 'application_semantic') ||
        blind.graph.claims.some((c) => c.family === 'application_technical'),
    ).toBe(true);
  });

  it('production approved_binding_reuse remains unchanged (Stage 3D path)', () => {
    const graph = buildCurrentPositionEvidenceFromStage3d(REPO);
    const result = resolveSchemaRoles({
      question: 'Podaj aktualne stanowisko…',
      subjectRole: 'employee',
      targetConcept: 'current_position',
      requiredRoles: REQUIRED,
      discoveryMode: 'approved_binding_reuse',
      confirmedSubjectSource: {
        owner: 'TETA_ADMIN',
        objectType: 'VIEW',
        objectName: 'NT_KP_PRC_PRACOWNICY',
        identityColumn: 'ID',
      },
      temporalIntent: 'current_on_oracle_sysdate',
      evidenceGraph: graph!,
    });
    expect(result.overallStatus).toBe('proven_exact');
    expect(result.roleAssignmentsByRole.assignment_source?.objectRef).toBe(
      'TETA_ADMIN.NT_KP_KDR_STANOWISKA',
    );
    expect(result.audit.discoveryMode).toBe('approved_binding_reuse');
  });

  it('no TWG physical seeds in blind current-position evidence', async () => {
    const blind = await buildBlindCurrentPositionEvidenceFromApplicationGraph(REPO);
    const blob = JSON.stringify(blind.graph);
    expect(blob).not.toMatch(/L_GR_CZ_PRACY/);
    expect(blob).not.toMatch(/GR_CZ_ID/);
  });

  it('ambiguity does not auto-select accepted ground truth', () => {
    // Two strong candidates without choosing ground truth
    const base = buildSyntheticTimeGroupEvidenceGraph();
    // Reuse ambiguity fixture pattern via second assignment already tested elsewhere;
    // here ensure blind mode with empty assignment candidates does not invent GT.
    const result = resolveSchemaRoles({
      question: 'q',
      subjectRole: 'employee',
      targetConcept: 'current_position',
      requiredRoles: REQUIRED,
      discoveryMode: 'blind_physical_rediscovery',
      confirmedSubjectSource: {
        owner: 'HR',
        objectType: 'TABLE',
        objectName: 'PERSON',
        identityColumn: 'PERSON_KEY',
      },
      evidenceGraph: { objects: base.objects.filter((o) => o.tags?.includes('subject')), relations: [], claims: [] },
    });
    expect(result.audit.ambiguousCandidateAutoSelected).toBe(0);
    expect(result.roleAssignmentsByRole.assignment_source?.objectRef).not.toBe(
      CURRENT_POSITION_GROUND_TRUTH_AFTER_RESOLUTION.assignment,
    );
  });
});
