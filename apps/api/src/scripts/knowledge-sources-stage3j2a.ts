import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { buildStage3j2aAudit } from '../teta-knowledge-sources/teta-knowledge-source-audit';
import { inventoryKnowledgeSourcesStage3j2a } from '../teta-knowledge-sources/teta-knowledge-source-inventory.service';
import { loadKnowledgeSourceRegistries } from '../teta-knowledge-sources/teta-knowledge-source-registry.loader';
import { explainPairForJson } from '../teta-knowledge-sources/teta-training-pair-discovery.service';
import type { FrameHashMode } from '../teta-knowledge-sources/teta-knowledge-source.types';

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

function resolveRepoRoot(): string {
  return path.resolve(__dirname, '../../../..');
}

function main(): void {
  const cmd = process.argv[2] ?? 'audit';
  const root = resolveRepoRoot();

  if (cmd === 'registry') {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(loadKnowledgeSourceRegistries(), null, 2));
    return;
  }

  if (cmd === 'inventory') {
    const scanRoot = getArg('--root');
    if (!scanRoot) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            note: 'No --root provided; running synthetic fixture inventory only.',
            inventory: inventoryKnowledgeSourcesStage3j2a({
              frameHashMode: (getArg('--frame-hash-mode') as FrameHashMode) ?? 'content',
              seriesFilter: getArg('--series') ?? undefined,
              sourceFilter: getArg('--source') ?? undefined,
              maxFiles: getArg('--max-files') ? Number(getArg('--max-files')) : undefined,
            }),
          },
          null,
          2,
        ),
      );
      return;
    }
    const inventory = inventoryKnowledgeSourcesStage3j2a({
      root: scanRoot,
      frameHashMode: (getArg('--frame-hash-mode') as FrameHashMode) ?? 'metadata',
      seriesFilter: getArg('--series') ?? undefined,
      sourceFilter: getArg('--source') ?? undefined,
      maxFiles: getArg('--max-files') ? Number(getArg('--max-files')) : undefined,
    });
    const out = getArg('--output');
    if (out) {
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ sources: inventory.sources.length, fingerprint: inventory.fingerprintSha256, out: out ?? null }, null, 2));
    return;
  }

  if (cmd === 'explain-pair') {
    const jsonPath = getArg('--json');
    if (!jsonPath) throw new Error('explain-pair requires --json');
    const dir = path.dirname(path.resolve(jsonPath));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(explainPairForJson(dir, path.basename(jsonPath)), null, 2));
    return;
  }

  if (cmd === 'validate') {
    const input = getArg('--input');
    if (!input) throw new Error('validate requires --input');
    const data = JSON.parse(require('fs').readFileSync(input, 'utf8'));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: Array.isArray(data.sources), sourceCount: data.sources?.length ?? 0 }, null, 2));
    return;
  }

  const strict = process.argv.includes('--strict');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(buildStage3j2aAudit(strict, root), null, 2));
}

main();
