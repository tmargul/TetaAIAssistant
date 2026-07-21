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

const IDENTITY_OR_SKIP_COLUMNS = new Set([
  ...EMPLOYEE_FILTER_COLUMNS,
  'ID',
  'IPRA_ID',
  'PRAC_ID',
]);

function bareTableName(table: string): string {
  const cleaned = table.replace(/"/g, '');
  return (cleaned.includes('.') ? cleaned.split('.').pop()! : cleaned).toUpperCase();
}

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

function scoreTargetObject(target: string): number {
  const upper = bareTableName(target);
  if (/IMP_SZKOL/.test(upper)) return 0;
  if (/^NT_KP_PRC_|^T_PRAC$/.test(upper)) return 3;
  if (/^NT_KP_SLO_|_SLO_/.test(upper)) return 4;
  if (/SZKOL|WYKSZT/.test(upper)) return 1;
  return 2;
}

function pickBestTarget(targets: Iterable<string>): string | null {
  const unique = [...new Set([...targets].map((item) => bareTableName(item)))];
  if (unique.length === 0) {
    return null;
  }
  unique.sort((a, b) => scoreTargetObject(a) - scoreTargetObject(b));
  return unique[0] ?? null;
}

function collectSelectListTargets(
  sql: string,
  mappings: TetaPluginColumnMapping[],
): Set<string> {
  const selectMatch = sql.match(/^\s*SELECT\s+([\s\S]+?)\s+FROM\b/i);
  const selectList = selectMatch?.[1] ?? '';
  const targets = new Set<string>();
  if (!selectList.trim() || selectList.trim() === '*') {
    return targets;
  }

  for (const mapping of mappings) {
    const target = mapping.targetObject?.trim().toUpperCase();
    if (!target) {
      continue;
    }
    const column = mapping.oracleColumnName.toUpperCase();
    if (IDENTITY_OR_SKIP_COLUMNS.has(column)) {
      continue;
    }
    if (new RegExp(`\\b${escapeRegExp(column)}\\b`, 'i').test(selectList)) {
      targets.add(target);
    }
  }

  return targets;
}

const SQL_KEYWORDS = new Set([
  'WHERE',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'FULL',
  'CROSS',
  'ON',
  'AND',
  'OR',
  'ORDER',
  'GROUP',
  'HAVING',
  'FETCH',
  'OFFSET',
  'UNION',
  'MINUS',
  'INTERSECT',
  'START',
  'CONNECT',
  'WITH',
  'AS',
  'SET',
  'INTO',
]);

/** SQL z joinami / aliasami tabel — już techniczny SELECT z szybkiej ścieżki. */
export function isTechnicallyQualifiedSql(sql: string): boolean {
  if (/\bJOIN\b/i.test(sql)) {
    return true;
  }
  // FROM owner.table alias  (np. FROM TETA_ADMIN.NT_KP_KDR_STANOWISKA k) — nie mylić z WHERE.
  const fromAlias = sql.match(/\bFROM\s+[A-Z0-9_."]+\s+([A-Z][A-Z0-9_]*)\b/i);
  if (fromAlias?.[1] && !SQL_KEYWORDS.has(fromAlias[1].toUpperCase())) {
    return true;
  }
  // Prefiksy aliasów kolumn: k.PRAC_ID, s.NAZWA (nie OWNER.TABLE w FROM — to ma kropkę w kwalifikacji tabeli)
  if (/(?<![A-Z0-9_])[A-Z]\.[A-Z][A-Z0-9_]*\b/i.test(sql)) {
    return true;
  }
  return false;
}

/**
 * LLM czasem wstawia etykiety UI (np. STAŻ) zamiast kolumn Oracle (LATA_STAZU)
 * albo SELECT LATA_STAZU z widoku pracowników — poprawia nazwy i FROM/IPRA_ID.
 */
export function rewriteSqlLabelsUsingPluginMappings(
  sql: string,
  mappings: TetaPluginColumnMapping[],
): string {
  if (!sql.trim() || mappings.length === 0) {
    return sql;
  }

  // Nie ruszaj SQL-a z joinami/aliasami — rewrite psujeł KDR (s.NAZWA AS STANOWISKO)
  // i powodował ORA-00904 / ucięte literały (ORA-01756) w fallbacku LLM.
  if (isTechnicallyQualifiedSql(sql)) {
    return sql;
  }

  const rewrites = buildLabelRewrites(mappings);
  if (rewrites.length === 0) {
    return sql;
  }

  const knownOracleColumns = new Set(
    mappings.map((mapping) => mapping.oracleColumnName.toUpperCase()),
  );

  let next = sql;
  const usedTargets = new Set<string>();

  for (const rewrite of rewrites) {
    for (const phrase of rewrite.phrases) {
      if (normalizeSearchText(phrase) === normalizeSearchText(rewrite.oracleColumnName)) {
        continue;
      }

      const pattern = new RegExp(
        `(^|[^\\p{L}\\p{N}_."])(?:"?)${escapeRegExp(phrase)}(?:"?)(?=[^\\p{L}\\p{N}_."]|$)`,
        'giu',
      );
      const before = next;
      next = next.replace(pattern, (match, prefix: string) => {
        const matchedToken = match.slice(prefix.length).replace(/^"|"$/g, '');
        const matchedUpper = matchedToken.toUpperCase();
        // Nie podmieniaj istniejącej kolumny Oracle (np. NAZWA) synonimem innej (ODRZ_ID←„Nazwa”).
        if (
          knownOracleColumns.has(matchedUpper) &&
          matchedUpper !== rewrite.oracleColumnName
        ) {
          return match;
        }
        // Token już wygląda jak identyfikator Oracle (NAZWA, SSTN_ID) — nie zamieniaj etykietą UI.
        if (
          /^[A-Z][A-Z0-9_]*$/.test(matchedUpper) &&
          matchedUpper !== rewrite.oracleColumnName
        ) {
          return match;
        }
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

  for (const target of collectSelectListTargets(next, mappings)) {
    usedTargets.add(target);
  }

  const selectMatch = next.match(/^\s*SELECT\s+([\s\S]+?)\s+FROM\b/i);
  const selectList = selectMatch?.[1] ?? '';
  const selectHasEmployeeIdentity = [...EMPLOYEE_FILTER_COLUMNS].some((column) =>
    new RegExp(`\\b${column}\\b`, 'i').test(selectList),
  );

  // Nie przenoś FROM, gdy filtr pracownika jest już mostkiem IPRA_ID/PRAC_ID IN (…).
  if (/\b(?:IPRA_ID|PRAC_ID)\s+IN\s*\(/i.test(next)) {
    return next;
  }

  const bestTarget = selectHasEmployeeIdentity ? null : pickBestTarget(usedTargets);
  if (bestTarget) {
    next = retargetFromAndEmployeeFilter(next, bestTarget);
  }

  return next;
}

function retargetFromAndEmployeeFilter(sql: string, targetObject: string): string {
  const fromMatch = sql.match(/\bFROM\s+([A-Z0-9_."]+)/i);
  if (!fromMatch?.[1]) {
    return sql;
  }

  const current = fromMatch[1].replace(/"/g, '');
  const currentBare = bareTableName(current);
  const targetBare = bareTableName(targetObject);
  if (currentBare === targetBare) {
    return sql;
  }

  const owner = current.includes('.') ? current.split('.')[0]! : 'TETA_ADMIN';
  const qualifiedTarget = targetObject.includes('.')
    ? targetObject
    : `${owner}.${targetBare}`;
  const employeeTable = current.includes('.') ? current : `${owner}.${current}`;

  const whereMatch = sql.match(/\bWHERE\s+([\s\S]+?)(?=\s+FETCH\b|\s+ORDER\b|\s+GROUP\b|$)/i);
  const whereClause = whereMatch?.[1]?.trim();
  if (!whereClause) {
    return sql.replace(/\bFROM\s+[A-Z0-9_."]+/i, `FROM ${qualifiedTarget}`);
  }

  // Już jest mostek IPRA_ID/PRAC_ID — nie zmieniaj FROM (szybka ścieżka wybrała właściwy widok).
  if (/\b(?:IPRA_ID|PRAC_ID)\s+IN\s*\(/i.test(whereClause)) {
    return sql;
  }

  if (whereUsesEmployeeIdentityColumn(whereClause)) {
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
    message.match(/Kolumny\s+([^\s][^.]+?)\s+nie występują/i) ??
    message.match(/pola\s+[„"]([^”"]+)[”"]/i) ??
    message.match(/ORA-01756/i);
  const column = columnMatch?.[1]?.replace(/,/g, '').trim();

  if (/ORA-01756/i.test(message)) {
    return (
      'Nie udało się wykonać zapytania — błąd składni SQL (niezamknięty napis). ' +
      'Spróbuj ponowić pytanie albo uprościć nazwisko / filtr.'
    );
  }

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
