/**
 * Stage 3J — reverse impact + calculation formula uses + SQL status.
 */
import type { TetaPayrollComponentDependency } from '../teta-payroll-snapshots/teta-payroll-snapshot.types';
import type {
  PayrollCalculationFormulaUse,
  PayrollDependentExplanation,
  PayrollSqlFormulaUse,
} from './teta-payroll-explanation.types';
import { traverseDependents } from './teta-payroll-component-graph.service';

export type CalculationFormulaRefRow = {
  calculationFormulaId: string;
  internalId: string;
  title: string | null;
  formulaTypeRaw: string | null;
  componentCode: string;
  sourceFunction: string | null;
  confidence: string;
};

export function analyzeComponentImpact(input: {
  dependencies: TetaPayrollComponentDependency[];
  targetCode: string;
  maxDepth: number;
  titleByCode: Map<string, string | null>;
  calculationFormulaRefs: CalculationFormulaRefRow[];
  sqlFormulaCount: number;
  sqlReferencesIndexed: boolean;
}): {
  directDependents: PayrollDependentExplanation[];
  transitiveDependents: PayrollDependentExplanation[];
  calculationFormulaUses: PayrollCalculationFormulaUse[];
  sqlFormulaUses: PayrollSqlFormulaUse[];
  maximumDepthReached: number;
  truncated: boolean;
} {
  const traversal = traverseDependents({
    dependencies: input.dependencies,
    targetCode: input.targetCode,
    maxDepth: input.maxDepth,
    titleByCode: input.titleByCode,
  });

  const calcByFormula = new Map<string, PayrollCalculationFormulaUse>();
  for (const ref of input.calculationFormulaRefs) {
    if (ref.componentCode !== input.targetCode) continue;
    const key = ref.internalId || ref.calculationFormulaId;
    const existing = calcByFormula.get(key);
    if (existing) {
      existing.referenceCount += 1;
    } else {
      calcByFormula.set(key, {
        formulaInternalId: ref.internalId || ref.calculationFormulaId,
        title: ref.title,
        formulaTypeRaw: ref.formulaTypeRaw,
        referenceCount: 1,
        confidence: ref.confidence,
      });
    }
  }
  const calculationFormulaUses = [...calcByFormula.values()].sort((a, b) =>
    a.formulaInternalId.localeCompare(b.formulaInternalId, undefined, { numeric: true }),
  );

  const sqlFormulaUses: PayrollSqlFormulaUse[] = [];
  if (!input.sqlReferencesIndexed && input.sqlFormulaCount > 0) {
    sqlFormulaUses.push({
      status: 'not_indexed',
      message:
        'Snapshot zawiera formuły SQL, ale ten rodzaj zależności nie został jeszcze jednoznacznie zindeksowany.',
    });
  } else if (input.sqlFormulaCount === 0) {
    sqlFormulaUses.push({
      status: 'none_found',
      message: 'W snapshotcie nie zarejestrowano sekcji formuł SQL.',
    });
  } else {
    sqlFormulaUses.push({
      status: 'not_indexed',
      message:
        'Snapshot zawiera formuły SQL, ale ten rodzaj zależności nie został jeszcze jednoznacznie zindeksowany.',
    });
  }

  return {
    directDependents: traversal.direct,
    transitiveDependents: traversal.transitive,
    calculationFormulaUses,
    sqlFormulaUses,
    maximumDepthReached: traversal.maximumDepthReached,
    truncated: traversal.truncated,
  };
}

export function formatImpactNarrative(input: {
  targetCode: string;
  directDependents: PayrollDependentExplanation[];
  transitiveDependents: PayrollDependentExplanation[];
  calculationFormulaUses: PayrollCalculationFormulaUse[];
  sqlNotIndexed: boolean;
}): string {
  const parts: string[] = [];
  if (input.directDependents.length) {
    const codes = input.directDependents.map((d) => d.componentCode).join(', ');
    parts.push(
      `Składnik ${input.targetCode} jest bezpośrednio używany przez składniki: ${codes}.`,
    );
    for (const dep of input.directDependents) {
      parts.push(
        `Zmiana składnika ${input.targetCode} może wpłynąć na składnik ${dep.componentCode}, ponieważ jego wzór zawiera bezpośrednie odwołanie do ${input.targetCode}.`,
      );
    }
  } else {
    parts.push(
      `W aktywnym snapshotcie nie znaleziono innych składników, które bezpośrednio odwołują się do składnika ${input.targetCode}.`,
    );
  }
  if (input.transitiveDependents.length) {
    const codes = input.transitiveDependents.map((d) => d.componentCode).join(', ');
    parts.push(`Pośrednio od składnika ${input.targetCode} zależą także: ${codes}.`);
  }
  if (input.calculationFormulaUses.length) {
    parts.push(
      `Składnik jest także wykorzystywany w ${input.calculationFormulaUses.length} formułach kalkulacyjnych.`,
    );
  }
  if (input.sqlNotIndexed) {
    parts.push(
      'Nie oznacza to, że składnik nie występuje w niezindeksowanych formułach SQL.',
    );
  }
  return parts.join(' ');
}
