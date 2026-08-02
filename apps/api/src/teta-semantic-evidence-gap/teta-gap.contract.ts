import {
  STAGE3K2B2A_CONTRACT_VERSION,
  type ApplicationContextOrigin,
  type HumanDomainEvidenceRequest,
  type Stage3k2b2aSafetyCounters,
  type TetaApplicationContextAnchor,
  type TetaSemanticEvidenceGap,
  emptySafetyCounters,
} from './teta-gap.types';

const ORACLE_MAPPING_RE =
  /\b(tabela|kolumna|table|column|foreign\s*key|\bfk\b|join|oracle\s*mapping|NT_[A-Z0-9_]+)\b/i;

export function createApplicationContextAnchor(
  input: Omit<TetaApplicationContextAnchor, 'contractVersion' | 'isSemanticBinding' | 'claimsDatabaseMapping'> & {
    claimsDatabaseMapping?: boolean;
  },
): TetaApplicationContextAnchor {
  return {
    contractVersion: STAGE3K2B2A_CONTRACT_VERSION,
    isSemanticBinding: false,
    claimsDatabaseMapping: input.claimsDatabaseMapping ?? false,
    ...input,
  };
}

export function validateApplicationContextAnchor(anchor: TetaApplicationContextAnchor): string[] {
  const errors: string[] = [];
  if (anchor.contractVersion !== STAGE3K2B2A_CONTRACT_VERSION) {
    errors.push('anchor_version_mismatch');
  }
  if (anchor.isSemanticBinding !== false) errors.push('anchor_must_not_be_semantic_binding');
  if (anchor.claimsDatabaseMapping) errors.push('anchor_must_not_claim_database_mapping');
  if (!anchor.anchorId) errors.push('missing:anchorId');
  if (!anchor.origin) errors.push('missing:origin');
  if (anchor.origin === 'screenshot_context' && anchor.claimsDatabaseMapping) {
    errors.push('screenshot_must_not_claim_db_mapping');
  }
  return errors;
}

export type AppContextFixtureId = 'A' | 'B' | 'C' | 'D' | 'E';

export interface AppContextFixtureResult {
  id: AppContextFixtureId;
  ok: boolean;
  anchor: TetaApplicationContextAnchor;
  notes: string[];
  countersDelta: Partial<Stage3k2b2aSafetyCounters>;
}

export function buildApplicationContextFixtures(): AppContextFixtureResult[] {
  const A = createApplicationContextAnchor({
    anchorId: 'anchor:fixture:A',
    origin: 'known_form_context',
    productFamily: 'teta_hr',
    productSurface: 'teta_desktop',
    formId: 'form:known-employee-card',
    formLabel: 'Kartoteka pracownika',
    controlId: 'control:employee-number',
    controlLabel: 'Numer ewidencyjny',
    selectionRequired: false,
  });

  const B = createApplicationContextAnchor({
    anchorId: 'anchor:fixture:B',
    origin: 'user_question',
    productFamily: 'teta_hr',
    productSurface: 'teta_desktop',
    formLabel: 'Kartoteka pracownika',
    formId: 'form:known-employee-card',
    controlLabel: 'Numer ewidencyjny',
    controlId: 'control:employee-number',
    selectionRequired: false,
    recognizedText: 'Jakie stanowisko ma pracownik 00122?',
  });

  const C = createApplicationContextAnchor({
    anchorId: 'anchor:fixture:C',
    origin: 'screenshot_context',
    productFamily: 'teta_hr',
    productSurface: 'teta_desktop',
    formId: 'form:known-employee-card',
    formLabel: 'Kartoteka pracownika',
    controlId: 'control:employee-number',
    controlLabel: 'Numer ewidencyjny',
    recognizedText: 'Numer ewidencyjny',
    recognitionConfidence: 0.92,
    selectionRequired: false,
  });

  const D = createApplicationContextAnchor({
    anchorId: 'anchor:fixture:D',
    origin: 'screenshot_context',
    productFamily: 'teta_hr',
    productSurface: 'teta_desktop',
    recognizedText: 'Stanowisko',
    recognitionConfidence: 0.41,
    selectionRequired: true,
  });

  const E = createApplicationContextAnchor({
    anchorId: 'anchor:fixture:E',
    origin: 'screenshot_context',
    recognizedText: 'NR_EWIDENCYJNY',
    recognitionConfidence: 0.55,
    selectionRequired: true,
  });

  return [
    {
      id: 'A',
      ok: validateApplicationContextAnchor(A).length === 0 && !!A.formId && !!A.controlId,
      anchor: A,
      notes: ['known_form_context_resolved'],
      countersDelta: {},
    },
    {
      id: 'B',
      ok: validateApplicationContextAnchor(B).length === 0 && !!B.formId && !B.selectionRequired,
      anchor: B,
      notes: ['user_question_form_label_resolved_deterministically'],
      countersDelta: {},
    },
    {
      id: 'C',
      ok:
        validateApplicationContextAnchor(C).length === 0 &&
        C.origin === 'screenshot_context' &&
        C.claimsDatabaseMapping === false,
      anchor: C,
      notes: ['screenshot_anchor_only_no_db_mapping'],
      countersDelta: {},
    },
    {
      id: 'D',
      ok: D.selectionRequired === true && validateApplicationContextAnchor(D).length === 0,
      anchor: D,
      notes: ['ambiguous_screenshot_requires_selection'],
      countersDelta: {},
    },
    {
      id: 'E',
      ok:
        E.selectionRequired === true &&
        E.claimsDatabaseMapping === false &&
        !E.formId &&
        validateApplicationContextAnchor(E).length === 0,
      anchor: E,
      notes: ['screen_text_column_like_no_free_column_binding'],
      countersDelta: { screenTextMappedDirectlyToDatabase: 0, columnNameOnlyBindingsCreated: 0 },
    },
  ];
}

export function validateGap(gap: TetaSemanticEvidenceGap): string[] {
  const errors: string[] = [];
  if (gap.contractVersion !== STAGE3K2B2A_CONTRACT_VERSION) errors.push('gap_version_mismatch');
  if (!gap.gapId) errors.push('missing:gapId');
  if (!gap.candidateId) errors.push('missing:candidateId');
  if (!gap.gapType) errors.push('missing:gapType');
  if (!gap.humanExpertiseMode) errors.push('missing:humanExpertiseMode');
  if ((gap as { humanExpertiseRequired?: unknown }).humanExpertiseRequired !== undefined) {
    errors.push('humanExpertiseRequired_boolean_forbidden');
  }
  return errors;
}

export function humanQuestionAsksForOracleMapping(q: string): boolean {
  return ORACLE_MAPPING_RE.test(q);
}

export function assertHumanRequestSafe(req: HumanDomainEvidenceRequest): string[] {
  const errors: string[] = [];
  if (req.asksForOracleMapping !== false) errors.push('asksForOracleMapping_must_be_false');
  if (humanQuestionAsksForOracleMapping(req.preciseQuestion)) {
    errors.push('preciseQuestion_asks_oracle_mapping');
  }
  if (!req.offlineCollectorsCompleted?.length) {
    errors.push('offlineCollectorsCompleted_empty');
  }
  return errors;
}

export function mergeCounters(
  base: Stage3k2b2aSafetyCounters,
  delta: Partial<Stage3k2b2aSafetyCounters>,
): Stage3k2b2aSafetyCounters {
  const out = { ...base };
  for (const [k, v] of Object.entries(delta)) {
    const key = k as keyof Stage3k2b2aSafetyCounters;
    out[key] = (out[key] ?? 0) + (v as number);
  }
  return out;
}

export function assertStrictZeros(counters: Stage3k2b2aSafetyCounters): string[] {
  const errors: string[] = [];
  for (const [k, v] of Object.entries(counters)) {
    if (v !== 0) errors.push(`strict_nonzero:${k}=${v}`);
  }
  return errors;
}

export function isAllowedCollectorStart(start: {
  kind:
    | 'application_context_anchor'
    | 'candidate_anchor'
    | 'stage3d_prior_evidence_ref'
    | 'unresolved_dependency'
    | 'coverage_target';
}): boolean {
  return !!start.kind;
}

export const ALLOWED_ORIGINS: ApplicationContextOrigin[] = [
  'user_question',
  'application_context',
  'screenshot_context',
  'known_form_context',
];

export { emptySafetyCounters };
