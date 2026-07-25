/**
 * Stage 3E — SELECT text rendering.
 *
 * Layout is fixed: LF newlines, two-space indent, no trailing whitespace, no trailing semicolon.
 * The same compiled model always renders byte-identical SQL.
 */
import { createHash } from 'crypto';
import type {
  CompiledJoinTree,
  CompiledOrdering,
  CompiledPredicate,
  CompiledProjection,
} from './teta-oracle-compiler.types';

export const STAGE3E_NEWLINE = '\n';
export const STAGE3E_INDENT = '  ';

export type RenderedSelect = {
  sqlText: string;
  sqlSha256: string;
  lineCount: number;
};

export function sha256Utf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function renderSelect(input: {
  projections: CompiledProjection[];
  joinTree: CompiledJoinTree;
  predicates: CompiledPredicate[];
  ordering: CompiledOrdering[];
  maxRows: number;
}): RenderedSelect {
  const { projections, joinTree, predicates, ordering, maxRows } = input;
  const lines: string[] = [];

  lines.push('SELECT');
  projections.forEach((projection, index) => {
    const suffix = index === projections.length - 1 ? '' : ',';
    lines.push(`${STAGE3E_INDENT}${projection.expression} AS ${projection.resultAlias}${suffix}`);
  });

  lines.push(`FROM ${joinTree.rootQualifiedName} ${joinTree.rootAlias}`);

  const onExtras = new Map<string, string[]>();
  for (const predicate of predicates) {
    if (predicate.placement !== 'join_on' || !predicate.targetJoinId) continue;
    const list = onExtras.get(predicate.targetJoinId) ?? [];
    list.push(predicate.sql);
    onExtras.set(predicate.targetJoinId, list);
  }

  for (const step of joinTree.steps) {
    const conditions = [...step.onConditions, ...(onExtras.get(step.joinId) ?? [])];
    lines.push(
      `${step.joinKeyword} ${step.joinedQualifiedName} ${step.joinedAlias} ON ${conditions[0]}`,
    );
    for (const condition of conditions.slice(1)) {
      lines.push(`${STAGE3E_INDENT}AND ${condition}`);
    }
  }

  // Multi-line predicates (correlated EXISTS) carry their own relative indentation in `sqlLines`;
  // the continuation lines get one extra level so the subquery sits under its AND/WHERE keyword.
  const whereBlocks = predicates
    .filter((p) => p.placement === 'where')
    .map((p) => p.sqlLines ?? [p.sql]);
  whereBlocks.forEach((block, index) => {
    const keyword = index === 0 ? 'WHERE ' : `${STAGE3E_INDENT}AND `;
    lines.push(`${keyword}${block[0]}`);
    for (const continuation of block.slice(1)) {
      lines.push(`${STAGE3E_INDENT}${continuation}`);
    }
  });

  if (ordering.length) {
    lines.push(
      `ORDER BY ${ordering.map((o) => `${o.expression} ${o.direction}`).join(', ')}`,
    );
  }

  lines.push(`FETCH FIRST ${maxRows} ROWS ONLY`);

  const sqlText = lines.map((line) => line.replace(/\s+$/, '')).join(STAGE3E_NEWLINE);
  return { sqlText, sqlSha256: sha256Utf8(sqlText), lineCount: lines.length };
}
