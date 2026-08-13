/**
 * Classify Stage 4 clarification dimensions into user-resolvable vs technical-only.
 * which_form is user-resolvable only when eligible surfaces partition surviving hypotheses.
 */
import type { Stage4ResolutionResult } from '../teta-application-first-evidence-resolver-v2';
import type {
  ClassifiedAmbiguityDimension,
  TechnicalOnlyDimension,
  UserResolvableDimension,
} from './teta-stage5.types';
import { planEligibleApplicationSurfaceChoices } from './teta-stage5-surfaces';

const TECHNICAL_SOURCE_MAP: Record<string, TechnicalOnlyDimension> = {
  missing_application_technical_path: 'missing_application_technical_path',
  missing_oracle_relation: 'missing_oracle_relation',
  missing_column_relation: 'missing_column_relation',
  missing_lookup_binding: 'missing_lookup_binding',
  missing_temporal_implementation: 'missing_temporal_implementation',
  runtime_only_binding: 'runtime_only_binding',
  source_unavailable: 'source_unavailable',
  conflicting_technical_evidence: 'conflicting_technical_evidence',
  dictionary_vs_assignment: 'missing_column_relation',
  approved_vs_discovery_conflict: 'conflicting_technical_evidence',
};

function hypothesisCount(stage4: Stage4ResolutionResult): number {
  return stage4.bindingHypotheses?.length ?? stage4.metrics.bindingHypothesesBuilt ?? 0;
}

function connectedHypothesisCount(stage4: Stage4ResolutionResult): number {
  return (
    stage4.bindingHypotheses?.filter(
      (h) =>
        h.hypothesisStatus === 'strong_inference_readonly' ||
        h.hypothesisStatus === 'proven_exact' ||
        h.connectedRoleCount >= 2,
    ).length ?? stage4.metrics.connectedHypotheses
  );
}

/**
 * True when Stage 4 already has a coherent core topology and remaining gaps
 * are technical (display/temporal/source), not business ambiguity.
 */
export function isTechnicalGapOnly(stage4: Stage4ResolutionResult): boolean {
  const connected = connectedHypothesisCount(stage4);
  if (connected >= 1) {
    const dims = stage4.clarificationDimensions ?? [];
    const onlyTechnical =
      dims.length === 0 ||
      dims.every((d) =>
        [
          'missing_application_technical_path',
          'dictionary_vs_assignment',
          'missing_temporal_implementation',
          'missing_lookup_binding',
          'missing_column_relation',
          'source_unavailable',
          'which_form',
        ].includes(d),
      );
    if (connected === 1 && stage4.resolutionStatus === 'insufficient') {
      const roles = stage4.schemaRoleResolution?.roleAssignmentsByRole ?? {};
      const hasCore =
        Boolean(roles.assignment_source?.objectRef) &&
        (Boolean(roles.dictionary_reference?.column) || Boolean(roles.dictionary_identity?.objectRef));
      if (hasCore) return true;
    }
    if (onlyTechnical && connected >= 1) {
      // which_form alone among dims with connected hyp → still technical if surfaces don't partition
      if (dims.includes('which_form') && dims.every((d) => d === 'which_form' || TECHNICAL_SOURCE_MAP[d])) {
        const surfaces = planEligibleApplicationSurfaceChoices(stage4, 'which_form');
        if (!surfaces.partitionsUseful) return true;
      } else if (!dims.includes('which_form') && !dims.includes('which_assignment_source')) {
        return true;
      } else if (dims.every((d) => TECHNICAL_SOURCE_MAP[d] || d === 'which_form')) {
        const surfaces = planEligibleApplicationSurfaceChoices(stage4, 'which_form');
        if (!surfaces.partitionsUseful) return true;
      }
    }
  }
  return false;
}

export function classifyAmbiguityDimensions(input: {
  stage4: Stage4ResolutionResult;
  alreadyResolved: string[];
}): ClassifiedAmbiguityDimension[] {
  const stage4 = input.stage4;
  const dims = [...(stage4.clarificationDimensions ?? [])];
  const out: ClassifiedAmbiguityDimension[] = [];
  const hypN = hypothesisCount(stage4);
  const connected = connectedHypothesisCount(stage4);

  for (const raw of dims) {
    if (TECHNICAL_SOURCE_MAP[raw]) {
      out.push({
        dimensionId: `tech:${raw}`,
        kind: 'technical_only',
        technicalOnlyDimension: TECHNICAL_SOURCE_MAP[raw],
        sourceDimension: raw,
        reason: `Internal Stage 4 dimension '${raw}' is a technical evidence gap — user cannot resolve it.`,
        separatesHypotheses: 0,
        applicationEvidenceRefs: [],
      });
      continue;
    }

    if (raw === 'which_form') {
      const surfaces = planEligibleApplicationSurfaceChoices(stage4, 'which_form');
      if (surfaces.partitionsUseful && surfaces.choices.length >= 2 && connected !== 1) {
        out.push({
          dimensionId: 'user:which_form',
          kind: 'user_resolvable',
          userResolvableDimension: surfaces.dimension,
          sourceDimension: raw,
          reason:
            'Eligible application surfaces backed by surviving hypotheses partition the viable set.',
          separatesHypotheses: surfaces.choices.length,
          applicationEvidenceRefs: surfaces.choices.map((c) => c.label).slice(0, 8),
        });
      } else {
        out.push({
          dimensionId: 'tech:which_form_insufficient_surfaces',
          kind: 'technical_only',
          technicalOnlyDimension: 'missing_application_technical_path',
          sourceDimension: raw,
          reason:
            surfaces.choices.length < 2
              ? 'which_form has fewer than two hypothesis-backed application surfaces that partition surviving hypotheses.'
              : 'Single connected hypothesis — form choice would not change business meaning.',
          separatesHypotheses: 0,
          applicationEvidenceRefs: surfaces.audit.candidates
            .filter((c) => c.eligible)
            .map((c) => c.choiceLabel)
            .slice(0, 8),
        });
      }
      continue;
    }

    if (raw === 'which_assignment_source') {
      const surfaces = planEligibleApplicationSurfaceChoices(stage4, 'which_application_surface');
      if (surfaces.partitionsUseful && surfaces.choices.length >= 2 && hypN >= 2 && connected !== 1) {
        out.push({
          dimensionId: 'user:which_application_surface',
          kind: 'user_resolvable',
          userResolvableDimension: 'which_application_surface',
          sourceDimension: raw,
          reason:
            'Internal which_assignment_source maps to distinct hypothesis-backed application surfaces.',
          separatesHypotheses: surfaces.choices.length,
          applicationEvidenceRefs: surfaces.choices.map((c) => c.label).slice(0, 8),
        });
      } else {
        out.push({
          dimensionId: 'tech:which_assignment_source',
          kind: 'technical_only',
          technicalOnlyDimension: 'which_assignment_source_technical',
          sourceDimension: raw,
          reason:
            'which_assignment_source does not map to distinct visible business/application meanings with hypothesis partitions.',
          separatesHypotheses: 0,
          applicationEvidenceRefs: [],
        });
      }
      continue;
    }

    out.push({
      dimensionId: `tech:unknown:${raw}`,
      kind: 'technical_only',
      technicalOnlyDimension: 'conflicting_technical_evidence',
      sourceDimension: raw,
      reason: `Unrecognized dimension '${raw}' suppressed as technical-only (fail closed).`,
      separatesHypotheses: 0,
      applicationEvidenceRefs: [],
    });
  }

  return out;
}

export function detectAlreadyResolvedDimensions(input: {
  question?: string | null;
  businessConcept: string;
  temporalIntent?: string | null;
  applicationContext?: string | null;
  formScope?: string | null;
}): string[] {
  const resolved: string[] = [];
  const blob = `${input.question ?? ''} ${input.businessConcept} ${input.applicationContext ?? ''}`.toLowerCase();
  if (
    input.temporalIntent === 'current_on_oracle_sysdate' ||
    /\baktualn|\bcurrent\b|\bbieżąc|\bteraz\b/.test(blob)
  ) {
    resolved.push('current_vs_history');
  }
  if (/\bhistori|\bhistory\b|\barchiw/.test(blob) && !/\baktualn|\bcurrent\b/.test(blob)) {
    resolved.push('current_vs_history');
  }
  if (input.formScope?.trim() || /\bformularz\b.+:/.test(blob)) {
    resolved.push('which_form');
  }
  return [...new Set(resolved)];
}

/** Test/fixture-only semantic dimension injection — not used by production plan path. */
export function injectSemanticDimension(
  dims: ClassifiedAmbiguityDimension[],
  dimension: UserResolvableDimension,
  reason: string,
  evidenceRefs: string[],
  separates: number,
): ClassifiedAmbiguityDimension[] {
  if (dims.some((d) => d.userResolvableDimension === dimension)) return dims;
  return [
    ...dims,
    {
      dimensionId: `user:${dimension}`,
      kind: 'user_resolvable',
      userResolvableDimension: dimension,
      sourceDimension: `semantic:${dimension}`,
      reason,
      separatesHypotheses: separates,
      applicationEvidenceRefs: evidenceRefs,
    },
  ];
}
