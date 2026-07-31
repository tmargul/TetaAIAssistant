/**
 * Audit-only evidence trace helpers for Stage 3K.2A.
 * Traces are built inside the approved adapter and must not be merged into
 * runtime/client DTOs.
 */
export type { TetaSemanticEvidenceTrace } from './teta-generic-semantic-binding.types';
export type { GraphEvidenceValidator } from './teta-generic-semantic-binding.types';
export {
  collectBindingNodeIdsFromConfigs,
  createPassthroughGraphValidator,
} from './teta-stage3k2a-audit';
