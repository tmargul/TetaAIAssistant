import fs from 'fs';
import path from 'path';
import type { SchemaEvidenceGraph } from './teta-schema-role-resolution.types';

type Stage3dFile = {
  subjects?: Array<{
    subject?: string;
    sources?: Array<{
      role?: string;
      status?: string;
      accessObjectNodeId?: string;
      logicalObjectNodeId?: string;
    }>;
    relations?: Array<{
      role?: string;
      status?: string;
      leftSourceRole?: string;
      rightSourceRole?: string;
      predicates?: Array<{
        leftOracleColumnNodeId?: string;
        rightOracleColumnNodeId?: string;
      }>;
    }>;
    valuePaths?: Array<{
      role?: string;
      status?: string;
      displayColumnNodeId?: string;
      displaySourceRole?: string;
    }>;
    temporals?: Array<{
      role?: string;
      status?: string;
      sourceRole?: string;
      validFromColumnNodeId?: string;
      validToColumnNodeId?: string;
    }>;
  }>;
};

function parseObject(nodeId: string | undefined): {
  owner: string;
  objectName: string;
  objectRef: string;
} | null {
  if (!nodeId) return null;
  const m = /^oracle-(?:object|column):([^:]+):(?:VIEW|TABLE):([^:]+)(?::(.+))?$/.exec(
    nodeId,
  );
  // column form: oracle-column:OWNER:OBJECT:COLUMN
  const c = /^oracle-column:([^:]+):([^:]+):(.+)$/.exec(nodeId);
  if (c) {
    return {
      owner: c[1]!,
      objectName: c[2]!,
      objectRef: `${c[1]}.${c[2]}`,
    };
  }
  if (m) {
    return { owner: m[1]!, objectName: m[2]!, objectRef: `${m[1]}.${m[2]}` };
  }
  return null;
}

function parseColumn(nodeId: string | undefined): {
  objectRef: string;
  column: string;
} | null {
  if (!nodeId) return null;
  const c = /^oracle-column:([^:]+):([^:]+):(.+)$/.exec(nodeId);
  if (!c) return null;
  return { objectRef: `${c[1]}.${c[2]}`, column: c[3]! };
}

/**
 * PRODUCTION evidence adapter: Stage 3D approved business-semantic bindings.
 *
 * Classification: production_physical_binding
 *
 * This adapter loads already-approved physical Oracle objects, columns,
 * join predicates, dictionary paths and temporal columns from
 * `teta-business-semantic-bindings-v1.json`.
 *
 * Use ONLY with discoveryMode=approved_binding_reuse (runtime fast path).
 *
 * MUST NOT be used for discoveryMode=blind_physical_rediscovery —
 * that would invalidate any "independent rediscovery" acceptance claim.
 */
export function buildCurrentPositionEvidenceFromStage3d(
  repoRoot: string,
): SchemaEvidenceGraph | null {
  const bindingsPath = path.join(
    repoRoot,
    'apps',
    'api',
    'config',
    'teta-business-semantic-bindings-v1.json',
  );
  if (!fs.existsSync(bindingsPath)) return null;
  const file = JSON.parse(fs.readFileSync(bindingsPath, 'utf8')) as Stage3dFile;
  // Prefer subjects that expose employee + current_position style sources
  const subject = (file.subjects ?? []).find((s) => {
    const roles = new Set((s.sources ?? []).map((x) => x.role));
    return (
      roles.has('employee') &&
      (roles.has('current_position') || roles.has('position') || roles.has('stanowisko'))
    );
  });
  if (!subject) return null;

  const graph: SchemaEvidenceGraph = { objects: [], relations: [], claims: [] };
  const ensureObj = (objectRef: string, owner: string, objectName: string, tags: string[]) => {
    let obj = graph.objects.find((o) => o.objectRef === objectRef);
    if (!obj) {
      obj = {
        objectRef,
        owner,
        objectType: 'VIEW',
        objectName,
        columns: [],
        tags,
      };
      graph.objects.push(obj);
    } else {
      obj.tags = [...new Set([...(obj.tags ?? []), ...tags])];
    }
    return obj;
  };

  for (const src of subject.sources ?? []) {
    // Prefer logical object for identity; access layer may be TETA_ADMIN_P synonym.
    const parsed = parseObject(src.logicalObjectNodeId ?? src.accessObjectNodeId);
    if (!parsed) continue;
    const tags: string[] = [];
    if (src.role === 'employee') tags.push('subject');
    if (src.role === 'current_position' || src.role === 'position') {
      tags.push('assignment_candidate');
    }
    if (src.role === 'position_dictionary' || src.role === 'dictionary') {
      tags.push('dictionary_candidate');
    }
    ensureObj(parsed.objectRef, parsed.owner, parsed.objectName, tags);
    if (tags.includes('assignment_candidate')) {
      graph.claims.push({
        family: 'application_technical',
        claimType: 'assignment_gateway',
        object: parsed.objectRef,
        roleHint: 'assignment_source',
        weight: 3,
        provenance: [
          'stage3d:teta-business-semantic-bindings-v1',
          `subject:${subject.subject}`,
          `source_role:${src.role}`,
          `status:${src.status}`,
        ],
      });
      graph.claims.push({
        family: 'application_semantic',
        claimType: 'assignment_dataset',
        object: parsed.objectRef,
        roleHint: 'assignment_source',
        weight: 2,
        provenance: [
          'concept:current_position',
          'stage3d_subject_technical_evidence',
        ],
      });
    }
  }

  for (const rel of subject.relations ?? []) {
    for (const p of rel.predicates ?? []) {
      const left = parseColumn(p.leftOracleColumnNodeId);
      const right = parseColumn(p.rightOracleColumnNodeId);
      if (!left || !right) continue;
      // ensure columns exist
      for (const side of [left, right]) {
        const obj = graph.objects.find((o) => o.objectRef === side.objectRef);
        if (obj && !obj.columns!.some((c) => c.name === side.column)) {
          obj.columns!.push({
            name: side.column,
            dataType: 'NUMBER',
            isFk: true,
          });
        }
      }
      graph.relations.push({
        fromObject: left.objectRef,
        fromColumn: left.column,
        toObject: right.objectRef,
        toColumn: right.column,
        relationType: rel.role ?? 'relation',
        family: 'oracle_structural',
        provenance: [
          'stage3d:relation',
          `role:${rel.role}`,
          `status:${rel.status}`,
        ],
      });
      graph.relations.push({
        fromObject: left.objectRef,
        fromColumn: left.column,
        toObject: right.objectRef,
        toColumn: right.column,
        relationType: 'implementation_usage',
        family: 'implementation_usage',
        provenance: ['stage3d:repeated_predicate'],
      });
      graph.claims.push({
        family: 'oracle_structural',
        claimType: 'fk_constraint',
        object: left.objectRef,
        column: left.column,
        subject: right.objectRef,
        weight: 3,
        provenance: [
          'stage3d:relation_predicate',
          `role:${rel.role}`,
          `${left.objectRef}.${left.column}=${right.objectRef}.${right.column}`,
        ],
      });
    }
  }

  for (const vp of subject.valuePaths ?? []) {
    const col = parseColumn(vp.displayColumnNodeId);
    if (!col) continue;
    const obj = graph.objects.find((o) => o.objectRef === col.objectRef);
    if (obj && !obj.columns!.some((c) => c.name === col.column)) {
      obj.columns!.push({ name: col.column, dataType: 'VARCHAR2' });
    }
    if (obj) obj.tags = [...new Set([...(obj.tags ?? []), 'dictionary_candidate'])];
  }

  for (const t of subject.temporals ?? []) {
    const from = parseColumn(t.validFromColumnNodeId);
    const to = parseColumn(t.validToColumnNodeId);
    const assignment = graph.objects.find((o) => o.tags?.includes('assignment_candidate'));
    if (from) {
      const obj = graph.objects.find((o) => o.objectRef === from.objectRef) ?? assignment;
      if (obj && !obj.columns!.some((c) => c.name === from.column)) {
        obj.columns!.push({ name: from.column, dataType: 'DATE' });
      }
      graph.claims.push({
        family: 'application_technical',
        claimType: 'temporal_period_labels',
        object: from.objectRef,
        column: from.column,
        roleHint: 'valid_from',
        weight: 2,
        provenance: ['stage3d:temporal', `role:${t.role}`],
      });
    }
    if (to) {
      const obj = graph.objects.find((o) => o.objectRef === to.objectRef) ?? assignment;
      if (obj && !obj.columns!.some((c) => c.name === to.column)) {
        obj.columns!.push({ name: to.column, dataType: 'DATE', nullable: true });
      }
      graph.claims.push({
        family: 'application_technical',
        claimType: 'temporal_period_labels',
        object: to.objectRef,
        column: to.column,
        roleHint: 'valid_to',
        weight: 2,
        provenance: ['stage3d:temporal', `role:${t.role}`],
      });
    }
    if (assignment) {
      graph.claims.push({
        family: 'documentation_semantic',
        claimType: 'period_semantics',
        object: assignment.objectRef,
        weight: 2,
        provenance: ['stage3d:temporal_inclusive_sysdate_contract'],
      });
    }
  }

  // Mark PK on dictionary ID if present
  for (const obj of graph.objects) {
    if (!obj.tags?.includes('dictionary_candidate')) continue;
    const id = obj.columns?.find((c) => c.name === 'ID');
    if (id) id.isPk = true;
    if (obj.columns && !obj.columns.some((c) => c.name === 'NAZWA')) {
      // value path may have added NAZWA already
    }
  }

  return graph;
}
