import { computeResolutionFingerprint } from './teta-domain-lexicon-contract';
import { loadDomainLexicon } from './teta-domain-lexicon-loader';
import { classifyScope, matchLexiconEntries, matchOperationRules } from './teta-domain-lexicon-matcher';
import { normalizePolishText } from './teta-polish-text-normalizer';
import {
  TETA_DOMAIN_LEXICON_RESOLUTION_CONTRACT_VERSION,
  type DomainClassificationConfidence,
  type ResolutionKind,
  type TetaDomainLexiconResolution,
} from './teta-domain-lexicon.types';

function fold(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Match approved domain registry aliases/labels (not business concept approval). */
function matchDomainRegistrySignals(
  queryExact: string,
  queryFolded: string,
  domains: Array<{ domainId: string; canonicalLabel: string; aliases: string[]; status: string }>,
): Array<{ domainId: string; confidence: DomainClassificationConfidence; matchedText: string }> {
  const out: Array<{ domainId: string; confidence: DomainClassificationConfidence; matchedText: string }> = [];
  const queryTokens = queryFolded.split(/\s+/).filter(Boolean);

  const aliasMatchesQuery = (alias: string): boolean => {
    const exact = alias.toLowerCase().trim();
    const foldedAlias = fold(alias);
    if (exact.length < 3) return false;
    if (queryExact.includes(exact) || queryFolded.includes(foldedAlias)) return true;
    const aliasTokens = foldedAlias.split(/\s+/).filter((t) => t.length >= 3);
    if (!aliasTokens.length) return false;
    // Inflection-tolerant: each alias token shares a stem (>=5 chars) with a query token.
    return aliasTokens.every((at) =>
      queryTokens.some((qt) => {
        const max = Math.min(at.length, qt.length);
        for (let i = max; i >= 5; i -= 1) {
          if (at.slice(0, i) === qt.slice(0, i)) return true;
        }
        return false;
      }),
    );
  };

  for (const domain of domains.filter((d) => d.status === 'approved' && d.domainId !== 'core')) {
    const labels = [domain.canonicalLabel, ...domain.aliases];
    for (const label of labels) {
      if (aliasMatchesQuery(label)) {
        out.push({ domainId: domain.domainId, confidence: 'strongly_supported', matchedText: label });
        break;
      }
    }
  }
  return out;
}

function deriveResolutionKind(input: {
  unresolved: boolean;
  ambiguous: boolean;
  multiDomain: boolean;
}): ResolutionKind {
  if (input.unresolved) return 'unresolved';
  if (input.ambiguous) return 'ambiguous';
  if (input.multiDomain) return 'multi_domain';
  return 'single_domain';
}

export function resolveDomainLexicon(query: string): TetaDomainLexiconResolution {
  const { catalog, lexiconSha256, registry } = loadDomainLexicon();
  const { normalized, matches } = matchLexiconEntries(query, catalog.entries);
  const conceptIds = new Set(matches.map((m) => m.entry.conceptId));
  if (
    /\b\d{3,5}\b/.test(normalized.normalizedExact) &&
    /(składnik|skladnik|wz[oó]r|zależy|zalezy|używany|uzywany)/i.test(normalized.normalizedExact)
  ) {
    conceptIds.add('payroll_component');
  }
  const rules = matchOperationRules(normalized, catalog.operationRules, conceptIds).sort((a, b) => {
    const conceptDiff = b.requiredConcepts.length - a.requiredConcepts.length;
    if (conceptDiff !== 0) return conceptDiff;
    return a.ruleId.localeCompare(b.ruleId);
  });
  const domainSignals = matchDomainRegistrySignals(
    normalized.normalizedExact,
    normalized.normalizedDiacriticFolded,
    registry.domains,
  );
  const scope = classifyScope(query);
  const diagnostics: string[] = [];
  if (normalized.tokens.length > 500) diagnostics.push('too_many_tokens');
  if (normalized.normalizedExact === 'stawka') diagnostics.push('ambiguous_stawka');
  if (normalized.normalizedExact === 'lista') diagnostics.push('unresolved_lista');

  const uniqueConcepts = [...new Map(matches.map((m) => [m.entry.conceptId, m])).values()];
  const conceptDomainIds = [...new Set(uniqueConcepts.map((m) => m.entry.domain))];
  const signalDomainIds = domainSignals.map((d) => d.domainId);
  const nonCoreRules = rules.filter((r) => r.domain !== 'core');
  const coreOnlyRules = rules.filter((r) => r.domain === 'core');
  const ruleDomainIds = [...new Set(nonCoreRules.map((r) => r.domain).filter((d) => d && d !== 'core'))];
  const domainIds = [...new Set([...conceptDomainIds, ...signalDomainIds, ...ruleDomainIds])].sort();
  const topRule = (nonCoreRules[0] ?? null) as (typeof rules)[0] | null;
  const capabilityRule =
    [...nonCoreRules, ...coreOnlyRules].find((r) => !!r.mapsTo.capability) ??
    topRule ??
    coreOnlyRules[0] ??
    null;
  const multiDomain = domainIds.length > 1;
  const hasRoutableEvidence =
    uniqueConcepts.length > 0 || nonCoreRules.length > 0 || domainSignals.length > 0;
  // Competing interpretations ≠ coexisting multi-domain recognition.
  const competingConcepts = uniqueConcepts.length > 1 && !topRule && !multiDomain;
  const ambiguousToken = diagnostics.includes('ambiguous_stawka');
  const ambiguous = ambiguousToken || competingConcepts;
  // Core-only operation matches without domain/concept evidence do not resolve routing.
  const unresolved = !hasRoutableEvidence && !ambiguous;

  const mapping: TetaDomainLexiconResolution['mapping'] = {
    intent: topRule?.mapsTo.intent ?? null,
    subject: topRule?.mapsTo.subject ?? (uniqueConcepts[0]?.entry.conceptId ?? null),
    focus: topRule?.mapsTo.focus ?? null,
    capability: capabilityRule?.mapsTo.capability ?? null,
    capabilityStatus:
      capabilityRule?.mapsTo.capabilityStatus ??
      topRule?.mapsTo.capabilityStatus ??
      (multiDomain || (domainSignals.length > 0 && uniqueConcepts.length === 0)
        ? 'recognized_but_not_routed'
        : null),
    scope: topRule?.mapsTo.scope ?? scope,
    operationId: capabilityRule?.ruleId ?? topRule?.ruleId ?? coreOnlyRules[0]?.ruleId ?? null,
    routingStatus: 'unresolved',
  };

  if (
    /jak jest liczony|jaka jest formuła|wz[oó]r/.test(normalized.normalizedExact) &&
    /gdzie jest używany|gdzie uzywany|na co wpływa|na co wplywa/.test(normalized.normalizedExact)
  ) {
    mapping.focus = 'full';
  }
  if (
    normalized.normalizedExact.includes('numer pracownika') ||
    normalized.normalizedExact.includes('numer ewidencyjny')
  ) {
    mapping.scope = 'recognized_but_not_routed';
    mapping.subject = 'employee_number';
  }
  const hasPayrollConcept = conceptIds.has('payroll_component') || conceptIds.has('payroll_list');
  const hasHrConcept = conceptIds.has('employee') || conceptIds.has('employee_number');
  if (hasHrConcept && !hasPayrollConcept) {
    mapping.scope = 'recognized_but_not_routed';
  }
  if (
    normalized.normalizedExact.includes('szkolenie bhp') ||
    normalized.normalizedExact.includes('szkolenia bhp') ||
    normalized.normalizedExact.includes('badania bhp')
  ) {
    mapping.scope = 'recognized_but_not_routed';
  }
  if (/pokaż konfigurację składnika|pokaz konfiguracje skladnika/.test(normalized.normalizedExact)) {
    mapping.focus = 'full';
    mapping.intent = 'inspect_payroll_component';
    mapping.scope = 'client_payroll_configuration';
  }
  if (multiDomain) {
    mapping.scope = 'recognized_but_not_routed';
    if (mapping.capabilityStatus !== 'not_available_yet') {
      mapping.capabilityStatus = 'recognized_but_not_routed';
    }
  }
  if (domainSignals.length > 0 && !hasPayrollConcept && !topRule?.mapsTo.scope) {
    mapping.scope = 'recognized_but_not_routed';
    mapping.capabilityStatus = mapping.capabilityStatus ?? 'recognized_but_not_routed';
  }

  // Unresolved queries must never inherit payroll/hr domain scopes or not_available_yet.
  if (unresolved) {
    mapping.scope = 'unresolved';
    mapping.intent = null;
    mapping.subject = null;
    mapping.focus = null;
    mapping.routingStatus = 'unresolved';
    // Retain matched core operation id for diagnostics, but never claim unsupported capability
    // when subject/domain are unknown.
    if (!mapping.capability) {
      mapping.capability = coreOnlyRules[0]?.mapsTo.capability ?? null;
      mapping.operationId = coreOnlyRules[0]?.ruleId ?? mapping.operationId;
    }
    mapping.capabilityStatus = null;
  } else if (ambiguous) {
    mapping.routingStatus = 'unresolved';
    if (!mapping.subject && domainIds.length === 0) {
      mapping.capabilityStatus = null;
    }
  } else if (multiDomain || mapping.scope === 'recognized_but_not_routed') {
    mapping.routingStatus = 'recognized_but_not_routed';
  } else if (
    mapping.intent ||
    mapping.scope === 'client_payroll_configuration' ||
    mapping.scope === 'generic_payroll_knowledge'
  ) {
    mapping.routingStatus = 'routed';
  } else {
    mapping.routingStatus = 'recognized_but_not_routed';
  }

  const resolutionKind = deriveResolutionKind({ unresolved, ambiguous, multiDomain });
  const status: TetaDomainLexiconResolution['status'] = unresolved
    ? 'unresolved'
    : ambiguous
      ? 'ambiguous'
      : diagnostics.length
        ? 'resolved_with_warnings'
        : 'resolved';

  const domains = domainIds.map((domainId) => {
    const fromSignal = domainSignals.find((d) => d.domainId === domainId);
    return {
      domainId,
      confidence: (fromSignal?.confidence ??
        (multiDomain ? 'strongly_supported' : 'confirmed')) as DomainClassificationConfidence,
    };
  });

  const resolutionFingerprintSha256 = computeResolutionFingerprint({
    lexiconVersion: catalog.lexiconVersion,
    lexiconSha256,
    normalizedQuery: normalized.normalizedExact,
    matchedEntryIds: uniqueConcepts.map((m) => m.entry.entryId),
    matchedRuleIds: rules.map((r) => r.ruleId),
    mapping,
    domainIds,
  });

  return {
    contractVersion: TETA_DOMAIN_LEXICON_RESOLUTION_CONTRACT_VERSION,
    lexiconVersion: catalog.lexiconVersion,
    status,
    resolutionKind,
    normalizedQuery: normalized.normalizedExact,
    normalizedQueryDiacriticFolded: normalized.normalizedDiacriticFolded,
    domains,
    concepts: uniqueConcepts.map((m) => ({
      conceptId: m.entry.conceptId,
      domain: m.entry.domain,
      matchType: m.matchType,
      confidence: m.folded ? 'fallback_diacritic_folded' : 'exact',
      matchedText: m.matchedText,
      sourceEntryId: m.entry.entryId,
    })),
    mapping,
    candidates: uniqueConcepts.slice(1).map((m) => ({
      entryId: m.entry.entryId,
      conceptId: m.entry.conceptId,
      reason: 'same_rank_match',
    })),
    diagnostics,
    lexiconSha256,
    resolutionFingerprintSha256,
    matchedRuleIds: rules.map((r) => r.ruleId),
  };
}

export function probeNormalize(query: string): string {
  return normalizePolishText(query).normalizedExact;
}
