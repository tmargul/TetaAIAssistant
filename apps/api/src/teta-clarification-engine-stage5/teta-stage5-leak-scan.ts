/**
 * User-facing leak scanner — blocks Oracle/physical tokens in clarification UI.
 */
import type { ClarificationChoice, ClarificationQuestion, Stage5Audit } from './teta-stage5.types';

const TECHNICAL_PATTERNS: RegExp[] = [
  /\bTETA_ADMIN\b/i,
  /\bNT_[A-Z0-9_]+\b/,
  /\bL_[A-Z0-9_]+\b/,
  /\bT_[A-Z0-9_]+\b/,
  /\bSL_[A-Z0-9_]+\b/,
  /\b[A-Z][A-Z0-9_]*_ID\b/,
  /\bOracle\b/i,
  /\bVIEW\b/,
  /\bTABLE\b/,
  /\bCOLUMN\b/i,
  /\bJOIN\b/,
  /\bFK\b/,
  /\bPACKAGE\b/i,
  /\bPROCEDURE\b/i,
  /\bSELECT\b/,
  /\bFROM\b/,
  /\boracle-object:/i,
  /\bvendor\s*source/i,
  /\bALL_VIEWS\b/i,
  /\bALL_TAB_COLUMNS\b/i,
];

export type LeakScanResult = {
  scannedTexts: string[];
  leaks: Array<{ text: string; pattern: string }>;
  technicalTokensScanned: number;
  technicalTokensLeaked: number;
};

export function scanTextForTechnicalLeak(
  text: string,
  allowedApplicationLabels: string[] = [],
): Array<{ text: string; pattern: string }> {
  const allowed = new Set(allowedApplicationLabels.map((l) => l.trim().toLowerCase()).filter(Boolean));
  if (allowed.has(text.trim().toLowerCase())) return [];
  const leaks: Array<{ text: string; pattern: string }> = [];
  for (const re of TECHNICAL_PATTERNS) {
    if (re.test(text)) {
      // Allow if the entire token is an independently proven application label
      const match = text.match(re);
      if (match && allowed.has(match[0]!.toLowerCase())) continue;
      leaks.push({ text, pattern: String(re) });
    }
  }
  return leaks;
}

export function scanUserFacingClarificationLeak(input: {
  question: ClarificationQuestion | null;
  choices: ClarificationChoice[];
  allowedApplicationLabels?: string[];
  audit: Stage5Audit;
}): LeakScanResult {
  const texts: string[] = [];
  if (input.question) texts.push(input.question.question);
  for (const c of input.choices) texts.push(c.label);
  const leaks: Array<{ text: string; pattern: string }> = [];
  for (const t of texts) {
    leaks.push(...scanTextForTechnicalLeak(t, input.allowedApplicationLabels ?? []));
  }
  const result: LeakScanResult = {
    scannedTexts: texts,
    leaks,
    technicalTokensScanned: texts.length,
    technicalTokensLeaked: leaks.length,
  };
  input.audit.technicalTokensLeakedToUserFacingClarification += leaks.length;
  return result;
}

/** Reject answer payloads that try to inject physical Oracle mappings. */
export function detectPhysicalMappingInjection(payload: unknown): string[] {
  const errors: string[] = [];
  const raw = JSON.stringify(payload ?? {});
  const forbidden = [
    /oracleObject/i,
    /objectRef/i,
    /fromColumn/i,
    /toColumn/i,
    /joinClause/i,
    /TETA_ADMIN\./i,
    /NT_KP_/i,
    /physicalMapping/i,
    /goldenPhysical/i,
  ];
  for (const re of forbidden) {
    if (re.test(raw)) errors.push(`physical_mapping_injection:${re}`);
  }
  return errors;
}
