/**
 * Stage 3C — source role resolution with explicit owner policy (no implicit scoring).
 */
import type { QuerySafetyPolicy } from './teta-query-safety-policy';
import type { SourceRoleResolution } from './teta-report-template.types';
import type { QuerySource, QueryUnresolvedSelection } from './teta-query-plan.types';
import {
  collectOracleObjectCandidates,
  nodesReachableFromForms,
  objectNameOf,
  objectTypeOf,
  ownerOf,
  type Stage3cGraphClient,
} from './teta-query-graph-client';
import type { GraphNodeView } from '../teta-plugins/teta-stage3a.types';
import type { TetaEvidencePlan } from '../teta-planner/teta-stage3b.types';
import type { SemanticSourceBinding } from '../teta-business-semantics/teta-business-semantics.types';
import { sourceFromSemanticBinding } from '../teta-business-semantics/teta-stage3c-semantic-adapter';

export type SourceResolveResult = {
  sources: QuerySource[];
  unresolvedSelections: QueryUnresolvedSelection[];
  metrics: {
    unknownOwnerAutoSelections: number;
    hrmOwnerAutoSelections: number;
    unsupportedOwnerAutoSelections: number;
    baseTableSelectionsWithoutGraphPath: number;
    equalCandidatesAutoSelected: number;
  };
};

type RankedCandidate = {
  node: GraphNodeView;
  tier: number;
  reason: string;
  pathNodeIds: string[];
  provenanceEdgeIds: string[];
  isAccessLayer: boolean;
  logicalNode?: GraphNodeView;
};

function tierFor(
  node: GraphNodeView,
  opts: {
    onFormPath: boolean;
    policy: QuerySafetyPolicy['ownerPolicy'];
  },
): { tier: number; reason: string; allowed: boolean } {
  const owner = ownerOf(node);
  const otype = objectTypeOf(node);

  if (opts.policy.forbiddenAutoSelectOwners.includes(owner)) {
    return { tier: 999, reason: `forbidden_owner_${owner}`, allowed: false };
  }
  if (!opts.policy.allowedAccessOwners.includes(owner) && owner !== opts.policy.preferredCanonicalOwner) {
    return { tier: 999, reason: `unsupported_owner_${owner}`, allowed: false };
  }

  // Explicit ordered tiers (no implicit scoring):
  // 1. confirmed form/gateway path → access synonym
  if (opts.onFormPath && otype === 'SYNONYM') {
    return { tier: 1, reason: 'confirmed_form_gateway_access_object', allowed: true };
  }
  // 2. confirmed application view on form/gateway path
  if (opts.onFormPath && otype === 'VIEW') {
    return { tier: 2, reason: 'confirmed_application_view', allowed: true };
  }
  // 3. confirmed TETA_ADMIN view (not necessarily on form path)
  if (otype === 'VIEW' && owner === opts.policy.preferredCanonicalOwner) {
    return { tier: 3, reason: 'confirmed_application_view_teta_admin', allowed: true };
  }
  // 4. confirmed TETA_ADMIN object
  if (owner === opts.policy.preferredCanonicalOwner) {
    return { tier: 4, reason: 'confirmed_teta_admin_object', allowed: true };
  }
  // 5. TETA_ADMIN_P access layer off-path
  if (owner === 'TETA_ADMIN_P' && (otype === 'VIEW' || otype === 'SYNONYM')) {
    return { tier: 5, reason: 'teta_admin_p_access_view_or_synonym', allowed: true };
  }
  // 6. base table only with graph path
  if (otype === 'TABLE' && opts.onFormPath) {
    return { tier: 6, reason: 'base_table_with_graph_path', allowed: true };
  }
  if (otype === 'TABLE' && !opts.onFormPath) {
    return { tier: 998, reason: 'base_table_without_graph_path', allowed: false };
  }

  return { tier: 50, reason: 'allowed_but_low_priority', allowed: true };
}

function evidencePlanOracleIds(plan: TetaEvidencePlan): string[] {
  const ids = new Set<string>();
  for (const n of plan.resolvedGraphEvidence?.nodes ?? []) {
    const id = typeof n === 'object' && n && 'id' in n ? String((n as { id: string }).id) : '';
    if (id.startsWith('oracle-object:')) ids.add(id);
  }
  for (const req of plan.evidenceRequirements ?? []) {
    const sel = req.graphResolution?.selectedNodeId;
    if (sel?.startsWith('oracle-object:')) ids.add(sel);
    for (const id of req.graphResolution?.selectedNodeIds ?? []) {
      if (id.startsWith('oracle-object:')) ids.add(id);
    }
    for (const c of req.graphResolution?.candidates ?? []) {
      const cid =
        typeof c === 'object' && c && 'nodeId' in c
          ? String((c as { nodeId: string }).nodeId)
          : '';
      if (cid.startsWith('oracle-object:')) ids.add(cid);
    }
  }
  return [...ids].sort();
}

export function resolveSources(input: {
  client: Stage3cGraphClient;
  roles: SourceRoleResolution[];
  roleOrder: string[];
  policy: QuerySafetyPolicy;
  evidencePlan: TetaEvidencePlan;
  /** Optional Stage 3D approved source bindings keyed by role. */
  semanticSources?: Map<string, SemanticSourceBinding> | null;
}): SourceResolveResult {
  const metrics = {
    unknownOwnerAutoSelections: 0,
    hrmOwnerAutoSelections: 0,
    unsupportedOwnerAutoSelections: 0,
    baseTableSelectionsWithoutGraphPath: 0,
    equalCandidatesAutoSelected: 0,
  };
  const unresolvedSelections: QueryUnresolvedSelection[] = [];
  const sources: QuerySource[] = [];

  const evidenceIds = new Set(evidencePlanOracleIds(input.evidencePlan));

  for (const roleName of input.roleOrder) {
    const approved = input.semanticSources?.get(roleName);
    if (approved && approved.status === 'approved') {
      sources.push(sourceFromSemanticBinding(approved));
      continue;
    }

    const spec = input.roles.find((r) => r.sourceRole === roleName);
    if (!spec) {
      // Supporting semantic roles may not appear in the Stage 3C template.
      if (approved && approved.status !== 'approved') {
        sources.push({
          sourceRole: roleName,
          status: 'missing',
          logicalObject: null,
          accessObject: null,
          selectionReason: `semantic_binding_${approved.status}`,
          candidateNodeIds: approved.candidateNodeIds ?? [],
          provenanceNodeIds: [],
          provenanceEdgeIds: [],
          pathNodeIds: [],
          enrichment: !!approved.enrichment,
        });
        continue;
      }
      sources.push({
        sourceRole: roleName,
        status: 'missing',
        logicalObject: null,
        accessObject: null,
        selectionReason: 'source_role_missing_from_template_resolution',
        candidateNodeIds: [],
        provenanceNodeIds: [],
        provenanceEdgeIds: [],
        pathNodeIds: [],
        enrichment: false,
      });
      continue;
    }

    const formPath = nodesReachableFromForms(input.client, spec.formNameFragments ?? []);
    const formOracle = new Set(formPath.oracleObjectIds);

    const hasSemanticTag = (n: GraphNodeView): boolean => {
      const attrTags = Array.isArray(n.attributes?.semanticTags)
        ? (n.attributes!.semanticTags as string[])
        : [];
      return (spec.semanticTags ?? []).some((t) => attrTags.includes(t));
    };

    // Prefer exact semanticTags; only then fall back to business searchTerms.
    const tagCandidates = collectOracleObjectCandidates(input.client, spec.semanticTags ?? []).filter(
      hasSemanticTag,
    );
    const nameCandidates =
      tagCandidates.length > 0
        ? tagCandidates
        : collectOracleObjectCandidates(input.client, spec.searchTerms);

    // Merge evidence-plan oracle objects that match semantic tag / search / form path
    const merged = new Map<string, GraphNodeView>();
    for (const n of nameCandidates) {
      if (tagCandidates.length === 0 || hasSemanticTag(n)) merged.set(n.id, n);
    }
    for (const id of formPath.oracleObjectIds) {
      const n = input.client.getNodeById(id);
      if (!n || n.type !== 'oracle_object') continue;
      if ((spec.semanticTags ?? []).length && !hasSemanticTag(n)) continue;
      merged.set(n.id, n);
    }
    for (const id of evidenceIds) {
      const n = input.client.getNodeById(id);
      if (!n || n.type !== 'oracle_object') continue;
      const attrTags = Array.isArray(n.attributes?.semanticTags)
        ? (n.attributes!.semanticTags as string[])
        : [];
      const semanticHit = (spec.semanticTags ?? []).some((t) => attrTags.includes(t));
      if (semanticHit || ((spec.semanticTags ?? []).length === 0 && formOracle.has(id))) {
        merged.set(n.id, n);
      }
    }

    const ranked: RankedCandidate[] = [];
    for (const node of [...merged.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const onFormPath = formOracle.has(node.id);
      const { tier, reason, allowed } = tierFor(node, {
        onFormPath,
        policy: input.policy.ownerPolicy,
      });

      if (!allowed) {
        if (ownerOf(node) === 'UNKNOWN') {
          /* counted only if auto-selected later */
        }
        if (reason === 'base_table_without_graph_path') {
          // keep as non-selectable candidate for diagnostics only
        }
        continue;
      }

      // Prefer access layer for TETA_ADMIN_P synonym/view with logical TETA_ADMIN behind synonym
      let logical = node;
      let access = node;
      let isAccessLayer = false;
      if (ownerOf(node) === 'TETA_ADMIN_P' && (objectTypeOf(node) === 'VIEW' || objectTypeOf(node) === 'SYNONYM')) {
        isAccessLayer = true;
        const traced = input.client.traceOracleObject({ nodeId: node.id });
        const resolved = traced.edges
          .filter((e) => e.type === 'RESOLVES_SYNONYM_TO' || e.type === 'DEPENDS_ON')
          .map((e) => input.client.getNodeById(e.to === node.id ? e.from : e.to))
          .filter((n): n is GraphNodeView => !!n && n.type === 'oracle_object' && ownerOf(n) === 'TETA_ADMIN');
        if (resolved.length === 1) {
          logical = resolved[0]!;
          access = node;
        } else {
          logical = node;
          access = node;
        }
      } else if (objectTypeOf(node) === 'VIEW' && ownerOf(node) === 'TETA_ADMIN') {
        // view is both access and logical when it's the confirmed application view
        logical = node;
        access = node;
      }

      ranked.push({
        node,
        tier,
        reason,
        pathNodeIds: onFormPath ? formPath.pathNodeIds : [node.id],
        provenanceEdgeIds: onFormPath ? formPath.edgeIds : [],
        isAccessLayer,
        logicalNode: logical,
      });
      // keep access on node itself via isAccessLayer; access object uses `node` when access layer
      void access;
    }

    ranked.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.node.id.localeCompare(b.node.id);
    });

    const candidateNodeIds = ranked.map((r) => r.node.id);

    if (!ranked.length) {
      sources.push({
        sourceRole: roleName,
        status: 'missing',
        logicalObject: null,
        accessObject: null,
        selectionReason: 'no_allowed_oracle_object_with_graph_evidence',
        candidateNodeIds: [],
        provenanceNodeIds: formPath.pathNodeIds,
        provenanceEdgeIds: formPath.edgeIds,
        pathNodeIds: formPath.pathNodeIds,
        enrichment: !!spec.enrichment,
      });
      continue;
    }

    const bestTier = ranked[0]!.tier;
    const equals = ranked.filter((r) => r.tier === bestTier);
    if (equals.length > 1 && input.policy.ownerPolicy.equalCandidatesRequireSelection) {
      unresolvedSelections.push({
        subject: `source:${roleName}`,
        reason: 'equal_tier_candidates_require_selection',
        candidateNodeIds: equals.map((e) => e.node.id).sort(),
        blocksPlanning: true,
      });
      sources.push({
        sourceRole: roleName,
        status: 'ambiguous',
        logicalObject: null,
        accessObject: null,
        selectionReason: 'equal_candidates_no_auto_select',
        candidateNodeIds: equals.map((e) => e.node.id).sort(),
        provenanceNodeIds: [...new Set(equals.flatMap((e) => e.pathNodeIds))].sort(),
        provenanceEdgeIds: [...new Set(equals.flatMap((e) => e.provenanceEdgeIds))].sort(),
        pathNodeIds: [...new Set(equals.flatMap((e) => e.pathNodeIds))].sort(),
        enrichment: !!spec.enrichment,
      });
      continue;
    }

    const chosen = equals[0]!;
    // Safety counters: ensure we never auto-selected forbidden owners
    const chosenOwner = ownerOf(chosen.node);
    if (chosenOwner === 'UNKNOWN') metrics.unknownOwnerAutoSelections += 1;
    if (chosenOwner === 'HRM') metrics.hrmOwnerAutoSelections += 1;
    if (!input.policy.ownerPolicy.allowedAccessOwners.includes(chosenOwner)) {
      metrics.unsupportedOwnerAutoSelections += 1;
    }
    if (objectTypeOf(chosen.node) === 'TABLE' && !formOracle.has(chosen.node.id) && chosen.tier === 6) {
      metrics.baseTableSelectionsWithoutGraphPath += 1;
    }

    const logicalNode = chosen.logicalNode ?? chosen.node;
    const accessNode = chosen.isAccessLayer ? chosen.node : chosen.node;

    sources.push({
      sourceRole: roleName,
      status: 'resolved',
      logicalObject: {
        nodeId: logicalNode.id,
        owner: ownerOf(logicalNode),
        objectType: objectTypeOf(logicalNode),
        objectName: objectNameOf(logicalNode),
        canonical: ownerOf(logicalNode) === input.policy.ownerPolicy.preferredCanonicalOwner,
      },
      accessObject: {
        nodeId: accessNode.id,
        owner: ownerOf(accessNode),
        objectType: objectTypeOf(accessNode),
        objectName: objectNameOf(accessNode),
      },
      selectionReason: chosen.reason,
      candidateNodeIds,
      provenanceNodeIds: chosen.pathNodeIds,
      provenanceEdgeIds: chosen.provenanceEdgeIds,
      pathNodeIds: chosen.pathNodeIds,
      enrichment: !!spec.enrichment,
    });
  }

  return { sources, unresolvedSelections, metrics };
}
