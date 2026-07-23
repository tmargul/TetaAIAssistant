import { Stage2eIds } from './teta-stage2e.ids';
import { STAGE2E_IDENTITY_VERSION } from './teta-stage2e.types';
import type { Stage2eGraph, Stage2eNode, Stage2eEdge } from './teta-stage2e.types';
import {
  isDotNetTypeName,
  parseDatasetColumnRef,
  looksLikeOraclePhysicalName,
  classifyInvalidOracleCandidate,
} from './teta-stage2e1.detect';
import { domainForNodeType, isEdgeDomainAllowed } from './teta-stage2e1.domains';
import {
  assertStage2e1StrictSemantic,
  normalizeStage2e1,
} from './teta-stage2e1.normalize';

function node(
  partial: Partial<Stage2eNode> & Pick<Stage2eNode, 'id' | 'type' | 'name'>,
): Stage2eNode {
  return {
    canonicalName: partial.canonicalName ?? partial.name,
    sourceStage: partial.sourceStage ?? ['2E'],
    confidence: partial.confidence ?? 'confirmed',
    evidence: partial.evidence ?? [],
    attributes: partial.attributes ?? {},
    identityVersion: STAGE2E_IDENTITY_VERSION,
    ...partial,
  };
}

function edge(
  partial: Partial<Stage2eEdge> & Pick<Stage2eEdge, 'id' | 'type' | 'from' | 'to'>,
): Stage2eEdge {
  return {
    confidence: 'confirmed',
    sourceStage: ['2E'],
    evidence: [],
    attributes: {},
    identityVersion: STAGE2E_IDENTITY_VERSION,
    ...partial,
  };
}

function miniGraph(nodes: Stage2eNode[], edges: Stage2eEdge[] = []): Stage2eGraph {
  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      identityVersion: STAGE2E_IDENTITY_VERSION,
      stages: ['2E'],
      oracleEnabled: false,
    },
    summary: {},
    nodes,
    edges,
    conflicts: [],
    referenceChains: {},
    audit: {},
  };
}

describe('Stage 2E.1 detectors', () => {
  it('1. .NET full type is detected and not Oracle physical', () => {
    expect(
      isDotNetTypeName('Teta.Sumo.Personel.bosKOS.MTG.KartaOpisuStanowiskaNaglowekMTG'),
    ).toBe(true);
    expect(
      isDotNetTypeName('TETA.SUMO.PERSONEL.BOSSKOS.MTG.KARTAOPISUSTANOWISKANAGLOWEKMTG'),
    ).toBe(true);
    expect(looksLikeOraclePhysicalName('NT_KP_SLO_TYPY_STANOWISK')).toBe(true);
  });

  it('2. TG/MTG/BO/DF suffixes count as .NET', () => {
    expect(isDotNetTypeName('Teta.Sumo.X.TG.PitPayrollLinksTG')).toBe(true);
    expect(classifyInvalidOracleCandidate('Teta.Sumo.X.BO.FooBO')).toBe(
      'invalid_oracle_candidate_dotnet_type',
    );
  });

  it('3–6. Dataset.Column parsing; TypyStanowisk.ID/NAZWA are dataset columns', () => {
    expect(parseDatasetColumnRef('TypyStanowisk.ID')).toEqual({
      datasetTable: 'TypyStanowisk',
      columnName: 'ID',
    });
    expect(parseDatasetColumnRef('TypyStanowisk.NAZWA')).toEqual({
      datasetTable: 'TypyStanowisk',
      columnName: 'NAZWA',
    });
    expect(parseDatasetColumnRef('TypyStanowisk.ID')).not.toBeNull();
    expect(isDotNetTypeName('TypyStanowisk.ID')).toBe(false);
  });
});

describe('Stage 2E.1 normalize', () => {
  it('1–2. .NET misclassified oracle_object becomes dotnet_type with provenance', () => {
    const badId = Stage2eIds.oracleObject(
      'UNKNOWN',
      'VIEW',
      'TETA.SUMO.PERSONEL.BOSSKOS.MTG.KARTAOPISUSTANOWISKANAGLOWEKMTG',
    );
    const g = miniGraph([
      node({
        id: badId,
        type: 'oracle_object',
        name: 'TETA.SUMO.PERSONEL.BOSSKOS.MTG.KARTAOPISUSTANOWISKANAGLOWEKMTG',
        attributes: {
          owner: 'UNKNOWN',
          objectType: 'VIEW',
          objectName: 'TETA.SUMO.PERSONEL.BOSSKOS.MTG.KARTAOPISUSTANOWISKANAGLOWEKMTG',
          oracleValidationStatus: 'missing_in_current_db',
        },
      }),
    ]);
    const { graph, audit } = normalizeStage2e1(g);
    const n = graph.nodes.find((x) => x.id === badId)!;
    expect(n.type).toBe('dotnet_type');
    expect(n.domain).toBe('dotnet');
    expect(n.semanticNormalization?.originalNodeType).toBe('oracle_object');
    expect(n.semanticNormalization?.sourceStage).toBe('2E.1');
    expect(audit.invalidOracleCandidatesDotnet).toBeGreaterThanOrEqual(1);
  });

  it('3–6. TypyStanowisk.ID stub becomes dataset_column, not oracle_object', () => {
    const stub = Stage2eIds.oracleColumn('UNKNOWN', 'TypyStanowisk', 'ID');
    const g = miniGraph([
      node({
        id: stub,
        type: 'oracle_column',
        name: 'ID',
        attributes: {
          owner: 'UNKNOWN',
          objectName: 'TypyStanowisk',
          columnName: 'ID',
          oracleValidationStatus: 'not_checked',
        },
      }),
      node({
        id: Stage2eIds.lookupBinding('Form', 'lcbo', 'TypyStanowisk', 'ID', 'NAZWA'),
        type: 'lookup_binding',
        name: 'TypyStanowisk.ID/NAZWA',
        attributes: {
          datasetTable: 'TypyStanowisk',
          valueMember: 'ID',
          displayMember: 'NAZWA',
        },
      }),
    ]);
    const { graph, audit } = normalizeStage2e1(g);
    expect(graph.nodes.some((n) => n.id === stub)).toBe(false);
    const dc = graph.nodes.find(
      (n) => n.type === 'dataset_column' && n.name === 'TypyStanowisk.ID',
    );
    expect(dc).toBeTruthy();
    expect(dc!.domain).toBe('dataset');
    expect(audit.invalidOracleCandidatesDatasetColumn).toBeGreaterThanOrEqual(1);
    expect(audit.datasetColumnsCreated).toBeGreaterThanOrEqual(1);
  });

  it('4. dataset_column can resolve to oracle_column', () => {
    const ora = Stage2eIds.oracleColumn('TETA_ADMIN', 'NT_KP_SLO_TYPY_STANOWISK', 'ID');
    const lb = Stage2eIds.lookupBinding('F', 'c', 'TypyStanowisk', 'ID', 'NAZWA');
    const ds = Stage2eIds.dataset('asm.dll', 'Teta.X.DF.TypyStanowiskDF', 'TypyStanowisk');
    const main = Stage2eIds.mainSource(
      'Teta.X.DF.TypyStanowiskDF',
      'NT_KP_SLO_TYPY_STANOWISK',
      'ZSTP',
    );
    const g = miniGraph(
      [
        node({
          id: ora,
          type: 'oracle_column',
          name: 'ID',
          attributes: {
            owner: 'TETA_ADMIN',
            objectName: 'NT_KP_SLO_TYPY_STANOWISK',
            columnName: 'ID',
            oracleValidationStatus: 'confirmed',
          },
        }),
        node({
          id: ds,
          type: 'dataset',
          name: 'TypyStanowisk',
          attributes: { datasetTable: 'TypyStanowisk' },
        }),
        node({
          id: main,
          type: 'main_source',
          name: 'NT_KP_SLO_TYPY_STANOWISK',
          attributes: { objectName: 'NT_KP_SLO_TYPY_STANOWISK', alias: 'ZSTP' },
        }),
        node({
          id: lb,
          type: 'lookup_binding',
          name: 'TypyStanowisk',
          attributes: {
            datasetTable: 'TypyStanowisk',
            valueMember: 'ID',
            displayMember: 'NAZWA',
          },
        }),
      ],
      [
        edge({
          id: 'e-reads',
          type: 'READS_FROM',
          from: ds,
          to: main,
        }),
      ],
    );
    const { graph, audit } = normalizeStage2e1(g);
    expect(audit.datasetColumnsResolvedToOracle).toBeGreaterThanOrEqual(1);
    expect(graph.edges.some((e) => e.type === 'RESOLVES_TO_ORACLE_COLUMN')).toBe(true);
  });

  it('8. Oracle identity distinguishes owner/type/name', () => {
    const a = Stage2eIds.oracleObject('TETA_ADMIN', 'VIEW', 'X');
    const b = Stage2eIds.oracleObject('TETA_ADMIN', 'PACKAGE', 'X');
    expect(a).not.toBe(b);
    const g = miniGraph([
      node({
        id: a,
        type: 'oracle_object',
        name: 'X',
        attributes: {
          owner: 'TETA_ADMIN',
          objectType: 'VIEW',
          objectName: 'X',
          oracleValidationStatus: 'confirmed',
        },
      }),
      node({
        id: b,
        type: 'oracle_package',
        name: 'X',
        attributes: {
          owner: 'TETA_ADMIN',
          objectType: 'PACKAGE',
          objectName: 'X',
          oracleValidationStatus: 'confirmed',
        },
      }),
    ]);
    const { graph } = normalizeStage2e1(g);
    const ids = graph.nodes
      .filter((n) => String(n.attributes.objectName ?? '') === 'X')
      .map((n) => `${n.attributes.owner}.${n.attributes.objectType}.${n.attributes.objectName}`);
    expect(new Set(ids).size).toBe(2);
    expect(Stage2eIds.oracleObject('TETA_ADMIN', 'VIEW', 'X')).not.toBe(
      Stage2eIds.oracleObject('TETA_ADMIN', 'PACKAGE', 'X'),
    );
  });

  it('9. Synonym gets RESOLVES_SYNONYM_TO', () => {
    const syn = Stage2eIds.oracleObject('PUBLIC', 'SYNONYM', 'FOO');
    const g = miniGraph([
      node({
        id: syn,
        type: 'oracle_object',
        name: 'FOO',
        attributes: {
          owner: 'PUBLIC',
          objectType: 'SYNONYM',
          objectName: 'FOO',
          targetOwner: 'TETA_ADMIN',
          targetName: 'FOO',
          targetType: 'TABLE',
          oracleValidationStatus: 'synonym_resolved',
        },
      }),
    ]);
    const { graph, audit } = normalizeStage2e1(g);
    expect(audit.synonymsResolved).toBe(1);
    expect(graph.edges.some((e) => e.type === 'RESOLVES_SYNONYM_TO')).toBe(true);
  });

  it('10. expected orphan does not fail strict-semantic alone', () => {
    const g = miniGraph([
      node({
        id: Stage2eIds.oracleObject('TETA_ADMIN', 'VIEW', 'NT_ONLY_META'),
        type: 'oracle_object',
        name: 'NT_ONLY_META',
        attributes: {
          owner: 'TETA_ADMIN',
          objectType: 'VIEW',
          objectName: 'NT_ONLY_META',
          oracleValidationStatus: 'confirmed',
        },
      }),
    ]);
    // seed fake refs ok to avoid ref failures in assert — we only check orphan classification
    const { graph, audit } = normalizeStage2e1(g);
    expect(audit.expectedOrphans).toBeGreaterThanOrEqual(1);
    expect(audit.unexpectedOrphans).toBe(0);
    // force refs ok for this unit check
    graph.referenceChains = {
      A_TypStanowiska: { ok: true },
      B_DicRodzajeKoncesji: { ok: true },
      C_SkladnikiNarastajacoBO: { ok: true },
      D_ListyZamkniete: { ok: true },
      E_MissingHelp: { ok: true },
      F_MissingInDb: { ok: true },
    };
    audit.referenceChainsInvalidDomain = 0;
    const errs = assertStage2e1StrictSemantic(graph, audit).filter((e) =>
      e.includes('unexpectedOrphans'),
    );
    expect(errs).toEqual([]);
  });

  it('11. invalid-domain remaining oracle .NET would be counted', () => {
    // After normalize, .NET should be retyped — audit invalidDomainOrphans stays 0
    const badId = Stage2eIds.oracleObject('UNKNOWN', 'VIEW', 'Teta.Sumo.X.TG.FooTG');
    const { audit } = normalizeStage2e1(
      miniGraph([
        node({
          id: badId,
          type: 'oracle_object',
          name: 'Teta.Sumo.X.TG.FooTG',
          attributes: {
            owner: 'UNKNOWN',
            objectType: 'VIEW',
            objectName: 'Teta.Sumo.X.TG.FooTG',
            oracleValidationStatus: 'missing_in_current_db',
          },
        }),
      ]),
    );
    expect(audit.invalidOracleCandidatesDotnet).toBeGreaterThanOrEqual(1);
    expect(audit.invalidDomainOrphans).toBe(0);
  });

  it('12. unresolved conflict counted in unresolvedConflicts', () => {
    const g = miniGraph([
      node({ id: 'join:1', type: 'join', name: 'J', attributes: {} }),
    ]);
    g.conflicts = [
      {
        conflictType: 'join_definition_conflict',
        subjectId: 'join:1',
        alternatives: [{ a: 1 }, { a: 2 }],
        evidence: [],
        resolutionStatus: 'unresolved',
      },
    ];
    const { audit } = normalizeStage2e1(g);
    expect(audit.unresolvedConflicts).toBe(1);
    expect(audit.conflictsTotal).toBe(1);
  });

  it('13. domain edge violation is detected', () => {
    const help = Stage2eIds.helpField('g', 'F', 's', 0, 'x');
    const ora = Stage2eIds.oracleColumn('O', 'T', 'C');
    const g = miniGraph(
      [
        node({ id: help, type: 'help_field', name: 'x', attributes: {} }),
        node({
          id: ora,
          type: 'oracle_column',
          name: 'C',
          attributes: {
            owner: 'O',
            objectName: 'T',
            columnName: 'C',
            oracleValidationStatus: 'confirmed',
          },
        }),
      ],
      [edge({ id: 'e1', type: 'MAPS_TO_ORACLE_COLUMN', from: help, to: ora })],
    );
    // MAPS_TO_ORACLE_COLUMN from help is not in matrix as help->oracle
    expect(isEdgeDomainAllowed('MAPS_TO_ORACLE_COLUMN', 'help', 'oracle')).toBe(false);
    const { audit } = normalizeStage2e1(g);
    expect(audit.domainEdgeViolations).toBeGreaterThanOrEqual(1);
  });

  it('14. provenance preserved after type change', () => {
    const badId = Stage2eIds.oracleObject('UNKNOWN', 'VIEW', 'Teta.Sumo.X.BO.BarBO');
    const g = miniGraph([
      node({
        id: badId,
        type: 'oracle_object',
        name: 'Teta.Sumo.X.BO.BarBO',
        provenance: [
          {
            sourceStage: '2B',
            sourceArtifact: 'docs/AIA_BOS_ORACLE_MAPPING_STAGE2B.json',
            evidence: [{ kind: 'il', assignment: 'gateway' }],
          },
        ],
        attributes: {
          owner: 'UNKNOWN',
          objectType: 'VIEW',
          objectName: 'Teta.Sumo.X.BO.BarBO',
          oracleValidationStatus: 'missing_in_current_db',
        },
      }),
    ]);
    const { graph } = normalizeStage2e1(g);
    const n = graph.nodes.find((x) => x.id === badId)!;
    expect(n.provenance?.[0].sourceStage).toBe('2B');
    expect(n.semanticNormalization?.originalNodeType).toBe('oracle_object');
  });

  it('domain assignment basics', () => {
    expect(domainForNodeType('oracle_object')).toBe('oracle');
    expect(domainForNodeType('dataset_column')).toBe('dataset');
    expect(domainForNodeType('help_field')).toBe('help');
    expect(domainForNodeType('ui_control')).toBe('application');
  });
});
