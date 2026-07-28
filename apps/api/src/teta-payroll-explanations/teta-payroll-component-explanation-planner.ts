/**
 * Stage 3J — intent/focus planning from natural language query.
 * Stage 3J.1: lexicon-only for migrated focus/unsupported/capability scope.
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
import {
  detectStage3jFocusViaLexicon,
  detectUnsupportedCapabilityViaLexicon,
} from '../teta-domain-lexicon/teta-domain-lexicon-stage3j-adapter';
import { resolveDomainLexicon } from '../teta-domain-lexicon/teta-domain-lexicon-resolver';

const UNSUPPORTED_INTENTS: PlannerIntentType[] = [
  'compare_payroll_components',
  'design_analogous_payroll_component',
  'calculate_payroll_component',
  'explain_employee_payroll_value',
  'modify_payroll_component',
  'create_payroll_component',
];

export function detectUnsupportedPayrollIntent(
  query: string,
): PlannerIntentType | null {
  const lexiconCapability = detectUnsupportedCapabilityViaLexicon(query);
  if (lexiconCapability) {
    if (lexiconCapability.includes('analog')) return 'design_analogous_payroll_component';
    if (lexiconCapability.includes('create')) return 'create_payroll_component';
    if (lexiconCapability.includes('modify')) return 'modify_payroll_component';
    if (lexiconCapability.includes('compare')) return 'compare_payroll_components';
    if (lexiconCapability.includes('calculate')) return 'calculate_payroll_component';
    if (lexiconCapability.includes('employee')) return 'explain_employee_payroll_value';
  }
  const lexicon = resolveDomainLexicon(query);
  if (lexicon.mapping.intent && UNSUPPORTED_INTENTS.includes(lexicon.mapping.intent)) {
    return lexicon.mapping.intent;
  }
  return null;
}

export function detectPayrollExplanationIntent(query: string): PlannerIntentType {
  const unsupported = detectUnsupportedPayrollIntent(query);
  if (unsupported) return unsupported;
  const lexicon = resolveDomainLexicon(query);
  if (lexicon.mapping.intent === 'inspect_payroll_component') {
    return 'inspect_payroll_component';
  }
  if (lexicon.mapping.intent === 'explain_payroll_component_configuration') {
    return 'explain_payroll_component_configuration';
  }
  if (lexicon.concepts.some((c) => c.conceptId === 'payroll_component')) {
    return 'explain_payroll_component_configuration';
  }
  return 'inspect_payroll_component';
}

export function detectPayrollExplanationFocus(query: string): PayrollExplanationFocus {
  const lexiconFocus = detectStage3jFocusViaLexicon(query);
  if (lexiconFocus) return lexiconFocus;
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
