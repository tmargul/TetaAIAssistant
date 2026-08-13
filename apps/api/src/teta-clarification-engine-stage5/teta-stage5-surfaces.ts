/**
 * Hypothesis-backed application-surface choice construction.
 * Lexicon / moduleHint are discovery/scope only — never user-facing choices alone.
 */
import type {
  Stage4ApplicationAnchor,
  Stage4ResolutionResult,
} from '../teta-application-first-evidence-resolver-v2';
import type { BindingHypothesis } from '../teta-application-first-evidence-resolver-v2/teta-stage4-hypotheses';
import { scanTextForTechnicalLeak } from './teta-stage5-leak-scan';
import type {
  ChoiceEvidenceQuality,
  ClarificationChoice,
  SurfaceChoiceSourceType,
  SurfacePartitionMetrics,
  UserResolvableDimension,
} from './teta-stage5.types';

export type HypothesisApplicationSurface = {
  hypothesisId: string;
  surfaceCanonicalId: string;
  surfaceType: 'form' | 'tab' | 'application_surface';
  visibleLabel: string;
  moduleLabel?: string | null;
  tabLabel?: string | null;
  supportingAnchorIds: string[];
  supportingEvidenceIds: string[];
  provenance: string[];
  choiceEvidenceQuality: ChoiceEvidenceQuality;
  sourceType: SurfaceChoiceSourceType;
};

export type SurfaceChoiceCandidateAudit = {
  choiceLabel: string;
  choiceInternalId: string;
  sourceType: SurfaceChoiceSourceType;
  supportingHypothesisIds: string[];
  applicationAnchorIds: string[];
  applicationPathIds: string[];
  visibleApplicationEvidence: string[];
  survivingHypothesisCountBefore: number;
  survivingHypothesisCountIfSelected: number;
  choiceEvidenceQuality: ChoiceEvidenceQuality;
  eligible: boolean;
  rejectionReason?: string;
};

export type WhichFormChoiceAudit = {
  generatedAt: string;
  survivingHypothesisIds: string[];
  candidates: SurfaceChoiceCandidateAudit[];
  summary: {
    totalCandidates: number;
    backedByApplicationSurface: number;
    lexiconOrDiscoveryOnly: number;
    moduleHintOnly: number;
    nonDiscriminating: number;
    eligible: number;
  };
};

export type EligibleSurfacePlan = {
  dimension: UserResolvableDimension;
  choices: ClarificationChoice[];
  surfaces: HypothesisApplicationSurface[];
  audit: WhichFormChoiceAudit;
  metrics: SurfacePartitionMetrics;
  partitionsUseful: boolean;
};

function emptySurfaceMetrics(): SurfacePartitionMetrics {
  return {
    surfaceCandidatesReceived: 0,
    surfaceCandidatesEvidenceBacked: 0,
    surfaceCandidatesRejected: 0,
    lexiconOnlySurfaceCandidatesRejected: 0,
    moduleHintOnlySurfaceCandidatesRejected: 0,
    surfaceCandidatesWithHypothesisSupport: 0,
    surfacePartitionsBuilt: 0,
    surfacePartitionsUseful: 0,
    surfacePartitionsNonDiscriminating: 0,
    eligibleFormChoices: 0,
    suppressedFormChoices: 0,
    choicesWithUncertaintyReduction: 0,
    choicesWithoutUncertaintyReduction: 0,
    duplicateSurfacesCollapsed: 0,
    indistinguishableSurfaceChoicesSuppressed: 0,
    hypothesesBefore: 0,
    partitionByChoice: {},
    expectedRemainingHypotheses: {},
    informationGainScore: 0,
  };
}

function survivingHypotheses(stage4: Stage4ResolutionResult): BindingHypothesis[] {
  const hyps = stage4.bindingHypotheses ?? [];
  if (hyps.length) return hyps;
  return [];
}

function classifyAnchorSourceType(a: Stage4ApplicationAnchor): SurfaceChoiceSourceType {
  const at = (a.anchorType ?? '').toLowerCase();
  const evidence = (a.evidenceRefs ?? []).join('|').toLowerCase();
  if (at === 'concept_token' || evidence.includes('lexicon_token:')) return 'lexicon_token';
  if (at === 'module_hint' || evidence.includes('module_hint:')) return 'moduleHint';
  if (a.controlName && /tab/i.test(String(a.controlName))) return 'tab_title';
  if (at === 'pa_plugin' || at === 'pa_form_token') {
    if (a.label && a.formRef && a.label !== a.formRef) return 'form_title';
    return 'pa_label';
  }
  if (a.formRef || a.label) return 'application_anchor';
  return 'other';
}

function looksLikeTechnicalClassOrId(label: string): boolean {
  const t = label.trim();
  if (!t) return true;
  if (/^[a-f0-9-]{16,}$/i.test(t)) return true;
  if (/\b(Form|View|Control|Dataset|MTG|TG)\b/.test(t) && /\./.test(t)) return true;
  if (/^[A-Z][A-Za-z0-9]+(Form|View|Control)$/.test(t)) return true;
  if (/^[A-Z]{2,}(_[A-Z0-9]+)+$/.test(t)) return true;
  return false;
}

function isRecognizableUserFacingLabel(label: string, allowed: string[]): boolean {
  const sanitized = label.trim();
  if (!sanitized) return false;
  if (looksLikeTechnicalClassOrId(sanitized)) return false;
  if (scanTextForTechnicalLeak(sanitized, allowed).length) return false;
  // Lexicon-ish single tokens without spaces and without Polish/letters variety are weak
  if (!/\s/.test(sanitized) && sanitized.length < 4) return false;
  return true;
}

function hypBlob(h: BindingHypothesis): string {
  const ace = h.assignmentCandidate?.acePath?.join('|') ?? '';
  const obj = h.assignmentCandidate?.objectName ?? '';
  const reached = h.assignmentCandidate?.reachedFromApplicationNode ?? '';
  return [
    h.hypothesisId,
    h.assignmentRef,
    ace,
    obj,
    reached,
    ...h.supportingEvidence,
    ...h.connectivityProof,
    ...h.evidenceOriginFingerprints,
  ]
    .filter(Boolean)
    .join('|')
    .toLowerCase();
}

function surfaceLinkedToHypothesis(
  a: Stage4ApplicationAnchor,
  h: BindingHypothesis,
): boolean {
  const blob = hypBlob(h);
  const needles = [
    a.formRef,
    a.anchorId,
    a.label,
    ...(a.matchTokens ?? []),
    a.controlName,
    a.datasetName,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
    .filter((s) => s.length >= 3);

  for (const n of needles) {
    if (blob.includes(n)) return true;
    if (blob.includes(`form:${n}`)) return true;
    if (blob.includes(`application_surface:${n}`)) return true;
    if (blob.includes(`anchor:${n}`)) return true;
  }

  // Explicit evidence refs on hyp pointing at this anchor
  for (const e of h.supportingEvidence) {
    if (a.evidenceRefs?.some((r) => e.includes(r))) return true;
  }
  return false;
}

function qualityFor(
  sourceType: SurfaceChoiceSourceType,
  linked: boolean,
  labelOk: boolean,
): ChoiceEvidenceQuality {
  if (!linked || !labelOk) return 'insufficient_surface_evidence';
  if (sourceType === 'lexicon_token' || sourceType === 'moduleHint' || sourceType === 'fallback_token') {
    return 'insufficient_surface_evidence';
  }
  if (sourceType === 'form_title' || sourceType === 'tab_title' || sourceType === 'application_surface') {
    return 'exact_application_surface';
  }
  if (sourceType === 'pa_label' || sourceType === 'application_anchor') {
    return 'strong_application_surface';
  }
  return 'insufficient_surface_evidence';
}

/**
 * Pre-patch / diagnostic: classify every current anchor as if it were a which_form choice
 * (legacy enumeration), then mark eligibility under the new rules.
 */
export function auditWhichFormChoices(stage4: Stage4ResolutionResult): WhichFormChoiceAudit {
  const hyps = survivingHypotheses(stage4);
  const hypIds = hyps.map((h) => h.hypothesisId);
  const anchors = stage4.applicationAnchors ?? [];
  const allowed = anchors.map((a) => a.label ?? '').filter(Boolean);
  const candidates: SurfaceChoiceCandidateAudit[] = [];

  for (const a of anchors) {
    const sourceType = classifyAnchorSourceType(a);
    const label = (a.label ?? a.formRef ?? a.anchorId).trim();
    const linked = hyps.filter((h) => surfaceLinkedToHypothesis(a, h));
    const supportingHypothesisIds = linked.map((h) => h.hypothesisId);
    const labelOk = isRecognizableUserFacingLabel(label, allowed);
    const quality = qualityFor(sourceType, supportingHypothesisIds.length > 0, labelOk);

    let rejectionReason: string | undefined;
    let eligible = true;
    if (sourceType === 'lexicon_token') {
      eligible = false;
      rejectionReason = 'lexicon_token_not_user_facing';
    } else if (sourceType === 'moduleHint') {
      eligible = false;
      rejectionReason = 'moduleHint_not_choice_source';
    } else if (!labelOk) {
      eligible = false;
      rejectionReason = 'unrecognizable_or_technical_label';
    } else if (supportingHypothesisIds.length === 0) {
      eligible = false;
      rejectionReason = 'no_surviving_hypothesis_support';
    } else if (quality === 'insufficient_surface_evidence') {
      eligible = false;
      rejectionReason = 'insufficient_surface_evidence';
    }

    candidates.push({
      choiceLabel: label,
      choiceInternalId: a.formRef ?? a.anchorId,
      sourceType,
      supportingHypothesisIds,
      applicationAnchorIds: [a.anchorId],
      applicationPathIds: [],
      visibleApplicationEvidence: a.evidenceRefs?.slice(0, 6) ?? [],
      survivingHypothesisCountBefore: hypIds.length,
      survivingHypothesisCountIfSelected: supportingHypothesisIds.length || hypIds.length,
      choiceEvidenceQuality: quality,
      eligible,
      rejectionReason,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    survivingHypothesisIds: hypIds,
    candidates,
    summary: {
      totalCandidates: candidates.length,
      backedByApplicationSurface: candidates.filter((c) =>
        ['form_title', 'pa_label', 'application_anchor', 'application_surface', 'tab_title'].includes(
          c.sourceType,
        ),
      ).length,
      lexiconOrDiscoveryOnly: candidates.filter((c) => c.sourceType === 'lexicon_token').length,
      moduleHintOnly: candidates.filter((c) => c.sourceType === 'moduleHint').length,
      nonDiscriminating: 0,
      eligible: candidates.filter((c) => c.eligible).length,
    },
  };
}

function dedupeKey(surfaceCanonicalId: string): string {
  return surfaceCanonicalId.trim().toLowerCase();
}

function disambiguateLabel(
  base: string,
  moduleLabel: string | null | undefined,
  tabLabel: string | null | undefined,
  usedLabels: Set<string>,
): string | null {
  let label = base;
  if (!usedLabels.has(label.toLowerCase())) return label;
  if (moduleLabel && isRecognizableUserFacingLabel(moduleLabel, [moduleLabel])) {
    label = `${base} (${moduleLabel})`;
    if (!usedLabels.has(label.toLowerCase())) return label;
  }
  if (tabLabel && isRecognizableUserFacingLabel(tabLabel, [tabLabel])) {
    label = `${base} — ${tabLabel}`;
    if (!usedLabels.has(label.toLowerCase())) return label;
  }
  return null; // indistinguishable
}

/**
 * Build eligible which_form / which_tab / which_application_surface choices
 * from surviving Stage 4 hypotheses only.
 */
export function planEligibleApplicationSurfaceChoices(
  stage4: Stage4ResolutionResult,
  preferredDimension: UserResolvableDimension = 'which_form',
): EligibleSurfacePlan {
  const metrics = emptySurfaceMetrics();
  const hyps = survivingHypotheses(stage4);
  metrics.hypothesesBefore = hyps.length;
  const anchors = stage4.applicationAnchors ?? [];
  metrics.surfaceCandidatesReceived = anchors.length;
  const allowed = anchors.map((a) => a.label ?? '').filter(Boolean);
  const audit = auditWhichFormChoices(stage4);

  // Aggregate surfaces by canonical id across hypotheses
  type Agg = {
    surfaceCanonicalId: string;
    surfaceType: 'form' | 'tab' | 'application_surface';
    visibleLabel: string;
    moduleLabel?: string | null;
    tabLabel?: string | null;
    supportingHypothesisIds: Set<string>;
    supportingAnchorIds: Set<string>;
    supportingEvidenceIds: string[];
    provenance: string[];
    choiceEvidenceQuality: ChoiceEvidenceQuality;
    sourceType: SurfaceChoiceSourceType;
  };
  const byCanonical = new Map<string, Agg>();
  const surfaces: HypothesisApplicationSurface[] = [];

  for (const a of anchors) {
    const sourceType = classifyAnchorSourceType(a);
    const label = (a.label ?? '').trim();
    const canonical = (a.formRef ?? a.anchorId).trim();
    if (!canonical) {
      metrics.surfaceCandidatesRejected += 1;
      continue;
    }

    if (sourceType === 'lexicon_token') {
      metrics.lexiconOnlySurfaceCandidatesRejected += 1;
      metrics.surfaceCandidatesRejected += 1;
      continue;
    }
    if (sourceType === 'moduleHint') {
      metrics.moduleHintOnlySurfaceCandidatesRejected += 1;
      metrics.surfaceCandidatesRejected += 1;
      continue;
    }

    const labelOk = isRecognizableUserFacingLabel(label, allowed);
    if (!labelOk) {
      metrics.surfaceCandidatesRejected += 1;
      continue;
    }

    const linkedHyps = hyps.filter((h) => surfaceLinkedToHypothesis(a, h));
    if (linkedHyps.length === 0) {
      metrics.surfaceCandidatesRejected += 1;
      continue;
    }
    metrics.surfaceCandidatesWithHypothesisSupport += 1;

    const quality = qualityFor(sourceType, true, true);
    if (quality === 'insufficient_surface_evidence') {
      metrics.surfaceCandidatesRejected += 1;
      continue;
    }
    metrics.surfaceCandidatesEvidenceBacked += 1;

    const surfaceType: 'form' | 'tab' | 'application_surface' =
      sourceType === 'tab_title' ? 'tab' : preferredDimension === 'which_application_surface' ? 'application_surface' : 'form';

    for (const h of linkedHyps) {
      surfaces.push({
        hypothesisId: h.hypothesisId,
        surfaceCanonicalId: canonical,
        surfaceType,
        visibleLabel: label,
        moduleLabel: null,
        tabLabel: a.controlName ?? null,
        supportingAnchorIds: [a.anchorId],
        supportingEvidenceIds: a.evidenceRefs?.slice(0, 6) ?? [],
        provenance: [`anchor:${a.anchorId}`, `source:${sourceType}`],
        choiceEvidenceQuality: quality,
        sourceType,
      });
    }

    const key = dedupeKey(canonical);
    const existing = byCanonical.get(key);
    if (existing) {
      metrics.duplicateSurfacesCollapsed += 1;
      for (const h of linkedHyps) existing.supportingHypothesisIds.add(h.hypothesisId);
      existing.supportingAnchorIds.add(a.anchorId);
      if (
        quality === 'exact_application_surface' &&
        existing.choiceEvidenceQuality !== 'exact_application_surface'
      ) {
        existing.choiceEvidenceQuality = quality;
        existing.visibleLabel = label;
        existing.sourceType = sourceType;
      }
    } else {
      byCanonical.set(key, {
        surfaceCanonicalId: canonical,
        surfaceType,
        visibleLabel: label,
        moduleLabel: null,
        tabLabel: a.controlName ?? null,
        supportingHypothesisIds: new Set(linkedHyps.map((h) => h.hypothesisId)),
        supportingAnchorIds: new Set([a.anchorId]),
        supportingEvidenceIds: a.evidenceRefs?.slice(0, 6) ?? [],
        provenance: [`anchor:${a.anchorId}`, `source:${sourceType}`],
        choiceEvidenceQuality: quality,
        sourceType,
      });
    }
  }

  // Same visible label, different canonical — disambiguate or suppress
  const usedLabels = new Set<string>();
  const labelGroups = new Map<string, Agg[]>();
  for (const agg of byCanonical.values()) {
    const lk = agg.visibleLabel.toLowerCase();
    const g = labelGroups.get(lk) ?? [];
    g.push(agg);
    labelGroups.set(lk, g);
  }

  const finalAggs: Agg[] = [];
  for (const group of labelGroups.values()) {
    if (group.length === 1) {
      finalAggs.push(group[0]!);
      usedLabels.add(group[0]!.visibleLabel.toLowerCase());
      continue;
    }
    for (const agg of group) {
      const dis = disambiguateLabel(agg.visibleLabel, agg.moduleLabel, agg.tabLabel, usedLabels);
      if (!dis) {
        metrics.indistinguishableSurfaceChoicesSuppressed += 1;
        metrics.surfaceCandidatesRejected += 1;
        continue;
      }
      agg.visibleLabel = dis;
      usedLabels.add(dis.toLowerCase());
      finalAggs.push(agg);
    }
  }

  // Partition: supporting hyp sets must differ across at least two choices
  const partitionSets = finalAggs.map((a) => ({
    id: a.surfaceCanonicalId,
    set: [...a.supportingHypothesisIds].sort().join(','),
    hypIds: [...a.supportingHypothesisIds],
  }));
  metrics.surfacePartitionsBuilt = partitionSets.length;

  const uniquePartitions = new Set(partitionSets.map((p) => p.set));
  const discriminating =
    finalAggs.length >= 2 &&
    uniquePartitions.size >= 2 &&
    finalAggs.some((a) => a.supportingHypothesisIds.size < hyps.length);

  if (!discriminating) {
    metrics.surfacePartitionsNonDiscriminating = partitionSets.length;
    metrics.suppressedFormChoices = finalAggs.length;
    for (const a of finalAggs) {
      metrics.partitionByChoice[a.surfaceCanonicalId] = [...a.supportingHypothesisIds];
      metrics.expectedRemainingHypotheses[a.surfaceCanonicalId] = a.supportingHypothesisIds.size;
      if (a.supportingHypothesisIds.size < hyps.length) {
        metrics.choicesWithUncertaintyReduction += 1;
      } else {
        metrics.choicesWithoutUncertaintyReduction += 1;
      }
    }
    audit.summary.nonDiscriminating = finalAggs.length;
    audit.summary.eligible = 0;
    return {
      dimension: preferredDimension,
      choices: [],
      surfaces,
      audit,
      metrics,
      partitionsUseful: false,
    };
  }

  metrics.surfacePartitionsUseful = uniquePartitions.size;
  const choices: ClarificationChoice[] = [];
  let i = 0;
  for (const agg of finalAggs) {
    const retained = [...agg.supportingHypothesisIds];
    const eliminated = hyps.map((h) => h.hypothesisId).filter((id) => !agg.supportingHypothesisIds.has(id));
    metrics.partitionByChoice[agg.surfaceCanonicalId] = retained;
    metrics.expectedRemainingHypotheses[agg.surfaceCanonicalId] = retained.length;
    if (retained.length < hyps.length && retained.length > 0) {
      metrics.choicesWithUncertaintyReduction += 1;
    } else {
      metrics.choicesWithoutUncertaintyReduction += 1;
      metrics.suppressedFormChoices += 1;
      continue; // non-reducing choice rejected
    }

    i += 1;
    const choiceId = `${preferredDimension === 'which_tab' ? 'tab' : preferredDimension === 'which_application_surface' ? 'surface' : 'form'}:${i}`;
    choices.push({
      choiceId,
      label: agg.visibleLabel,
      canonicalApplicationId: agg.surfaceCanonicalId,
      applicationSurfaceCanonicalId: agg.surfaceCanonicalId,
      supportingHypothesisIds: retained,
      supportingApplicationEvidenceIds: agg.supportingEvidenceIds,
      hypothesesRetained: retained,
      hypothesesEliminated: eliminated,
      choiceEvidenceQuality: agg.choiceEvidenceQuality,
      semanticEffect: {
        formScope: preferredDimension === 'which_tab' ? undefined : agg.surfaceCanonicalId,
        tabScope: preferredDimension === 'which_tab' ? agg.surfaceCanonicalId : agg.tabLabel ?? undefined,
        applicationSurfaceId: agg.surfaceCanonicalId,
        applicationContext: agg.visibleLabel,
      },
      evidenceRefs: agg.supportingEvidenceIds.slice(0, 4),
    });
  }

  // Re-check after dropping non-reducing
  const setsAfter = new Set(
    choices.map((c) => [...(c.supportingHypothesisIds ?? [])].sort().join(',')),
  );
  if (choices.length < 2 || setsAfter.size < 2) {
    metrics.suppressedFormChoices += choices.length;
    metrics.eligibleFormChoices = 0;
    return {
      dimension: preferredDimension,
      choices: [],
      surfaces,
      audit,
      metrics,
      partitionsUseful: false,
    };
  }

  metrics.eligibleFormChoices = choices.length;

  // Information gain: 1 - avg(remaining/before)
  const before = Math.max(hyps.length, 1);
  const avgRemain =
    choices.reduce((s, c) => s + (c.hypothesesRetained?.length ?? before), 0) / choices.length;
  metrics.informationGainScore = Number((1 - avgRemain / before).toFixed(4));

  // Narrowest dimension: if all surfaces are tabs → which_tab
  const allTabs = finalAggs.every((a) => a.surfaceType === 'tab');
  const dimension: UserResolvableDimension = allTabs
    ? 'which_tab'
    : preferredDimension === 'which_application_surface'
      ? 'which_application_surface'
      : 'which_form';

  audit.summary.eligible = choices.length;
  return {
    dimension,
    choices,
    surfaces,
    audit,
    metrics,
    partitionsUseful: true,
  };
}

/** Pure helper for tests: does selecting choice reduce hyp set? */
export function clarificationChoiceActuallyReducedUncertainty(input: {
  hypothesesBefore: string[];
  hypothesesRetained: string[];
}): boolean {
  return (
    input.hypothesesRetained.length < input.hypothesesBefore.length &&
    input.hypothesesRetained.length > 0
  );
}
