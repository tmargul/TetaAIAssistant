/**
 * Stage 3B — evidence contract consistency (selectedNodeId typing + resolved identity).
 */
import type { EvidenceRequirement, EvidenceItemStatus } from './teta-stage3b.types';

/** Allowed node.type values for each evidenceType.selectedNodeId */
export const EVIDENCE_NODE_TYPES: Record<string, string[]> = {
  form: ['application_form'],
  help_document: ['help_document'],
  help_field: ['help_field'],
  control: ['ui_control', 'action_control'],
  target_binding: ['target_binding'],
  lookup_binding: ['lookup_binding'],
  dataset_columns: ['dataset_column'],
  oracle_columns: ['oracle_column'],
  action_parameter: ['action_control', 'ui_control'],
  provenance: [
    'help_field',
    'help_document',
    'ui_control',
    'action_control',
    'application_form',
    'target_binding',
    'lookup_binding',
    'dataset_column',
    'oracle_column',
  ],
};

export type EvidenceIdentity = {
  selectedNodeId: string | null;
  selectedNodeIds?: string[];
  pathNodeIds?: string[];
  pathEdgeIds?: string[];
  paths?: unknown[];
  candidates?: unknown[];
  status?: string | null;
  truncated?: boolean;
  businessTarget?: string;
  canonicalCandidates?: unknown[];
  selectionRequiredBeforeExecution?: boolean;
};

export function hasResolvedIdentity(resolution: EvidenceIdentity | null | undefined): boolean {
  if (!resolution) return false;
  if (resolution.selectedNodeId) return true;
  if (resolution.selectedNodeIds && resolution.selectedNodeIds.length > 0) return true;
  if (resolution.pathNodeIds && resolution.pathNodeIds.length > 0) return true;
  if (resolution.paths && Array.isArray(resolution.paths) && resolution.paths.length > 0) {
    return true;
  }
  return false;
}

export function nodeTypeAllowedForEvidence(
  evidenceType: string,
  nodeType: string | null | undefined,
): boolean {
  const allowed = EVIDENCE_NODE_TYPES[evidenceType];
  if (!allowed) return true; // unknown evidence types not strictly typed here
  if (!nodeType) return false;
  return allowed.includes(nodeType);
}

export function inferNodeTypeFromId(nodeId: string): string | null {
  if (nodeId.startsWith('form:')) return 'application_form';
  if (nodeId.startsWith('help-doc:')) return 'help_document';
  if (nodeId.startsWith('help-field:')) return 'help_field';
  if (nodeId.startsWith('control:')) return 'ui_control';
  if (nodeId.startsWith('action:')) return 'action_control';
  if (nodeId.startsWith('binding-target:')) return 'target_binding';
  if (nodeId.startsWith('binding-lookup:')) return 'lookup_binding';
  if (nodeId.startsWith('dataset-column:')) return 'dataset_column';
  if (nodeId.startsWith('oracle-column:')) return 'oracle_column';
  return null;
}

export type EvidenceContractViolation = {
  code:
    | 'resolvedEvidenceWithoutNodeOrPath'
    | 'evidenceSelectedNodeTypeMismatch'
    | 'helpDocumentPointingToForm'
    | 'bindingResolvedWithoutResolvedControl'
    | 'lookupResolvedWithoutLookupEdge'
    | 'fieldEvidenceOutsideResolvedPath';
  evidenceType: string;
  detail: string;
};

export function validateEvidenceList(
  requirements: EvidenceRequirement[],
  opts?: {
    resolvedControlId?: string | null;
    lookupEdgePresent?: boolean;
    allowedFieldPathNodeIds?: Set<string>;
  },
): EvidenceContractViolation[] {
  const violations: EvidenceContractViolation[] = [];
  const controlEv = requirements.find((e) => e.evidenceType === 'control');
  const controlResolved =
    controlEv?.status === 'resolved' && hasResolvedIdentity(controlEv.graphResolution);

  for (const ev of requirements) {
    const res = ev.graphResolution;
    if (ev.status === 'resolved') {
      if (!hasResolvedIdentity(res)) {
        violations.push({
          code: 'resolvedEvidenceWithoutNodeOrPath',
          evidenceType: ev.evidenceType,
          detail: 'resolved without selectedNodeId/selectedNodeIds/path',
        });
      }
    }

    if (ev.evidenceType === 'help_document' && res?.selectedNodeId?.startsWith('form:')) {
      violations.push({
        code: 'helpDocumentPointingToForm',
        evidenceType: ev.evidenceType,
        detail: res.selectedNodeId,
      });
    }

    const ids = [
      ...(res?.selectedNodeId ? [res.selectedNodeId] : []),
      ...((res as EvidenceIdentity | null)?.selectedNodeIds ?? []),
    ];
    for (const id of ids) {
      const inferred = inferNodeTypeFromId(id);
      if (inferred && !nodeTypeAllowedForEvidence(ev.evidenceType, inferred)) {
        violations.push({
          code: 'evidenceSelectedNodeTypeMismatch',
          evidenceType: ev.evidenceType,
          detail: `${id} inferred as ${inferred}`,
        });
      }
    }

    if (
      (ev.evidenceType === 'target_binding' ||
        ev.evidenceType === 'dataset_columns' ||
        ev.evidenceType === 'oracle_columns') &&
      ev.status === 'resolved' &&
      !controlResolved
    ) {
      violations.push({
        code: 'bindingResolvedWithoutResolvedControl',
        evidenceType: ev.evidenceType,
        detail: 'binding/columns resolved without resolved control',
      });
    }

    if (ev.evidenceType === 'lookup_binding' && ev.status === 'resolved' && opts?.lookupEdgePresent === false) {
      violations.push({
        code: 'lookupResolvedWithoutLookupEdge',
        evidenceType: ev.evidenceType,
        detail: 'lookup_binding resolved without BINDS_LOOKUP',
      });
    }

    if (
      opts?.allowedFieldPathNodeIds &&
      ev.status === 'resolved' &&
      ['target_binding', 'lookup_binding', 'dataset_columns', 'oracle_columns', 'control'].includes(
        ev.evidenceType,
      )
    ) {
      for (const id of ids) {
        if (!opts.allowedFieldPathNodeIds.has(id)) {
          violations.push({
            code: 'fieldEvidenceOutsideResolvedPath',
            evidenceType: ev.evidenceType,
            detail: id,
          });
        }
      }
    }
  }

  return violations;
}

export function coerceResolvedStatus(
  status: EvidenceItemStatus,
  resolution: EvidenceIdentity | null,
): EvidenceItemStatus {
  if (status === 'resolved' && !hasResolvedIdentity(resolution)) {
    return 'missing';
  }
  return status;
}
