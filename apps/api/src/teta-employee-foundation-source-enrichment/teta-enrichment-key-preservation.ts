import type { EnrichmentPolicy } from './teta-enrichment-policy';
import type { ViewParseResult } from './teta-enrichment-view-parser';
import type {
  DefinitionCompletenessStatus,
  KeyPreservationStatus,
  Stage3k2b2b2aSafetyCounters,
  ViewKeyPreservationEvidence,
} from './teta-enrichment.types';

export function assessKeyPreservation(input: {
  viewRef: string;
  completeness: DefinitionCompletenessStatus;
  parse: ViewParseResult | null;
  dependsOnBasePkOnly: boolean;
  projectedIdentityHints: string[];
  policy: EnrichmentPolicy;
  counters: Stage3k2b2b2aSafetyCounters;
}): ViewKeyPreservationEvidence {
  const unresolved: string[] = [];
  const risks: string[] = [];
  let status: KeyPreservationStatus = 'not_evaluable';

  if (input.completeness === 'missing' || !input.parse || input.parse.parseStatus === 'not_parsed') {
    status = (input.policy.missingDefinitionYields as KeyPreservationStatus) || 'not_evaluable';
    unresolved.push('view_definition_missing');
  } else if (
    input.completeness === 'truncated' ||
    input.completeness === 'incomplete' ||
    input.completeness === 'conflicting'
  ) {
    status = 'not_evaluable';
    unresolved.push(`definition_${input.completeness}`);
    if (input.completeness === 'truncated') {
      // guard against treating truncated as complete elsewhere
    }
  } else if (
    input.parse.parseStatus === 'parse_failed' ||
    input.parse.parseStatus === 'parsed_with_unsupported_constructs'
  ) {
    status = 'not_evaluable';
    unresolved.push(...input.parse.unsupportedConstructs.map((c) => `unsupported:${c}`));
    if (input.parse.parseStatus === 'parse_failed') unresolved.push('parse_failed');
  } else if (input.parse.grainAffectingUnresolved) {
    status = 'supported_partial';
    risks.push('grain_affecting_constructs_present');
    if (input.parse.unionUsage) risks.push('union_row_multiplication_risk');
    if (input.parse.groupingUsage || input.parse.aggregateFunctions.length) {
      risks.push('grouping_or_aggregate_grain_risk');
    }
    if (input.parse.outerJoinUsage) risks.push('outer_join_cardinality_unchecked');
  } else if (
    input.parse.projections.length > 0 &&
    input.parse.baseSources.length > 0 &&
    !input.parse.unionUsage &&
    !input.parse.groupingUsage &&
    input.parse.aggregateFunctions.length === 0 &&
    (input.completeness === 'complete' || input.completeness === 'fragmented_complete') &&
    input.parse.parseStatus === 'parsed'
  ) {
    // Proven only with complete/fragmented_complete + parsed + no unresolved grain constructs
    const hasIdentity =
      input.projectedIdentityHints.length > 0 ||
      input.parse.projections.some((p) => /id|nr_|prac/i.test(p));
    if (
      hasIdentity &&
      (input.parse.joinTypes.length === 0 ||
        input.parse.joinTypes.every((j) => j === 'INNER' || j === 'JOIN'))
    ) {
      status = 'proven';
    } else {
      status = 'supported_partial';
      risks.push('identity_projection_or_join_cardinality_not_fully_proven');
    }
  } else if (input.dependsOnBasePkOnly) {
    status = (input.policy.dependsOnPlusBasePkMaxStatus as KeyPreservationStatus) || 'supported_partial';
    unresolved.push('depends_on_plus_base_pk_insufficient_alone');
  } else {
    status = 'unproven';
  }

  // Strict guards — never allow proven from incomplete/unsupported
  if (status === 'proven') {
    if (
      input.completeness !== 'complete' &&
      input.completeness !== 'fragmented_complete'
    ) {
      input.counters.keyPreservationProvenFromIncompleteDefinition += 1;
      status = 'not_evaluable';
    }
    if (input.parse?.parseStatus !== 'parsed' || (input.parse?.unsupportedConstructs.length ?? 0) > 0) {
      input.counters.keyPreservationProvenWithUnsupportedConstructs += 1;
      status = 'not_evaluable';
    }
  }
  if (input.completeness === 'truncated' && status === 'proven') {
    input.counters.truncatedViewDefinitionTreatedAsComplete += 1;
    status = 'not_evaluable';
  }

  return {
    viewRef: input.viewRef,
    baseSourceRefs: input.parse?.baseSources ?? [],
    projectedCardIdentityRefs: input.projectedIdentityHints,
    joinGraph: input.parse?.joinTypes ?? [],
    joinCardinalityEvidence:
      status === 'proven' ? 'no_unresolved_row_multiplying_constructs' : 'unchecked_or_partial',
    rowMultiplicationRisks: risks,
    distinctUsage: input.parse?.distinctUsage ?? false,
    groupingUsage: input.parse?.groupingUsage ?? false,
    unionUsage: input.parse?.unionUsage ?? false,
    filterEffects: input.parse?.hasWhere ? ['where_present'] : [],
    keyPreservationStatus: status,
    evidenceRefs: input.parse ? [`parse:${input.parse.parseStatus}`] : [],
    unresolvedRisks: unresolved,
  };
}
