import { createHash } from 'crypto';
import type {
  Stage2Confidence,
  Stage2Edge,
  Stage2EdgeKind,
  Stage2ObjectType,
  Stage2Provenance,
} from './teta-stage2.types';

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function normalizeOracleName(name: string): string {
  return name.replace(/["']/g, '').trim().toUpperCase();
}

export type QualifiedName = {
  owner: string | null;
  objectName: string;
  wasQualified: boolean;
};

/**
 * Splits `OWNER.NAME` / `NAME` references without inventing an owner.
 * Unqualified names come back with owner=null; callers must resolve the
 * effective owner against the source object's own owner (or reject/mark
 * unresolved) — see teta-stage2-resolve.ts.
 */
export function splitQualifiedName(raw: string): QualifiedName {
  const cleaned = normalizeOracleName(raw);
  if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    const owner = parts[0] || null;
    const objectName = parts.slice(1).join('.');
    return { owner, objectName, wasQualified: Boolean(owner) };
  }
  return { owner: null, objectName: cleaned, wasQualified: false };
}

export function stage2ObjectId(
  owner: string,
  objectType: Stage2ObjectType,
  objectName: string,
): string {
  // SPEC and BODY keep distinct source identities; linked via SPEC_BODY_OF.
  if (objectType === 'PACKAGE') {
    return `oracle-package:${normalizeOracleName(owner)}:${normalizeOracleName(objectName)}`;
  }
  if (objectType === 'PACKAGE_BODY') {
    return `oracle-package-body:${normalizeOracleName(owner)}:${normalizeOracleName(objectName)}`;
  }
  return `oracle-object:${normalizeOracleName(owner)}:${objectType}:${normalizeOracleName(objectName)}`;
}

/**
 * Distinct identity space for individual program units (procedures/functions,
 * standalone or package members), keyed by the ALL_ARGUMENTS overload/subprogram
 * axis so overloaded members do not collide.
 */
export function stage2ProgramUnitId(
  owner: string,
  packageName: string | null,
  objectName: string,
  overload?: number | null,
  subprogramId?: number | null,
): string {
  const o = normalizeOracleName(owner);
  const pkg = packageName ? normalizeOracleName(packageName) : '-';
  const name = normalizeOracleName(objectName);
  return `oracle-program-unit:${o}:${pkg}:${name}:o${overload ?? 0}:s${subprogramId ?? 0}`;
}

export function stage2EdgeId(
  edgeKind: Stage2EdgeKind,
  fromId: string,
  toId: string,
): string {
  const h = createHash('sha256')
    .update(`${edgeKind}|${fromId}|${toId}`)
    .digest('hex')
    .slice(0, 16);
  return `osi-s2-edge:${edgeKind}:${h}`;
}

export function mapStage2eEdge(edgeKind: Stage2EdgeKind): string {
  switch (edgeKind) {
    case 'READS_FROM':
      return 'READS_FROM';
    case 'WRITES_TO':
      return 'REFERENCES';
    case 'CALLS':
      return 'CALLS_PROCEDURE';
    case 'REFERENCES':
      return 'REFERENCES';
    case 'ATTACHED_TO':
      return 'DEPENDS_ON';
    case 'SPEC_BODY_OF':
      return 'REFERENCES';
    case 'JOINS_TO':
      return 'JOINS_TO';
    default:
      return 'DEPENDS_ON';
  }
}

export function makeEdge(input: {
  edgeKind: Stage2EdgeKind;
  fromId: string;
  toId: string;
  confidenceClass: Stage2Confidence;
  provenance: Stage2Provenance[];
  attributes?: Record<string, unknown>;
}): Stage2Edge {
  return {
    id: stage2EdgeId(input.edgeKind, input.fromId, input.toId),
    edgeKind: input.edgeKind,
    stage2eEdgeType: mapStage2eEdge(input.edgeKind),
    fromId: input.fromId,
    toId: input.toId,
    confidenceClass: input.confidenceClass,
    provenance: input.provenance,
    attributes: input.attributes,
  };
}

export function extensionToObjectType(ext: string): Stage2ObjectType {
  switch (ext.toUpperCase()) {
    case '.VEW':
    case '.VW':
    case '.VIEW':
      return 'VIEW';
    case '.PSK':
    case '.PKS':
    case '.SPC':
      return 'PACKAGE';
    case '.PBK':
    case '.PKB':
    case '.BDY':
      return 'PACKAGE_BODY';
    case '.TRG':
    case '.TRIG':
      return 'TRIGGER';
    case '.FNC':
    case '.FN':
      return 'FUNCTION';
    case '.PRC':
    case '.PR':
      return 'PROCEDURE';
    case '.TYP':
    case '.TPS':
      return 'TYPE';
    case '.TPB':
      return 'TYPE_BODY';
    case '.TAB':
    case '.TBL':
      return 'TABLE';
    default:
      return 'other_source_object';
  }
}

export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

const Q_QUOTE_CLOSERS: Record<string, string> = {
  '[': ']',
  '{': '}',
  '(': ')',
  '<': '>',
};

/**
 * Masks the *contents* of SQL/PLSQL string literals (regular '...' with ''
 * escapes, and Oracle q'[...]'/q'{...}'/q'(...)'/q'<...>' quoting) with
 * spaces while preserving exact string length/offsets. This prevents static
 * FROM/JOIN/DML/CALL regex extractors from matching keywords or identifiers
 * that only appear inside string literals or dynamic SQL text payloads.
 */
export function maskSqlStringLiterals(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i]!;
    if ((ch === 'q' || ch === 'Q') && sql[i + 1] === "'" && i + 2 < n) {
      const open = sql[i + 2]!;
      const close = Q_QUOTE_CLOSERS[open] ?? open;
      let j = i + 3;
      let found = -1;
      while (j < n) {
        if (sql[j] === close && sql[j + 1] === "'") {
          found = j;
          break;
        }
        j += 1;
      }
      if (found >= 0) {
        out += sql.slice(i, i + 3);
        out += ' '.repeat(found - (i + 3));
        out += sql.slice(found, found + 2);
        i = found + 2;
        continue;
      }
      // No closing delimiter found — leave untouched, fall through char-by-char.
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      out += "'";
      const contentLen = Math.max(0, Math.min(j, n) - (i + 1));
      out += ' '.repeat(contentLen);
      if (j < n) {
        out += "'";
        i = j + 1;
      } else {
        i = j;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Composed preprocessing for static extractors: mask string-literal contents
 * (so quoted text/dynamic SQL fragments never leak into static FROM/JOIN/DML
 * matches) then strip comments. detectDynamicBoundaries intentionally keeps
 * using stripSqlComments alone so EXECUTE IMMEDIATE payloads remain visible.
 */
export function preprocessSqlForStaticExtraction(sql: string): string {
  return stripSqlComments(maskSqlStringLiterals(sql));
}

export function parseSimpleJoinOn(onClause: string | null | undefined): Array<{
  leftAlias: string;
  leftColumn: string;
  rightAlias: string;
  rightColumn: string;
}> {
  if (!onClause) return [];
  const out: Array<{
    leftAlias: string;
    leftColumn: string;
    rightAlias: string;
    rightColumn: string;
  }> = [];
  for (const p of onClause.split(/\s+AND\s+/i)) {
    const m =
      /^\s*([A-Za-z_][\w$#]*)\.([A-Za-z_][\w$#]*)\s*=\s*([A-Za-z_][\w$#]*)\.([A-Za-z_][\w$#]*)\s*$/.exec(
        p.trim(),
      );
    if (!m) continue;
    out.push({
      leftAlias: m[1]!,
      leftColumn: m[2]!,
      rightAlias: m[3]!,
      rightColumn: m[4]!,
    });
  }
  return out;
}

export type ViewProjectionKind =
  | 'direct_column'
  | 'aliased_direct_column'
  | 'qualified_direct_column'
  | 'expression'
  | 'function_expression'
  | 'constant'
  | 'unresolved';

export type ViewProjectionFact = {
  viewOwner: string;
  viewName: string;
  viewColumn: string;
  projectionExpression: string;
  sourceAlias: string | null;
  sourceObject: string | null;
  sourceColumn: string | null;
  projectionKind: ViewProjectionKind;
  ordinal: number;
  /** Explicit SELECT alias when present (AS alias or implicit alias). */
  explicitAlias?: string | null;
  /** How the externally visible VIEW column name was resolved. */
  exposedColumnSource?:
    | 'oracle_metadata'
    | 'ddl_explicit_list'
    | 'select_alias'
    | 'ordinal_placeholder';
  projectionConfidence?: 'exact_static' | 'strong_static' | 'unresolved';
};

/** Authoritative Oracle VIEW surface column from ALL_TAB_COLUMNS (metadata-only). */
export type ViewExposedColumnMetadata = {
  owner: string;
  viewName: string;
  columnName: string;
  columnId: number;
  dataType?: string | null;
};

export type ViewProjectionAlignmentMetrics = {
  projectionOrdinalAlignmentsAttempted: number;
  projectionOrdinalAlignmentsExact: number;
  projectionOrdinalAlignmentsRejected: number;
  projectionCountMismatches: number;
  projectionAliasMetadataConflicts: number;
  exposedViewColumnFactsRecovered: number;
  ddlMetadataConflicts: string[];
};

const PROJECTION_EXPR_FUNCS =
  /\b(CAST|NVL|COALESCE|CASE|DECODE|SUBSTR|TRIM|TO_CHAR|TO_NUMBER|TO_DATE|TRUNC|ROUND|ABS|LENGTH|UPPER|LOWER|CONCAT|LTRIM|RTRIM|REPLACE|SIGN|MOD|GREATEST|LEAST)\s*\(/i;

function splitTopLevelCommaList(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseSelectItemAlias(item: string): { expression: string; outputAlias: string | null } {
  const trimmed = item.trim();
  const asMatch = /\s+AS\s+("([^"]+)"|[A-Za-z_][\w$#]*)\s*$/i.exec(trimmed);
  if (asMatch) {
    return {
      expression: trimmed.slice(0, asMatch.index).trim(),
      outputAlias: normalizeOracleName(asMatch[2] ?? asMatch[1]!),
    };
  }
  const implicit = /^(.+?)\s+("([^"]+)"|[A-Za-z_][\w$#]*)\s*$/i.exec(trimmed);
  if (implicit) {
    const expr = implicit[1]!.trim();
    const aliasToken = (implicit[3] ?? implicit[2]!).replace(/"/g, '');
    if (
      !/[\+\-\*\/]$/.test(expr) &&
      !/\)\s*$/.test(expr) &&
      !/^(SELECT|FROM|WHERE|AND|OR|NULL|DISTINCT|ALL)$/i.test(aliasToken) &&
      !PROJECTION_EXPR_FUNCS.test(expr)
    ) {
      return { expression: expr, outputAlias: normalizeOracleName(aliasToken) };
    }
  }
  return { expression: trimmed, outputAlias: null };
}

function parseDirectColumnRef(expr: string): {
  sourceAlias: string | null;
  sourceObject: string | null;
  sourceColumn: string;
  kind: ViewProjectionKind;
} | null {
  const e = expr.trim();
  const triple =
    /^((?:"[^"]+"|[A-Za-z_][\w$#]*)\.)((?:"[^"]+"|[A-Za-z_][\w$#]*)\.)((?:"[^"]+"|[A-Za-z_][\w$#]*))$/i.exec(
      e,
    );
  if (triple) {
    const owner = normalizeOracleName(triple[1]!.replace(/\.$/, ''));
    const objectName = normalizeOracleName(triple[2]!);
    return {
      sourceAlias: null,
      sourceObject: `${owner}.${objectName}`,
      sourceColumn: normalizeOracleName(triple[3]!),
      kind: 'qualified_direct_column',
    };
  }
  const pair =
    /^((?:"[^"]+"|[A-Za-z_][\w$#]*)\.)((?:"[^"]+"|[A-Za-z_][\w$#]*))$/i.exec(e);
  if (pair) {
    return {
      sourceAlias: normalizeOracleName(pair[1]!.replace(/\.$/, '')),
      sourceObject: null,
      sourceColumn: normalizeOracleName(pair[2]!),
      kind: 'direct_column',
    };
  }
  const bare = /^((?:"[^"]+"|[A-Za-z_][\w$#]*))$/i.exec(e);
  if (bare) {
    return {
      sourceAlias: null,
      sourceObject: null,
      sourceColumn: normalizeOracleName(bare[1]!),
      kind: 'direct_column',
    };
  }
  return null;
}

/** Parse CREATE VIEW (col_a, col_b, ...) explicit exposed-column list when present. */
export function parseCreateViewExplicitColumnList(sql: string): string[] | null {
  const text = preprocessSqlForStaticExtraction(sql);
  const createColList =
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FORCE\s+)?VIEW\s+(?:(?:"[^"]+"|[A-Za-z_][\w$#]*)\.)?(?:"[^"]+"|[A-Za-z_][\w$#]*)\s*\(\s*([^)]+)\s*\)\s+AS\b/i.exec(
      text,
    );
  if (!createColList) return null;
  return splitTopLevelCommaList(createColList[1]!).map((c) =>
    normalizeOracleName(c.replace(/"/g, '')),
  );
}

const DIRECT_PROJECTION_KINDS = new Set<ViewProjectionKind>([
  'direct_column',
  'aliased_direct_column',
  'qualified_direct_column',
]);

/**
 * Align parsed SELECT projections with authoritative VIEW surface columns (ordinal N ↔ N).
 * Oracle metadata is preferred over DDL text; conflicts are recorded, not silently resolved.
 */
export function alignViewProjectionsWithSurface(input: {
  viewOwner: string;
  viewName: string;
  projections: ViewProjectionFact[];
  exposedColumns: ViewExposedColumnMetadata[];
  declaredColumnsFromDdl?: string[] | null;
  unresolvedConstructs?: string[];
}): {
  projections: ViewProjectionFact[];
  projectionConfidence: 'exact_static' | 'strong_static' | 'unresolved';
  metrics: ViewProjectionAlignmentMetrics;
} {
  const owner = normalizeOracleName(input.viewOwner);
  const vName = normalizeOracleName(input.viewName);
  const metrics: ViewProjectionAlignmentMetrics = {
    projectionOrdinalAlignmentsAttempted: 0,
    projectionOrdinalAlignmentsExact: 0,
    projectionOrdinalAlignmentsRejected: 0,
    projectionCountMismatches: 0,
    projectionAliasMetadataConflicts: 0,
    exposedViewColumnFactsRecovered: 0,
    ddlMetadataConflicts: [],
  };

  const unresolved = input.unresolvedConstructs ?? [];
  const sortedMeta = [...input.exposedColumns]
    .filter((c) => normalizeOracleName(c.owner) === owner && normalizeOracleName(c.viewName) === vName)
    .sort((a, b) => a.columnId - b.columnId);

  if (!sortedMeta.length) {
    const out = input.projections.map((p) => ({
      ...p,
      projectionConfidence: 'unresolved' as const,
    }));
    return { projections: out, projectionConfidence: 'unresolved', metrics };
  }

  metrics.exposedViewColumnFactsRecovered = sortedMeta.length;
  metrics.projectionOrdinalAlignmentsAttempted = Math.max(
    sortedMeta.length,
    input.projections.length,
  );

  if (sortedMeta.length !== input.projections.length) {
    metrics.projectionCountMismatches += 1;
  }

  const ddlCols = input.declaredColumnsFromDdl ?? null;
  if (ddlCols?.length) {
    const len = Math.min(ddlCols.length, sortedMeta.length);
    for (let i = 0; i < len; i++) {
      if (ddlCols[i]!.toUpperCase() !== sortedMeta[i]!.columnName.toUpperCase()) {
        metrics.ddlMetadataConflicts.push(
          `ordinal_${i + 1}:ddl=${ddlCols[i]}:metadata=${sortedMeta[i]!.columnName}`,
        );
      }
    }
    if (ddlCols.length !== sortedMeta.length) {
      metrics.ddlMetadataConflicts.push(
        `count:ddl=${ddlCols.length}:metadata=${sortedMeta.length}`,
      );
    }
  }

  const hasStar = input.projections.some(
    (p) => p.projectionKind === 'unresolved' && (p.viewColumn === '*' || /\*/.test(p.projectionExpression)),
  );
  const blockingConstructs = unresolved.filter((u) =>
    ['UNION', 'SUBQUERY_IN_SELECT', 'SELECT_MISSING'].includes(u),
  );

  let exactEligible =
    sortedMeta.length > 0 &&
    sortedMeta.length === input.projections.length &&
    !hasStar &&
    blockingConstructs.length === 0 &&
    metrics.ddlMetadataConflicts.length === 0;

  const aligned: ViewProjectionFact[] = input.projections.map((p, i) => {
    const meta = sortedMeta[i];
    if (!meta) {
      metrics.projectionOrdinalAlignmentsRejected += 1;
      exactEligible = false;
      return { ...p, projectionConfidence: 'unresolved' as const };
    }

    const exposedName = normalizeOracleName(meta.columnName);
    let aliasConflict = false;
    if (p.explicitAlias && p.explicitAlias.toUpperCase() !== exposedName) {
      metrics.projectionAliasMetadataConflicts += 1;
      aliasConflict = true;
      exactEligible = false;
    }

    let projectionKind = p.projectionKind;
    if (
      p.sourceColumn &&
      DIRECT_PROJECTION_KINDS.has(p.projectionKind) &&
      exposedName !== p.sourceColumn.toUpperCase()
    ) {
      projectionKind = 'aliased_direct_column';
    }

    if (exactEligible && !aliasConflict) {
      metrics.projectionOrdinalAlignmentsExact += 1;
    } else {
      metrics.projectionOrdinalAlignmentsRejected += 1;
    }

    return {
      ...p,
      viewColumn: exposedName,
      projectionKind,
      explicitAlias: p.explicitAlias ?? null,
      exposedColumnSource: 'oracle_metadata' as const,
      projectionConfidence: exactEligible && !aliasConflict ? ('exact_static' as const) : aliasConflict || hasStar || blockingConstructs.length ? ('unresolved' as const) : ('strong_static' as const),
    };
  });

  const projectionConfidence: 'exact_static' | 'strong_static' | 'unresolved' = exactEligible
    ? metrics.projectionAliasMetadataConflicts === 0
      ? 'exact_static'
      : 'strong_static'
    : sortedMeta.length === input.projections.length && !hasStar && blockingConstructs.length === 0
      ? 'strong_static'
      : 'unresolved';

  for (const p of aligned) {
    if (projectionConfidence === 'exact_static') {
      p.projectionConfidence = 'exact_static';
    } else if (p.projectionConfidence === 'exact_static') {
      p.projectionConfidence = projectionConfidence;
    }
  }

  return { projections: aligned, projectionConfidence, metrics };
}

/**
 * Deterministic SELECT projection lineage for VIEW definitions.
 * Maps externally addressable VIEW.COLUMN → source alias/object/column when statically visible.
 * Exposed VIEW column names come from metadata alignment — never from base/source column identity alone.
 */
export function extractViewProjectionLineage(
  sql: string,
  viewOwner: string,
  viewName: string,
  aliasToObject?: Map<string, string>,
): {
  projections: ViewProjectionFact[];
  unresolvedConstructs: string[];
} {
  const text = preprocessSqlForStaticExtraction(sql);
  const unresolvedConstructs: string[] = [];
  const owner = normalizeOracleName(viewOwner);
  const vName = normalizeOracleName(viewName);

  const declaredColumns = parseCreateViewExplicitColumnList(sql);

  const selectMatch = /\bSELECT\b([\s\S]*?)\bFROM\b/i.exec(text);
  if (!selectMatch) {
    unresolvedConstructs.push('SELECT_MISSING');
    return { projections: [], unresolvedConstructs };
  }
  const selectBody = selectMatch[1] ?? '';
  if (/\bUNION\b/i.test(text)) unresolvedConstructs.push('UNION');
  if (/\(\s*SELECT\b/i.test(selectBody)) unresolvedConstructs.push('SUBQUERY_IN_SELECT');

  const items = splitTopLevelCommaList(selectBody);
  const projections: ViewProjectionFact[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const ordinal = i + 1;
    if (/^\*\s*$/.test(item) || /\.\*\s*$/.test(item)) {
      projections.push({
        viewOwner: owner,
        viewName: vName,
        viewColumn: declaredColumns?.[i] ?? '*',
        projectionExpression: item,
        sourceAlias: null,
        sourceObject: null,
        sourceColumn: null,
        projectionKind: 'unresolved',
        ordinal,
        explicitAlias: null,
        exposedColumnSource: declaredColumns?.[i] ? 'ddl_explicit_list' : 'ordinal_placeholder',
      });
      continue;
    }

    const { expression, outputAlias } = parseSelectItemAlias(item);
    let viewColumn = outputAlias ?? declaredColumns?.[i] ?? `COL_${ordinal}`;
    const exposedColumnSource: ViewProjectionFact['exposedColumnSource'] = outputAlias
      ? 'select_alias'
      : declaredColumns?.[i]
        ? 'ddl_explicit_list'
        : 'ordinal_placeholder';

    const trimmedExpr = expression.trim();
    if (
      /^'/.test(trimmedExpr) ||
      /^NULL$/i.test(trimmedExpr) ||
      /^\d+(\.\d+)?$/.test(trimmedExpr)
    ) {
      projections.push({
        viewOwner: owner,
        viewName: vName,
        viewColumn,
        projectionExpression: expression,
        sourceAlias: null,
        sourceObject: null,
        sourceColumn: null,
        projectionKind: 'constant',
        ordinal,
        explicitAlias: outputAlias,
        exposedColumnSource,
      });
      continue;
    }

    if (
      PROJECTION_EXPR_FUNCS.test(expression) ||
      /\bCASE\b/i.test(expression) ||
      /[\+\-\*\/\|\|]/.test(expression)
    ) {
      projections.push({
        viewOwner: owner,
        viewName: vName,
        viewColumn,
        projectionExpression: expression,
        sourceAlias: null,
        sourceObject: null,
        sourceColumn: null,
        projectionKind: PROJECTION_EXPR_FUNCS.test(expression)
          ? 'function_expression'
          : 'expression',
        ordinal,
        explicitAlias: outputAlias,
        exposedColumnSource,
      });
      continue;
    }

    const direct = parseDirectColumnRef(expression);
    if (!direct) {
      projections.push({
        viewOwner: owner,
        viewName: vName,
        viewColumn,
        projectionExpression: expression,
        sourceAlias: null,
        sourceObject: null,
        sourceColumn: null,
        projectionKind: 'unresolved',
        ordinal,
        explicitAlias: outputAlias,
        exposedColumnSource,
      });
      continue;
    }

    let sourceObject = direct.sourceObject;
    if (!sourceObject && direct.sourceAlias && aliasToObject) {
      sourceObject = aliasToObject.get(direct.sourceAlias.toUpperCase()) ?? null;
    }

    const kind: ViewProjectionKind =
      outputAlias && direct.sourceColumn.toUpperCase() !== viewColumn.toUpperCase()
        ? 'aliased_direct_column'
        : direct.kind;

    projections.push({
      viewOwner: owner,
      viewName: vName,
      viewColumn,
      projectionExpression: expression,
      sourceAlias: direct.sourceAlias,
      sourceObject,
      sourceColumn: direct.sourceColumn,
      projectionKind: kind,
      ordinal,
      explicitAlias: outputAlias,
      exposedColumnSource,
    });
  }

  return { projections, unresolvedConstructs };
}

/** Extract FROM / JOIN object references from view SQL (shallow). */
export function extractViewLineage(sql: string): {
  reads: Array<{ raw: string; qualified: QualifiedName; alias: string | null }>;
  joins: Array<{
    raw: string;
    qualified: QualifiedName;
    alias: string | null;
    joinType: string | null;
    onClause: string | null;
    parsedPairs: ReturnType<typeof parseSimpleJoinOn>;
    conditionStatus: 'resolved' | 'unresolved' | 'not_provided';
  }>;
  unresolvedConstructs: string[];
} {
  const text = preprocessSqlForStaticExtraction(sql);
  const unresolvedConstructs: string[] = [];
  if (/\bWITH\b/i.test(text)) unresolvedConstructs.push('CTE');
  if (/\bEXECUTE\s+IMMEDIATE\b/i.test(text)) unresolvedConstructs.push('EXECUTE_IMMEDIATE');

  const reads: Array<{ raw: string; qualified: QualifiedName; alias: string | null }> = [];
  const joins: Array<{
    raw: string;
    qualified: QualifiedName;
    alias: string | null;
    joinType: string | null;
    onClause: string | null;
    parsedPairs: ReturnType<typeof parseSimpleJoinOn>;
    conditionStatus: 'resolved' | 'unresolved' | 'not_provided';
  }> = [];

  // Oracle comma-style FROM: FROM a alias1, b alias2, c alias3
  const fromClause =
    /\bFROM\b([\s\S]*?)(?:\bWHERE\b|\bGROUP\b|\bORDER\b|\bUNION\b|\bCONNECT\b|$)/i.exec(text);
  if (fromClause) {
    const fromBody = fromClause[1] ?? '';
    // Split on commas that are not inside parentheses.
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of fromBody) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        parts.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || /\bJOIN\b/i.test(trimmed)) continue;
      const item =
        /^((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)\s*(?:(?:AS\s+)?([A-Za-z_][\w$#]*))?/i.exec(
          trimmed,
        );
      if (!item) continue;
      const q = splitQualifiedName(item[1]!);
      reads.push({
        raw: item[1]!,
        qualified: q,
        alias: item[2] ? normalizeOracleName(item[2]) : null,
      });
    }
  }

  // Fallback: single FROM object when comma parser found nothing
  if (reads.length === 0) {
    const fromRe =
      /\bFROM\s+((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)\s*(?:(?:AS\s+)?([A-Za-z_][\w$#]*))?/gi;
    let m: RegExpExecArray | null;
    while ((m = fromRe.exec(text))) {
      const q = splitQualifiedName(m[1]!);
      reads.push({
        raw: m[1]!,
        qualified: q,
        alias: m[2] ? normalizeOracleName(m[2]) : null,
      });
    }
  }

  const joinRe =
    /\b((?:INNER|LEFT|RIGHT|FULL|CROSS)\s+(?:OUTER\s+)?JOIN|JOIN)\s+((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)\s*(?:(?:AS\s+)?([A-Za-z_][\w$#]*))?\s*(?:ON\s+((?:(?!\b(?:INNER|LEFT|RIGHT|FULL|CROSS|JOIN|WHERE|GROUP|ORDER|UNION)\b).)+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = joinRe.exec(text))) {
    const q = splitQualifiedName(m[2]!);
    const onClause = m[4]?.trim() ?? null;
    const pairs = parseSimpleJoinOn(onClause);
    let conditionStatus: 'resolved' | 'unresolved' | 'not_provided' = 'not_provided';
    if (onClause) {
      conditionStatus = pairs.length ? 'resolved' : 'unresolved';
    }
    joins.push({
      raw: m[2]!,
      qualified: q,
      alias: m[3] ? normalizeOracleName(m[3]) : null,
      joinType: m[1]!.replace(/\s+/g, ' ').toUpperCase(),
      onClause,
      parsedPairs: pairs,
      conditionStatus,
    });
  }

  // Oracle comma-FROM equijoins live in WHERE (alias.col = alias.col).
  // Emit synthetic JOIN facts when multiple FROM objects exist and WHERE has exact pairs.
  if (reads.length >= 2) {
    const where = /\bWHERE\b([\s\S]*?)(?:\bGROUP\b|\bORDER\b|\bUNION\b|$)/i.exec(text);
    const whereClause = where?.[1] ?? '';
    const aliasToRaw = new Map<string, { raw: string; qualified: QualifiedName }>();
    for (const r of reads) {
      if (r.alias) aliasToRaw.set(r.alias.toUpperCase(), { raw: r.raw, qualified: r.qualified });
      aliasToRaw.set(r.qualified.objectName.toUpperCase(), {
        raw: r.raw,
        qualified: r.qualified,
      });
    }
    const eqRe =
      /([A-Za-z_][\w$#]*)\.([A-Za-z_][\w$#]*)\s*=\s*([A-Za-z_][\w$#]*)\.([A-Za-z_][\w$#]*)/g;
    let eq: RegExpExecArray | null;
    const emitted = new Set<string>();
    while ((eq = eqRe.exec(whereClause))) {
      const leftAlias = eq[1]!.toUpperCase();
      const rightAlias = eq[3]!.toUpperCase();
      const leftCol = eq[2]!.toUpperCase();
      const rightCol = eq[4]!.toUpperCase();
      if (leftAlias === rightAlias) continue;
      const left = aliasToRaw.get(leftAlias);
      const right = aliasToRaw.get(rightAlias);
      if (!left || !right) continue;
      const key = `${leftAlias}.${leftCol}=${rightAlias}.${rightCol}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      const onClause = `${leftAlias}.${leftCol} = ${rightAlias}.${rightCol}`;
      joins.push({
        raw: right.raw,
        qualified: right.qualified,
        alias: rightAlias === right.qualified.objectName.toUpperCase() ? null : rightAlias,
        joinType: 'WHERE_EQUIJOIN',
        onClause,
        parsedPairs: [
          {
            leftAlias,
            leftColumn: leftCol,
            rightAlias,
            rightColumn: rightCol,
          },
        ],
        conditionStatus: 'resolved',
      });
    }
  }

  return { reads, joins, unresolvedConstructs };
}

export function extractDmlTargets(sql: string): Array<{
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE' | 'SELECT';
  raw: string;
  qualified: QualifiedName;
}> {
  const text = preprocessSqlForStaticExtraction(sql);
  const out: Array<{
    operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE' | 'SELECT';
    raw: string;
    qualified: QualifiedName;
  }> = [];
  const patterns: Array<{
    op: 'INSERT' | 'UPDATE' | 'DELETE' | 'MERGE';
    re: RegExp;
  }> = [
    { op: 'INSERT', re: /\bINSERT\s+INTO\s+((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)/gi },
    { op: 'UPDATE', re: /\bUPDATE\s+((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)\s+SET\b/gi },
    { op: 'DELETE', re: /\bDELETE\s+FROM\s+((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)/gi },
    { op: 'MERGE', re: /\bMERGE\s+INTO\s+((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)/gi },
  ];
  for (const { op, re } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const q = splitQualifiedName(m[1]!);
      out.push({ operation: op, raw: m[1]!, qualified: q });
    }
  }
  // SELECT reads are extracted by extractProgramSqlReads (FROM/JOIN), not here.
  return out;
}

/**
 * Shallow static read targets inside PL/SQL / SQL program units.
 * Covers SELECT ... FROM / JOIN (including cursor and FOR-loop inline selects).
 */
export function extractProgramSqlReads(sql: string): Array<{
  raw: string;
  qualified: QualifiedName;
  via: 'FROM' | 'JOIN';
}> {
  const lineage = extractViewLineage(sql);
  const out: Array<{ raw: string; qualified: QualifiedName; via: 'FROM' | 'JOIN' }> = [];
  for (const r of lineage.reads) {
    out.push({ raw: r.raw, qualified: r.qualified, via: 'FROM' });
  }
  for (const j of lineage.joins) {
    out.push({ raw: j.raw, qualified: j.qualified, via: 'JOIN' });
  }
  return out;
}

/** Expected READS_FROM endpoint set for unseen view acceptance (FROM ∪ JOIN). */
export function expectedViewReadEndpointIds(
  sql: string,
  viewOwner: string,
): string[] {
  const lineage = extractViewLineage(sql);
  const ids = new Set<string>();
  for (const r of lineage.reads) {
    const owner = r.qualified.wasQualified ? r.qualified.owner! : viewOwner;
    ids.add(stage2ObjectId(owner, 'TABLE', r.qualified.objectName));
  }
  for (const j of lineage.joins) {
    const owner = j.qualified.wasQualified ? j.qualified.owner! : viewOwner;
    ids.add(stage2ObjectId(owner, 'TABLE', j.qualified.objectName));
  }
  return [...ids].sort();
}

export function extractDirectCalls(sql: string): Array<{
  raw: string;
  packageQualified: QualifiedName;
  member: string;
}> {
  const text = preprocessSqlForStaticExtraction(sql);
  const out: Array<{ raw: string; packageQualified: QualifiedName; member: string }> = [];
  const re =
    /\b((?:"[^"]+"|[A-Za-z_][\w$#]*)\.(?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const parts = m[1]!.replace(/"/g, '').split('.');
    if (parts.length === 2) {
      out.push({
        raw: m[1]!,
        packageQualified: {
          owner: null,
          objectName: normalizeOracleName(parts[0]!),
          wasQualified: false,
        },
        member: normalizeOracleName(parts[1]!),
      });
    } else if (parts.length >= 3) {
      out.push({
        raw: m[1]!,
        packageQualified: {
          owner: normalizeOracleName(parts[0]!),
          objectName: normalizeOracleName(parts[1]!),
          wasQualified: true,
        },
        member: normalizeOracleName(parts[2]!),
      });
    }
  }
  return out;
}

export function extractTriggerMeta(sql: string): {
  triggerName: string | null;
  target: QualifiedName | null;
  events: string[];
  timing: string | null;
} {
  const text = stripSqlComments(sql);
  const nameM = /\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)/i.exec(
    text,
  );
  const onM = /\bON\s+((?:"[^"]+"|[A-Za-z_][\w$#]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$#]*))?)/i.exec(
    text,
  );
  const timingM = /\b(BEFORE|AFTER|INSTEAD\s+OF)\b/i.exec(text);
  const events: string[] = [];
  if (/\bINSERT\b/i.test(text)) events.push('INSERT');
  if (/\bUPDATE\b/i.test(text)) events.push('UPDATE');
  if (/\bDELETE\b/i.test(text)) events.push('DELETE');
  return {
    triggerName: nameM ? normalizeOracleName(nameM[1]!.split('.').pop()!) : null,
    target: onM ? splitQualifiedName(onM[1]!) : null,
    events,
    timing: timingM ? timingM[1]!.replace(/\s+/g, ' ').toUpperCase() : null,
  };
}

/**
 * Parse trigger events strictly from ALL_TRIGGERS.TRIGGERING_EVENT (authoritative
 * when available), e.g. "INSERT OR UPDATE OR DELETE". Falls back to regex
 * scanning of the trigger body only when the caller has no metadata string.
 */
export function parseTriggerEventsFromMetadataString(triggeringEvent: string): string[] {
  const events = triggeringEvent
    .split(/\bOR\b/i)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(events)];
}

export function detectDynamicBoundaries(sql: string): Array<{
  boundaryType:
    | 'execute_immediate'
    | 'dbms_sql'
    | 'dynamic_concatenation'
    | 'scheduler_job_action'
    | 'unknown_dynamic';
  symbol: string;
}> {
  const text = stripSqlComments(sql);
  const out: Array<{
    boundaryType:
      | 'execute_immediate'
      | 'dbms_sql'
      | 'dynamic_concatenation'
      | 'scheduler_job_action'
      | 'unknown_dynamic';
    symbol: string;
  }> = [];
  if (/\bEXECUTE\s+IMMEDIATE\b/i.test(text)) {
    out.push({ boundaryType: 'execute_immediate', symbol: 'EXECUTE IMMEDIATE' });
  }
  if (/\bDBMS_SQL\b/i.test(text)) {
    out.push({ boundaryType: 'dbms_sql', symbol: 'DBMS_SQL' });
  }
  if (/job_action/i.test(text)) {
    out.push({ boundaryType: 'scheduler_job_action', symbol: 'job_action' });
  }
  if (/\|\|/.test(text) && /\b(EXECUTE\s+IMMEDIATE|OPEN\s+:)/i.test(text)) {
    out.push({ boundaryType: 'dynamic_concatenation', symbol: '|| concatenation' });
  }
  return out;
}

export function extractPackageUnitDecls(sql: string): Array<{
  kind: 'PROCEDURE' | 'FUNCTION';
  name: string;
  paramsRaw: string | null;
  startOffset: number;
}> {
  const text = preprocessSqlForStaticExtraction(sql);
  const out: Array<{
    kind: 'PROCEDURE' | 'FUNCTION';
    name: string;
    paramsRaw: string | null;
    startOffset: number;
  }> = [];
  const re = /\b(PROCEDURE|FUNCTION)\s+([A-Za-z_][\w$#]*)\s*(?:\(([^)]*)\))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({
      kind: m[1]!.toUpperCase() as 'PROCEDURE' | 'FUNCTION',
      name: normalizeOracleName(m[2]!),
      paramsRaw: m[3]?.trim() ?? null,
      startOffset: m.index,
    });
  }
  return out;
}

export function objectNameFromPath(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
  return normalizeOracleName(base.replace(/\.[^.]+$/, ''));
}
