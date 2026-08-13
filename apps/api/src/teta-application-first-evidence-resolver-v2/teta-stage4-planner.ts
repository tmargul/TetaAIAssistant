/**
 * EvidenceResolutionPlanner — SchemaEvidenceGraph assembly, Stage 3 policy, Stage 0 invoke.
 */
import { resolveSchemaRoles } from '../teta-schema-role-resolution/teta-schema-role-resolver';
import type {
  EvidenceClaim,
  SchemaEvidenceGraph,
  SchemaRoleResolutionResult,
} from '../teta-schema-role-resolution/teta-schema-role-resolution.types';
import { analyzeWritePath } from '../teta-targeted-write-path-stage3/teta-stage3-analyze';
import type { Stage3WritePathAnalysisResult } from '../teta-targeted-write-path-stage3/teta-stage3.types';
import { loadApprovedBindingsEvidence } from './teta-stage4-approved-bindings';
import {
  bindEvidenceToRoleGraph,
  unusedStage3Reason,
  type BindAdapterMetrics,
  type DiscoveredSubject,
} from './teta-stage4-bind';
import type { ApplicationAnchorResolveResult } from './teta-stage4-anchors';
import type { AceTraversalResult } from './teta-stage4-ace-traverse';
import type { OracleExpandResult, OracleCandidate } from './teta-stage4-oracle-expand';
import type { Stage4ResolutionRequest } from './teta-stage4.types';

export type Stage3PlanResult = {
  writePathsRequested: number;
  writePathsSucceeded: number;
  writePathEvidenceItemsAdded: number;
  writePathRequestReason: string | null;
  writePathResultUsed: boolean;
  writePathResultUnusedReason: string | null;
  claims: SchemaEvidenceGraph['claims'];
};

export function decideStage3Request(input: {
  ace: AceTraversalResult;
  oracle: OracleExpandResult;
  mode: Stage4ResolutionRequest['mode'];
}): { request: boolean; reason: string | null; targets: Array<{ owner: string; objectName: string }> } {
  if (input.mode === 'blind_physical_rediscovery') {
    // Blind may still request Stage 3 static analysis (no approved seeds) when useful.
  }
  const targets: Array<{ owner: string; objectName: string }> = [];
  const reasons: string[] = [];

  if (input.ace.dacPackages.length > 0 && input.oracle.candidates.length > 0) {
    // Gateway reaches DAC but persistence target may be unclear — probe top candidate with writes
    const withDacUnclear = input.oracle.candidates.filter(
      (c) => c.stage2Facts.writesTo.length === 0 && /_DAC$/i.test(
        input.ace.dacPackages.find((d) => d.gatewayName.includes(c.objectName))?.packageRef ?? '',
      ) === false,
    );
    if (input.ace.dacPackages.length > 0 && input.oracle.candidates.some((c) => c.stage2Facts.writesTo.length === 0)) {
      reasons.push('gateway_reaches_dac_but_write_target_unclear');
      const c = input.oracle.candidates[0]!;
      targets.push({ owner: c.owner, objectName: c.objectName });
    }
    void withDacUnclear;
  }

  if (input.oracle.candidates.length >= 2) {
    const assignmentLike = input.oracle.candidates.filter((c) =>
      c.candidateRoleHypotheses.includes('assignment_source'),
    );
    if (assignmentLike.length >= 2) {
      reasons.push('multiple_oracle_candidate_write_targets');
      for (const c of assignmentLike.slice(0, 2)) {
        if (!targets.some((t) => t.objectName === c.objectName)) {
          targets.push({ owner: c.owner, objectName: c.objectName });
        }
      }
    }
  }

  // Cap Stage 3 invocations
  return {
    request: targets.length > 0,
    reason: reasons[0] ?? null,
    targets: targets.slice(0, 2),
  };
}

export function convertStage3ResultToClaims(input: {
  result: Stage3WritePathAnalysisResult;
  targetOwner: string;
  targetObjectName: string;
  relevantObjectRefs: Set<string>;
}): { claims: EvidenceClaim[]; added: number; unusedReason: string | null } {
  const claims: EvidenceClaim[] = [];
  const targetRef = `${input.targetOwner}.${input.targetObjectName}`;
  const relevant = (ref: string | null | undefined): boolean => {
    if (!ref) return false;
    if (input.relevantObjectRefs.size === 0) return true;
    const upper = ref.toUpperCase();
    if (upper === targetRef) return true;
    for (const r of input.relevantObjectRefs) {
      if (upper === r.toUpperCase() || upper.endsWith(`.${r.split('.')[1]}`)) return true;
    }
    return false;
  };

  for (const w of input.result.writerCandidates.slice(0, 12)) {
    if (!relevant(targetRef)) continue;
    const fp = `evidenceOriginFingerprint:stage3_writer:${w.fromId}|${targetRef}`;
    claims.push({
      family: 'implementation_usage',
      claimType: 'writer_to_target',
      object: targetRef,
      subject: w.fromId,
      weight: 2,
      provenance: [
        fp,
        `stage3:pathId:${input.result.paths[0]?.pathId ?? 'writer'}`,
        `programUnit:${w.fromId}`,
        `target:${targetRef}`,
        `confidence:${w.confidenceClass}`,
        `runtimeStatic:static`,
      ],
      notes: `operation:${w.operation};package:${w.packageName ?? 'unknown'}`,
    });
  }

  for (const p of input.result.paths.slice(0, 5)) {
    const pathId = p.pathId;
    for (const gw of p.gatewayReferences.slice(0, 8)) {
      const fp = `evidenceOriginFingerprint:stage3_gateway:${gw.gatewayName}|${gw.dacPackageObjectId}`;
      claims.push({
        family: 'implementation_usage',
        claimType: 'gateway_dac',
        object: targetRef,
        subject: gw.gatewayName,
        weight: 2,
        provenance: [
          fp,
          `stage3:pathId:${pathId}`,
          `programUnit:${p.programUnitId}`,
          `dac:${gw.dacPackageObjectId}`,
          `confidence:${p.confidence}`,
          `runtimeStatic:${p.sourceStatus === 'available' ? 'static' : 'runtime_boundary'}`,
        ],
      });
    }
    for (const hop of p.callHops.slice(0, 8)) {
      const fp = `evidenceOriginFingerprint:stage3_call:${hop.fromProgramUnitId}|${hop.toProgramUnitId}`;
      claims.push({
        family: 'implementation_usage',
        claimType: 'routine_call_chain',
        object: targetRef,
        subject: hop.fromProgramUnitId,
        weight: 1,
        provenance: [
          fp,
          `stage3:pathId:${pathId}`,
          `programUnit:${hop.toProgramUnitId}`,
          `confidence:${hop.confidenceClass}`,
          `runtimeStatic:static`,
        ],
      });
    }
    for (const dml of p.dmlOperations.slice(0, 10)) {
      if (dml.targetObjectId && !relevant(dml.targetObjectId) && !relevant(targetRef)) continue;
      const fp = `evidenceOriginFingerprint:stage3_dml:${pathId}|${dml.operation}|${dml.targetObjectId}`;
      claims.push({
        family: 'implementation_usage',
        claimType: 'stage3_write_path_dml',
        object: targetRef,
        weight: 2,
        provenance: [
          fp,
          `stage3:pathId:${pathId}`,
          `programUnit:${dml.programUnitId}`,
          `target:${dml.targetObjectId}`,
          `confidence:${p.confidence}`,
          `runtimeStatic:${p.sourceStatus === 'available' ? 'static' : p.sourceStatus}`,
          dml.provenance?.sourcePath ?? 'stage3',
        ],
        notes: `Stage3 pathStatus=${input.result.pathStatus}`,
      });
      for (const m of dml.parameterMappings.slice(0, 8)) {
        claims.push({
          family: 'implementation_usage',
          claimType: 'param_to_column',
          object: targetRef,
          column: m.targetColumn,
          weight: 2,
          provenance: [
            fp,
            `stage3:pathId:${pathId}`,
            `programUnit:${dml.programUnitId}`,
            `column:${m.targetColumn}`,
            `confidence:${m.mappingConfidence ?? p.confidence}`,
            `runtimeStatic:static`,
          ],
        });
      }
    }
    for (const lookup of p.lookups.slice(0, 5)) {
      const lookupRef = lookup.targetObjectId ?? lookup.targetObjectRaw;
      if (lookupRef && !relevant(lookupRef) && !relevant(targetRef)) continue;
      const fp = `evidenceOriginFingerprint:stage3_lookup:${pathId}|${lookupRef}`;
      claims.push({
        family: 'implementation_usage',
        claimType: 'stage3_validation_lookup',
        object: lookupRef ?? targetRef,
        subject: p.programUnitId,
        roleHint: 'dictionary_identity',
        weight: 2,
        provenance: [
          fp,
          `stage3:pathId:${pathId}`,
          `programUnit:${lookup.programUnitId}`,
          `target:${lookupRef ?? targetRef}`,
          `confidence:${p.confidence}`,
          `runtimeStatic:static`,
        ],
      });
    }
  }

  const unusedReason = unusedStage3Reason({
    succeeded: true,
    writers: input.result.writerCandidates.length,
    dml: input.result.paths.reduce((n, p) => n + p.dmlOperations.length, 0),
    lookups: input.result.paths.reduce((n, p) => n + p.lookups.length, 0),
    gateways: input.result.paths.reduce((n, p) => n + p.gatewayReferences.length, 0),
    relevantFacts: claims.length,
  });
  return { claims, added: claims.length, unusedReason };
}

export async function requestStage3Evidence(input: {
  repoRoot: string;
  targets: Array<{ owner: string; objectName: string }>;
  reason: string | null;
  relevantObjectRefs?: string[];
}): Promise<Stage3PlanResult> {
  const claims: SchemaEvidenceGraph['claims'] = [];
  let writePathsSucceeded = 0;
  let writePathEvidenceItemsAdded = 0;
  const unusedReasons: string[] = [];
  const relevant = new Set(input.relevantObjectRefs ?? []);
  for (const t of input.targets) {
    relevant.add(`${t.owner}.${t.objectName}`);
    try {
      const result = await analyzeWritePath({
        targetOwner: t.owner,
        targetObjectName: t.objectName,
        targetObjectType: 'TABLE',
        sourceProvider: 'none',
        maxDepth: 4,
        maxProgramsPerAnalysis: 40,
      });
      writePathsSucceeded += 1;
      const converted = convertStage3ResultToClaims({
        result,
        targetOwner: t.owner,
        targetObjectName: t.objectName,
        relevantObjectRefs: relevant,
      });
      claims.push(...converted.claims);
      writePathEvidenceItemsAdded += converted.added;
      if (converted.unusedReason) unusedReasons.push(converted.unusedReason);
    } catch {
      unusedReasons.push('stage3_analysis_failed');
    }
  }
  const used = writePathEvidenceItemsAdded > 0;
  return {
    writePathsRequested: input.targets.length,
    writePathsSucceeded,
    writePathEvidenceItemsAdded,
    writePathRequestReason: input.reason,
    writePathResultUsed: used,
    writePathResultUnusedReason: used ? null : unusedReasons[0] ?? 'no_relevant_stage3_facts',
    claims,
  };
}

export function buildSchemaEvidenceGraphFromPipeline(input: {
  anchors: ApplicationAnchorResolveResult;
  ace: AceTraversalResult;
  oracle: OracleExpandResult;
  stage3Claims?: SchemaEvidenceGraph['claims'];
  approvedReuseGraph?: SchemaEvidenceGraph | null;
  subjectRole?: string;
}): SchemaEvidenceGraph {
  return bindEvidenceToRoleGraph(input).graph;
}

export function bindPipelineEvidence(input: {
  anchors: ApplicationAnchorResolveResult;
  ace: AceTraversalResult;
  oracle: OracleExpandResult;
  stage3Claims?: SchemaEvidenceGraph['claims'];
  approvedReuseGraph?: SchemaEvidenceGraph | null;
  subjectRole?: string;
  approvedExclusive?: boolean;
}): {
  graph: SchemaEvidenceGraph;
  bindMetrics: BindAdapterMetrics;
  discoveredSubject: DiscoveredSubject | null;
} {
  const bound = bindEvidenceToRoleGraph(input);
  return {
    graph: bound.graph,
    bindMetrics: bound.metrics,
    discoveredSubject: bound.discoveredSubject,
  };
}

export function loadApprovedBindingEvidenceIfRequested(input: {
  repoRoot: string;
  mode: Stage4ResolutionRequest['mode'];
  conceptTokens: string[];
  requestedRoles?: import('../teta-schema-role-resolution/teta-schema-role-resolution.types').LogicalRoleId[];
}): import('./teta-stage4-approved-bindings').ApprovedBindingReuseResult {
  if (input.mode !== 'approved_binding_reuse') {
    return {
      graph: null,
      loaded: false,
      subjectMatched: null,
      reuseStatus: 'not_found',
      approvedBindingsConsidered: 0,
      approvedBindingsReused: 0,
      approvedBindingsStale: 0,
      approvedBindingsConflicting: 0,
      resolutionStatus: 'insufficient',
    };
  }
  return loadApprovedBindingsEvidence({
    repoRoot: input.repoRoot,
    conceptTokens: input.conceptTokens,
    requestedRoles: input.requestedRoles,
  });
}

export function invokeStage0(input: {
  request: Stage4ResolutionRequest;
  evidenceGraph: SchemaEvidenceGraph;
  anchors: ApplicationAnchorResolveResult;
  discoveredSubject?: DiscoveredSubject | null;
  bindingHypothesisContext?: import('../teta-schema-role-resolution/teta-schema-role-resolution.types').SchemaRoleResolverInput['bindingHypothesisContext'];
  approvedExclusiveGraph?: boolean;
}): SchemaRoleResolutionResult {
  const question =
    input.request.question ??
    `Resolve bindings for business concept: ${input.request.businessConcept}`;
  return resolveSchemaRoles({
    question,
    subjectRole: input.request.subjectRole ?? 'entity',
    targetConcept: input.request.businessConcept,
    requiredRoles: input.request.requestedRoles,
    discoveryMode: input.request.mode,
    applicationAnchors: input.anchors.anchors.map((a) => ({
      formRef: a.formRef ?? undefined,
      controlName: a.controlName ?? undefined,
      datasetName: a.datasetName ?? undefined,
      label: a.label,
      evidenceRefs: a.semanticEvidence,
    })),
    confirmedSubjectSource: input.discoveredSubject
      ? {
          owner: input.discoveredSubject.owner,
          objectType: input.discoveredSubject.objectType,
          objectName: input.discoveredSubject.objectName,
          identityColumn: input.discoveredSubject.identityColumn,
        }
      : undefined,
    temporalIntent: input.request.temporalIntent ?? 'none',
    evidenceGraph: input.evidenceGraph,
    bindingHypothesisContext: input.bindingHypothesisContext,
    approvedExclusiveGraph: input.approvedExclusiveGraph,
  });
}

export function collectNegativeEvidence(input: {
  oracle: OracleExpandResult;
  ace: AceTraversalResult;
}): Array<{ source: string; provenance: string[]; polarity: 'negative' }> {
  const out: Array<{ source: string; provenance: string[]; polarity: 'negative' }> = [];
  for (const c of input.oracle.candidates) {
    for (const n of c.negativeEvidence) {
      out.push({
        source: c.oracleCanonicalId,
        provenance: [n],
        polarity: 'negative',
      });
    }
  }
  if (input.ace.oracleEndpoints.length === 0 && input.ace.aceNodesVisited > 0) {
    out.push({
      source: 'ace_traversal',
      provenance: ['application_nodes_without_oracle_endpoint'],
      polarity: 'negative',
    });
  }
  // Product-scope mismatch heuristic: Production vs Personel Positions
  const personel = input.oracle.candidates.filter((c) =>
    c.acePath.some((p) => /personel/i.test(p)),
  );
  const production = input.oracle.candidates.filter((c) =>
    c.acePath.some((p) => /production/i.test(p)),
  );
  if (personel.length && production.length) {
    for (const c of production) {
      out.push({
        source: c.oracleCanonicalId,
        provenance: ['scope_product_mismatch:production_vs_personel'],
        polarity: 'negative',
      });
      c.negativeEvidence.push('scope_product_mismatch:production_vs_personel');
    }
  }
  return out;
}

export function pickStrongestCandidates(cands: OracleCandidate[], limit = 12): OracleCandidate[] {
  return [...cands]
    .sort((a, b) => {
      const score = (c: OracleCandidate) =>
        (c.acePath.some((p) => /personel/i.test(p)) ? 20 : 0) +
        (c.aceEdgeKind === 'GATEWAY_READS_FROM_ORACLE_OBJECT' &&
        c.candidateRoleHypotheses.includes('assignment_source')
          ? 8
          : 0) +
        (c.aceEdgeKinds?.includes('APPLICATION_JOIN') &&
        c.candidateRoleHypotheses.includes('assignment_source')
          ? 6
          : 0) +
        (c.candidateRoleHypotheses.includes('dictionary_identity') ? 4 : 0) +
        Math.min(c.supportingEvidence.length, 8) -
        c.negativeEvidence.length * 5 -
        (c.acePath.some((p) => /production|produkcj|warehouse|gma|logist/i.test(p)) ? 20 : 0);
      return score(b) - score(a);
    })
    .slice(0, limit);
}

/** Keep ACE APPLICATION_JOIN assignment seeds that ranking might truncate. */
export function pickCandidatesPreservingJoinSeeds(
  cands: OracleCandidate[],
  joinSeeds: OracleCandidate[],
  limit = 12,
): OracleCandidate[] {
  const picked = pickStrongestCandidates(cands, limit);
  const have = new Set(picked.map((c) => `${c.owner}.${c.objectName}`));
  for (const s of joinSeeds) {
    if (!s.candidateRoleHypotheses.includes('assignment_source')) continue;
    const k = `${s.owner}.${s.objectName}`;
    if (have.has(k)) continue;
    picked.push(s);
    have.add(k);
  }
  return picked;
}
