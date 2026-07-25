/**
 * Stage 3D — binding validator against current Stage 3A graph.
 */
import type {
  SemanticBindingsFile,
  Stage3dGraphClient,
  SubjectSemanticBindings,
  ValidationIssue,
  ValidationResult,
} from './teta-business-semantics.types';
import { STAGE3D_IDENTITY_VERSION } from './teta-business-semantics.types';

function isIdColumnNodeId(id: string | null | undefined): boolean {
  if (!id) return false;
  const col = id.split(':').pop()?.toUpperCase() ?? '';
  return col === 'ID' || /_ID$/.test(col);
}

function ownerFromObjectNodeId(id: string | null | undefined): string {
  if (!id) return 'UNKNOWN';
  const parts = id.split(':');
  // oracle-object:OWNER:TYPE:NAME
  return (parts[1] ?? 'UNKNOWN').toUpperCase();
}

export function validateSubjectBindings(
  subjectBindings: SubjectSemanticBindings,
  registry: SemanticBindingsFile,
  graph: Stage3dGraphClient | null,
  currentGraphSourceHash: string | null,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const stale = !!(
    currentGraphSourceHash &&
    registry.graphSourceHash &&
    currentGraphSourceHash !== registry.graphSourceHash
  );
  if (stale) {
    issues.push({
      code: 'graph_source_hash_mismatch',
      severity: 'error',
      subject: subjectBindings.subject,
      message: `Registry hash ${registry.graphSourceHash} != current graph ${currentGraphSourceHash}`,
    });
  }
  if (registry.identityVersion !== STAGE3D_IDENTITY_VERSION) {
    issues.push({
      code: 'identity_version_mismatch',
      severity: 'error',
      message: `identityVersion ${registry.identityVersion} != ${STAGE3D_IDENTITY_VERSION}`,
    });
  }

  const nodeExists = (id: string | null | undefined): boolean => {
    if (!id) return false;
    if (!graph) return true; // structural-only when no graph
    return !!graph.getNodeById(id);
  };

  let approved = 0;
  let invalid = 0;

  const checkReason = (role: string, reason: string | undefined) => {
    if (!reason || !reason.trim()) {
      issues.push({
        code: 'missing_business_reason',
        severity: 'error',
        subject: subjectBindings.subject,
        role,
        message: 'businessReason is required',
      });
      invalid += 1;
    }
  };

  for (const s of subjectBindings.sources) {
    if (s.status === 'approved') approved += 1;
    checkReason(s.role, s.businessReason);
    if (s.status === 'approved') {
      if (!s.logicalObjectNodeId || !nodeExists(s.logicalObjectNodeId)) {
        issues.push({
          code: 'missing_logical_object',
          severity: 'error',
          subject: subjectBindings.subject,
          role: s.role,
          nodeId: s.logicalObjectNodeId,
          message: 'Approved source requires existing logicalObjectNodeId',
        });
        invalid += 1;
      } else {
        const owner = ownerFromObjectNodeId(s.logicalObjectNodeId);
        if (owner === 'HRM' || owner === 'UNKNOWN') {
          issues.push({
            code: 'forbidden_owner_auto_binding',
            severity: 'error',
            subject: subjectBindings.subject,
            role: s.role,
            nodeId: s.logicalObjectNodeId,
            message: `Approved binding must not use owner ${owner}`,
          });
          invalid += 1;
        }
      }
      if (s.accessObjectNodeId && !nodeExists(s.accessObjectNodeId)) {
        issues.push({
          code: 'missing_access_object',
          severity: 'error',
          subject: subjectBindings.subject,
          role: s.role,
          nodeId: s.accessObjectNodeId,
          message: 'accessObjectNodeId not found in graph',
        });
        invalid += 1;
      }
      for (const fid of s.formNodeIds ?? []) {
        if (!nodeExists(fid)) {
          issues.push({
            code: 'missing_form_node',
            severity: 'warning',
            subject: subjectBindings.subject,
            role: s.role,
            nodeId: fid,
            message: 'Referenced form node missing',
          });
        }
      }
    }
  }

  for (const p of subjectBindings.projections) {
    if (p.status === 'approved') approved += 1;
    checkReason(p.role, p.businessReason);
    if (p.status === 'approved') {
      if (!p.oracleColumnNodeId || !nodeExists(p.oracleColumnNodeId)) {
        issues.push({
          code: 'missing_projection_column',
          severity: 'error',
          subject: subjectBindings.subject,
          role: p.role,
          nodeId: p.oracleColumnNodeId,
          message: 'Approved projection requires existing oracleColumnNodeId',
        });
        invalid += 1;
      }
    }
  }

  for (const r of subjectBindings.relations) {
    if (r.status === 'approved') approved += 1;
    checkReason(r.role, r.businessReason);
    if (r.status === 'approved') {
      if (!r.predicates.length) {
        issues.push({
          code: 'relation_without_predicates',
          severity: 'error',
          subject: subjectBindings.subject,
          role: r.role,
          message: 'Approved relation requires predicates',
        });
        invalid += 1;
      }
      for (const pred of r.predicates) {
        if (!nodeExists(pred.leftOracleColumnNodeId) || !nodeExists(pred.rightOracleColumnNodeId)) {
          issues.push({
            code: 'relation_predicate_node_missing',
            severity: 'error',
            subject: subjectBindings.subject,
            role: r.role,
            message: 'Relation predicate column node missing in graph',
          });
          invalid += 1;
        }
      }
      if (r.joinNodeId && !nodeExists(r.joinNodeId)) {
        issues.push({
          code: 'relation_join_node_missing',
          severity: 'error',
          subject: subjectBindings.subject,
          role: r.role,
          nodeId: r.joinNodeId,
          message: 'Cited join node missing in graph',
        });
        invalid += 1;
      }
    }
  }

  for (const vp of subjectBindings.valuePaths) {
    if (vp.status === 'approved') approved += 1;
    checkReason(vp.role, vp.businessReason);
    if (vp.status === 'approved') {
      if (!vp.displayColumnNodeId || !nodeExists(vp.displayColumnNodeId)) {
        issues.push({
          code: 'value_path_display_missing',
          severity: 'error',
          subject: subjectBindings.subject,
          role: vp.role,
          nodeId: vp.displayColumnNodeId,
          message: 'Approved value path requires displayColumnNodeId',
        });
        invalid += 1;
      } else if (isIdColumnNodeId(vp.displayColumnNodeId)) {
        issues.push({
          code: 'value_path_ends_on_id',
          severity: 'error',
          subject: subjectBindings.subject,
          role: vp.role,
          nodeId: vp.displayColumnNodeId,
          message: 'Value path must not end on an ID column',
        });
        invalid += 1;
      }
      for (const step of vp.steps) {
        const col = step.displayColumnNodeId ?? step.columnNodeId;
        if (col && !nodeExists(col)) {
          issues.push({
            code: 'value_path_step_missing',
            severity: 'error',
            subject: subjectBindings.subject,
            role: vp.role,
            nodeId: col,
            message: 'Value path step column missing',
          });
          invalid += 1;
        }
      }
    }
  }

  for (const t of subjectBindings.temporals) {
    if (t.status === 'approved') approved += 1;
    checkReason(t.role, t.businessReason);
    if (t.status === 'approved') {
      if (t.type === 'half_open_date_interval') {
        if (!t.columnOracleNodeId || !nodeExists(t.columnOracleNodeId)) {
          issues.push({
            code: 'temporal_column_missing',
            severity: 'error',
            subject: subjectBindings.subject,
            role: t.role,
            nodeId: t.columnOracleNodeId,
            message: 'half_open temporal requires columnOracleNodeId',
          });
          invalid += 1;
        }
      } else {
        if (
          !t.validFromColumnNodeId ||
          !t.validToColumnNodeId ||
          !nodeExists(t.validFromColumnNodeId) ||
          !nodeExists(t.validToColumnNodeId)
        ) {
          issues.push({
            code: 'temporal_effective_columns_missing',
            severity: 'error',
            subject: subjectBindings.subject,
            role: t.role,
            message: 'effective_on_date requires validFrom/validTo column nodes',
          });
          invalid += 1;
        }
      }
    }
  }

  for (const f of subjectBindings.forms ?? []) {
    if (f.status === 'approved') approved += 1;
    checkReason(f.role, f.businessReason);
    if (f.status === 'approved' && f.formNodeId && !nodeExists(f.formNodeId)) {
      issues.push({
        code: 'form_node_missing',
        severity: 'warning',
        subject: subjectBindings.subject,
        role: f.role,
        nodeId: f.formNodeId,
        message: 'Form node missing in graph',
      });
    }
  }

  const ok =
    !stale &&
    issues.filter((i) => i.severity === 'error').length === 0 &&
    invalid === 0;

  return {
    ok,
    graphSourceHash: currentGraphSourceHash,
    registryGraphSourceHash: registry.graphSourceHash,
    identityVersion: registry.identityVersion,
    issues,
    stale,
    approvedBindingCount: approved,
    invalidBindingCount: invalid,
  };
}

export function validateRegistry(
  registry: SemanticBindingsFile,
  graph: Stage3dGraphClient | null,
  currentGraphSourceHash: string | null,
): ValidationResult {
  const merged: ValidationResult = {
    ok: true,
    graphSourceHash: currentGraphSourceHash,
    registryGraphSourceHash: registry.graphSourceHash,
    identityVersion: registry.identityVersion,
    issues: [],
    stale: false,
    approvedBindingCount: 0,
    invalidBindingCount: 0,
  };
  for (const subject of registry.subjects) {
    const r = validateSubjectBindings(subject, registry, graph, currentGraphSourceHash);
    merged.issues.push(...r.issues);
    merged.approvedBindingCount += r.approvedBindingCount;
    merged.invalidBindingCount += r.invalidBindingCount;
    merged.stale = merged.stale || r.stale;
    if (!r.ok) merged.ok = false;
  }
  return merged;
}
