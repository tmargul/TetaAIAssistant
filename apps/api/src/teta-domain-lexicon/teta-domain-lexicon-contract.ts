import { createHash } from 'crypto';
import type { TetaDomainLexiconResolution } from './teta-domain-lexicon.types';

export function stableStringify(input: unknown): string {
  if (input === null || typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map((v) => stableStringify(v)).join(',')}]`;
  const obj = input as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function computeResolutionFingerprint(input: {
  lexiconVersion: string;
  lexiconSha256: string;
  normalizedQuery: string;
  matchedEntryIds: string[];
  matchedRuleIds: string[];
  mapping: TetaDomainLexiconResolution['mapping'];
  domainIds?: string[];
}): string {
  return sha256(
    stableStringify({
      lexiconVersion: input.lexiconVersion,
      lexiconSha256: input.lexiconSha256,
      normalizedQuery: input.normalizedQuery,
      matchedEntryIds: [...input.matchedEntryIds].sort(),
      matchedRuleIds: [...input.matchedRuleIds].sort(),
      domainIds: [...(input.domainIds ?? [])].sort(),
      mapping: input.mapping,
    }),
  );
}
