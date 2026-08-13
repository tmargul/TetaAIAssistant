import type { SchemaEvidenceGraph } from '../teta-schema-role-resolution/teta-schema-role-resolution.types';
import { resolveSchemaRoles } from '../teta-schema-role-resolution/teta-schema-role-resolver';
import {
  buildBindingHypotheses,
  detectAmbiguousHypotheses,
  filterGraphForHypothesis,
  roleDependenciesFor,
} from './teta-stage4-hypotheses';
import type { OracleExpandResult } from './teta-stage4-oracle-expand';
import { bindEvidenceToRoleGraph } from './teta-stage4-bind';
import type { AceTraversalResult } from './teta-stage4-ace-traverse';
import type { ApplicationAnchorResolveResult } from './teta-stage4-anchors';

function graphWithDisconnectedRoles(): SchemaEvidenceGraph {
  return {
    objects: [
      { objectRef: 'HR.ASSIGN_A', objectName: 'ASSIGN_A', tags: ['assignment_candidate'], columns: [] },
      { objectRef: 'HR.DICT_B', objectName: 'DICT_B', tags: ['dictionary_candidate'], columns: [{ name: 'ID' }] },
    ],
    relations: [],
    claims: [
      {
        family: 'application_technical',
        claimType: 'gateway_reads_oracle',
        object: 'HR.ASSIGN_A',
        weight: 3,
        provenance: ['ace:gateway'],
      },
      {
        family: 'application_technical',
        claimType: 'gateway_reads_oracle',
        object: 'HR.DICT_B',
        weight: 2,
        provenance: ['ace:lookup'],
        roleHint: 'dictionary_identity',
      },
    ],
  };
}

function graphWithConnectedRoles(): SchemaEvidenceGraph {
  return {
    objects: [
      { objectRef: 'HR.ASSIGN_A', objectName: 'ASSIGN_A', tags: ['assignment_candidate'], columns: [{ name: 'DICT_ID' }] },
      { objectRef: 'HR.DICT_B', objectName: 'DICT_B', tags: ['dictionary_candidate'], columns: [{ name: 'ID' }, { name: 'NAZWA' }] },
    ],
    relations: [
      {
        fromObject: 'HR.ASSIGN_A',
        fromColumn: 'DICT_ID',
        toObject: 'HR.DICT_B',
        toColumn: 'ID',
        relationType: 'lookup_join',
        family: 'oracle_structural',
        provenance: ['join:exact', 'confidence:exact_static'],
      },
    ],
    claims: [
      {
        family: 'application_technical',
        claimType: 'gateway_reads_oracle',
        object: 'HR.ASSIGN_A',
        weight: 3,
        provenance: ['ace:gateway'],
      },
      {
        family: 'application_technical',
        claimType: 'lookup_display',
        object: 'HR.DICT_B',
        column: 'NAZWA',
        roleHint: 'dictionary_display_name',
        weight: 2,
        provenance: ['ace:lookupDisplay'],
      },
    ],
  };
}

function emptyOracle(cands: OracleExpandResult['candidates']): OracleExpandResult {
  return {
    oracleEndpointsReached: cands.length,
    oracleCandidatesConsidered: cands.length,
    stage2EvidenceItemsLoaded: 0,
    candidates: cands,
    discoveryOrigin: 'application_first',
    stage2EvidenceTypesConsumed: [],
  };
}

describe('teta-stage4-hypotheses', () => {
  it('role dependency: dictionary display does not require temporal', () => {
    const deps = roleDependenciesFor(['dictionary_display_name', 'dictionary_identity']);
    const display = deps.find((d) => d.role === 'dictionary_display_name');
    expect(display?.dependsOn).toContain('dictionary_identity');
    expect(display?.requiresTemporalPredicate).toBeFalsy();
  });

  it('two individually reachable roles do NOT form one strong hypothesis without relation', () => {
    const graph = graphWithDisconnectedRoles();
    const oracle = emptyOracle([
      {
        oracleCanonicalId: 'o:HR:ASSIGN_A',
        owner: 'HR',
        objectName: 'ASSIGN_A',
        objectType: 'TABLE',
        reachedFromApplicationNode: 'gw',
        acePath: ['form|F'],
        aceEdgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
        aceEdgeKinds: ['GATEWAY_READS_FROM_ORACLE_OBJECT'],
        candidateRoleHypotheses: ['assignment_source'],
        supportingEvidence: ['ace:gw'],
        negativeEvidence: [],
        stage2Facts: { readsFrom: [], writesTo: [], calls: [], joinsTo: [], joinDetails: [], references: [] },
      },
    ]);
    const hyps = buildBindingHypotheses({
      graph,
      oracle,
      requestedRoles: ['assignment_source', 'dictionary_identity', 'dictionary_reference'],
    });
    expect(hyps[0]?.hypothesisStatus).not.toBe('proven_exact');
    expect(hyps[0]?.crossPathRoleMerges).toBe(0);
    expect(hyps[0]?.connectedRoleCount).toBeLessThan(2);
  });

  it('assignment + dictionary connected via exact join → one coherent hypothesis', () => {
    const graph = graphWithConnectedRoles();
    const oracle = emptyOracle([
      {
        oracleCanonicalId: 'o:HR:ASSIGN_A',
        owner: 'HR',
        objectName: 'ASSIGN_A',
        objectType: 'TABLE',
        reachedFromApplicationNode: 'gw',
        acePath: ['form|F'],
        aceEdgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
        aceEdgeKinds: ['GATEWAY_READS_FROM_ORACLE_OBJECT'],
        candidateRoleHypotheses: ['assignment_source'],
        supportingEvidence: ['ace:gw'],
        negativeEvidence: [],
        stage2Facts: { readsFrom: [], writesTo: [], calls: [], joinsTo: [], joinDetails: [], references: [] },
      },
    ]);
    const hyps = buildBindingHypotheses({
      graph,
      oracle,
      requestedRoles: ['assignment_source', 'dictionary_identity', 'dictionary_reference', 'dictionary_display_name'],
    });
    expect(hyps[0]?.dictionaryRef).toBe('HR.DICT_B');
    expect(hyps[0]?.connectedRoleCount).toBeGreaterThanOrEqual(2);
    expect(hyps[0]?.crossPathRoleMerges).toBe(0);
  });

  it('Stage0 does not cross-path merge dictionary when blind mode', () => {
    const graph = graphWithDisconnectedRoles();
    const result = resolveSchemaRoles({
      question: 'test',
      subjectRole: 'entity',
      targetConcept: 'test concept',
      requiredRoles: ['assignment_source', 'dictionary_identity'],
      discoveryMode: 'blind_physical_rediscovery',
      evidenceGraph: graph,
      bindingHypothesisContext: {
        hypothesisId: 'h1',
        assignmentRef: 'HR.ASSIGN_A',
        forbidCrossPathDictionaryFallback: true,
      },
    });
    expect(result.candidateRanking[0]?.objectRef).toBe('HR.ASSIGN_A');
    expect(result.overallStatus).not.toBe('strong_inference_readonly');
    expect(result.roleAssignmentsByRole.dictionary_identity?.status ?? 'insufficient').toBe('insufficient');
  });

  it('ambiguous coherent hypotheses detected within margin', () => {
    const graph = graphWithConnectedRoles();
    const oracle = emptyOracle([
      {
        oracleCanonicalId: 'o:HR:ASSIGN_A',
        owner: 'HR',
        objectName: 'ASSIGN_A',
        objectType: 'TABLE',
        reachedFromApplicationNode: 'gw',
        acePath: ['form|F1'],
        aceEdgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
        aceEdgeKinds: ['GATEWAY_READS_FROM_ORACLE_OBJECT'],
        candidateRoleHypotheses: ['assignment_source'],
        supportingEvidence: ['ace:gw'],
        negativeEvidence: [],
        stage2Facts: { readsFrom: [], writesTo: [], calls: [], joinsTo: [], joinDetails: [], references: [] },
      },
      {
        oracleCanonicalId: 'o:HR:ASSIGN_B',
        owner: 'HR',
        objectName: 'ASSIGN_B',
        objectType: 'TABLE',
        reachedFromApplicationNode: 'gw2',
        acePath: ['form|F2'],
        aceEdgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
        aceEdgeKinds: ['GATEWAY_READS_FROM_ORACLE_OBJECT'],
        candidateRoleHypotheses: ['assignment_source'],
        supportingEvidence: ['ace:gw2'],
        negativeEvidence: [],
        stage2Facts: { readsFrom: [], writesTo: [], calls: [], joinsTo: [], joinDetails: [], references: [] },
      },
    ]);
    graph.objects.push({
      objectRef: 'HR.ASSIGN_B',
      objectName: 'ASSIGN_B',
      tags: ['assignment_candidate'],
      columns: [{ name: 'DICT_ID' }],
    });
    graph.relations.push({
      fromObject: 'HR.ASSIGN_B',
      fromColumn: 'DICT_ID',
      toObject: 'HR.DICT_B',
      toColumn: 'ID',
      relationType: 'lookup_join',
      family: 'oracle_structural',
      provenance: ['join:exact2', 'confidence:exact_static'],
    });
    const hyps = buildBindingHypotheses({
      graph,
      oracle,
      requestedRoles: ['assignment_source', 'dictionary_identity'],
    });
    const viable = hyps.filter((h) => h.connectedRoleCount >= 2);
    for (const h of viable) h.hypothesisStatus = 'strong_inference_readonly';
    const { ambiguous } = detectAmbiguousHypotheses(viable, 50);
    expect(ambiguous).toBe(true);
  });

  it('dictionary reference uses exposed VIEW field not internal base column', () => {
    const graph: SchemaEvidenceGraph = {
      objects: [
        {
          objectRef: 'HR.V_ASSIGN',
          objectName: 'V_ASSIGN',
          tags: ['assignment_candidate'],
          columns: [{ name: 'PUB_REF' }],
        },
        {
          objectRef: 'HR.DICT_B',
          objectName: 'DICT_B',
          tags: ['dictionary_candidate'],
          columns: [{ name: 'ID' }],
        },
      ],
      relations: [
        {
          fromObject: 'HR.V_ASSIGN',
          fromColumn: 'PUB_REF',
          toObject: 'HR.DICT_B',
          toColumn: 'ID',
          relationType: 'shared_base_join_enriched',
          family: 'oracle_structural',
          provenance: [
            'projection:HR.V_ASSIGN.PUB_REF<-HR.BASE.INTERNAL_REF',
            'confidence:exact_static',
          ],
        },
      ],
      claims: [
        {
          family: 'application_technical',
          claimType: 'ace_reached',
          object: 'HR.V_ASSIGN',
          roleHint: 'assignment_source',
          weight: 2,
          provenance: ['ace'],
        },
      ],
    };
    const hyps = buildBindingHypotheses({
      graph,
      oracle: emptyOracle([
        {
          oracleCanonicalId: 'o:HR:V_ASSIGN',
          owner: 'HR',
          objectName: 'V_ASSIGN',
          objectType: 'VIEW',
          reachedFromApplicationNode: 'gw',
          acePath: ['form|F'],
          aceEdgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
          aceEdgeKinds: ['GATEWAY_READS_FROM_ORACLE_OBJECT'],
          candidateRoleHypotheses: ['assignment_source'],
          supportingEvidence: ['ace:gw'],
          negativeEvidence: [],
          stage2Facts: {
            readsFrom: [],
            writesTo: [],
            calls: [],
            joinsTo: [],
            joinDetails: [],
            references: [],
          },
        },
      ]),
      requestedRoles: ['assignment_source', 'dictionary_reference', 'dictionary_identity'],
    });
    expect(hyps[0]?.roleBindings.dictionary_reference?.column).toBe('PUB_REF');
    expect(hyps[0]?.roleBindings.dictionary_reference?.column).not.toBe('INTERNAL_REF');
  });

  it('filterGraphForHypothesis keeps only connected objects', () => {
    const graph = graphWithConnectedRoles();
    graph.objects.push({ objectRef: 'HR.OTHER', objectName: 'OTHER', tags: [], columns: [] });
    const hyps = buildBindingHypotheses({
      graph,
      oracle: emptyOracle([]),
      requestedRoles: ['assignment_source', 'dictionary_identity'],
    });
    const filtered = filterGraphForHypothesis(graph, hyps[0]!);
    expect(filtered.objects.map((o) => o.objectRef)).not.toContain('HR.OTHER');
  });
});

describe('approved binding isolation', () => {
  it('approved exclusive bind does not merge blind oracle candidates', () => {
    const approvedGraph: SchemaEvidenceGraph = {
      objects: [
        {
          objectRef: 'TETA_ADMIN.NT_KP_KDR_STANOWISKA',
          objectName: 'NT_KP_KDR_STANOWISKA',
          tags: ['assignment_candidate'],
          columns: [],
        },
      ],
      relations: [],
      claims: [
        {
          family: 'application_technical',
          claimType: 'approved_binding_source',
          object: 'TETA_ADMIN.NT_KP_KDR_STANOWISKA',
          weight: 3,
          provenance: ['approved_binding:teta-business-semantic-bindings-v1'],
          roleHint: 'assignment_source',
        },
      ],
    };
    const ace: AceTraversalResult = {
      anchorsExpanded: 0,
      aceNodesVisited: 0,
      aceEdgesAvailable: 0,
      aceEdgesTraversed: 0,
      maxDepthReached: 0,
      truncated: false,
      truncationReason: null,
      nodes: [],
      edges: [],
      oracleEndpoints: [],
      dacPackages: [],
      edgesByKind: {},
      seedNodeIds: [],
    };
    const anchors: ApplicationAnchorResolveResult = {
      anchors: [],
      semanticAnchorsFound: 0,
      lexiconEntryIds: [],
      tokensUsed: [],
    };
    const oracle = emptyOracle([
      {
        oracleCanonicalId: 'x',
        owner: 'TETA_ADMIN',
        objectName: 'NT_KP_TMC_OBJECT_POSITIONS',
        objectType: 'TABLE',
        reachedFromApplicationNode: 'g',
        acePath: [],
        aceEdgeKind: 'GATEWAY_READS_FROM_ORACLE_OBJECT',
        aceEdgeKinds: [],
        candidateRoleHypotheses: ['assignment_source'],
        supportingEvidence: [],
        negativeEvidence: [],
        stage2Facts: { readsFrom: [], writesTo: [], calls: [], joinsTo: [], joinDetails: [], references: [] },
      },
    ]);
    const bound = bindEvidenceToRoleGraph({
      anchors,
      ace,
      oracle,
      approvedReuseGraph: approvedGraph,
      approvedExclusive: true,
    });
    expect(bound.graph.objects.some((o) => o.objectRef.includes('TMC'))).toBe(false);
    expect(bound.graph.objects.some((o) => o.objectRef.includes('KDR_STANOWISKA'))).toBe(true);
  });
});
