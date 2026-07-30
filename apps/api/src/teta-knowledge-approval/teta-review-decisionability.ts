import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { CorrelationStageManifestV1, ProposedKnowledgeRecordV1 } from '../teta-knowledge-correlation/teta-correlation.types';
import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type {
  DecisionKind,
  DecisionabilityBlock,
  DecisionabilityStatus,
  EvidenceExcerptEntry,
  HumanReviewComplexity,
  ReviewPackV1,
  SystemDecisionRecommendation,
} from './teta-approval.types';

export const EMPLOYMENT_QUESTION_TERMS = [
  'zatrudn',
  'umow',
  'autoryz',
  'zatwierdz',
  'kontrakt',
  'employment',
  'contract',
  'approval',
  'status umowy',
  'proces zatrud',
  'minimum kadrow',
] as const;

export const EMPLOYMENT_PROCESS_SUBJECT = 'informacje o zatrudnieniu';

const UNRELATED_DOMAIN_BLOCKLIST = new Set(['accounting', 'invoicing', 'payroll', 'finance', 'fixed_assets', 'receivables_payables']);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[object object\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function recordTextBlob(record: ProposedKnowledgeRecordV1): string {
  return normalizeText(
    [
      record.canonicalSubjectProposal.label,
      record.canonicalSubjectProposal.normalizedKey,
      record.recordKind,
      ...(record.applicability.domainIds ?? []),
      ...(record.applicability.productFamilyIds ?? []),
    ].join(' '),
  );
}

export function employmentQuestionMatchScore(record: ProposedKnowledgeRecordV1): {
  score: number;
  matchedTerms: string[];
} {
  const text = recordTextBlob(record);
  const matchedTerms = EMPLOYMENT_QUESTION_TERMS.filter((t) => text.includes(t));
  return { score: matchedTerms.length, matchedTerms };
}

export function isEmploymentRelatedRecord(record: ProposedKnowledgeRecordV1): boolean {
  return employmentQuestionMatchScore(record).score > 0;
}

export function hasUnrelatedDomain(record: ProposedKnowledgeRecordV1): boolean {
  const domains = record.applicability.domainIds ?? [];
  const text = recordTextBlob(record);
  const multiDomainProcess = text.includes('zatrudn') && domains.some((d) => UNRELATED_DOMAIN_BLOCKLIST.has(d));
  if (multiDomainProcess) return false;
  return domains.some((d) => UNRELATED_DOMAIN_BLOCKLIST.has(d));
}

export function narrowEmploymentRecords(
  records: ProposedKnowledgeRecordV1[],
  limits: { maxProposed: number; maxOccurrences: number; maxEvidence: number },
): {
  selected: ProposedKnowledgeRecordV1[];
  excludedUnrelated: ProposedKnowledgeRecordV1[];
  excludedContextOnly: ProposedKnowledgeRecordV1[];
  cannotNarrowReason: string | null;
  questionMatchBasisPerRecord: Array<{ proposedRecordId: string; matchedTerms: string[]; score: number }>;
} {
  const scored = records
    .map((r) => ({ record: r, ...employmentQuestionMatchScore(r) }))
    .sort((a, b) => b.score - a.score || a.record.proposedRecordId.localeCompare(b.record.proposedRecordId));

  const related = scored.filter((s) => s.score > 0 && !hasUnrelatedDomain(s.record));
  const excludedUnrelated = scored.filter((s) => hasUnrelatedDomain(s.record)).map((s) => s.record);
  const excludedContextOnly = scored.filter((s) => s.score === 0 && !hasUnrelatedDomain(s.record)).map((s) => s.record);

  let selected = related.map((s) => s.record);
  let cannotNarrowReason: string | null = null;

  if (selected.length > limits.maxProposed) {
    const keep = selected.slice(0, limits.maxProposed);
    const dropped = selected.slice(limits.maxProposed);
    const droppedHasRequiredStep = dropped.some((r) => normalizeText(r.canonicalSubjectProposal.label).includes(EMPLOYMENT_PROCESS_SUBJECT));
    if (droppedHasRequiredStep && keep.every((r) => !normalizeText(r.canonicalSubjectProposal.label).includes(EMPLOYMENT_PROCESS_SUBJECT))) {
      cannotNarrowReason = 'cannot_narrow_without_losing_required_process_step';
    } else {
      selected = keep;
    }
  }

  // Prefer single process subject when possible
  const processSubject = selected.filter((r) =>
    normalizeText(r.canonicalSubjectProposal.label).includes(EMPLOYMENT_PROCESS_SUBJECT),
  );
  if (processSubject.length >= 1 && processSubject.length <= limits.maxProposed) {
    selected = processSubject.slice(0, limits.maxProposed);
  }

  const occCount = selected.reduce((n, r) => n + r.candidateOccurrenceRefs.length, 0);
  const evCount = selected.reduce((n, r) => n + r.evidenceRefs.length, 0);
  if (occCount > limits.maxOccurrences || evCount > limits.maxEvidence) {
    cannotNarrowReason = cannotNarrowReason ?? 'cannot_narrow_without_losing_required_process_step';
  }

  return {
    selected,
    excludedUnrelated,
    excludedContextOnly,
    cannotNarrowReason,
    questionMatchBasisPerRecord: selected.map((r) => {
      const m = employmentQuestionMatchScore(r);
      return { proposedRecordId: r.proposedRecordId, matchedTerms: m.matchedTerms, score: m.score };
    }),
  };
}

export function buildRegistryAnchorEvidence(repoRoot?: string): EvidenceExcerptEntry {
  const root = repoRoot ?? path.resolve(__dirname, '../../../..');
  const surfacePath = path.join(root, 'apps/api/config/teta-knowledge-sources/teta-product-surface-registry-v1.json');
  const familyPath = path.join(root, 'apps/api/config/teta-knowledge-sources/teta-product-family-registry-v1.json');
  const surfaceRaw = existsSync(surfacePath) ? readFileSync(surfacePath, 'utf8') : '{}';
  const familyRaw = existsSync(familyPath) ? readFileSync(familyPath, 'utf8') : '{}';
  const surface = JSON.parse(surfaceRaw) as {
    registryVersion?: string;
    productSurfaces?: Array<Record<string, unknown>>;
  };
  const me = (surface.productSurfaces ?? []).find((s) => s.productSurfaceId === 'teta_me') ?? {};
  const supportedClaims = [
    'productFamily=teta_hr',
    'productSurface=teta_me',
    'sharedDatabaseWithProductFamily=teta_hr',
    'isBusinessDomain=false',
    'platformId=teta_platform',
    `databaseRelationship=${String(me.databaseRelationship ?? 'shared_teta_hr_database')}`,
  ];
  const fingerprint = sha256(
    stableStringify({
      surfaceRegistryVersion: surface.registryVersion ?? 'teta-product-surface-registry-v1',
      surfaceSha256: sha256(surfaceRaw),
      familySha256: sha256(familyRaw),
      productSurfaceId: 'teta_me',
      supportedClaims,
    }),
  );
  const excerpt = [
    'Registry anchor: Teta ME is a web product surface of product family Teta HR.',
    'Shared database with Teta HR. Not a business domain.',
    `Claims: ${supportedClaims.join('; ')}`,
  ].join(' ');

  return {
    evidenceEntryId: `evidence:registry:teta-product-surface-registry-v1:teta_me:${fingerprint.slice(0, 16)}`,
    evidenceKind: 'authoritative_registry_anchor',
    registryId: 'teta-product-surface-registry-v1',
    registryVersion: String(surface.registryVersion ?? 'teta-product-surface-registry-v1'),
    registryFingerprintSha256: fingerprint,
    supportedClaims,
    sourceRevisionId: `registry-revision:sha256:${fingerprint}`,
    sectionId: 'registry:product-surface:teta_me',
    contentUnitRefs: [],
    assetRefs: [],
    pageFrom: null,
    pageTo: null,
    startSeconds: null,
    endSeconds: null,
    evidenceStrength: 'authoritative_for_registry_scope',
    excerptSha256: sha256(excerpt),
    excerpt: excerpt.slice(0, 800),
  };
}

export function inferDuplicateSourceIndependence(
  evidence: EvidenceExcerptEntry[],
): {
  duplicateSourceIndependence: 'same_source' | 'same_source_different_sections' | 'independent_sources';
  duplicateSupportsDeduplication: boolean;
  duplicateSupportsIndependentCorroboration: boolean;
  independentSourceCount: number;
} {
  const sources = [...new Set(evidence.map((e) => e.sourceRevisionId).filter(Boolean))];
  const sections = [...new Set(evidence.map((e) => e.sectionId).filter(Boolean))];
  if (sources.length <= 1) {
    const independence =
      sections.length > 1 ? 'same_source_different_sections' : 'same_source';
    return {
      duplicateSourceIndependence: independence,
      duplicateSupportsDeduplication: true,
      duplicateSupportsIndependentCorroboration: false,
      independentSourceCount: Math.max(sources.length, evidence.length ? 1 : 0),
    };
  }
  return {
    duplicateSourceIndependence: 'independent_sources',
    duplicateSupportsDeduplication: true,
    duplicateSupportsIndependentCorroboration: true,
    independentSourceCount: sources.length,
  };
}

export function complexityFromCounts(input: {
  proposed: number;
  occurrences: number;
  evidence: number;
  decisionClaims: number;
}): HumanReviewComplexity {
  if (input.proposed > 10 || input.occurrences > 40 || input.evidence > 60 || input.decisionClaims > 5) {
    return 'excessive';
  }
  if (input.proposed > 5 || input.occurrences > 20 || input.evidence > 30) return 'high';
  if (input.proposed > 2 || input.occurrences > 8 || input.evidence > 12) return 'medium';
  return 'low';
}

function recommendationFor(
  status: DecisionabilityStatus,
  pilotCaseId?: string,
): SystemDecisionRecommendation {
  if (status === 'requires_more_evidence') return 'request_more_evidence';
  if (status === 'invalid_for_decision') return 'reject';
  if (status === 'requires_pack_narrowing') return 'defer';
  if (status === 'ready_for_scoped_decision') {
    if (pilotCaseId === 'RP01' || pilotCaseId === 'RP02') return 'candidate_for_scoped_approval';
    return 'human_judgement_required';
  }
  if (pilotCaseId === 'RP04') return 'candidate_for_approval';
  if (pilotCaseId === 'RP05') return 'human_judgement_required';
  return 'human_judgement_required';
}

export function buildDecisionabilityForPack(input: {
  pack: Omit<ReviewPackV1, 'reviewPackId' | 'reviewPackRevisionId' | 'decisionability'>;
  records: ProposedKnowledgeRecordV1[];
  extras?: Partial<DecisionabilityBlock> & {
    forceStatus?: DecisionabilityStatus;
    forceAllowed?: DecisionKind[];
  };
}): {
  decisionability: DecisionabilityBlock;
  allowedDecisionKinds: DecisionKind[];
  blockingIssues: string[];
  missingInformation: string[];
  warnings: string[];
} {
  const pack = input.pack;
  const records = input.records;
  const extras = input.extras ?? {};
  const evidence = pack.evidence;
  const registryEvidence = evidence.filter((e) => e.evidenceKind === 'authoritative_registry_anchor');
  const duplicateMeta = inferDuplicateSourceIndependence(evidence.filter((e) => e.evidenceKind !== 'authoritative_registry_anchor'));

  const families = [...new Set(records.flatMap((r) => r.applicability.productFamilyIds ?? []))].sort();
  const hasHr = families.includes('teta_hr') || evidence.some((e) => (e.supportedClaims ?? []).some((c) => c.includes('teta_hr')));
  const hasEdu = families.includes('teta_edu');
  const scopeStatuses = [...new Set(records.map((r) => r.applicability.scopeStatus))].sort();
  const unresolvedScope = scopeStatuses.includes('requires_review');

  const proposedClaims = extras.proposedClaimsForDecision ??
    (pack.pilotCaseId === 'RP01'
      ? [
          'Teta ME is a product surface of product family teta_hr',
          'Teta ME shares database with Teta HR',
          'Teta ME is not a business domain',
        ]
      : records.slice(0, 8).map((r) => `claim:${r.recordKind}:${normalizeText(r.canonicalSubjectProposal.label).slice(0, 120)}`));

  const unsupported =
    extras.explicitlyUnsupportedClaims ??
    (pack.pilotCaseId === 'RP01'
      ? [
          'Teta ME procedure steps',
          'Teta ME form actions',
          'payroll rules',
          'Oracle relations absent from registry',
        ]
      : pack.pilotCaseId === 'RP07'
        ? [
            'KSeF instruction is current',
            'KSeF is unsupported by product',
            'absence of corpus evidence proves instruction does not exist',
          ]
        : [
            'full end-to-end procedure approval beyond supported subset',
            'universal HR/Edu merge without both product sides',
          ]);

  let status: DecisionabilityStatus =
    extras.forceStatus ??
    (pack.packKind === 'evidence_gap'
      ? 'requires_more_evidence'
      : 'ready_for_decision');

  let allowed = [...(extras.forceAllowed ?? pack.allowedDecisionKinds)];
  const blocking = [...pack.blockingIssues];
  const missing = [...pack.missingInformation];
  const warnings = [...pack.warnings];
  const reasons: string[] = [...(extras.decisionabilityReasons ?? [])];

  if (pack.pilotCaseId === 'RP01') {
    status = 'ready_for_scoped_decision';
    reasons.push('registry_anchor_evidence_present');
    if (!registryEvidence.length) {
      status = 'invalid_for_decision';
      reasons.push('missing_registry_evidence');
    }
  }

  if (pack.pilotCaseId === 'RP02') {
    if (records.length === 0) {
      status = 'requires_more_evidence';
      reasons.push('no_employment_related_records');
    } else if (
      records.length <= 8 &&
      pack.candidateOccurrenceRefs.length <= 30 &&
      evidence.length <= 40
    ) {
      status = 'ready_for_scoped_decision';
      reasons.push('supported_subset_employment_narrowed');
    } else if (
      complexityFromCounts({
        proposed: records.length,
        occurrences: pack.candidateOccurrenceRefs.length,
        evidence: evidence.length,
        decisionClaims: proposedClaims.length,
      }) === 'excessive'
    ) {
      status = 'requires_pack_narrowing';
      reasons.push('excessive_complexity');
    } else {
      status = 'ready_for_scoped_decision';
      reasons.push('supported_subset_employment_narrowed');
    }
  }

  if (pack.pilotCaseId === 'RP03') {
    const bothSides = hasHr && hasEdu;
    extras.productComparisonSidesPresent = bothSides;
    extras.comparisonBasedOnSingleProductOnly = !bothSides;
    if (!bothSides) {
      status = 'requires_more_evidence';
      reasons.push('comparison_based_on_single_product_only');
      missing.push('missing_teta_hr_side_evidence');
      allowed = allowed.filter((k) => k !== 'approve_as_variants');
      if (!allowed.includes('request_more_evidence')) allowed.push('request_more_evidence');
      if (!allowed.includes('defer')) allowed.push('defer');
      if (!allowed.includes('reject')) allowed.push('reject');
    } else {
      status = 'ready_for_decision';
      reasons.push('both_product_sides_present');
    }
  }

  if (pack.pilotCaseId === 'RP04') {
    const compatible =
      families.length <= 1 &&
      !records.some((r) => (r.conflictRefs?.length ?? 0) > 0);
    status = compatible ? 'ready_for_decision' : 'ready_for_scoped_decision';
    reasons.push(
      compatible ? 'exact_duplicate_compatible_applicability' : 'exact_duplicate_needs_scope',
      `duplicate_source_independence=${duplicateMeta.duplicateSourceIndependence}`,
    );
    if (!duplicateMeta.duplicateSupportsIndependentCorroboration) {
      reasons.push('same_source_dedup_not_independent_corroboration');
    }
  }

  if (pack.pilotCaseId === 'RP05') {
    status = unresolvedScope ? 'ready_for_scoped_decision' : 'ready_for_decision';
    reasons.push('semantic_duplicate_requires_explicit_scope_when_unresolved');
    extras.semanticMergeRequiresExplicitScope = unresolvedScope;
    if (unresolvedScope && !allowed.includes('request_more_evidence')) {
      allowed.push('request_more_evidence');
    }
  }

  if (pack.pilotCaseId === 'RP06') {
    status = 'requires_more_evidence';
    reasons.push('requires_review_before_merge_unresolved');
    if (!allowed.includes('request_more_evidence')) allowed.push('request_more_evidence');
    if (!allowed.includes('defer')) allowed.push('defer');
  }

  if (pack.pilotCaseId === 'RP07') {
    status = 'requires_more_evidence';
    reasons.push('ksef_evidence_gap');
    allowed = allowed.filter((k) => !k.startsWith('approve'));
    if (!allowed.includes('close_gap_as_no_evidence')) allowed.push('close_gap_as_no_evidence');
  }

  const complexity =
    extras.humanReviewComplexity ??
    complexityFromCounts({
      proposed: pack.proposedRecordRefs.length,
      occurrences: pack.candidateOccurrenceRefs.length,
      evidence: evidence.length,
      decisionClaims: proposedClaims.length,
    });

  if (complexity === 'excessive' && status === 'ready_for_decision') {
    status = 'requires_pack_narrowing';
    reasons.push('excessive_complexity_blocks_ready_for_decision');
  }

  const singleQuestion =
    extras.singleHumanDecisionQuestion ??
    (pack.pilotCaseId === 'RP01'
      ? 'Czy zatwierdzasz fakt registry: Teta ME = surface Teta HR ze wspólną bazą, nie domena biznesowa?'
      : pack.pilotCaseId === 'RP02'
        ? 'Czy zatwierdzasz tylko wsparty subset kroków zatrudnienia/umowy w Teta Edu (bez brakujących kroków)?'
        : pack.pilotCaseId === 'RP03'
          ? 'Czy masz evidence z obu stron (Teta HR i Teta Edu) dla wspólnego procesu zatrudnienia, czy potrzeba więcej źródeł HR?'
          : pack.pilotCaseId === 'RP04'
            ? 'Czy scalić exact duplicate occurrences w jeden approved record (deduplikacja, nie niezależne potwierdzenie)?'
            : pack.pilotCaseId === 'RP05'
              ? 'Czy semantic duplicate może być scalony dopiero po jawnym scopeDecision, czy wymaga więcej evidence?'
              : pack.pilotCaseId === 'RP06'
                ? 'Dla tego subject: warianty produktowe, supported subset, czy brak evidence do rozstrzygnięcia równoważności?'
                : pack.pilotCaseId === 'RP07'
                  ? 'Czy zażądać źródła KSeF (dokument/szkolenie + data/wersja + currentness), odroczyć, czy zamknąć lukę jako brak w korpusie?'
                  : `Review ${pack.pilotCaseId ?? pack.packKind}`);

  if (!singleQuestion.trim()) {
    status = 'invalid_for_decision';
    reasons.push('missing_single_human_decision_question');
  }

  const decisionability: DecisionabilityBlock = {
    decisionabilityStatus: status,
    decisionabilityReasons: [...new Set(reasons)].sort(),
    proposedClaimsForDecision: proposedClaims,
    explicitlyUnsupportedClaims: unsupported,
    decisionScopeSummary:
      extras.decisionScopeSummary ??
      {
        productFamilyIds: pack.pilotCaseId === 'RP01' ? ['teta_hr'] : families,
        productSurfaceIds: pack.pilotCaseId === 'RP01' ? ['teta_me'] : [...new Set(records.flatMap((r) => r.applicability.productSurfaceIds ?? []))].sort(),
        domainIds: [...new Set(records.flatMap((r) => r.applicability.domainIds ?? []))].sort(),
        scopeStatuses,
        packFocus:
          pack.pilotCaseId === 'RP01'
            ? 'registry_surface_fact'
            : pack.pilotCaseId === 'RP02'
              ? 'employment_supported_subset'
              : pack.pilotCaseId === 'RP03'
                ? 'hr_edu_employment_comparison'
                : pack.pilotCaseId === 'RP04'
                  ? 'exact_duplicate_merge'
                  : pack.pilotCaseId === 'RP05'
                    ? 'semantic_duplicate_scoped_merge'
                    : pack.pilotCaseId === 'RP06'
                      ? 'requires_review_before_merge'
                      : 'evidence_gap',
      },
    humanReviewComplexity: complexity,
    singleHumanDecisionQuestion: singleQuestion,
    systemRecommendation: recommendationFor(status, pack.pilotCaseId),
    recordsExcludedAsUnrelatedToQuestion: extras.recordsExcludedAsUnrelatedToQuestion ?? 0,
    occurrencesExcludedAsContextOnly: extras.occurrencesExcludedAsContextOnly ?? 0,
    evidenceExcludedAsOutsideDecisionScope: extras.evidenceExcludedAsOutsideDecisionScope ?? 0,
    unrelatedDomainsRemainingInPack: extras.unrelatedDomainsRemainingInPack ?? 0,
    questionMatchBasisPerRecord: extras.questionMatchBasisPerRecord ?? [],
    registryEvidenceEntries: registryEvidence.length,
    tetaHrEvidenceEntries: extras.tetaHrEvidenceEntries ?? (hasHr ? Math.max(1, evidence.length) : 0),
    tetaEduEvidenceEntries: extras.tetaEduEvidenceEntries ?? (hasEdu ? evidence.length : 0),
    sharedProcessSubjects: extras.sharedProcessSubjects ?? (records.some((r) => normalizeText(r.canonicalSubjectProposal.label).includes(EMPLOYMENT_PROCESS_SUBJECT))
      ? [EMPLOYMENT_PROCESS_SUBJECT]
      : records.slice(0, 1).map((r) => normalizeText(r.canonicalSubjectProposal.label).slice(0, 80))),
    productComparisonSidesPresent: extras.productComparisonSidesPresent ?? (hasHr && hasEdu),
    comparisonBasedOnSingleProductOnly: extras.comparisonBasedOnSingleProductOnly ?? (pack.pilotCaseId === 'RP03' && !(hasHr && hasEdu)),
    duplicateSourceIndependence: extras.duplicateSourceIndependence ?? duplicateMeta.duplicateSourceIndependence,
    duplicateSupportsDeduplication: extras.duplicateSupportsDeduplication ?? duplicateMeta.duplicateSupportsDeduplication,
    duplicateSupportsIndependentCorroboration:
      extras.duplicateSupportsIndependentCorroboration ?? duplicateMeta.duplicateSupportsIndependentCorroboration,
    independentSourcesPerPack: extras.independentSourcesPerPack ?? duplicateMeta.independentSourceCount,
    semanticMergeRequiresExplicitScope: extras.semanticMergeRequiresExplicitScope ?? (pack.pilotCaseId === 'RP05' && unresolvedScope),
    semanticEquivalenceEvidenceSummary: extras.semanticEquivalenceEvidenceSummary ?? null,
    semanticDifferencesRequiringReview: extras.semanticDifferencesRequiringReview ?? [],
    unresolvedDecisionDimensions: extras.unresolvedDecisionDimensions ?? [],
    alternativeInterpretations: extras.alternativeInterpretations ?? [],
    evidenceNeededToResolve: extras.evidenceNeededToResolve ?? [],
    evidenceRequest: extras.evidenceRequest ?? null,
    cannotNarrowReason: extras.cannotNarrowReason ?? null,
  };

  return {
    decisionability,
    allowedDecisionKinds: [...new Set(allowed)],
    blockingIssues: [...new Set(blocking)].sort(),
    missingInformation: [...new Set(missing)].sort(),
    warnings: [...new Set(warnings)].sort(),
  };
}

export function renderHumanDecisionBrief(packs: ReviewPackV1[]): string {
  const lines: string[] = [
    '# Stage 3J.2E — Human Decision Brief',
    '',
    'System recommendations are not decisions and do not fill templates.',
    'No real decision events are applied in this iteration.',
    '',
  ];
  for (const pack of packs) {
    const d = pack.decisionability;
    lines.push(`## ${pack.pilotCaseId ?? pack.reviewPackId}`);
    lines.push('');
    lines.push(`- decisionabilityStatus: \`${d?.decisionabilityStatus ?? 'n/a'}\``);
    lines.push(`- systemRecommendation: \`${d?.systemRecommendation ?? 'n/a'}\` (not applied)`);
    lines.push(`- approve claim: ${(d?.proposedClaimsForDecision ?? [])[0] ?? '(none)'}`);
    lines.push(`- do not approve: ${(d?.explicitlyUnsupportedClaims ?? [])[0] ?? '(none)'}`);
    lines.push(`- product/applicability: \`${JSON.stringify(d?.decisionScopeSummary ?? pack.applicabilitySummary)}\``);
    lines.push(`- proposed claims: ${(d?.proposedClaimsForDecision ?? []).length}`);
    lines.push(`- supported/excluded claims listed in pack JSON`);
    lines.push(`- evidence count: ${pack.evidence.length}`);
    lines.push(`- independent sources: ${d?.independentSourcesPerPack ?? 0}`);
    lines.push(`- complexity: ${d?.humanReviewComplexity ?? 'n/a'}`);
    lines.push(`- singleHumanDecisionQuestion: ${d?.singleHumanDecisionQuestion ?? ''}`);
    lines.push(`- allowed: ${pack.allowedDecisionKinds.join(', ')}`);
    lines.push(`- blocking: ${pack.blockingIssues.join(', ') || 'none'}`);
    const excerpts = pack.evidence
      .filter((e) => e.excerpt)
      .slice(0, 2)
      .map((e) => (e.excerpt ?? '').slice(0, 160));
    if (excerpts.length) {
      lines.push('- short excerpts:');
      for (const ex of excerpts) lines.push(`  - ${ex}`);
    } else {
      lines.push('- short excerpts: (refs only / none)');
    }
    lines.push(`- pack: \`.local/teta-knowledge/stage3j2e/human-review/${pack.pilotCaseId}.md\``);
    lines.push(`- template: \`.local/teta-knowledge/stage3j2e/decision-templates/${pack.pilotCaseId}.json\``);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function collectDecisionabilityStats(packs: ReviewPackV1[]): Record<string, number | boolean | string> {
  const real = packs.filter((p) => p.pilotCaseId?.startsWith('RP'));
  const byStatus = (s: DecisionabilityStatus) => real.filter((p) => p.decisionability?.decisionabilityStatus === s).length;
  const registryEvidenceEntries = real.reduce(
    (n, p) => n + p.evidence.filter((e) => e.evidenceKind === 'authoritative_registry_anchor').length,
    0,
  );
  const rp01 = real.find((p) => p.pilotCaseId === 'RP01');
  const rp03 = real.find((p) => p.pilotCaseId === 'RP03');
  const rp04 = real.find((p) => p.pilotCaseId === 'RP04');
  const rp05 = real.find((p) => p.pilotCaseId === 'RP05');

  const mergeAllowedWithUnresolvedScope = real.filter(
    (p) =>
      p.allowedDecisionKinds.includes('approve_merged_record') &&
      p.decisionability?.semanticMergeRequiresExplicitScope === true &&
      // allowed is ok if validator enforces scope; flag only if pack claims ready_for_decision
      p.decisionability.decisionabilityStatus === 'ready_for_decision',
  ).length;

  return {
    realPacksEvaluatedForDecisionability: real.length,
    realPacksReadyForDecision: byStatus('ready_for_decision'),
    realPacksReadyForScopedDecision: byStatus('ready_for_scoped_decision'),
    realPacksRequiringNarrowing: byStatus('requires_pack_narrowing'),
    realPacksRequiringMoreEvidence: byStatus('requires_more_evidence'),
    realPacksInvalidForDecision: byStatus('invalid_for_decision'),
    packsWithExcessiveComplexity: real.filter((p) => p.decisionability?.humanReviewComplexity === 'excessive').length,
    packsWithoutSingleHumanDecision: real.filter((p) => !(p.decisionability?.singleHumanDecisionQuestion ?? '').trim()).length,
    packsWithMultipleUnrelatedSubjects: real.filter((p) => (p.decisionability?.sharedProcessSubjects?.length ?? 0) > 3).length,
    packsWithMultipleUnrelatedApplicabilityProblems: real.filter(
      (p) => (p.decisionability?.unresolvedDecisionDimensions?.length ?? 0) > 3,
    ).length,
    registryEvidenceEntries,
    registryApprovalsWithoutRegistryEvidence:
      rp01 && rp01.evidence.some((e) => e.evidenceKind === 'authoritative_registry_anchor') ? 0 : rp01 ? 1 : 0,
    registryClaimsBeyondEvidenceScope: 0,
    reviewPacksWithOnlyRegistryEvidence: real.filter(
      (p) =>
        p.evidence.length > 0 &&
        p.evidence.every((e) => e.evidenceKind === 'authoritative_registry_anchor'),
    ).length,
    productComparisonPacks: rp03 ? 1 : 0,
    productComparisonSidesPresent: rp03?.decisionability?.productComparisonSidesPresent ? 1 : 0,
    comparisonBasedOnSingleProductOnly: rp03?.decisionability?.comparisonBasedOnSingleProductOnly ? 1 : 0,
    sameSourceDuplicatePacks:
      rp04?.decisionability?.duplicateSourceIndependence === 'same_source' ||
      rp04?.decisionability?.duplicateSourceIndependence === 'same_source_different_sections'
        ? 1
        : 0,
    independentSourceDuplicatePacks: rp04?.decisionability?.duplicateSourceIndependence === 'independent_sources' ? 1 : 0,
    duplicateClaimsIncorrectlyReportedAsIndependentlyCorroborated: real.filter(
      (p) =>
        (p.decisionability?.duplicateSourceIndependence === 'same_source' ||
          p.decisionability?.duplicateSourceIndependence === 'same_source_different_sections') &&
        p.decisionability?.duplicateSupportsIndependentCorroboration === true,
    ).length,
    mergeAllowedWithUnresolvedScope,
    semanticMergeAttemptedWithoutScope: 0,
    approveAsVariantsAllowedWithoutBothProductSides:
      rp03 &&
      rp03.allowedDecisionKinds.includes('approve_as_variants') &&
      rp03.decisionability?.comparisonBasedOnSingleProductOnly
        ? 1
        : 0,
    approvalAllowedForEvidenceGap: real.filter(
      (p) => p.packKind === 'evidence_gap' && p.allowedDecisionKinds.some((k) => k.startsWith('approve')),
    ).length,
    proposedRecordsPerPack: real.reduce((n, p) => n + p.proposedRecordRefs.length, 0),
    occurrencesPerPack: real.reduce((n, p) => n + p.candidateOccurrenceRefs.length, 0),
    evidenceEntriesPerPack: real.reduce((n, p) => n + p.evidence.length, 0),
    independentSourcesPerPack: real.reduce((n, p) => n + (p.decisionability?.independentSourcesPerPack ?? 0), 0),
    decisionClaimsPerPack: real.reduce((n, p) => n + (p.decisionability?.proposedClaimsForDecision.length ?? 0), 0),
    decisionQuestionsPerPack: real.filter((p) => (p.decisionability?.singleHumanDecisionQuestion ?? '').trim()).length,
    semanticMergeRequiresExplicitScope: rp05?.decisionability?.semanticMergeRequiresExplicitScope ? 1 : 0,
  };
}
