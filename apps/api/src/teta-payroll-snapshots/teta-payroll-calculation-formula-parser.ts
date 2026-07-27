/**
 * Stage 3I — calculation formula section parser (no execution).
 */
import { createHash } from 'crypto';
import { parsePayrollFormula } from './teta-payroll-formula-parser';
import type { ParsedSectionBody } from './teta-payroll-section-inventory';
import type {
  TetaPayrollCalculationFormulaComponentReference,
  TetaPayrollCalculationFormulaDefinition,
} from './teta-payroll-snapshot.types';
import { STAGE3I_MAX_RECORDS } from './teta-payroll-snapshot.types';

function nullIfEmpty(value: string | undefined | null): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t.length ? t : null;
}

export function parseCalculationFormulaRows(
  section: ParsedSectionBody,
  snapshotId: string,
): {
  formulas: TetaPayrollCalculationFormulaDefinition[];
  unparsed: number;
  parseFailures: number;
  componentReferences: TetaPayrollCalculationFormulaComponentReference[];
  missingComponentTargets: string[];
  unknownCalls: string[];
} {
  const formulas: TetaPayrollCalculationFormulaDefinition[] = [];
  const componentReferences: TetaPayrollCalculationFormulaComponentReference[] = [];
  const missingTargets = new Set<string>();
  const unknownCalls = new Set<string>();
  let unparsed = 0;
  let parseFailures = 0;
  let ordinal = 0;

  const sourceLabel = section.summary.sourceLabel ?? section.summary.title;
  const canonicalId = section.summary.canonicalId ?? 'calculation_formulas';

  for (const line of section.lines) {
    if (formulas.length + unparsed >= STAGE3I_MAX_RECORDS) break;
    const cells = line.split('\t').map((c) => c.trim());
    if (/^(ID|TYTUŁ|TYP|WZÓR)\b/i.test(line) && cells.length <= 4 && !/^\d/.test(cells[0] ?? '')) {
      continue;
    }
    if (cells.length < 2) {
      unparsed += 1;
      continue;
    }

    // Expected: ID | TYTUŁ | TYP | WZÓR  (formula may be empty/"0")
    let internalId = nullIfEmpty(cells[0]);
    let title = nullIfEmpty(cells[1]);
    let formulaTypeRaw = nullIfEmpty(cells[2]);
    let formulaRaw = cells.length >= 4 ? cells.slice(3).join('\t') : null;

    if (!internalId || !/^\d+$/.test(internalId)) {
      // Continuation of previous multiline formula
      const last = formulas[formulas.length - 1];
      if (last && /s\s*\(|m0_|CASE/i.test(line)) {
        last.formulaRaw = [last.formulaRaw, line.trim()].filter((x) => x != null && x !== '').join('\n');
        continue;
      }
      unparsed += 1;
      continue;
    }

    if (formulaRaw != null) formulaRaw = formulaRaw.trim();
    // Empty or "0" is a valid formula value
    if (formulaRaw === '') formulaRaw = '';

    ordinal += 1;
    const recordHash = createHash('sha256')
      .update(`${internalId}|${title ?? ''}|${formulaRaw ?? ''}|${ordinal}`, 'utf8')
      .digest('hex')
      .slice(0, 16);

    const formulaId = `${snapshotId}:calc:${ordinal}`;
    const def: TetaPayrollCalculationFormulaDefinition = {
      snapshotId,
      formulaId,
      internalId,
      title,
      formulaTypeRaw,
      formulaRaw,
      sourceEvidence: {
        sectionCanonicalId: canonicalId,
        sourceLabel,
        recordOrdinal: ordinal,
        recordHash,
      },
    };
    formulas.push(def);

    const ast = parsePayrollFormula(formulaRaw);
    if (ast.status === 'malformed') parseFailures += 1;
    for (const call of ast.unknownCalls) unknownCalls.add(call);
    for (const code of ast.directComponentCodes) {
      componentReferences.push({
        snapshotId,
        calculationFormulaId: formulaId,
        componentCode: code,
        sourceFunction: formulaRaw?.includes(`s(${code})`) || formulaRaw?.includes(`s('${code}')`)
          ? 's'
          : 'm0',
        confidence: 'exact',
      });
    }
  }

  section.summary.recordCount = formulas.length;
  return {
    formulas,
    unparsed,
    parseFailures,
    componentReferences,
    missingComponentTargets: [...missingTargets],
    unknownCalls: [...unknownCalls].sort(),
  };
}

export function annotateMissingCalculationTargets(
  refs: TetaPayrollCalculationFormulaComponentReference[],
  knownComponentCodes: Set<string>,
): string[] {
  const missing = new Set<string>();
  for (const ref of refs) {
    if (!knownComponentCodes.has(ref.componentCode)) {
      missing.add(ref.componentCode);
    }
  }
  return [...missing].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
