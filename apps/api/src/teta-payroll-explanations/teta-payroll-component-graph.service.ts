/**
 * Stage 3J — cycle-aware dependency graph traversal.
 */
import type { TetaPayrollComponentDependency } from '../teta-payroll-snapshots/teta-payroll-snapshot.types';
import type { PayrollTransitiveDependencyExplanation } from './teta-payroll-explanation.types';
import {
  STAGE3J_MAX_DEPTH,
  STAGE3J_MAX_GRAPH_NODES,
  STAGE3J_MAX_PATHS_PER_TARGET,
} from './teta-payroll-explanation.types';

export type GraphTraversalResult = {
  direct: string[];
  transitive: PayrollTransitiveDependencyExplanation[];
  maximumDepthReached: number;
  truncated: boolean;
  cycles: string[][];
  missingTargets: string[];
  selfReferences: string[];
};

function sortCodes(codes: string[]): string[] {
  return [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function buildAdjacencyMap(
  dependencies: TetaPayrollComponentDependency[],
): Map<string, TetaPayrollComponentDependency[]> {
  const adj = new Map<string, TetaPayrollComponentDependency[]>();
  for (const d of dependencies) {
    if (!adj.has(d.fromComponentCode)) adj.set(d.fromComponentCode, []);
    adj.get(d.fromComponentCode)!.push(d);
  }
  for (const [, edges] of adj) {
    edges.sort((a, b) =>
      a.toComponentCode.localeCompare(b.toComponentCode, undefined, { numeric: true }),
    );
  }
  return adj;
}

export function buildReverseAdjacencyMap(
  dependencies: TetaPayrollComponentDependency[],
): Map<string, TetaPayrollComponentDependency[]> {
  const rev = new Map<string, TetaPayrollComponentDependency[]>();
  for (const d of dependencies) {
    if (!rev.has(d.toComponentCode)) rev.set(d.toComponentCode, []);
    rev.get(d.toComponentCode)!.push(d);
  }
  for (const [, edges] of rev) {
    edges.sort((a, b) =>
      a.fromComponentCode.localeCompare(b.fromComponentCode, undefined, { numeric: true }),
    );
  }
  return rev;
}

export function traverseDependencies(input: {
  dependencies: TetaPayrollComponentDependency[];
  rootCode: string;
  maxDepth: number;
  titleByCode: Map<string, string | null>;
  knownCodes: Set<string>;
}): GraphTraversalResult {
  const maxDepth = Math.min(Math.max(1, input.maxDepth), STAGE3J_MAX_DEPTH);
  const adj = buildAdjacencyMap(input.dependencies);
  const directEdges = adj.get(input.rootCode) ?? [];
  const direct = sortCodes(directEdges.map((e) => e.toComponentCode));

  const selfReferences = directEdges
    .filter((e) => e.toComponentCode === input.rootCode)
    .map(() => input.rootCode);

  const missingTargets = sortCodes(
    directEdges.filter((e) => !input.knownCodes.has(e.toComponentCode)).map((e) => e.toComponentCode),
  );

  const pathsByTarget = new Map<string, { minimumDepth: number; paths: string[][] }>();
  let nodeCount = 0;
  let truncated = false;
  let maximumDepthReached = direct.length ? 1 : 0;

  type QueueItem = { code: string; path: string[]; depth: number };
  const queue: QueueItem[] = direct.map((code) => ({
    code,
    path: [input.rootCode, code],
    depth: 1,
  }));

  while (queue.length) {
    const item = queue.shift()!;
    if (item.depth > maxDepth) continue;
    maximumDepthReached = Math.max(maximumDepthReached, item.depth);
    nodeCount += 1;
    if (nodeCount > STAGE3J_MAX_GRAPH_NODES) {
      truncated = true;
      break;
    }

    const targetCode = item.code;
    if (targetCode === input.rootCode) continue;

    const existing = pathsByTarget.get(targetCode);
    if (!existing) {
      pathsByTarget.set(targetCode, { minimumDepth: item.depth, paths: [item.path] });
    } else {
      if (item.depth < existing.minimumDepth) {
        existing.minimumDepth = item.depth;
        existing.paths = [item.path];
      } else if (
        item.depth === existing.minimumDepth &&
        existing.paths.length < STAGE3J_MAX_PATHS_PER_TARGET
      ) {
        const key = item.path.join('>');
        if (!existing.paths.some((p) => p.join('>') === key)) {
          existing.paths.push(item.path);
        }
      }
    }

    if (item.depth >= maxDepth) continue;
    for (const edge of adj.get(targetCode) ?? []) {
      const next = edge.toComponentCode;
      if (item.path.includes(next)) continue;
      queue.push({
        code: next,
        path: [...item.path, next],
        depth: item.depth + 1,
      });
    }
  }

  const transitive: PayrollTransitiveDependencyExplanation[] = [...pathsByTarget.entries()]
    .filter(([code]) => !direct.includes(code))
    .map(([code, info]) => ({
      componentCode: code,
      componentTitle: input.titleByCode.get(code) ?? null,
      minimumDepth: info.minimumDepth,
      paths: info.paths.slice(0, STAGE3J_MAX_PATHS_PER_TARGET),
    }))
    .sort((a, b) =>
      a.componentCode.localeCompare(b.componentCode, undefined, { numeric: true }),
    );

  const cycles = detectCyclesFromRoot(adj, input.rootCode);

  return {
    direct,
    transitive,
    maximumDepthReached,
    truncated,
    cycles,
    missingTargets,
    selfReferences,
  };
}

export function traverseDependents(input: {
  dependencies: TetaPayrollComponentDependency[];
  targetCode: string;
  maxDepth: number;
  titleByCode: Map<string, string | null>;
}): {
  direct: Array<{
    componentCode: string;
    componentTitle: string | null;
    relationType: string;
    sourceFunction: string | null;
    minimumDepth: number;
  }>;
  transitive: Array<{
    componentCode: string;
    componentTitle: string | null;
    relationType: string;
    sourceFunction: string | null;
    minimumDepth: number;
  }>;
  maximumDepthReached: number;
  truncated: boolean;
} {
  const maxDepth = Math.min(Math.max(1, input.maxDepth), STAGE3J_MAX_DEPTH);
  const rev = buildReverseAdjacencyMap(input.dependencies);
  const directEdges = rev.get(input.targetCode) ?? [];
  const direct = directEdges.map((e) => ({
    componentCode: e.fromComponentCode,
    componentTitle: input.titleByCode.get(e.fromComponentCode) ?? null,
    relationType: 'depends_on_target',
    sourceFunction: e.sourceFunction,
    minimumDepth: 1,
  }));

  const seenDepth = new Map<string, number>();
  for (const d of direct) seenDepth.set(d.componentCode, 1);

  let frontier = direct.map((d) => d.componentCode);
  let depth = 1;
  let truncated = false;
  let nodeCount = direct.length;
  const transitive: typeof direct = [];

  while (frontier.length && depth < maxDepth) {
    depth += 1;
    const nextFrontier: string[] = [];
    for (const code of frontier) {
      for (const edge of rev.get(code) ?? []) {
        const from = edge.fromComponentCode;
        if (from === input.targetCode) continue;
        if (seenDepth.has(from) && (seenDepth.get(from) ?? 0) <= depth) continue;
        nodeCount += 1;
        if (nodeCount > STAGE3J_MAX_GRAPH_NODES) {
          truncated = true;
          return {
            direct,
            transitive: transitive.sort((a, b) =>
              a.componentCode.localeCompare(b.componentCode, undefined, { numeric: true }),
            ),
            maximumDepthReached: depth,
            truncated,
          };
        }
        seenDepth.set(from, depth);
        transitive.push({
          componentCode: from,
          componentTitle: input.titleByCode.get(from) ?? null,
          relationType: 'depends_on_target',
          sourceFunction: edge.sourceFunction,
          minimumDepth: depth,
        });
        nextFrontier.push(from);
      }
    }
    frontier = nextFrontier;
  }

  return {
    direct: direct.sort((a, b) =>
      a.componentCode.localeCompare(b.componentCode, undefined, { numeric: true }),
    ),
    transitive: transitive.sort((a, b) =>
      a.componentCode.localeCompare(b.componentCode, undefined, { numeric: true }),
    ),
    maximumDepthReached: depth,
    truncated,
  };
}

function detectCyclesFromRoot(
  adj: Map<string, TetaPayrollComponentDependency[]>,
  root: string,
): string[][] {
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string) {
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      if (idx >= 0) cycles.push(stack.slice(idx).concat(node));
      return;
    }
    visiting.add(node);
    stack.push(node);
    for (const edge of adj.get(node) ?? []) dfs(edge.toComponentCode);
    stack.pop();
    visiting.delete(node);
  }

  dfs(root);
  return cycles.slice(0, 20);
}
