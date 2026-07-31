/**
 * Element binding helpers for Stage 3K.2A.
 * Construction lives in the approved Stage 3D adapter; this module keeps the
 * public surface for element-level status / reuse helpers.
 */
export type { TetaSemanticElementBinding } from './teta-generic-semantic-binding.types';
export { isPlanningReadyReuse, resolveApprovalReuse } from './teta-generic-semantic-binding.policy';
