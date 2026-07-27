/**
 * Stage 3I — versioned payroll report section catalog (exact + registered aliases only).
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { PayrollSectionKind } from './teta-payroll-snapshot.types';

export const STAGE3I_SECTIONS_CONFIG_VERSION = 'teta-payroll-report-sections-v1' as const;

export type PayrollSectionCatalogEntry = {
  canonicalId: string;
  canonicalLabel: string;
  kind: PayrollSectionKind;
  core: boolean;
  aliases: string[];
};

export type PayrollSectionCatalog = {
  contractVersion: string;
  sections: PayrollSectionCatalogEntry[];
};

let cached: PayrollSectionCatalog | null = null;

export function normalizeSectionHeading(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[:：]\s*$/g, '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pl-PL');
}

/** Compact key recovers soft-wrap spaces inside words (TOC hyperlink titles). */
export function compactSectionHeading(raw: string): string {
  return normalizeSectionHeading(raw).replace(/[\s\-]+/g, '');
}

export function loadPayrollSectionCatalog(apiRoot?: string): PayrollSectionCatalog {
  if (cached) return cached;
  const root =
    apiRoot ??
    (existsSync(path.join(process.cwd(), 'config', 'teta-payroll-report-sections-v1.json'))
      ? process.cwd()
      : path.join(process.cwd(), 'apps', 'api'));
  const filePath = path.join(root, 'config', 'teta-payroll-report-sections-v1.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as PayrollSectionCatalog;
  if (raw.contractVersion !== STAGE3I_SECTIONS_CONFIG_VERSION) {
    throw new Error(`Unexpected section catalog version ${raw.contractVersion}`);
  }
  cached = raw;
  return raw;
}

export function resetPayrollSectionCatalogCache(): void {
  cached = null;
}

export function resolveSectionHeading(
  rawLabel: string,
  catalog?: PayrollSectionCatalog,
):
  | {
      matched: true;
      entry: PayrollSectionCatalogEntry;
      sourceLabel: string;
      matchedVia: 'normalized' | 'compact' | 'alias';
    }
  | { matched: false; sourceLabel: string } {
  const cat = catalog ?? loadPayrollSectionCatalog();
  const sourceLabel = rawLabel.trim();
  const normalized = normalizeSectionHeading(sourceLabel);
  const compact = compactSectionHeading(sourceLabel);

  for (const entry of cat.sections) {
    const labels = [entry.canonicalLabel, ...entry.aliases];
    for (const alias of labels) {
      if (normalizeSectionHeading(alias) === normalized) {
        return { matched: true, entry, sourceLabel, matchedVia: 'normalized' };
      }
    }
  }
  for (const entry of cat.sections) {
    const labels = [entry.canonicalLabel, ...entry.aliases];
    for (const alias of labels) {
      if (compactSectionHeading(alias) === compact) {
        return { matched: true, entry, sourceLabel, matchedVia: 'compact' };
      }
    }
  }
  return { matched: false, sourceLabel };
}

export function listCoreSectionIds(catalog?: PayrollSectionCatalog): string[] {
  return (catalog ?? loadPayrollSectionCatalog()).sections
    .filter((s) => s.core)
    .map((s) => s.canonicalId);
}
