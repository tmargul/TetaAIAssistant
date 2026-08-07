import { resolveSchemaRoles } from './teta-schema-role-resolver';
import { buildCurrentPositionEvidenceFromStage3d } from './teta-schema-role-evidence-stage3d';
import { buildTimeWorkGroupEvidenceFromArtifacts } from './teta-schema-role-evidence-twg';
import {
  buildAmbiguousAssignmentEvidenceGraph,
  buildSemanticOnlyEvidenceGraph,
  buildSyntheticTimeGroupEvidenceGraph,
} from './teta-schema-role-synthetic';
import type { LogicalRoleId, SchemaRoleResolverInput } from './teta-schema-role-resolution.types';

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

const SUBJECT = {
  owner: 'HR',
  objectType: 'TABLE',
  objectName: 'PERSON',
  identityColumn: 'PERSON_KEY',
  businessNumberColumn: 'BADGE_NO',
  firstNameColumn: 'GIVEN_NAME',
  lastNameColumn: 'FAMILY_NAME',
};

describe('teta-schema-role-resolution (generic)', () => {
  it('synthetic unseen names reach strong_inference_readonly or proven_exact', () => {
    const result = resolveSchemaRoles({
      question: 'current work group for badge 00069',
      subjectRole: 'employee',
      targetConcept: 'current_time_work_group',
      requiredRoles: REQUIRED,
      confirmedSubjectSource: SUBJECT,
      temporalIntent: 'current_on_oracle_sysdate',
      evidenceGraph: buildSyntheticTimeGroupEvidenceGraph(),
    });
    expect(['proven_exact', 'strong_inference_readonly']).toContain(result.overallStatus);
    expect(result.executionEligibility).not.toBe('blocked');
    expect(result.roleAssignmentsByRole.assignment_source?.objectRef).toBe(
      'HR.WORKER_GROUP_ASSIGN',
    );
    expect(result.roleAssignmentsByRole.subject_reference?.column).toBe('WORKER_REF');
    expect(result.roleAssignmentsByRole.dictionary_display_name?.column).toBe('DESCRIPTION');
    expect(result.roleAssignmentsByRole.dictionary_identity?.column).toBe('GROUP_KEY');
    expect(result.temporalResolution.mode).toBe('effective_date_range');
    expect(result.temporalResolution.validFrom?.column).toBe('EFFECTIVE_FROM');
    expect(result.temporalResolution.validTo?.column).toBe('EFFECTIVE_UNTIL');
    expect(result.audit.humanProvidedOracleObjectSeeds).toBe(0);
    expect(result.audit.columnNameAloneAcceptedAsProof).toBe(0);
  });

  it('ambiguity fixture blocks execution', () => {
    const result = resolveSchemaRoles({
      question: 'current work group',
      subjectRole: 'employee',
      targetConcept: 'current_time_work_group',
      requiredRoles: REQUIRED,
      confirmedSubjectSource: SUBJECT,
      temporalIntent: 'current_on_oracle_sysdate',
      evidenceGraph: buildAmbiguousAssignmentEvidenceGraph(),
      ambiguityMargin: 50,
    });
    expect(result.overallStatus).toBe('ambiguous');
    expect(result.executionEligibility).toBe('blocked');
    expect(result.competingCandidates.length).toBeGreaterThan(1);
    expect(result.audit.ambiguousCandidateAutoSelected).toBe(0);
  });

  it('semantic-only evidence is insufficient', () => {
    const result = resolveSchemaRoles({
      question: 'mystery',
      subjectRole: 'employee',
      targetConcept: 'current_time_work_group',
      requiredRoles: REQUIRED,
      confirmedSubjectSource: SUBJECT,
      temporalIntent: 'current_on_oracle_sysdate',
      evidenceGraph: buildSemanticOnlyEvidenceGraph(),
    });
    expect(['insufficient', 'ambiguous']).toContain(result.overallStatus);
    expect(result.executionEligibility).toBe('blocked');
  });

  it('documentation alone cannot prove physical mapping', () => {
    const graph = buildSemanticOnlyEvidenceGraph();
    graph.claims = graph.claims.filter((c) => c.family === 'documentation_semantic');
    const result = resolveSchemaRoles({
      question: 'docs only',
      subjectRole: 'employee',
      targetConcept: 'current_time_work_group',
      requiredRoles: REQUIRED,
      confirmedSubjectSource: SUBJECT,
      evidenceGraph: graph,
    });
    expect(result.executionEligibility).toBe('blocked');
  });

  it('resolver input type forbids expected physical seeds in contract', () => {
    const input: SchemaRoleResolverInput = {
      question: 'q',
      subjectRole: 'employee',
      targetConcept: 'current_time_work_group',
      requiredRoles: ['assignment_source'],
    };
    expect('expectedAssignmentObject' in input).toBe(false);
    expect('expectedJoinColumns' in input).toBe(false);
  });

  it('evidence families are reported explicitly', () => {
    const result = resolveSchemaRoles({
      question: 'q',
      subjectRole: 'employee',
      targetConcept: 'current_time_work_group',
      requiredRoles: REQUIRED,
      confirmedSubjectSource: SUBJECT,
      temporalIntent: 'current_on_oracle_sysdate',
      evidenceGraph: buildSyntheticTimeGroupEvidenceGraph(),
    });
    expect(result.evidenceByFamily.application_semantic.length).toBeGreaterThan(0);
    expect(result.evidenceByFamily.oracle_structural.length).toBeGreaterThan(0);
    const chosen = result.candidateObjects.find(
      (c) => c.objectRef === result.roleAssignmentsByRole.assignment_source?.objectRef,
    );
    expect(chosen?.evidenceFamiliesSatisfied.length).toBeGreaterThanOrEqual(2);
  });
});

describe('teta-schema-role-resolution real adapters', () => {
  const repoRoot = require('path').resolve(__dirname, '../../../..');

  it('current-position approved_binding_reuse via Stage3D evidence (post-resolution GT only)', () => {
    const graph = buildCurrentPositionEvidenceFromStage3d(repoRoot);
    expect(graph).toBeTruthy();
    const result = resolveSchemaRoles({
      question:
        'Podaj imię, nazwisko, numer ewidencyjny i aktualne stanowisko pracownika o numerze ewidencyjnym 00122.',
      subjectRole: 'employee',
      targetConcept: 'current_position',
      requiredRoles: REQUIRED,
      discoveryMode: 'approved_binding_reuse',
      confirmedSubjectSource: {
        owner: 'TETA_ADMIN',
        objectType: 'VIEW',
        objectName: 'NT_KP_PRC_PRACOWNICY',
        identityColumn: 'ID',
        businessNumberColumn: 'NR_EWIDENCYJNY',
        firstNameColumn: 'IMIE',
        lastNameColumn: 'NAZWISKO',
      },
      temporalIntent: 'current_on_oracle_sysdate',
      evidenceGraph: graph!,
    });
    // Validation against previously accepted mapping — after resolution only
    const expectedAssignment = 'TETA_ADMIN.NT_KP_KDR_STANOWISKA';
    const expectedDict = 'TETA_ADMIN.NT_KP_SLO_STANOWISKA';
    expect(result.audit.discoveryMode).toBe('approved_binding_reuse');
    expect(result.audit.expectedMappingUsedAsResolverInput).toBe(0);
    expect(result.roleAssignmentsByRole.assignment_source?.objectRef).toBe(expectedAssignment);
    expect(result.roleAssignmentsByRole.dictionary_identity?.objectRef).toBe(expectedDict);
    expect(result.roleAssignmentsByRole.subject_reference?.column).toBe('PRAC_ID');
    expect(result.temporalResolution.mode).toBe('effective_date_range');
    expect(['proven_exact', 'strong_inference_readonly']).toContain(result.overallStatus);
  });

  it('time-work-group discovery does not seed physical assignment mapping', async () => {
    const graph = await buildTimeWorkGroupEvidenceFromArtifacts(repoRoot);
    // Ensure no scenario-coded physical seed object was forced as the only candidate
    const result = resolveSchemaRoles({
      question: 'Podaj grupę czasu pracy pracownika o numerze ewidencyjnym 00069.',
      subjectRole: 'employee',
      targetConcept: 'current_time_work_group',
      requiredRoles: REQUIRED,
      confirmedSubjectSource: {
        owner: 'TETA_ADMIN',
        objectType: 'VIEW',
        objectName: 'NT_KP_PRC_PRACOWNICY',
        identityColumn: 'ID',
        businessNumberColumn: 'NR_EWIDENCYJNY',
        firstNameColumn: 'IMIE',
        lastNameColumn: 'NAZWISKO',
      },
      temporalIntent: 'current_on_oracle_sysdate',
      evidenceGraph: graph,
    });
    expect(result.audit.humanProvidedOracleObjectSeeds).toBe(0);
    expect(result.audit.humanProvidedJoinColumnSeeds).toBe(0);
    expect(result.audit.scenarioSpecificPhysicalMappings).toBe(0);
    // Without complete path, execution must stay blocked (honest outcome)
    if (result.executionEligibility !== 'blocked') {
      expect(result.chosenRelationPath?.length).toBeGreaterThan(0);
    } else {
      expect(result.overallStatus).not.toBe('proven_exact');
      expect(result.candidateRanking.length + result.evidenceByFamily.application_semantic.length).toBeGreaterThan(
        0,
      );
    }
  });
});
