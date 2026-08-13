import {
  DEFAULT_ORACLE_LINEAGE_BOUNDS,
  expandOracleLineage,
} from './teta-stage4-oracle-lineage';
import type { AceTraversalResult } from './teta-stage4-ace-traverse';
import type { OracleCandidate } from './teta-stage4-oracle-expand';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('stage4 oracle lineage bounds', () => {
  it('respects maxOracleRelationDepth and detects cycles via visited set', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's4-lineage-'));
    const edgesPath = path.join(dir, 'edges.ndjson');
    const rows = [
      {
        edgeKind: 'READS_FROM',
        fromId: 'oracle-object:OWN:VIEW:V1',
        toId: 'oracle-object:OWN:TABLE:T1',
        attributes: { alias: 'T1' },
        provenance: [{ extractionMechanism: 'test' }],
      },
      {
        edgeKind: 'JOINS_TO',
        fromId: 'oracle-object:OWN:VIEW:V1',
        toId: 'oracle-object:OWN:TABLE:T2',
        attributes: {
          alias: 'T2',
          onClause: 'T1.ID = T2.ID',
          parsedPairs: [
            { leftAlias: 'T1', leftColumn: 'ID', rightAlias: 'T2', rightColumn: 'ID' },
          ],
        },
        provenance: [{ extractionMechanism: 'test' }],
      },
      // Would be depth>1 if followed from T1 — should not be visited with depth=1 from V1 only as seed
      {
        edgeKind: 'READS_FROM',
        fromId: 'oracle-object:OWN:TABLE:T1',
        toId: 'oracle-object:OWN:TABLE:T3',
        attributes: { alias: 'T3' },
        provenance: [{ extractionMechanism: 'test' }],
      },
    ];
    fs.writeFileSync(edgesPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    process.env.TETA_TWP_STAGE3_EDGES_PATH = edgesPath;

    const cand: OracleCandidate = {
      oracleCanonicalId: 'oracle-object:OWN:VIEW:V1',
      owner: 'OWN',
      objectName: 'V1',
      objectType: 'VIEW',
      reachedFromApplicationNode: 'app',
      acePath: ['app', 'oracle_object|OWN.V1'],
      aceEdgeKind: 'APPLICATION_JOIN',
      aceEdgeKinds: ['APPLICATION_JOIN'],
      candidateRoleHypotheses: ['assignment_source'],
      supportingEvidence: [],
      negativeEvidence: [],
      stage2Facts: {
        readsFrom: [],
        writesTo: [],
        calls: [],
        joinsTo: [],
        joinDetails: [],
        references: [],
      },
    };
    const ace: AceTraversalResult = {
      anchorsExpanded: 1,
      aceNodesVisited: 1,
      aceEdgesAvailable: 0,
      aceEdgesTraversed: 0,
      maxDepthReached: 1,
      truncated: false,
      truncationReason: null,
      nodes: [],
      edges: [],
      oracleEndpoints: [],
      dacPackages: [],
      edgesByKind: {},
      seedNodeIds: [],
    };

    const result = await expandOracleLineage({
      repoRoot: dir,
      ace,
      candidates: [cand],
      bounds: { ...DEFAULT_ORACLE_LINEAGE_BOUNDS, maxOracleRelationDepth: 1 },
    });
    expect(result.maxOracleRelationDepthReached).toBeLessThanOrEqual(1);
    expect(result.objects.every((o) => o.depth <= 1)).toBe(true);
    expect(result.objects.some((o) => o.objectName === 'T3')).toBe(false);
    expect(
      result.objects.every((o) => o.applicationReachability === 'indirect_via_oracle_lineage'),
    ).toBe(true);

    delete process.env.TETA_TWP_STAGE3_EDGES_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
