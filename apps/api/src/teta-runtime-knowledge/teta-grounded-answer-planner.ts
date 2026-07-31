import type {
  GroundedAnswerPlanV1,
  GroundedClaimV1,
  InternalAnswerTraceV1,
  KnowledgeAccessContextV1,
  ModelContextEnvelope,
  RetrievalHit,
  RuntimeKnowledgeUnitV1,
  RuntimeAnswerStatus,
  RuntimeRoutingReason,
  TETA_GROUNDED_ANSWER_PLAN_CONTRACT_VERSION,
  TETA_INTERNAL_ANSWER_TRACE_CONTRACT_VERSION,
  VisibleCitationV1,
} from './teta-runtime-knowledge.types';
import { opaqueToken, sha256, stableStringify } from './teta-runtime-hash';
import { fingerprintAccessContext } from './teta-source-access-policy';
import { loadPresentationConfig } from './teta-runtime-source-policy.service';
import type { TetaGroundedAnswerGenerator, GroundedAnswerGeneratorInput, GroundedAnswerGeneratorOutput } from './teta-runtime-knowledge.types';

export function buildModelContextEnvelope(claims: GroundedClaimV1[], unitsById: Map<string, RuntimeKnowledgeUnitV1>): ModelContextEnvelope {
  let cIdx = 0;
  let pIdx = 0;
  return {
    structuredEvidenceEnvelope: true,
    sanitizedClaims: claims
      .filter((c) => c.blockedReasons.length === 0)
      .map((c) => {
        const unit = unitsById.get(c.internalSupportRefs[0] ?? '');
        let placeholder: string | null = null;
        if (unit?.sourcePolicy.sourceOwnership === 'client') {
          cIdx += 1;
          placeholder = `[C${cIdx}]`;
        } else if (unit?.sourcePolicy.sourceOwnership === 'public_authority') {
          pIdx += 1;
          placeholder = `[P${pIdx}]`;
        }
        return {
          claimId: c.claimId,
          text: c.text,
          knowledgeMode: String(c.knowledgeMode),
          completeness: unit?.claim.completeness ?? 'complete',
          applicability: c.applicability,
          requiredWarnings: c.requiredDisclosure,
          citationPlaceholder: placeholder,
        };
      }),
    forbiddenDisclosurePolicy: [
      'vendor_titles',
      'vendor_paths',
      'vendor_evidence_ids',
      'vendor_source_ids',
      'reviewer_ids',
      'decision_rationale',
    ],
  };
}

export class DeterministicFixtureAnswerGenerator implements TetaGroundedAnswerGenerator {
  generate(input: GroundedAnswerGeneratorInput): GroundedAnswerGeneratorOutput {
    const texts = input.sanitizedClaims.map((c) => c.text);
    let answerText = texts.join(' ');
    const disclosures = [...input.requiredDisclosures];
    if (disclosures.includes('partiality')) {
      answerText = `${answerText} Nie mam wystarczających informacji, aby potwierdzić dalszą część procesu.`.trim();
    }
    if (disclosures.includes('conflict')) {
      answerText =
        'Dostępne informacje są niespójne w tym zakresie. Potrzebne jest dodatkowe rozstrzygnięcie.';
    }
    if (disclosures.includes('insufficient') || texts.length === 0) {
      answerText = 'Nie mam wystarczających informacji, aby odpowiedzieć na to pytanie.';
    }
    if (disclosures.includes('blocked_currentness')) {
      answerText =
        'Nie mogę potwierdzić aktualnego stanu wymagań prawnych wyłącznie na podstawie wiedzy produktowej.';
    }
    if (disclosures.includes('blocked_scope')) {
      answerText =
        'Nie mam wystarczających informacji, aby porównać te zakresy produktów. Brak dowodu w jednym zakresie nie jest dowodem różnicy.';
    }
    // Never mention knowledge base by default.
    answerText = answerText
      .replace(/\bW mojej bazie wiedzy\b/gi, '')
      .replace(/\bNa podstawie źródeł\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      answerText,
      usedClaimIds: input.sanitizedClaims.map((c) => c.claimId),
      citationPlaceholdersUsed: input.visibleCitationPlaceholders,
      disclosureFlags: disclosures,
    };
  }
}

export function selectClaimsFromHits(hits: RetrievalHit[], query: string): {
  claims: GroundedClaimV1[];
  blocked: GroundedClaimV1[];
  visibleCitations: VisibleCitationV1[];
  runtimeStatus: RuntimeAnswerStatus;
  answerability: GroundedAnswerPlanV1['answerability'];
  routingReason: RuntimeRoutingReason;
  disclosures: string[];
} {
  const claims: GroundedClaimV1[] = [];
  const blocked: GroundedClaimV1[] = [];
  const visibleCitations: VisibleCitationV1[] = [];
  const disclosures: string[] = [];

  const isHrVsEdu = /różni|różnic|hr.*edu|edu.*hr/i.test(query);
  const isKsef = /ksef/i.test(query);
  const isAuthEdu = /autoryzac/i.test(query) && /edu/i.test(query);
  const isMe = /teta me|czym jest teta me/i.test(query);

  if (isHrVsEdu) {
    disclosures.push('blocked_scope');
    return {
      claims: [],
      blocked: [
        {
          claimId: opaqueToken('claim', { q: query, kind: 'scope' }),
          text: '',
          knowledgeMode: 'blocked_by_scope',
          supportStrength: 'none',
          applicability: emptyApplicability(),
          riskClass: 'normal_product_knowledge',
          internalSupportRefs: [],
          visibleCitationRefs: [],
          requiredDisclosure: ['blocked_scope'],
          blockedReasons: ['missing_hr_evidence_is_not_difference_proof'],
        },
      ],
      visibleCitations: [],
      runtimeStatus: 'blocked_by_scope',
      answerability: 'blocked',
      routingReason: 'runtime_knowledge_blocked',
      disclosures,
    };
  }

  if (isKsef) {
    // Vendor-only legal/currentness — block.
    const legalHits = hits.filter((h) => h.unit.riskClass === 'legal_or_regulatory' || /ksef/i.test(h.unit.claim.answerableText));
    const hasPublicCurrent = hits.some(
      (h) =>
        h.unit.sourcePolicy.sourceOwnership === 'public_authority' &&
        h.unit.applicability.currentnessStatus === 'verified_for_scope',
    );
    if (!hasPublicCurrent) {
      disclosures.push('blocked_currentness');
      return {
        claims: [],
        blocked: [
          {
            claimId: opaqueToken('claim', { q: query, kind: 'currentness' }),
            text: '',
            knowledgeMode: 'blocked_by_currentness',
            supportStrength: 'none',
            applicability: emptyApplicability(),
            riskClass: 'legal_or_regulatory',
            internalSupportRefs: legalHits.map((h) => h.unit.runtimeKnowledgeUnitId),
            visibleCitationRefs: [],
            requiredDisclosure: ['blocked_currentness'],
            blockedReasons: ['legal_claim_requires_public_authority_currentness'],
          },
        ],
        visibleCitations: [],
        runtimeStatus: 'blocked_by_currentness',
        answerability: 'blocked',
        routingReason: 'runtime_knowledge_blocked',
        disclosures,
      };
    }
  }

  for (const hit of hits.slice(0, 8)) {
    const unit = hit.unit;

    if (unit.riskClass === 'legal_or_regulatory' && unit.sourcePolicy.sourceOwnership === 'vendor') {
      blocked.push(makeBlocked(unit, ['legal_from_vendor_only'], 'blocked_by_currentness'));
      continue;
    }
    if (
      unit.sourcePolicy.sourceOwnership === 'public_authority' &&
      unit.applicability.currentnessStatus !== 'verified_for_scope'
    ) {
      blocked.push(makeBlocked(unit, ['stale_public_authority'], 'blocked_by_currentness'));
      disclosures.push('currentness');
      continue;
    }
    if (unit.riskClass === 'payroll_sensitive' && /gwarant|wynik nalicz|kwot[ae]/i.test(query)) {
      blocked.push(makeBlocked(unit, ['payroll_outcome_forbidden'], 'insufficient_knowledge'));
      continue;
    }
    if (
      unit.riskClass === 'configuration_sensitive' &&
      /klient ma|wasza konfigur|u klienta/i.test(query)
    ) {
      blocked.push(makeBlocked(unit, ['client_config_without_client_evidence'], 'insufficient_knowledge'));
      continue;
    }

    const claim: GroundedClaimV1 = {
      claimId: opaqueToken('claim', unit.runtimeKnowledgeRevisionId),
      text: unit.claim.answerableText,
      knowledgeMode: unit.knowledgeMode,
      supportStrength: unit.knowledgeMode === 'approved_canonical' ? 'strong' : unit.knowledgeMode === 'source_backed_direct' ? 'strong' : 'partial',
      applicability: unit.applicability,
      riskClass: unit.riskClass,
      internalSupportRefs: [unit.runtimeKnowledgeUnitId],
      visibleCitationRefs: [],
      requiredDisclosure: unit.answerPolicy.mustDisclosePartiality ? ['partiality'] : [],
      blockedReasons: [],
    };

    if (unit.visibleCitationDescriptor && unit.sourcePolicy.sourceOwnership !== 'vendor') {
      visibleCitations.push(unit.visibleCitationDescriptor);
      claim.visibleCitationRefs.push(unit.visibleCitationDescriptor.citationId);
    }

    if (unit.answerPolicy.mustDisclosePartiality) disclosures.push('partiality');
    claims.push(claim);
  }

  if (isAuthEdu) {
    // Authorization procedure is not fully supported — keep only partial subset or insufficient.
    const edu = claims.filter(
      (c) =>
        c.applicability.productFamilyIds.includes('teta_edu') &&
        /autoryz|uprawn|logowan|dost[eę]p|rola|permission|access/i.test(c.text),
    );
    if (!edu.length) {
      disclosures.push('insufficient');
      return {
        claims: [],
        blocked,
        visibleCitations: [],
        runtimeStatus: 'insufficient_knowledge',
        answerability: 'insufficient',
        routingReason: 'insufficient_runtime_knowledge',
        disclosures,
      };
    }
    // Mark as partial — do not present full authorization procedure.
    for (const c of edu) {
      c.knowledgeMode = 'source_backed_partial';
      c.supportStrength = 'partial';
      c.requiredDisclosure = [...new Set([...c.requiredDisclosure, 'partiality'])];
    }
    disclosures.push('partiality');
    const selectedEdu = edu.slice(0, 2);
    const citationIds = new Set(selectedEdu.flatMap((c) => c.visibleCitationRefs));
    return {
      claims: selectedEdu,
      blocked,
      visibleCitations: visibleCitations.filter((c) => citationIds.has(c.citationId)),
      runtimeStatus: 'source_backed_partial',
      answerability: 'partially_answerable',
      routingReason: 'partial_runtime_knowledge',
      disclosures,
    };
  }

  if (!claims.length) {
    disclosures.push('insufficient');
    return {
      claims: [],
      blocked,
      visibleCitations: [],
      runtimeStatus: 'insufficient_knowledge',
      answerability: 'insufficient',
      routingReason: 'insufficient_runtime_knowledge',
      disclosures,
    };
  }

  const hasApproved = claims.some((c) => c.knowledgeMode === 'approved_canonical');
  const hasDirect = claims.some((c) => c.knowledgeMode === 'source_backed_direct');
  const hasPartial = claims.some((c) => c.knowledgeMode === 'source_backed_partial' || c.requiredDisclosure.includes('partiality'));

  if (isMe && hasApproved) {
    return {
      claims: claims.filter((c) => c.knowledgeMode === 'approved_canonical').slice(0, 1),
      blocked,
      visibleCitations: [],
      runtimeStatus: 'approved_canonical',
      answerability: 'answerable',
      routingReason: 'approved_runtime_knowledge',
      disclosures: [],
    };
  }

  if (hasPartial && !hasApproved) {
    disclosures.push('partiality');
    return {
      claims,
      blocked,
      visibleCitations,
      runtimeStatus: 'source_backed_partial',
      answerability: 'partially_answerable',
      routingReason: 'partial_runtime_knowledge',
      disclosures,
    };
  }

  if (hasApproved) {
    return {
      claims,
      blocked,
      visibleCitations,
      runtimeStatus: 'approved_canonical',
      answerability: 'answerable',
      routingReason: 'approved_runtime_knowledge',
      disclosures,
    };
  }

  return {
    claims,
    blocked,
    visibleCitations,
    runtimeStatus: hasDirect ? 'source_backed_direct' : 'source_backed_partial',
    answerability: hasDirect ? 'answerable' : 'partially_answerable',
    routingReason: hasDirect ? 'source_backed_runtime_knowledge' : 'partial_runtime_knowledge',
    disclosures,
  };
}

function emptyApplicability(): RuntimeKnowledgeUnitV1['applicability'] {
  return {
    platformId: null,
    productFamilyIds: [],
    productSurfaceIds: [],
    domainIds: [],
    businessAreaIds: [],
    productVersionHints: [],
    temporalContextIds: [],
    clientScope: 'not_applicable',
    currentnessStatus: 'not_applicable',
  };
}

function makeBlocked(unit: RuntimeKnowledgeUnitV1, reasons: string[], mode: RuntimeAnswerStatus): GroundedClaimV1 {
  return {
    claimId: opaqueToken('claim', { u: unit.runtimeKnowledgeUnitId, reasons }),
    text: unit.claim.answerableText,
    knowledgeMode: mode,
    supportStrength: 'none',
    applicability: unit.applicability,
    riskClass: unit.riskClass,
    internalSupportRefs: [unit.runtimeKnowledgeUnitId],
    visibleCitationRefs: [],
    requiredDisclosure: reasons,
    blockedReasons: reasons,
  };
}

export function buildGroundedAnswerPlan(opts: {
  query: string;
  hits: RetrievalHit[];
  accessContext?: KnowledgeAccessContextV1 | null;
  productContext?: Record<string, unknown>;
}): { plan: GroundedAnswerPlanV1; trace: InternalAnswerTraceV1; modelContext: ModelContextEnvelope } {
  const selected = selectClaimsFromHits(opts.hits, opts.query);
  const unitsById = new Map(opts.hits.map((h) => [h.unit.runtimeKnowledgeUnitId, h.unit]));
  const modelContext = buildModelContextEnvelope(selected.claims, unitsById);
  const presentationCfg = loadPresentationConfig();
  const vendorOnly = selected.visibleCitations.length === 0;

  const planMaterial = {
    query: opts.query,
    claims: selected.claims.map((c) => c.claimId),
    answerability: selected.answerability,
  };
  const answerPlanId = opaqueToken('answer-plan', planMaterial);
  const internalTraceId = opaqueToken('internal-trace', { answerPlanId, units: [...unitsById.keys()] });

  const plan: GroundedAnswerPlanV1 = {
    contractVersion: 'teta-grounded-answer-plan-v1' as typeof TETA_GROUNDED_ANSWER_PLAN_CONTRACT_VERSION,
    answerPlanId,
    query: {
      normalizedIntent: opts.query.trim(),
      productContext: opts.productContext ?? {},
      accessContextFingerprintSha256: sha256(fingerprintAccessContext(opts.accessContext)),
    },
    answerability: selected.answerability,
    claims: selected.claims,
    visibleCitations: selected.visibleCitations,
    internalTraceId,
    presentation: {
      answerNaturally: Boolean((presentationCfg.vendorOnly as { answerNaturally?: boolean })?.answerNaturally ?? true),
      mentionKnowledgeBaseByDefault: false,
      mustDisclosePartiality: selected.disclosures.includes('partiality'),
      mustDiscloseCurrentness: selected.disclosures.includes('currentness') || selected.disclosures.includes('blocked_currentness'),
      mustDiscloseConflict: selected.disclosures.includes('conflict'),
      mustAskClarifyingQuestion: selected.runtimeStatus === 'blocked_by_scope',
    },
    warnings: vendorOnly ? [] : [],
    routingReason: selected.routingReason,
    runtimeStatus: selected.runtimeStatus,
  };

  const approvedRefs: string[] = [];
  const candidateRefs: string[] = [];
  const evidenceRefs: string[] = [];
  const sourceRevisionRefs: string[] = [];
  const decisionRefs: string[] = [];

  for (const hit of opts.hits) {
    // Provenance stays opaque in client path; trace keeps unit refs.
  }

  const trace: InternalAnswerTraceV1 = {
    contractVersion: 'teta-internal-answer-trace-v1' as typeof TETA_INTERNAL_ANSWER_TRACE_CONTRACT_VERSION,
    internalTraceId,
    answerPlanId,
    runtimeKnowledgeUnitRefs: selected.claims.flatMap((c) => c.internalSupportRefs),
    approvedRecordRefs: approvedRefs,
    candidateOccurrenceRefs: candidateRefs,
    evidenceRefs,
    sourceRevisionRefs,
    decisionEventRefs: decisionRefs,
    accessDecisions: [],
    visibilityDecisions: selected.visibleCitations.map((c) => ({
      citationId: c.citationId,
      ownership: c.sourceOwnership,
      accessConfirmed: c.accessConfirmed,
    })),
    blockedClaims: selected.blocked,
    renderFingerprintSha256: '',
  };

  return { plan, trace, modelContext };
}

export function renderVisibleCitationPrefix(citation: VisibleCitationV1): string {
  if (citation.sourceOwnership === 'public_authority') {
    const art = citation.articleLabel ? ` ${citation.articleLabel}` : '';
    return `Zgodnie z${art} ${citation.displayTitle}`.replace(/\s+/g, ' ').trim();
  }
  const section = citation.sectionLabel ? ` ${citation.sectionLabel}` : '';
  return `Zgodnie z${section} ${citation.displayTitle}`.replace(/\s+/g, ' ').trim();
}

export function applyCitationPlaceholders(
  answer: string,
  plan: GroundedAnswerPlanV1,
  placeholders: string[],
): string {
  let out = answer;
  for (let i = 0; i < placeholders.length; i++) {
    const ph = placeholders[i];
    const citation = plan.visibleCitations[i];
    if (!citation) continue;
    const prefix = renderVisibleCitationPrefix(citation);
    if (out.includes(ph)) {
      out = out.replace(ph, prefix);
    } else if (!out.includes(citation.displayTitle)) {
      // Deterministic prepend for client/public claims when generator omitted placeholder.
      out = `${prefix}: ${out}`;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function finalizeTraceRenderFingerprint(trace: InternalAnswerTraceV1, answer: string, payload: unknown): InternalAnswerTraceV1 {
  return {
    ...trace,
    renderFingerprintSha256: sha256(stableStringify({ answer, payload, traceId: trace.internalTraceId })),
  };
}
