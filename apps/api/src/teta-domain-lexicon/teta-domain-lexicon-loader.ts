import { readFileSync } from 'fs';
import path from 'path';
import { sha256, stableStringify } from './teta-domain-lexicon-contract';
import type {
  DomainLanguagePack,
  DomainLexiconEntry,
  DomainLexiconManifest,
  DomainLexiconOperationRule,
  TetaDomainRegistry,
  TetaPolishDomainLexiconCatalog,
} from './teta-domain-lexicon.types';

let cache: {
  catalog: TetaPolishDomainLexiconCatalog;
  lexiconSha256: string;
  manifest: DomainLexiconManifest;
  registry: TetaDomainRegistry;
} | null = null;

function lexiconConfigDir(configDir?: string): string {
  const base = configDir ?? path.resolve(__dirname, '../../config');
  return path.join(base, 'teta-domain-lexicon');
}

function normalizeEntry(entry: DomainLexiconEntry): DomainLexiconEntry {
  const domainId = entry.domainId ?? entry.domain;
  return { ...entry, domain: domainId, domainId };
}

function mergePacks(
  manifest: DomainLexiconManifest,
  packs: DomainLanguagePack[],
): { entries: DomainLexiconEntry[]; operationRules: DomainLexiconOperationRule[] } {
  const entries: DomainLexiconEntry[] = [];
  const operationRules: DomainLexiconOperationRule[] = [];
  for (const pack of packs) {
    if (manifest.domainPacks.find((p) => p.domainPackId === pack.domainPackId)?.status !== 'approved') {
      continue;
    }
    entries.push(...pack.entries.filter((e) => e.status === 'approved').map(normalizeEntry));
    operationRules.push(...pack.operationRules.filter((r) => r.status === 'approved'));
  }
  return { entries, operationRules };
}

export function loadDomainLexiconManifest(configDir?: string): DomainLexiconManifest {
  const dir = lexiconConfigDir(configDir);
  const file = path.join(dir, 'teta-domain-lexicon-manifest-v1.json');
  return JSON.parse(readFileSync(file, 'utf8')) as DomainLexiconManifest;
}

export function loadDomainRegistry(configDir?: string): TetaDomainRegistry {
  const manifest = loadDomainLexiconManifest(configDir);
  const dir = lexiconConfigDir(configDir);
  const file = path.join(dir, manifest.registryFile);
  return JSON.parse(readFileSync(file, 'utf8')) as TetaDomainRegistry;
}

export function loadDomainLanguagePack(packFile: string, configDir?: string): DomainLanguagePack {
  const dir = lexiconConfigDir(configDir);
  const pack = JSON.parse(readFileSync(path.join(dir, packFile), 'utf8')) as DomainLanguagePack;
  return {
    ...pack,
    entries: pack.entries.map(normalizeEntry),
  };
}

export function loadDomainLexicon(configDir?: string): {
  catalog: TetaPolishDomainLexiconCatalog;
  lexiconSha256: string;
  manifest: DomainLexiconManifest;
  registry: TetaDomainRegistry;
} {
  if (cache) return cache;
  const manifest = loadDomainLexiconManifest(configDir);
  const registry = loadDomainRegistry(configDir);
  const approvedPackRefs = manifest.domainPacks.filter((p) => p.status === 'approved');
  const packs = approvedPackRefs.map((p) => loadDomainLanguagePack(p.file, configDir));
  const merged = mergePacks(manifest, packs);
  const catalog: TetaPolishDomainLexiconCatalog = {
    lexiconVersion: manifest.lexiconVersion,
    normalizationProfile: manifest.normalizationProfile,
    entries: merged.entries,
    operationRules: merged.operationRules,
    manifest,
    registry,
  };
  cache = {
    catalog,
    lexiconSha256: sha256(stableStringify(catalog)),
    manifest,
    registry,
  };
  return cache;
}

export function resetDomainLexiconCache(): void {
  cache = null;
}

export function isKnownDomainId(domainId: string, configDir?: string): boolean {
  const registry = loadDomainRegistry(configDir);
  return registry.domains.some((d) => d.domainId === domainId && d.status === 'approved');
}
