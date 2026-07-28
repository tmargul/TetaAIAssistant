import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { TrainingSourceSeriesEntry } from './teta-knowledge-source.types';

export type LoadedKnowledgeSourceRegistries = {
  platformRegistryVersion: string;
  productFamilyRegistryVersion: string;
  productSurfaceRegistryVersion: string;
  businessAreaRegistryVersion: string;
  knowledgeAreaRegistryVersion: string;
  sourceSeriesRegistryVersion: string;
  platforms: Array<{ platformId: string; canonicalLabel: string; aliases: string[]; status: string; provenance: unknown }>;
  productFamilies: Array<{
    productFamilyId: string;
    canonicalLabel: string;
    aliases: string[];
    platformId: string;
    status: string;
    provenance: unknown;
  }>;
  productSurfaces: Array<{
    productSurfaceId: string;
    canonicalLabel: string;
    aliases: string[];
    productFamilyIds: string[];
    platformId: string;
    surfaceKind: string;
    databaseRelationship: string;
    status: string;
    provenance: unknown;
  }>;
  businessAreas: Array<{ businessAreaId: string; canonicalLabel: string; aliases: string[]; status: string; provenance: unknown }>;
  knowledgeAreas: Array<{ knowledgeAreaId: string; canonicalLabel: string; aliases: string[]; status: string; provenance: unknown }>;
  series: TrainingSourceSeriesEntry[];
};

function configDir(explicit?: string): string {
  return explicit ?? path.resolve(__dirname, '../../config/teta-knowledge-sources');
}

function readJson<T>(filePath: string): T {
  if (!existsSync(filePath)) throw new Error(`Missing registry file: ${filePath}`);
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

let cache: LoadedKnowledgeSourceRegistries | null = null;

export function loadKnowledgeSourceRegistries(configDirectory?: string): LoadedKnowledgeSourceRegistries {
  if (cache && !configDirectory) return cache;
  const dir = configDir(configDirectory);
  const platform = readJson<{ registryVersion: string; platforms: LoadedKnowledgeSourceRegistries['platforms'] }>(
    path.join(dir, 'teta-product-platform-registry-v1.json'),
  );
  const families = readJson<{
    registryVersion: string;
    productFamilies: LoadedKnowledgeSourceRegistries['productFamilies'];
  }>(path.join(dir, 'teta-product-family-registry-v1.json'));
  const surfaces = readJson<{
    registryVersion: string;
    productSurfaces: LoadedKnowledgeSourceRegistries['productSurfaces'];
  }>(path.join(dir, 'teta-product-surface-registry-v1.json'));
  const areas = readJson<{
    registryVersion: string;
    businessAreas: LoadedKnowledgeSourceRegistries['businessAreas'];
  }>(path.join(dir, 'teta-business-area-registry-v1.json'));
  const knowledge = readJson<{
    registryVersion: string;
    knowledgeAreas: LoadedKnowledgeSourceRegistries['knowledgeAreas'];
  }>(path.join(dir, 'teta-knowledge-area-registry-v1.json'));
  const series = readJson<{ registryVersion: string; series: TrainingSourceSeriesEntry[] }>(
    path.join(dir, 'teta-training-source-series-v1.json'),
  );

  const loaded: LoadedKnowledgeSourceRegistries = {
    platformRegistryVersion: platform.registryVersion,
    productFamilyRegistryVersion: families.registryVersion,
    productSurfaceRegistryVersion: surfaces.registryVersion,
    businessAreaRegistryVersion: areas.registryVersion,
    knowledgeAreaRegistryVersion: knowledge.registryVersion,
    sourceSeriesRegistryVersion: series.registryVersion,
    platforms: platform.platforms,
    productFamilies: families.productFamilies,
    productSurfaces: surfaces.productSurfaces,
    businessAreas: areas.businessAreas,
    knowledgeAreas: knowledge.knowledgeAreas,
    series: series.series,
  };
  if (!configDirectory) cache = loaded;
  return loaded;
}

export function resetKnowledgeSourceRegistryCache(): void {
  cache = null;
}

export function validateKnowledgeSourceRegistries(regs: LoadedKnowledgeSourceRegistries): {
  duplicateRegistryIds: string[];
  unknownRegistryReferences: string[];
  missingProvenance: string[];
} {
  const duplicateRegistryIds: string[] = [];
  const unknownRegistryReferences: string[] = [];
  const missingProvenance: string[] = [];

  const track = (ids: string[], kind: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      const key = `${kind}:${id}`;
      if (seen.has(key)) duplicateRegistryIds.push(key);
      seen.add(key);
    }
  };

  track(
    regs.platforms.map((p) => p.platformId),
    'platform',
  );
  track(
    regs.productFamilies.map((p) => p.productFamilyId),
    'productFamily',
  );
  track(
    regs.productSurfaces.map((p) => p.productSurfaceId),
    'productSurface',
  );
  track(
    regs.businessAreas.map((p) => p.businessAreaId),
    'businessArea',
  );
  track(
    regs.knowledgeAreas.map((p) => p.knowledgeAreaId),
    'knowledgeArea',
  );
  track(
    regs.series.map((p) => p.seriesId),
    'series',
  );

  const platformIds = new Set(regs.platforms.map((p) => p.platformId));
  const familyIds = new Set(regs.productFamilies.map((p) => p.productFamilyId));
  const surfaceIds = new Set(regs.productSurfaces.map((p) => p.productSurfaceId));
  const areaIds = new Set(regs.businessAreas.map((p) => p.businessAreaId));
  const knowledgeIds = new Set(regs.knowledgeAreas.map((p) => p.knowledgeAreaId));

  for (const f of regs.productFamilies) {
    if (!platformIds.has(f.platformId)) unknownRegistryReferences.push(`family.platform:${f.productFamilyId}:${f.platformId}`);
    if (!(f as { provenance?: unknown }).provenance) missingProvenance.push(`family:${f.productFamilyId}`);
  }
  for (const s of regs.productSurfaces) {
    if (!platformIds.has(s.platformId)) unknownRegistryReferences.push(`surface.platform:${s.productSurfaceId}:${s.platformId}`);
    for (const fid of s.productFamilyIds) {
      if (!familyIds.has(fid)) unknownRegistryReferences.push(`surface.family:${s.productSurfaceId}:${fid}`);
    }
  }
  for (const s of regs.series) {
    if (!s.provenance) missingProvenance.push(`series:${s.seriesId}`);
    if (s.platformId && !platformIds.has(s.platformId)) {
      unknownRegistryReferences.push(`series.platform:${s.seriesId}:${s.platformId}`);
    }
    for (const fid of s.productFamilyIds) {
      if (!familyIds.has(fid)) unknownRegistryReferences.push(`series.family:${s.seriesId}:${fid}`);
    }
    for (const sid of s.productSurfaceIds) {
      if (!surfaceIds.has(sid)) unknownRegistryReferences.push(`series.surface:${s.seriesId}:${sid}`);
    }
    for (const aid of s.businessAreaIds) {
      if (!areaIds.has(aid)) unknownRegistryReferences.push(`series.businessArea:${s.seriesId}:${aid}`);
    }
    for (const kid of s.knowledgeAreaIds) {
      if (!knowledgeIds.has(kid)) unknownRegistryReferences.push(`series.knowledgeArea:${s.seriesId}:${kid}`);
    }
  }

  return { duplicateRegistryIds, unknownRegistryReferences, missingProvenance };
}
