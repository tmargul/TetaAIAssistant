/**
 * Stage 2E mutable graph builder with dedupe + integrity helpers.
 */
import { Stage2eIds, mapCanonicalConfidence } from './teta-stage2e.ids';
import type {
  Stage2eConflict,
  Stage2eEdge,
  Stage2eEdgeType,
  Stage2eEvidence,
  Stage2eNode,
  Stage2eNodeType,
  Stage2eProvenance,
} from './teta-stage2e.types';
import { STAGE2E_IDENTITY_VERSION } from './teta-stage2e.types';

export class Stage2eGraphBuilder {
  readonly nodes = new Map<string, Stage2eNode>();
  readonly edges = new Map<string, Stage2eEdge>();
  readonly conflicts: Stage2eConflict[] = [];
  readonly coverage = {
    stage1: 0,
    stage2a: 0,
    stage2b: 0,
    stage2c: 0,
    stage2d: 0,
  };

  addConflict(c: Stage2eConflict): void {
    this.conflicts.push(c);
  }

  upsertNode(input: {
    id: string;
    type: Stage2eNodeType | string;
    name: string;
    canonicalName?: string;
    sourceStage: string | string[];
    confidence?: string | null;
    sourceConfidence?: string | null;
    evidence?: Stage2eEvidence[];
    provenance?: Stage2eProvenance;
    attributes?: Record<string, unknown>;
  }): Stage2eNode {
    const stages = Array.isArray(input.sourceStage)
      ? input.sourceStage
      : [input.sourceStage];
    const existing = this.nodes.get(input.id);
    if (existing) {
      for (const s of stages) {
        if (!existing.sourceStage.includes(s)) existing.sourceStage.push(s);
      }
      if (input.evidence?.length) {
        existing.evidence.push(...input.evidence);
      }
      if (input.provenance) {
        existing.provenance = existing.provenance ?? [];
        existing.provenance.push(input.provenance);
      }
      if (input.attributes) {
        existing.attributes = { ...existing.attributes, ...input.attributes };
      }
      // Allow promoting ui_control → action_control when permission/action facts arrive
      if (input.type === 'action_control' && existing.type === 'ui_control') {
        existing.type = 'action_control';
      }
      // Prefer stronger confidence; never silently overwrite confirmed with weaker
      const next = mapCanonicalConfidence(input.confidence ?? input.sourceConfidence);
      if (existing.confidence === 'unresolved' && next !== 'unresolved') {
        existing.confidence = next;
      } else if (next === 'conflicting') {
        existing.confidence = 'conflicting';
      }
      return existing;
    }

    const node: Stage2eNode = {
      id: input.id,
      type: input.type,
      name: input.name,
      canonicalName: input.canonicalName ?? input.name,
      sourceStage: [...stages],
      confidence: mapCanonicalConfidence(input.confidence ?? input.sourceConfidence),
      sourceConfidence: input.sourceConfidence ?? input.confidence ?? null,
      evidence: [...(input.evidence ?? [])],
      provenance: input.provenance ? [input.provenance] : [],
      attributes: { ...(input.attributes ?? {}) },
      identityVersion: STAGE2E_IDENTITY_VERSION,
    };
    this.nodes.set(node.id, node);
    return node;
  }

  addEdge(input: {
    type: Stage2eEdgeType | string;
    from: string;
    to: string;
    sourceStage: string | string[];
    confidence?: string | null;
    sourceConfidence?: string | null;
    evidence?: Stage2eEvidence[];
    provenance?: Stage2eProvenance;
    attributes?: Record<string, unknown>;
    extraKey?: string;
  }): Stage2eEdge | null {
    if (!input.from || !input.to) return null;
    const stages = Array.isArray(input.sourceStage)
      ? input.sourceStage
      : [input.sourceStage];
    const id = Stage2eIds.edge(input.type, input.from, input.to, input.extraKey);
    const existing = this.edges.get(id);
    if (existing) {
      for (const s of stages) {
        if (!existing.sourceStage.includes(s)) existing.sourceStage.push(s);
      }
      if (input.evidence?.length) existing.evidence.push(...input.evidence);
      if (input.provenance) {
        existing.provenance = existing.provenance ?? [];
        existing.provenance.push(input.provenance);
      }
      if (input.attributes) {
        existing.attributes = { ...existing.attributes, ...input.attributes };
      }
      return existing;
    }
    const edge: Stage2eEdge = {
      id,
      type: input.type,
      from: input.from,
      to: input.to,
      confidence: mapCanonicalConfidence(input.confidence ?? input.sourceConfidence),
      sourceConfidence: input.sourceConfidence ?? input.confidence ?? null,
      sourceStage: [...stages],
      evidence: [...(input.evidence ?? [])],
      provenance: input.provenance ? [input.provenance] : [],
      attributes: { ...(input.attributes ?? {}) },
      identityVersion: STAGE2E_IDENTITY_VERSION,
    };
    this.edges.set(id, edge);
    return edge;
  }

  ensureOracleObjectStub(opts: {
    objectName: string;
    objectType?: string | null;
    owner?: string | null;
    sourceStage: string;
    sourceConfidence?: string | null;
    validationStatus?: string;
    evidence?: Stage2eEvidence[];
  }): string {
    const owner = opts.owner || 'UNKNOWN';
    const objectType = (opts.objectType || 'UNKNOWN').toUpperCase();
    const name = opts.objectName.toUpperCase();
    const id = Stage2eIds.oracleObject(owner, objectType, name);
    this.upsertNode({
      id,
      type: objectType === 'PACKAGE' ? 'oracle_package' : 'oracle_object',
      name,
      canonicalName: `${owner}.${name}`,
      sourceStage: opts.sourceStage,
      sourceConfidence: opts.sourceConfidence ?? 'confirmed_from_il',
      evidence: opts.evidence,
      attributes: {
        owner,
        objectType,
        objectName: name,
        oracleValidationStatus: opts.validationStatus ?? 'not_checked',
      },
    });
    return id;
  }

  validateIntegrity(): {
    brokenEdges: string[];
    duplicateCanonicalIds: string[];
    orphanNodes: string[];
  } {
    const brokenEdges: string[] = [];
    const referenced = new Set<string>();
    for (const e of this.edges.values()) {
      if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) {
        brokenEdges.push(e.id);
      } else {
        referenced.add(e.from);
        referenced.add(e.to);
      }
    }
    // duplicate IDs can't happen with Map — report empty (or attribute collisions)
    const duplicateCanonicalIds: string[] = [];
    const orphanNodes: string[] = [];
    for (const n of this.nodes.values()) {
      if (!referenced.has(n.id) && n.type !== 'plugin_registry_entry') {
        // mild orphans ok for some stubs; track count in audit
        orphanNodes.push(n.id);
      }
    }
    return { brokenEdges, duplicateCanonicalIds, orphanNodes };
  }

  countByType<T extends { type: string }>(items: Iterable<T>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const i of items) {
      out[i.type] = (out[i.type] ?? 0) + 1;
    }
    return out;
  }

  snapshot() {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      conflicts: [...this.conflicts],
      coverage: { ...this.coverage },
      integrity: this.validateIntegrity(),
      nodesByType: this.countByType(this.nodes.values()),
      edgesByType: this.countByType(this.edges.values()),
    };
  }
}
