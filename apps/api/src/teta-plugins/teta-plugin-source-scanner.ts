import { readFileSync } from 'fs';
import type { TetaPluginSourceLocator } from './teta-plugin-source-locator';
const GATEWAY_CLASS_PATTERN = /new\s+(?:[A-Za-z_]\w*\.)*([A-Za-z_]\w*(?:MTG|TG))\s*\(/gi;
const BO_CLASS_PATTERN = /"((?:[A-Za-z_]\w*\.)+[A-Za-z_]\w*BO)"/gi;

function readText(sourceFile: string): string | null {
  try {
    return readFileSync(sourceFile, 'utf8');
  } catch {
    return null;
  }
}

export function findReferencedGatewayClasses(sourceFile: string): string[] {
  const text = readText(sourceFile);
  if (!text) return [];

  const result = new Set<string>();
  for (const match of text.matchAll(GATEWAY_CLASS_PATTERN)) {
    const className = match[1]?.trim();
    if (className) result.add(className);
  }
  return [...result];
}

function enqueueBoSourceFiles(
  locator: TetaPluginSourceLocator,
  sourceFile: string,
  queue: string[],
  seenFiles: Set<string>,
): void {
  const text = readText(sourceFile);
  if (!text) return;

  for (const match of text.matchAll(BO_CLASS_PATTERN)) {
    const fqName = match[1]?.trim();
    if (!fqName) continue;
    const simpleName = fqName.split('.').pop();
    if (!simpleName) continue;
    const boSource = locator.findClassSourceFile(simpleName);
    if (boSource && !seenFiles.has(boSource.toLowerCase())) {
      seenFiles.add(boSource.toLowerCase());
      queue.push(boSource);
    }
  }
}

export function collectReferencedGatewayClasses(
  locator: TetaPluginSourceLocator,
  sourceFile: string,
): string[] {
  const result: string[] = [];
  const seenClasses = new Set<string>();
  const seenFiles = new Set<string>();
  const queue: string[] = [];

  seenFiles.add(sourceFile.toLowerCase());
  queue.push(sourceFile);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    enqueueBoSourceFiles(locator, current, queue, seenFiles);

    for (const gatewayClassName of findReferencedGatewayClasses(current)) {
      if (!seenClasses.has(gatewayClassName.toLowerCase())) {
        seenClasses.add(gatewayClassName.toLowerCase());
        result.push(gatewayClassName);

        const nestedSource = locator.findClassSourceFile(gatewayClassName);
        if (nestedSource && !seenFiles.has(nestedSource.toLowerCase())) {
          seenFiles.add(nestedSource.toLowerCase());
          queue.push(nestedSource);
        }
      }
    }
  }

  return result;
}

export function collectBusinessObjectReferencesFromSource(sourceFile: string): string[] {
  const text = readText(sourceFile);
  if (!text) return [];

  const result = new Set<string>();
  for (const match of text.matchAll(BO_CLASS_PATTERN)) {
    const fqName = match[1]?.trim();
    if (fqName) result.add(fqName);
  }
  return [...result];
}

export function cleanMetadataValue(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  if (['brak', 'none', 'null', '-'].includes(trimmed.toLowerCase())) return null;
  return trimmed;
}

export function extractDatasetTableName(sourceText: string): string | null {
  let match = sourceText.match(/<NazwaTabeliDataSet>\s*([^<\r\n]+)\s*<\/NazwaTabeliDataSet>/i);
  if (match?.[1]) return match[1].trim();

  match = sourceText.match(/base\s*\(\s*\w+\s*,\s*"([^"]+)"\s*\)/i);
  if (match?.[1]) return match[1].trim();

  return null;
}

export function extractTag(sourceText: string, tagName: string): string | null {
  const pattern = new RegExp(
    `<${tagName}>\\s*([^<\\r\\n]+)\\s*<\\/${tagName}>`,
    'i',
  );
  const match = sourceText.match(pattern);
  return match?.[1]?.trim() ?? null;
}

export function extractAssignedValue(sourceText: string, propertyName: string): string | null {
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

export function extractBuilderPackageName(sourceText: string): string | null {
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

export function extractGatewayMetadataFromSource(
  gatewayClassName: string,
  gatewaySource: string,
): {
  DatasetTableName: string | null;
  ViewName: string | null;
  PackageName: string | null;
  TableAlias: string | null;
  BaseTableName: string | null;
} {
  const sourceText = readText(gatewaySource) ?? '';
  let packageName = cleanMetadataValue(extractTag(sourceText, 'PakietDAC'));
  if (!packageName) {
    packageName = cleanMetadataValue(extractBuilderPackageName(sourceText));
  }

  return {
    DatasetTableName: cleanMetadataValue(extractDatasetTableName(sourceText)),
    ViewName: cleanMetadataValue(
      extractTag(sourceText, 'Perspektywa') ?? extractAssignedValue(sourceText, 'TableName'),
    ),
    PackageName: packageName,
    TableAlias: cleanMetadataValue(extractTag(sourceText, 'Alias')),
    BaseTableName: cleanMetadataValue(
      extractTag(sourceText, 'TabelaBD') ?? extractTag(sourceText, 'DataBaseTable'),
    ),
  };
}
