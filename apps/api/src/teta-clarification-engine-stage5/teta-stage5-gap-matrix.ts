export type Stage5GapRow = {
  capability: string;
  existingEvidence: string;
  stage5Action: string;
};

export const STAGE5_GAP_MATRIX: Stage5GapRow[] = [
  {
    capability: 'consume Stage 4 result without rediscovery',
    existingEvidence: 'Stage4ResolutionResult',
    stage5Action: 'planClarificationFromStage4',
  },
  {
    capability: 'classify user-resolvable vs technical-only dimensions',
    existingEvidence: 'clarificationDimensions + BindingHypotheses + anchors',
    stage5Action: 'classifyAmbiguityDimensions',
  },
  {
    capability: 'suppress insufficient technical gaps',
    existingEvidence: 'core topology present + missing display/temporal',
    stage5Action: 'technicalGapOnly=true, clarificationRequired=false',
  },
  {
    capability: 'application-language question planner',
    existingEvidence: 'form/tab/module labels from anchors',
    stage5Action: 'planSingleClarificationQuestion',
  },
  {
    capability: 'apply clarification to semantic context only',
    existingEvidence: 'ClarificationAnswer → ClarificationSemanticEffect',
    stage5Action: 'applyClarificationAnswer',
  },
  {
    capability: 'user-facing technical leak prevention',
    existingEvidence: 'leak scanner patterns',
    stage5Action: 'scanUserFacingClarificationLeak',
  },
];
