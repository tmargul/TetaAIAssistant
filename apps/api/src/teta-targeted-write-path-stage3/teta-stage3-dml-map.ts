/**
 * DML → parameter-mapping extraction for Stage 3.
 *
 * Every mapping produced here is positional (INSERT column-list ↔ VALUES
 * list) or explicit (`SET col = expr`, `WHERE col = expr`,
 * `record.field := expr`). Name-similarity-only matching is never used —
 * there is no code path here that pairs a column to an expression solely
 * because their identifiers look alike.
 */
import {
  normalizeOracleName,
  preprocessSqlForStaticExtraction,
  splitQualifiedName,
} from '../teta-oracle-source-index-stage2/teta-stage2-parse';
import type {
  Stage3Confidence,
  Stage3ExpressionClassification,
  Stage3ParameterMapping,
  Stage3ParameterRole,
  Stage3Provenance,
  Stage3SignatureSource,
} from './teta-stage3.types';
import {
  mappingConfidenceForClassification,
  type Stage3ProgramUnitSignature,
} from './teta-stage3-signatures';

export type Stage3ExpressionClassificationResult = {
  classification: Stage3ExpressionClassification;
  sourceParam: string | null;
  sourceField: string | null;
  transformFunction: string | null;
  symbolName?: string | null;
};

/** Balanced-paren scan starting at text[openIdx] === '('. */
function scanBalancedParens(
  text: string,
  openIdx: number,
): { content: string; endIdx: number } | null {
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return { content: text.slice(openIdx + 1, i), endIdx: i };
    }
  }
  return null;
}

function findTopLevelChar(text: string, startIdx: number, char: string): number {
  let depth = 0;
  for (let i = startIdx; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0 && ch === char) return i;
  }
  return -1;
}

function findTopLevelWord(text: string, startIdx: number, word: string): number {
  const upper = text.toUpperCase();
  const wordUpper = word.toUpperCase();
  let depth = 0;
  for (let i = startIdx; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0 && upper.startsWith(wordUpper, i)) {
      const before = i === 0 ? ' ' : text[i - 1]!;
      const after = text[i + wordUpper.length] ?? ' ';
      if (!/[A-Za-z0-9_$#]/.test(before) && !/[A-Za-z0-9_$#]/.test(after)) return i;
    }
  }
  return -1;
}

function splitTopLevelList(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length) parts.push(cur.trim());
  return parts;
}

function splitTopLevelWord(text: string, word: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let idx = findTopLevelWord(text, start, word);
  while (idx >= 0) {
    parts.push(text.slice(start, idx));
    start = idx + word.length;
    idx = findTopLevelWord(text, start, word);
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Classifies a single value expression as a direct field/param reference,
 * a literal, a sequence pseudo-column, or a transformed expression. Never
 * consults the target column name — classification is purely a function of
 * the expression's own shape.
 */
export function classifyExpression(
  rawExpr: string,
  ctx: {
    parameterNames?: Set<string>;
    localSymbols?: Set<string>;
    packageName?: string | null;
  } = {},
): Stage3ExpressionClassificationResult {
  const expr = rawExpr.trim();
  const empty: Stage3ExpressionClassificationResult = {
    classification: 'unresolved',
    sourceParam: null,
    sourceField: null,
    transformFunction: null,
    symbolName: null,
  };
  if (!expr) return empty;
  if (/^NULL$/i.test(expr)) {
    return { classification: 'literal', sourceParam: null, sourceField: null, transformFunction: null, symbolName: null };
  }
  if (/^-?\d+(\.\d+)?$/.test(expr)) {
    return { classification: 'literal', sourceParam: null, sourceField: null, transformFunction: null, symbolName: null };
  }
  if (/^'[\s]*'$/.test(expr) || /^'.*'$/.test(expr)) {
    // masked or literal quoted content
    return { classification: 'literal', sourceParam: null, sourceField: null, transformFunction: null, symbolName: null };
  }
  const seqM = /^([A-Za-z_][\w$#]*(?:\.[A-Za-z_][\w$#]*)?)\.(NEXTVAL|CURRVAL)$/i.exec(expr);
  if (seqM) {
    return {
      classification: 'sequence',
      sourceParam: null,
      sourceField: null,
      transformFunction: `${normalizeOracleName(seqM[1]!)}.${seqM[2]!.toUpperCase()}`,
      symbolName: null,
    };
  }
  const bindM = /^:([A-Za-z_][\w$#]*|\d+)$/.exec(expr);
  if (bindM) {
    return {
      classification: 'direct_param',
      sourceParam: `:${bindM[1]}`,
      sourceField: null,
      transformFunction: null,
      symbolName: `:${bindM[1]}`,
    };
  }
  if (/^[A-Za-z_][\w$#]*$/.test(expr)) {
    const sym = normalizeOracleName(expr);
    if (ctx.parameterNames?.has(sym)) {
      return {
        classification: 'direct_param',
        sourceParam: sym,
        sourceField: null,
        transformFunction: null,
        symbolName: sym,
      };
    }
    if (ctx.localSymbols?.has(sym)) {
      return {
        classification: 'direct_local_symbol',
        sourceParam: null,
        sourceField: null,
        transformFunction: null,
        symbolName: sym,
      };
    }
    return {
      classification: 'unresolved_symbol',
      sourceParam: null,
      sourceField: null,
      transformFunction: null,
      symbolName: sym,
    };
  }
  const pkgSymM = /^([A-Za-z_][\w$#]*)\.([A-Za-z_][\w$#]*)$/.exec(expr);
  if (pkgSymM && ctx.packageName && normalizeOracleName(pkgSymM[1]!) === normalizeOracleName(ctx.packageName)) {
    return {
      classification: 'direct_package_symbol',
      sourceParam: null,
      sourceField: null,
      transformFunction: null,
      symbolName: normalizeOracleName(expr),
    };
  }
  const fieldM = /^([A-Za-z_][\w$#]*)\.([A-Za-z_][\w$#]*)$/.exec(expr);
  if (fieldM) {
    return {
      classification: 'direct_field',
      sourceParam: null,
      sourceField: normalizeOracleName(expr),
      transformFunction: null,
      symbolName: normalizeOracleName(expr),
    };
  }
  if (/CASE\b/i.test(expr)) {
    return { classification: 'transformed', sourceParam: null, sourceField: null, transformFunction: 'CASE', symbolName: null };
  }
  const fnM = /^([A-Za-z_][\w$#]*)\s*\(/.exec(expr);
  if (fnM) {
    return {
      classification: 'transformed',
      sourceParam: null,
      sourceField: null,
      transformFunction: normalizeOracleName(fnM[1]!),
      symbolName: null,
    };
  }
  if (/\|\||[+\-*/]/.test(expr)) {
    return { classification: 'transformed', sourceParam: null, sourceField: null, transformFunction: 'EXPRESSION', symbolName: null };
  }
  return empty;
}

/** RECORD.FIELD → the one-hop-resolved classification of its own `:=` assignment. */
export type RecordFieldChainMap = Map<string, Stage3ExpressionClassificationResult>;

function resolveWithRecordChain(
  expr: string,
  recordFieldMap: RecordFieldChainMap,
  ctx: { parameterNames?: Set<string>; localSymbols?: Set<string>; packageName?: string | null },
): Stage3ExpressionClassificationResult & { viaRecordChain: boolean } {
  const base = classifyExpression(expr, ctx);
  if (base.classification === 'direct_field' && base.sourceField) {
    const chained = recordFieldMap.get(base.sourceField);
    if (chained) return { ...chained, viaRecordChain: true };
  }
  return { ...base, viaRecordChain: false };
}

export function buildParameterMapping(input: {
  targetColumn: string;
  sourceExpression: string;
  role: Stage3ParameterRole;
  positional: boolean;
  recordFieldMap: RecordFieldChainMap;
  parameterNames?: Set<string>;
  localSymbols?: Set<string>;
  packageName?: string | null;
  programUnitId?: string | null;
  signature?: Stage3ProgramUnitSignature | null;
  signatureSource?: Stage3SignatureSource | null;
  programUnitResolution?: 'resolved' | 'unresolved';
  provenance: Stage3Provenance;
}): Stage3ParameterMapping {
  const resolved = resolveWithRecordChain(input.sourceExpression, input.recordFieldMap, {
    parameterNames: input.parameterNames,
    localSymbols: input.localSymbols,
    packageName: input.packageName,
  });
  const matchedArgumentName =
    resolved.classification === 'direct_param' && resolved.sourceParam
      ? resolved.sourceParam
      : null;
  const mappingConfidence = mappingConfidenceForClassification({
    classification: resolved.classification,
    signatureSource: input.signatureSource ?? null,
    viaRecordChain: resolved.viaRecordChain,
    programUnitResolution: input.programUnitResolution ?? 'resolved',
  });
  return {
    targetColumn: input.targetColumn,
    sourceExpression: input.sourceExpression,
    role: input.role,
    classification: resolved.classification,
    sourceParam: resolved.sourceParam,
    sourceField: resolved.sourceField,
    transformFunction: resolved.transformFunction,
    positional: input.positional,
    symbolName: resolved.symbolName ?? null,
    programUnitId: input.programUnitId ?? null,
    signatureSource: input.signatureSource ?? null,
    matchedArgumentName,
    subprogramId: input.signature?.subprogramId ?? null,
    overload: input.signature?.overload ?? null,
    mappingConfidence,
    provenance: {
      ...input.provenance,
      confidenceClass: mappingConfidence,
      normalizedValue: resolved.viaRecordChain
        ? `record_chain:${input.sourceExpression}->${resolved.sourceParam ?? resolved.sourceField ?? ''}`
        : input.provenance.normalizedValue ?? null,
    },
  };
}

export type Stage3InsertStatementMatch = {
  targetRaw: string;
  targetQualified: ReturnType<typeof splitQualifiedName>;
  columns: string[];
  valueExprs: string[];
  rawStatementExcerpt: string;
  matchIndex: number;
};

/** Extracts `INSERT INTO tbl (c1,c2,...) VALUES (e1,e2,...)` positional column↔value pairs. */
export function parseInsertColumnMappings(sql: string): Stage3InsertStatementMatch[] {
  const text = preprocessSqlForStaticExtraction(sql);
  const out: Stage3InsertStatementMatch[] = [];
  const headRe =
    /\bINSERT\s+INTO\s+((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = headRe.exec(text))) {
    const openIdx = m.index + m[0].length - 1;
    const cols = scanBalancedParens(text, openIdx);
    if (!cols) {
      headRe.lastIndex = openIdx + 1;
      continue;
    }
    const afterCols = text.slice(cols.endIdx + 1);
    const valuesM = /^\s*VALUES\s*\(/i.exec(afterCols);
    if (!valuesM) {
      headRe.lastIndex = cols.endIdx + 1;
      continue;
    }
    const valuesOpenIdx = cols.endIdx + 1 + valuesM[0].length - 1;
    const vals = scanBalancedParens(text, valuesOpenIdx);
    if (!vals) {
      headRe.lastIndex = cols.endIdx + 1;
      continue;
    }
    const columns = splitTopLevelList(cols.content).map((c) => normalizeOracleName(c));
    const valueExprs = splitTopLevelList(vals.content);
    out.push({
      targetRaw: m[1]!,
      targetQualified: splitQualifiedName(m[1]!),
      columns,
      valueExprs,
      rawStatementExcerpt: sql.slice(m.index, Math.min(sql.length, vals.endIdx + 1)).slice(0, 600),
      matchIndex: m.index,
    });
    headRe.lastIndex = vals.endIdx + 1;
  }
  return out;
}

export type Stage3UpdateStatementMatch = {
  targetRaw: string;
  targetQualified: ReturnType<typeof splitQualifiedName>;
  setMappings: Array<{ column: string; expr: string }>;
  whereClause: string | null;
  rawStatementExcerpt: string;
  matchIndex: number;
};

/** Extracts `UPDATE tbl SET col=expr, ...` explicit pairs and the WHERE clause (kept separate as row selector). */
export function parseUpdateSetMappings(sql: string): Stage3UpdateStatementMatch[] {
  const text = preprocessSqlForStaticExtraction(sql);
  const out: Stage3UpdateStatementMatch[] = [];
  const headRe =
    /\bUPDATE\s+((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)\s+SET\s+/gi;
  let m: RegExpExecArray | null;
  while ((m = headRe.exec(text))) {
    const setStart = m.index + m[0].length;
    const whereIdx = findTopLevelWord(text, setStart, 'WHERE');
    const semiIdx = findTopLevelChar(text, setStart, ';');
    // First top-level boundary wins. A WHERE in the next statement must not
    // be absorbed into the current UPDATE.
    const setEnd =
      semiIdx >= 0 && (whereIdx < 0 || semiIdx < whereIdx)
        ? semiIdx
        : whereIdx >= 0
          ? whereIdx
          : semiIdx >= 0
            ? semiIdx
            : text.length;
    const setClause = text.slice(setStart, setEnd);
    let whereClause: string | null = null;
    let statementEnd = setEnd;
    if (whereIdx >= 0 && (semiIdx < 0 || whereIdx < semiIdx)) {
      const whereStart = whereIdx + 5;
      const semiAfterWhere = findTopLevelChar(text, whereStart, ';');
      statementEnd = semiAfterWhere >= 0 ? semiAfterWhere : text.length;
      whereClause = text.slice(whereStart, statementEnd).trim();
    }
    const setMappings: Array<{ column: string; expr: string }> = [];
    for (const assignment of splitTopLevelList(setClause)) {
      const eq = findTopLevelChar(assignment, 0, '=');
      if (eq < 0) continue;
      const lhs = assignment.slice(0, eq).trim();
      const columnOnly = lhs.includes('.') ? lhs.split('.').pop()! : lhs;
      setMappings.push({
        column: normalizeOracleName(columnOnly),
        expr: assignment.slice(eq + 1).trim(),
      });
    }
    out.push({
      targetRaw: m[1]!,
      targetQualified: splitQualifiedName(m[1]!),
      setMappings,
      whereClause,
      rawStatementExcerpt: sql.slice(m.index, Math.min(sql.length, statementEnd)).slice(0, 600),
      matchIndex: m.index,
    });
    headRe.lastIndex = statementEnd;
  }
  return out;
}

export type Stage3DeleteStatementMatch = {
  targetRaw: string;
  targetQualified: ReturnType<typeof splitQualifiedName>;
  whereClause: string | null;
  rawStatementExcerpt: string;
  matchIndex: number;
};

/** Extracts `DELETE FROM tbl [WHERE ...]` — the WHERE clause is always a row selector, never a value source. */
export function parseDeleteSelectors(sql: string): Stage3DeleteStatementMatch[] {
  const text = preprocessSqlForStaticExtraction(sql);
  const out: Stage3DeleteStatementMatch[] = [];
  const headRe =
    /\bDELETE\s+FROM\s+((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)/gi;
  let m: RegExpExecArray | null;
  while ((m = headRe.exec(text))) {
    const afterHead = m.index + m[0].length;
    const whereM = /^\s*WHERE\s+/i.exec(text.slice(afterHead));
    let whereClause: string | null = null;
    let statementEnd = afterHead;
    if (whereM) {
      const whereStart = afterHead + whereM[0].length;
      const semiIdx = findTopLevelChar(text, whereStart, ';');
      statementEnd = semiIdx >= 0 ? semiIdx : text.length;
      whereClause = text.slice(whereStart, statementEnd).trim();
    }
    out.push({
      targetRaw: m[1]!,
      targetQualified: splitQualifiedName(m[1]!),
      whereClause,
      rawStatementExcerpt: sql.slice(m.index, Math.min(sql.length, statementEnd)).slice(0, 600),
      matchIndex: m.index,
    });
    headRe.lastIndex = statementEnd;
  }
  return out;
}

export type Stage3WhereSelector = { column: string | null; expr: string; raw: string };

/** Splits a WHERE clause into top-level AND conjuncts, extracting `col = expr` selectors when explicit. */
export function parseWhereSelectors(whereClause: string): Stage3WhereSelector[] {
  if (!whereClause || !whereClause.trim()) return [];
  const out: Stage3WhereSelector[] = [];
  for (const conjunct of splitTopLevelWord(whereClause, 'AND')) {
    const eq = findTopLevelChar(conjunct, 0, '=');
    if (eq >= 0) {
      const lhs = conjunct.slice(0, eq).trim();
      const rhs = conjunct.slice(eq + 1).trim();
      const isSimpleColumnRef = /^[A-Za-z_][\w$#]*(\.[A-Za-z_][\w$#]*)?$/.test(lhs);
      out.push({
        column: isSimpleColumnRef ? normalizeOracleName(lhs.split('.').pop()!) : null,
        expr: rhs,
        raw: conjunct.trim(),
      });
    } else {
      out.push({ column: null, expr: conjunct.trim(), raw: conjunct.trim() });
    }
  }
  return out;
}

export type Stage3RecordFieldAssignment = {
  targetRecord: string;
  targetField: string;
  sourceExpression: string;
  classification: Stage3ExpressionClassificationResult;
  matchIndex: number;
};

/**
 * Extracts PL/SQL record-field assignments (`r_x.field := p_y.field;` or
 * `r_x.field := p_param;`). These feed a one-hop resolution map so that a
 * later `INSERT ... VALUES (r_x.field, ...)` can resolve through the
 * assignment instead of remaining an opaque record-field reference.
 */
export function parseRecordFieldAssignments(
  sql: string,
  ctx: { parameterNames?: Set<string>; localSymbols?: Set<string>; packageName?: string | null } = {},
): Stage3RecordFieldAssignment[] {
  const text = preprocessSqlForStaticExtraction(sql);
  const out: Stage3RecordFieldAssignment[] = [];
  const re = /\b([A-Za-z_][\w$#]*)\.([A-Za-z_][\w$#]*)\s*:=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const rhs = m[3]!.trim();
    out.push({
      targetRecord: normalizeOracleName(m[1]!),
      targetField: normalizeOracleName(m[2]!),
      sourceExpression: rhs,
      classification: classifyExpression(rhs, ctx),
      matchIndex: m.index,
    });
  }
  return out;
}

/** Builds the RECORD.FIELD → resolved-classification chain map from record assignments. */
export function buildRecordFieldChainMap(
  assignments: Stage3RecordFieldAssignment[],
): RecordFieldChainMap {
  const map: RecordFieldChainMap = new Map();
  for (const a of assignments) {
    map.set(`${a.targetRecord}.${a.targetField}`, a.classification);
  }
  return map;
}
