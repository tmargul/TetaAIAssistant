import type { SchemaColumnMeta } from '../schema/schema-column-matcher.util';
import {
  findSchemaColumnByLabel,
  matchPluginColumnToSchema,
} from '../schema/schema-column-matcher.util';
import type { TetaPluginFormMetadata, TetaPluginGatewayMeta, TetaPluginMetadataBundle } from './teta-plugin-metadata.types';
import {
  buildGridOracleColumnLinks,
  collectBundleUiColumns,
  findEarliestMentionIndex,
  normalizeSearchText,
  phraseMatchesNormalizedQuery,
  queryMentionsLink,
  type GridOracleColumnLink,
} from './teta-plugin-grid-column-mapper';
import { buildLabeledSelectSql } from './teta-plugin-labeled-select.util';

export type TetaPluginColumnMapping = {
  oracleColumnName: string;
  label: string;
  gridColumnName: string | null;
  synonyms: string[];
  pluginColumnName: string;
  resolvedColumnName?: string | null;
  targetObject?: string | null;
  dllName: string;
  formName?: string;
  gatewayClassName?: string;
};

export type ColumnMappingSchemaLookup = (
  tableRef: string,
  pluginColumnName: string,
  label: string,
) => string | null;

function formDisplayName(form: TetaPluginFormMetadata, dllName: string): string {
  return form.Plugin.Languages?.[0]?.Name ?? form.Plugin.ClassName ?? dllName;
}

function gatewayTargetObject(gateway: TetaPluginGatewayMeta): string | null {
  return (
    gateway.ViewName?.trim().toUpperCase() ??
    gateway.BaseTableName?.trim().toUpperCase() ??
    null
  );
}

export function buildColumnMappingsFromBundle(
  bundle: TetaPluginMetadataBundle,
  schemaLookup?: ColumnMappingSchemaLookup,
  getSchemaColumns?: (tableRef: string) => SchemaColumnMeta[],
): TetaPluginColumnMapping[] {
  const mappings: TetaPluginColumnMapping[] = [];
  const allColumns = collectBundleUiColumns(bundle);
  const primaryForm = bundle.forms[0];

  for (const form of bundle.forms) {
    const formName = formDisplayName(form, bundle.dllName);
    for (const gateway of form.Gateways ?? []) {
      const targetObject = gatewayTargetObject(gateway);
      const schemaColumns = targetObject && getSchemaColumns ? getSchemaColumns(targetObject) : [];
      const links = buildGridOracleColumnLinks(gateway, primaryForm ?? form, {
        allColumns,
        schemaColumns,
      });

      for (const link of links) {
        const resolvedColumnName =
          targetObject && schemaLookup
            ? schemaLookup(targetObject, link.oracleColumnName, link.label)
            : null;

        mappings.push({
          oracleColumnName: link.oracleColumnName,
          label: link.label,
          gridColumnName: link.gridColumnName,
          synonyms: link.synonyms,
          pluginColumnName: link.oracleColumnName,
          resolvedColumnName,
          targetObject,
          dllName: bundle.dllName,
          formName,
          gatewayClassName: gateway.ClassName,
        });
      }
    }
  }

  return mappings;
}

export function enrichGatewaysWithLabeledSelect(
  bundle: TetaPluginMetadataBundle,
  getSchemaColumns?: (tableRef: string) => SchemaColumnMeta[],
): number {
  const allColumns = collectBundleUiColumns(bundle);
  const primaryForm = bundle.forms[0];
  if (!primaryForm) {
    return 0;
  }

  let updated = 0;
  for (const form of bundle.forms) {
    for (const gateway of form.Gateways ?? []) {
      const targetObject = gatewayTargetObject(gateway);
      const schemaColumns = targetObject && getSchemaColumns ? getSchemaColumns(targetObject) : [];
      const links = buildGridOracleColumnLinks(gateway, primaryForm, {
        allColumns,
        schemaColumns,
      });
      const labeledSelect = buildLabeledSelectSql(gateway, links, { maxColumns: null });
      if (!labeledSelect) {
        continue;
      }

      gateway.Sql ??= {
        SqlStatus: 'metadata_only',
        Direct: {},
        BuilderText: {},
        BuilderSumo: {},
      };
      gateway.Sql.LabeledSelect = labeledSelect;
      updated += 1;
    }
  }

  return updated;
}

export function splitQueryIntentSections(query: string): {
  outputPart: string;
  filterPart: string;
} {
  const match = query.match(/\b(?:o|z|ze|wg|wedlug|według|where)\b/i);
  if (match?.index != null && match.index > 0) {
    return {
      outputPart: query.slice(0, match.index),
      filterPart: query.slice(match.index),
    };
  }
  return { outputPart: query, filterPart: query };
}

function linkMentionedInSection(section: string, link: GridOracleColumnLink): boolean {
  return queryMentionsLink(section, link);
}

function filterMatchScore(filterPart: string, link: GridOracleColumnLink): number {
  const normalizedFilter = normalizeSearchText(filterPart);
  let score = 0;

  for (const phrase of [link.label, ...link.synonyms].map((part) => normalizeSearchText(part))) {
    if (phrase.length < 3) {
      continue;
    }
    if (normalizedFilter.includes(phrase)) {
      score += phrase.length * 3;
      continue;
    }
    for (const token of phrase.split(/\s+/).filter((part) => part.length >= 3)) {
      if (phraseMatchesNormalizedQuery(token, normalizedFilter)) {
        score += token.length * 2;
      }
    }
  }

  return score;
}

function isWeakGenericFilterMatch(filterPart: string, link: GridOracleColumnLink, score: number): boolean {
  const normalizedFilter = normalizeSearchText(filterPart);
  const oracleUpper = link.oracleColumnName.toUpperCase();
  const hasEwid = /ewidencyjn|ewidenc/i.test(normalizedFilter);
  const isPkLike = oracleUpper === 'ID' || oracleUpper.endsWith('_ID');

  if (isPkLike && hasEwid && score < 12) {
    return true;
  }

  const labelNorm = normalizeSearchText(link.label);
  if (hasEwid && labelNorm === 'nr' && score < 10) {
    return true;
  }

  return false;
}

export function resolveFilterMappingFromQuery(
  query: string,
  mappings: TetaPluginColumnMapping[],
  filterValue: string | null,
): TetaPluginColumnMapping | null {
  if (!filterValue?.trim()) {
    return null;
  }

  const normalizedValue = filterValue.trim();
  const { filterPart } = splitQueryIntentSections(query);
  let best: { mapping: TetaPluginColumnMapping; distance: number; score: number } | null = null;

  for (const mapping of mappings) {
    const link: GridOracleColumnLink = {
      oracleColumnName: mapping.oracleColumnName,
      label: mapping.label,
      gridColumnName: mapping.gridColumnName,
      synonyms: mapping.synonyms,
    };
    const score = filterMatchScore(filterPart, link);
    if (score < 4 || !linkMentionedInSection(filterPart, link)) {
      continue;
    }
    if (isWeakGenericFilterMatch(filterPart, link, score)) {
      continue;
    }

    const mentionIndex = findEarliestMentionIndex(filterPart, link);
    const valueIndex = normalizeSearchText(filterPart).indexOf(normalizeSearchText(normalizedValue));
    if (mentionIndex < 0 || valueIndex < 0 || valueIndex < mentionIndex) {
      continue;
    }

    const distance = valueIndex - mentionIndex;
    if (!best || score > best.score || (score === best.score && distance < best.distance)) {
      best = { mapping, distance, score };
    }
  }

  return best?.mapping ?? null;
}

function isEntityWordOnlyMatch(section: string, link: GridOracleColumnLink): boolean {
  const normalized = normalizeSearchText(section);
  if (!/\bpracownik/.test(normalized)) {
    return false;
  }
  const oracleUpper = link.oracleColumnName.toUpperCase();
  if (!oracleUpper.includes('PRAC') || oracleUpper.includes('NAZWISKO') || oracleUpper.includes('IMIE')) {
    return false;
  }
  const phrases = [link.label, ...link.synonyms].map((part) => normalizeSearchText(part));
  return phrases.every(
    (phrase) =>
      phrase.length < 4 ||
      (/\bprac/.test(phrase) && !/\bnazwisko\b|\bimie\b|\bewidenc|\bnr\b|\bpesel\b/.test(phrase)),
  );
}

export function resolveOutputMappingsFromQuery(
  query: string,
  mappings: TetaPluginColumnMapping[],
  filterMapping: TetaPluginColumnMapping | null,
): TetaPluginColumnMapping[] {
  const filterKey = filterMapping
    ? `${filterMapping.targetObject ?? ''}:${filterMapping.oracleColumnName}`
    : null;
  const { outputPart } = splitQueryIntentSections(query);
  const outputScope =
    mappings.some((mapping) => {
      const link: GridOracleColumnLink = {
        oracleColumnName: mapping.oracleColumnName,
        label: mapping.label,
        gridColumnName: mapping.gridColumnName,
        synonyms: mapping.synonyms,
      };
      return linkMentionedInSection(outputPart, link);
    })
      ? outputPart
      : query;

  return mappings.filter((mapping) => {
    const key = `${mapping.targetObject ?? ''}:${mapping.oracleColumnName}`;
    if (filterKey && key === filterKey) {
      return false;
    }

    const link: GridOracleColumnLink = {
      oracleColumnName: mapping.oracleColumnName,
      label: mapping.label,
      gridColumnName: mapping.gridColumnName,
      synonyms: mapping.synonyms,
    };
    if (isEntityWordOnlyMatch(outputScope, link)) {
      return false;
    }
    return linkMentionedInSection(outputScope, link);
  });
}

export function createSchemaLookupFromColumns(
  getColumns: (tableRef: string) => SchemaColumnMeta[],
): ColumnMappingSchemaLookup {
  return (tableRef, pluginColumnName, label) =>
    matchPluginColumnToSchema(pluginColumnName, getColumns(tableRef), label) ??
    findSchemaColumnByLabel(label, getColumns(tableRef));
}
