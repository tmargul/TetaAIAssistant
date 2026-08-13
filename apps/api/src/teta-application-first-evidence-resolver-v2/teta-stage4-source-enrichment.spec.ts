import {
  extractTemporalPredicatesFromSql,
  resolveAliasMap,
} from './teta-stage4-source-enrichment';
import { buildBindingHypotheses } from './teta-stage4-hypotheses';
import { extractViewLineage } from '../teta-oracle-source-index-stage2/teta-stage2-parse';
import type { SchemaEvidenceGraph } from '../teta-schema-role-resolution/teta-schema-role-resolution.types';
import type { OracleExpandResult } from './teta-stage4-oracle-expand';

describe('stage4 source enrichment — VIEW alias / JOIN / temporal', () => {
  const viewSql = `
CREATE OR REPLACE VIEW TETA_ADMIN.V_ASSIGN AS
SELECT A.SUBJ_ID, A.DICT_ID, B.LABEL, A.VALID_FROM, A.VALID_TO
FROM TETA_ADMIN.OBJ_A A
JOIN TETA_ADMIN.OBJ_B B ON A.DICT_ID = B.DICT_ID
WHERE A.VALID_FROM <= SYSDATE
  AND (A.VALID_TO >= SYSDATE OR A.VALID_TO IS NULL)
`;

  it('resolves unqualified and qualified object aliases', () => {
    const lineage = extractViewLineage(viewSql);
    const { resolved } = resolveAliasMap({
      viewOwner: 'TETA_ADMIN',
      viewObjectName: 'V_ASSIGN',
      hops: [],
      lineageReads: lineage.reads,
      lineageJoins: lineage.joins,
    });
    expect(resolved.get('A')).toBe('TETA_ADMIN.OBJ_A');
    expect(resolved.get('B')).toBe('TETA_ADMIN.OBJ_B');
    expect(resolved.get('OBJ_A')).toBe('TETA_ADMIN.OBJ_A');
    expect(resolved.get('OBJ_B')).toBe('TETA_ADMIN.OBJ_B');
  });

  it('extracts exact VIEW JOIN column pairs', () => {
    const lineage = extractViewLineage(viewSql);
    expect(lineage.joins).toHaveLength(1);
    expect(lineage.joins[0]!.parsedPairs).toEqual([
      { leftAlias: 'A', leftColumn: 'DICT_ID', rightAlias: 'B', rightColumn: 'DICT_ID' },
    ]);
    expect(lineage.joins[0]!.conditionStatus).toBe('resolved');
  });

  it('extracts SYSDATE and open-ended temporal predicates without name inference', () => {
    const preds = extractTemporalPredicatesFromSql(viewSql);
    expect(preds.some((p) => /SYSDATE/i.test(p.rightExpression) && p.leftExpression.includes('VALID_FROM'))).toBe(
      true,
    );
    expect(preds.some((p) => p.operator === 'IS' && p.rightExpression === 'NULL')).toBe(true);
  });

  it('does not invent temporal from column names alone', () => {
    const preds = extractTemporalPredicatesFromSql(
      `SELECT * FROM X WHERE SOME_DATE IS NULL AND OTHER_COL = 1`,
    );
    expect(preds).toHaveLength(0);
  });

  it('feeds exact relation into BindingHypothesis connectivity', () => {
    const graph: SchemaEvidenceGraph = {
      objects: [
        {
          objectRef: 'TETA_ADMIN.V_ASSIGN',
          owner: 'TETA_ADMIN',
          objectType: 'VIEW',
          objectName: 'V_ASSIGN',
          columns: [{ name: 'DICT_ID', isFk: true, references: 'TETA_ADMIN.OBJ_B' }],
          tags: ['assignment_candidate'],
        },
        {
          objectRef: 'TETA_ADMIN.OBJ_B',
          owner: 'TETA_ADMIN',
          objectType: 'TABLE',
          objectName: 'OBJ_B',
          columns: [{ name: 'DICT_ID', isPk: true }, { name: 'LABEL' }],
          tags: ['dictionary_candidate'],
        },
      ],
      relations: [
        {
          fromObject: 'TETA_ADMIN.V_ASSIGN',
          fromColumn: 'DICT_ID',
          toObject: 'TETA_ADMIN.OBJ_B',
          toColumn: 'DICT_ID',
          relationType: 'view_projected_join_enriched',
          family: 'oracle_structural',
          provenance: ['candidateScopedSourceEnrichment', 'confidence:exact_static'],
        },
      ],
      claims: [
        {
          family: 'application_technical',
          claimType: 'ace_reached_oracle_endpoint',
          object: 'TETA_ADMIN.V_ASSIGN',
          roleHint: 'assignment_source',
          weight: 3,
          provenance: ['ace:APPLICATION_JOIN'],
        },
        {
          family: 'oracle_structural',
          claimType: 'dictionary_identity_via_join',
          object: 'TETA_ADMIN.OBJ_B',
          column: 'DICT_ID',
          roleHint: 'dictionary_identity',
          weight: 3,
          provenance: ['candidateScopedSourceEnrichment'],
        },
      ],
    };
    const oracle: OracleExpandResult = {
      oracleEndpointsReached: 1,
      oracleCandidatesConsidered: 1,
      stage2EvidenceItemsLoaded: 0,
      discoveryOrigin: 'application_first',
      stage2EvidenceTypesConsumed: [],
      candidates: [
        {
          oracleCanonicalId: 'oracle-object:TETA_ADMIN:VIEW:V_ASSIGN',
          owner: 'TETA_ADMIN',
          objectName: 'V_ASSIGN',
          objectType: 'VIEW',
          reachedFromApplicationNode: 'dataset|D',
          acePath: ['dataset|D', 'oracle_object|TETA_ADMIN.V_ASSIGN'],
          aceEdgeKind: 'APPLICATION_JOIN',
          aceEdgeKinds: ['APPLICATION_JOIN'],
          candidateRoleHypotheses: ['assignment_source'],
          supportingEvidence: ['ace:APPLICATION_JOIN'],
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
      ],
    };
    const hyps = buildBindingHypotheses({
      graph,
      oracle,
      requestedRoles: [
        'assignment_source',
        'dictionary_reference',
        'dictionary_identity',
        'dictionary_display_name',
      ],
    });
    expect(hyps.length).toBeGreaterThan(0);
    const h = hyps[0]!;
    expect(h.dictionaryRef).toBe('TETA_ADMIN.OBJ_B');
    expect(h.connectedRoleCount).toBeGreaterThanOrEqual(2);
    expect(h.crossPathRoleMerges).toBe(0);
  });

  it('unresolved JOIN does not connect hypothesis', () => {
    const graph: SchemaEvidenceGraph = {
      objects: [
        {
          objectRef: 'TETA_ADMIN.V_ASSIGN',
          owner: 'TETA_ADMIN',
          objectType: 'VIEW',
          objectName: 'V_ASSIGN',
          columns: [],
          tags: ['assignment_candidate'],
        },
      ],
      relations: [
        {
          fromObject: 'TETA_ADMIN.V_ASSIGN',
          fromColumn: 'UNKNOWN',
          toObject: 'TETA_ADMIN.OBJ_B',
          toColumn: 'UNKNOWN',
          relationType: 'view_lineage_reads_from',
          family: 'oracle_structural',
          provenance: ['grain_not_implied'],
        },
      ],
      claims: [
        {
          family: 'application_technical',
          claimType: 'ace_reached',
          object: 'TETA_ADMIN.V_ASSIGN',
          roleHint: 'assignment_source',
          weight: 2,
          provenance: ['ace'],
        },
      ],
    };
    const oracle: OracleExpandResult = {
      oracleEndpointsReached: 1,
      oracleCandidatesConsidered: 1,
      stage2EvidenceItemsLoaded: 0,
      discoveryOrigin: 'application_first',
      stage2EvidenceTypesConsumed: [],
      candidates: [
        {
          oracleCanonicalId: 'oracle-object:TETA_ADMIN:VIEW:V_ASSIGN',
          owner: 'TETA_ADMIN',
          objectName: 'V_ASSIGN',
          objectType: 'VIEW',
          reachedFromApplicationNode: 'g',
          acePath: ['g'],
          aceEdgeKind: 'APPLICATION_JOIN',
          aceEdgeKinds: ['APPLICATION_JOIN'],
          candidateRoleHypotheses: ['assignment_source'],
          supportingEvidence: ['ace'],
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
      ],
    };
    const hyps = buildBindingHypotheses({
      graph,
      oracle,
      requestedRoles: ['assignment_source', 'dictionary_identity', 'dictionary_reference'],
    });
    expect(hyps[0]!.dictionaryRef).toBeNull();
    expect(hyps[0]!.connectedRoleCount).toBeLessThan(2);
  });

  it('parses Oracle comma-FROM and WHERE equijoins', () => {
    const sql = `
CREATE OR REPLACE VIEW OWN.V1 AS
SELECT lstn.id, lstn.prac_id, kast.mpk_id
FROM l_stanowiska lstn,
     kartoteka_stanowisk kast
WHERE kast.id = lstn.kasta_id
`;
    const lineage = extractViewLineage(sql);
    expect(lineage.reads.map((r) => r.qualified.objectName).sort()).toEqual([
      'KARTOTEKA_STANOWISK',
      'L_STANOWISKA',
    ]);
    expect(
      lineage.joins.some((j) => j.joinType === 'WHERE_EQUIJOIN' && j.parsedPairs.length === 1),
    ).toBe(true);
  });
});
