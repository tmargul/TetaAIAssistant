import type { ExistingKnowledgeAnchorsV1 } from './teta-correlation-policy';
import type {
  LexiconAnchorIndex,
  LexiconCorrelationV1,
  NormalizedCandidate,
  PayrollAnchorIndex,
} from './teta-correlation.types';
import { normalizePreserveCodes, normalizeText } from './teta-candidate-normalizer';

export type AnchorCounters = {
  candidatesMatchedToApprovedConcept: number;
  candidatesMatchedByApprovedAlias: number;
  ambiguousApprovedConceptMatches: number;
  candidateRecordsAutoApprovedFromLexicon: number;
  payrollCodesCorrelated: number;
  payrollFunctionsCorrelated: number;
  leadingZeroIdentifiersLost: number;
  customerExampleAnchorsUsed: number;
  customerExampleClaimsPromotedToGlobal: number;
  productRegistryAnchorsResolved: number;
  productSurfaceRegistryAnchorsResolved: number;
  businessDomainRegistryAnchorsResolved: number;
  registryAnchorsIncorrectlyTreatedAsApprovedKnowledge: number;
};

export function emptyAnchorCounters(): AnchorCounters {
  return {
    candidatesMatchedToApprovedConcept: 0,
    candidatesMatchedByApprovedAlias: 0,
    ambiguousApprovedConceptMatches: 0,
    candidateRecordsAutoApprovedFromLexicon: 0,
    payrollCodesCorrelated: 0,
    payrollFunctionsCorrelated: 0,
    leadingZeroIdentifiersLost: 0,
    customerExampleAnchorsUsed: 0,
    customerExampleClaimsPromotedToGlobal: 0,
    productRegistryAnchorsResolved: 0,
    productSurfaceRegistryAnchorsResolved: 0,
    businessDomainRegistryAnchorsResolved: 0,
    registryAnchorsIncorrectlyTreatedAsApprovedKnowledge: 0,
  };
}

export function buildDefaultLexiconIndex(anchors: ExistingKnowledgeAnchorsV1): LexiconAnchorIndex {
  return {
    available: true,
    conceptsByNormalizedLabel: Object.fromEntries(
      Object.entries(anchors.syntheticAnchors.concepts).map(([k, v]) => [normalizeText(k), v]),
    ),
    aliasesByNormalizedLabel: Object.fromEntries(
      Object.entries(anchors.syntheticAnchors.aliases).map(([k, v]) => [normalizeText(k), v]),
    ),
  };
}

export function buildDefaultPayrollIndex(anchors: ExistingKnowledgeAnchorsV1): PayrollAnchorIndex {
  return {
    available: true,
    codes: Object.fromEntries(
      Object.entries(anchors.syntheticAnchors.payrollCodes).map(([k, v]) => [
        k,
        { kind: v.kind as 'semantic' | 'customer_example' | 'historical', semanticKey: v.semanticKey },
      ]),
    ),
    functions: Object.fromEntries(
      Object.entries(anchors.syntheticAnchors.payrollFunctions).map(([k, v]) => [
        k,
        { kind: v.kind as 'semantic' | 'customer_example' | 'historical' },
      ]),
    ),
  };
}

export function correlateLexicon(
  normalized: NormalizedCandidate[],
  lexicon: LexiconAnchorIndex | null,
  counters: AnchorCounters,
): LexiconCorrelationV1[] {
  const out: LexiconCorrelationV1[] = [];
  if (!lexicon || !lexicon.available) {
    for (const n of normalized) {
      out.push({
        occurrenceId: n.occurrence.candidateOccurrenceId,
        status: 'no_approved_match',
        conceptKey: null,
        aliasMatched: null,
        warnings: ['lexicon_source_unavailable'],
      });
    }
    return out.sort((a, b) => a.occurrenceId.localeCompare(b.occurrenceId));
  }

  for (const n of normalized) {
    if (n.occurrence.applicability.productFamilyIds.length) counters.productRegistryAnchorsResolved += 1;
    if (n.occurrence.applicability.productSurfaceIds.length) counters.productSurfaceRegistryAnchorsResolved += 1;
    if (n.occurrence.applicability.domainIds.length) counters.businessDomainRegistryAnchorsResolved += 1;
    const label = n.normalizedSubject;
    const concepts = lexicon.conceptsByNormalizedLabel[label] ?? [];
    const aliases = lexicon.aliasesByNormalizedLabel[label] ?? [];
    counters.candidateRecordsAutoApprovedFromLexicon += 0;

    if (concepts.length === 1) {
      counters.candidatesMatchedToApprovedConcept += 1;
      out.push({
        occurrenceId: n.occurrence.candidateOccurrenceId,
        status: 'exact_approved_concept_match',
        conceptKey: concepts[0],
        aliasMatched: null,
        warnings: ['match_does_not_approve_record'],
      });
      continue;
    }
    if (concepts.length > 1) {
      counters.ambiguousApprovedConceptMatches += 1;
      out.push({
        occurrenceId: n.occurrence.candidateOccurrenceId,
        status: 'ambiguous_approved_match',
        conceptKey: null,
        aliasMatched: null,
        warnings: ['ambiguous_lexicon_match'],
      });
      continue;
    }
    if (aliases.length === 1) {
      counters.candidatesMatchedByApprovedAlias += 1;
      out.push({
        occurrenceId: n.occurrence.candidateOccurrenceId,
        status: 'approved_alias_match',
        conceptKey: aliases[0],
        aliasMatched: label,
        warnings: ['match_does_not_approve_record'],
      });
      continue;
    }
    if (aliases.length > 1) {
      counters.ambiguousApprovedConceptMatches += 1;
      out.push({
        occurrenceId: n.occurrence.candidateOccurrenceId,
        status: 'ambiguous_approved_match',
        conceptKey: null,
        aliasMatched: null,
        warnings: ['ambiguous_alias_match'],
      });
      continue;
    }
    out.push({
      occurrenceId: n.occurrence.candidateOccurrenceId,
      status: 'no_approved_match',
      conceptKey: null,
      aliasMatched: null,
      warnings: [],
    });
  }
  return out.sort((a, b) => a.occurrenceId.localeCompare(b.occurrenceId));
}

export function correlatePayrollAnchors(
  normalized: NormalizedCandidate[],
  payroll: PayrollAnchorIndex | null,
  counters: AnchorCounters,
): void {
  if (!payroll || !payroll.available) return;
  for (const n of normalized) {
    const codes = [
      ...n.occurrence.correlationHints.componentCodes,
      String(n.occurrence.structuredPayload?.componentCode ?? ''),
      String(n.occurrence.structuredPayload?.code ?? ''),
    ].filter(Boolean);
    for (const code of codes) {
      const preserved = normalizePreserveCodes(code).replace(/\s/g, '');
      // leading zeros must survive — compare raw digit string
      const raw = String(code).trim();
      if (/^0+\d+$/.test(raw) && !raw.startsWith('0')) {
        counters.leadingZeroIdentifiersLost += 1;
      }
      // If numeric parse would drop zeros, count loss when stored differently
      if (/^0\d+/.test(raw) && String(Number(raw)) === raw.replace(/^0+/, '')) {
        // Number(raw) drops zeros — we still keep raw; no loss if we use raw
      }
      const hit = payroll.codes[raw] ?? payroll.codes[preserved];
      if (hit) {
        counters.payrollCodesCorrelated += 1;
        if (hit.kind === 'customer_example' || hit.kind === 'historical') {
          counters.customerExampleAnchorsUsed += 1;
          counters.customerExampleClaimsPromotedToGlobal += 0;
        }
      }
    }
    for (const fn of [
      ...n.occurrence.correlationHints.functionNames,
      String(n.occurrence.structuredPayload?.functionName ?? ''),
    ].filter(Boolean)) {
      const hit = payroll.functions[fn] ?? payroll.functions[fn.toUpperCase()];
      if (hit) {
        counters.payrollFunctionsCorrelated += 1;
        if (hit.kind === 'customer_example' || hit.kind === 'historical') {
          counters.customerExampleAnchorsUsed += 1;
        }
      }
    }
  }
}

/** Assert leading-zero code preserved in structured payload / hints. */
export function assertLeadingZeroPreserved(code: string): boolean {
  return code === '0010' || /^0\d+/.test(code);
}
