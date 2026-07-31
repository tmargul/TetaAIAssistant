import { sha256, stableStringify } from './teta-runtime-hash';
import type {
  Answerability,
  GroundedAnswerPlanV1,
  GroundedClaimV1,
} from './teta-runtime-knowledge.types';

export type SanitizedModelClaim = {
  claimId: string;
  text: string;
  knowledgeMode: 'approved_canonical' | 'source_backed_direct' | 'source_backed_partial';
  completeness: 'complete' | 'partial';
  applicabilitySummary: string;
  requiredDisclosures: string[];
  /** Opaque ownership class for policy only — never a source title/path. */
  sourceOwnershipClass: 'vendor_hidden' | 'client' | 'public_authority' | 'unknown';
  paraphraseRequired: boolean;
  claimExpansionPolicy: 'allowed_natural' | 'forbidden';
};

export type SanitizedModelInputEnvelope = {
  query: string;
  answerability: Answerability;
  claims: SanitizedModelClaim[];
  visibleCitationPlaceholders: string[];
  presentationRules: {
    answerNaturally: true;
    mentionKnowledgeBaseByDefault: false;
    doNotInventMissingSteps: true;
    doNotExposeInternalSources: true;
    doNotDiscussInternalProvenance: true;
    paraphraseVendorSourceBackedClaims: true;
    claimExpansionPolicyDefault: 'forbidden_for_public_authority';
  };
};

export type StructuredModelAnswer = {
  answer: string;
  usedClaimIds: string[];
  usedCitationPlaceholders: string[];
  disclosuresApplied: string[];
};

const FORBIDDEN_INPUT_MARKERS = [
  'sourceRevisionId',
  'evidenceEntryId',
  'contentUnitId',
  'assetRef',
  'reviewPackId',
  'reviewerId',
  'decision rationale',
  'internalTraceId',
  'runtimeKnowledgeUnitId',
  'vendor-audit',
];

const TECHNICAL_TERMS = [
  'source_backed',
  'approved_canonical',
  'evidence',
  'runtime unit',
  'stage 3j',
  'vendor',
  'internal trace',
  'runtimeknowledge',
  'dostarczonych claims',
  'claims',
  'sourcerevision',
  'knowledge mode',
  'knowledgemode',
];

export function summarizeApplicability(claim: GroundedClaimV1): string {
  const parts: string[] = [];
  if (claim.applicability.productFamilyIds.length) {
    parts.push(`productFamily=${claim.applicability.productFamilyIds.join(',')}`);
  }
  if (claim.applicability.productSurfaceIds.length) {
    parts.push(`productSurface=${claim.applicability.productSurfaceIds.join(',')}`);
  }
  if (claim.applicability.domainIds.length) {
    parts.push(`domain=${claim.applicability.domainIds.join(',')}`);
  }
  parts.push(`clientScope=${claim.applicability.clientScope}`);
  parts.push(`currentness=${claim.applicability.currentnessStatus}`);
  return parts.join('; ');
}

function ownershipClassForClaim(
  claim: GroundedClaimV1,
  plan: GroundedAnswerPlanV1,
): SanitizedModelClaim['sourceOwnershipClass'] {
  const visible = plan.visibleCitations.find((v) => claim.visibleCitationRefs.includes(v.citationId));
  if (visible?.sourceOwnership === 'client') return 'client';
  if (visible?.sourceOwnership === 'public_authority') return 'public_authority';
  if (
    claim.knowledgeMode === 'approved_canonical' ||
    claim.knowledgeMode === 'source_backed_direct' ||
    claim.knowledgeMode === 'source_backed_partial'
  ) {
    return 'vendor_hidden';
  }
  return 'unknown';
}

export function buildSanitizedModelInput(opts: {
  query: string;
  plan: GroundedAnswerPlanV1;
  citationPlaceholders?: string[];
}): { envelope: SanitizedModelInputEnvelope; fingerprintSha256: string; hiddenMetadataSent: number } {
  const claims: SanitizedModelClaim[] = opts.plan.claims
    .filter((c) => c.blockedReasons.length === 0)
    .map((c) => {
      const ownership = ownershipClassForClaim(c, opts.plan);
      const knowledgeMode =
        c.knowledgeMode === 'approved_canonical' ||
        c.knowledgeMode === 'source_backed_direct' ||
        c.knowledgeMode === 'source_backed_partial'
          ? c.knowledgeMode
          : 'source_backed_partial';
      const paraphraseRequired =
        ownership === 'vendor_hidden' &&
        (knowledgeMode === 'source_backed_direct' || knowledgeMode === 'source_backed_partial');
      return {
        claimId: c.claimId,
        text: c.text,
        knowledgeMode,
        completeness:
          c.supportStrength === 'partial' || c.requiredDisclosure.includes('partiality') ? 'partial' : 'complete',
        applicabilitySummary: summarizeApplicability(c),
        requiredDisclosures: [...c.requiredDisclosure],
        sourceOwnershipClass: ownership,
        paraphraseRequired,
        claimExpansionPolicy: ownership === 'public_authority' ? 'forbidden' : 'allowed_natural',
      };
    });

  const placeholders =
    opts.citationPlaceholders ??
    opts.plan.visibleCitations.map((_, i) => {
      const ownership = opts.plan.visibleCitations[i]?.sourceOwnership;
      return ownership === 'public_authority' ? `[P${i + 1}]` : `[C${i + 1}]`;
    });

  const envelope: SanitizedModelInputEnvelope = {
    query: opts.query,
    answerability: opts.plan.answerability,
    claims,
    visibleCitationPlaceholders: placeholders,
    presentationRules: {
      answerNaturally: true,
      mentionKnowledgeBaseByDefault: false,
      doNotInventMissingSteps: true,
      doNotExposeInternalSources: true,
      doNotDiscussInternalProvenance: true,
      paraphraseVendorSourceBackedClaims: true,
      claimExpansionPolicyDefault: 'forbidden_for_public_authority',
    },
  };

  const blob = stableStringify(envelope);
  let hiddenMetadataSent = 0;
  for (const m of FORBIDDEN_INPUT_MARKERS) {
    if (blob.toLowerCase().includes(m.toLowerCase())) hiddenMetadataSent += 1;
  }

  return {
    envelope,
    fingerprintSha256: sha256(blob),
    hiddenMetadataSent,
  };
}

export function mayCallModelForAnswerability(answerability: Answerability): boolean {
  return answerability === 'answerable' || answerability === 'partially_answerable';
}

export function mayCallModelForPlan(plan: GroundedAnswerPlanV1): {
  allowed: boolean;
  reason: 'allowed' | 'insufficient' | 'blocked';
} {
  if (plan.answerability === 'insufficient') return { allowed: false, reason: 'insufficient' };
  if (plan.answerability === 'blocked') return { allowed: false, reason: 'blocked' };
  if (!mayCallModelForAnswerability(plan.answerability)) return { allowed: false, reason: 'blocked' };
  return { allowed: true, reason: 'allowed' };
}

export function validateStructuredModelAnswer(
  output: StructuredModelAnswer,
  envelope: SanitizedModelInputEnvelope,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!output.answer || !output.answer.trim()) errors.push('empty_answer');
  const claimIds = new Set(envelope.claims.map((c) => c.claimId));
  for (const id of output.usedClaimIds ?? []) {
    if (!claimIds.has(id)) errors.push(`unknown_claim_id:${id}`);
  }
  const placeholders = new Set(envelope.visibleCitationPlaceholders);
  for (const ph of output.usedCitationPlaceholders ?? []) {
    if (!placeholders.has(ph)) errors.push(`unknown_citation_placeholder:${ph}`);
  }
  const required = new Set(envelope.claims.flatMap((c) => c.requiredDisclosures));
  if (required.has('partiality')) {
    const applied = (output.disclosuresApplied ?? []).includes('partiality');
    const textHas =
      /nie mam wystarczających|niekomplet|częściow|czesciow|dalsz|nie\s+mam\s+jednak/i.test(output.answer) ||
      (output.disclosuresApplied ?? []).includes('partiality');
    if (!applied && !textHas) errors.push('missing_partiality_disclosure');
  }
  return { ok: errors.length === 0, errors };
}

export function detectInternalTechnicalTerms(answer: string): string[] {
  const lower = answer.toLowerCase();
  return TECHNICAL_TERMS.filter((t) => lower.includes(t));
}

/** Redact client-visible technical jargon; returns cleaned text + residual hits. */
export function redactInternalTechnicalTerms(answer: string): { text: string; residual: string[] } {
  let text = answer;
  const replacements: Array<[RegExp, string]> = [
    [/\bapproved_canonical\b/gi, ''],
    [/\bsource_backed(?:_direct|_partial)?\b/gi, ''],
    [/\bruntime\s*unit\b/gi, ''],
    [/\bstage\s*3j(?:\.\d+[a-z])?\b/gi, ''],
    [/\binternal\s*trace\b/gi, ''],
    [/\bruntimeknowledge\b/gi, ''],
    [/\bsourceRevision(?:Id)?\b/gi, ''],
    [/\bknowledge\s*mode\b/gi, ''],
    [/\bdostarczonych\s+claims\b/gi, 'dostarczonych informacjach'],
    [/\bclaims\b/gi, 'informacjach'],
    [/\bevidence\b/gi, 'danych źródłowych'],
    [/\bvendor\b/gi, ''],
  ];
  for (const [re, rep] of replacements) {
    text = text.replace(re, rep);
  }
  text = text.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  return { text, residual: detectInternalTechnicalTerms(text) };
}

export function stripUnknownCitationPlaceholders(answer: string, allowed: string[]): string {
  return answer.replace(/\[([CP]\d+)\]/g, (full) => (allowed.includes(full) ? full : '')).replace(/\s{2,}/g, ' ').trim();
}

export function parseStructuredModelAnswer(raw: string): StructuredModelAnswer {
  const trimmed = raw.trim();
  let jsonText = trimmed;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonText = fence[1]!.trim();
  const parsed = JSON.parse(jsonText) as Partial<StructuredModelAnswer>;
  return {
    answer: String(parsed.answer ?? ''),
    usedClaimIds: Array.isArray(parsed.usedClaimIds) ? parsed.usedClaimIds.map(String) : [],
    usedCitationPlaceholders: Array.isArray(parsed.usedCitationPlaceholders)
      ? parsed.usedCitationPlaceholders.map(String)
      : [],
    disclosuresApplied: Array.isArray(parsed.disclosuresApplied)
      ? parsed.disclosuresApplied.map(String)
      : [],
  };
}
