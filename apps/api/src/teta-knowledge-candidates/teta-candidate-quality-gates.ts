import type { KnowledgeCandidateKind, KnowledgeCandidateOccurrenceV1 } from './teta-knowledge-candidate.types';

export const GENERIC_HEADINGS = new Set([
  'wstęp', 'wstep', 'informacje', 'opis', 'uwagi', 'przykład', 'przyklad', 'spis treści', 'spis tresci',
]);

export const GENERIC_TABLE_COLUMNS = new Set([
  'nazwa', 'opis', 'wartość', 'wartosc', 'name', 'description', 'value',
]);

export const WEAK_STATUS_ADJECTIVES = new Set([
  'gotowe', 'nowe', 'aktualne', 'poprawne', 'ok', 'done', 'new',
]);

export type RejectionReasonCode =
  | 'generic_heading'
  | 'generic_table_column'
  | 'weak_status_evidence'
  | 'weak_parameter_evidence'
  | 'weak_business_concept_evidence'
  | 'missing_kind_specific_evidence'
  | 'missing_source_evidence'
  | 'duplicate_within_section'
  | 'unsupported_pattern'
  | 'ambiguous_structure'
  | 'model_schema_rejection';

export type QualityGateCounters = {
  genericHeadingsPromotedToBusinessConcept: number;
  genericTableColumnsPromotedToParameter: number;
  adjectivesPromotedToStatus: number;
  unsupportedNounsPromotedToBusinessConcept: number;
  candidatesWithoutMinimumKindEvidence: number;
  candidatesAcceptedWithoutKindSpecificEvidence: number;
  candidatesDowngradedForWeakEvidence: number;
  candidatesRejectedForWeakEvidence: number;
  forbiddenFixtureCandidatesProduced: number;
  unexpectedFixtureCandidatesProduced: number;
};

export function emptyQualityCounters(): QualityGateCounters {
  return {
    genericHeadingsPromotedToBusinessConcept: 0,
    genericTableColumnsPromotedToParameter: 0,
    adjectivesPromotedToStatus: 0,
    unsupportedNounsPromotedToBusinessConcept: 0,
    candidatesWithoutMinimumKindEvidence: 0,
    candidatesAcceptedWithoutKindSpecificEvidence: 0,
    candidatesDowngradedForWeakEvidence: 0,
    candidatesRejectedForWeakEvidence: 0,
    forbiddenFixtureCandidatesProduced: 0,
    unexpectedFixtureCandidatesProduced: 0,
  };
}

export function isGenericHeadingLabel(label: string): boolean {
  const n = label.trim().toLowerCase().replace(/[:.]+$/, '');
  return GENERIC_HEADINGS.has(n);
}

export function isGenericTableColumnLabel(label: string): boolean {
  const n = label.trim().toLowerCase().replace(/[:.]+$/, '');
  const parts = n.split(/\s*\|\s*/).map((p) => p.trim());
  return parts.every((p) => GENERIC_TABLE_COLUMNS.has(p) || p.length === 0);
}

export function isWeakStatusAdjective(label: string): boolean {
  return WEAK_STATUS_ADJECTIVES.has(label.trim().toLowerCase());
}

export type EvidenceValidationResult = {
  ok: boolean;
  code: string | null;
  action: 'accept' | 'downgrade' | 'reject';
};

export function validateMinimumEvidenceForCandidateKind(
  candidate: Pick<KnowledgeCandidateOccurrenceV1, 'candidateKind' | 'canonicalSubjectProposal' | 'candidateStatement' | 'structuredPayload' | 'evidence'>,
): EvidenceValidationResult {
  if (!candidate.evidence.length) {
    return { ok: false, code: 'missing_evidence', action: 'reject' };
  }
  const label = candidate.canonicalSubjectProposal.label.trim();
  const stmt = candidate.candidateStatement;
  const payload = candidate.structuredPayload ?? {};

  switch (candidate.candidateKind as KnowledgeCandidateKind) {
    case 'business_concept': {
      if (isGenericHeadingLabel(label)) {
        return { ok: false, code: 'generic_heading_as_business_concept', action: 'reject' };
      }
      if (label.length < 3 || /^(i|oraz|the|a|an)$/i.test(label)) {
        return { ok: false, code: 'unsupported_noun_as_business_concept', action: 'reject' };
      }
      const hasDefinition =
        Boolean(payload.definitionPattern)
        || /\b(oznacza|rozumie\s+się|jest)\b/i.test(stmt)
        || Boolean(payload.tableDefinition);
      if (!hasDefinition && stmt.trim().length < 20 && !payload.sectionLabel) {
        return { ok: false, code: 'business_concept_missing_definition', action: 'reject' };
      }
      if (!hasDefinition && stmt.trim().length < 20) {
        return { ok: false, code: 'business_concept_weak_context', action: 'downgrade' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'parameter': {
      if (isGenericTableColumnLabel(label)) {
        return { ok: false, code: 'generic_table_column_as_parameter', action: 'reject' };
      }
      const hasTechnical =
        /\bparametr/i.test(stmt)
        || /\b[A-Z][A-Z0-9_]{2,}\b/.test(stmt)
        || /\b\d{4,6}\b/.test(stmt)
        || /[:=]/.test(stmt)
        || payload.rowIndex != null;
      if (!hasTechnical) {
        return { ok: false, code: 'parameter_missing_config_evidence', action: 'reject' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'status': {
      if (isWeakStatusAdjective(label)) {
        return { ok: false, code: 'adjective_promoted_to_status', action: 'reject' };
      }
      if (!/\b(status|stan)\b/i.test(stmt) && !payload.statusLabel) {
        return { ok: false, code: 'status_missing_process_context', action: 'reject' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'calculation_rule': {
      const hasFormula =
        typeof payload.formulaText === 'string'
        || /=/.test(stmt)
        || (Array.isArray(payload.functionNames) && payload.functionNames.length > 0);
      if (!hasFormula) {
        return { ok: false, code: 'calculation_rule_missing_formula', action: 'reject' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'temporal_rule': {
      if (!/\d{1,4}/.test(stmt) && !payload.dates) {
        return { ok: false, code: 'temporal_rule_missing_date', action: 'reject' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'process_step': {
      if (!payload.stepIndex && !/^\s*(\d+[\).\]]|\-|\*)\s+/.test(stmt)) {
        return { ok: false, code: 'process_step_missing_order', action: 'downgrade' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'procedure': {
      const steps = Number(payload.stepCount ?? 0);
      if (steps < 2 && !/procedur|sposób postępowania|wykonanie|kroki/i.test(stmt)) {
        return { ok: false, code: 'procedure_missing_steps', action: 'reject' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'business_process': {
      if (!payload.hasInput && !payload.hasOutcome && !/wejście|wynik procesu|warunek:/i.test(stmt)) {
        return { ok: false, code: 'business_process_missing_structure', action: 'reject' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'action': {
      if (!payload.actionVerb && !/\b(wybierz|otwórz|dodaj|zatwierdź|oblicz|wygeneruj|zarejestruj)\b/i.test(stmt)) {
        return { ok: false, code: 'action_missing_verb', action: 'reject' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'state_transition': {
      if (!payload.fromStatus && !payload.toStatus && !/zmienia\s+się\s+na|z\s+.+\s+do\s+/i.test(stmt)) {
        return { ok: false, code: 'state_transition_missing_states', action: 'reject' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'validation_rule': {
      if (!/\b(nie można|musi|wymagane|dopuszczalne tylko|nie może przekraczać)\b/i.test(stmt)) {
        return { ok: false, code: 'validation_rule_missing_constraint', action: 'reject' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'test_case': {
      const hasParts =
        Boolean(payload.hasInputData)
        || Boolean(payload.hasExpectedResult)
        || /dane wejściowe|oczekiwany wynik|przypadek testowy/i.test(stmt);
      if (!hasParts) {
        return { ok: false, code: 'test_case_missing_structure', action: 'reject' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'technical_relation': {
      if (
        !payload.relationType
        && !/korzysta z|mapowane na|zawiera kolumn|rejestrowany w|odwołuje się/i.test(stmt)
      ) {
        return { ok: false, code: 'technical_relation_missing_link', action: 'reject' };
      }
      return { ok: true, code: null, action: 'accept' };
    }
    case 'document_type':
    case 'integration':
    case 'warning':
    case 'scenario':
    case 'eligibility_rule':
    case 'exception':
      return { ok: true, code: null, action: 'accept' };
    default:
      return { ok: true, code: null, action: 'accept' };
  }
}

function reasonFromCode(code: string | null): RejectionReasonCode {
  switch (code) {
    case 'generic_heading_as_business_concept':
      return 'generic_heading';
    case 'generic_table_column_as_parameter':
      return 'generic_table_column';
    case 'adjective_promoted_to_status':
    case 'status_missing_process_context':
      return 'weak_status_evidence';
    case 'parameter_missing_config_evidence':
      return 'weak_parameter_evidence';
    case 'unsupported_noun_as_business_concept':
    case 'business_concept_weak_context':
    case 'business_concept_missing_definition':
      return 'weak_business_concept_evidence';
    case 'missing_evidence':
      return 'missing_source_evidence';
    default:
      return 'missing_kind_specific_evidence';
  }
}

export function applyQualityGates(
  candidates: KnowledgeCandidateOccurrenceV1[],
): {
  accepted: KnowledgeCandidateOccurrenceV1[];
  counters: QualityGateCounters;
  rejectedByReason: Record<string, number>;
} {
  const counters = emptyQualityCounters();
  const accepted: KnowledgeCandidateOccurrenceV1[] = [];
  const rejectedByReason: Record<string, number> = {};
  for (const c of candidates) {
    const v = validateMinimumEvidenceForCandidateKind(c);
    if (v.action === 'reject') {
      counters.candidatesRejectedForWeakEvidence += 1;
      counters.candidatesWithoutMinimumKindEvidence += 1;
      if (v.code === 'generic_heading_as_business_concept') counters.genericHeadingsPromotedToBusinessConcept += 1;
      if (v.code === 'generic_table_column_as_parameter') counters.genericTableColumnsPromotedToParameter += 1;
      if (v.code === 'adjective_promoted_to_status') counters.adjectivesPromotedToStatus += 1;
      if (v.code === 'unsupported_noun_as_business_concept') counters.unsupportedNounsPromotedToBusinessConcept += 1;
      const reason = reasonFromCode(v.code);
      rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1;
      continue;
    }
    if (v.action === 'downgrade') {
      counters.candidatesDowngradedForWeakEvidence += 1;
      accepted.push({
        ...c,
        status: 'requires_review',
        warnings: [...c.warnings, v.code ?? 'weak_evidence'],
      });
      continue;
    }
    accepted.push(c);
  }
  return { accepted, counters, rejectedByReason };
}

export type FixtureExpectation = {
  sourceId: string;
  requiredKinds?: KnowledgeCandidateKind[];
  forbiddenKinds?: KnowledgeCandidateKind[];
  forbiddenLabels?: string[];
  allowedCandidateKinds?: KnowledgeCandidateKind[];
  maximumUnexpectedCandidates?: number;
};

export function evaluateFixtureExpectations(
  occurrences: KnowledgeCandidateOccurrenceV1[],
  expectations: FixtureExpectation[],
): {
  forbiddenFixtureCandidatesProduced: number;
  unexpectedFixtureCandidatesProduced: number;
  details: Array<{ sourceId: string; ok: boolean; issues: string[] }>;
} {
  let forbidden = 0;
  let unexpected = 0;
  const details: Array<{ sourceId: string; ok: boolean; issues: string[] }> = [];
  for (const exp of expectations) {
    const items = occurrences.filter((c) => c.logicalSourceId === exp.sourceId);
    const issues: string[] = [];
    for (const kind of exp.requiredKinds ?? []) {
      if (!items.some((c) => c.candidateKind === kind)) issues.push(`missing_required_kind:${kind}`);
    }
    for (const kind of exp.forbiddenKinds ?? []) {
      const hits = items.filter((c) => c.candidateKind === kind);
      forbidden += hits.length;
      if (hits.length) issues.push(`forbidden_kind:${kind}`);
    }
    for (const label of exp.forbiddenLabels ?? []) {
      const hits = items.filter((c) => c.canonicalSubjectProposal.normalizedLabel === label.toLowerCase());
      forbidden += hits.length;
      if (hits.length) issues.push(`forbidden_label:${label}`);
    }
    if (exp.allowedCandidateKinds) {
      const allowed = new Set(exp.allowedCandidateKinds);
      const bad = items.filter((c) => !allowed.has(c.candidateKind));
      unexpected += bad.length;
      if (bad.length) issues.push(`unexpected_kinds:${bad.map((c) => c.candidateKind).join(',')}`);
    }
    if (exp.maximumUnexpectedCandidates != null && unexpected > exp.maximumUnexpectedCandidates) {
      issues.push(`too_many_unexpected:${unexpected}`);
    }
    details.push({ sourceId: exp.sourceId, ok: issues.length === 0, issues });
  }
  return {
    forbiddenFixtureCandidatesProduced: forbidden,
    unexpectedFixtureCandidatesProduced: unexpected,
    details,
  };
}

export const DEFAULT_FIXTURE_EXPECTATIONS: FixtureExpectation[] = [
  {
    sourceId: 'document:fixture-a-payroll',
    requiredKinds: ['process_step', 'calculation_rule'],
    forbiddenLabels: ['wstęp', 'informacje', 'opis', 'uwagi', 'przykład'],
  },
  {
    sourceId: 'document:fixture-b-edu',
    requiredKinds: ['process_step', 'status'],
    forbiddenKinds: [],
  },
  {
    sourceId: 'document:fixture-c-year',
    requiredKinds: ['temporal_rule'],
  },
  {
    sourceId: 'document:fixture-d-ksef',
    forbiddenLabels: ['nazwa', 'opis', 'wartość'],
  },
  {
    sourceId: 'document:fixture-g-dup',
    forbiddenLabels: ['wstęp', 'gotowe', 'nowe'],
  },
  {
    sourceId: 'document:fixture-table',
    requiredKinds: ['parameter'],
    forbiddenLabels: ['nazwa', 'opis', 'wartość'],
  },
  {
    sourceId: 'document:fixture-blocked-legacy',
    maximumUnexpectedCandidates: 0,
  },
];
