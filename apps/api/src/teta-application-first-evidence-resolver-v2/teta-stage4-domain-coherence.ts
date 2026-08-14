/**
 * Generic domain / semantic coherence for Stage 4.
 * Weak token overlap + technical reachability must NOT alone yield strong binding.
 */
import type { SemanticApplicationAnchor } from './teta-stage4-anchors';
import type { OracleCandidate } from './teta-stage4-oracle-expand';
import type { BindingHypothesis } from './teta-stage4-hypotheses';
import type { SchemaRoleResolutionStatus, SchemaRoleResolutionResult } from '../teta-schema-role-resolution/teta-schema-role-resolution.types';

export type SemanticCoherenceLevel = 'none' | 'weak' | 'moderate' | 'strong';

export type SemanticAnchorCohort = {
  cohortId: string;
  anchorIds: string[];
  anchorLabels: string[];
  anchorTypes: string[];
  productSurface: string | null;
  module: string | null;
  normalizedConceptTerms: string[];
  compoundTerms: string[];
  semanticSpecificity: number;
  provenance: string[];
};

export type CandidateSemanticAssessment = {
  candidateCanonicalId: string;
  semanticCohortId: string | null;
  originatingApplicationAnchorId: string | null;
  alignedAnchorIds: string[];
  compoundConceptMatches: number;
  multiTokenMatches: number;
  isolatedTokenMatches: number;
  lowDiscriminativeTokenMatches: number;
  crossModuleTokenCollisions: boolean;
  crossProductTokenCollisions: boolean;
  semanticEvidencePathAligned: boolean;
  crossCohortSemanticMerge: boolean;
  technicalConfidence: 'none' | 'weak' | 'strong';
  semanticCoherence: SemanticCoherenceLevel;
  bindingConfidence: SchemaRoleResolutionStatus;
  negativeEvidence: string[];
  reasonStrongWouldBeGranted: string | null;
};

export type DomainCoherenceMetrics = {
  semanticCohortsBuilt: number;
  anchorsAssignedToCohorts: number;
  compoundConceptMatches: number;
  multiTokenMatches: number;
  isolatedTokenMatches: number;
  lowDiscriminativeTokenMatches: number;
  crossModuleTokenCollisions: number;
  crossProductTokenCollisions: number;
  semanticEvidencePathAligned: number;
  semanticEvidencePathRejected: number;
  candidatesRejectedFromStrongBySemanticGate: number;
  hypothesesRejectedFromStrongBySemanticGate: number;
  crossCohortSemanticMerges: number;
  falseStrongBindings: number;
  additionalOracleCallsForDomainCoherence: number;
};

export type DomainCoherenceAudit = {
  scenarioSpecificDomainCoherenceBranches: number;
  hardcodedTwgSemanticRules: number;
  hardcodedUnseenSemanticRules: number;
  hardcodedCurrentPositionSemanticRules: number;
  hardcodedPayrollSemanticRules: number;
  domainStopwordExceptionRules: number;
  goldenPhysicalMappingUsedForSemanticCoherence: number;
  expectedOracleNamesUsedForSemanticCoherence: number;
  semanticEvidencePathAlignedViolations: number;
  crossCohortSemanticMerges: number;
};

export const emptyDomainCoherenceMetrics = (): DomainCoherenceMetrics => ({
  semanticCohortsBuilt: 0,
  anchorsAssignedToCohorts: 0,
  compoundConceptMatches: 0,
  multiTokenMatches: 0,
  isolatedTokenMatches: 0,
  lowDiscriminativeTokenMatches: 0,
  crossModuleTokenCollisions: 0,
  crossProductTokenCollisions: 0,
  semanticEvidencePathAligned: 0,
  semanticEvidencePathRejected: 0,
  candidatesRejectedFromStrongBySemanticGate: 0,
  hypothesesRejectedFromStrongBySemanticGate: 0,
  crossCohortSemanticMerges: 0,
  falseStrongBindings: 0,
  additionalOracleCallsForDomainCoherence: 0,
});

export const emptyDomainCoherenceAudit = (): DomainCoherenceAudit => ({
  scenarioSpecificDomainCoherenceBranches: 0,
  hardcodedTwgSemanticRules: 0,
  hardcodedUnseenSemanticRules: 0,
  hardcodedCurrentPositionSemanticRules: 0,
  hardcodedPayrollSemanticRules: 0,
  domainStopwordExceptionRules: 0,
  goldenPhysicalMappingUsedForSemanticCoherence: 0,
  expectedOracleNamesUsedForSemanticCoherence: 0,
  semanticEvidencePathAlignedViolations: 0,
  crossCohortSemanticMerges: 0,
});

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

function normalizeToken(t: string): string {
  return stripDiacritics(t.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/gi, ''));
}

/** Extract normalized terms from business concept — preserve compound forms. */
export function normalizedConceptTerms(concept: string): string[] {
  const raw = stripDiacritics(concept.toLowerCase());
  const words = raw.split(/[^a-z0-9ąćęłńóśźż]+/i).filter((w) => w.length >= 3);
  const out = new Set<string>(words);
  if (words.length >= 2) {
    out.add(words.join(''));
    out.add(words.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(''));
  }
  return [...out];
}

function camelSplit(blob: string): string[] {
  const parts = blob.split(/[^a-zA-Z0-9]+/);
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    const pieces = p.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/);
    for (const x of pieces) {
      const n = normalizeToken(x);
      if (n.length >= 3) out.push(n);
    }
  }
  return out;
}

function moduleFromPath(path: string): string | null {
  const m = /(?:^|[|.])((?:bos|plg)[A-Za-z0-9]+)/i.exec(path);
  return m ? m[1]!.toLowerCase() : null;
}

function productFromPath(path: string): string | null {
  if (/personel|personnel|pracownik|kdr|kp_/i.test(path)) return 'personel';
  if (/finances|finanse|vat|dokumentyvat/i.test(path)) return 'finance';
  if (/production|produkcj|warehouse|gma/i.test(path)) return 'production';
  if (/rekrutac/i.test(path)) return 'recruitment';
  return null;
}

function anchorModule(a: SemanticApplicationAnchor): string | null {
  return (a.moduleHint ?? a.recognitionSource ?? '').replace(/\.dll$/i, '').toLowerCase() || null;
}

function cohortKey(a: SemanticApplicationAnchor): string {
  const label = normalizeToken(a.label ?? '');
  const form = (a.formRef ?? '').toLowerCase();
  const mod = anchorModule(a) ?? '';
  if (form) return `form:${form}`;
  if (label.length >= 6) return `label:${label}`;
  return `anchor:${a.anchorId}:${mod}`;
}

export function buildSemanticAnchorCohorts(input: {
  anchors: SemanticApplicationAnchor[];
  businessConcept: string;
}): SemanticAnchorCohort[] {
  const conceptTerms = normalizedConceptTerms(input.businessConcept);
  const compoundTerms = conceptTerms.filter((t) => t.length >= 8 || /[A-Z]/.test(t));
  const byKey = new Map<string, SemanticAnchorCohort>();

  for (const a of input.anchors) {
    if (a.anchorType === 'module_hint' || a.anchorType === 'concept_token') continue;
    const key = cohortKey(a);
    const labelTerms = [
      ...normalizedConceptTerms(a.label ?? ''),
      ...camelSplit(a.label ?? ''),
      ...(a.matchTokens ?? []).map(normalizeToken),
    ];
    const terms = [...new Set([...labelTerms, ...conceptTerms.filter((t) => labelTerms.some((l) => l.includes(t) || t.includes(l)))])];
    const specificity =
      (a.anchorType === 'pa_plugin' ? 3 : 2) +
      (terms.filter((t) => conceptTerms.includes(t)).length >= 2 ? 2 : 0) +
      (compoundTerms.some((c) => (a.label ?? '').replace(/\s/g, '').toLowerCase().includes(c.toLowerCase())) ? 3 : 0);

    const existing = byKey.get(key);
    if (existing) {
      existing.anchorIds.push(a.anchorId);
      existing.anchorLabels.push(a.label);
      existing.anchorTypes.push(a.anchorType);
      existing.normalizedConceptTerms = [...new Set([...existing.normalizedConceptTerms, ...terms])];
      existing.semanticSpecificity = Math.max(existing.semanticSpecificity, specificity);
      existing.provenance.push(`anchor:${a.anchorId}`);
    } else {
      byKey.set(key, {
        cohortId: key,
        anchorIds: [a.anchorId],
        anchorLabels: [a.label],
        anchorTypes: [a.anchorType],
        productSurface: productFromPath(`${a.label}|${a.formRef ?? ''}`),
        module: anchorModule(a),
        normalizedConceptTerms: terms,
        compoundTerms: compoundTerms.filter((c) =>
          (a.label ?? '').replace(/\s/g, '').toLowerCase().includes(c.toLowerCase()),
        ),
        semanticSpecificity: specificity,
        provenance: [`anchor:${a.anchorId}`, ...a.semanticEvidence.slice(0, 3)],
      });
    }
  }

  return [...byKey.values()].sort((a, b) => b.semanticSpecificity - a.semanticSpecificity);
}

export function candidatePathBlob(c: OracleCandidate): string {
  return [c.reachedFromApplicationNode, ...c.acePath].join('|').toLowerCase();
}

export function anchorAlignsWithCandidate(
  anchor: SemanticApplicationAnchor,
  candidate: OracleCandidate,
): boolean {
  const blob = candidatePathBlob(candidate);
  const formNeedle = (anchor.formRef ?? '').toLowerCase();
  if (formNeedle.length >= 6 && blob.includes(formNeedle.slice(0, Math.min(formNeedle.length, 48)))) {
    return true;
  }
  const labelCompact = normalizeToken(anchor.label ?? '');
  if (labelCompact.length >= 8 && blob.includes(labelCompact)) return true;

  const labelParts = camelSplit(anchor.label ?? '').filter((p) => p.length >= 4);
  if (labelParts.length >= 2) {
    const matchedParts = labelParts.filter((p) => blob.includes(p));
    if (matchedParts.length >= 2) return true;
    if (matchedParts.length === 1 && labelParts.length === 2 && labelCompact.length >= 10) {
      return blob.includes(labelCompact);
    }
  } else if (labelParts.length === 1 && labelParts[0]!.length >= 8 && blob.includes(labelParts[0]!)) {
    return true;
  }

  return false;
}

function buildTokenDocumentFrequency(candidates: OracleCandidate[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const c of candidates) {
    const seen = new Set<string>();
    for (const t of camelSplit(candidatePathBlob(c))) {
      if (seen.has(t)) continue;
      seen.add(t);
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
  }
  return freq;
}

function countConceptCoverage(
  conceptTerms: string[],
  blob: string,
): { compound: number; multi: number; isolated: number; matchedTerms: string[] } {
  const matched: string[] = [];
  for (const t of conceptTerms) {
    if (t.length < 3) continue;
    if (blob.includes(t.toLowerCase())) matched.push(t);
  }
  const compound = conceptTerms.filter((t) => t.length >= 8 && blob.includes(t.toLowerCase())).length;
  const multi = matched.length >= 2 ? matched.length : 0;
  const isolated = matched.length === 1 ? 1 : 0;
  return { compound, multi, isolated, matchedTerms: matched };
}

export function assessCandidateSemanticCoherence(input: {
  candidate: OracleCandidate;
  businessConcept: string;
  anchors: SemanticApplicationAnchor[];
  cohorts: SemanticAnchorCohort[];
  tokenDocFreq: Map<string, number>;
  candidateCount: number;
}): CandidateSemanticAssessment {
  const ref = `${input.candidate.owner}.${input.candidate.objectName}`;
  const blob = candidatePathBlob(input.candidate);
  const conceptTerms = normalizedConceptTerms(input.businessConcept);
  const alignedAnchors = input.anchors.filter((a) => anchorAlignsWithCandidate(a, input.candidate));
  const alignedIds = alignedAnchors.map((a) => a.anchorId);

  let bestCohort: SemanticAnchorCohort | null = null;
  let bestScore = -1;
  for (const cohort of input.cohorts) {
    if (!cohort.anchorIds.some((id) => alignedIds.includes(id))) continue;
    const score = cohort.semanticSpecificity + cohort.compoundTerms.length * 2;
    if (score > bestScore) {
      bestScore = score;
      bestCohort = cohort;
    }
  }

  const coverage = countConceptCoverage(conceptTerms, blob);
  for (const a of alignedAnchors) {
    const ac = countConceptCoverage(conceptTerms, normalizeToken(a.label ?? '') + blob);
    coverage.compound += ac.compound;
    if (ac.multi > coverage.multi) coverage.multi = ac.multi;
  }

  let lowDisc = 0;
  for (const t of coverage.matchedTerms) {
    const freq = input.tokenDocFreq.get(normalizeToken(t)) ?? 0;
    if (freq >= Math.max(3, Math.ceil(input.candidateCount * 0.25))) lowDisc += 1;
  }

  const candidateProduct = productFromPath(blob);
  const candidateModule = moduleFromPath(blob);
  const cohortProduct = bestCohort?.productSurface ?? productFromPath(bestCohort?.anchorLabels.join('|') ?? '');
  const cohortModule = bestCohort?.module ?? null;
  const crossModule =
    Boolean(cohortModule && candidateModule && cohortModule !== candidateModule && coverage.isolated > 0);
  const crossProduct =
    Boolean(cohortProduct && candidateProduct && cohortProduct !== candidateProduct && coverage.compound === 0);

  const pathAligned = alignedIds.length > 0;
  const technicalStrong =
    input.candidate.supportingEvidence.length >= 2 ||
    input.candidate.aceEdgeKind === 'GATEWAY_READS_FROM_ORACLE_OBJECT';
  const technicalConfidence: CandidateSemanticAssessment['technicalConfidence'] = technicalStrong
    ? 'strong'
    : input.candidate.supportingEvidence.length > 0
      ? 'weak'
      : 'none';

  const negative: string[] = [];
  if (!pathAligned) negative.push('semantic_path_not_aligned');
  if (coverage.compound === 0 && coverage.multi < 2 && coverage.isolated > 0) {
    negative.push('isolated_generic_token_overlap_only');
  }
  if (lowDisc > 0 && coverage.compound === 0) negative.push('low_discriminative_token');
  if (crossProduct) negative.push('cross_product_scope_without_compound_match');
  if (crossModule && coverage.multi < 2) negative.push('cross_module_weak_token_only');

  let semanticCoherence: SemanticCoherenceLevel = 'none';
  if (!pathAligned) {
    semanticCoherence = 'none';
  } else if (coverage.compound >= 1 || (bestCohort?.compoundTerms.length ?? 0) > 0) {
    semanticCoherence = 'strong';
  } else if (coverage.multi >= 2 && lowDisc === 0) {
    semanticCoherence = 'strong';
  } else if (coverage.multi >= 2 || (bestCohort?.semanticSpecificity ?? 0) >= 4) {
    semanticCoherence = 'moderate';
  } else if (coverage.isolated > 0 || alignedIds.length > 0) {
    semanticCoherence = 'weak';
  }

  if (crossProduct && semanticCoherence !== 'none') {
    semanticCoherence = coverage.compound > 0 ? semanticCoherence : 'weak';
  }

  const allowsStrong =
    pathAligned &&
    (semanticCoherence === 'strong' ||
      (semanticCoherence === 'moderate' && coverage.multi >= 2 && !crossProduct));

  const bindingConfidence: SchemaRoleResolutionStatus = allowsStrong
    ? 'strong_inference_readonly'
    : pathAligned && semanticCoherence === 'moderate'
      ? 'ambiguous'
      : 'insufficient';

  return {
    candidateCanonicalId: ref,
    semanticCohortId: bestCohort?.cohortId ?? null,
    originatingApplicationAnchorId: alignedAnchors[0]?.anchorId ?? null,
    alignedAnchorIds: alignedIds,
    compoundConceptMatches: coverage.compound,
    multiTokenMatches: coverage.multi,
    isolatedTokenMatches: coverage.isolated,
    lowDiscriminativeTokenMatches: lowDisc,
    crossModuleTokenCollisions: crossModule,
    crossProductTokenCollisions: crossProduct,
    semanticEvidencePathAligned: pathAligned,
    crossCohortSemanticMerge: false,
    technicalConfidence,
    semanticCoherence,
    bindingConfidence,
    negativeEvidence: negative,
    reasonStrongWouldBeGranted:
      allowsStrong && technicalStrong
        ? 'path_aligned_semantic_coherence_with_technical_reachability'
        : technicalStrong && !allowsStrong
          ? 'technical_reachability_without_semantic_coherence'
          : null,
  };
}

export function buildCandidateSemanticAssessments(input: {
  businessConcept: string;
  anchors: SemanticApplicationAnchor[];
  candidates: OracleCandidate[];
}): {
  cohorts: SemanticAnchorCohort[];
  assessments: CandidateSemanticAssessment[];
  byRef: Map<string, CandidateSemanticAssessment>;
  metrics: DomainCoherenceMetrics;
} {
  const metrics = emptyDomainCoherenceMetrics();
  const cohorts = buildSemanticAnchorCohorts({
    anchors: input.anchors,
    businessConcept: input.businessConcept,
  });
  metrics.semanticCohortsBuilt = cohorts.length;
  metrics.anchorsAssignedToCohorts = new Set(cohorts.flatMap((c) => c.anchorIds)).size;

  const tokenDocFreq = buildTokenDocumentFrequency(input.candidates);
  const assessments = input.candidates
    .filter((c) => c.candidateRoleHypotheses.includes('assignment_source'))
    .map((c) =>
      assessCandidateSemanticCoherence({
        candidate: c,
        businessConcept: input.businessConcept,
        anchors: input.anchors,
        cohorts,
        tokenDocFreq,
        candidateCount: input.candidates.length,
      }),
    );

  for (const a of assessments) {
    metrics.compoundConceptMatches += a.compoundConceptMatches;
    metrics.multiTokenMatches += a.multiTokenMatches;
    metrics.isolatedTokenMatches += a.isolatedTokenMatches;
    metrics.lowDiscriminativeTokenMatches += a.lowDiscriminativeTokenMatches;
    if (a.crossModuleTokenCollisions) metrics.crossModuleTokenCollisions += 1;
    if (a.crossProductTokenCollisions) metrics.crossProductTokenCollisions += 1;
    if (a.semanticEvidencePathAligned) metrics.semanticEvidencePathAligned += 1;
    else metrics.semanticEvidencePathRejected += 1;
  }

  return {
    cohorts,
    assessments,
    byRef: new Map(assessments.map((a) => [a.candidateCanonicalId, a])),
    metrics,
  };
}

export function semanticGateAllowsStrong(status: SchemaRoleResolutionStatus, assessment: CandidateSemanticAssessment | undefined): boolean {
  if (status !== 'strong_inference_readonly' && status !== 'proven_exact') return true;
  if (!assessment) return false;
  return (
    assessment.semanticEvidencePathAligned &&
    (assessment.semanticCoherence === 'strong' ||
      (assessment.semanticCoherence === 'moderate' && assessment.multiTokenMatches >= 2 && !assessment.crossProductTokenCollisions)) &&
    assessment.compoundConceptMatches + assessment.multiTokenMatches > 0 &&
    !(assessment.isolatedTokenMatches > 0 && assessment.compoundConceptMatches === 0 && assessment.multiTokenMatches < 2)
  );
}

export function applySemanticGateToHypotheses(input: {
  hypotheses: BindingHypothesis[];
  byRef: Map<string, CandidateSemanticAssessment>;
  metrics: DomainCoherenceMetrics;
}): BindingHypothesis[] {
  for (const h of input.hypotheses) {
    const assess = input.byRef.get(h.assignmentRef);
    const role = h.roleBindings.assignment_source;
    if (!role) continue;
    if (
      (role.status === 'strong_inference_readonly' || role.status === 'proven_exact') &&
      !semanticGateAllowsStrong(role.status, assess)
    ) {
      role.status = 'insufficient';
      h.hypothesisStatus = 'insufficient';
      h.reasonForStatus = `Semantic coherence gate: ${assess?.negativeEvidence.join(', ') ?? 'weak_path_alignment'}`;
      input.metrics.hypothesesRejectedFromStrongBySemanticGate += 1;
      input.metrics.candidatesRejectedFromStrongBySemanticGate += 1;
    }
    if (h.hypothesisStatus === 'strong_inference_readonly' && h.connectedRoleCount < 2) {
      if (!semanticGateAllowsStrong('strong_inference_readonly', assess)) {
        h.hypothesisStatus = 'insufficient';
        input.metrics.hypothesesRejectedFromStrongBySemanticGate += 1;
      }
    }
  }
  return input.hypotheses;
}

export type FalseStrongDiagnosticRow = {
  candidateCanonicalId: string;
  candidateRole: string;
  semanticAnchorIds: string[];
  semanticAnchorLabels: string[];
  semanticAnchorTypes: string[];
  anchorTokenMatches: string[];
  compoundTokenMatches: number;
  isolatedTokenMatches: number;
  applicationSurfaceIds: string[];
  applicationSurfaceLabels: string[];
  applicationModules: string[];
  applicationPathIds: string[];
  applicationPathLength: number;
  aceProvenance: string[];
  oracleProvenance: string[];
  hypothesisId: string | null;
  connectedRoleCount: number;
  semanticEvidenceOrigins: string[];
  technicalEvidenceOrigins: string[];
  existingRoleConfidence: string | null;
  existingHypothesisConfidence: string | null;
  reasonStrongWasGranted: string | null;
  semanticCoherence: SemanticCoherenceLevel;
  bindingConfidence: SchemaRoleResolutionStatus;
};

export function buildFalseStrongDiagnostic(input: {
  businessConcept: string;
  anchors: SemanticApplicationAnchor[];
  candidates: OracleCandidate[];
  hypotheses: BindingHypothesis[];
  roleAssignments?: Record<string, { objectRef?: string | null; status?: string }>;
  limit?: number;
}): { candidates: FalseStrongDiagnosticRow[]; cohorts: SemanticAnchorCohort[] } {
  const built = buildCandidateSemanticAssessments({
    businessConcept: input.businessConcept,
    anchors: input.anchors,
    candidates: input.candidates,
  });
  const limit = input.limit ?? 15;
  const rows: FalseStrongDiagnosticRow[] = [];

  const assignmentCandidates = input.candidates
    .filter((c) => c.candidateRoleHypotheses.includes('assignment_source'))
    .slice(0, limit);

  for (const c of assignmentCandidates) {
    const ref = `${c.owner}.${c.objectName}`;
    const assess = built.byRef.get(ref)!;
    const hyp = input.hypotheses.find((h) => h.assignmentRef === ref);
    const roleStatus = input.roleAssignments?.assignment_source;
    const aligned = input.anchors.filter((a) => anchorAlignsWithCandidate(a, c));
    rows.push({
      candidateCanonicalId: ref,
      candidateRole: 'assignment_source',
      semanticAnchorIds: aligned.map((a) => a.anchorId),
      semanticAnchorLabels: aligned.map((a) => a.label),
      semanticAnchorTypes: aligned.map((a) => a.anchorType),
      anchorTokenMatches: aligned.flatMap((a) => a.matchTokens ?? []),
      compoundTokenMatches: assess.compoundConceptMatches,
      isolatedTokenMatches: assess.isolatedTokenMatches,
      applicationSurfaceIds: aligned.map((a) => a.formRef ?? a.anchorId).filter(Boolean) as string[],
      applicationSurfaceLabels: aligned.map((a) => a.label),
      applicationModules: aligned.map((a) => anchorModule(a) ?? '').filter(Boolean),
      applicationPathIds: c.acePath,
      applicationPathLength: c.acePath.length,
      aceProvenance: c.acePath.slice(0, 6),
      oracleProvenance: c.supportingEvidence.slice(0, 6),
      hypothesisId: hyp?.hypothesisId ?? null,
      connectedRoleCount: hyp?.connectedRoleCount ?? 0,
      semanticEvidenceOrigins: aligned.flatMap((a) => a.semanticEvidence).slice(0, 6),
      technicalEvidenceOrigins: c.supportingEvidence.slice(0, 6),
      existingRoleConfidence:
        roleStatus?.objectRef === ref ? (roleStatus.status ?? null) : hyp?.roleBindings.assignment_source?.status ?? null,
      existingHypothesisConfidence: hyp?.hypothesisStatus ?? null,
      reasonStrongWasGranted: assess.reasonStrongWouldBeGranted,
      semanticCoherence: assess.semanticCoherence,
      bindingConfidence: assess.bindingConfidence,
    });
  }

  return { candidates: rows, cohorts: built.cohorts };
}

export function applySemanticGateToSchemaRoleResolution(input: {
  resolution: SchemaRoleResolutionResult;
  byRef: Map<string, CandidateSemanticAssessment>;
  metrics: DomainCoherenceMetrics;
}): SchemaRoleResolutionResult {
  const roles = { ...input.resolution.roleAssignmentsByRole };
  const assign = roles.assignment_source;
  if (
    assign?.objectRef &&
    (assign.status === 'strong_inference_readonly' || assign.status === 'proven_exact')
  ) {
    const assess = input.byRef.get(assign.objectRef);
    if (!semanticGateAllowsStrong(assign.status, assess)) {
      roles.assignment_source = {
        ...assign,
        status: 'insufficient',
        explanation: `Semantic coherence gate: ${assess?.negativeEvidence.join(', ') ?? 'weak_or_unaligned_semantic_provenance'}`,
      };
      input.metrics.candidatesRejectedFromStrongBySemanticGate += 1;
      input.metrics.falseStrongBindings += 1;
    }
  }
  let overallStatus = input.resolution.overallStatus;
  if (
    (overallStatus === 'strong_inference_readonly' || overallStatus === 'proven_exact') &&
    roles.assignment_source?.status === 'insufficient'
  ) {
    overallStatus = 'insufficient';
  }
  return { ...input.resolution, roleAssignmentsByRole: roles, overallStatus };
}
