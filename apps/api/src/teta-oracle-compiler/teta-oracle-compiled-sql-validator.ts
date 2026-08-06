/**
 * Stage 3E — post-compilation token validator.
 *
 * Deliberately independent of the compiler model: it re-reads the finished statement text and fails
 * on anything that is not a single, fully qualified, read-only SELECT. If the compiler ever regresses,
 * this catches it before the statement can be handed to a later stage.
 */
import type {
  CompiledSqlValidation,
  CompiledSqlValidationCheck,
} from './teta-oracle-compiler.types';

const STRUCTURAL_KEYWORDS = new Set([
  'SELECT',
  'FROM',
  'JOIN',
  'LEFT',
  'INNER',
  'ON',
  'AND',
  'OR',
  'NOT',
  'WHERE',
  'ORDER',
  'BY',
  'ASC',
  'DESC',
  'FETCH',
  'FIRST',
  'ROWS',
  'ONLY',
  'IS',
  'NULL',
  'AS',
  'EXISTS',
  'LIKE',
  'ESCAPE',
]);

const ALLOWED_FUNCTIONS = new Set(['TRUNC', 'ADD_MONTHS', 'SYSDATE', 'TO_DATE', 'UPPER']);

const FORBIDDEN_WORDS: Array<{ word: string; check: CompiledSqlValidationCheck; code: string }> = [
  { word: 'INSERT', check: 'no_dml_or_ddl', code: 'dml_forbidden' },
  { word: 'UPDATE', check: 'no_dml_or_ddl', code: 'dml_forbidden' },
  { word: 'DELETE', check: 'no_dml_or_ddl', code: 'dml_forbidden' },
  { word: 'MERGE', check: 'no_dml_or_ddl', code: 'dml_forbidden' },
  { word: 'TRUNCATE', check: 'no_dml_or_ddl', code: 'ddl_forbidden' },
  { word: 'CREATE', check: 'no_dml_or_ddl', code: 'ddl_forbidden' },
  { word: 'DROP', check: 'no_dml_or_ddl', code: 'ddl_forbidden' },
  { word: 'ALTER', check: 'no_dml_or_ddl', code: 'ddl_forbidden' },
  { word: 'GRANT', check: 'no_dml_or_ddl', code: 'ddl_forbidden' },
  { word: 'REVOKE', check: 'no_dml_or_ddl', code: 'ddl_forbidden' },
  { word: 'COMMIT', check: 'no_dml_or_ddl', code: 'transaction_control_forbidden' },
  { word: 'ROLLBACK', check: 'no_dml_or_ddl', code: 'transaction_control_forbidden' },
  { word: 'SAVEPOINT', check: 'no_dml_or_ddl', code: 'transaction_control_forbidden' },
  { word: 'BEGIN', check: 'no_plsql_block', code: 'plsql_forbidden' },
  { word: 'DECLARE', check: 'no_plsql_block', code: 'plsql_forbidden' },
  { word: 'EXECUTE', check: 'no_plsql_block', code: 'plsql_forbidden' },
  { word: 'CALL', check: 'no_plsql_block', code: 'plsql_forbidden' },
  { word: 'WITH', check: 'no_with_clause', code: 'with_clause_forbidden' },
  { word: 'UNION', check: 'no_set_operator', code: 'set_operator_forbidden' },
  { word: 'MINUS', check: 'no_set_operator', code: 'set_operator_forbidden' },
  { word: 'INTERSECT', check: 'no_set_operator', code: 'set_operator_forbidden' },
  { word: 'INTO', check: 'no_into_clause', code: 'into_clause_forbidden' },
];

const ALL_CHECKS: CompiledSqlValidationCheck[] = [
  'starts_with_select',
  'single_statement',
  'no_semicolon',
  'no_sql_comments',
  'no_optimizer_hints',
  'no_select_star',
  'no_dml_or_ddl',
  'no_plsql_block',
  'no_for_update',
  'no_with_clause',
  'no_db_link',
  'no_set_operator',
  'no_into_clause',
  'all_columns_qualified',
  'no_unbound_user_literals',
  'no_trailing_semicolon',
  'lf_newlines_only',
  'no_trailing_whitespace',
  'row_limit_present',
  'no_distinct',
  'controlled_exists_only',
  'no_in_subquery',
  'filter_only_aliases_confined_to_exists',
];

export type CompiledSqlValidationInput = {
  sqlText: string;
  sourceAliases: string[];
  resultAliases: string[];
  owners: string[];
  bindPlaceholders: string[];
  /** Aliases of filter-only sources; legal only inside a controlled EXISTS subquery. */
  existenceAliases?: string[];
  /** Literals the compiler is allowed to emit inline (Oracle date-format masks, not user data). */
  allowedInlineLiterals?: string[];
};

/** Oracle date-format masks / single-char LIKE escape — never user-supplied values. */
export const DEFAULT_ALLOWED_INLINE_LITERALS = ["'MM'", "'YYYY-MM-DD'", "'\\'"] as const;

type ExistsBlock = { start: number; end: number; text: string };

/** Locates `EXISTS ( … )` spans by paren matching so their contents can be checked separately. */
function extractExistsBlocks(masked: string): { blocks: ExistsBlock[]; unbalanced: boolean } {
  const blocks: ExistsBlock[] = [];
  const pattern = /\bEXISTS\s*\(/gi;
  let match = pattern.exec(masked);
  while (match) {
    let depth = 0;
    let index = match.index + match[0].length - 1;
    for (; index < masked.length; index += 1) {
      const char = masked[index];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) return { blocks, unbalanced: true };
    blocks.push({
      start: match.index,
      end: index + 1,
      text: masked.slice(match.index, index + 1),
    });
    pattern.lastIndex = index + 1;
    match = pattern.exec(masked);
  }
  return { blocks, unbalanced: false };
}

/**
 * The compiler emits one fixed EXISTS shape. Anything else — a projected subquery, an
 * uncorrelated EXISTS, a nested subquery, `SELECT *` — is rejected.
 */
const CONTROLLED_EXISTS_RE =
  /^EXISTS \( SELECT 1 FROM [A-Z0-9_$#]+\.[A-Z0-9_$#]+ [A-Z0-9_$#]+ WHERE .+ \)$/;

/**
 * Replaces single-quoted literals with `?` so keyword and identifier scanning cannot trip on text
 * inside literals. The original literals are returned separately for the inline-literal check.
 */
function maskStringLiterals(sql: string): { masked: string; literals: string[] } {
  const literals: string[] = [];
  const masked = sql.replace(/'(?:[^']|'')*'/g, (match) => {
    literals.push(match);
    return '?';
  });
  return { masked, literals };
}

export function validateCompiledSql(input: CompiledSqlValidationInput): CompiledSqlValidation {
  const checks = Object.fromEntries(ALL_CHECKS.map((c) => [c, true])) as Record<
    CompiledSqlValidationCheck,
    boolean
  >;
  const violations: Array<{ code: string; message: string }> = [];

  const fail = (check: CompiledSqlValidationCheck, code: string, message: string) => {
    checks[check] = false;
    violations.push({ code, message });
  };

  const sql = input.sqlText ?? '';
  const { masked, literals } = maskStringLiterals(sql);
  const upper = masked.toUpperCase();

  if (!/^SELECT\b/.test(sql)) {
    fail('starts_with_select', 'statement_must_start_with_select', 'Statement does not start with SELECT');
  }
  if (sql.includes(';')) {
    fail('no_semicolon', 'semicolon_forbidden', 'Statement contains a semicolon');
    fail('no_trailing_semicolon', 'trailing_semicolon_forbidden', 'Statement must not end with a semicolon');
  }
  if (masked.includes('--')) {
    fail('no_sql_comments', 'line_comment_forbidden', 'Statement contains a line comment');
  }
  if (masked.includes('/*') || masked.includes('*/')) {
    fail('no_sql_comments', 'block_comment_forbidden', 'Statement contains a block comment');
    if (masked.includes('/*+')) {
      fail('no_optimizer_hints', 'optimizer_hint_forbidden', 'Statement contains an optimizer hint');
    }
  }
  if (/(^|[\s(,])\*|\.\s*\*/.test(masked)) {
    fail('no_select_star', 'select_star_forbidden', 'Statement contains a wildcard column list');
  }
  if (masked.includes('@')) {
    fail('no_db_link', 'db_link_forbidden', 'Statement references a database link');
  }
  if (/\bFOR\s+UPDATE\b/.test(upper)) {
    fail('no_for_update', 'for_update_forbidden', 'Statement contains FOR UPDATE');
  }
  if (sql.includes('\r')) {
    fail('lf_newlines_only', 'crlf_forbidden', 'Statement must use LF newlines only');
  }
  if (sql.split('\n').some((line) => /\s$/.test(line))) {
    fail('no_trailing_whitespace', 'trailing_whitespace_forbidden', 'Statement has trailing whitespace');
  }
  if (!/\bFETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY$/.test(upper)) {
    fail('row_limit_present', 'row_limit_missing', 'Statement must end with FETCH FIRST n ROWS ONLY');
  }

  if (/\bDISTINCT\b/.test(upper)) {
    fail(
      'no_distinct',
      'distinct_forbidden',
      'Statement contains DISTINCT; row multiplication must be prevented by query structure, not deduplication',
    );
  }
  if (/\bIN\s*\(/.test(upper)) {
    fail('no_in_subquery', 'in_subquery_forbidden', 'Statement contains an IN (…) construct');
  }

  const rowSourceAliasSet = new Set(input.sourceAliases.map((a) => a.toUpperCase()));
  const existenceAliasSet = new Set((input.existenceAliases ?? []).map((a) => a.toUpperCase()));

  const { blocks: existsBlocks, unbalanced } = extractExistsBlocks(upper);
  if (unbalanced) {
    fail(
      'controlled_exists_only',
      'unbalanced_exists_parentheses',
      'Statement contains an EXISTS with unbalanced parentheses',
    );
  }

  for (const block of existsBlocks) {
    const normalized = block.text.replace(/\s+/g, ' ').trim();
    if (!CONTROLLED_EXISTS_RE.test(normalized)) {
      fail(
        'controlled_exists_only',
        'uncontrolled_exists_subquery',
        'EXISTS subquery does not match the compiler-produced SELECT 1 shape',
      );
      continue;
    }
    if ((normalized.match(/\bSELECT\b/g) ?? []).length !== 1) {
      fail(
        'controlled_exists_only',
        'nested_subquery_forbidden',
        'EXISTS subquery contains a nested SELECT',
      );
      continue;
    }
    const referencedExistenceAliases = [...existenceAliasSet].filter((alias) =>
      new RegExp(`\\b${alias}\\.`).test(normalized),
    );
    if (referencedExistenceAliases.length !== 1) {
      fail(
        'controlled_exists_only',
        'exists_subquery_alias_mismatch',
        'EXISTS subquery must reference exactly one filter-only alias',
      );
      continue;
    }
    const correlated = [...rowSourceAliasSet].some((alias) =>
      new RegExp(`\\b${alias}\\.`).test(normalized),
    );
    if (!correlated) {
      fail(
        'controlled_exists_only',
        'uncorrelated_exists_subquery',
        'EXISTS subquery is not correlated to any row-producing source alias',
      );
    }
  }

  // Everything outside the controlled EXISTS blocks must be a single plain SELECT that never
  // mentions a filter-only alias.
  let outsideExists = upper;
  for (const block of [...existsBlocks].reverse()) {
    outsideExists = `${outsideExists.slice(0, block.start)} ${outsideExists.slice(block.end)}`;
  }
  for (const alias of existenceAliasSet) {
    if (new RegExp(`\\b${alias}\\b`).test(outsideExists)) {
      fail(
        'filter_only_aliases_confined_to_exists',
        'filter_only_alias_outside_exists',
        `Filter-only alias ${alias} appears outside an EXISTS subquery`,
      );
    }
  }

  const outerSelectCount = (outsideExists.match(/\bSELECT\b/g) ?? []).length;
  if (outerSelectCount !== 1) {
    fail(
      'single_statement',
      'multiple_statements_forbidden',
      `Statement must contain exactly one top-level SELECT, found ${outerSelectCount}`,
    );
  }

  for (const { word, check, code } of FORBIDDEN_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(upper)) {
      fail(check, code, `Statement contains forbidden keyword ${word}`);
    }
  }

  const allowedLiterals = new Set(
    (input.allowedInlineLiterals ?? [...DEFAULT_ALLOWED_INLINE_LITERALS]).map((l) =>
      l.toUpperCase(),
    ),
  );
  for (const literal of literals) {
    if (!allowedLiterals.has(literal.toUpperCase())) {
      fail(
        'no_unbound_user_literals',
        'inline_literal_forbidden',
        `Statement contains inline literal ${literal}; user values must use bind variables`,
      );
    }
  }

  const sourceAliases = new Set([...rowSourceAliasSet, ...existenceAliasSet]);
  const resultAliases = new Set(input.resultAliases.map((a) => a.toUpperCase()));
  const owners = new Set(input.owners.map((o) => o.toUpperCase()));
  const bindNames = new Set(
    input.bindPlaceholders.map((p) => p.replace(/^:/, '').toUpperCase()),
  );

  const tokenPattern =
    /:[A-Za-z_$#][A-Za-z0-9_$#]*|[A-Za-z_$#][A-Za-z0-9_$#]*(?:\.[A-Za-z_$#][A-Za-z0-9_$#]*)?|\S/g;
  const tokens = masked.match(tokenPattern) ?? [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const previous = tokens[i - 1];

    if (token.startsWith(':')) {
      if (!bindNames.has(token.slice(1).toUpperCase())) {
        fail(
          'no_unbound_user_literals',
          'unknown_bind_variable',
          `Statement references undeclared bind ${token}`,
        );
      }
      continue;
    }
    if (!/^[A-Za-z_$#]/.test(token)) continue;

    const upperToken = token.toUpperCase();
    if (token.includes('.')) {
      const [qualifier] = upperToken.split('.');
      if (!sourceAliases.has(qualifier!) && !owners.has(qualifier!)) {
        fail(
          'all_columns_qualified',
          'unknown_qualifier',
          `Qualifier ${qualifier} in ${token} is neither a source alias nor an allowed owner`,
        );
      }
      continue;
    }
    if (STRUCTURAL_KEYWORDS.has(upperToken)) continue;
    if (ALLOWED_FUNCTIONS.has(upperToken)) continue;
    // Alias declaration: `OWNER.OBJECT ALIAS`
    if (sourceAliases.has(upperToken) && !!previous && previous.includes('.')) continue;
    // Result alias declaration: `expr AS ALIAS`
    if (resultAliases.has(upperToken) && previous?.toUpperCase() === 'AS') continue;

    fail(
      'all_columns_qualified',
      'unqualified_identifier',
      `Identifier ${token} is not qualified with a source alias`,
    );
  }

  return { ok: violations.length === 0, checks, violations };
}
