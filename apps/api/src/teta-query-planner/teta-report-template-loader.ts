/**
 * Stage 3C — load report query templates (business semantics only).
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { ReportQueryTemplate, ReportQueryTemplatesFile } from './teta-report-template.types';
import { STAGE3C_REPORT_TEMPLATE_VERSION } from './teta-query-plan.types';

const FORBIDDEN_ORACLE_NAME_RE =
  /\b(T_PRAC|L_BADANIA_BHP|SL_BADANIA_BHP|NT_[A-Z0-9_]+)\b/i;

export function defaultReportTemplatePath(apiRoot: string): string {
  return path.join(apiRoot, 'config', 'teta-report-query-templates-v1.json');
}

export function loadReportTemplates(filePath: string): ReportQueryTemplatesFile {
  if (!existsSync(filePath)) {
    throw new Error(`Missing report templates file: ${filePath}`);
  }
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as ReportQueryTemplatesFile;
  if (raw.version !== STAGE3C_REPORT_TEMPLATE_VERSION) {
    throw new Error(
      `Unsupported report template version: ${raw.version} (expected ${STAGE3C_REPORT_TEMPLATE_VERSION})`,
    );
  }
  validateNoHardcodedOracleNames(raw);
  return raw;
}

export function getReportTemplate(
  file: ReportQueryTemplatesFile,
  subject: string,
): ReportQueryTemplate | null {
  return file.templates.find((t) => t.subject === subject) ?? null;
}

function collectStrings(value: unknown, out: string[], pathHint: string) {
  if (typeof value === 'string') {
    out.push(`${pathHint}:${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectStrings(v, out, `${pathHint}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'auditReferenceHints' || k === 'knownConfirmedObjectsIfPresentInGraph') continue;
      collectStrings(v, out, `${pathHint}.${k}`);
    }
  }
}

/** Production template must not hardcode Oracle object names outside auditReferenceHints. */
export function validateNoHardcodedOracleNames(file: ReportQueryTemplatesFile): void {
  for (const t of file.templates) {
    const strings: string[] = [];
    const clone = { ...t } as Record<string, unknown>;
    delete clone.auditReferenceHints;
    collectStrings(clone, strings, t.subject);
    for (const s of strings) {
      if (FORBIDDEN_ORACLE_NAME_RE.test(s)) {
        throw new Error(`Report template contains forbidden Oracle hardcoding: ${s}`);
      }
    }
  }
}
