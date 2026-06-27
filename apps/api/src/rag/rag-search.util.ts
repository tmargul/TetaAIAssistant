import type { KnowledgeSourceType, RagSearchFilter } from '@teta/shared';

type QdrantFilterCondition =
  | { key: string; match: { value: string } }
  | { key: string; match: { any: string[] } };

export function buildQdrantFilter(filter?: RagSearchFilter): { must: QdrantFilterCondition[] } | undefined {
  if (!filter) {
    return undefined;
  }

  const must: QdrantFilterCondition[] = [];

  if (filter.sourceType) {
    must.push({ key: 'source_type', match: { value: filter.sourceType } });
  }
  if (filter.module?.trim()) {
    must.push({ key: 'module', match: { value: filter.module.trim() } });
  }
  if (filter.topic?.trim()) {
    must.push({ key: 'topic', match: { value: filter.topic.trim() } });
  }
  if (filter.pluginName?.trim()) {
    must.push({ key: 'plugin_names', match: { any: [filter.pluginName.trim()] } });
  }

  return must.length > 0 ? { must } : undefined;
}

export function formatTimestampRange(startSec?: number, endSec?: number): string | undefined {
  if (startSec === undefined && endSec === undefined) {
    return undefined;
  }
  const start = startSec !== undefined ? formatTimestamp(startSec) : '?';
  const end = endSec !== undefined ? formatTimestamp(endSec) : '?';
  return `${start}–${end}`;
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function buildRagAssetUrl(framePath: string): string {
  const normalized = framePath.replace(/^assets[/\\]/i, '').replace(/\\/g, '/');
  const segments = normalized.split('/').map((segment) => encodeURIComponent(segment));
  return `/api/rag/assets/${segments.join('/')}`;
}

export function resolvePreviewFrameUrl(frames?: string[]): string | undefined {
  const first = frames?.find((frame) => frame.trim());
  return first ? buildRagAssetUrl(first) : undefined;
}

export const RAG_SOURCE_TYPE_LABELS: Record<KnowledgeSourceType, string> = {
  training_video: 'Szkolenie wideo',
  documentation: 'Dokumentacja',
  faq: 'FAQ',
  oracle_package: 'Pakiet Oracle',
  schema_entity: 'Powiązanie schematu (tag → obiekt)',
  client_document: 'Dokument klienta',
  other: 'Inne',
};
