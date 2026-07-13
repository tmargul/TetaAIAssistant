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
  linkMatchesSqlOutputIntent,
  normalizeSearchText,
  phraseMatchesNormalizedQuery,
  queryMentionsLink,
  type GridOracleColumnLink,
} from './teta-plugin-grid-column-mapper';
import { resolveFilterMappingFromQuery as resolveFilterMapping } from './teta-plugin-filter-mapping.util';
import { loadQueryLanguageConfig } from './teta-query-language.loader';

const MAX_SQL_OUTPUT_COLUMNS = 8;
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

  for (const form of bundle.forms) {
    const formName = formDisplayName(form, bundle.dllName);
    for (const gateway of form.Gateways ?? []) {
      const targetObject = gatewayTargetObject(gateway);
      const schemaColumns = targetObject && getSchemaColumns ? getSchemaColumns(targetObject) : [];
      const links = buildGridOracleColumnLinks(gateway, form, {
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
  if (bundle.forms.length === 0) {
    return 0;
  }

  const allColumns = collectBundleUiColumns(bundle);
  let updated = 0;
  for (const form of bundle.forms) {
    for (const gateway of form.Gateways ?? []) {
      const targetObject = gatewayTargetObject(gateway);
      const schemaColumns = targetObject && getSchemaColumns ? getSchemaColumns(targetObject) : [];
      const links = buildGridOracleColumnLinks(gateway, form, {
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

function buildFilterPrepositionPattern(): RegExp {
  const prepositions = loadQueryLanguageConfig()
    .filterPrepositions.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`\\b(?:${prepositions})\\b`, 'i');
}

export function hasDistinctFilterClause(query: string): boolean {
  const match = query.match(buildFilterPrepositionPattern());
  return match?.index != null && match.index > 0;
}

export function splitQueryIntentSections(query: string): {
  outputPart: string;
  filterPart: string;
} {
  const match = query.match(buildFilterPrepositionPattern());
  if (match?.index != null && match.index > 0) {
    return {
      outputPart: query.slice(0, match.index),
      filterPart: query.slice(match.index),
    };
  }
  return { outputPart: query, filterPart: query };
}

function linkStrictlyMentionedInSection(section: string, link: GridOracleColumnLink): boolean {
  return linkMatchesSqlOutputIntent(section, link);
}

function outputMentionScore(section: string, link: GridOracleColumnLink): number {
  const normalizedSection = normalizeSearchText(section);
  const labelNorm = normalizeSearchText(link.label);
  let score = 0;

  if (labelNorm.length >= 3) {
    if (normalizedSection.includes(labelNorm)) {
      score += labelNorm.length * 4;
    } else {
      for (const token of labelNorm.split(/\s+/).filter((part) => part.length >= 3)) {
        if (phraseMatchesNormalizedQuery(token, normalizedSection)) {
          score += token.length * 2;
        }
      }
    }
  }

  const oracleUpper = link.oracleColumnName.toUpperCase();
  if (oracleUpper === 'IMIE' || oracleUpper === 'NAZWISKO') {
    score += 20;
  }

  return score;
}

export function resolveFilterMappingFromQuery(
  query: string,
  mappings: TetaPluginColumnMapping[],
  filterValue: string | null,
): TetaPluginColumnMapping | null {
  return resolveFilterMapping(query, mappings, filterValue, splitQueryIntentSections);
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
      return linkStrictlyMentionedInSection(outputPart, link);
    })
      ? outputPart
      : query;

  const scored = mappings
    .map((mapping) => {
      const key = `${mapping.targetObject ?? ''}:${mapping.oracleColumnName}`;
      if (filterKey && key === filterKey) {
        return null;
      }

      const link: GridOracleColumnLink = {
        oracleColumnName: mapping.oracleColumnName,
        label: mapping.label,
        gridColumnName: mapping.gridColumnName,
        synonyms: mapping.synonyms,
      };
      if (isEntityWordOnlyMatch(outputScope, link)) {
        return null;
      }
      if (!linkStrictlyMentionedInSection(outputScope, link)) {
        return null;
      }

      return {
        mapping,
        mentionIndex: findEarliestMentionIndex(outputScope, link),
        score: outputMentionScore(outputScope, link),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null)
    .sort((left, right) => {
      const leftIndex = left.mentionIndex < 0 ? Number.MAX_SAFE_INTEGER : left.mentionIndex;
      const rightIndex = right.mentionIndex < 0 ? Number.MAX_SAFE_INTEGER : right.mentionIndex;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      return right.score - left.score;
    });

  return scored.slice(0, MAX_SQL_OUTPUT_COLUMNS).map((item) => item.mapping);
}

export function resolveColumnMappingsForSql(
  query: string,
  mappings: TetaPluginColumnMapping[],
  filterValue: string | null,
): TetaPluginColumnMapping[] {
  const filterMapping = resolveFilterMappingFromQuery(query, mappings, filterValue);
  const outputMappings = resolveOutputMappingsFromQuery(query, mappings, filterMapping);
  const byKey = new Map<string, TetaPluginColumnMapping>();

  const add = (mapping: TetaPluginColumnMapping | null | undefined) => {
    if (!mapping) {
      return;
    }
    const key = `${mapping.targetObject ?? 'ANY'}:${mapping.oracleColumnName.toUpperCase()}`;
    byKey.set(key, mapping);
  };

  add(filterMapping);
  for (const mapping of outputMappings) {
    add(mapping);
  }

  return [...byKey.values()];
}

export function createSchemaLookupFromColumns(
  getColumns: (tableRef: string) => SchemaColumnMeta[],
): ColumnMappingSchemaLookup {
  return (tableRef, pluginColumnName, label) =>
    matchPluginColumnToSchema(pluginColumnName, getColumns(tableRef), label) ??
    findSchemaColumnByLabel(label, getColumns(tableRef));
}

export function resolveMappingsForPrompt(
  mappings: TetaPluginColumnMapping[],
  query: string,
  gatewayClassNames: string[],
  limit = 48,
): TetaPluginColumnMapping[] {
  const gatewaySet = new Set(gatewayClassNames.map((name) => name.toLowerCase()).filter(Boolean));
  const merged = new Map<string, TetaPluginColumnMapping>();

  const add = (mapping: TetaPluginColumnMapping) => {
    const key = `${mapping.targetObject ?? 'ANY'}:${mapping.oracleColumnName.toUpperCase()}:${mapping.gatewayClassName ?? ''}`;
    merged.set(key, mapping);
  };

  for (const mapping of mappings) {
    if (
      mapping.gatewayClassName &&
      gatewaySet.has(mapping.gatewayClassName.toLowerCase())
    ) {
      add(mapping);
    }
  }

  for (const mapping of mappings) {
    const link: GridOracleColumnLink = {
      oracleColumnName: mapping.oracleColumnName,
      label: mapping.label,
      gridColumnName: mapping.gridColumnName,
      synonyms: mapping.synonyms,
    };
    if (queryMentionsLink(query, link)) {
      add(mapping);
    }
  }

  return [...merged.values()].slice(0, limit);
}
