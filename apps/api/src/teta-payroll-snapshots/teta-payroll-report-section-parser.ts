/**
 * Stage 3I — component row parsing (+ re-exports section inventory).
 */
import { createHash } from 'crypto';
import type { TetaPayrollComponentDefinition } from './teta-payroll-snapshot.types';
import { STAGE3I_MAX_RECORDS } from './teta-payroll-snapshot.types';
import {
  parseReportSections,
  inventoryReportSections,
  type ParsedSectionBody,
} from './teta-payroll-section-inventory';

export {
  parseReportSections,
  inventoryReportSections,
  type ParsedSectionBody,
  type SectionInventoryResult,
  type SectionReconciliation,
} from './teta-payroll-section-inventory';

function nullIfEmpty(value: string | undefined | null): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t.length ? t : null;
}

function parseBoolLoose(value: string | null): boolean | null {
  if (value == null) return null;
  const v = value.trim().toLowerCase();
  if (['1', 't', 'true', 'tak', 'yes', 'y'].includes(v)) return true;
  if (['0', 'n', 'false', 'nie', 'no'].includes(v)) return false;
  return null;
}

export function parseComponentRows(
  section: ParsedSectionBody,
  snapshotId: string,
): {
  components: TetaPayrollComponentDefinition[];
  unparsed: number;
  duplicateCodes: string[];
  duplicateInternalIds: string[];
} {
  const components: TetaPayrollComponentDefinition[] = [];
  let unparsed = 0;
  const codeCounts = new Map<string, number>();
  const idCounts = new Map<string, number>();

  let ordinal = 0;
  let pending: TetaPayrollComponentDefinition | null = null;

  const flushPending = () => {
    if (!pending) return;
    components.push(pending);
    codeCounts.set(pending.code, (codeCounts.get(pending.code) ?? 0) + 1);
    if (pending.componentInternalId) {
      idCounts.set(
        pending.componentInternalId,
        (idCounts.get(pending.componentInternalId) ?? 0) + 1,
      );
    }
    pending = null;
  };

  for (const line of section.lines) {
    if (components.length + unparsed >= STAGE3I_MAX_RECORDS) break;
    const cells = line.split('\t').map((c) => c.trim());
    if (cells.length < 3) {
      if (/^(ID|KOD|TYTUŁ|NAZWA|T|WZÓR)\b/i.test(line)) continue;
      if (pending && /m0_|CASE\s+WHEN|wartosc_formuly_sql|SELECT\b/i.test(line)) {
        const formulaCell =
          cells.find((c) => /m0_|CASE\s+WHEN|wartosc_formuly_sql|SELECT\b/i.test(c)) ??
          cells.filter(Boolean).join(' ');
        pending.formulaRaw = [pending.formulaRaw, formulaCell].filter(Boolean).join('\n');
        continue;
      }
      unparsed += 1;
      continue;
    }

    let internalId = nullIfEmpty(cells[0]);
    let code = nullIfEmpty(cells[1]);
    let title = nullIfEmpty(cells[2]);
    let typeCode = nullIfEmpty(cells[3]);

    if (
      pending &&
      (!code || !/^\d+$/.test(code)) &&
      cells.some((c) => /m0_|CASE\s+WHEN|wartosc_formuly_sql/i.test(c))
    ) {
      const formulaCell = cells.find((c) => /m0_|CASE\s+WHEN|wartosc_formuly_sql/i.test(c))!;
      pending.formulaRaw = [pending.formulaRaw, formulaCell].filter(Boolean).join('\n');
      continue;
    }

    if (!code || !/^\d+$/.test(code)) {
      const codeCell = cells.find((c, idx) => idx > 0 && /^\d{1,6}$/.test(c));
      if (!codeCell) {
        if (pending && cells.some((c) => /m0_/.test(c))) {
          const formulaCell = cells.find((c) => /m0_/.test(c))!;
          pending.formulaRaw = [pending.formulaRaw, formulaCell].filter(Boolean).join('\n');
          continue;
        }
        unparsed += 1;
        continue;
      }
      code = codeCell;
    }

    flushPending();
    ordinal += 1;
    const formulaRaw =
      nullIfEmpty(
        cells.find(
          (c, idx) =>
            idx >= 4 && /m0_|CASE|SELECT|wartosc_formuly|mz\(|m1\(/i.test(c),
        ),
      ) ??
      nullIfEmpty(cells[4]) ??
      nullIfEmpty(cells[5]);
    const hintId = nullIfEmpty(cells[5]);
    const correctionMode = nullIfEmpty(cells[6]);
    const meaningRaw = nullIfEmpty(cells[7]);

    const recordHash = createHash('sha256')
      .update(`${code}|${title ?? ''}|${formulaRaw ?? ''}|${ordinal}`, 'utf8')
      .digest('hex')
      .slice(0, 16);

    pending = {
      snapshotId,
      componentInternalId: internalId && /^\d+$/.test(internalId) ? internalId : null,
      code,
      title,
      typeCode,
      hintId,
      formulaRaw,
      correctionMode,
      meaningRaw,
      parameters: {
        parameter1: nullIfEmpty(cells[8]),
        parameter2: nullIfEmpty(cells[9]),
        parameter3: nullIfEmpty(cells[10]),
      },
      obligatory: parseBoolLoose(nullIfEmpty(cells[11])),
      civilContract: parseBoolLoose(nullIfEmpty(cells[12])),
      accountingRaw: nullIfEmpty(cells[13]),
      splitByCostCenter: parseBoolLoose(nullIfEmpty(cells[14])),
      contextRaw: nullIfEmpty(cells[15]),
      creationModificationRaw: nullIfEmpty(cells[16]),
      sourceEvidence: {
        section: section.summary.sourceLabel ?? section.summary.title,
        recordOrdinal: ordinal,
        recordHash,
      },
    };
  }
  flushPending();

  section.summary.recordCount = components.length;
  return {
    components,
    unparsed,
    duplicateCodes: [...codeCounts.entries()].filter(([, n]) => n > 1).map(([c]) => c),
    duplicateInternalIds: [...idCounts.entries()].filter(([, n]) => n > 1).map(([c]) => c),
  };
}

export function countGenericRecords(section: ParsedSectionBody): number {
  const count = section.lines.filter((l) => l.split('\t').length >= 2).length;
  section.summary.recordCount = count;
  return count;
}
