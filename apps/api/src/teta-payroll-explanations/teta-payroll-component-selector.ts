/**
 * Stage 3J — component selector (code/title, no auto-pad).
 */
import type {
  PayrollComponentCandidate,
  PayrollComponentSelectorConfidence,
  PayrollComponentSelectorType,
  TetaPayrollComponentSelector,
} from './teta-payroll-explanation.types';
import { STAGE3J_MAX_CANDIDATES, STAGE3J_MAX_CODE_LENGTH } from './teta-payroll-explanation.types';

export function normalizePayrollTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const CODE_EXTRACT_RE = /\b([A-Z0-9]{1,4})\b/gi;
const NUMERIC_CODE_RE = /\b(\d{1,4})\b/;

export function extractComponentCodeCandidate(raw: string): string | null {
  const quoted = /["']([A-Z0-9]{1,4})["']/i.exec(raw);
  if (quoted?.[1]) return quoted[1].toUpperCase();
  const afterKeyword =
    /sk[łl]adnik(?:u|iem|owi|a|ów)?\s+([A-Z0-9]{1,4})\b/i.exec(raw) ??
    /kod(?:u|em)?\s+([A-Z0-9]{1,4})\b/i.exec(raw);
  if (afterKeyword?.[1]) return afterKeyword[1].toUpperCase();
  const numeric = NUMERIC_CODE_RE.exec(raw);
  return numeric?.[1] ?? null;
}

export function extractTitleCandidate(raw: string): string | null {
  const quoted = /["']([^"']{2,80})["']/.exec(raw);
  if (quoted?.[1]) return quoted[1].trim();
  const afterKeyword = /sk[łl]adnik(?:u|iem|owi|a|ów)?\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż0-9][^?.!]{1,80})/i.exec(
    raw,
  );
  if (afterKeyword?.[1]) {
    return afterKeyword[1].trim().replace(/\s+(wzór|formuła|konfiguracja).*$/i, '').trim();
  }
  return null;
}

export function selectPayrollComponent(input: {
  rawValue: string;
  components: PayrollComponentCandidate[];
}): {
  selector: TetaPayrollComponentSelector;
  resolved: PayrollComponentCandidate | null;
  candidates: PayrollComponentCandidate[];
  ambiguous: boolean;
} {
  const raw = input.rawValue.trim();
  const codeCandidate = extractComponentCodeCandidate(raw);
  const titleCandidate = extractTitleCandidate(raw);
  const byCode = new Map(input.components.map((c) => [c.code, c]));
  const byExactTitle = new Map(
    input.components.filter((c) => c.title).map((c) => [c.title!.toUpperCase(), c]),
  );
  const byNormTitle = new Map<string, PayrollComponentCandidate[]>();

  for (const c of input.components) {
    if (!c.title) continue;
    const norm = normalizePayrollTitle(c.title);
    if (!byNormTitle.has(norm)) byNormTitle.set(norm, []);
    byNormTitle.get(norm)!.push(c);
  }

  if (codeCandidate && codeCandidate.length <= STAGE3J_MAX_CODE_LENGTH) {
    const exact = byCode.get(codeCandidate);
    if (exact) {
      return {
        selector: {
          selectorType: 'exact_code',
          rawValue: raw,
          normalizedValue: codeCandidate,
          confidence: 'exact',
        },
        resolved: exact,
        candidates: [],
        ambiguous: false,
      };
    }
    const padded = codeCandidate.padStart(4, '0');
    if (padded !== codeCandidate && byCode.has(padded)) {
      return {
        selector: {
          selectorType: 'candidate_list',
          rawValue: raw,
          normalizedValue: codeCandidate,
          confidence: 'unresolved',
          suggestedCode: padded,
        },
        resolved: null,
        candidates: [byCode.get(padded)!],
        ambiguous: false,
      };
    }
  }

  if (titleCandidate) {
    const exactTitle = byExactTitle.get(titleCandidate.toUpperCase());
    if (exactTitle) {
      return {
        selector: {
          selectorType: 'exact_title',
          rawValue: raw,
          normalizedValue: titleCandidate,
          confidence: 'exact',
        },
        resolved: exactTitle,
        candidates: [],
        ambiguous: false,
      };
    }
    const norm = normalizePayrollTitle(titleCandidate);
    const normMatches = byNormTitle.get(norm) ?? [];
    if (normMatches.length === 1) {
      return {
        selector: {
          selectorType: 'normalized_title',
          rawValue: raw,
          normalizedValue: norm,
          confidence: 'normalized_exact',
        },
        resolved: normMatches[0]!,
        candidates: [],
        ambiguous: false,
      };
    }
    if (normMatches.length > 1) {
      const candidates = normMatches
        .slice(0, STAGE3J_MAX_CANDIDATES)
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
      return {
        selector: {
          selectorType: 'candidate_list',
          rawValue: raw,
          normalizedValue: norm,
          confidence: 'ambiguous',
        },
        resolved: null,
        candidates,
        ambiguous: true,
      };
    }
  }

  const partialMatches: PayrollComponentCandidate[] = [];
  const searchNorm = normalizePayrollTitle(raw);
  if (searchNorm.length >= 3) {
    for (const c of input.components) {
      if (!c.title) continue;
      const norm = normalizePayrollTitle(c.title);
      if (norm.includes(searchNorm) || searchNorm.includes(norm)) {
        partialMatches.push(c);
      }
    }
  }
  if (partialMatches.length === 1) {
    return {
      selector: {
        selectorType: 'normalized_title',
        rawValue: raw,
        normalizedValue: searchNorm,
        confidence: 'normalized_exact',
      },
      resolved: partialMatches[0]!,
      candidates: [],
      ambiguous: false,
    };
  }
  if (partialMatches.length > 1) {
    const candidates = partialMatches
      .slice(0, STAGE3J_MAX_CANDIDATES)
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return {
      selector: {
        selectorType: 'candidate_list',
        rawValue: raw,
        normalizedValue: searchNorm,
        confidence: 'ambiguous',
      },
      resolved: null,
      candidates,
      ambiguous: true,
    };
  }

  let selectorType: PayrollComponentSelectorType = 'unresolved';
  let confidence: PayrollComponentSelectorConfidence = 'unresolved';
  if (codeCandidate) {
    selectorType = 'exact_code';
  } else if (titleCandidate) {
    selectorType = 'exact_title';
  }

  return {
    selector: {
      selectorType,
      rawValue: raw,
      normalizedValue: codeCandidate ?? titleCandidate ?? raw,
      confidence,
    },
    resolved: null,
    candidates: [],
    ambiguous: false,
  };
}

export function searchPayrollComponents(
  components: PayrollComponentCandidate[],
  query: string,
  limit = STAGE3J_MAX_CANDIDATES,
): PayrollComponentCandidate[] {
  const q = query.trim();
  if (!q) return [];
  const normQ = normalizePayrollTitle(q);
  const results: PayrollComponentCandidate[] = [];
  for (const c of components) {
    if (c.code.toUpperCase().includes(q.toUpperCase())) {
      results.push(c);
      continue;
    }
    if (c.title && normalizePayrollTitle(c.title).includes(normQ)) {
      results.push(c);
    }
  }
  return results
    .slice(0, limit)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/** Scan raw text for potential component codes (for tests / hints). */
export function scanPotentialCodes(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(CODE_EXTRACT_RE.source, CODE_EXTRACT_RE.flags);
  while ((m = re.exec(text))) {
    found.add(m[1]!.toUpperCase());
  }
  return [...found];
}
