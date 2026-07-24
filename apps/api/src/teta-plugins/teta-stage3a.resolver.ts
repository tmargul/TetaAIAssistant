/**
 * Stage 3A — CanonicalGraphResolverService: typed queries against SQLite index.
 */
import type Database from 'better-sqlite3';
import { normalizeGraphSearchTerm, normalizeGuid } from './teta-stage3a.normalize';
import type {
  GraphCandidate,
  GraphConflictView,
  GraphEdgeView,
  GraphNodeView,
  GraphPath,
  GraphResolverResult,
  GraphResolveStatus,
} from './teta-stage3a.types';

type NodeRow = {
  id: string;
  type: string;
  domain: string | null;
  name: string | null;
  canonical_name: string | null;
  normalized_name: string | null;
  owner: string | null;
  object_type: string | null;
  confidence: string | null;
  source_stages_json: string | null;
  attributes_json: string | null;
  evidence_json: string | null;
  semantic_normalization_json: string | null;
};

type EdgeRow = {
  id: string;
  type: string;
  from_id: string;
  to_id: string;
  confidence: string | null;
  source_stages_json: string | null;
  attributes_json: string | null;
  evidence_json: string | null;
};

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function confidenceRank(c: string | null | undefined): number {
  const v = String(c ?? '').toLowerCase();
  if (v === 'confirmed' || v === 'confirmed_from_il' || v === 'confirmed_from_stage2b') return 0;
  if (v === 'inferred' || v === 'likely') return 1;
  if (v === 'unresolved' || v === 'conflicting') return 3;
  return 2;
}

function sortCandidates(list: GraphCandidate[]): GraphCandidate[] {
  return [...list].sort((a, b) => {
    if (a.scoreRank !== b.scoreRank) return a.scoreRank - b.scoreRank;
    const ca = confidenceRank(a.confidence);
    const cb = confidenceRank(b.confidence);
    if (ca !== cb) return ca - cb;
    const da = a.domain ?? '';
    const db = b.domain ?? '';
    if (da !== db) return da.localeCompare(db);
    const ta = a.type ?? '';
    const tb = b.type ?? '';
    if (ta !== tb) return ta.localeCompare(tb);
    return a.nodeId.localeCompare(b.nodeId);
  });
}

function sortNodes(nodes: GraphNodeView[]): GraphNodeView[] {
  return [...nodes].sort((a, b) => {
    const ca = confidenceRank(a.confidence);
    const cb = confidenceRank(b.confidence);
    if (ca !== cb) return ca - cb;
    const da = a.domain ?? '';
    const db = b.domain ?? '';
    if (da !== db) return da.localeCompare(db);
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.id.localeCompare(b.id);
  });
}

function sortEdges(edges: GraphEdgeView[]): GraphEdgeView[] {
  return [...edges].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return a.id.localeCompare(b.id);
  });
}

function emptyResult(
  query: Record<string, unknown>,
  status: GraphResolveStatus = 'unresolved',
): GraphResolverResult {
  return {
    status,
    query,
    selectedNodeId: null,
    candidates: [],
    nodes: [],
    edges: [],
    paths: [],
    conflicts: [],
    warnings: [],
    provenance: [],
    audit: {},
    truncated: false,
    continuation: null,
  };
}

export class CanonicalGraphResolverService {
  constructor(private readonly db: Database.Database) {}

  private nodeView(row: NodeRow): GraphNodeView {
    return {
      id: row.id,
      type: row.type,
      domain: row.domain,
      name: row.name,
      canonicalName: row.canonical_name,
      owner: row.owner,
      objectType: row.object_type,
      confidence: row.confidence,
      sourceStages: parseJson(row.source_stages_json, []),
      attributes: parseJson(row.attributes_json, {}),
      evidence: parseJson(row.evidence_json, []),
      semanticNormalization: parseJson(row.semantic_normalization_json, null),
    };
  }

  private edgeView(row: EdgeRow): GraphEdgeView {
    return {
      id: row.id,
      type: row.type,
      from: row.from_id,
      to: row.to_id,
      confidence: row.confidence,
      sourceStages: parseJson(row.source_stages_json, []),
      attributes: parseJson(row.attributes_json, {}),
      evidence: parseJson(row.evidence_json, []),
    };
  }

  getNodeById(id: string): GraphNodeView | null {
    const row = this.db.prepare('SELECT * FROM kg_nodes WHERE id = ?').get(id) as NodeRow | undefined;
    return row ? this.nodeView(row) : null;
  }

  private getNodesByIds(ids: string[]): GraphNodeView[] {
    if (!ids.length) return [];
    const uniq = [...new Set(ids)];
    const stmt = this.db.prepare('SELECT * FROM kg_nodes WHERE id = ?');
    const out: GraphNodeView[] = [];
    for (const id of uniq) {
      const row = stmt.get(id) as NodeRow | undefined;
      if (row) out.push(this.nodeView(row));
    }
    return sortNodes(out);
  }

  private getEdgesByIds(ids: string[]): GraphEdgeView[] {
    if (!ids.length) return [];
    const uniq = [...new Set(ids)];
    const stmt = this.db.prepare('SELECT * FROM kg_edges WHERE id = ?');
    const out: GraphEdgeView[] = [];
    for (const id of uniq) {
      const row = stmt.get(id) as EdgeRow | undefined;
      if (row) out.push(this.edgeView(row));
    }
    return sortEdges(out);
  }

  private edgesFrom(id: string, type?: string): GraphEdgeView[] {
    const rows = type
      ? (this.db
          .prepare('SELECT * FROM kg_edges WHERE from_id = ? AND type = ? ORDER BY id')
          .all(id, type) as EdgeRow[])
      : (this.db
          .prepare('SELECT * FROM kg_edges WHERE from_id = ? ORDER BY type, id')
          .all(id) as EdgeRow[]);
    return rows.map((r) => this.edgeView(r));
  }

  private edgesTo(id: string, type?: string): GraphEdgeView[] {
    const rows = type
      ? (this.db
          .prepare('SELECT * FROM kg_edges WHERE to_id = ? AND type = ? ORDER BY id')
          .all(id, type) as EdgeRow[])
      : (this.db
          .prepare('SELECT * FROM kg_edges WHERE to_id = ? ORDER BY type, id')
          .all(id) as EdgeRow[]);
    return rows.map((r) => this.edgeView(r));
  }

  private conflictsForSubjects(subjectIds: string[]): GraphConflictView[] {
    if (!subjectIds.length) return [];
    const stmt = this.db.prepare(
      'SELECT * FROM kg_conflicts WHERE subject_id = ? ORDER BY conflict_id',
    );
    const out: GraphConflictView[] = [];
    for (const id of [...new Set(subjectIds)]) {
      const rows = stmt.all(id) as Array<{
        conflict_id: string;
        conflict_type: string | null;
        subject_id: string | null;
        resolution_status: string | null;
        alternatives_json: string | null;
        evidence_json: string | null;
      }>;
      for (const r of rows) {
        out.push({
          conflictId: r.conflict_id,
          conflictType: r.conflict_type ?? '',
          subjectId: r.subject_id,
          resolutionStatus: r.resolution_status,
          alternatives: parseJson(r.alternatives_json, []),
          evidence: parseJson(r.evidence_json, []),
        });
      }
    }
    return out.sort((a, b) => a.conflictId.localeCompare(b.conflictId));
  }

  private candidateFromNode(n: GraphNodeView, scoreRank: number, matchKind: string): GraphCandidate {
    return {
      nodeId: n.id,
      scoreRank,
      matchKind,
      confidence: n.confidence,
      domain: n.domain,
      type: n.type,
      canonicalName: n.canonicalName,
      name: n.name,
    };
  }

  private finalize(
    query: Record<string, unknown>,
    candidates: GraphCandidate[],
    opts?: {
      autoResolveMaxRank?: number;
      forceStatus?: GraphResolveStatus;
      extraNodes?: GraphNodeView[];
      extraEdges?: GraphEdgeView[];
      paths?: GraphPath[];
      warnings?: string[];
      truncated?: boolean;
      continuation?: Record<string, unknown> | null;
      startedAt?: number;
    },
  ): GraphResolverResult {
    const sorted = sortCandidates(candidates);
    const autoMax = opts?.autoResolveMaxRank ?? 8;
    let status: GraphResolveStatus = opts?.forceStatus ?? 'unresolved';
    let selected: string | null = null;

    if (!opts?.forceStatus) {
      if (sorted.length === 0) status = 'unresolved';
      else if (sorted.length === 1 && sorted[0]!.scoreRank <= autoMax) {
        status = 'resolved';
        selected = sorted[0]!.nodeId;
      } else if (sorted.length > 1) {
        const best = sorted[0]!.scoreRank;
        const top = sorted.filter((c) => c.scoreRank === best);
        if (top.length === 1 && best <= autoMax) {
          status = 'resolved';
          selected = top[0]!.nodeId;
        } else {
          status = 'ambiguous';
          selected = null;
        }
      }
    } else if (
      (opts.forceStatus === 'resolved' || opts.forceStatus === 'conflicting') &&
      sorted.length === 1
    ) {
      selected = sorted[0]!.nodeId;
    } else if (
      (opts.forceStatus === 'resolved' || opts.forceStatus === 'conflicting') &&
      sorted.length > 1
    ) {
      const best = sorted[0]!.scoreRank;
      const top = sorted.filter((c) => c.scoreRank === best);
      if (top.length === 1) selected = top[0]!.nodeId;
    }

    const nodeIds = [
      ...sorted.map((c) => c.nodeId),
      ...(opts?.extraNodes ?? []).map((n) => n.id),
      ...(selected ? [selected] : []),
    ];
    const nodes = sortNodes([
      ...this.getNodesByIds(nodeIds),
      ...(opts?.extraNodes ?? []).filter((n) => !nodeIds.includes(n.id)),
    ]);
    // dedupe nodes
    const seenN = new Set<string>();
    const dedupNodes = nodes.filter((n) => {
      if (seenN.has(n.id)) return false;
      seenN.add(n.id);
      return true;
    });

    const edges = sortEdges(opts?.extraEdges ?? []);
    const conflicts = this.conflictsForSubjects([
      ...dedupNodes.map((n) => n.id),
      ...edges.map((e) => e.id),
    ]);
    const warnings = [...(opts?.warnings ?? [])];
    if (
      !opts?.forceStatus &&
      conflicts.some((c) => c.resolutionStatus === 'unresolved') &&
      status === 'resolved'
    ) {
      status = 'conflicting';
      warnings.push('unresolved_conflicts_affect_result');
    }

    const provenance = dedupNodes.flatMap((n) =>
      (n.evidence ?? []).map((e) => ({ nodeId: n.id, evidence: e })),
    );

    return {
      status,
      query,
      selectedNodeId: selected,
      candidates: sorted,
      nodes: dedupNodes,
      edges,
      paths: opts?.paths ?? [],
      conflicts,
      warnings,
      provenance,
      audit: {
        candidateCount: sorted.length,
        durationMs: opts?.startedAt != null ? Date.now() - opts.startedAt : undefined,
      },
      truncated: opts?.truncated ?? false,
      continuation: opts?.continuation ?? null,
    };
  }

  resolveNode(input: {
    id?: string;
    name?: string;
    domain?: string;
    nodeType?: string;
    owner?: string;
    objectType?: string;
  }): GraphResolverResult {
    const startedAt = Date.now();
    const query = { op: 'resolveNode', ...input };
    const candidates: GraphCandidate[] = [];

    if (input.id) {
      const n = this.getNodeById(input.id);
      if (n) {
        return this.finalize(query, [this.candidateFromNode(n, 1, 'exact_canonical_id')], {
          startedAt,
          extraNodes: [n],
        });
      }
      return emptyResult(query, 'unresolved');
    }

    if (input.owner && input.objectType && input.name) {
      const { normalizedAscii } = normalizeGraphSearchTerm(input.name);
      // Exact match (indexed). Oracle identifiers in graph are stored uppercase.
      const rows = this.db
        .prepare(
          `SELECT * FROM kg_nodes
           WHERE owner = ?
             AND object_type = ?
             AND (canonical_name = ? OR name = ? OR normalized_name = ?)
           ORDER BY id
           LIMIT 20`,
        )
        .all(
          input.owner,
          input.objectType,
          input.name,
          input.name,
          normalizedAscii,
        ) as NodeRow[];
      // Fallback: case-insensitive only if exact miss (rare)
      const rows2 =
        rows.length > 0
          ? rows
          : (this.db
              .prepare(
                `SELECT * FROM kg_nodes
                 WHERE owner = ? COLLATE NOCASE
                   AND object_type = ? COLLATE NOCASE
                   AND (canonical_name = ? COLLATE NOCASE OR name = ? COLLATE NOCASE)
                 ORDER BY id LIMIT 20`,
              )
              .all(input.owner, input.objectType, input.name, input.name) as NodeRow[]);
      for (const r of rows2) {
        candidates.push(this.candidateFromNode(this.nodeView(r), 3, 'exact_oracle_identity'));
      }
      return this.finalize(query, candidates, { startedAt });
    }

    if (input.name) {
      const { normalizedAscii } = normalizeGraphSearchTerm(input.name);
      const seen = new Set<string>();
      const addRows = (rows: NodeRow[], rank: number, kind: string) => {
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          if (input.nodeType && r.type !== input.nodeType) continue;
          if (input.domain && r.domain !== input.domain) continue;
          seen.add(r.id);
          candidates.push(this.candidateFromNode(this.nodeView(r), rank, kind));
        }
      };

      // Exact node fields (indexed)
      addRows(
        this.db
          .prepare(
            `SELECT * FROM kg_nodes WHERE id = ? OR canonical_name = ? OR name = ? LIMIT 50`,
          )
          .all(input.name, input.name, input.name) as NodeRow[],
        input.nodeType || input.domain ? 4 : 9,
        'exact_name',
      );
      addRows(
        this.db
          .prepare(`SELECT * FROM kg_nodes WHERE normalized_name = ? LIMIT 50`)
          .all(normalizedAscii) as NodeRow[],
        9,
        'normalized_name',
      );
      // Names table (indexed on normalized_value)
      const nameRows = this.db
        .prepare(
          `SELECT n.* FROM kg_names kn
           JOIN kg_nodes n ON n.id = kn.node_id
           WHERE kn.normalized_value = ?
           LIMIT 50`,
        )
        .all(normalizedAscii) as NodeRow[];
      addRows(nameRows, 10, 'name_index');
    }

    return this.finalize(query, candidates, { startedAt, autoResolveMaxRank: 8 });
  }

  resolveForm(input: { guid?: string; fullTypeName?: string; nameFragment?: string }): GraphResolverResult {
    const startedAt = Date.now();
    const query = { op: 'resolveForm', ...input };
    const candidates: GraphCandidate[] = [];

    if (input.guid && input.fullTypeName) {
      const g = normalizeGuid(input.guid);
      const idGuess = `form:${g}:${input.fullTypeName}`;
      const direct = this.getNodeById(idGuess);
      if (direct) {
        return this.finalize(query, [this.candidateFromNode(direct, 2, 'exact_guid_fullType')], {
          startedAt,
          extraNodes: [direct],
        });
      }
      const rows = this.db
        .prepare(
          `SELECT n.* FROM kg_nodes n
           JOIN kg_names kn ON kn.node_id = n.id AND kn.name_kind='guid'
           WHERE n.type='application_form' AND kn.normalized_value=?
             AND (n.canonical_name=? OR n.name=? OR n.canonical_name LIKE ?)
           ORDER BY n.id`,
        )
        .all(g, input.fullTypeName, input.fullTypeName, `%${input.fullTypeName}`) as NodeRow[];
      for (const r of rows) {
        candidates.push(this.candidateFromNode(this.nodeView(r), 2, 'exact_guid_fullType'));
      }
      return this.finalize(query, candidates, { startedAt });
    }

    if (input.guid) {
      const g = normalizeGuid(input.guid);
      const rows = this.db
        .prepare(
          `SELECT n.* FROM kg_nodes n
           JOIN kg_names kn ON kn.node_id = n.id AND kn.name_kind='guid'
           WHERE n.type='application_form' AND kn.normalized_value=?
           ORDER BY n.id`,
        )
        .all(g) as NodeRow[];
      for (const r of rows) {
        candidates.push(this.candidateFromNode(this.nodeView(r), 2, 'exact_guid'));
      }
      return this.finalize(query, candidates, { startedAt });
    }

    if (input.fullTypeName) {
      const rows = this.db
        .prepare(
          `SELECT * FROM kg_nodes WHERE type='application_form'
           AND (canonical_name=? OR canonical_name LIKE ?)
           ORDER BY id LIMIT 20`,
        )
        .all(input.fullTypeName, `%${input.fullTypeName}`) as NodeRow[];
      for (const r of rows) {
        const exact = r.canonical_name === input.fullTypeName;
        candidates.push(
          this.candidateFromNode(this.nodeView(r), exact ? 4 : 9, exact ? 'exact_form_type' : 'form_type_suffix'),
        );
      }
      return this.finalize(query, candidates, { startedAt });
    }

    if (input.nameFragment) {
      const { normalizedAscii } = normalizeGraphSearchTerm(input.nameFragment);
      const rows = this.db
        .prepare(
          `SELECT * FROM kg_nodes WHERE type='application_form'
           AND (normalized_name=? OR normalized_name LIKE ? OR name LIKE ? OR canonical_name LIKE ?)
           ORDER BY id LIMIT 30`,
        )
        .all(
          normalizedAscii,
          `%${normalizedAscii}%`,
          `%${input.nameFragment}%`,
          `%${input.nameFragment}%`,
        ) as NodeRow[];
      for (const r of rows) {
        candidates.push(this.candidateFromNode(this.nodeView(r), 9, 'form_name_fragment'));
      }
    }

    return this.finalize(query, candidates, { startedAt });
  }

  resolveField(input: {
    formNodeId?: string;
    formGuid?: string;
    formTypeName?: string;
    label?: string;
    controlName?: string;
  }): GraphResolverResult {
    const startedAt = Date.now();
    const query = { op: 'resolveField', ...input };
    let formId = input.formNodeId ?? null;
    if (!formId && (input.formGuid || input.formTypeName)) {
      const fr = this.resolveForm({
        guid: input.formGuid,
        fullTypeName: input.formTypeName,
      });
      if (fr.status === 'resolved' && fr.selectedNodeId) formId = fr.selectedNodeId;
      else if (fr.candidates.length === 1) formId = fr.candidates[0]!.nodeId;
      else if (!formId) {
        return this.finalize(query, fr.candidates, {
          startedAt,
          forceStatus: fr.status === 'ambiguous' ? 'ambiguous' : 'unresolved',
          warnings: ['form_not_uniquely_resolved'],
        });
      }
    }

    if (!formId) {
      // label without form → ambiguous if many
      if (input.label) {
        const { normalizedAscii } = normalizeGraphSearchTerm(input.label);
        const rows = this.db
          .prepare(
            `SELECT n.* FROM kg_nodes n
             JOIN kg_names kn ON kn.node_id=n.id
             WHERE n.type IN ('help_field','ui_control','action_control')
               AND kn.normalized_value=?
             ORDER BY n.id LIMIT 40`,
          )
          .all(normalizedAscii) as NodeRow[];
        const candidates = rows.map((r) =>
          this.candidateFromNode(this.nodeView(r), 10, 'label_without_form'),
        );
        return this.finalize(query, candidates, {
          startedAt,
          autoResolveMaxRank: 0, // never auto-resolve level 10 alone
          forceStatus: candidates.length === 0 ? 'unresolved' : 'ambiguous',
        });
      }
      return emptyResult(query, 'invalid');
    }

    const candidates: GraphCandidate[] = [];
    const extraNodes: GraphNodeView[] = [];
    const extraEdges: GraphEdgeView[] = [];
    const form = this.getNodeById(formId);
    if (form) extraNodes.push(form);

    const controlEdges = this.edgesFrom(formId, 'HAS_CONTROL');
    const controls = controlEdges
      .map((e) => this.getNodeById(e.to))
      .filter((n): n is GraphNodeView => !!n);

    if (input.controlName) {
      const hit = controls.filter((c) => c.name === input.controlName);
      for (const c of hit) {
        candidates.push(this.candidateFromNode(c, 6, 'exact_control_in_form'));
        extraNodes.push(c);
      }
    }

    if (input.label) {
      const { normalizedAscii } = normalizeGraphSearchTerm(input.label);
      const helpRows = this.db
        .prepare(
          `SELECT n.* FROM kg_nodes n
           JOIN kg_names kn ON kn.node_id=n.id
           WHERE n.type='help_field' AND kn.normalized_value=?
           ORDER BY n.id`,
        )
        .all(normalizedAscii) as NodeRow[];
      for (const r of helpRows) {
        const hf = this.nodeView(r);
        const describes = this.edgesFrom(hf.id, 'DESCRIBES');
        const linked = describes.some((e) => controls.some((c) => c.id === e.to));
        if (linked || describes.length === 0) {
          // prefer help fields that describe a control on this form
          const onForm = describes.some((e) => controls.some((c) => c.id === e.to));
          if (onForm || !input.controlName) {
            if (onForm || describes.some((e) => e.to.startsWith('control:') || e.to.startsWith('action:'))) {
              const ok = describes.some((e) => controls.some((c) => c.id === e.to));
              if (ok) {
                candidates.push(this.candidateFromNode(hf, 5, 'exact_label_in_form'));
                extraNodes.push(hf);
                extraEdges.push(...describes.filter((e) => controls.some((c) => c.id === e.to)));
              }
            }
          }
        }
      }
      // also match control by tokenized name if no help
      if (!candidates.length) {
        const { normalizedAscii: ascii } = normalizeGraphSearchTerm(input.label);
        for (const c of controls) {
          const cn = normalizeGraphSearchTerm(c.name ?? '').normalizedAscii;
          if (cn.includes(ascii.replace(/\s+/g, '')) || ascii.split(' ').every((t) => cn.includes(t))) {
            candidates.push(this.candidateFromNode(c, 9, 'control_name_tokens'));
            extraNodes.push(c);
          }
        }
      }
    }

    // Expand bindings for selected control(s)
    const selectedControls = candidates
      .map((c) => this.getNodeById(c.nodeId))
      .filter((n): n is GraphNodeView => !!n && (n.type === 'ui_control' || n.type === 'action_control' || n.type === 'help_field'));

    let controlNodes = selectedControls.filter((n) => n.type === 'ui_control' || n.type === 'action_control');
    for (const hf of selectedControls.filter((n) => n.type === 'help_field')) {
      for (const e of this.edgesFrom(hf.id, 'DESCRIBES')) {
        const c = this.getNodeById(e.to);
        if (c) {
          controlNodes.push(c);
          extraNodes.push(c);
          extraEdges.push(e);
        }
      }
    }
    controlNodes = [...new Map(controlNodes.map((c) => [c.id, c])).values()];

    for (const c of controlNodes) {
      for (const e of this.edgesFrom(c.id, 'BINDS_TARGET')) {
        extraEdges.push(e);
        const tb = this.getNodeById(e.to);
        if (tb) extraNodes.push(tb);
      }
      for (const e of this.edgesFrom(c.id, 'BINDS_LOOKUP')) {
        extraEdges.push(e);
        const lb = this.getNodeById(e.to);
        if (lb) extraNodes.push(lb);
      }
    }

    return this.finalize(query, candidates, {
      startedAt,
      extraNodes,
      extraEdges: sortEdges(extraEdges),
    });
  }

  traceFieldToOracle(input: {
    formGuid?: string;
    formTypeName?: string;
    formNodeId?: string;
    field?: string;
    controlName?: string;
  }): GraphResolverResult {
    const startedAt = Date.now();
    const fieldRes = this.resolveField({
      formGuid: input.formGuid,
      formTypeName: input.formTypeName,
      formNodeId: input.formNodeId,
      label: input.field,
      controlName: input.controlName,
    });
    const paths: GraphPath[] = [];
    const extraNodes = [...fieldRes.nodes];
    const extraEdges = [...fieldRes.edges];
    const warnings = [...fieldRes.warnings];

    const controls = fieldRes.nodes.filter(
      (n) => n.type === 'ui_control' || n.type === 'action_control',
    );
    for (const control of controls) {
      // action path
      if (control.type === 'action_control' || control.attributes.parameterName) {
        paths.push({
          kind: 'action',
          nodeIds: [control.id],
          edgeIds: [],
          hops: [],
          warnings: control.attributes.noOracleColumn
            ? ['no_oracle_column_by_design']
            : [],
        });
        continue;
      }

      for (const te of this.edgesFrom(control.id, 'BINDS_TARGET')) {
        const tb = this.getNodeById(te.to);
        if (!tb) continue;
        extraNodes.push(tb);
        extraEdges.push(te);
        const pathNodes = [control.id, tb.id];
        const pathEdges = [te.id];
        const hops: GraphPath['hops'] = [
          {
            edgeId: te.id,
            edgeType: te.type,
            fromId: te.from,
            toId: te.to,
            confidence: te.confidence,
            sourceStages: te.sourceStages,
          },
        ];
        for (const me of this.edgesFrom(tb.id, 'MAPS_TO_DATASET_COLUMN')) {
          const dc = this.getNodeById(me.to);
          if (!dc) continue;
          extraNodes.push(dc);
          extraEdges.push(me);
          pathNodes.push(dc.id);
          pathEdges.push(me.id);
          hops.push({
            edgeId: me.id,
            edgeType: me.type,
            fromId: me.from,
            toId: me.to,
            confidence: me.confidence,
            sourceStages: me.sourceStages,
          });
          for (const re of this.edgesFrom(dc.id, 'RESOLVES_TO_ORACLE_COLUMN')) {
            const oc = this.getNodeById(re.to);
            if (!oc) continue;
            extraNodes.push(oc);
            extraEdges.push(re);
            pathNodes.push(oc.id);
            pathEdges.push(re.id);
            hops.push({
              edgeId: re.id,
              edgeType: re.type,
              fromId: re.from,
              toId: re.to,
              confidence: re.confidence,
              sourceStages: re.sourceStages,
            });
          }
        }
        paths.push({ kind: 'target', nodeIds: pathNodes, edgeIds: pathEdges, hops, warnings: [] });
      }

      for (const le of this.edgesFrom(control.id, 'BINDS_LOOKUP')) {
        const lb = this.getNodeById(le.to);
        if (!lb) continue;
        extraNodes.push(lb);
        extraEdges.push(le);
        const maps = this.edgesFrom(lb.id, 'MAPS_TO_DATASET_COLUMN');
        const displays = this.edgesFrom(lb.id, 'DISPLAYS_FROM');
        for (const me of maps) {
          const dc = this.getNodeById(me.to);
          if (!dc) continue;
          extraNodes.push(dc);
          extraEdges.push(me);
          const role = String(me.attributes.role ?? '');
          const col = String(dc.attributes.columnName ?? dc.name ?? '');
          const kind =
            role === 'display' || /NAZWA/i.test(col)
              ? 'lookup_display'
              : 'lookup_value';
          const pathNodes = [control.id, lb.id, dc.id];
          const pathEdges = [le.id, me.id];
          const hops: GraphPath['hops'] = [
            {
              edgeId: le.id,
              edgeType: le.type,
              fromId: le.from,
              toId: le.to,
              confidence: le.confidence,
              sourceStages: le.sourceStages,
            },
            {
              edgeId: me.id,
              edgeType: me.type,
              fromId: me.from,
              toId: me.to,
              confidence: me.confidence,
              sourceStages: me.sourceStages,
            },
          ];
          for (const re of this.edgesFrom(dc.id, 'RESOLVES_TO_ORACLE_COLUMN')) {
            const oc = this.getNodeById(re.to);
            if (!oc) continue;
            extraNodes.push(oc);
            extraEdges.push(re);
            pathNodes.push(oc.id);
            pathEdges.push(re.id);
            hops.push({
              edgeId: re.id,
              edgeType: re.type,
              fromId: re.from,
              toId: re.to,
              confidence: re.confidence,
              sourceStages: re.sourceStages,
            });
          }
          // also attach DISPLAYS_FROM when display path
          if (kind === 'lookup_display') {
            for (const de of displays.filter((d) => d.to === dc.id)) {
              extraEdges.push(de);
              pathEdges.push(de.id);
            }
          }
          paths.push({ kind, nodeIds: pathNodes, edgeIds: pathEdges, hops, warnings: [] });
        }
      }
    }

    const status: GraphResolveStatus =
      paths.some((p) => p.kind === 'target' || p.kind.startsWith('lookup'))
        ? fieldRes.conflicts.length
          ? 'conflicting'
          : 'resolved'
        : fieldRes.status;

    return this.finalize(
      { op: 'traceFieldToOracle', ...input },
      fieldRes.candidates,
      {
        startedAt,
        forceStatus: status === 'resolved' || status === 'conflicting' ? status : fieldRes.status,
        extraNodes,
        extraEdges: sortEdges(extraEdges),
        paths,
        warnings,
      },
    );
  }

  traceDataset(input: { dataset?: string; datasetNodeId?: string }): GraphResolverResult {
    const startedAt = Date.now();
    const query = { op: 'traceDataset', ...input };
    let ds: GraphNodeView | null = null;
    if (input.datasetNodeId) ds = this.getNodeById(input.datasetNodeId);
    if (!ds && input.dataset) {
      const { normalizedAscii } = normalizeGraphSearchTerm(input.dataset);
      const rows = this.db
        .prepare(
          `SELECT * FROM kg_nodes WHERE type='dataset'
           AND (name=? OR canonical_name LIKE ? OR normalized_name=? OR normalized_name LIKE ? OR id LIKE ?)
           ORDER BY id LIMIT 20`,
        )
        .all(
          input.dataset,
          `%:${input.dataset}`,
          normalizedAscii,
          `%${normalizedAscii}%`,
          `%:${input.dataset}`,
        ) as NodeRow[];
      if (rows.length === 1) ds = this.nodeView(rows[0]!);
      else if (rows.length > 1) {
        const boPreferred = rows.filter(
          (r) =>
            /\.BO\./i.test(r.id) ||
            /BO:/i.test(r.id) ||
            String((parseJson(r.attributes_json, {}) as { declaringType?: string }).declaringType ?? '').includes(
              '.BO.',
            ),
        );
        if (boPreferred.length === 1) {
          ds = this.nodeView(boPreferred[0]!);
        } else {
          const candidates = rows.map((r) =>
            this.candidateFromNode(this.nodeView(r), 7, 'dataset_name'),
          );
          return this.finalize(query, candidates, { startedAt, forceStatus: 'ambiguous' });
        }
      }
    }
    if (!ds) return emptyResult(query, 'unresolved');

    const extraNodes = [ds];
    const extraEdges: GraphEdgeView[] = [];
    for (const e of this.edgesFrom(ds.id, 'READS_FROM')) {
      extraEdges.push(e);
      const n = this.getNodeById(e.to);
      if (n) extraNodes.push(n);
    }
    for (const e of this.edgesFrom(ds.id, 'JOINS_TO')) {
      extraEdges.push(e);
      const n = this.getNodeById(e.to);
      if (n) {
        extraNodes.push(n);
        const jc = this.conflictsForSubjects([n.id]);
        if (jc.length) {
          /* attached in finalize */
        }
      }
    }
    for (const e of this.edgesFrom(ds.id, 'PROJECTS')) {
      extraEdges.push(e);
      const n = this.getNodeById(e.to);
      if (n) extraNodes.push(n);
    }
    // calculated columns often linked via DERIVED_FROM / dataset attributes — scan by declaring type
    const decl = String(ds.attributes.declaringType ?? '');
    if (decl) {
      const calcs = this.db
        .prepare(
          `SELECT * FROM kg_nodes WHERE type='calculated_column' AND canonical_name LIKE ? ORDER BY id LIMIT 50`,
        )
        .all(`%${decl}%`) as NodeRow[];
      for (const r of calcs) {
        const n = this.nodeView(r);
        extraNodes.push(n);
        for (const e of this.edgesFrom(n.id, 'USES_PACKAGE')) {
          extraEdges.push(e);
          const p = this.getNodeById(e.to);
          if (p) extraNodes.push(p);
        }
        for (const e of this.edgesFrom(n.id, 'CALLS_FUNCTION')) {
          extraEdges.push(e);
          const f = this.getNodeById(e.to);
          if (f) {
            extraNodes.push(f);
            if (String(f.attributes.owner ?? f.owner ?? '').toUpperCase() === 'UNKNOWN') {
              /* warn later */
            }
          }
        }
      }
    }

    const warnings: string[] = [];
    for (const n of extraNodes) {
      if (
        (n.type === 'oracle_object' || n.type === 'oracle_package' || n.type === 'oracle_function') &&
        String(n.owner ?? n.attributes.owner ?? '').toUpperCase() === 'UNKNOWN'
      ) {
        warnings.push(`unknown_owner:${n.id}`);
      }
    }

    return this.finalize(query, [this.candidateFromNode(ds, 7, 'dataset')], {
      startedAt,
      extraNodes,
      extraEdges: sortEdges(extraEdges),
      warnings,
    });
  }

  traceOracleObject(input: {
    owner?: string;
    objectType?: string;
    name?: string;
    nodeId?: string;
  }): GraphResolverResult {
    const startedAt = Date.now();
    const base = input.nodeId
      ? this.resolveNode({ id: input.nodeId })
      : this.resolveNode({
          name: input.name,
          owner: input.owner,
          objectType: input.objectType,
          nodeType: input.objectType?.toUpperCase() === 'PACKAGE' ? 'oracle_package' : undefined,
        });
    if (!base.selectedNodeId && base.candidates.length !== 1) return base;
    const oid = base.selectedNodeId ?? base.candidates[0]!.nodeId;
    const obj = this.getNodeById(oid);
    if (!obj) return emptyResult({ op: 'traceOracleObject', ...input }, 'unresolved');

    const extraNodes = [obj];
    const extraEdges: GraphEdgeView[] = [];
    const warnings: string[] = [];

    const status = String(obj.attributes.oracleValidationStatus ?? '');
    if (String(obj.owner ?? '').toUpperCase() === 'UNKNOWN') {
      warnings.push('unknown_owner');
      if (/^confirmed/i.test(status)) warnings.push('illegal_unknown_confirmed');
    }
    if (status === 'missing_in_current_db') warnings.push('missing_in_current_db');
    if (obj.attributes.technicalFactPreserved) warnings.push('technical_fact_preserved');

    for (const e of this.edgesTo(oid, 'MAPS_TO_ORACLE_OBJECT')) {
      extraEdges.push(e);
      const n = this.getNodeById(e.from);
      if (n) extraNodes.push(n);
    }
    for (const e of this.edgesFrom(oid, 'HAS_COLUMN')) {
      extraEdges.push(e);
      const n = this.getNodeById(e.to);
      if (n) extraNodes.push(n);
    }
    for (const e of this.edgesFrom(oid, 'DEPENDS_ON')) {
      extraEdges.push(e);
      const n = this.getNodeById(e.to);
      if (n) extraNodes.push(n);
    }
    for (const e of this.edgesFrom(oid, 'RESOLVES_SYNONYM_TO')) {
      extraEdges.push(e);
      const n = this.getNodeById(e.to);
      if (n) extraNodes.push(n);
    }
    for (const e of this.edgesTo(oid, 'RESOLVES_SYNONYM_TO')) {
      extraEdges.push(e);
      const n = this.getNodeById(e.from);
      if (n) extraNodes.push(n);
    }
    for (const t of ['FOREIGN_KEY_TO', 'PRIMARY_KEY_OF', 'UNIQUE_KEY_OF', 'REFERENCES']) {
      for (const e of [...this.edgesFrom(oid, t), ...this.edgesTo(oid, t)]) {
        extraEdges.push(e);
        const other = e.from === oid ? e.to : e.from;
        const n = this.getNodeById(other);
        if (n) extraNodes.push(n);
      }
    }

    return this.finalize(
      { op: 'traceOracleObject', ...input },
      [this.candidateFromNode(obj, 3, 'oracle_object')],
      {
        startedAt,
        forceStatus:
          status === 'missing_in_current_db'
            ? 'resolved'
            : /^confirmed/i.test(status) && String(obj.owner ?? '').toUpperCase() === 'UNKNOWN'
              ? 'conflicting'
              : 'resolved',
        extraNodes,
        extraEdges: sortEdges(extraEdges),
        warnings,
      },
    );
  }

  traceAction(input: {
    formGuid?: string;
    formTypeName?: string;
    controlName: string;
  }): GraphResolverResult {
    const startedAt = Date.now();
    const fr = this.resolveForm({ guid: input.formGuid, fullTypeName: input.formTypeName });
    const formId = fr.selectedNodeId ?? fr.candidates[0]?.nodeId;
    if (!formId) return emptyResult({ op: 'traceAction', ...input }, 'unresolved');
    const controls = this.edgesFrom(formId, 'HAS_CONTROL')
      .map((e) => this.getNodeById(e.to))
      .filter((n): n is GraphNodeView => !!n && n.name === input.controlName);
    // also search by name across action/control ids for form
    const rows = this.db
      .prepare(
        `SELECT * FROM kg_nodes WHERE name=? AND type IN ('action_control','ui_control')
         AND (id LIKE ? OR attributes_json LIKE ?)
         ORDER BY id`,
      )
      .all(input.controlName, `%${formId.split(':').slice(1).join(':')}%`, `%${input.formTypeName ?? ''}%`) as NodeRow[];
    const merged = new Map<string, GraphNodeView>();
    for (const c of controls) merged.set(c.id, c);
    for (const r of rows) merged.set(r.id, this.nodeView(r));
    const list = [...merged.values()];
    const preferred =
      list.find((c) => c.attributes.parameterName) ||
      list.find((c) => c.id.startsWith('action:')) ||
      list[0];
    if (!preferred) return emptyResult({ op: 'traceAction', ...input }, 'unresolved');

    const warnings: string[] = [];
    const extraEdges: GraphEdgeView[] = [];
    for (const e of this.edgesFrom(preferred.id, 'BINDS_TARGET')) {
      const t = this.getNodeById(e.to);
      if (t?.type === 'oracle_column' || t?.attributes.dataMember) {
        warnings.push('falsely_bound_as_oracle_column');
        extraEdges.push(e);
      }
    }
    if (preferred.attributes.noOracleColumn) warnings.push('no_oracle_column_by_design');

    return this.finalize(
      { op: 'traceAction', ...input },
      [this.candidateFromNode(preferred, 6, 'action_control')],
      {
        startedAt,
        forceStatus: warnings.includes('falsely_bound_as_oracle_column') ? 'conflicting' : 'resolved',
        extraNodes: [preferred, this.getNodeById(formId)!].filter(Boolean),
        extraEdges,
        warnings,
        paths: [
          {
            kind: 'action',
            nodeIds: [preferred.id],
            edgeIds: [],
            hops: [],
            warnings: [],
          },
        ],
      },
    );
  }

  getEvidenceSubgraph(input: {
    startNodeIds: string[];
    allowedEdgeTypes?: string[];
    direction?: 'out' | 'in' | 'both';
    maxDepth?: number;
    maxNodes?: number;
  }): GraphResolverResult {
    const startedAt = Date.now();
    const maxDepth = input.maxDepth ?? 6;
    const maxNodes = input.maxNodes ?? 500;
    const direction = input.direction ?? 'both';
    const allowed = input.allowedEdgeTypes ? new Set(input.allowedEdgeTypes) : null;

    const visited = new Set<string>();
    const nodeIds: string[] = [];
    const edgeIds: string[] = [];
    const queue: Array<{ id: string; depth: number }> = [];
    let truncated = false;

    for (const id of input.startNodeIds) {
      queue.push({ id, depth: 0 });
    }

    while (queue.length) {
      const cur = queue.shift()!;
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      nodeIds.push(cur.id);
      if (nodeIds.length >= maxNodes) {
        truncated = true;
        break;
      }
      if (cur.depth >= maxDepth) continue;

      const edges: GraphEdgeView[] = [];
      if (direction === 'out' || direction === 'both') edges.push(...this.edgesFrom(cur.id));
      if (direction === 'in' || direction === 'both') edges.push(...this.edgesTo(cur.id));

      for (const e of edges) {
        if (allowed && !allowed.has(e.type)) continue;
        edgeIds.push(e.id);
        const next = e.from === cur.id ? e.to : e.from;
        if (!visited.has(next)) queue.push({ id: next, depth: cur.depth + 1 });
      }
    }

    const nodes = this.getNodesByIds(nodeIds);
    const edges = this.getEdgesByIds(edgeIds);
    const candidates = input.startNodeIds
      .map((id) => this.getNodeById(id))
      .filter((n): n is GraphNodeView => !!n)
      .map((n) => this.candidateFromNode(n, 1, 'subgraph_start'));

    return this.finalize(
      { op: 'getEvidenceSubgraph', ...input, maxDepth, maxNodes },
      candidates,
      {
        startedAt,
        forceStatus: truncated ? 'resolved' : 'resolved',
        extraNodes: nodes,
        extraEdges: edges,
        truncated,
        continuation: truncated
          ? {
              reason: 'maxNodes_or_queue_exhausted',
              visitedNodes: visited.size,
              suggestion: 'narrow startNodeIds or allowedEdgeTypes / raise maxNodes',
            }
          : null,
        warnings: truncated ? ['truncated'] : [],
      },
    );
  }

  explainPath(path: GraphPath): {
    sentences: string[];
    hops: GraphPath['hops'];
    conflicts: GraphConflictView[];
  } {
    const sentences: string[] = [];
    for (const hop of path.hops) {
      const from = this.getNodeById(hop.fromId);
      const to = this.getNodeById(hop.toId);
      sentences.push(
        `${from?.type ?? '?'}(${from?.name ?? hop.fromId}) -[${hop.edgeType}/${hop.confidence ?? '-'}]→ ${to?.type ?? '?'}(${to?.name ?? hop.toId}) [stages=${(hop.sourceStages ?? []).join(',')}]`,
      );
    }
    const conflicts = this.conflictsForSubjects(path.nodeIds);
    if (conflicts.length) {
      sentences.push(
        `Conflicts affecting path: ${conflicts.map((c) => `${c.conflictType}:${c.resolutionStatus}`).join(', ')}`,
      );
    }
    return { sentences, hops: path.hops, conflicts };
  }
}
