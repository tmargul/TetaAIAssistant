/**

 * Generic approved-binding reuse — loads Stage3D registry without scenario builders.

 * Physical names come from the approved file at runtime (allowed in approved mode only).

 */

import fs from 'fs';

import path from 'path';

import type {

  LogicalRoleId,

  SchemaEvidenceGraph,

  SchemaRoleResolutionStatus,

} from '../teta-schema-role-resolution/teta-schema-role-resolution.types';



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

      sourceRole?: string;

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



/** Map logical resolver roles to approved source roles (generic, not scenario-specific). */

const LOGICAL_TO_APPROVED_SOURCE_ROLES: Partial<Record<LogicalRoleId, string[]>> = {

  assignment_source: ['current_position', 'assignment', 'position', 'stanowisko'],

  subject_identity: ['employee', 'subject', 'health_examination'],

  dictionary_identity: [

    'position_dictionary',

    'dictionary',

    'organizational_unit',

    'examination_type',

  ],

  dictionary_display_name: ['position_dictionary', 'organizational_unit', 'examination_type'],

  dictionary_reference: ['current_position', 'position_dictionary'],

  subject_reference: ['employee', 'current_position'],

  valid_from: ['current_position', 'employment_contract'],

  valid_to: ['current_position', 'employment_contract'],

};



function parseObject(nodeId: string | undefined): {

  owner: string;

  objectName: string;

  objectRef: string;

} | null {

  if (!nodeId) return null;

  const c = /^oracle-column:([^:]+):([^:]+):(.+)$/.exec(nodeId);

  if (c) return { owner: c[1]!, objectName: c[2]!, objectRef: `${c[1]}.${c[2]}` };

  const m = /^oracle-(?:object|column):([^:]+):(?:VIEW|TABLE):([^:]+)/.exec(nodeId);

  if (m) return { owner: m[1]!, objectName: m[2]!, objectRef: `${m[1]}.${m[2]}` };

  return null;

}



function parseColumn(nodeId: string | undefined): { objectRef: string; column: string } | null {

  if (!nodeId) return null;

  const c = /^oracle-column:([^:]+):([^:]+):(.+)$/.exec(nodeId);

  if (!c) return null;

  return { objectRef: `${c[1]}.${c[2]}`, column: c[3]! };

}



function approvedSourceRolesFor(input: {

  requestedRoles: LogicalRoleId[];

  conceptTokens: string[];

}): Set<string> {

  const roles = new Set<string>();

  for (const lr of input.requestedRoles) {

    for (const sr of LOGICAL_TO_APPROVED_SOURCE_ROLES[lr] ?? []) roles.add(sr);

  }

  for (const t of input.conceptTokens) {

    const tok = t.toLowerCase();

    if (/position|stanowisk/.test(tok)) roles.add('current_position');

    if (/employee|pracown/.test(tok)) roles.add('employee');

    if (/dictionary|slownik/.test(tok)) roles.add('position_dictionary');

  }

  return roles;

}



function buildGraphFromSubject(

  subject: NonNullable<Stage3dFile['subjects']>[number],

  relevantSourceRoles: Set<string>,

): SchemaEvidenceGraph {

  const graph: SchemaEvidenceGraph = { objects: [], relations: [], claims: [] };

  const ensure = (objectRef: string, owner: string, objectName: string, tags: string[]) => {

    let obj = graph.objects.find((o) => o.objectRef === objectRef);

    if (!obj) {

      obj = { objectRef, owner, objectType: 'VIEW', objectName, columns: [], tags };

      graph.objects.push(obj);

    } else {

      obj.tags = [...new Set([...(obj.tags ?? []), ...tags])];

    }

    return obj;

  };



  for (const src of subject.sources ?? []) {

    const role = src.role ?? '';

    if (src.status !== 'approved') continue;

    if (relevantSourceRoles.size > 0 && !relevantSourceRoles.has(role)) continue;

    const parsed = parseObject(src.logicalObjectNodeId ?? src.accessObjectNodeId);

    if (!parsed) continue;

    const tags: string[] = [];

    const roleLower = role.toLowerCase();

    if (roleLower === 'employee' || roleLower === 'subject' || roleLower === 'health_examination') {
      tags.push('subject');
    }

    if (roleLower === 'current_position' || roleLower === 'assignment' || roleLower === 'position') {
      tags.push('assignment_candidate');
    }

    if (
      roleLower === 'position_dictionary' ||
      roleLower === 'organizational_unit' ||
      roleLower === 'examination_type' ||
      roleLower.endsWith('_dictionary')
    ) {
      tags.push('dictionary_candidate');
    }

    ensure(parsed.objectRef, parsed.owner, parsed.objectName, tags);

    graph.claims.push({

      family: 'application_technical',

      claimType: 'approved_binding_source',

      object: parsed.objectRef,

      roleHint: tags.includes('assignment_candidate')

        ? 'assignment_source'

        : tags.includes('dictionary_candidate')

          ? 'dictionary_identity'

          : 'subject_identity',

      weight: 3,

      provenance: [

        'approved_binding:teta-business-semantic-bindings-v1',

        `subject:${subject.subject}`,

        `source_role:${src.role}`,

        `status:${src.status}`,

      ],

    });

  }



  for (const rel of subject.relations ?? []) {

    if (rel.status !== 'approved') continue;

    const leftRole = rel.leftSourceRole ?? '';

    const rightRole = rel.rightSourceRole ?? '';

    if (

      relevantSourceRoles.size > 0 &&

      !relevantSourceRoles.has(leftRole) &&

      !relevantSourceRoles.has(rightRole)

    ) {

      continue;

    }

    for (const p of rel.predicates ?? []) {

      const left = parseColumn(p.leftOracleColumnNodeId);

      const right = parseColumn(p.rightOracleColumnNodeId);

      if (!left || !right) continue;

      graph.relations.push({

        fromObject: left.objectRef,

        fromColumn: left.column,

        toObject: right.objectRef,

        toColumn: right.column,

        relationType: rel.role ?? 'approved_relation',

        family: 'oracle_structural',

        provenance: ['approved_binding:relation', `role:${rel.role}`],

      });

    }

  }



  for (const vp of subject.valuePaths ?? []) {

    if (vp.status !== 'approved') continue;

    const srcRole = vp.sourceRole ?? vp.displaySourceRole ?? '';

    if (relevantSourceRoles.size > 0 && srcRole && !relevantSourceRoles.has(srcRole)) continue;

    const col = parseColumn(vp.displayColumnNodeId);

    if (!col) continue;

    const obj = graph.objects.find((o) => o.objectRef === col.objectRef);

    if (obj && !obj.columns!.some((c) => c.name === col.column)) {

      obj.columns!.push({ name: col.column, dataType: 'VARCHAR2' });

    }

    graph.claims.push({

      family: 'application_technical',

      claimType: 'approved_display_path',

      object: col.objectRef,

      column: col.column,

      roleHint: 'dictionary_display_name',

      weight: 3,

      provenance: ['approved_binding:valuePath', `role:${vp.role}`],

    });

  }



  for (const t of subject.temporals ?? []) {

    if (t.status !== 'approved') continue;

    if (relevantSourceRoles.size > 0 && t.sourceRole && !relevantSourceRoles.has(t.sourceRole)) {

      continue;

    }

    const from = parseColumn(t.validFromColumnNodeId);

    const to = parseColumn(t.validToColumnNodeId);

    if (from) {

      graph.claims.push({

        family: 'application_technical',

        claimType: 'approved_temporal',

        object: from.objectRef,

        column: from.column,

        roleHint: 'valid_from',

        weight: 3,

        provenance: ['approved_binding:temporal', `role:${t.role}`],

      });

    }

    if (to) {

      graph.claims.push({

        family: 'application_technical',

        claimType: 'approved_temporal',

        object: to.objectRef,

        column: to.column,

        roleHint: 'valid_to',

        weight: 3,

        provenance: ['approved_binding:temporal', `role:${t.role}`],

      });

    }

  }



  return graph;

}



export type ApprovedBindingReuseResult = {

  graph: SchemaEvidenceGraph | null;

  loaded: boolean;

  subjectMatched: string | null;

  reuseStatus: 'reused' | 'stale' | 'conflicting' | 'not_found' | 'fallback_discovery';

  approvedBindingsConsidered: number;

  approvedBindingsReused: number;

  approvedBindingsStale: number;

  approvedBindingsConflicting: number;

  resolutionStatus: SchemaRoleResolutionStatus;

};



/**

 * Find scope-compatible approved binding by matching requested roles + concept tokens.

 */

export function loadApprovedBindingsEvidence(input: {

  repoRoot: string;

  conceptTokens: string[];

  requestedRoles?: LogicalRoleId[];

}): ApprovedBindingReuseResult {

  const empty: ApprovedBindingReuseResult = {

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

  const bindingsPath = path.join(

    input.repoRoot,

    'apps',

    'api',

    'config',

    'teta-business-semantic-bindings-v1.json',

  );

  if (!fs.existsSync(bindingsPath)) return empty;



  const file = JSON.parse(fs.readFileSync(bindingsPath, 'utf8')) as Stage3dFile;

  const relevantSourceRoles = approvedSourceRolesFor({

    requestedRoles: input.requestedRoles ?? ['assignment_source'],

    conceptTokens: input.conceptTokens,

  });



  const candidates = (file.subjects ?? []).filter((s) => {

    const sourceRoles = new Set((s.sources ?? []).map((x) => x.role).filter(Boolean) as string[]);

    const overlap = [...relevantSourceRoles].filter((r) => sourceRoles.has(r));

    return overlap.length >= 1;

  });



  empty.loaded = true;

  empty.approvedBindingsConsidered = candidates.length;

  if (candidates.length === 0) return empty;



  const subject = [...candidates].sort((a, b) => {

    const score = (s: typeof a) =>

      [...relevantSourceRoles].filter((r) =>

        (s.sources ?? []).some((x) => x.role === r && x.status === 'approved'),

      ).length;

    return score(b) - score(a);

  })[0]!;



  const staleSources = (subject.sources ?? []).filter(

    (s) => relevantSourceRoles.has(s.role ?? '') && s.status !== 'approved',

  );

  if (staleSources.length > 0) {

    return {

      ...empty,

      subjectMatched: subject.subject ?? null,

      reuseStatus: 'stale',

      approvedBindingsStale: 1,

      resolutionStatus: 'stale',

    };

  }



  const graph = buildGraphFromSubject(subject, relevantSourceRoles);

  if (graph.objects.length === 0) return empty;



  const hasAssignment = graph.objects.some((o) => o.tags?.includes('assignment_candidate'));

  if (!hasAssignment && input.requestedRoles?.includes('assignment_source')) {

    return empty;

  }



  return {

    graph,

    loaded: true,

    subjectMatched: subject.subject ?? null,

    reuseStatus: 'reused',

    approvedBindingsConsidered: candidates.length,

    approvedBindingsReused: 1,

    approvedBindingsStale: 0,

    approvedBindingsConflicting: 0,

    resolutionStatus: 'strong_inference_readonly',

  };

}



/** Validate discovery graph does not directly conflict with approved binding objects. */

export function detectApprovedBindingConflict(

  approved: SchemaEvidenceGraph,

  discovery: SchemaEvidenceGraph,

): boolean {

  const approvedAssignment = approved.objects.find((o) => o.tags?.includes('assignment_candidate'));

  if (!approvedAssignment) return false;

  const discoveryAssignments = discovery.objects.filter((o) =>

    o.tags?.includes('assignment_candidate'),

  );

  if (discoveryAssignments.length === 0) return false;

  return discoveryAssignments.some(

    (d) =>

      d.objectRef !== approvedAssignment.objectRef &&

      discovery.claims.some(

        (c) =>

          c.object === d.objectRef &&

          c.family === 'application_technical' &&

          (c.claimType === 'assignment_gateway' || c.claimType === 'gateway_reads_oracle'),

      ),

  );

}


