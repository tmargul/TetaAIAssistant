export type EmptyModelOutputReason =
  | 'section_has_insufficient_explicit_evidence'
  | 'section_contains_only_metadata'
  | 'section_too_fragmentary'
  | 'model_prompt_overconstrained'
  | 'model_failed_to_extract_expected_explicit_structure'
  | 'parser_removed_invalid_candidates'
  | 'unknown';

export type ModelUsefulnessStatus =
  | 'useful'
  | 'partially_useful'
  | 'insufficient_signal'
  | 'not_evaluable';

export type EmptyModelDiagnosis = {
  sectionId: string;
  reason: EmptyModelOutputReason;
  informative: boolean;
  expectedKinds: string[];
  foundKinds: string[];
};

export function diagnoseEmptyModelOutput(input: {
  sectionId: string;
  sectionText: string;
  sectionTitle: string | null;
  deterministicKinds: string[];
  modelCandidateCount: number;
  parserRemovedCount: number;
  expectedKinds?: string[];
}): EmptyModelDiagnosis {
  const text = input.sectionText.trim();
  const expected = input.expectedKinds ?? [];
  const found: string[] = [];
  const hasExplicitStructure =
    /^\s*\d+[\).\]]/m.test(text)
    || /\boznacza\b|\brozumie\s+się\b/i.test(text)
    || /[A-Z0-9_]+\s*=/.test(text)
    || /oczekiwany wynik|parametr|procedura/i.test(text)
    || input.deterministicKinds.some((k) =>
      ['procedure', 'process_step', 'calculation_rule', 'validation_rule', 'test_case'].includes(k),
    );

  if (input.parserRemovedCount > 0 && input.modelCandidateCount === 0) {
    return {
      sectionId: input.sectionId,
      reason: 'parser_removed_invalid_candidates',
      informative: hasExplicitStructure,
      expectedKinds: expected,
      foundKinds: found,
    };
  }

  if (text.length < 40) {
    return {
      sectionId: input.sectionId,
      reason: 'section_too_fragmentary',
      informative: false,
      expectedKinds: expected,
      foundKinds: found,
    };
  }

  if (/metadata|tylko metadane|brak treści/i.test(text) && text.length < 120) {
    return {
      sectionId: input.sectionId,
      reason: 'section_contains_only_metadata',
      informative: false,
      expectedKinds: expected,
      foundKinds: found,
    };
  }

  if (hasExplicitStructure && input.modelCandidateCount === 0) {
    return {
      sectionId: input.sectionId,
      reason: 'model_failed_to_extract_expected_explicit_structure',
      informative: true,
      expectedKinds: expected.length ? expected : input.deterministicKinds,
      foundKinds: found,
    };
  }

  if (!hasExplicitStructure) {
    return {
      sectionId: input.sectionId,
      reason: 'section_has_insufficient_explicit_evidence',
      informative: false,
      expectedKinds: expected,
      foundKinds: found,
    };
  }

  return {
    sectionId: input.sectionId,
    reason: 'unknown',
    informative: hasExplicitStructure,
    expectedKinds: expected,
    foundKinds: found,
  };
}

export function deriveModelUsefulnessStatus(input: {
  attempted: number;
  succeeded: number;
  acceptedCandidates: number;
  validEmptyOutputs: number;
  informativeEmptyFailures: number;
  timedOut: number;
}): ModelUsefulnessStatus {
  if (input.attempted === 0) return 'not_evaluable';
  if (input.acceptedCandidates > 0 && input.informativeEmptyFailures === 0) return 'useful';
  if (input.acceptedCandidates > 0) return 'partially_useful';
  if (input.succeeded > 0 && input.validEmptyOutputs === input.succeeded && input.informativeEmptyFailures > 0) {
    return 'insufficient_signal';
  }
  if (input.succeeded > 0 && input.acceptedCandidates === 0) return 'insufficient_signal';
  return 'not_evaluable';
}
