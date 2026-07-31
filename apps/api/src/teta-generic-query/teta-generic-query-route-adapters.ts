/**
 * Stage 3K.1 offline route capability adapters.
 * Prefer existing classifiers; do not copy fixture-specific phrase dictionaries.
 */
import { isFieldHelpQuestion } from '../teta-plugins/teta-plugin-help-resolver';
import {
  isClientPayrollConfigurationQuestion,
  isGenericPayrollKnowledgeQuestion,
} from '../teta-payroll-snapshots/teta-payroll-snapshot-chat-gate';
import {
  detectPayrollExplanationIntent,
  detectUnsupportedPayrollIntent,
} from '../teta-payroll-explanations/teta-payroll-component-explanation-planner';
import { resolveReportPeriod } from '../teta-report-period/teta-report-period-parser';
import { matchesLlmOnlySignals, requestsLiveDatabaseData } from '../agent/agent-intent-detectors';
import type { GenericQueryLanguageConfig, GenericQueryRoutingConfig } from './teta-query-capability-registry';
import type { RoutingWinner } from './teta-logical-readonly-request.types';

export type RouteAdapterMatch = {
  winner: RoutingWinner;
  reason: string;
  matchedCapability: string | null;
};

function normalize(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

function containsAny(text: string, phrases: string[]): boolean {
  return phrases.some((p) => text.includes(p.toLowerCase()));
}

/** Dedicated BHP current-month (or period) expiry report — not mere BHP topic. */
export function matchDedicatedOccupationalHealthRoute(
  query: string,
  language: GenericQueryLanguageConfig,
): RouteAdapterMatch | null {
  const text = normalize(query);
  const healthLabels =
    language.canonicalConcepts.find((c) => c.conceptKey === 'health_examination')?.labels ?? [];
  const hasHealthSubject = containsAny(text, healthLabels);
  if (!hasHealthSubject) return null;

  const expiryMarkers = language.dedicatedExpirySemanticsMarkers ?? [];
  const hasExpirySemantics = containsAny(text, expiryMarkers);
  if (!hasExpirySemantics) return null;

  const period = resolveReportPeriod(query);
  if (!period.period) {
    // Expiry without resolvable period is not the dedicated current-month capability
    return null;
  }

  return {
    winner: 'dedicated_deterministic_engine',
    reason: `Dedicated capability match: occupational_health_examinations period=${period.period.kind}`,
    matchedCapability: `occupational_health_examinations_${period.period.kind}`,
  };
}

export function matchPayrollRoute(query: string): RouteAdapterMatch | null {
  if (isGenericPayrollKnowledgeQuestion(query)) return null;
  if (isClientPayrollConfigurationQuestion(query)) {
    return {
      winner: 'payroll_engine',
      reason: 'PayrollRouteCapabilityAdapter: client payroll configuration question (lexicon)',
      matchedCapability: 'client_payroll_configuration',
    };
  }
  if (detectUnsupportedPayrollIntent(query)) {
    return {
      winner: 'payroll_engine',
      reason: 'PayrollRouteCapabilityAdapter: unsupported payroll intent still owned by payroll engine',
      matchedCapability: 'payroll_unsupported_intent',
    };
  }
  const intent = detectPayrollExplanationIntent(query);
  if (
    intent === 'explain_payroll_component' ||
    intent === 'inspect_payroll_component' ||
    intent === 'explain_payroll_component_configuration'
  ) {
    // Only if lexicon actually bound a payroll intent — detectPayrollExplanationIntent may fall through
    if (isClientPayrollConfigurationQuestion(query)) {
      return {
        winner: 'payroll_engine',
        reason: `PayrollRouteCapabilityAdapter: intent=${intent}`,
        matchedCapability: intent,
      };
    }
  }
  return null;
}

export function matchHelpRoute(query: string): RouteAdapterMatch | null {
  if (!isFieldHelpQuestion(query)) return null;
  if (requestsLiveDatabaseData(query)) return null;
  return {
    winner: 'application_help',
    reason: 'HelpRouteCapabilityAdapter: isFieldHelpQuestion',
    matchedCapability: 'application_field_help',
  };
}

/**
 * Product/knowledge conceptual questions via existing LLM-only signals,
 * plus process markers — never topic keywords alone (e.g. "Teta Edu").
 */
export function matchKnowledgeRoute(
  query: string,
  language: GenericQueryLanguageConfig,
): RouteAdapterMatch | null {
  const text = normalize(query);
  const showMarkers = language.requestShapeMarkers.show ?? [];
  const employeeLabels =
    language.canonicalConcepts.find((c) => c.conceptKey === 'employee')?.labels ?? [];
  const hasListShape = containsAny(text, showMarkers) && containsAny(text, employeeLabels);
  if (hasListShape) {
    // R7: list-shaped employee query stays generic / data — not knowledge by product name alone
    return null;
  }

  const llm = matchesLlmOnlySignals(query);
  if (llm && !requestsLiveDatabaseData(query)) {
    return {
      winner: 'runtime_knowledge_3j2f',
      reason: `KnowledgeRouteCapabilityAdapter: matchesLlmOnlySignals (${llm})`,
      matchedCapability: 'llm_only_concept',
    };
  }

  const processMarkers = language.knowledgeProcessMarkers ?? [];
  if (containsAny(text, processMarkers) && !hasListShape) {
    return {
      winner: 'runtime_knowledge_3j2f',
      reason: 'KnowledgeRouteCapabilityAdapter: conceptual process question without data-list shape',
      matchedCapability: 'product_process_knowledge',
    };
  }

  return null;
}

export function matchRejection(
  query: string,
  routing: GenericQueryRoutingConfig,
): { kind: 'mutation' | 'raw_sql' | 'prompt_injection'; reason: string } | null {
  const text = normalize(query);
  const rej = routing.rejectionClasses;
  if (containsAny(text, rej.mutation?.phraseContainsAny ?? [])) {
    return { kind: 'mutation', reason: 'Mutation / write intent rejected for readonly model' };
  }
  // Prompt-injection before broad raw_sql markers (e.g. "wygeneruj SELECT …")
  if (containsAny(text, rej.prompt_injection?.phraseContainsAny ?? [])) {
    return { kind: 'prompt_injection', reason: 'Prompt-injection / SQL-generation request rejected' };
  }
  if (containsAny(text, rej.raw_sql?.phraseContainsAny ?? [])) {
    return { kind: 'raw_sql', reason: 'Raw SQL text rejected as logical readonly request' };
  }
  return null;
}

export function resolveRoutingWinner(
  query: string,
  language: GenericQueryLanguageConfig,
  routing: GenericQueryRoutingConfig,
): {
  decision: import('./teta-logical-readonly-request.types').RoutingDecision;
  rejection: ReturnType<typeof matchRejection>;
} {
  const precedence = routing.precedence as RoutingWinner[];
  const rejection = matchRejection(query, routing);

  if (rejection) {
    return {
      rejection,
      decision: {
        winner: 'rejected',
        precedenceApplied: precedence,
        reason: rejection.reason,
        matchedCapability: rejection.kind,
        genericReadonlyCandidate: false,
        dedicatedRouteWins: false,
        payrollRouteWins: false,
        helpRouteWins: false,
        knowledgeRouteWins: false,
        productionOrchestratorRewired: false,
      },
    };
  }

  const dedicated = matchDedicatedOccupationalHealthRoute(query, language);
  if (dedicated) {
    return {
      rejection: null,
      decision: {
        winner: dedicated.winner,
        precedenceApplied: precedence,
        reason: dedicated.reason,
        matchedCapability: dedicated.matchedCapability,
        genericReadonlyCandidate: false,
        dedicatedRouteWins: true,
        payrollRouteWins: false,
        helpRouteWins: false,
        knowledgeRouteWins: false,
        productionOrchestratorRewired: false,
      },
    };
  }

  const payroll = matchPayrollRoute(query);
  if (payroll) {
    return {
      rejection: null,
      decision: {
        winner: payroll.winner,
        precedenceApplied: precedence,
        reason: payroll.reason,
        matchedCapability: payroll.matchedCapability,
        genericReadonlyCandidate: false,
        dedicatedRouteWins: false,
        payrollRouteWins: true,
        helpRouteWins: false,
        knowledgeRouteWins: false,
        productionOrchestratorRewired: false,
      },
    };
  }

  const help = matchHelpRoute(query);
  if (help) {
    return {
      rejection: null,
      decision: {
        winner: help.winner,
        precedenceApplied: precedence,
        reason: help.reason,
        matchedCapability: help.matchedCapability,
        genericReadonlyCandidate: false,
        dedicatedRouteWins: false,
        payrollRouteWins: false,
        helpRouteWins: true,
        knowledgeRouteWins: false,
        productionOrchestratorRewired: false,
      },
    };
  }

  const knowledge = matchKnowledgeRoute(query, language);
  if (knowledge) {
    return {
      rejection: null,
      decision: {
        winner: knowledge.winner,
        precedenceApplied: precedence,
        reason: knowledge.reason,
        matchedCapability: knowledge.matchedCapability,
        genericReadonlyCandidate: false,
        dedicatedRouteWins: false,
        payrollRouteWins: false,
        helpRouteWins: false,
        knowledgeRouteWins: true,
        productionOrchestratorRewired: false,
      },
    };
  }

  return {
    rejection: null,
    decision: {
      winner: 'generic_readonly_query',
      precedenceApplied: precedence,
      reason: 'No higher-precedence capability adapter matched; generic readonly candidate',
      matchedCapability: null,
      genericReadonlyCandidate: true,
      dedicatedRouteWins: false,
      payrollRouteWins: false,
      helpRouteWins: false,
      knowledgeRouteWins: false,
      productionOrchestratorRewired: false,
    },
  };
}
