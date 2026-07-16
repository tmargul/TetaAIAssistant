import type { TetaPluginColumnMapping } from './teta-plugin-column-mapping';
import { normalizeSearchText } from './teta-plugin-grid-column-mapper';

type LabelRewrite = {
  oracleColumnName: string;
  targetObject: string | null;
  phrases: string[];
};

const EMPLOYEE_FILTER_COLUMNS = new Set([
  'NR_EWD',
  'NR_EWIDENCYJNY',
  'IMIE',
  'NAZWISKO',
  'PESEL',
]);

function buildLabelRewrites(mappings: TetaPluginColumnMapping[]): LabelRewrite[] {
  const byOracle = new Map<string, LabelRewrite>();

  for (const mapping of mappings) {
    const oracleColumnName = mapping.oracleColumnName.toUpperCase();
    const existing = byOracle.get(oracleColumnName) ?? {
      oracleColumnName,
      targetObject: mapping.targetObject?.trim().toUpperCase() ?? null,
      phrases: [],
    };

    const phrases = [mapping.label, ...(mapping.synonyms ?? [])]
      .map((phrase) => phrase?.trim())
      .filter((phrase): phrase is string => Boolean(phrase) && phrase.length >= 3);

    for (const phrase of phrases) {
      existing.phrases.push(phrase, phrase.toUpperCase(), normalizeSearchText(phrase));
    }
    if (!existing.targetObject && mapping.targetObject?.trim()) {
      existing.targetObject = mapping.targetObject.trim().toUpperCase();
    }
    byOracle.set(oracleColumnName, existing);
  }

  return [...byOracle.values()].map((item) => ({
    ...item,
    phrases: [...new Set(item.phrases.map((phrase) => phrase.trim()).filter(Boolean))],
  }));
}

/**
 * LLM czasem wstawia etykiety UI (np. STAŻ) zamiast kolumn Oracle (LATA_STAZU).
 * Przepisuje identyfikatory w SQL wg mapowań wtyczki i ewentualnie poprawia FROM / filtr IPRA_ID.
 */
export function rewriteSqlLabelsUsingPluginMappings(
  sql: string,
  mappings: TetaPluginColumnMapping[],
): string {
  if (!sql.trim() || mappings.length === 0) {
    return sql;
  }

  const rewrites = buildLabelRewrites(mappings);
  if (rewrites.length === 0) {
    return sql;
  }

  let next = sql;
  const usedTargets = new Set<string>();

  for (const rewrite of rewrites) {
    for (const phrase of rewrite.phrases) {
      if (normalizeSearchText(phrase) === normalizeSearchText(rewrite.oracleColumnName)) {
        continue;
      }

      const pattern = new RegExp(
        `(^|[^\\p{L}\\p{N}_"])(?:"?)${escapeRegExp(phrase)}(?:"?)(?=[^\\p{L}\\p{N}_"]|$)`,
        'giu',
      );
      const before = next;
      next = next.replace(pattern, (_match, prefix: string) => {
        if (rewrite.targetObject) {
          usedTargets.add(rewrite.targetObject);
        }
        return `${prefix}${rewrite.oracleColumnName}`;
      });
      if (next !== before && rewrite.targetObject) {
        usedTargets.add(rewrite.targetObject);
      }
    }
  }

  if (usedTargets.size === 1) {
    next = retargetFromAndEmployeeFilter(next, [...usedTargets][0]!);
  }

  return next;
}

function retargetFromAndEmployeeFilter(sql: string, targetObject: string): string {
  const fromMatch = sql.match(/\bFROM\s+([A-Z0-9_."]+)/i);
  if (!fromMatch?.[1]) {
    return sql;
  }

  const current = fromMatch[1].replace(/"/g, '');
  const currentBare = (current.includes('.') ? current.split('.').pop()! : current).toUpperCase();
  const targetBare = (
    targetObject.includes('.') ? targetObject.split('.').pop()! : targetObject
  ).toUpperCase();
  if (currentBare === targetBare) {
    return sql;
  }

  const owner = current.includes('.') ? current.split('.')[0]! : 'TETA_ADMIN';
  const qualifiedTarget = targetObject.includes('.') ? targetObject : `${owner}.${targetObject}`;
  const employeeTable = current.includes('.') ? current : `${owner}.${current}`;

  const whereMatch = sql.match(/\bWHERE\s+([\s\S]+?)(?=\s+FETCH\b|\s+ORDER\b|\s+GROUP\b|$)/i);
  const whereClause = whereMatch?.[1]?.trim();
  if (whereClause && whereUsesEmployeeIdentityColumn(whereClause)) {
    const selectMatch = sql.match(/^\s*SELECT\s+([\s\S]+?)\s+FROM\b/i);
    const selectList = selectMatch?.[1]?.trim() ?? '*';
    const fetchMatch = sql.match(/\bFETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY\b/i)?.[0] ?? '';
    return (
      `SELECT ${selectList} FROM ${qualifiedTarget} ` +
      `WHERE IPRA_ID IN (SELECT ID FROM ${employeeTable} WHERE ${whereClause})` +
      (fetchMatch ? ` ${fetchMatch}` : '')
    );
  }

  return sql.replace(/\bFROM\s+[A-Z0-9_."]+/i, `FROM ${qualifiedTarget}`);
}

function whereUsesEmployeeIdentityColumn(whereClause: string): boolean {
  const upper = whereClause.toUpperCase();
  return [...EMPLOYEE_FILTER_COLUMNS].some((column) => new RegExp(`\\b${column}\\b`).test(upper));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Komunikat dla użytkownika — bez narzędzi wewnętrznych (describe_table). */
export function formatUserFacingSqlColumnError(message: string): string {
  const columnMatch =
    message.match(/Kolumna\s+"?([^\s"]+)"?/i) ??
    message.match(/Kolumny\s+([^\s][^.]+?)\s+nie występują/i);
  const column = columnMatch?.[1]?.replace(/,/g, '').trim();

  if (column) {
    return (
      `Nie udało się odczytać pola „${column}” — w bazie nie ma takiej kolumny pod tą nazwą. ` +
      'Spróbuj inaczej nazwać pole albo wskaż pracownika (nr ewidencyjny / imię i nazwisko).'
    );
  }

  if (/nie istnieje w bazie|nie występują w metadanych|ORA-00904/i.test(message)) {
    return (
      'Nie udało się wykonać zapytania — użyta nazwa pola nie występuje w bazie. ' +
      'Doprecyzuj pytanie albo wskaż konkretnego pracownika.'
    );
  }

  return message;
}
