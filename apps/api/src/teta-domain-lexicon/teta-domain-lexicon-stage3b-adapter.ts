import type { TetaEvidencePlan } from '../teta-planner/teta-stage3b.types';
import { resolveDomainLexicon } from './teta-domain-lexicon-resolver';

export function attachLanguageResolutionToStage3bPlan(plan: TetaEvidencePlan): TetaEvidencePlan {
  const resolution = resolveDomainLexicon(plan.question.raw);
  return {
    ...plan,
    languageResolution: {
      lexiconVersion: resolution.lexiconVersion,
      status: resolution.status,
      conceptIds: resolution.concepts.map((c) => c.conceptId),
      ruleIds: resolution.matchedRuleIds,
      confidence: resolution.concepts[0]?.confidence ?? 'context_required',
      fingerprintSha256: resolution.resolutionFingerprintSha256,
    },
  };
}
