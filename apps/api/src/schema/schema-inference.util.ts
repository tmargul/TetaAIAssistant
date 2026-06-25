export type GraphNodeRef = {
  id: number;
  owner: string;
  name: string;
  nodeType: 'table' | 'view';
};

export type InferredEdge = {
  fromNodeId: number;
  toNodeId: number;
  fromColumn: string;
  toColumn: string;
  edgeType: 'inferred';
  confidence: number;
  source: string;
};

export function inferSchemaEdges(
  nodes: GraphNodeRef[],
  pkByNode: Map<number, Set<string>>,
  existingKeys: Set<string>,
): InferredEdge[] {
  const edges: InferredEdge[] = [];
  const nodeByUpperName = new Map<string, GraphNodeRef[]>();

  for (const node of nodes) {
    const key = node.name.toUpperCase();
    const list = nodeByUpperName.get(key) ?? [];
    list.push(node);
    nodeByUpperName.set(key, list);
  }

  const edgeKey = (from: number, to: number, fromCol: string, toCol: string) =>
    `${from}\0${to}\0${fromCol.toUpperCase()}\0${toCol.toUpperCase()}`;

  const tryAdd = (edge: InferredEdge) => {
    const key = edgeKey(edge.fromNodeId, edge.toNodeId, edge.fromColumn, edge.toColumn);
    if (existingKeys.has(key)) return;
    existingKeys.add(key);
    edges.push(edge);
  };

  for (const node of nodes) {
    if (node.nodeType !== 'table') continue;
    const upperName = node.name.toUpperCase();

    if (/^L_/.test(upperName)) {
      const stem = upperName.slice(2);
      for (const candidateName of [`T_${stem}`, `T_PRAC`, `T_PRACOWNICY`]) {
        const targets = nodeByUpperName.get(candidateName) ?? [];
        for (const target of targets) {
          if (target.id === node.id) continue;
          const targetPks = pkByNode.get(target.id);
          if (!targetPks?.size) continue;
          for (const pk of targetPks) {
            tryAdd({
              fromNodeId: node.id,
              toNodeId: target.id,
              fromColumn: pk,
              toColumn: pk,
              edgeType: 'inferred',
              confidence: 0.7,
              source: 'naming_L_table',
            });
          }
        }
      }
    }

    if (/^SL_/.test(upperName)) {
      const linkName = `L_${upperName.slice(3)}`;
      const linkTargets = nodeByUpperName.get(linkName) ?? [];
      for (const link of linkTargets) {
        tryAdd({
          fromNodeId: node.id,
          toNodeId: link.id,
          fromColumn: 'BADANIE_ID',
          toColumn: 'BADANIE_ID',
          edgeType: 'inferred',
          confidence: 0.65,
          source: 'naming_SL_table',
        });
      }
    }
  }

  for (const node of nodes) {
    const pks = pkByNode.get(node.id);
    if (!pks) continue;
    for (const pk of pks) {
      const match = /^(.+)_ID$/i.exec(pk);
      if (!match) continue;
      const stem = match[1].toUpperCase();
      for (const candidateName of [`T_${stem}`, `T_${stem}OWNICY`, `T_${stem}OWNIK`]) {
        const targets = nodeByUpperName.get(candidateName) ?? [];
        for (const target of targets) {
          if (target.id === node.id) continue;
          const targetPks = pkByNode.get(target.id);
          if (!targetPks?.has(pk)) continue;
          tryAdd({
            fromNodeId: node.id,
            toNodeId: target.id,
            fromColumn: pk,
            toColumn: pk,
            edgeType: 'inferred',
            confidence: 0.75,
            source: 'column_id_pattern',
          });
        }
      }
    }
  }

  return edges;
}
