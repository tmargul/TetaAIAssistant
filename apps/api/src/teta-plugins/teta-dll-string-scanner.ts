import { readFileSync } from 'fs';

const BO_CLASS_QUOTED_PATTERN = /"((?:[A-Za-z_]\w*\.)+[A-Za-z_]\w*BO)"/g;
const BO_CLASS_FQN_PATTERN = /\b((?:[A-Za-z_]\w*\.)+[A-Za-z_]\w*\.BO\.[A-Za-z_]\w*BO)\b/g;
const PLUGIN_VIEW_CLASS_PATTERN = /^[A-Z][A-Za-z0-9_]*Widok$/;
const GATEWAY_NEW_PATTERN = /new\s+(?:[A-Za-z_]\w*\.)*([A-Za-z_]\w*(?:MTG|TG))\s*\(/g;
const GATEWAY_TYPE_PATTERN = /\b([A-Za-z_]\w*(?:MTG|TG))\b/g;

export function extractUtf16LeStrings(buffer: Buffer, minLength = 4): string[] {
  const results: string[] = [];
  let current = '';

  for (let index = 0; index < buffer.length - 1; index += 2) {
    const code = buffer.readUInt16LE(index);
    if (code >= 32 && code <= 126) {
      current += String.fromCharCode(code);
      continue;
    }
    if (current.length >= minLength) {
      results.push(current);
    }
    current = '';
  }

  if (current.length >= minLength) {
    results.push(current);
  }

  return results;
}

export function extractAsciiStrings(buffer: Buffer, minLength = 4): string[] {
  const results: string[] = [];
  let current = '';

  for (const byte of buffer) {
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
      continue;
    }
    if (current.length >= minLength) {
      results.push(current);
    }
    current = '';
  }

  if (current.length >= minLength) {
    results.push(current);
  }

  return results;
}

export function readDllStrings(filePath: string): string[] {
  const buffer = readFileSync(filePath);
  const merged = new Set<string>();
  for (const value of [...extractUtf16LeStrings(buffer), ...extractAsciiStrings(buffer)]) {
    merged.add(value);
  }
  return [...merged];
}

export function findBusinessObjectReferences(strings: string[]): string[] {
  const result = new Set<string>();
  for (const text of strings) {
    for (const pattern of [BO_CLASS_QUOTED_PATTERN, BO_CLASS_FQN_PATTERN]) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const fqName = match[1]?.trim();
        if (fqName) result.add(fqName);
      }
    }
  }
  return [...result];
}

/** Proste nazwy klas *Widok osadzone w skompilowanym DLL wtyczki (bez pełnego FQN). */
export function findPluginViewClassNamesInDllStrings(strings: string[]): string[] {
  const result = new Set<string>();
  for (const text of strings) {
    const trimmed = text.trim();
    if (trimmed.length > 80) continue;
    if (PLUGIN_VIEW_CLASS_PATTERN.test(trimmed)) {
      result.add(trimmed);
    }
  }
  return [...result].sort((a, b) => a.localeCompare(b, 'pl'));
}

export function findGatewayClassNames(strings: string[]): string[] {
  const result = new Set<string>();

  for (const text of strings) {
    for (const pattern of [GATEWAY_NEW_PATTERN, GATEWAY_TYPE_PATTERN]) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const className = match[1]?.trim();
        if (!className) continue;
        if (/^(MTG|TG)$/i.test(className)) continue;
        result.add(className);
      }
    }
  }

  return [...result].sort((a, b) => a.localeCompare(b, 'pl'));
}

export function extractTagFromText(sourceText: string, tagName: string): string | null {
  const pattern = new RegExp(
    `<${tagName}>\\s*([^<\\r\\n]+)\\s*<\\/${tagName}>`,
    'i',
  );
  const match = sourceText.match(pattern);
  return match?.[1]?.trim() ?? null;
}

export function extractAssignedValueFromText(sourceText: string, propertyName: string): string | null {
  const patterns = [
    new RegExp(`${propertyName}\\s*=\\s*"([^"]+)"`, 'i'),
    new RegExp(`this\\.${propertyName}\\s*=\\s*"([^"]+)"`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = sourceText.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function extractDatasetTableNameFromText(sourceText: string): string | null {
  let match = sourceText.match(/<NazwaTabeliDataSet>\s*([^<\r\n]+)\s*<\/NazwaTabeliDataSet>/i);
  if (match?.[1]) return match[1].trim();

  match = sourceText.match(/base\s*\(\s*\w+\s*,\s*"([^"]+)"\s*\)/i);
  if (match?.[1]) return match[1].trim();

  return null;
}

export function extractBuilderPackageNameFromText(sourceText: string): string | null {
  const patterns = [
    /new\s+SumoCommandBuilder\s*\([^\)]*?"([^"\r\n]+)"\s*,\s*DataSetTableName\s*\)/is,
    /new\s+SumoCommandBuilder\s*\([^\)]*?"([^"\r\n]*?_DAC)"/is,
  ];
  for (const pattern of patterns) {
    const match = sourceText.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function cleanMetadataValue(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if (['brak', 'none', 'null', '-'].includes(trimmed.toLowerCase())) return null;
  return trimmed;
}

export function extractGatewayWindowFromDllText(dllText: string, className: string): string {
  const index = dllText.indexOf(className);
  if (index < 0) {
    return '';
  }
  const start = Math.max(0, index - 4000);
  const end = Math.min(dllText.length, index + 12000);
  return dllText.slice(start, end);
}

function extractGatewayMetadataFromTextWindow(sourceText: string): {
  DatasetTableName: string | null;
  ViewName: string | null;
  PackageName: string | null;
  TableAlias: string | null;
  BaseTableName: string | null;
} {
  let packageName = cleanMetadataValue(extractTagFromText(sourceText, 'PakietDAC'));
  if (!packageName) {
    packageName = cleanMetadataValue(extractBuilderPackageNameFromText(sourceText));
  }

  return {
    DatasetTableName: cleanMetadataValue(extractDatasetTableNameFromText(sourceText)),
    ViewName: cleanMetadataValue(
      extractTagFromText(sourceText, 'Perspektywa') ??
        extractAssignedValueFromText(sourceText, 'TableName'),
    ),
    PackageName: packageName,
    TableAlias: cleanMetadataValue(extractTagFromText(sourceText, 'Alias')),
    BaseTableName: cleanMetadataValue(
      extractTagFromText(sourceText, 'TabelaBD') ?? extractTagFromText(sourceText, 'DataBaseTable'),
    ),
  };
}

function mergeGatewayMetadataPartial(
  primary: ReturnType<typeof extractGatewayMetadataFromTextWindow>,
  secondary: ReturnType<typeof extractGatewayMetadataFromTextWindow>,
): ReturnType<typeof extractGatewayMetadataFromTextWindow> {
  return {
    DatasetTableName: primary.DatasetTableName ?? secondary.DatasetTableName,
    ViewName: primary.ViewName ?? secondary.ViewName,
    PackageName: primary.PackageName ?? secondary.PackageName,
    TableAlias: primary.TableAlias ?? secondary.TableAlias,
    BaseTableName: primary.BaseTableName ?? secondary.BaseTableName,
  };
}

export function extractGatewayMetadataFromDllStrings(
  className: string,
  strings: string[],
): ReturnType<typeof extractGatewayMetadataFromTextWindow> {
  const classLower = className.toLowerCase();
  let merged = extractGatewayMetadataFromTextWindow('');

  for (const text of strings) {
    if (text.length > 80_000) continue;
    const lower = text.toLowerCase();
    if (!lower.includes(classLower)) continue;
    if (
      !text.includes('<Perspektywa>') &&
      !text.includes('<PakietDAC>') &&
      !text.includes('<Alias>') &&
      !text.includes('SumoCommandBuilder')
    ) {
      continue;
    }
    merged = mergeGatewayMetadataPartial(merged, extractGatewayMetadataFromTextWindow(text));
  }

  return merged;
}

export type BoViewCatalogEntry = {
  ViewName: string;
  TableAlias: string;
  PackageName: string;
  PackageKind: 'DAC' | 'AGL' | 'LEP';
};

/** Sekwencje View → Alias → pakiet (_DAC / _AGL / _LEP) osadzone w skompilowanym DLL BO. */
export function parseViewAliasPackageCatalog(strings: string[]): BoViewCatalogEntry[] {
  const blob = strings.filter((value) => value.length <= 120).join('\n');
  const catalog = new Map<string, BoViewCatalogEntry>();
  const pattern =
    /(NT_[A-Z0-9_]+|KP_[A-Z0-9_]+)\n([A-Z][A-Z0-9_]{1,8})\n(\1_(DAC|AGL|LEP))/g;

  for (const match of blob.matchAll(pattern)) {
    const viewName = match[1]?.trim();
    const tableAlias = match[2]?.trim();
    const packageName = match[3]?.trim();
    const packageKind = match[4] as 'DAC' | 'AGL' | 'LEP' | undefined;
    if (!viewName || !tableAlias || !packageName || !packageKind) continue;
    catalog.set(`${viewName}:${packageKind}`, {
      ViewName: viewName,
      TableAlias: tableAlias,
      PackageName: packageName,
      PackageKind: packageKind,
    });
  }

  return [...catalog.values()].sort((a, b) => a.ViewName.localeCompare(b.ViewName, 'pl'));
}

function classNameToSearchTokens(className: string): string[] {
  const baseName = className.replace(/(?:MTG|TG)$/i, '');
  const tokens = new Set<string>();

  const underscored = baseName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  tokens.add(underscored);
  tokens.add(baseName.toUpperCase());

  for (const part of underscored.split('_').filter((part) => part.length >= 4)) {
    tokens.add(part);
  }

  if (/wyksztalcenie/i.test(baseName)) tokens.add('WYKSZTALCENIE');
  if (/informacjedodatkowe|infdod/i.test(baseName)) tokens.add('INFO_DODA');
  if (/adresy/i.test(baseName)) tokens.add('ADRESY');
  if (/pracownik/i.test(baseName)) tokens.add('PRACOWN');

  return [...tokens].sort((a, b) => b.length - a.length);
}

function scoreCatalogEntry(entry: BoViewCatalogEntry, tokens: string[]): number {
  const haystack = `${entry.ViewName}_${entry.PackageName}`.toUpperCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += token.length;
    }
  }
  return score;
}

function inferDatasetTableName(className: string, strings: string[]): string | null {
  const baseName = className.replace(/(?:MTG|TG)$/i, '');
  const exact = strings.find(
    (value) => value.length <= 40 && value.localeCompare(baseName, 'pl', { sensitivity: 'accent' }) === 0,
  );
  if (exact) return exact;

  if (className.toUpperCase().endsWith('MTG') && strings.includes('Pracownik')) {
    return 'Pracownik';
  }

  return baseName || null;
}

/** Uzupełnia metadane buildera z katalogu widoków osadzonego w DLL BO (fallback bez źródeł .cs). */
export function inferGatewayMetadataFromBoDll(
  className: string,
  strings: string[],
): ReturnType<typeof extractGatewayMetadataFromTextWindow> {
  const catalog = parseViewAliasPackageCatalog(strings);
  const tokens = classNameToSearchTokens(className);
  const datasetTableName = inferDatasetTableName(className, strings);

  let bestEntry: BoViewCatalogEntry | null = null;
  let bestScore = 0;
  for (const entry of catalog) {
    const score = scoreCatalogEntry(entry, tokens);
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  let viewName = bestEntry?.ViewName ?? null;
  let tableAlias = bestEntry?.TableAlias ?? null;
  let packageName =
    bestEntry?.PackageKind === 'DAC' || !bestEntry
      ? bestEntry?.PackageName ?? null
      : null;
  let packageAgl = bestEntry?.PackageKind === 'AGL' ? bestEntry.PackageName : null;
  let packageLep = bestEntry?.PackageKind === 'LEP' ? bestEntry.PackageName : null;

  for (const entry of catalog) {
    if (entry.ViewName !== viewName && !viewName) continue;
    if (entry.ViewName === viewName || scoreCatalogEntry(entry, tokens) > 0) {
      if (entry.PackageKind === 'DAC') packageName = packageName ?? entry.PackageName;
      if (entry.PackageKind === 'AGL') packageAgl = packageAgl ?? entry.PackageName;
      if (entry.PackageKind === 'LEP') packageLep = packageLep ?? entry.PackageName;
      viewName = viewName ?? entry.ViewName;
      tableAlias = tableAlias ?? entry.TableAlias;
    }
  }

  if (className.toUpperCase().endsWith('MTG')) {
    const packages = strings.filter((value) => /^(NT_[A-Z0-9_]+|KP_[A-Z0-9_]+)_(DAC|AGL|LEP)$/.test(value));
    let bestPackage: string | null = null;
    let bestPackageScore = 0;
    for (const candidate of packages) {
      for (const token of tokens) {
        if (token.length >= 6 && candidate.includes(token)) {
          const score = token.length;
          if (score > bestPackageScore) {
            bestPackageScore = score;
            bestPackage = candidate;
          }
        }
      }
    }
    if (bestPackage) {
      packageName = bestPackage;
    }

    const employeeView = strings.find((value) => value === 'NT_KP_PRC_PRACOWNICY');
    if (employeeView) {
      viewName = employeeView;
      tableAlias = 'PRAC';
    } else if (/pracownik/i.test(className)) {
      tableAlias = tableAlias ?? 'PRAC';
    }

    if (employeeView || bestPackage?.includes('_PRC_')) {
      return {
        DatasetTableName: 'Pracownik',
        ViewName: cleanMetadataValue(viewName),
        PackageName: cleanMetadataValue(packageName),
        TableAlias: cleanMetadataValue(tableAlias),
        BaseTableName: null,
      };
    }
  }

  return {
    DatasetTableName: cleanMetadataValue(datasetTableName),
    ViewName: cleanMetadataValue(viewName),
    PackageName: cleanMetadataValue(packageName ?? packageAgl ?? packageLep),
    TableAlias: cleanMetadataValue(tableAlias),
    BaseTableName: null,
  };
}

export function extractGatewayMetadataFromDllText(
  className: string,
  dllText: string,
  strings?: string[],
): {
  DatasetTableName: string | null;
  ViewName: string | null;
  PackageName: string | null;
  TableAlias: string | null;
  BaseTableName: string | null;
} {
  const window = extractGatewayWindowFromDllText(dllText, className);
  let merged = window
    ? extractGatewayMetadataFromTextWindow(window)
    : extractGatewayMetadataFromTextWindow('');

  if (strings?.length) {
    merged = mergeGatewayMetadataPartial(
      merged,
      extractGatewayMetadataFromDllStrings(className, strings),
    );
    merged = mergeGatewayMetadataPartial(merged, inferGatewayMetadataFromBoDll(className, strings));
  }

  return merged;
}
