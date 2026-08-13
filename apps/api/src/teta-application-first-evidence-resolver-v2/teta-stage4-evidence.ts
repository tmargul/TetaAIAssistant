/**
 * Legacy evidence helpers — NO production scenario-specific physical builders.
 * Kept for unit-test fixtures and hardcoding scan surface area reduction.
 */
export { resolveApplicationAnchors } from './teta-stage4-anchors';
export { traverseApplicationGraph } from './teta-stage4-ace-traverse';
export { expandOracleEvidence } from './teta-stage4-oracle-expand';

/**
 * @deprecated Scenario-specific builders removed.
 * Production must use resolveApplicationFirstEvidence generic pipeline.
 */
export async function buildApplicationFirstEvidence(_input: {
  repoRoot: string;
  businessConcept: string;
  mode: 'approved_binding_reuse' | 'blind_physical_rediscovery';
}): Promise<never> {
  throw new Error(
    'buildApplicationFirstEvidence removed — use resolveApplicationFirstEvidence (generic pipeline)',
  );
}
