/**
 * Thin filesystem fixture runner — loads a synthetic fixture bundle
 * (write-edges.json / call-edges.json / dac-edges.json / sources/*.sql)
 * from disk and runs analyzeWritePath against it. Used by tests/CLI that
 * prefer file-based fixtures over inline objects; no Oracle required.
 */
import fs from 'fs';
import path from 'path';
import { analyzeWritePath, type AnalyzeWritePathInput } from './teta-stage3-analyze';
import type { Stage3CallEdgeRaw, Stage3DacEdge, Stage3WriteEdge } from './teta-stage3-load';
import type { Stage3WritePathAnalysisResult } from './teta-stage3.types';

export type Stage3FixtureBundle = {
  writeEdges?: Stage3WriteEdge[];
  callEdges?: Stage3CallEdgeRaw[];
  dacEdges?: Stage3DacEdge[];
  sources?: Record<string, string>;
};

function readJsonIfExists<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

export function loadStage3FixtureBundle(fixtureDir: string): Stage3FixtureBundle {
  const bundle: Stage3FixtureBundle = {
    writeEdges: readJsonIfExists(path.join(fixtureDir, 'write-edges.json')),
    callEdges: readJsonIfExists(path.join(fixtureDir, 'call-edges.json')),
    dacEdges: readJsonIfExists(path.join(fixtureDir, 'dac-edges.json')),
  };
  const sourcesDir = path.join(fixtureDir, 'sources');
  if (fs.existsSync(sourcesDir)) {
    const sources: Record<string, string> = {};
    for (const file of fs.readdirSync(sourcesDir)) {
      if (!file.endsWith('.sql')) continue;
      sources[file.replace(/\.sql$/, '')] = fs.readFileSync(path.join(sourcesDir, file), 'utf8');
    }
    bundle.sources = sources;
  }
  return bundle;
}

export async function analyzeWritePathFromFixtureDir(
  fixtureDir: string,
  input: Omit<AnalyzeWritePathInput, 'fixtures' | 'sourceProvider'>,
): Promise<Stage3WritePathAnalysisResult> {
  const bundle = loadStage3FixtureBundle(fixtureDir);
  const sources = bundle.sources ? new Map(Object.entries(bundle.sources)) : undefined;
  return analyzeWritePath({
    ...input,
    sourceProvider: sources ? 'fixture' : 'none',
    fixtures: {
      writeEdges: bundle.writeEdges,
      callEdges: bundle.callEdges,
      dacEdges: bundle.dacEdges,
      sources,
    },
  });
}
