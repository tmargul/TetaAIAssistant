/**
 * Stage 2E.1 — load existing Stage 2E NDJSON into memory.
 */
import { createReadStream, existsSync } from 'fs';
import { createInterface } from 'readline';
import type { Stage2eConflict, Stage2eEdge, Stage2eGraph, Stage2eNode } from './teta-stage2e.types';
import { STAGE2E_IDENTITY_VERSION } from './teta-stage2e.types';

export async function loadStage2eGraphFromNdjson(ndjsonPath: string): Promise<Stage2eGraph> {
  if (!existsSync(ndjsonPath)) {
    throw new Error(`Brak Stage 2E NDJSON: ${ndjsonPath}`);
  }
  const nodes: Stage2eNode[] = [];
  const edges: Stage2eEdge[] = [];
  const conflicts: Stage2eConflict[] = [];
  let metadata: Stage2eGraph['metadata'] = {
    generatedAt: new Date().toISOString(),
    identityVersion: STAGE2E_IDENTITY_VERSION,
    stages: ['1', '2A', '2B', '2C', '2D', '2E'],
    oracleEnabled: false,
  };
  let summary: Record<string, number | string | boolean | null> = {};
  let audit: Record<string, unknown> = {};

  const rl = createInterface({ input: createReadStream(ndjsonPath, { encoding: 'utf8' }) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const kind = row.kind as string;
    if (kind === 'audit') {
      metadata = (row.metadata as Stage2eGraph['metadata']) ?? metadata;
      summary = (row.summary as Record<string, number | string | boolean | null>) ?? summary;
      audit = (row.audit as Record<string, unknown>) ?? audit;
      continue;
    }
    if (kind === 'conflict') {
      const { kind: _k, ...rest } = row;
      conflicts.push(rest as Stage2eConflict);
      continue;
    }
    if (kind === 'node') {
      const { kind: _k, ...rest } = row;
      nodes.push(rest as Stage2eNode);
      continue;
    }
    if (kind === 'edge') {
      const { kind: _k, ...rest } = row;
      edges.push(rest as Stage2eEdge);
      continue;
    }
  }

  return {
    metadata,
    summary,
    nodes,
    edges,
    conflicts,
    referenceChains: {},
    formEvidenceChains: [],
    audit,
  };
}
