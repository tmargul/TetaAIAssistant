import type { PayrollExplanationFocus } from '../teta-payroll-explanations/teta-payroll-explanation.types';
import { resolveDomainLexicon } from './teta-domain-lexicon-resolver';

export function detectStage3jFocusViaLexicon(query: string): PayrollExplanationFocus | null {
  const resolution = resolveDomainLexicon(query);
  if (resolution.status === 'resolved' || resolution.status === 'resolved_with_warnings') {
    return (resolution.mapping.focus ?? null) as PayrollExplanationFocus | null;
  }
  return null;
}

export function detectUnsupportedCapabilityViaLexicon(query: string): string | null {
  const resolution = resolveDomainLexicon(query);
  if (resolution.mapping.capabilityStatus === 'not_available_yet' && resolution.mapping.capability) {
    return resolution.mapping.capability;
  }
  return null;
}
