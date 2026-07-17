import { TETA_PLUGIN_RAG_SOURCE_PREFIX } from '@teta/shared';
import type {
  TetaPluginFormMetadata,
  TetaPluginGatewayMeta,
  TetaPluginMetadataBundle,
} from './teta-plugin-metadata.types';
import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import type { TetaPluginComputedIntent } from './teta-plugin-computed-intent.types';

export type TetaPluginGatewayHint = {
  dllName: string;
  dllPath: string;
  formName?: string;
  gatewayClassName: string;
  gatewayKind?: string;
  viewName?: string | null;
  baseTableName?: string | null;
  tableAlias?: string | null;
  datasetTableName?: string | null;
  packageName?: string | null;
  relatedPackages?: {
    dac?: string | null;
    agl?: string | null;
    lep?: string | null;
  };
  selectSql?: string | null;
  confidence: number;
  ragScore?: number;
};

export type TetaPluginColumnHint = {
  dllName: string;
  formName?: string;
  label: string;
  columnName: string;
  confidence: number;
  targetObject?: string | null;
  resolvedColumnName?: string | null;
  synonyms?: string[];
};

export type TetaPluginOracleHints = {
  promptSection: string;
  helpPromptSection?: string;
  gateways: TetaPluginGatewayHint[];
  columnHints: TetaPluginColumnHint[];
  columnMappings: TetaPluginColumnMapping[];
  computedIntents: TetaPluginComputedIntent[];
  applicationObjects?: import('./teta-application-object.types').TetaApplicationObject[];
  hasPluginMetadata: boolean;
};

const POLISH_DIACRITICS: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

function normalizeSearchText(value: string): string {
  const lower = value.toLowerCase();
  return lower.replace(/[ąćęłńóśźż]/g, (char) => POLISH_DIACRITICS[char] ?? char);
}

function tokenizeQuery(query: string): string[] {
  return normalizeSearchText(query)
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

export function parseGatewayFromRagSource(source: string): string | null {
  const match = source.match(/\/gateways\/([^/]+)$/i);
  return match?.[1] ?? null;
}

export function parseRelativePathFromRagSource(source: string): string | null {
  if (!source.startsWith(TETA_PLUGIN_RAG_SOURCE_PREFIX)) {
    return null;
  }

  const rest = source.slice(TETA_PLUGIN_RAG_SOURCE_PREFIX.length);
  const cutPatterns = ['/forms/', '/overview', '/columns', '/fields/'];
  let cutAt = -1;
  for (const pattern of cutPatterns) {
    const index = rest.indexOf(pattern);
    if (index >= 0 && (cutAt < 0 || index < cutAt)) {
      cutAt = index;
    }
  }

  if (cutAt < 0) {
    if (rest.endsWith('/overview')) {
      cutAt = rest.lastIndexOf('/overview');
    } else {
      return null;
    }
  }

  return `${rest.slice(0, cutAt)}.dll`;
}

export function extractExecutableSelect(gateway: TetaPluginGatewayMeta): string | null {
  const labeled = gateway.Sql?.LabeledSelect?.trim();
  if (labeled) {
    return labeled;
  }

  const candidates = [
    gateway.Sql?.BuilderText?.Select,
    gateway.Sql?.BuilderSumo?.Select,
    gateway.Sql?.Direct?.Select,
  ];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      continue;
    }
    if (/^SELECT\s/i.test(trimmed) || trimmed.includes('<SqlColumns>')) {
      return trimmed;
    }
  }

  return null;
}

function formDisplayName(form: TetaPluginFormMetadata, dllName: string): string {
  return form.Plugin.Languages?.[0]?.Name ?? form.Plugin.ClassName ?? dllName;
}

function scoreGateway(
  gateway: TetaPluginGatewayMeta,
  form: TetaPluginFormMetadata,
  query: string,
): number {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) {
    return gateway.ViewName ? 1 : 0;
  }

  const haystack = normalizeSearchText(
    [
      gateway.ClassName,
      gateway.ViewName,
      gateway.BaseTableName,
      gateway.DatasetTableName,
      gateway.PackageName,
      formDisplayName(form, ''),
      form.Plugin.ClassName,
      form.Plugin.BusinessLocalization,
      form.Plugin.Languages?.[0]?.Arl,
      ...(form.Tags ?? []),
    ]
      .filter(Boolean)
      .join(' '),
  );

  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 2;
    }
  }

  if (gateway.ViewName && /widok|zestawienie|lista|raport|pokaz|poka/i.test(query)) {
    score += 0.5;
  }

  return score;
}

function buildGatewayHint(
  bundle: TetaPluginMetadataBundle,
  form: TetaPluginFormMetadata,
  gateway: TetaPluginGatewayMeta,
  confidence: number,
  ragScore?: number,
): TetaPluginGatewayHint {
  return {
    dllName: bundle.dllName,
    dllPath: bundle.dllPath,
    formName: formDisplayName(form, bundle.dllName),
    gatewayClassName: gateway.ClassName,
    gatewayKind: gateway.GatewayKind,
    viewName: gateway.ViewName ?? null,
    baseTableName: gateway.BaseTableName ?? null,
    tableAlias: gateway.TableAlias ?? null,
    datasetTableName: gateway.DatasetTableName ?? null,
    packageName: gateway.PackageName ?? null,
    relatedPackages: gateway.RelatedPackages
      ? {
          dac: gateway.RelatedPackages.dac ?? null,
          agl: gateway.RelatedPackages.agl ?? null,
          lep: gateway.RelatedPackages.lep ?? null,
        }
      : undefined,
    selectSql: extractExecutableSelect(gateway),
    confidence,
    ragScore,
  };
}

export function resolveHintsFromBundle(
  bundle: TetaPluginMetadataBundle,
  query: string,
  options?: { ragScore?: number; gatewayClassName?: string | null },
): TetaPluginGatewayHint[] {
  const hints: TetaPluginGatewayHint[] = [];
  const ragScore = options?.ragScore;
  const targetGateway = options?.gatewayClassName?.trim();

  for (const form of bundle.forms) {
    for (const gateway of form.Gateways ?? []) {
      if (targetGateway && gateway.ClassName.toLowerCase() !== targetGateway.toLowerCase()) {
        continue;
      }

      const relevance = scoreGateway(gateway, form, query);
      const confidence = relevance + (ragScore ?? 0) * 0.25 + (targetGateway ? 2 : 0);
      if (!targetGateway && confidence < 1) {
        continue;
      }

      hints.push(buildGatewayHint(bundle, form, gateway, confidence, ragScore));
    }
  }

  return hints.sort((a, b) => b.confidence - a.confidence);
}

export function formatPluginHintsForPrompt(
  hints: TetaPluginGatewayHint[],
  defaultOwner: string,
): string {
  if (hints.length === 0) {
    return '';
  }

  const lines = hints.map((hint, index) => {
    const parts = [
      `${index + 1}. Wtyczka **${hint.dllName}**`,
      hint.formName ? `formularz **${hint.formName}**` : null,
      `gateway **${hint.gatewayClassName}** (${hint.gatewayKind ?? 'gateway'})`,
    ].filter(Boolean);

    const objects: string[] = [];
    if (hint.viewName) {
      objects.push(`widok ${defaultOwner}.${hint.viewName}`);
    }
    if (hint.baseTableName) {
      objects.push(`tabela bazowa ${defaultOwner}.${hint.baseTableName}`);
    }
    if (hint.datasetTableName) {
      objects.push(`DataSet ${hint.datasetTableName}`);
    }
    if (hint.packageName) {
      objects.push(`pakiet ${hint.packageName}`);
    }
    if (hint.tableAlias) {
      objects.push(`alias ${hint.tableAlias}`);
    }

    const objectLine = objects.length > 0 ? `\n   Obiekty: ${objects.join('; ')}.` : '';
    const selectLine = hint.selectSql
      ? `\n   Sugerowany SELECT (z metadanych wtyczki — dodaj WHERE/JOIN wg pytania, prefiks ${defaultOwner}.):\n   ${hint.selectSql.replace(/\n/g, '\n   ')}`
      : '';

    return `- ${parts.join(', ')}.${objectLine}${selectLine}`;
  });

  return lines.join('\n');
}

export function formatColumnHintsForPrompt(hints: TetaPluginColumnHint[], query?: string): string {
  if (hints.length === 0) {
    return '';
  }

  const intentNote =
    query && /\b(?:o|z|ze)\b/i.test(query)
      ? ' W pytaniach typu «podaj X o Y wartość»: X → SELECT, Y (przed wartością) → WHERE.'
      : '';

  const lines = hints.slice(0, 12).map((hint) => {
    const column = hint.resolvedColumnName ?? hint.columnName;
    const objectSuffix = hint.targetObject ? ` w ${hint.targetObject}` : '';
    const sourceNote =
      hint.resolvedColumnName && hint.resolvedColumnName !== hint.columnName
        ? ` (kolumna wtyczki: ${hint.columnName})`
        : '';
    const synonymPart =
      hint.synonyms && hint.synonyms.length > 0 ? `; synonimy: ${hint.synonyms.join(', ')}` : '';
    return `- etykieta „${hint.label}” → **${column}**${objectSuffix}${sourceNote}${synonymPart} (${hint.dllName})`;
  });

  return `Mapowanie etykiet grida / synonimów → kolumny Oracle (z SELECT gatewaya — użyj kolumny technicznej w SQL, etykiety tylko do dopasowania pytania):${intentNote}\n${lines.join('\n')}`;
}

export function mappingsToColumnHints(
  mappings: TetaPluginColumnMapping[],
): TetaPluginColumnHint[] {
  return mappings.map((mapping) => ({
    dllName: mapping.dllName,
    formName: mapping.formName,
    label: mapping.label,
    columnName: mapping.oracleColumnName,
    confidence: 1,
    targetObject: mapping.targetObject,
    resolvedColumnName: mapping.resolvedColumnName,
    synonyms: mapping.synonyms,
  }));
}

export function formatPluginOracleHintsForPrompt(
  gateways: TetaPluginGatewayHint[],
  columnHints: TetaPluginColumnHint[],
  defaultOwner: string,
  query?: string,
): string {
  const parts = [
    formatPluginHintsForPrompt(gateways, defaultOwner),
    formatColumnHintsForPrompt(columnHints, query),
  ].filter(Boolean);
  return parts.join('\n\n');
}

export function isDataQueryIntent(message: string): boolean {
  return /pokaż|pokaz|wyświetl|wypisz|lista|listę|zestawienie|raport|ile\s+jest|top\s+\d|rekord|wiersz|dane\s+(o|z)|pracownik|pracowników|pracownicy/i.test(
    message,
  );
}

export function parseMetadataBundle(raw: string | null | undefined): TetaPluginMetadataBundle | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw) as TetaPluginMetadataBundle;
  } catch {
    return null;
  }
}
