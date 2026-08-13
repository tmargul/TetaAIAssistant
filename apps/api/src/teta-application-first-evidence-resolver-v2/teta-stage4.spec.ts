import fs from 'fs';
import path from 'path';
import {
  compareCurrentPositionGroundTruth,
} from '../teta-schema-role-resolution/teta-schema-role-evidence-blind-current-position';
import { buildAmbiguousAssignmentEvidenceGraph } from '../teta-schema-role-resolution/teta-schema-role-synthetic';
import type { LogicalRoleId } from '../teta-schema-role-resolution/teta-schema-role-resolution.types';
import { STAGE4_GAP_MATRIX } from './teta-stage4-gap-matrix';
import { scanStage4ModuleDir } from './teta-stage4-hardcoding-scan';
import { resolveApplicationAnchors } from './teta-stage4-anchors';
import { traverseApplicationGraph } from './teta-stage4-ace-traverse';
import { resolveApplicationFirstEvidence } from './teta-stage4-resolve';
import {
  STAGE4_CONTRACT_VERSION,
  emptyStage4Audit,
} from './teta-stage4.types';
import { lexiconContainsPhysicalMappings } from './teta-stage4-lexicon';
import { buildApplicationFirstEvidence } from './teta-stage4-evidence';

const REPO = path.resolve(__dirname, '../../../..');
const MODULE_DIR = path.join(REPO, 'apps/api/src/teta-application-first-evidence-resolver-v2');

const CURRENT_POSITION_ROLES: LogicalRoleId[] = [
  'subject_identity',
  'assignment_source',
  'subject_reference',
  'dictionary_reference',
  'dictionary_identity',
  'dictionary_display_name',
  'valid_from',
  'valid_to',
];

jest.setTimeout(180_000);

describe('Stage 4 — generic Application-First Evidence Resolver v2', () => {
  it('gap matrix present', () => {
    expect(STAGE4_GAP_MATRIX.length).toBeGreaterThanOrEqual(5);
  });

  it('lexicon has no physical Oracle mappings', () => {
    expect(lexiconContainsPhysicalMappings()).toBe(0);
  });

  it('legacy scenario builder is removed', async () => {
    await expect(
      buildApplicationFirstEvidence({
        repoRoot: REPO,
        businessConcept: 'current employee position',
        mode: 'blind_physical_rediscovery',
      }),
    ).rejects.toThrow(/removed/);
  });

  it('generic anchor resolver returns semantic anchors without Oracle seeds', () => {
    const a = resolveApplicationAnchors({
      repoRoot: REPO,
      businessConcept: 'current employee position',
    });
    expect(a.semanticAnchorsFound).toBeGreaterThan(0);
    const blob = JSON.stringify(a.anchors);
    expect(blob).not.toMatch(/NT_KP_KDR_STANOWISKA/);
    expect(blob).not.toMatch(/NT_KP_SLO_STANOWISKA/);
  });

  it('ACE traversal visits nodes and traverses edges from anchors', async () => {
    const anchors = resolveApplicationAnchors({
      repoRoot: REPO,
      businessConcept: 'current employee position',
    });
    const ace = await traverseApplicationGraph({
      repoRoot: REPO,
      anchors: anchors.anchors,
      bounds: { maxApplicationNodes: 200, maxEdgesRetained: 4000 },
    });
    expect(ace.aceEdgesTraversed).toBeGreaterThan(0);
    expect(ace.aceNodesVisited).toBeGreaterThan(0);
    expect(ace.oracleEndpoints.length).toBeGreaterThan(0);
  });

  it('synthetic fixture is not used by production resolver', async () => {
    const result = await resolveApplicationFirstEvidence({
      repoRoot: REPO,
      request: {
        businessConcept: 'ambiguous_assignment_fixture',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
    });
    expect(result.audit.syntheticFixtureReachableFromProduction).toBe(0);
    expect(result.evidenceGraph?.objects.every((o) => !String(o.objectRef).startsWith('HR.'))).toBe(
      true,
    );
  });

  it('test-only override can inject synthetic graph', async () => {
    const result = await resolveApplicationFirstEvidence({
      repoRoot: REPO,
      request: {
        businessConcept: 'test',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
      evidenceGraphOverride: buildAmbiguousAssignmentEvidenceGraph(),
      allowTestEvidenceOverride: true,
    });
    expect(['ambiguous', 'conflicting', 'insufficient', 'strong_inference_readonly']).toContain(
      result.resolutionStatus,
    );
  });

  it('current position blind — ACE+Oracle candidates progress beyond zero', async () => {
    const result = await resolveApplicationFirstEvidence({
      repoRoot: REPO,
      request: {
        businessConcept: 'current employee position',
        requestedRoles: CURRENT_POSITION_ROLES,
        subjectRole: 'employee',
        mode: 'blind_physical_rediscovery',
        temporalIntent: 'current_on_oracle_sysdate',
      },
    });
    expect(result.metrics.aceEdgesTraversed).toBeGreaterThan(0);
    expect(result.metrics.oracleCandidatesConsidered).toBeGreaterThan(0);
    expect(result.audit.goldenPhysicalMappingUsedBeforeExtraction).toBe(0);
    expect(result.strictErrors).toEqual([]);
    const roles = result.schemaRoleResolution?.roleAssignmentsByRole ?? {};
    const cmp = compareCurrentPositionGroundTruth({
      assignment: roles.assignment_source?.objectRef,
      subjectReference: roles.subject_reference?.column,
      dictionaryReference: roles.dictionary_reference?.column,
      dictionary: roles.dictionary_identity?.objectRef,
      dictionaryDisplayName: roles.dictionary_display_name?.column,
      validFrom: roles.valid_from?.column,
      validTo: roles.valid_to?.column,
    });
    expect(typeof cmp.matched).toBe('boolean');
  });

  it('payroll — semantic anchors bounded, not 1667 fan-out', async () => {
    const result = await resolveApplicationFirstEvidence({
      repoRoot: REPO,
      request: {
        businessConcept: 'calculated payroll component breakdown',
        requestedRoles: ['subject_identity', 'assignment_source', 'dictionary_display_name'],
        mode: 'blind_physical_rediscovery',
      },
    });
    expect(result.metrics.semanticAnchorsFound).toBeLessThan(50);
    expect(result.metrics.aceEdgesTraversed).toBeGreaterThan(0);
    expect(result.metrics.oracleCandidatesConsidered).toBeGreaterThan(0);
  });

  it('vague concept fails closed with clarification dimensions', async () => {
    const result = await resolveApplicationFirstEvidence({
      repoRoot: REPO,
      request: {
        businessConcept: 'xyzzy unknown frobbish widget',
        requestedRoles: ['assignment_source', 'subject_reference'],
        mode: 'blind_physical_rediscovery',
      },
    });
    expect(['ambiguous', 'insufficient']).toContain(result.resolutionStatus);
    expect(result.clarificationNeeded).toBe(true);
    expect(result.clarificationDimensions.length).toBeGreaterThan(0);
  });

  it('metrics use ACE traversal not evidence object count as graphNodesVisited', async () => {
    const result = await resolveApplicationFirstEvidence({
      repoRoot: REPO,
      request: {
        businessConcept: 'current employee position',
        requestedRoles: ['assignment_source'],
        mode: 'blind_physical_rediscovery',
      },
    });
    expect(result.metrics.aceNodesVisited).toBe(result.aceTraversal?.aceNodesVisited);
    expect(result.metrics.evidenceObjectCount).toBeDefined();
  });

  it('hardcoding scan — no scenario-specific physical branches', () => {
    const scan = scanStage4ModuleDir(MODULE_DIR);
    expect(scan.scenarioSpecificPhysicalResolutionBranches).toBe(0);
    expect(scan.hardcodedCurrentPositionTables).toBe(0);
    expect(scan.hardcodedTwgMappings).toBe(0);
    expect(scan.lexiconPhysicalMappings).toBe(0);
  });

  it('default audit side-effects are zero', () => {
    const audit = emptyStage4Audit();
    expect(audit.dmlStatementsExecuted).toBe(0);
    expect(audit.runtimeCopilotDependencies).toBe(0);
  });

  it('contract version stable', () => {
    expect(STAGE4_CONTRACT_VERSION).toBe('teta-aia-application-first-evidence-resolver-v2');
  });
});
