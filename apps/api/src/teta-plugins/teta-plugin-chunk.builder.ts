import { randomUUID } from 'crypto';
import type { TetaKnowledgeChunkInput } from '@teta/shared';
import { TETA_KNOWLEDGE_CHUNK_FORMAT, TETA_PLUGIN_RAG_SOURCE_PREFIX } from '@teta/shared';
import type {
  TetaPluginFormMetadata,
  TetaPluginGatewayMeta,
  TetaPluginMetadataBundle,
} from './teta-plugin-metadata.types';

const MAX_COLUMNS_PER_CHUNK = 30;
const MAX_SELECT_COLUMNS_IN_RAG = 15;
const MAX_SQL_CHARS_IN_GATEWAY_CHUNK = 1500;

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n... [SQL skrócony]`;
}

function summarizeSelectSql(sql: string): string {
  const trimmed = sql.trim();
  const fromMatch = trimmed.match(/\nFROM\s+/i);
  if (!fromMatch || fromMatch.index === undefined) {
    return truncateText(trimmed, MAX_SQL_CHARS_IN_GATEWAY_CHUNK);
  }

  const selectPart = trimmed.slice(0, fromMatch.index);
  const fromPart = trimmed.slice(fromMatch.index + 1);
  const selectBody = selectPart.replace(/^SELECT\s+/i, '').trim();
  const columns = selectBody.split(',').map((column) => column.trim()).filter(Boolean);
  if (columns.length <= MAX_SELECT_COLUMNS_IN_RAG) {
    return truncateText(trimmed, MAX_SQL_CHARS_IN_GATEWAY_CHUNK);
  }

  const preview = columns.slice(0, MAX_SELECT_COLUMNS_IN_RAG).join(', ');
  const hidden = columns.length - MAX_SELECT_COLUMNS_IN_RAG;
  return truncateText(
    `SELECT ${preview}, ... (+${hidden} kolumn)\n${fromPart}`,
    MAX_SQL_CHARS_IN_GATEWAY_CHUNK,
  );
}

function summarizeSqlCommand(sql: string | null | undefined): string | null {
  const trimmed = sql?.trim();
  if (!trimmed) return null;
  if (/^SELECT\s/i.test(trimmed)) {
    return summarizeSelectSql(trimmed);
  }
  return truncateText(trimmed, MAX_SQL_CHARS_IN_GATEWAY_CHUNK);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function pluginBaseSource(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\.dll$/i, '');
  return `${TETA_PLUGIN_RAG_SOURCE_PREFIX}${normalized}`;
}

function formSegment(form: TetaPluginFormMetadata): string {
  const guid = form.Plugin.Guid?.replace(/[{}]/g, '').trim();
  if (guid) return guid;
  const className = form.Plugin.ClassName?.split('.').pop();
  return className ?? 'form';
}

function collectOracleObjects(gateway: TetaPluginGatewayMeta): string[] {
  const objects = new Set<string>();
  for (const value of [
    gateway.ViewName,
    gateway.BaseTableName,
    gateway.PackageName,
    gateway.RelatedPackages?.dac,
    gateway.RelatedPackages?.agl,
    gateway.RelatedPackages?.lep,
  ]) {
    if (value?.trim()) objects.add(value.trim());
  }
  for (const commandSet of [
    gateway.Sql?.BuilderText,
    gateway.Sql?.BuilderSumo,
    gateway.Sql?.Direct,
  ]) {
    if (!commandSet) continue;
    for (const sql of [commandSet.Insert, commandSet.Update, commandSet.Delete]) {
      if (!sql) continue;
      const match = sql.match(/^([A-Z0-9_$.]+)\.(INSERT_ROW|UPDATE_ROW|DELETE_ROW)/i);
      if (match?.[1]) objects.add(match[1]);
    }
  }
  return [...objects];
}

function formatSqlBlock(gateway: TetaPluginGatewayMeta): string {
  const parts: string[] = [];
  const sql = gateway.Sql;
  if (!sql) return '';

  if (sql.FlatQuery?.trim()) parts.push(`FlatQuery: ${sql.FlatQuery.trim()}`);
  if (sql.LastSqlQuery?.trim()) parts.push(`LastSqlQuery: ${sql.LastSqlQuery.trim()}`);

  const appendCommandSet = (
    label: string,
    commandSet?: { Select?: string | null; Insert?: string | null; Update?: string | null; Delete?: string | null },
  ) => {
    if (!commandSet) return;
    for (const [kind, value] of Object.entries(commandSet)) {
      const summarized = summarizeSqlCommand(value);
      if (summarized) parts.push(`${label}.${kind}: ${summarized}`);
    }
  };

  appendCommandSet('BuilderText', sql.BuilderText);
  appendCommandSet('BuilderSumo', sql.BuilderSumo);
  appendCommandSet('Direct', sql.Direct);

  return parts.join('\n');
}

function buildOverviewChunk(
  bundle: TetaPluginMetadataBundle,
  form: TetaPluginFormMetadata,
  baseSource: string,
): TetaKnowledgeChunkInput {
  const formKey = formSegment(form);
  const pluginName = form.Plugin.Languages?.[0]?.Name ?? form.Plugin.ClassName ?? bundle.dllName;
  const profiles = form.Plugin.Profile ?? '';
  const localization = form.Plugin.BusinessLocalization ?? '';
  const arl = form.Plugin.Languages?.[0]?.Arl ?? '';
  const gatewayCount = form.Gateways?.length ?? 0;
  const columnCount = form.Columns?.length ?? 0;
  const boDllCount = form.BusinessObjectDlls?.length ?? 0;

  const text = [
    `Wtyczka Teta ${bundle.dllName} — formularz ${pluginName}.`,
    form.Plugin.Guid ? `GUID: ${form.Plugin.Guid}.` : '',
    localization ? `Lokalizacja biznesowa: ${localization}.` : '',
    arl ? `Ścieżka nawigacji (ARL): ${arl}.` : '',
    profiles ? `Profile użytkownika: ${profiles}.` : '',
    boDllCount > 0 ? `Powiązane obiekty biznesowe (serwer): ${boDllCount} assembly.` : '',
    `Gatewaye: ${gatewayCount}, kolumny UI: ${columnCount}.`,
    form.Form?.ColumnResourceSource === 'dll' || form.Form?.ColumnResourceSource === 'merged'
      ? 'Etykiety kolumn z zasobów osadzonych w DLL wtyczki.'
      : '',
    `Plik DLL: ${bundle.relativePath}.`,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    id: randomUUID(),
    source: `${baseSource}/forms/${formKey}/overview`,
    source_type: 'teta_plugin',
    text,
    summary: `${pluginName} (${bundle.dllName})`,
    plugin_names: [bundle.dllName.replace(/\.dll$/i, '')],
    keywords: form.Tags ?? [],
    knowledge_version: TETA_KNOWLEDGE_CHUNK_FORMAT,
  };
}

function buildGatewayChunk(
  bundle: TetaPluginMetadataBundle,
  form: TetaPluginFormMetadata,
  gateway: TetaPluginGatewayMeta,
  baseSource: string,
): TetaKnowledgeChunkInput {
  const formKey = formSegment(form);
  const pluginName = form.Plugin.Languages?.[0]?.Name ?? bundle.dllName;
  const sqlBlock = formatSqlBlock(gateway);
  const oracleObjects = collectOracleObjects(gateway);

  const text = [
    `Wtyczka ${bundle.dllName}, formularz ${pluginName} — gateway ${gateway.ClassName} (${gateway.GatewayKind}).`,
    gateway.DatasetTableName ? `Tabela DataSet: ${gateway.DatasetTableName}.` : '',
    gateway.ViewName ? `Widok Oracle: ${gateway.ViewName}.` : '',
    gateway.BaseTableName ? `Tabela bazowa: ${gateway.BaseTableName}.` : '',
    gateway.PackageName ? `Pakiet DAC: ${gateway.PackageName}.` : '',
    gateway.TableAlias ? `Alias: ${gateway.TableAlias}.` : '',
    gateway.Sql?.SqlStatus ? `Status SQL: ${gateway.Sql.SqlStatus}.` : '',
    sqlBlock ? `SQL:\n${sqlBlock}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    id: randomUUID(),
    source: `${baseSource}/forms/${formKey}/gateways/${gateway.ClassName}`,
    source_type: 'teta_plugin',
    text,
    summary: `${gateway.ClassName} → ${gateway.ViewName ?? gateway.PackageName ?? 'gateway'}`,
    plugin_names: [bundle.dllName.replace(/\.dll$/i, '')],
    tables: oracleObjects.filter((name) => !name.endsWith('_DAC')),
    keywords: oracleObjects,
    knowledge_version: TETA_KNOWLEDGE_CHUNK_FORMAT,
  };
}

function buildColumnChunks(
  bundle: TetaPluginMetadataBundle,
  form: TetaPluginFormMetadata,
  baseSource: string,
): TetaKnowledgeChunkInput[] {
  const columns = form.Columns ?? [];
  if (columns.length === 0) return [];

  const formKey = formSegment(form);
  const pluginName = form.Plugin.Languages?.[0]?.Name ?? bundle.dllName;
  const batches = chunkArray(columns, MAX_COLUMNS_PER_CHUNK);

  return batches.map((batch, batchIndex) => {
    const labels = batch
      .map((column) => {
        const label = column.Labels?.PL ?? column.GridColumnName;
        const hint = column.Hints?.PL;
        const technical =
          column.Labels?.PL && column.Labels.PL !== column.GridColumnName
            ? ` [${column.GridColumnName}]`
            : '';
        return hint ? `${label}${technical} (${hint})` : `${label}${technical}`;
      })
      .join('; ');

    const partLabel =
      batches.length > 1
        ? ` (kolumny ${batchIndex * MAX_COLUMNS_PER_CHUNK + 1}–${batchIndex * MAX_COLUMNS_PER_CHUNK + batch.length})`
        : '';

    return {
      id: randomUUID(),
      source: `${baseSource}/forms/${formKey}/columns${batches.length > 1 ? `-${batchIndex + 1}` : ''}`,
      source_type: 'teta_plugin' as const,
      text: `Wtyczka ${bundle.dllName}, formularz ${pluginName}${partLabel} — etykiety pól UI: ${labels}.`,
      summary: `Kolumny UI ${pluginName}${partLabel}`,
      plugin_names: [bundle.dllName.replace(/\.dll$/i, '')],
      keywords: batch.map((column) => column.Labels?.PL ?? column.GridColumnName),
      knowledge_version: TETA_KNOWLEDGE_CHUNK_FORMAT,
    };
  });
}

export function buildTetaPluginKnowledgeChunks(bundle: TetaPluginMetadataBundle): TetaKnowledgeChunkInput[] {
  const baseSource = pluginBaseSource(bundle.relativePath);
  const chunks: TetaKnowledgeChunkInput[] = [];

  for (const form of bundle.forms) {
    chunks.push(buildOverviewChunk(bundle, form, baseSource));
    for (const gateway of form.Gateways ?? []) {
      chunks.push(buildGatewayChunk(bundle, form, gateway, baseSource));
    }
    chunks.push(...buildColumnChunks(bundle, form, baseSource));
  }

  if (chunks.length === 0) {
    chunks.push({
      id: randomUUID(),
      source: `${baseSource}/overview`,
      source_type: 'teta_plugin',
      text: `Wtyczka Teta ${bundle.dllName}. Brak metadanych formularzy — sprawdź źródła .cs/.resx (TETA_PLUGIN_SOURCE_ROOT) i katalog serwera aplikacyjnego.`,
      summary: bundle.dllName,
      plugin_names: [bundle.dllName.replace(/\.dll$/i, '')],
      knowledge_version: TETA_KNOWLEDGE_CHUNK_FORMAT,
    });
  }

  return chunks;
}

export function pluginRagSourcePrefix(relativePath: string): string {
  return `${pluginBaseSource(relativePath)}/`;
}
