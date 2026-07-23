/**
 * Load Stage 2B NDJSON as read-only hints for Stage 2D.1 normalization.
 * Does not modify Stage 2B artifacts or logic.
 */
import { createReadStream, existsSync } from 'fs';
import { createInterface } from 'readline';
import type {
  Stage2dStage2bGatewayHint,
  Stage2dStage2bTypeHint,
} from './teta-stage2d.types';

export type Stage2bHintIndex = {
  types: Stage2dStage2bTypeHint[];
  gateways: Stage2dStage2bGatewayHint[];
};

export async function loadStage2bHintsFromNdjson(
  ndjsonPath: string,
): Promise<Stage2bHintIndex> {
  const types: Stage2dStage2bTypeHint[] = [];
  const gateways: Stage2dStage2bGatewayHint[] = [];
  if (!existsSync(ndjsonPath)) {
    return { types, gateways };
  }

  const rl = createInterface({
    input: createReadStream(ndjsonPath, { encoding: 'utf8' }),
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const kind = row.kind as string | undefined;
    if (kind === 'type') {
      types.push({
        fullName: (row.fullName as string) ?? null,
        baseType: (row.baseType as string) ?? null,
        inheritanceChain: (row.inheritanceChain as string[]) ?? null,
        gateways: ((row.gateways as Stage2dStage2bGatewayHint[]) ?? []).map((g) => ({
          gatewayType: g.gatewayType ?? null,
          datasetTable: g.datasetTable ?? null,
          viewName: g.viewName ?? null,
          baseTableName: g.baseTableName ?? null,
          alias: g.alias ?? null,
          declaringType: (row.fullName as string) ?? null,
        })),
        datasetTables: (row.datasetTables as Array<{ name?: string | null }>) ?? null,
      });
    } else if (kind === 'gateway') {
      gateways.push({
        gatewayType: (row.gatewayType as string) ?? null,
        datasetTable: (row.datasetTable as string) ?? null,
        viewName: (row.viewName as string) ?? null,
        baseTableName: (row.baseTableName as string) ?? null,
        alias: (row.alias as string) ?? null,
        declaringType: (row.declaringType as string) ?? null,
      });
    }
  }

  return { types, gateways };
}
