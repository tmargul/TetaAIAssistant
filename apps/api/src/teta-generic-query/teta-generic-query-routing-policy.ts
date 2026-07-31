import { resolveRoutingWinner } from './teta-generic-query-route-adapters';
import type { GenericQueryLanguageConfig, GenericQueryRoutingConfig } from './teta-query-capability-registry';

/** @deprecated Use resolveRoutingWinner from route-adapters. */
export function probeRouting(
  query: string,
  routing: GenericQueryRoutingConfig,
  language: GenericQueryLanguageConfig,
) {
  const { decision, rejection } = resolveRoutingWinner(query, language, routing);
  return {
    normalized: query.trim().toLowerCase().replace(/\s+/g, ' '),
    mutation: rejection?.kind === 'mutation',
    rawSql: rejection?.kind === 'raw_sql',
    promptInjection: rejection?.kind === 'prompt_injection',
    decision,
  };
}
