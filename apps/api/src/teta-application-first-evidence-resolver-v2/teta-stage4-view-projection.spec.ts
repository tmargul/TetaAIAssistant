import {
  classifySharedBaseTransfer,
  columnLineageHopsFromRelation,
  exposedViewColumnForBaseColumn,
  findExposedViewColumnsForBaseColumn,
  isExactStaticRelation,
} from './teta-stage4-view-projection';
import type { ViewProjectionFact } from '../teta-oracle-source-index-stage2/teta-stage2-parse';

const kdrProjections: ViewProjectionFact[] = [
  {
    viewOwner: 'TETA_ADMIN',
    viewName: 'NT_KP_KDR_STANOWISKA',
    viewColumn: 'SSTN_ID',
    projectionExpression: 'lstn.kasta_sl_stan_id',
    sourceAlias: 'LSTN',
    sourceObject: 'TETA_ADMIN.L_STANOWISKA',
    sourceColumn: 'KASTA_SL_STAN_ID',
    projectionKind: 'aliased_direct_column',
    ordinal: 3,
    exposedColumnSource: 'oracle_metadata',
    projectionConfidence: 'exact_static',
  },
  {
    viewOwner: 'TETA_ADMIN',
    viewName: 'NT_KP_KDR_STANOWISKA',
    viewColumn: 'PRAC_ID',
    projectionExpression: 'lstn.prac_id',
    sourceAlias: 'LSTN',
    sourceObject: 'TETA_ADMIN.L_STANOWISKA',
    sourceColumn: 'PRAC_ID',
    projectionKind: 'direct_column',
    ordinal: 2,
    exposedColumnSource: 'oracle_metadata',
    projectionConfidence: 'exact_static',
  },
];

describe('teta-stage4-view-projection', () => {
  it('resolves exposed SSTN_ID for base KASTA_SL_STAN_ID', () => {
    expect(
      exposedViewColumnForBaseColumn(
        kdrProjections,
        'TETA_ADMIN.L_STANOWISKA',
        'KASTA_SL_STAN_ID',
      ),
    ).toBe('SSTN_ID');
  });

  it('shared-base without projection proof classifies as shared_base_only', () => {
    const row = classifySharedBaseTransfer({
      targetView: 'TETA_ADMIN.NT_KP_KDR_STANOWISKA',
      baseObjectRef: 'TETA_ADMIN.L_STANOWISKA',
      baseColumn: 'KASTA_SL_STAN_ID',
      joinTargetObject: 'TETA_ADMIN.NT_KP_SLO_STANOWISKA',
      joinTargetColumn: 'ID',
      projections: [],
      provenance: ['sharedBase:TETA_ADMIN.L_STANOWISKA'],
    });
    expect(row.classification).toBe('shared_base_only');
    expect(row.confidence).toBe('strong_static');
    expect(row.targetExposedColumn).toBeNull();
  });

  it('shared-base with projection proof classifies as projection_exact', () => {
    const row = classifySharedBaseTransfer({
      targetView: 'TETA_ADMIN.NT_KP_KDR_STANOWISKA',
      baseObjectRef: 'TETA_ADMIN.L_STANOWISKA',
      baseColumn: 'KASTA_SL_STAN_ID',
      joinTargetObject: 'TETA_ADMIN.NT_KP_SLO_STANOWISKA',
      joinTargetColumn: 'ID',
      projections: kdrProjections,
      provenance: ['projection+sharedBase'],
    });
    expect(row.classification).toBe('projection_exact');
    expect(row.targetExposedColumn).toBe('SSTN_ID');
    expect(row.confidence).toBe('exact_static');
  });

  it('isExactStaticRelation requires confidence:exact_static provenance', () => {
    expect(
      isExactStaticRelation({
        fromObject: 'HR.A',
        fromColumn: 'X',
        toObject: 'HR.B',
        toColumn: 'Y',
        relationType: 'join',
        family: 'oracle_structural',
        provenance: ['confidence:exact_static'],
      }),
    ).toBe(true);
    expect(
      isExactStaticRelation({
        fromObject: 'HR.A',
        fromColumn: 'X',
        toObject: 'HR.B',
        toColumn: 'Y',
        relationType: 'join',
        family: 'oracle_structural',
        provenance: ['confidence:strong_static'],
      }),
    ).toBe(false);
  });

  it('same-name column without lineage is not exposed via findExposedViewColumnsForBaseColumn', () => {
    const projections: ViewProjectionFact[] = [
      {
        viewOwner: 'HR',
        viewName: 'V',
        viewColumn: 'COL_X',
        projectionExpression: 'other.col_y',
        sourceAlias: 'OTHER',
        sourceObject: 'HR.OTHER',
        sourceColumn: 'COL_Y',
        projectionKind: 'direct_column',
        ordinal: 1,
      },
    ];
    expect(findExposedViewColumnsForBaseColumn(projections, 'HR.BASE', 'COL_X')).toHaveLength(0);
  });

  it('shared-base lineage hops preserve VIEW exposed column then base then related', () => {
    const hops = columnLineageHopsFromRelation({
      fromObject: 'HR.V_ASSIGN',
      fromColumn: 'PUBLIC_ID',
      toObject: 'HR.DICT',
      toColumn: 'ID',
      relationType: 'shared_base_join_enriched',
      family: 'oracle_structural',
      provenance: [
        'projection:HR.V_ASSIGN.PUBLIC_ID<-HR.BASE.INTERNAL_ID',
        'sharedBaseJoin:HR.BASE.INTERNAL_ID->HR.DICT.ID',
        'sourceView:HR.V_ASSIGN',
        'sourceHash:abc',
        'confidence:exact_static',
      ],
    });
    expect(hops).toHaveLength(2);
    expect(hops[0]).toMatchObject({
      fromObject: 'HR.V_ASSIGN',
      fromColumn: 'PUBLIC_ID',
      toObject: 'HR.BASE',
      toColumn: 'INTERNAL_ID',
      relationType: 'view_projection',
    });
    expect(hops[1]).toMatchObject({
      fromObject: 'HR.BASE',
      fromColumn: 'INTERNAL_ID',
      toObject: 'HR.DICT',
      toColumn: 'ID',
      relationType: 'shared_base_join',
    });
    expect(hops.some((h) => h.fromColumn === 'INTERNAL_ID' && h.fromObject === 'HR.V_ASSIGN')).toBe(
      false,
    );
  });
});
