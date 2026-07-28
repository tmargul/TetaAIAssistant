/**
 * Stage 3J — deterministic formula explainer (no eval, no simplification).
 */
import type { TetaPayrollFormulaAst } from '../teta-payroll-snapshots/teta-payroll-snapshot.types';
import { tokenizePayrollFormula } from '../teta-payroll-snapshots/teta-payroll-formula-parser';
import type {
  PayrollFormulaPlainLanguageStep,
  PayrollEvidenceProvenance,
} from './teta-payroll-explanation.types';
import type { PayrollSemanticsCatalog } from './teta-payroll-semantics-catalog';
import { lookupFunctionMeaning } from './teta-payroll-semantics-catalog';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function explainPayrollFormula(input: {
  ast: TetaPayrollFormulaAst;
  catalog: PayrollSemanticsCatalog;
}): {
  steps: PayrollFormulaPlainLanguageStep[];
  warnings: string[];
  unknownFunctions: string[];
} {
  const { ast, catalog } = input;
  const steps: PayrollFormulaPlainLanguageStep[] = [];
  const warnings: string[] = [];
  const unknownFunctions = new Set<string>();
  let sequence = 0;

  const addStep = (
    stepType: string,
    description: string,
    provenance: PayrollEvidenceProvenance,
  ) => {
    sequence += 1;
    steps.push({ stepType, sequence, description, evidenceTokenIds: [], provenance });
  };

  if (!ast.raw?.trim()) {
    addStep('empty', 'Składnik nie ma zdefiniowanego wzoru w raporcie.', 'snapshot_exact');
    return { steps, warnings, unknownFunctions: [] };
  }

  if (ast.status === 'malformed' || ast.status === 'unsupported') {
    addStep(
      'malformed',
      'Wzór składnika ma status parsera: ' + ast.status + '. Opis może być niepełny.',
      'parser_diagnostic',
    );
    warnings.push('formula_unparsed');
  }

  for (const code of ast.directComponentCodes) {
    addStep(
      'component_reference',
      `Wzór odwołuje się do składnika ${code}.`,
      'graph_exact',
    );
  }

  const upper = ast.raw.toUpperCase();
  if (upper.includes('CASE WHEN') || upper.includes('CASE  WHEN')) {
    addStep(
      'conditional',
      'Wzór zawiera konstrukcję warunkową CASE WHEN — wynik zależy od spełnienia warunków.',
      'parser_diagnostic',
    );
  }

  const operators: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\+/, label: 'dodawanie' },
    { pattern: /-/, label: 'odejmowanie' },
    { pattern: /\*/, label: 'mnożenie' },
    { pattern: /\//, label: 'dzielenie' },
    { pattern: />=|<=|<>|!=|>|<|=/, label: 'porównanie' },
  ];
  for (const op of operators) {
    if (op.pattern.test(ast.raw)) {
      addStep('operator', `Wzór zawiera operator ${op.label}.`, 'parser_diagnostic');
    }
  }

  if (/\bAND\b/i.test(ast.raw) || /\bOR\b/i.test(ast.raw)) {
    addStep(
      'logical',
      'Wzór łączy warunki operatorami logicznymi AND/OR.',
      'parser_diagnostic',
    );
  }

  const tokens = ast.tokens.length ? ast.tokens : tokenizePayrollFormula(ast.raw);
  for (const token of tokens) {
    if (/^['"]/.test(token)) {
      addStep('literal', `Wzór zawiera literał tekstowy: ${token}.`, 'snapshot_exact');
    } else if (/^\d+(\.\d+)?$/.test(token)) {
      addStep('literal', `Wzór zawiera literał liczbowy: ${token}.`, 'snapshot_exact');
    }
  }

  const callPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  const seenCalls = new Set<string>();
  while ((match = callPattern.exec(ast.raw))) {
    const name = match[1]!;
    const lower = name.toLowerCase();
    if (['case', 'when', 'then', 'else', 'end'].includes(lower)) continue;
    if (seenCalls.has(lower)) continue;
    seenCalls.add(lower);
    const fn = lookupFunctionMeaning(catalog, name);
    if (fn.unknown) {
      unknownFunctions.add(name);
      addStep('unknown_function', fn.meaning ?? `Nieznana funkcja ${name}.`, 'unknown');
      warnings.push('formula_unknown_function');
    } else {
      addStep('function_call', fn.meaning ?? `Wywołanie funkcji ${name}.`, fn.provenance);
    }
  }

  for (const m0 of ast.raw.matchAll(/m0_(\d+)/gi)) {
    addStep(
      'component_reference',
      `Odwołanie m0_${m0[1]} pobiera wartość składnika ${m0[1]} z bieżącej listy.`,
      'training_semantics_verified',
    );
  }

  if (steps.length === 0) {
    addStep(
      'raw',
      'Wzór jest zapisany w języku parametryzacji płacowej Teta — szczegóły w surowym wzorze poniżej.',
      'snapshot_exact',
    );
  }

  return {
    steps,
    warnings: [...new Set(warnings)],
    unknownFunctions: [...unknownFunctions].sort(),
  };
}

export function summarizeFormulaSteps(steps: PayrollFormulaPlainLanguageStep[]): string {
  if (!steps.length) return 'Brak opisu wzoru.';
  return steps.map((s) => `${s.sequence}. ${s.description}`).join(' ');
}
