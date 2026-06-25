import { randomUUID } from 'crypto';
import type { TetaKnowledgeChunkInput } from '@teta/shared';
import { TETA_KNOWLEDGE_CHUNK_FORMAT } from '@teta/shared';
import type {
  OracleMetadataCatalogSnapshot,
  OracleMetadataBuildResult,
  OracleNamedObjectMeta,
  OracleTableMeta,
} from './oracle-metadata.types';

function fullName(owner: string, name: string): string {
  return `${owner}.${name}`;
}

function sourcePath(databaseLabel: string, owner: string, name: string): string {
  return `oracle-metadata/${databaseLabel}/${owner}.${name}`;
}

/** Kolumny na jeden chunk — duże tabele są dzielone, żeby nie przekroczyć kontekstu embeddera. */
const MAX_COLUMNS_PER_TABLE_CHUNK = 25;

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function formatColumns(columns: OracleTableMeta['columns']): string {
  if (columns.length === 0) {
    return 'Brak metadanych kolumn w katalogu Oracle.';
  }
  return columns
    .map((column) => `${column.name} ${column.dataType}${column.nullable === false ? ' NOT NULL' : ''}`)
    .join(', ');
}

function buildTableChunks(
  table: OracleTableMeta,
  catalog: OracleMetadataCatalogSnapshot,
): TetaKnowledgeChunkInput[] {
  const qualified = fullName(table.owner, table.name);
  const columnBatches = chunkArray(table.columns, MAX_COLUMNS_PER_TABLE_CHUNK);

  return columnBatches.map((columns, batchIndex) => {
    const partLabel =
      columnBatches.length > 1
        ? ` (kolumny ${batchIndex * MAX_COLUMNS_PER_TABLE_CHUNK + 1}–${batchIndex * MAX_COLUMNS_PER_TABLE_CHUNK + columns.length} z ${table.columns.length})`
        : '';
    const text = [
      `Tabela Oracle ${qualified}${partLabel}.`,
      `Kolumny: ${formatColumns(columns)}.`,
      'Obiekt katalogowy bazy Teta — metadane struktury (bez danych operacyjnych).',
    ].join(' ');

    return {
      id: randomUUID(),
      source: sourcePath(catalog.databaseLabel, table.owner, table.name),
      source_type: 'other' as const,
      text,
      summary: `Tabela ${qualified} (${table.columns.length} kolumn)`,
      tables: [qualified],
      module: catalog.pilotModule ?? undefined,
      teta_version: catalog.tetaVersion ?? undefined,
      knowledge_version: TETA_KNOWLEDGE_CHUNK_FORMAT,
    };
  });
}

function buildViewChunk(
  view: OracleNamedObjectMeta,
  catalog: OracleMetadataCatalogSnapshot,
): TetaKnowledgeChunkInput {
  const qualified = fullName(view.owner, view.name);
  const text = [
    `Widok Oracle ${qualified}.`,
    'Obiekt katalogowy bazy Teta — metadane struktury (bez danych operacyjnych).',
  ].join(' ');

  return {
    id: randomUUID(),
    source: sourcePath(catalog.databaseLabel, view.owner, view.name),
    source_type: 'other',
    text,
    summary: `Widok ${qualified}`,
    tables: [qualified],
    module: catalog.pilotModule ?? undefined,
    teta_version: catalog.tetaVersion ?? undefined,
    knowledge_version: TETA_KNOWLEDGE_CHUNK_FORMAT,
  };
}

function buildPlsqlChunk(
  item: OracleNamedObjectMeta,
  kind: 'package' | 'procedure' | 'function',
  catalog: OracleMetadataCatalogSnapshot,
): TetaKnowledgeChunkInput {
  const qualified = fullName(item.owner, item.name);
  const kindLabel = kind === 'package' ? 'Pakiet PL/SQL' : kind === 'procedure' ? 'Procedura' : 'Funkcja';
  const text = [
    `${kindLabel} Oracle ${qualified}.`,
    item.status ? `Status: ${item.status}.` : '',
    'Obiekt katalogowy bazy Teta — metadane struktury (bez danych operacyjnych).',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    id: randomUUID(),
    source: sourcePath(catalog.databaseLabel, item.owner, item.name),
    source_type: 'oracle_package',
    text,
    summary: `${kindLabel} ${qualified}`,
    packages: kind === 'package' ? [qualified] : undefined,
    module: catalog.pilotModule ?? undefined,
    teta_version: catalog.tetaVersion ?? undefined,
    knowledge_version: TETA_KNOWLEDGE_CHUNK_FORMAT,
  };
}

export function buildOracleMetadataChunks(
  catalog: OracleMetadataCatalogSnapshot,
): OracleMetadataBuildResult {
  const chunks: TetaKnowledgeChunkInput[] = [
    ...catalog.tables.flatMap((table) => buildTableChunks(table, catalog)),
    ...catalog.views.map((view) => buildViewChunk(view, catalog)),
    ...catalog.packages.map((item) => buildPlsqlChunk(item, 'package', catalog)),
    ...catalog.procedures.map((item) => buildPlsqlChunk(item, 'procedure', catalog)),
    ...catalog.functions.map((item) => buildPlsqlChunk(item, 'function', catalog)),
  ];

  return { chunks, catalog };
}

export function writeOracleMetadataJsonl(chunks: TetaKnowledgeChunkInput[]): string {
  return chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + (chunks.length > 0 ? '\n' : '');
}
