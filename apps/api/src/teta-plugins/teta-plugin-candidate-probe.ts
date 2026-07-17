import type { ChatHistoryMessage } from '@teta/shared';
import type { SchemaColumnMeta } from '../schema/schema-column-matcher.util';
import {
  resolveOutputMappingsFromQuery,
  type TetaPluginColumnMapping,
} from './teta-plugin-column-mapping';
import type { TetaPluginComputedIntent } from './teta-plugin-computed-intent.types';
import { buildDirectEmployeeSelect } from './teta-plugin-column-resolver';
import { linkMatchesSqlOutputIntent, normalizeSearchText } from './teta-plugin-grid-column-mapper';
import type { TetaPluginGatewayHint } from './teta-plugin-query-resolver';
import type { TetaApplicationObject } from './teta-application-object.types';

export type PluginSqlCandidateKind = 'view' | 'table' | 'unknown';

export type PluginSqlCandidate = {
  kind: PluginSqlCandidateKind;
  objectName: string;
  source: 'mapping' | 'gateway_view' | 'gateway_table' | 'help_binding';
  packageNames: string[];
  gatewayClassName?: string;
};

export type PluginPackageCandidate = {
  packageName: string;
  gatewayClassName?: string;
  selectSql?: string | null;
  sourceObject?: string;
};

const MAX_SQL_CANDIDATES = 5;

const TEXT_COLUMN_ALIASES: Record<string, string[]> = {
  STANOWISKO: ['STANOWISKO', 'NAZWA', 'NAME', 'NAME_2', 'OPIS'],
  NAZWA: ['NAZWA', 'STANOWISKO', 'NAME'],
};

function bareObjectName(name: string): string {
  const trimmed = name.trim().toUpperCase();
  return trimmed.includes('.') ? trimmed.split('.').pop()! : trimmed;
}

function uniquePush(target: string[], value: string | null | undefined): void {
  if (!value?.trim()) return;
  const bare = bareObjectName(value);
  if (!target.includes(bare)) {
    target.push(bare);
  }
}

/**
 * Zbiera kandydatów SQL z mapowań / gatewayi / help bindingów.
 * Kolejność: widoki → tabele → nieznane (max {@link MAX_SQL_CANDIDATES}).
 */
export function collectPluginSqlCandidates(input: {
  message: string;
  columnMappings: TetaPluginColumnMapping[];
  gateways: TetaPluginGatewayHint[];
  applicationObjects?: TetaApplicationObject[];
  lookupNodeType?: (objectName: string) => PluginSqlCandidateKind | null;
}): PluginSqlCandidate[] {
  const outputMappings = resolveOutputMappingsFromQuery(input.message, input.columnMappings, null);
  const orderedNames: Array<{ name: string; source: PluginSqlCandidate['source']; gatewayClassName?: string }> =
    [];

  const pushNamed = (
    name: string | null | undefined,
    source: PluginSqlCandidate['source'],
    gatewayClassName?: string,
  ) => {
    if (!name?.trim()) return;
    const bare = bareObjectName(name);
    if (orderedNames.some((item) => item.name === bare)) return;
    // Słowniki bez powiązania z pracownikiem — na końcu / pomijaj jako OUTPUT.
    if (/^NT_KP_SLO_/i.test(bare) || /^SLO_/i.test(bare)) return;
    orderedNames.push({ name: bare, source, gatewayClassName });
  };

  for (const mapping of outputMappings) {
    pushNamed(mapping.targetObject, 'mapping', mapping.gatewayClassName);
  }

  for (const gateway of input.gateways) {
    pushNamed(gateway.viewName, 'gateway_view', gateway.gatewayClassName);
  }

  for (const object of input.applicationObjects ?? []) {
    if (!object.binding?.targetObject) continue;
    const tokens = normalizeSearchText(input.message);
    const label = normalizeSearchText(object.fieldLabel ?? object.helpTitle ?? '');
    if (label && tokens.includes(label.split(/\s+/)[0]!)) {
      pushNamed(object.binding.targetObject, 'help_binding');
    } else if (
      object.binding.oracleColumnName &&
      linkMatchesSqlOutputIntent(input.message, {
        oracleColumnName: object.binding.oracleColumnName,
        label: object.fieldLabel ?? object.binding.oracleColumnName,
        gridColumnName: null,
        synonyms: object.keywords ?? [],
      })
    ) {
      pushNamed(object.binding.targetObject, 'help_binding');
    }
  }

  for (const gateway of input.gateways) {
    pushNamed(gateway.baseTableName, 'gateway_table', gateway.gatewayClassName);
  }

  // Doładuj obiekty z mapowań, które mają kolumnę OUTPUT (nawet gdy nie wygrały scoringu).
  for (const mapping of input.columnMappings) {
    if (
      linkMatchesSqlOutputIntent(input.message, {
        oracleColumnName: mapping.oracleColumnName,
        label: mapping.label,
        gridColumnName: mapping.gridColumnName,
        synonyms: mapping.synonyms,
      })
    ) {
      pushNamed(mapping.targetObject, 'mapping', mapping.gatewayClassName);
    }
  }

  // Stanowisko etatowe — typowe widoki Teta, gdy mapowania UC nie wystarczą.
  const normalizedMessage = normalizeSearchText(input.message);
  if (/\bstanowisk/.test(normalizedMessage)) {
    for (const name of ['NT_KP_IMP_STANOWISKA', 'NT_KP_KDR_STANOWISKA', 'NT_KP_IMP_UMOWY_UC']) {
      pushNamed(name, 'mapping');
    }
  }

  const packagesByObject = new Map<string, string[]>();
  for (const gateway of input.gateways) {
    const pkgs = [
      gateway.packageName,
      gateway.relatedPackages?.dac,
      gateway.relatedPackages?.agl,
      gateway.relatedPackages?.lep,
    ]
      .map((item) => item?.trim().toUpperCase())
      .filter((item): item is string => Boolean(item));
    for (const name of [gateway.viewName, gateway.baseTableName]) {
      if (!name?.trim() || pkgs.length === 0) continue;
      const bare = bareObjectName(name);
      const existing = packagesByObject.get(bare) ?? [];
      for (const pkg of pkgs) {
        if (!existing.includes(pkg)) existing.push(pkg);
      }
      packagesByObject.set(bare, existing);
    }
  }

  const views: PluginSqlCandidate[] = [];
  const tables: PluginSqlCandidate[] = [];
  const unknown: PluginSqlCandidate[] = [];

  for (const item of orderedNames) {
    const lookedUp = input.lookupNodeType?.(item.name) ?? null;
    const kind: PluginSqlCandidateKind =
      lookedUp ??
      (item.source === 'gateway_view' || item.source === 'mapping' || item.source === 'help_binding'
        ? // Mapowania z ViewName w Teta zwykle wskazują widok NT_* — traktuj jako view gdy brak grafu.
          /^NT_/i.test(item.name)
            ? 'view'
            : 'unknown'
        : item.source === 'gateway_table'
          ? 'table'
          : 'unknown');

    const candidate: PluginSqlCandidate = {
      kind,
      objectName: item.name,
      source: item.source,
      packageNames: packagesByObject.get(item.name) ?? [],
      gatewayClassName: item.gatewayClassName,
    };

    if (kind === 'view') views.push(candidate);
    else if (kind === 'table') tables.push(candidate);
    else unknown.push(candidate);
  }

  return [...views, ...tables, ...unknown].slice(0, MAX_SQL_CANDIDATES);
}

export function collectPluginPackageCandidates(
  gateways: TetaPluginGatewayHint[],
  sqlCandidates: PluginSqlCandidate[],
): PluginPackageCandidate[] {
  const out: PluginPackageCandidate[] = [];
  const seen = new Set<string>();

  for (const gateway of gateways) {
    const names = [
      gateway.packageName,
      gateway.relatedPackages?.dac,
      gateway.relatedPackages?.agl,
      gateway.relatedPackages?.lep,
    ];
    for (const packageName of names) {
      const upper = packageName?.trim().toUpperCase();
      if (!upper || seen.has(upper)) continue;
      seen.add(upper);
      out.push({
        packageName: upper,
        gatewayClassName: gateway.gatewayClassName,
        selectSql: gateway.selectSql,
        sourceObject: gateway.viewName ?? gateway.baseTableName ?? undefined,
      });
    }
  }

  for (const candidate of sqlCandidates) {
    for (const packageName of candidate.packageNames) {
      if (seen.has(packageName)) continue;
      seen.add(packageName);
      out.push({
        packageName,
        gatewayClassName: candidate.gatewayClassName,
        sourceObject: candidate.objectName,
      });
    }
  }

  return out.slice(0, 8);
}

function pickColumnForCandidate(
  desiredColumn: string,
  schemaColumns: SchemaColumnMeta[],
  candidateObject: string,
): string {
  const upper = desiredColumn.toUpperCase();
  const bare = bareObjectName(candidateObject);
  const schemaNames = new Set(schemaColumns.map((column) => column.name.toUpperCase()));
  if (schemaNames.size === 0) {
    if (/STANOWISKO|NAZWA/i.test(upper)) {
      if (/IMP_STANOW/i.test(bare)) return 'NAZWA';
      if (/KDR_STANOW/i.test(bare)) return 'SSTN_ID';
    }
    return upper;
  }
  if (schemaNames.has(upper)) {
    return upper;
  }
  for (const alias of TEXT_COLUMN_ALIASES[upper] ?? []) {
    if (schemaNames.has(alias)) {
      return alias;
    }
  }
  // Stanowisko / nazwa — ogólny fallback tekstowy.
  for (const fallback of ['STANOWISKO', 'NAZWA', 'NAME', 'OPIS', 'SSTN_ID']) {
    if (schemaNames.has(fallback)) {
      return fallback;
    }
  }
  return upper;
}

/**
 * Przepina mapowania OUTPUT na konkretny obiekt kandydata (widok/tabela)
 * i dopasowuje nazwy kolumn do schematu (np. STANOWISKO → NAZWA).
 */
export function remappedMappingsForCandidate(
  mappings: TetaPluginColumnMapping[],
  message: string,
  candidateObject: string,
  schemaColumns: SchemaColumnMeta[],
): TetaPluginColumnMapping[] {
  const bare = bareObjectName(candidateObject);
  const outputMappings = resolveOutputMappingsFromQuery(message, mappings, null);
  if (outputMappings.length === 0) {
    return mappings;
  }

  const remappedOutputs = outputMappings.map((mapping) => {
    const column = pickColumnForCandidate(
      mapping.resolvedColumnName ?? mapping.oracleColumnName,
      schemaColumns,
      bare,
    );
    return {
      ...mapping,
      targetObject: bare,
      oracleColumnName: column,
      pluginColumnName: column,
      resolvedColumnName: column,
    };
  });

  const employeeLink =
    schemaColumns.some((column) => column.name.toUpperCase() === 'IPRA_ID')
      ? 'IPRA_ID'
      : schemaColumns.some((column) => column.name.toUpperCase() === 'PRAC_ID')
        ? 'PRAC_ID'
        : /KDR_STANOW/i.test(bare)
          ? 'PRAC_ID'
          : /UMOW|IMP_STANOW|IMP_SZKOL|ZATRUD|PELNION/i.test(bare)
            ? 'IPRA_ID'
            : null;

  const linkMapping: TetaPluginColumnMapping | null = employeeLink
    ? {
        oracleColumnName: employeeLink,
        label: 'ID pracownika',
        gridColumnName: null,
        synonyms: ['ID pracownika'],
        pluginColumnName: employeeLink,
        resolvedColumnName: employeeLink,
        targetObject: bare,
        dllName: remappedOutputs[0]?.dllName ?? 'probe',
        gatewayClassName: remappedOutputs[0]?.gatewayClassName,
      }
    : null;

  // Zachowaj mapowania ról filtrów (IMIE/NAZWISKO na pracowniku) + resztę bez OUTPUT ze starego obiektu.
  const filterKeep = mappings.filter((mapping) => {
    const isOutput = outputMappings.some(
      (output) =>
        output.oracleColumnName === mapping.oracleColumnName &&
        output.targetObject === mapping.targetObject &&
        output.gatewayClassName === mapping.gatewayClassName,
    );
    return !isOutput;
  });

  return [...remappedOutputs, ...(linkMapping ? [linkMapping] : []), ...filterKeep];
}

export function buildSqlForCandidate(input: {
  candidate: PluginSqlCandidate;
  message: string;
  history: ChatHistoryMessage[];
  defaultOwner: string;
  columnMappings: TetaPluginColumnMapping[];
  computedIntents: TetaPluginComputedIntent[];
  gateways?: TetaPluginGatewayHint[];
  schemaColumns: SchemaColumnMeta[];
}): string | null {
  const bare = bareObjectName(input.candidate.objectName);
  const normalized = normalizeSearchText(input.message);

  // Stanowisko etatowe w KDR — join ze słownikiem NAZWA (SSTN_ID → SLO).
  if (/KDR_STANOWISKA$/i.test(bare) && /\bstanowisk/.test(normalized)) {
    const remapped = remappedMappingsForCandidate(
      input.columnMappings,
      input.message,
      bare,
      input.schemaColumns,
    );
    const base = buildDirectEmployeeSelect({
      message: input.message,
      history: input.history,
      defaultOwner: input.defaultOwner,
      columnMappings: remapped,
      computedIntents: input.computedIntents,
      gateways: input.gateways,
      preferredTable: bare,
      forceOutputTable: true,
      schemaColumns: input.schemaColumns,
    });
    if (base) {
      const owner = input.defaultOwner.toUpperCase();
      const whereMatch = base.match(/\bWHERE\s+([\s\S]+)$/i);
      if (whereMatch) {
        return (
          `SELECT s.NAZWA AS STANOWISKO, k.SSTN_ID, k.DATA_OD, k.DATA_DO ` +
          `FROM ${owner}.${bare} k ` +
          `LEFT JOIN ${owner}.NT_KP_SLO_STANOWISKA s ON s.ID = k.SSTN_ID ` +
          `WHERE ${whereMatch[1].replace(/\bPRAC_ID\b/g, 'k.PRAC_ID').replace(/\bIPRA_ID\b/g, 'k.PRAC_ID')}`
        );
      }
    }
  }

  const remapped = remappedMappingsForCandidate(
    input.columnMappings,
    input.message,
    input.candidate.objectName,
    input.schemaColumns,
  );

  return buildDirectEmployeeSelect({
    message: input.message,
    history: input.history,
    defaultOwner: input.defaultOwner,
    columnMappings: remapped,
    computedIntents: input.computedIntents,
    gateways: input.gateways,
    preferredTable: input.candidate.objectName,
    forceOutputTable: true,
    schemaColumns: input.schemaColumns,
  });
}

export function formatPackageHintsForAgent(packages: PluginPackageCandidate[]): string {
  if (packages.length === 0) {
    return '';
  }
  const lines = packages.map((item, index) => {
    const parts = [
      `${index + 1}. Pakiet **${item.packageName}**`,
      item.sourceObject ? `(obiekt ${item.sourceObject})` : null,
      item.gatewayClassName ? `gateway ${item.gatewayClassName}` : null,
      item.selectSql ? `ma gotowy SELECT w metadanych wtyczki` : null,
    ].filter(Boolean);
    return parts.join(' ');
  });
  return (
    `Powiązane pakiety Oracle do rozważenia (gdy SELECT z widoków/tabel nie dał wierszy):\n` +
    lines.join('\n') +
    `\nJeśli znasz funkcję SELECT z pakietu (_DAC/_AGL/_LEP), użyj call_procedure lub zbuduj SELECT.`
  );
}

/** Eksport pomocniczy pod testy. */
export function listCandidateObjectNames(candidates: PluginSqlCandidate[]): string[] {
  return candidates.map((candidate) => candidate.objectName);
}

export { uniquePush, bareObjectName, MAX_SQL_CANDIDATES };
