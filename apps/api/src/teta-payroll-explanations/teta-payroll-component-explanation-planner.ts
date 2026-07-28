/**
 * Stage 3J — intent/focus planning from natural language query.
 */
import type { PlannerIntentType } from '../teta-planner/teta-stage3b.types';
import type {
  PayrollComponentRequest,
  PayrollExplanationFocus,
} from './teta-payroll-explanation.types';
import {
  STAGE3J_DEFAULT_DEPTH,
  STAGE3J_MAX_DEPTH,
} from './teta-payroll-explanation.types';
import {
  extractComponentCodeCandidate,
  extractTitleCandidate,
} from './teta-payroll-component-selector';

const UNSUPPORTED_INTENTS: PlannerIntentType[] = [
  'compare_payroll_components',
  'design_analogous_payroll_component',
  'calculate_payroll_component',
  'explain_employee_payroll_value',
  'modify_payroll_component',
  'create_payroll_component',
];

const UNSUPPORTED_PATTERNS: Array<{ intent: PlannerIntentType; re: RegExp }> = [
  { intent: 'compare_payroll_components', re: /por[óo]wnaj|vs|versus|r[óo]żnic/i },
  {
    intent: 'design_analogous_payroll_component',
    re: /analogiczn|podobn|utw[óo]rz|stw[óo]rz|zaprojektuj|nowy sk[łl]adnik/i,
  },
  { intent: 'calculate_payroll_component', re: /oblicz|nalicz|wylicz/i },
  {
    intent: 'explain_employee_payroll_value',
    re: /dlaczego.*(?:wyni[óo]s[łl]|ma\s+\d|warto[śs][ćc])|dla pracownika|pracownik/i,
  },
  { intent: 'modify_payroll_component', re: /zmie[nń]|modyfikuj|edytuj/i },
  { intent: 'create_payroll_component', re: /dodaj sk[łl]adnik|nowy sk[łl]adnik/i },
];

const INSPECT_SIGNALS = [
  /jak zbudowany/i,
  /od czego zale[żz]/i,
  /zale[żz]no[śs]ci/i,
  /sprawd[źz]|poka[żz]/i,
  /inspect/i,
];

const EXPLAIN_SIGNALS = [
  /konfigurac/i,
  /parametr/i,
  /ustawien/i,
  /wzor|formu[łl]/i,
  /tryb korekty/i,
  /jak dzia[łl]a/i,
];

export function detectUnsupportedPayrollIntent(
  query: string,
): PlannerIntentType | null {
  for (const p of UNSUPPORTED_PATTERNS) {
    if (p.re.test(query)) return p.intent;
  }
  return null;
}

export function detectPayrollExplanationIntent(query: string): PlannerIntentType {
  const unsupported = detectUnsupportedPayrollIntent(query);
  if (unsupported) return unsupported;
  if (EXPLAIN_SIGNALS.some((re) => re.test(query))) {
    return 'explain_payroll_component_configuration';
  }
  if (INSPECT_SIGNALS.some((re) => re.test(query))) {
    return 'inspect_payroll_component';
  }
  if (/sk[łl]adnik/i.test(query)) {
    return 'explain_payroll_component_configuration';
  }
  return 'inspect_payroll_component';
}

export function detectPayrollExplanationFocus(query: string): PayrollExplanationFocus {
  if (/zale[żz]no[śs]|od czego zale/i.test(query)) return 'dependencies';
  if (/wp[łl]yw|u[żz]ywany|wykorzyst|zale[żz][ąa]/i.test(query)) return 'impact';
  if (/wzor|formu[łl]|jak dzia[łl]a/i.test(query)) return 'formula';
  if (/konfigurac|parametr|ustawien|overview/i.test(query)) return 'overview';
  return 'full';
}

export function buildPayrollComponentRequest(query: string, depth?: number): PayrollComponentRequest {
  const code = extractComponentCodeCandidate(query);
  const title = extractTitleCandidate(query);
  return {
    selector: {
      rawValue: code ?? title ?? query.trim(),
      selectorHint: code ? 'code' : title ? 'title' : 'unknown',
    },
    focus: detectPayrollExplanationFocus(query),
    requestedDepth: Math.min(
      Math.max(1, depth ?? STAGE3J_DEFAULT_DEPTH),
      STAGE3J_MAX_DEPTH,
    ),
  };
}

export function isStage3jSupportedIntent(intent: PlannerIntentType): boolean {
  return (
    intent === 'inspect_payroll_component' ||
    intent === 'explain_payroll_component_configuration'
  );
}

export function isStage3jUnsupportedIntent(intent: PlannerIntentType): boolean {
  return UNSUPPORTED_INTENTS.includes(intent);
}

export function attachPayrollComponentRequestToPlan<T extends { intent: { type: PlannerIntentType } }>(
  plan: T,
  query: string,
  depth?: number,
): T & { payrollComponentRequest?: PayrollComponentRequest } {
  if (!isStage3jSupportedIntent(plan.intent.type)) return plan;
  return {
    ...plan,
    payrollComponentRequest: buildPayrollComponentRequest(query, depth),
  };
}
