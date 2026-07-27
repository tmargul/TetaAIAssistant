/**
 * Stage 3I — deterministic payroll formula tokenizer/parser (no execution).
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import type { TetaPayrollFormulaAst } from './teta-payroll-snapshot.types';
import { STAGE3I_FORMULA_LANGUAGE_VERSION } from './teta-payroll-snapshot.types';

export type FormulaLanguageConfig = {
  contractVersion: string;
  componentCurrentListPatterns: string[];
  knownFunctions: Array<{
    name: string;
    class:
      | 'component_current_list_reference'
      | 'component_previous_list_reference'
      | 'component_historical_reference'
      | 'payroll_hint'
      | 'payroll_function'
      | 'sql_formula_reference'
      | 'work_card_reference'
      | 'absence_reference'
      | 'package_context_reference'
      | 'unknown_function';
    componentArgIndexes?: number[];
  }>;
};

let cachedLanguage: FormulaLanguageConfig | null = null;

export function loadFormulaLanguageConfig(apiRoot?: string): FormulaLanguageConfig {
  if (cachedLanguage) return cachedLanguage;
  const root =
    apiRoot ??
    (existsSync(path.join(process.cwd(), 'config', 'teta-payroll-formula-language-v1.json'))
      ? process.cwd()
      : path.join(process.cwd(), 'apps', 'api'));
  const filePath = path.join(root, 'config', 'teta-payroll-formula-language-v1.json');
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as FormulaLanguageConfig;
  if (raw.contractVersion !== STAGE3I_FORMULA_LANGUAGE_VERSION) {
    throw new Error(`Unexpected formula language version ${raw.contractVersion}`);
  }
  cachedLanguage = raw;
  return raw;
}

export function resetFormulaLanguageCache(): void {
  cachedLanguage = null;
}

export function tokenizePayrollFormula(raw: string): string[] {
  const tokens: string[] = [];
  const src = raw.replace(/\r/g, '');
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ('()+-*/,=<>!'.includes(ch)) {
      if ((ch === '<' || ch === '>' || ch === '!' || ch === '=') && src[i + 1] === '=') {
        tokens.push(ch + '=');
        i += 2;
        continue;
      }
      tokens.push(ch);
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) j += 1;
      tokens.push(src.slice(i, Math.min(j + 1, src.length)));
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < src.length && !/\s|[()+\-*/,=<>!]/.test(src[j]!)) j += 1;
    tokens.push(src.slice(i, j));
    i = j;
  }
  return tokens;
}

export function parsePayrollFormula(
  raw: string | null | undefined,
  language?: FormulaLanguageConfig,
): TetaPayrollFormulaAst {
  if (raw == null || !raw.trim()) {
    return {
      status: 'parsed',
      raw: raw ?? '',
      tokens: [],
      directComponentCodes: [],
      unknownCalls: [],
      diagnostics: [],
    };
  }
  const lang = language ?? loadFormulaLanguageConfig();
  const tokens = tokenizePayrollFormula(raw);
  const direct = new Set<string>();
  const unknownCalls: string[] = [];
  const diagnostics: string[] = [];

  const m0 = /m0_(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = m0.exec(raw))) {
    direct.add(match[1]!);
  }

  const sRef = /\bs\s*\(\s*['"]?(\d+)['"]?\s*\)/gi;
  while ((match = sRef.exec(raw))) {
    direct.add(match[1]!);
  }

  // Context table references may embed component codes as string/number args — mark probable later.
  if (/p_oblicz\.tab_l_skl_obl_war\s*\(/i.test(raw)) {
    diagnostics.push('package_context_reference:p_oblicz.tab_l_skl_obl_war');
  }
  if (/wartosc_formuly_sql\s*\(/i.test(raw)) {
    diagnostics.push('sql_formula_reference:wartosc_formuly_sql');
  }

  const callNames = raw.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\s*\(/g) ?? [];
  const known = new Set(lang.knownFunctions.map((f) => f.name.toLowerCase()));
  for (const call of callNames) {
    const name = call.replace(/\s*\($/, '').toLowerCase();
    if (name === 'case' || name === 'when' || name === 'then' || name === 'else' || name === 'end') {
      continue;
    }
    if (!known.has(name) && !name.startsWith('m0_')) {
      unknownCalls.push(name);
    }
  }

  let status: TetaPayrollFormulaAst['status'] = 'parsed';
  if (unknownCalls.length) status = 'parsed_with_unknown_tokens';
  if (/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F\u0100-\u017F]/.test(raw) && tokens.length === 0) {
    status = 'malformed';
    diagnostics.push('untokenizable');
  }

  return {
    status,
    raw,
    tokens,
    directComponentCodes: [...direct].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    unknownCalls: [...new Set(unknownCalls)].sort(),
    diagnostics,
  };
}
