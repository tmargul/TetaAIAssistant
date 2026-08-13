/**
 * Test/fixture-only Stage 5 adapter.
 * Proves planning for semantic dimensions that Stage 4 may not yet emit naturally.
 * Must NEVER be used by production request paths.
 */
import type { Stage4ResolutionResult } from '../teta-application-first-evidence-resolver-v2';
import { injectSemanticDimension } from './teta-stage5-classify';
import { planClarificationFromStage4Internal } from './teta-stage5-resolve';
import type {
  ClarificationRequestState,
  Stage5Result,
  UserResolvableDimension,
} from './teta-stage5.types';

export const STAGE5_SEMANTIC_FIXTURE_LABEL = 'semantic_fixture_test_only' as const;

export type Stage5FixturePlanInput = {
  stage4: Stage4ResolutionResult;
  forceSemanticDimension: UserResolvableDimension;
  requestState?: ClarificationRequestState | null;
  originalRequestOverride?: string | null;
  moduleDirForHardcodingScan?: string | null;
  /** Required marker — documents that this is not production discovery. */
  fixtureKind: typeof STAGE5_SEMANTIC_FIXTURE_LABEL;
};

/**
 * Fixture builder for acceptance of Stage 5 planning behavior (e.g. current-vs-history).
 * Does NOT prove Stage 4 naturally discovers the forced dimension.
 */
export function planClarificationFromStage4Fixture(input: Stage5FixturePlanInput): Stage5Result {
  if (input.fixtureKind !== STAGE5_SEMANTIC_FIXTURE_LABEL) {
    throw new Error('planClarificationFromStage4Fixture requires fixtureKind=semantic_fixture_test_only');
  }
  return planClarificationFromStage4Internal({
    stage4: input.stage4,
    requestState: input.requestState,
    originalRequestOverride: input.originalRequestOverride,
    moduleDirForHardcodingScan: input.moduleDirForHardcodingScan,
    testOnly: {
      forceSemanticDimension: input.forceSemanticDimension,
      injectSemanticDimension,
      fixtureKind: STAGE5_SEMANTIC_FIXTURE_LABEL,
    },
  });
}
