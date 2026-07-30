import { sha256, stableStringify } from '../teta-source-extraction/teta-canonical-source-contract';
import type { ExistingKnowledgeAnchorsV1 } from './teta-correlation-policy';
import type {
  CorrelationResultV1,
  GraphCorrelationIndex,
  NormalizedCandidate,
} from './teta-correlation.types';
import { normalizePreserveCodes, normalizeText } from './teta-candidate-normalizer';

export type HelpCorrelationCounters = {
  correlationHintsRead: number;
  correlationHintsResolvedExact: number;
  correlationHintsResolvedSupported: number;
  correlationHintsAmbiguous: number;
  correlationHintsUnresolved: number;
  correlationHintsWithoutNodeOrPath: number;
  ambiguousCorrelationsAutoResolved: number;
  graphCorrelationOracleConnections: number;
  correlationQueriesAttempted: number;
  correlationHintsSourceUnavailable: number;
  correlationHintsUnresolvedAfterQuery: number;
  correlationsReportedUnresolvedWithoutQuery: number;
  correlationSourceAvailabilityMisreported: number;
};

export function emptyHelpCorrelationCounters(): HelpCorrelationCounters {
  return {
    correlationHintsRead: 0,
    correlationHintsResolvedExact: 0,
    correlationHintsResolvedSupported: 0,
    correlationHintsAmbiguous: 0,
    correlationHintsUnresolved: 0,
    correlationHintsWithoutNodeOrPath: 0,
    ambiguousCorrelationsAutoResolved: 0,
    graphCorrelationOracleConnections: 0,
    correlationQueriesAttempted: 0,
    correlationHintsSourceUnavailable: 0,
    correlationHintsUnresolvedAfterQuery: 0,
    correlationsReportedUnresolvedWithoutQuery: 0,
    correlationSourceAvailabilityMisreported: 0,
  };
}

export function buildDefaultGraphIndex(anchors: ExistingKnowledgeAnchorsV1): GraphCorrelationIndex {
  return {
    available: true,
    nodesByLabel: Object.fromEntries(
      Object.entries(anchors.syntheticAnchors.graphNodes).map(([k, v]) => [normalizeText(k), v]),
    ),
    pathsByNodeId: anchors.syntheticAnchors.graphPaths,
    graphSourceHash: sha256(stableStringify(anchors.syntheticAnchors.graphNodes)),
  };
}

function hintEntries(n: NormalizedCandidate): Array<{ kind: string; value: string }> {
  const h = n.occurrence.correlationHints;
  const out: Array<{ kind: string; value: string }> = [];
  for (const v of h.formLabels) out.push({ kind: 'formLabel', value: v });
  for (const v of h.fieldLabels) out.push({ kind: 'fieldLabel', value: v });
  for (const v of h.actionLabels) out.push({ kind: 'actionLabel', value: v });
  for (const v of h.statusLabels) out.push({ kind: 'statusLabel', value: v });
  for (const v of h.parameterNames) out.push({ kind: 'parameterName', value: v });
  for (const v of h.componentCodes) out.push({ kind: 'componentCode', value: v });
  for (const v of h.functionNames) out.push({ kind: 'functionName', value: v });
  for (const v of h.oracleIdentifiers) out.push({ kind: 'oracleIdentifier', value: v });
  for (const v of h.helpSearchTerms) out.push({ kind: 'helpSearchTerm', value: v });
  return out;
}

export function correlateHelpGraph(
  normalized: NormalizedCandidate[],
  graph: GraphCorrelationIndex | null,
  counters: HelpCorrelationCounters,
): CorrelationResultV1[] {
  const results: CorrelationResultV1[] = [];
  counters.graphCorrelationOracleConnections = 0;

  for (const n of normalized) {
    for (const hint of hintEntries(n)) {
      counters.correlationHintsRead += 1;
      const key = normalizeText(hint.value);
      counters.correlationQueriesAttempted += 1;
      if (!graph || !graph.available) {
        results.push({
          correlationId: `correlation:sha256:${sha256(stableStringify({ hint: key, occ: n.occurrence.candidateOccurrenceId, st: 'source_unavailable' }))}`,
          hintValue: hint.value,
          hintKind: hint.kind,
          status: 'source_unavailable',
          targetNodeIds: [],
          evidencePath: [],
          graphSourceHash: null,
          occurrenceId: n.occurrence.candidateOccurrenceId,
          warnings: ['correlation_source_unavailable'],
        });
        counters.correlationHintsSourceUnavailable += 1;
        continue;
      }

      const nodes = graph.nodesByLabel[key] ?? [];
      if (nodes.length === 1) {
        const paths = graph.pathsByNodeId[nodes[0]] ?? [];
        if (!paths.length) {
          counters.correlationHintsWithoutNodeOrPath += 1;
          counters.correlationHintsUnresolved += 1;
          counters.correlationHintsUnresolvedAfterQuery += 1;
          results.push({
            correlationId: `correlation:sha256:${sha256(stableStringify({ hint: key, occ: n.occurrence.candidateOccurrenceId, st: 'unresolved_no_path' }))}`,
            hintValue: hint.value,
            hintKind: hint.kind,
            status: 'unresolved',
            targetNodeIds: nodes,
            evidencePath: [],
            graphSourceHash: graph.graphSourceHash,
            occurrenceId: n.occurrence.candidateOccurrenceId,
            warnings: ['exact_requires_node_and_path'],
          });
          continue;
        }
        counters.correlationHintsResolvedExact += 1;
        results.push({
          correlationId: `correlation:sha256:${sha256(stableStringify({ hint: key, occ: n.occurrence.candidateOccurrenceId, st: 'exact', nodes }))}`,
          hintValue: hint.value,
          hintKind: hint.kind,
          status: 'exact',
          targetNodeIds: nodes,
          evidencePath: paths,
          graphSourceHash: graph.graphSourceHash,
          occurrenceId: n.occurrence.candidateOccurrenceId,
          warnings: [],
        });
        continue;
      }

      if (nodes.length > 1) {
        counters.correlationHintsAmbiguous += 1;
        // never auto-resolve
        counters.ambiguousCorrelationsAutoResolved += 0;
        results.push({
          correlationId: `correlation:sha256:${sha256(stableStringify({ hint: key, occ: n.occurrence.candidateOccurrenceId, st: 'ambiguous', nodes }))}`,
          hintValue: hint.value,
          hintKind: hint.kind,
          status: 'ambiguous',
          targetNodeIds: nodes.slice().sort(),
          evidencePath: [],
          graphSourceHash: graph.graphSourceHash,
          occurrenceId: n.occurrence.candidateOccurrenceId,
          warnings: ['ambiguous_not_auto_resolved'],
        });
        continue;
      }

      counters.correlationHintsUnresolved += 1;
      counters.correlationHintsUnresolvedAfterQuery += 1;
      results.push({
        correlationId: `correlation:sha256:${sha256(stableStringify({ hint: key, occ: n.occurrence.candidateOccurrenceId, st: 'unresolved' }))}`,
        hintValue: hint.value,
        hintKind: hint.kind,
        status: 'unresolved',
        targetNodeIds: [],
        evidencePath: [],
        graphSourceHash: graph.graphSourceHash,
        occurrenceId: n.occurrence.candidateOccurrenceId,
        warnings: [],
      });
      void normalizePreserveCodes;
    }
  }

  results.sort((a, b) => a.correlationId.localeCompare(b.correlationId));
  return results;
}
