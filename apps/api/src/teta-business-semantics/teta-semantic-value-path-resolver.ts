/**
 * Stage 3D — value path resolver.
 */
import type {
  SemanticProjectionBinding,
  SemanticValuePathBinding,
} from './teta-business-semantics.types';

export type ResolvedValuePath = {
  role: string;
  status: 'resolved' | 'missing' | 'invalid';
  projectionRole: string;
  displayColumnNodeId: string | null;
  displaySourceRole: string | null;
  pathNodeIds: string[];
  pathSummary: string[];
  businessReason: string;
};

export function resolveValuePath(binding: SemanticValuePathBinding | null | undefined): ResolvedValuePath {
  if (!binding || binding.status !== 'approved') {
    return {
      role: binding?.role ?? 'unknown',
      status: 'missing',
      projectionRole: binding?.projectionRole ?? 'unknown',
      displayColumnNodeId: null,
      displaySourceRole: null,
      pathNodeIds: [],
      pathSummary: [],
      businessReason: binding?.businessReason ?? '',
    };
  }

  const pathSummary: string[] = [];
  const pathNodeIds: string[] = [];
  for (const step of binding.steps) {
    if (step.columnNodeId) {
      pathNodeIds.push(step.columnNodeId);
      pathSummary.push(`${step.sourceRole}:${step.columnNodeId.split(':').pop()}`);
    }
    if (step.displayColumnNodeId) {
      pathNodeIds.push(step.displayColumnNodeId);
      pathSummary.push(`${step.sourceRole}:${step.displayColumnNodeId.split(':').pop()}`);
    }
  }
  if (binding.displayColumnNodeId) pathNodeIds.push(binding.displayColumnNodeId);

  const display = binding.displayColumnNodeId;
  const endsOnId =
    !!display &&
    (() => {
      const col = display.split(':').pop()?.toUpperCase() ?? '';
      return col === 'ID' || /_ID$/.test(col);
    })();

  if (!display || endsOnId) {
    return {
      role: binding.role,
      status: 'invalid',
      projectionRole: binding.projectionRole,
      displayColumnNodeId: display,
      displaySourceRole: binding.displaySourceRole,
      pathNodeIds: [...new Set(pathNodeIds)].sort(),
      pathSummary,
      businessReason: binding.businessReason,
    };
  }

  return {
    role: binding.role,
    status: 'resolved',
    projectionRole: binding.projectionRole,
    displayColumnNodeId: display,
    displaySourceRole: binding.displaySourceRole,
    pathNodeIds: [...new Set(pathNodeIds)].sort(),
    pathSummary,
    businessReason: binding.businessReason,
  };
}

/** Apply value-path display column onto a projection binding when present. */
export function applyValuePathToProjection(
  projection: SemanticProjectionBinding,
  valuePath: SemanticValuePathBinding | null | undefined,
): SemanticProjectionBinding {
  const resolved = resolveValuePath(valuePath);
  if (resolved.status !== 'resolved' || !resolved.displayColumnNodeId) return projection;
  return {
    ...projection,
    oracleColumnNodeId: resolved.displayColumnNodeId,
    sourceRole: resolved.displaySourceRole ?? projection.sourceRole,
    viaValuePathRole: valuePath?.role ?? projection.viaValuePathRole ?? null,
  };
}
