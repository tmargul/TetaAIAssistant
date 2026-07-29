export type ModelPilotStatus =
  | 'not_requested'
  | 'unavailable'
  | 'completed'
  | 'completed_with_timeouts'
  | 'completed_with_invalid_outputs'
  | 'failed';

export type RuntimeProcessor = 'gpu' | 'cpu' | 'mixed' | 'unknown';

export type NoiseClassificationStatus =
  | 'accepted'
  | 'accepted_with_review'
  | 'suspicious'
  | 'invalid';

export type ModelBudgetConfig = {
  perModelCallTimeoutMs: number;
  modelPilotTotalBudgetMs: number;
  maxModelSections: number;
  maxModelInputCharacters: number;
  maxModelInputEstimatedTokens: number;
  noiseShareReviewThresholdPercent: number;
};

export const DEFAULT_MODEL_BUDGET_CONFIG: ModelBudgetConfig = {
  perModelCallTimeoutMs: 45_000,
  modelPilotTotalBudgetMs: 8 * 60_000,
  maxModelSections: 10,
  maxModelInputCharacters: 4_000,
  maxModelInputEstimatedTokens: 1_200,
  noiseShareReviewThresholdPercent: 40,
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function deriveModelPilotStatus(metrics: {
  requested: boolean;
  available: boolean;
  attempted: number;
  succeeded: number;
  timedOut: number;
  failed: number;
  invalidOutputs: number;
  completedGracefully: boolean;
}): ModelPilotStatus {
  if (!metrics.requested) return 'not_requested';
  if (!metrics.available) return 'unavailable';
  if (!metrics.completedGracefully && metrics.attempted === 0) return 'failed';
  if (!metrics.completedGracefully) return 'failed';
  if (metrics.timedOut > 0) return 'completed_with_timeouts';
  if (metrics.invalidOutputs > 0 || metrics.failed > 0) return 'completed_with_invalid_outputs';
  if (metrics.succeeded > 0 || metrics.attempted === 0) return 'completed';
  return 'completed';
}

export function deriveNoiseClassificationStatus(
  noiseSharePercent: number,
  threshold: number,
): NoiseClassificationStatus {
  if (noiseSharePercent > threshold * 1.5) return 'suspicious';
  if (noiseSharePercent > threshold) return 'accepted_with_review';
  return 'accepted';
}
