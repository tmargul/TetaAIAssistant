/**
 * Stage 3E — join tree construction.
 *
 * v1 accepts only a connected, acyclic join graph with exactly `sources - 1` equality joins.
 * The root is the first source in `sources[]` order that is not on the nullable side of a LEFT JOIN,
 * and joins are emitted inner-first (then by joinId) so that every LEFT JOIN keeps its preserved
 * side already present in the tree.
 */
import type { QueryJoin } from '../teta-query-planner/teta-query-plan.types';
import type {
  CompilableQueryPlan,
  CompiledJoinStep,
  CompiledJoinTree,
  CompiledSourceAlias,
} from './teta-oracle-compiler.types';
import type { AccessColumnResolver } from './teta-oracle-access-column-resolver';

export type JoinTreeIssue = {
  code: string;
  message: string;
  joinId: string | null;
};

export type JoinTreeResult =
  | { ok: true; tree: CompiledJoinTree; selfJoins: 0; crossJoins: 0; cyclic: false }
  | {
      ok: false;
      issue: JoinTreeIssue;
      selfJoins: number;
      crossJoins: number;
      cyclic: boolean;
    };

function fail(
  code: string,
  message: string,
  joinId: string | null,
  counters?: { selfJoins?: number; crossJoins?: number; cyclic?: boolean },
): JoinTreeResult {
  return {
    ok: false,
    issue: { code, message, joinId },
    selfJoins: counters?.selfJoins ?? 0,
    crossJoins: counters?.crossJoins ?? 0,
    cyclic: counters?.cyclic ?? false,
  };
}

/** Priority: INNER before LEFT, then joinId lexicographically. */
function joinSortKey(join: QueryJoin): string {
  return `${join.joinType === 'inner' ? '0' : '1'}|${join.joinId}`;
}

export function buildJoinTree(input: {
  plan: CompilableQueryPlan;
  sources: CompiledSourceAlias[];
  byRole: Map<string, CompiledSourceAlias>;
  accessColumns: AccessColumnResolver;
}): JoinTreeResult {
  const { plan, sources, byRole, accessColumns } = input;
  const joins = plan.joins ?? [];

  // A filter-only source has no cardinality proof, so joining it could multiply report rows.
  for (const join of joins) {
    for (const role of [join.leftSourceRole, join.rightSourceRole]) {
      if (byRole.get(role)?.usage === 'filter_only') {
        return fail(
          'filter_only_source_in_join_tree',
          `Join ${join.joinId} references filter-only source ${role}; it must compile as a correlated EXISTS`,
          join.joinId,
        );
      }
    }
  }

  if (sources.length === 1) {
    if (joins.length > 0) {
      return fail('unexpected_join_for_single_source', 'Single-source plan must have no joins', null);
    }
    const root = sources[0]!;
    return {
      ok: true,
      selfJoins: 0,
      crossJoins: 0,
      cyclic: false,
      tree: {
        rootSourceRole: root.sourceRole,
        rootAlias: root.alias,
        rootQualifiedName: root.qualifiedName,
        steps: [],
        edgeCount: 0,
        sourceCount: 1,
        acyclic: true,
        connected: true,
      },
    };
  }

  let selfJoins = 0;
  for (const join of joins) {
    if (join.leftSourceRole === join.rightSourceRole) selfJoins += 1;
  }
  if (selfJoins > 0) {
    return fail(
      'self_join_unsupported',
      'Self joins are not supported in Stage 3E v1',
      joins.find((j) => j.leftSourceRole === j.rightSourceRole)?.joinId ?? null,
      { selfJoins },
    );
  }

  for (const join of joins) {
    if (join.status !== 'resolved') {
      return fail(
        'unresolved_join',
        `Join ${join.joinId} has status ${join.status}`,
        join.joinId,
      );
    }
    if (!join.predicates?.length) {
      return fail(
        'cartesian_join_forbidden',
        `Join ${join.joinId} has no predicates (cartesian product)`,
        join.joinId,
        { crossJoins: 1 },
      );
    }
    for (const predicate of join.predicates) {
      if (predicate.operator !== 'equals') {
        return fail(
          'unsupported_join_operator',
          `Join ${join.joinId} uses operator ${predicate.operator}; only equals is supported`,
          join.joinId,
        );
      }
    }
    if (!byRole.has(join.leftSourceRole) || !byRole.has(join.rightSourceRole)) {
      return fail(
        'join_references_unknown_source',
        `Join ${join.joinId} references a source role that is not in sources[]`,
        join.joinId,
      );
    }
  }

  if (joins.length !== sources.length - 1) {
    return fail(
      'join_count_mismatch',
      `Expected exactly ${sources.length - 1} joins for ${sources.length} sources, got ${joins.length}`,
      null,
    );
  }

  // Union-find over source roles detects both cycles and disconnection.
  const parent = new Map<string, string>(sources.map((s) => [s.sourceRole, s.sourceRole]));
  const find = (role: string): string => {
    let current = role;
    while (parent.get(current) !== current) {
      current = parent.get(current)!;
    }
    return current;
  };
  const ordered = [...joins].sort((a, b) => a.joinId.localeCompare(b.joinId));
  for (const join of ordered) {
    const a = find(join.leftSourceRole);
    const b = find(join.rightSourceRole);
    if (a === b) {
      return fail(
        'cyclic_join_graph_unsupported',
        `Join ${join.joinId} closes a cycle between ${join.leftSourceRole} and ${join.rightSourceRole}`,
        join.joinId,
        { cyclic: true },
      );
    }
    parent.set(a, b);
  }
  const roots = new Set(sources.map((s) => find(s.sourceRole)));
  if (roots.size !== 1) {
    return fail(
      'disconnected_join_graph',
      `Join graph is disconnected (${roots.size} components)`,
      null,
    );
  }

  const nullableRoles = new Set(
    joins.filter((j) => j.joinType === 'left').map((j) => j.rightSourceRole),
  );
  const root = sources.find((s) => !nullableRoles.has(s.sourceRole));
  if (!root) {
    return fail(
      'no_join_tree_root',
      'Every source is on the nullable side of a LEFT JOIN; no root could be selected',
      null,
    );
  }

  const inTree = new Set<string>([root.sourceRole]);
  const remaining = [...joins].sort((a, b) => joinSortKey(a).localeCompare(joinSortKey(b)));
  const steps: CompiledJoinStep[] = [];

  while (remaining.length) {
    const index = remaining.findIndex((join) => {
      const leftIn = inTree.has(join.leftSourceRole);
      const rightIn = inTree.has(join.rightSourceRole);
      if (leftIn === rightIn) return false;
      // LEFT JOIN must never be reversed: the preserved (left) side has to be in the tree already.
      if (join.joinType === 'left') return leftIn;
      return true;
    });
    if (index < 0) {
      const blocked = remaining[0]!;
      return fail(
        'left_join_reversal_unsupported',
        `Join ${blocked.joinId} cannot be emitted: LEFT JOIN would need its preserved side on the right`,
        blocked.joinId,
      );
    }
    const [join] = remaining.splice(index, 1);
    const joinedRole = inTree.has(join!.leftSourceRole)
      ? join!.rightSourceRole
      : join!.leftSourceRole;
    const anchorRole =
      joinedRole === join!.leftSourceRole ? join!.rightSourceRole : join!.leftSourceRole;
    const joined = byRole.get(joinedRole)!;
    const anchor = byRole.get(anchorRole)!;

    const onConditions: string[] = [];
    for (const predicate of join!.predicates) {
      const left = accessColumns.resolve(predicate.leftOracleColumnNodeId, join!.leftSourceRole);
      if (!left.ok) {
        return fail(
          left.issue.code,
          `Join ${join!.joinId}: ${left.issue.message}`,
          join!.joinId,
        );
      }
      const right = accessColumns.resolve(predicate.rightOracleColumnNodeId, join!.rightSourceRole);
      if (!right.ok) {
        return fail(
          right.issue.code,
          `Join ${join!.joinId}: ${right.issue.message}`,
          join!.joinId,
        );
      }
      onConditions.push(`${left.column.qualifiedExpression} = ${right.column.qualifiedExpression}`);
    }

    steps.push({
      ordinal: steps.length + 1,
      joinId: join!.joinId,
      joinKeyword: join!.joinType === 'left' ? 'LEFT JOIN' : 'INNER JOIN',
      joinType: join!.joinType,
      joinedSourceRole: joinedRole,
      joinedAlias: joined.alias,
      joinedQualifiedName: joined.qualifiedName,
      anchorSourceRole: anchorRole,
      anchorAlias: anchor.alias,
      onConditions,
      enrichment: !!join!.enrichment,
    });
    inTree.add(joinedRole);
  }

  if (inTree.size !== sources.length) {
    return fail(
      'disconnected_join_graph',
      `Only ${inTree.size} of ${sources.length} sources are reachable from root ${root.sourceRole}`,
      null,
    );
  }

  return {
    ok: true,
    selfJoins: 0,
    crossJoins: 0,
    cyclic: false,
    tree: {
      rootSourceRole: root.sourceRole,
      rootAlias: root.alias,
      rootQualifiedName: root.qualifiedName,
      steps,
      edgeCount: steps.length,
      sourceCount: sources.length,
      acyclic: true,
      connected: true,
    },
  };
}

/** Source roles that are reachable only through a LEFT JOIN (nullable in the result set). */
export function nullableSourceRoles(tree: CompiledJoinTree): Set<string> {
  const nullable = new Set<string>();
  for (const step of tree.steps) {
    if (step.joinType === 'left' || nullable.has(step.anchorSourceRole)) {
      nullable.add(step.joinedSourceRole);
    }
  }
  return nullable;
}
