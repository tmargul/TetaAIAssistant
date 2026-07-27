/**
 * Stage 3I — dependency extraction from parsed formulas (static only).
 */
import { createHash } from 'crypto';
import type {
  TetaPayrollComponentDefinition,
  TetaPayrollComponentDependency,
  TetaPayrollFormulaAst,
} from './teta-payroll-snapshot.types';
import { parsePayrollFormula } from './teta-payroll-formula-parser';

export type DependencyExtractionResult = {
  dependencies: TetaPayrollComponentDependency[];
  formulaAstByCode: Record<string, TetaPayrollFormulaAst>;
  missingTargets: string[];
  selfReferences: string[];
  cycles: string[][];
  forwardReferences: string[];
};

function depId(from: string, to: string, fragment: string): string {
  return createHash('sha256').update(`${from}->${to}|${fragment}`, 'utf8').digest('hex').slice(0, 24);
}

export function extractComponentDependencies(
  snapshotId: string,
  components: TetaPayrollComponentDefinition[],
): DependencyExtractionResult {
  const byCode = new Map(components.map((c) => [c.code, c]));
  const dependencies: TetaPayrollComponentDependency[] = [];
  const formulaAstByCode: Record<string, TetaPayrollFormulaAst> = {};
  const missingTargets = new Set<string>();
  const selfReferences = new Set<string>();
  const forwardReferences = new Set<string>();
  const codeOrder = new Map(components.map((c, i) => [c.code, i]));

  const adj = new Map<string, Set<string>>();

  for (const component of components) {
    const ast = parsePayrollFormula(component.formulaRaw);
    formulaAstByCode[component.code] = ast;
    for (const toCode of ast.directComponentCodes) {
      if (toCode === component.code) {
        selfReferences.add(component.code);
      }
      if (!byCode.has(toCode)) {
        missingTargets.add(toCode);
      }
      const fromOrd = codeOrder.get(component.code) ?? 0;
      const toOrd = codeOrder.get(toCode);
      if (toOrd != null && toOrd > fromOrd) {
        forwardReferences.add(`${component.code}->${toCode}`);
      }
      const fragment = `m0_${toCode}`;
      dependencies.push({
        snapshotId,
        fromComponentCode: component.code,
        toComponentCode: toCode,
        relationType: 'current_list_value',
        sourceFunction: 'm0',
        sourceFragment: fragment,
        confidence: 'exact',
        sourceEvidence: {
          section: component.sourceEvidence.section,
          recordOrdinal: component.sourceEvidence.recordOrdinal,
        },
      });
      if (!adj.has(component.code)) adj.set(component.code, new Set());
      adj.get(component.code)!.add(toCode);
      void depId(component.code, toCode, fragment);
    }
  }

  // Deterministic order
  dependencies.sort((a, b) =>
    a.fromComponentCode === b.fromComponentCode
      ? a.toComponentCode.localeCompare(b.toComponentCode, undefined, { numeric: true })
      : a.fromComponentCode.localeCompare(b.fromComponentCode, undefined, { numeric: true }),
  );

  const cycles = detectCycles(adj);
  return {
    dependencies,
    formulaAstByCode,
    missingTargets: [...missingTargets].sort(),
    selfReferences: [...selfReferences].sort(),
    cycles,
    forwardReferences: [...forwardReferences].sort(),
  };
}

function detectCycles(adj: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string) {
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      if (idx >= 0) cycles.push(stack.slice(idx).concat(node));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const next of adj.get(node) ?? []) dfs(next);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of [...adj.keys()].sort()) dfs(node);
  return cycles.slice(0, 50);
}

/** Transitive dependency codes up to depth (BFS). */
export function traceDependencies(
  dependencies: TetaPayrollComponentDependency[],
  code: string,
  depth: number,
): { direct: string[]; transitive: string[] } {
  const adj = new Map<string, string[]>();
  for (const d of dependencies) {
    if (!adj.has(d.fromComponentCode)) adj.set(d.fromComponentCode, []);
    adj.get(d.fromComponentCode)!.push(d.toComponentCode);
  }
  const direct = [...new Set(adj.get(code) ?? [])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  const seen = new Set<string>([code]);
  let frontier = [...direct];
  const transitive = new Set<string>(direct);
  for (let d = 1; d < depth; d++) {
    const next: string[] = [];
    for (const n of frontier) {
      for (const t of adj.get(n) ?? []) {
        if (seen.has(t)) continue;
        seen.add(t);
        transitive.add(t);
        next.push(t);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return {
    direct,
    transitive: [...transitive].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  };
}
