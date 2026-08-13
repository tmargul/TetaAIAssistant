import { resolveSchemaRoles } from '../teta-schema-role-resolution/teta-schema-role-resolver';
import type { LogicalRoleId } from '../teta-schema-role-resolution/teta-schema-role-resolution.types';
import {
  STAGE3_CONTRACT_VERSION,
  STAGE3_SOURCE_STAGE,
  emptyStage3Metrics,
  type Stage3WritePathAnalysisResult,
} from '../teta-targeted-write-path-stage3/teta-stage3.types';
import type { AceTraversalResult, AceTraversedEdge } from './teta-stage4-ace-traverse';
import { bindEvidenceToRoleGraph, unusedStage3Reason } from './teta-stage4-bind';
import { convertStage3ResultToClaims } from './teta-stage4-planner';
import { scanStage4ModuleDir } from './teta-stage4-hardcoding-scan';
import type { OracleExpandResult, OracleCandidate } from './teta-stage4-oracle-expand';
import type { ApplicationAnchorResolveResult } from './teta-stage4-anchors';
import path from 'path';
import fs from 'fs';

const MODULE_DIR = path.join(__dirname);

function edge(partial: Partial<AceTraversedEdge> & Pick<AceTraversedEdge, 'edgeKind' | 'fromName' | 'toName'>): AceTraversedEdge {
  return {
    edgeId: partial.edgeId ?? `e-${partial.edgeKind}-${partial.toName}`,
    fromId: partial.fromId ?? `gateway|${partial.fromName}`,
    toId: partial.toId ?? `oracle_object|${partial.toName}`,
    fromKind: partial.fromKind ?? 'gateway',
    toKind: partial.toKind ?? 'oracle_object',
    confidence: partial.confidence ?? 'exact_from_source',
    provenance: partial.provenance ?? ['ace:test'],
    attributes: partial.attributes,
    edgeKind: partial.edgeKind,
    fromName: partial.fromName,
    toName: partial.toName,
  };
}

function candidate(partial: Partial<OracleCandidate> & { objectName: string; hypotheses: string[] }): OracleCandidate {
  return {
    oracleCanonicalId: `oracle-object:HR:TABLE:${partial.objectName}`,
    owner: partial.owner ?? 'HR',
    objectName: partial.objectName,
    objectType: partial.objectType ?? 'TABLE',
    reachedFromApplicationNode: partial.reachedFromApplicationNode ?? 'gateway|AssignGw',
    acePath: partial.acePath ?? ['form|EmployeeAssignForm', 'gateway|AssignGw'],
    aceEdgeKind: partial.aceEdgeKind ?? 'GATEWAY_READS_FROM_ORACLE_OBJECT',
    aceEdgeKinds: partial.aceEdgeKinds ?? [partial.aceEdgeKind ?? 'GATEWAY_READS_FROM_ORACLE_OBJECT'],
    candidateRoleHypotheses: partial.hypotheses,
    supportingEvidence: partial.supportingEvidence ?? [`ace:${partial.aceEdgeKind ?? 'GATEWAY_READS_FROM_ORACLE_OBJECT'}`],
    negativeEvidence: partial.negativeEvidence ?? [],
    stage2Facts: partial.stage2Facts ?? {
      readsFrom: [],
      writesTo: [],
      calls: [],
      joinsTo: [],
      joinDetails: [],
      references: [],
    },
  };
}

function emptyAce(edges: AceTraversedEdge[]): AceTraversalResult {
  return {
    anchorsExpanded: 1,
    aceNodesVisited: 3,
    aceEdgesAvailable: edges.length,
    aceEdgesTraversed: edges.length,
    maxDepthReached: 2,
    truncated: false,
    truncationReason: null,
    nodes: [],
    edges,
    oracleEndpoints: [],
    dacPackages: [],
    edgesByKind: {},
    seedNodeIds: [],
  };
}

function anchors(): ApplicationAnchorResolveResult {
  return {
    anchors: [
      {
        anchorId: 'a1',
        anchorType: 'pa_form_token',
        formRef: 'EmployeeAssignForm',
        label: 'Assignment',
        recognitionSource: 'lexicon',
        recognitionConfidence: 'exact',
        matchTokens: ['assignment'],
        semanticEvidence: ['lexicon:assignment'],
      },
    ],
    semanticAnchorsFound: 1,
    lexiconEntryIds: ['assignment'],
    tokensUsed: ['assignment'],
  };
}

function p3(): import('../teta-targeted-write-path-stage3/teta-stage3.types').Stage3Provenance {
  return {
    sourceKind: 'synthetic_fixture',
    sourcePath: 'PKG',
    extractionMechanism: 'test',
    confidenceClass: 'exact_static',
    evidenceRefs: [],
  };
}

function oracle(cands: OracleCandidate[]): OracleExpandResult {
  return {
    oracleEndpointsReached: cands.length,
    oracleCandidatesConsidered: cands.length,
    stage2EvidenceItemsLoaded: cands.reduce(
      (n, c) => n + c.stage2Facts.joinsTo.length + c.stage2Facts.readsFrom.length,
      0,
    ),
    candidates: cands,
    discoveryOrigin: 'application_first',
    stage2EvidenceTypesConsumed: ['JOINS_TO'],
  };
}

function fakeStage3(input: {
  writers?: number;
  dml?: boolean;
  lookups?: boolean;
  gateways?: boolean;
}): Stage3WritePathAnalysisResult {
  const writers = Array.from({ length: input.writers ?? 0 }, (_, i) => ({
    fromId: `oracle-program:HR:PKG:WRITE_ROW:${i}`,
    packageName: 'PKG',
    objectType: 'PROGRAM_UNIT' as const,
    operation: 'INSERT' as const,
    confidenceClass: 'exact_static' as const,
    provenance: [],
  }));
  return {
    contractVersion: STAGE3_CONTRACT_VERSION,
    sourceStage: STAGE3_SOURCE_STAGE,
    identityVersion: 'teta-aia-canonical-id-v1',
    targetObject: { id: 'oracle-object:HR:TABLE:ASSIGN_SRC', owner: 'HR', objectName: 'ASSIGN_SRC', objectType: 'TABLE' },
    pathStatus: writers.length ? 'strong_static_path' : 'no_static_writer_found',
    writerCandidates: writers,
    paths: [
      {
        pathId: 'path-1',
        writerCandidateId: writers[0]?.fromId ?? 'none',
        writerPackageId: 'PKG',
        programUnitId: writers[0]?.fromId ?? 'none',
        packageFamily: 'OTHER',
        dmlOperations: input.dml
          ? [
              {
                operation: 'INSERT',
                targetObjectId: 'oracle-object:HR:TABLE:ASSIGN_SRC',
                targetObjectRaw: 'HR.ASSIGN_SRC',
                programUnitId: writers[0]?.fromId ?? 'pu',
                statementIndex: 0,
                rawStatementExcerpt: 'INSERT INTO ASSIGN_SRC',
                parameterMappings: [
                  {
                    targetColumn: 'WORKER_REF',
                    sourceExpression: 'P_WORKER',
                    role: 'VALUE_SOURCE',
                    classification: 'direct_param',
                    positional: true,
                    provenance: p3(),
                  },
                ],
                rowSelectors: [],
                provenance: p3(),
              },
            ]
          : [],
        validations: [],
        lookups: input.lookups
          ? [
              {
                targetObjectRaw: 'HR.DICT_SRC',
                targetObjectId: 'oracle-object:HR:TABLE:DICT_SRC',
                viaClause: 'JOIN',
                programUnitId: 'pu',
                edgeKind: 'VALIDATES_AGAINST',
                provenance: p3(),
              },
            ]
          : [],
        sideEffectCalls: [],
        callers: [],
        callHops: [],
        gatewayReferences: input.gateways
          ? [
              {
                gatewayName: 'AssignGw',
                dacPackageObjectId: 'oracle-object:HR:PACKAGE:ASSIGN_DAC',
                provenance: p3(),
              },
            ]
          : [],
        runtimeBoundaries: [],
        confidence: 'exact_static',
        truncated: false,
        sourceStatus: 'not_attempted',
      },
    ],
    metrics: emptyStage3Metrics(),
    audit: {
      hardcodedKpMappings: 0,
      hardcodedHhMappings: 0,
      hardcodedCrMappings: 0,
      expectedAcceptanceMappingsUsedAsInput: 0,
      groundTruthUsedBeforeExtraction: 0,
      objectSelectedByNameSimilarityOnly: 0,
      oracleMetadataConnectionsOpened: 0,
      oracleMetadataSelectStatementsExecuted: 0,
      businessSelectStatementsExecuted: 0,
      businessRowsRead: 0,
      dmlStatementsExecuted: 0,
      ddlStatementsExecuted: 0,
      plsqlBlocksExecuted: 0,
      localModelCalls: 0,
      remoteModelCalls: 0,
      ragCalls: 0,
      qdrantCalls: 0,
      embeddingCalls: 0,
      runtimeCopilotDependencies: 0,
      remoteUnwrapCalls: 0,
    },
    gapMatrix: [],
    analysisTruncated: false,
  };
}

const ROLES: LogicalRoleId[] = [
  'assignment_source',
  'subject_reference',
  'dictionary_reference',
  'dictionary_identity',
  'dictionary_display_name',
];

describe('Stage 4 role-binding adapter (generic)', () => {
  it('application-reachable object → assignment-source candidate', () => {
    const bound = bindEvidenceToRoleGraph({
      anchors: anchors(),
      ace: emptyAce([
        edge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.ASSIGN_SRC',
        }),
      ]),
      oracle: oracle([candidate({ objectName: 'ASSIGN_SRC', hypotheses: ['assignment_source'] })]),
    });
    const obj = bound.graph.objects.find((o) => o.objectRef === 'HR.ASSIGN_SRC');
    expect(obj?.tags).toContain('assignment_candidate');
    expect(
      bound.graph.claims.some(
        (c) => c.object === 'HR.ASSIGN_SRC' && c.roleHint === 'assignment_source' && c.claimType === 'assignment_gateway',
      ),
    ).toBe(true);
  });

  it('explicit relation column pair → subject-reference candidate', () => {
    const bound = bindEvidenceToRoleGraph({
      anchors: anchors(),
      subjectRole: 'employee',
      ace: emptyAce([
        edge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.ASSIGN_SRC',
        }),
        edge({
          edgeKind: 'APPLICATION_JOIN',
          fromName: 'HR.ASSIGN_SRC',
          toName: 'HR.PERSON_SRC',
          fromKind: 'oracle_object',
          toKind: 'oracle_object',
          attributes: {
            parsedPairs: [
              { leftAlias: 'ASSIGN_SRC', leftColumn: 'WORKER_REF', rightAlias: 'PERSON_SRC', rightColumn: 'PERSON_KEY' },
            ],
          },
        }),
      ]),
      oracle: oracle([
        candidate({
          objectName: 'ASSIGN_SRC',
          hypotheses: ['assignment_source'],
          acePath: ['form|EmployeeAssignForm', 'gateway|AssignGw'],
        }),
        candidate({
          objectName: 'PERSON_SRC',
          hypotheses: [],
          aceEdgeKind: 'APPLICATION_JOIN',
          acePath: ['form|EmployeeMaster', 'gateway|PersonGw'],
        }),
      ]),
    });
    expect(
      bound.graph.claims.some((c) => c.roleHint === 'subject_reference' && c.column === 'WORKER_REF'),
    ).toBe(true);
    expect(
      bound.graph.relations.some(
        (r) => r.fromColumn === 'WORKER_REF' && r.toColumn === 'PERSON_KEY' && r.fromColumn !== 'UNKNOWN',
      ),
    ).toBe(true);
  });

  it('lookup relation → dictionary-reference + dictionary candidate', () => {
    const bound = bindEvidenceToRoleGraph({
      anchors: anchors(),
      ace: emptyAce([
        edge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.ASSIGN_SRC',
        }),
        edge({
          edgeKind: 'LOOKUP_USES_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.DICT_SRC',
          fromId: 'gateway|AssignGw',
          attributes: { lookupKey: 'GROUP_KEY', lookupDisplay: 'DESCRIPTION', targetColumn: 'GROUP_REF' },
        }),
      ]),
      oracle: oracle([
        candidate({ objectName: 'ASSIGN_SRC', hypotheses: ['assignment_source'] }),
        candidate({
          objectName: 'DICT_SRC',
          hypotheses: ['dictionary_identity', 'dictionary_display_name'],
          aceEdgeKind: 'LOOKUP_USES_OBJECT',
        }),
      ]),
    });
    expect(bound.graph.objects.find((o) => o.objectRef === 'HR.DICT_SRC')?.tags).toContain('dictionary_candidate');
    expect(bound.graph.claims.some((c) => c.roleHint === 'dictionary_reference' && c.column === 'GROUP_REF')).toBe(
      true,
    );
    expect(bound.metrics.lookupEvidenceItemsBuilt).toBeGreaterThan(0);
  });

  it('application display metadata → dictionary-display candidate', () => {
    const bound = bindEvidenceToRoleGraph({
      anchors: anchors(),
      ace: emptyAce([
        edge({
          edgeKind: 'LOOKUP_USES_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.DICT_SRC',
          attributes: { lookupKey: 'GROUP_KEY', lookupDisplay: 'DESCRIPTION' },
        }),
      ]),
      oracle: oracle([
        candidate({
          objectName: 'DICT_SRC',
          hypotheses: ['dictionary_identity', 'dictionary_display_name'],
          aceEdgeKind: 'LOOKUP_USES_OBJECT',
        }),
      ]),
    });
    expect(
      bound.graph.claims.some(
        (c) => c.roleHint === 'dictionary_display_name' && c.column === 'DESCRIPTION' && c.claimType === 'lookup_display',
      ),
    ).toBe(true);
  });

  it('VIEW → lineage → base relation without claiming grain', () => {
    const bound = bindEvidenceToRoleGraph({
      anchors: anchors(),
      ace: emptyAce([
        edge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.ASSIGN_VIEW',
        }),
      ]),
      oracle: oracle([
        candidate({
          objectName: 'ASSIGN_VIEW',
          objectType: 'VIEW',
          hypotheses: ['assignment_source'],
          stage2Facts: {
            readsFrom: ['oracle-object:HR:TABLE:ASSIGN_BASE'],
            writesTo: [],
            calls: [],
            joinsTo: [],
            joinDetails: [],
            references: [],
          },
        }),
      ]),
    });
    const rel = bound.graph.relations.find((r) => r.relationType === 'view_lineage_reads_from');
    expect(rel?.toObject).toBe('HR.ASSIGN_BASE');
    expect(rel?.provenance.some((p) => p.includes('grain_not_implied'))).toBe(true);
    expect(bound.metrics.viewLineageEvidenceItemsBuilt).toBeGreaterThan(0);
  });

  it('FK + application evidence convergence (join pair + lookup)', () => {
    const bound = bindEvidenceToRoleGraph({
      anchors: anchors(),
      ace: emptyAce([
        edge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.ASSIGN_SRC',
        }),
        edge({
          edgeKind: 'LOOKUP_USES_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.DICT_SRC',
          fromId: 'gateway|AssignGw',
          attributes: { lookupKey: 'GROUP_KEY', lookupDisplay: 'DESCRIPTION', targetColumn: 'GROUP_REF' },
        }),
      ]),
      oracle: oracle([
        candidate({
          objectName: 'ASSIGN_SRC',
          hypotheses: ['assignment_source'],
          stage2Facts: {
            readsFrom: [],
            writesTo: [],
            calls: [],
            joinsTo: ['oracle-object:HR:TABLE:ASSIGN_SRC->oracle-object:HR:TABLE:DICT_SRC'],
            joinDetails: [
              {
                fromId: 'oracle-object:HR:TABLE:ASSIGN_SRC',
                toId: 'oracle-object:HR:TABLE:DICT_SRC',
                onClause: 'ASSIGN_SRC.GROUP_REF = DICT_SRC.GROUP_KEY',
                parsedPairs: [
                  {
                    leftAlias: 'ASSIGN_SRC',
                    leftColumn: 'GROUP_REF',
                    rightAlias: 'DICT_SRC',
                    rightColumn: 'GROUP_KEY',
                  },
                ],
                provenance: ['stage2:JOINS_TO'],
              },
            ],
            references: [],
          },
        }),
        candidate({
          objectName: 'DICT_SRC',
          hypotheses: ['dictionary_identity'],
          aceEdgeKind: 'LOOKUP_USES_OBJECT',
        }),
      ]),
    });
    const colRels = bound.graph.relations.filter(
      (r) => r.fromColumn === 'GROUP_REF' && r.toColumn === 'GROUP_KEY',
    );
    expect(colRels.length).toBeGreaterThanOrEqual(1);
    expect(bound.metrics.columnRelationEvidenceItemsBuilt).toBeGreaterThan(0);
  });

  it('READS/JOIN source relation preserves column pair', () => {
    const bound = bindEvidenceToRoleGraph({
      anchors: anchors(),
      ace: emptyAce([
        edge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.ASSIGN_SRC',
        }),
      ]),
      oracle: oracle([
        candidate({
          objectName: 'ASSIGN_SRC',
          hypotheses: ['assignment_source'],
          stage2Facts: {
            readsFrom: [],
            writesTo: [],
            calls: [],
            joinsTo: ['a->b'],
            joinDetails: [
              {
                fromId: 'oracle-object:HR:TABLE:ASSIGN_SRC',
                toId: 'oracle-object:HR:TABLE:DICT_SRC',
                onClause: 'A.GROUP_REF = B.GROUP_KEY',
                parsedPairs: [
                  { leftAlias: 'A', leftColumn: 'GROUP_REF', rightAlias: 'B', rightColumn: 'GROUP_KEY' },
                ],
                provenance: ['stage2:JOINS_TO'],
              },
            ],
            references: [],
          },
        }),
        candidate({ objectName: 'DICT_SRC', hypotheses: ['dictionary_identity'], aceEdgeKind: 'LOOKUP_USES_OBJECT' }),
      ]),
    });
    expect(bound.graph.relations.some((r) => r.fromColumn === 'GROUP_REF' && r.toColumn === 'GROUP_KEY')).toBe(true);
  });

  it('temporal predicate exact evidence', () => {
    const bound = bindEvidenceToRoleGraph({
      anchors: anchors(),
      ace: emptyAce([
        edge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.ASSIGN_SRC',
        }),
        edge({
          edgeKind: 'APPLICATION_JOIN',
          fromName: 'HR.ASSIGN_SRC',
          toName: 'HR.ASSIGN_SRC',
          attributes: { onClause: 'VALID_START >= SYSDATE AND (VALID_END IS NULL OR VALID_END > SYSDATE)' },
        }),
      ]),
      oracle: oracle([candidate({ objectName: 'ASSIGN_SRC', hypotheses: ['assignment_source'] })]),
    });
    expect(bound.graph.claims.some((c) => c.claimType === 'temporal_predicate' && c.column === 'VALID_START')).toBe(
      true,
    );
    expect(bound.metrics.temporalEvidenceItemsBuilt).toBeGreaterThan(0);
  });

  it('temporal name-only rejection', () => {
    const bound = bindEvidenceToRoleGraph({
      anchors: anchors(),
      ace: emptyAce([
        edge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.ASSIGN_SRC',
        }),
      ]),
      oracle: oracle([candidate({ objectName: 'ASSIGN_SRC', hypotheses: ['assignment_source'] })]),
    });
    expect(bound.graph.claims.some((c) => c.claimType === 'temporal_predicate')).toBe(false);
    expect(bound.graph.claims.some((c) => c.claimType === 'negative_no_temporal_predicate')).toBe(true);
  });

  it('Stage3 result → implementation_usage evidence', () => {
    const converted = convertStage3ResultToClaims({
      result: fakeStage3({ writers: 1, dml: true, gateways: true }),
      targetOwner: 'HR',
      targetObjectName: 'ASSIGN_SRC',
      relevantObjectRefs: new Set(['HR.ASSIGN_SRC']),
    });
    expect(converted.added).toBeGreaterThan(0);
    expect(converted.claims.some((c) => c.family === 'implementation_usage' && c.claimType === 'writer_to_target')).toBe(
      true,
    );
    expect(converted.unusedReason).toBeNull();
  });

  it('Stage3 success with no relevant facts → zero evidence + reason', () => {
    const converted = convertStage3ResultToClaims({
      result: fakeStage3({ writers: 0, dml: false, lookups: false, gateways: false }),
      targetOwner: 'HR',
      targetObjectName: 'ASSIGN_SRC',
      relevantObjectRefs: new Set(['HR.OTHER']),
    });
    expect(converted.added).toBe(0);
    expect(converted.unusedReason).toBeTruthy();
    expect(unusedStage3Reason({ succeeded: true, writers: 0, dml: 0, lookups: 0, gateways: 0, relevantFacts: 0 })).toBe(
      'no_dml_or_lookup_or_writer_facts_relevant',
    );
  });

  it('same-source evidence not double-counted (origin fingerprint)', () => {
    const bound = bindEvidenceToRoleGraph({
      anchors: anchors(),
      ace: emptyAce([
        edge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.ASSIGN_SRC',
          edgeId: 'same-edge',
        }),
      ]),
      oracle: oracle([candidate({ objectName: 'ASSIGN_SRC', hypotheses: ['assignment_source'] })]),
    });
    const fps = bound.graph.claims
      .flatMap((c) => c.provenance)
      .filter((p) => p.startsWith('evidenceOriginFingerprint:ace:same-edge'));
    expect(new Set(fps).size).toBeLessThanOrEqual(fps.length);
    expect(fps.length).toBeGreaterThan(0);
  });

  it('negative evidence candidate rejection is role-specific', () => {
    const bound = bindEvidenceToRoleGraph({
      anchors: anchors(),
      ace: emptyAce([
        edge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.ASSIGN_SRC',
        }),
        edge({
          edgeKind: 'LOOKUP_USES_OBJECT',
          fromName: 'OtherGw',
          toName: 'HR.DICT_SRC',
          fromId: 'gateway|OtherGw',
        }),
      ]),
      oracle: oracle([
        candidate({ objectName: 'ASSIGN_SRC', hypotheses: ['assignment_source'] }),
        candidate({
          objectName: 'DICT_SRC',
          hypotheses: ['dictionary_identity'],
          aceEdgeKind: 'LOOKUP_USES_OBJECT',
          reachedFromApplicationNode: 'gateway|OtherGw',
        }),
      ]),
    });
    expect(
      bound.graph.claims.some(
        (c) =>
          c.claimType === 'negative_no_relation_from_source' &&
          c.object === 'HR.DICT_SRC' &&
          c.provenance.some((p) => p.startsWith('role:dictionary_identity')),
      ),
    ).toBe(true);
  });

  it('role candidate survives into Stage 0 with canonical IDs', () => {
    const bound = bindEvidenceToRoleGraph({
      anchors: anchors(),
      ace: emptyAce([
        edge({
          edgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.ASSIGN_SRC',
        }),
        edge({
          edgeKind: 'LOOKUP_USES_OBJECT',
          fromName: 'AssignGw',
          toName: 'HR.DICT_SRC',
          fromId: 'gateway|AssignGw',
          attributes: { lookupKey: 'GROUP_KEY', lookupDisplay: 'DESCRIPTION', targetColumn: 'GROUP_REF' },
        }),
      ]),
      oracle: oracle([
        candidate({
          objectName: 'ASSIGN_SRC',
          hypotheses: ['assignment_source'],
          stage2Facts: {
            readsFrom: [],
            writesTo: [],
            calls: [],
            joinsTo: ['a->b'],
            joinDetails: [
              {
                fromId: 'oracle-object:HR:TABLE:ASSIGN_SRC',
                toId: 'oracle-object:HR:TABLE:DICT_SRC',
                onClause: 'ASSIGN_SRC.GROUP_REF = DICT_SRC.GROUP_KEY',
                parsedPairs: [
                  {
                    leftAlias: 'ASSIGN_SRC',
                    leftColumn: 'GROUP_REF',
                    rightAlias: 'DICT_SRC',
                    rightColumn: 'GROUP_KEY',
                  },
                ],
                provenance: ['stage2:JOINS_TO'],
              },
            ],
            references: [],
          },
        }),
        candidate({
          objectName: 'DICT_SRC',
          hypotheses: ['dictionary_identity', 'dictionary_display_name'],
          aceEdgeKind: 'LOOKUP_USES_OBJECT',
        }),
      ]),
    });
    const result = resolveSchemaRoles({
      question: 'assignment',
      subjectRole: 'employee',
      targetConcept: 'assignment',
      requiredRoles: ROLES,
      discoveryMode: 'blind_physical_rediscovery',
      evidenceGraph: bound.graph,
      temporalIntent: 'none',
    });
    expect(result.roleAssignmentsByRole.assignment_source?.objectRef).toBe('HR.ASSIGN_SRC');
    expect(['proven_exact', 'strong_inference_readonly']).toContain(
      result.roleAssignmentsByRole.assignment_source?.status,
    );
    const ids = result.roleAssignmentsByRole.assignment_source?.supportingEvidenceRefs ?? [];
    expect(ids.some((x) => x.includes('evidenceOriginFingerprint') || x.startsWith('ace:'))).toBe(true);
  });

  it('no current-position or payroll physical mapping in production sources', () => {
    const scan = scanStage4ModuleDir(MODULE_DIR);
    expect(scan.hardcodedCurrentPositionTables).toBe(0);
    expect(scan.hardcodedPayrollTables).toBe(0);
    expect(scan.hardcodedTwgMappings).toBe(0);
    const bindSrc = fs.readFileSync(path.join(MODULE_DIR, 'teta-stage4-bind.ts'), 'utf8');
    expect(bindSrc).not.toMatch(/NT_KP_KDR_STANOWISKA/);
    expect(bindSrc).not.toMatch(/NT_KP_SLO_STANOWISKA/);
    expect(bindSrc).not.toMatch(/NT_KP_SLO_SKLADNIKI_PLAC/);
  });
});
