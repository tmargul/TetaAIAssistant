/**
 * Stage 3D — candidate discovery against Stage 3A graph (no auto-approval).
 */
import type { BusinessOntologySubject, DiscoveryResult, Stage3dGraphClient } from './teta-business-semantics.types';

function ownerOf(n: { owner?: string | null; attributes?: Record<string, unknown> }): string {
  return String(n.owner ?? n.attributes?.owner ?? 'UNKNOWN').toUpperCase();
}

export function discoverCandidates(
  resolver: Stage3dGraphClient | null,
  subject: BusinessOntologySubject,
  role: string,
): DiscoveryResult {
  const source = subject.sourceRoles.find((r) => r.role === role);
  const projection = subject.projectionRoles.find((r) => r.role === role);
  const relation = subject.relationRoles.find((r) => r.role === role);
  const valuePath = subject.valuePathRoles.find((r) => r.role === role);
  const temporal = subject.temporalRoles.find((r) => r.role === role);

  if (!resolver) {
    return {
      subject: subject.subject,
      role,
      kind: source
        ? 'source'
        : projection
          ? 'projection'
          : relation
            ? 'relation'
            : valuePath
              ? 'value_path'
              : temporal
                ? 'temporal'
                : 'form',
      status: 'unresolved',
      candidates: [],
      selectedNodeId: null,
      warnings: ['graph_resolver_missing'],
    };
  }

  if (source) {
    const byId = new Map<
      string,
      { nodeId: string; scoreRank: number; matchKind: string; owner: string | null; objectType: string | null; name: string | null }
    >();
    for (const term of source.searchTerms ?? []) {
      const r = resolver.resolveNode({ name: term, nodeType: 'oracle_object' });
      for (const c of r.candidates) {
        const n = resolver.getNodeById(c.nodeId);
        if (!n || n.type !== 'oracle_object') continue;
        const owner = ownerOf(n);
        if (owner === 'HRM' || owner === 'UNKNOWN') continue;
        if (!byId.has(c.nodeId)) {
          byId.set(c.nodeId, {
            nodeId: c.nodeId,
            scoreRank: c.scoreRank,
            matchKind: c.matchKind,
            owner: n.owner,
            objectType: n.objectType,
            name: n.name,
          });
        }
      }
    }
    for (const frag of source.formNameFragments ?? []) {
      const fr = resolver.resolveForm({ nameFragment: frag });
      for (const c of fr.candidates) {
        const n = resolver.getNodeById(c.nodeId);
        if (!n) continue;
        if (!byId.has(c.nodeId)) {
          byId.set(c.nodeId, {
            nodeId: c.nodeId,
            scoreRank: c.scoreRank,
            matchKind: `form:${c.matchKind}`,
            owner: n.owner,
            objectType: n.objectType,
            name: n.name,
          });
        }
      }
    }
    const candidates = [...byId.values()].sort((a, b) => {
      if (a.scoreRank !== b.scoreRank) return a.scoreRank - b.scoreRank;
      return a.nodeId.localeCompare(b.nodeId);
    });
    let status: DiscoveryResult['status'] = 'discovered';
    if (!candidates.length) status = 'unresolved';
    else if (candidates.length > 1) status = 'ambiguous';
    return {
      subject: subject.subject,
      role,
      kind: 'source',
      status,
      candidates,
      selectedNodeId: candidates.length === 1 ? candidates[0]!.nodeId : null,
      warnings: [],
    };
  }

  if (projection || valuePath || temporal || relation) {
    return {
      subject: subject.subject,
      role,
      kind: projection
        ? 'projection'
        : valuePath
          ? 'value_path'
          : temporal
            ? 'temporal'
            : 'relation',
      status: 'unresolved',
      candidates: [],
      selectedNodeId: null,
      warnings: [
        'non_source_roles_require_approved_registry_binding; discovery returns unresolved without auto-select',
      ],
    };
  }

  return {
    subject: subject.subject,
    role,
    kind: 'form',
    status: 'unresolved',
    candidates: [],
    selectedNodeId: null,
    warnings: ['unknown_role'],
  };
}
