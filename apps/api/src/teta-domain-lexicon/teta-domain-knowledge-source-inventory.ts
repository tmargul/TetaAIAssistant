import { createHash } from 'crypto';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import type { KnowledgeSourceManifest, KnowledgeSourceRecord } from './teta-domain-lexicon.types';

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.rtf', '.txt', '.html', '.json', '.jsonl', '.mp4']);

function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function sourceTypeFromExt(ext: string): KnowledgeSourceRecord['sourceType'] {
  const e = ext.toLowerCase();
  if (e === '.pdf') return 'pdf';
  if (e === '.docx') return 'docx';
  if (e === '.rtf') return 'rtf';
  if (e === '.txt') return 'txt';
  if (e === '.html') return 'html';
  if (e === '.json') return 'json';
  if (e === '.jsonl') return 'jsonl';
  if (e === '.mp4') return 'mp4';
  return 'other';
}

function walkFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

export function inventoryKnowledgeSources(input: {
  scanRoot: string;
  domainId?: string;
  scope?: KnowledgeSourceRecord['scope'];
  productVersion?: string | null;
}): KnowledgeSourceManifest {
  if (!input.scanRoot?.trim()) {
    throw new Error('inventory-knowledge requires an explicit scan path');
  }
  const root = path.resolve(input.scanRoot);
  const stat = statSync(root);
  const files = stat.isDirectory() ? walkFiles(root) : [root];
  const scannedAt = new Date().toISOString();
  const sources: KnowledgeSourceRecord[] = [];

  for (const file of files.sort()) {
    const ext = path.extname(file);
    if (!SUPPORTED_EXTENSIONS.has(ext.toLowerCase())) continue;
    const originalFileName = path.basename(file);
    sources.push({
      sourceId: createHash('sha256').update(file).digest('hex').slice(0, 16),
      domainId: input.domainId ?? 'core',
      sourceType: sourceTypeFromExt(ext),
      scope: input.scope ?? 'global',
      productVersion: input.productVersion ?? null,
      originalFileName,
      fileSha256: sha256File(file),
      status: 'inventoried',
      provenance: {
        type: 'knowledge_source_inventory',
        sourceId: 'stage3j1-inventory-cli',
        scannedAt,
      },
    });
  }

  return {
    manifestVersion: 'teta-domain-knowledge-sources-v1',
    sources,
    provenance: { type: 'knowledge_source_inventory', sourceId: 'stage3j1-inventory-cli' },
  };
}

export function validateKnowledgeSourceManifest(manifest: KnowledgeSourceManifest): {
  duplicateSourceIds: string[];
  duplicateSha256: string[];
  missingFileNames: string[];
} {
  const duplicateSourceIds: string[] = [];
  const duplicateSha256: string[] = [];
  const missingFileNames: string[] = [];
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const s of manifest.sources) {
    if (ids.has(s.sourceId)) duplicateSourceIds.push(s.sourceId);
    ids.add(s.sourceId);
    if (hashes.has(s.fileSha256)) duplicateSha256.push(s.fileSha256);
    hashes.add(s.fileSha256);
    if (!s.originalFileName?.trim()) missingFileNames.push(s.sourceId);
  }
  return { duplicateSourceIds, duplicateSha256, missingFileNames };
}
