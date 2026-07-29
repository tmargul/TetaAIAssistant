import type { ContentUnitV1 } from '../teta-source-extraction/teta-canonical-source.types';
import { STAGE3J2C_EXTRACTOR_VERSION } from './teta-topic-section.types';
import type { TopicSectionV1 } from './teta-topic-section.types';
import {
  buildCandidateOccurrenceId,
  computeCandidateSignatureSha256,
  normalizeCandidateLabel,
} from './teta-knowledge-candidate-contract';
import type {
  CandidateApplicability,
  KnowledgeCandidateKind,
  KnowledgeCandidateOccurrenceV1,
} from './teta-knowledge-candidate.types';
import {
  isGenericHeadingLabel,
  isGenericTableColumnLabel,
  isWeakStatusAdjective,
  type QualityGateCounters,
} from './teta-candidate-quality-gates';
import {
  applyGatesWithProposalAccounting,
  emptyProposalAccounting,
  exactCollapseWithinSection,
  type ProposalAccounting,
} from './teta-candidate-proposal-accounting';

const STEP_LIST = /^\s*(\d+[\).\]]|\-|\*)\s+/m;
const FORMULA_PATTERN = /\b([A-Z][A-Z0-9_]*)\s*\(/g;
const COMPONENT_CODE = /\b(\d{4,6})\b/g;
const STATUS_WORDS = /\b(status|stan)\s*[:\-]?\s*([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż][\w\s]{2,40})/gi;
const DATE_PATTERN = /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g;
const EXPLICIT_SECTION_LABELS =
  /^(Warunki wstępne|Warunki wstepne|Kroki|Oczekiwany wynik|Uwagi|Ostrzeżenia|Scenariusz|Przypadek|Konfiguracja|Parametry|Korekta|Procedura|Sposób postępowania|Wykonanie)\b/i;
const ACTION_VERBS =
  /\b(wybierz|otwórz|dodaj|zatwierdź|oblicz|wygeneruj|zarejestruj|ustaw|utwórz|sprawdź)\b/gi;
const DEFINITION_PATTERNS = [
  /^(.{3,80}?)\s+oznacza\s+(.+)$/im,
  /^([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż][\w.\-]{2,60})\s+jest\s+(obiektem|pojęciem|składnikiem|statusem|parametrem|formularzem|raportem|typem)\b(.+)$/im,
  /przez\s+(.{3,60}?)\s+rozumie\s+się\s+(.+)/im,
];

function defaultApplicability(section: TopicSectionV1): CandidateApplicability {
  return {
    platformId: 'teta_platform',
    productFamilyIds: [...section.classificationHints.productFamilyIds],
    productSurfaceIds: [...section.classificationHints.productSurfaceIds],
    domainIds: [...section.classificationHints.domainIds],
    businessAreaIds: [...section.classificationHints.businessAreaIds],
    productVersionHints: [...section.applicability.productVersionHints],
    documentDateHints: [...section.applicability.documentDateHints],
    scopeStatus: section.applicability.scopeStatus,
    currentnessStatus: section.applicability.currentnessStatus,
    clientSpecificRisk: section.applicability.clientSpecificRisk,
  };
}

function baseCandidate(
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  kind: KnowledgeCandidateKind,
  localIndex: number,
  fields: Partial<KnowledgeCandidateOccurrenceV1>,
): KnowledgeCandidateOccurrenceV1 {
  const label = fields.canonicalSubjectProposal?.label ?? kind;
  const partial: KnowledgeCandidateOccurrenceV1 = {
    contractVersion: 'teta-knowledge-candidate-v1',
    candidateOccurrenceId: '',
    candidateSignatureSha256: '',
    candidateKind: kind,
    status: fields.status ?? 'candidate',
    canonicalSubjectProposal: {
      label,
      normalizedLabel: normalizeCandidateLabel(label),
      proposedCanonicalKey: null,
    },
    predicate: fields.predicate ?? kind,
    object: fields.object ?? null,
    candidateStatement: fields.candidateStatement ?? label,
    structuredPayload: fields.structuredPayload ?? {},
    applicability: fields.applicability ?? defaultApplicability(section),
    evidence: fields.evidence ?? [{
      sectionId: section.sectionId,
      contentUnitRefs: [...section.contentUnitRefs],
      assetRefs: [...section.assetRefs],
      evidenceStrength: 'explicit_statement',
    }],
    correlationHints: fields.correlationHints ?? {
      formLabels: [],
      fieldLabels: [],
      actionLabels: [],
      statusLabels: [],
      parameterNames: [],
      componentCodes: [],
      functionNames: [],
      oracleIdentifiers: [],
      helpSearchTerms: [],
    },
    extraction: {
      method: 'deterministic',
      extractorVersion: STAGE3J2C_EXTRACTOR_VERSION,
      modelRunId: null,
    },
    warnings: fields.warnings ?? [],
    logicalSourceId: source.logicalSourceId,
    sourceRevisionId: source.sourceRevisionId,
    sectionId: section.sectionId,
  };
  partial.candidateSignatureSha256 = computeCandidateSignatureSha256(partial);
  partial.candidateOccurrenceId = buildCandidateOccurrenceId(
    source.sourceRevisionId,
    section.sectionId,
    kind,
    localIndex,
  );
  return partial;
}

function sectionText(units: ContentUnitV1[], section: TopicSectionV1): string {
  const set = new Set(section.contentUnitRefs);
  return units.filter((u) => set.has(u.contentUnitId)).map((u) => u.text).join('\n');
}

function extractBusinessConcepts(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const out: KnowledgeCandidateOccurrenceV1[] = [];
  for (const re of DEFINITION_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
      const term = m[1].trim().replace(/^[-*]\s*/, '');
      if (isGenericHeadingLabel(term) || term.length < 3) continue;
      out.push(
        baseCandidate(section, source, 'business_concept', startIdx + out.length, {
          canonicalSubjectProposal: {
            label: term.slice(0, 120),
            normalizedLabel: normalizeCandidateLabel(term),
            proposedCanonicalKey: null,
          },
          candidateStatement: m[0].trim().slice(0, 800),
          structuredPayload: { definitionPattern: true, definition: m[2]?.trim().slice(0, 400) },
        }),
      );
    }
  }
  return out;
}

function extractSteps(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const lines = text.split('\n').filter((l) => STEP_LIST.test(l));
  const out = lines.map((line, i) =>
    baseCandidate(section, source, 'process_step', startIdx + i, {
      canonicalSubjectProposal: {
        label: line.replace(STEP_LIST, '').trim().slice(0, 120),
        normalizedLabel: '',
        proposedCanonicalKey: null,
      },
      candidateStatement: line.trim(),
      structuredPayload: { stepIndex: i + 1, stepText: line.trim() },
      evidence: [{
        sectionId: section.sectionId,
        contentUnitRefs: section.contentUnitRefs,
        assetRefs: section.assetRefs,
        evidenceStrength: 'explicit_statement',
      }],
    }),
  );

  const hasProcedureHeading =
    /^(Procedura|Sposób postępowania|Wykonanie|Kroki)\b/im.test(text)
    || section.headingPath.some((h) => /procedura|sposób postępowania|wykonanie|kroki/i.test(h))
    || /procedura\s*:/i.test(section.title ?? '');

  if (lines.length >= 2 && (hasProcedureHeading || /procedura:/i.test(text) || lines.length >= 2)) {
    out.unshift(
      baseCandidate(section, source, 'procedure', startIdx + 1000, {
        canonicalSubjectProposal: {
          label: section.title ?? 'Procedura',
          normalizedLabel: normalizeCandidateLabel(section.title ?? 'procedura'),
          proposedCanonicalKey: null,
        },
        candidateStatement: lines.join('\n').slice(0, 800),
        structuredPayload: {
          stepCount: lines.length,
          procedureHeading: hasProcedureHeading,
          stepEvidence: lines.slice(0, 10),
        },
      }),
    );
  }
  return out;
}

function extractBusinessProcess(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const hasInput = /wejście\s*:|warunek\s*:/i.test(text);
  const hasOutcome = /wynik procesu|stan końcowy|wynik\s*:/i.test(text);
  const steps = text.split('\n').filter((l) => STEP_LIST.test(l));
  const titledProcess = /proces\b/i.test(section.title ?? '') || /proces\b/i.test(text.split('\n')[0] ?? '');
  if (!(titledProcess && hasInput && steps.length >= 2 && hasOutcome)) return [];
  return [
    baseCandidate(section, source, 'business_process', startIdx, {
      canonicalSubjectProposal: {
        label: section.title ?? 'Proces biznesowy',
        normalizedLabel: normalizeCandidateLabel(section.title ?? 'proces'),
        proposedCanonicalKey: null,
      },
      candidateStatement: text.slice(0, 800),
      structuredPayload: { hasInput, hasOutcome, stepCount: steps.length },
    }),
  ];
}

function extractActions(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const out: KnowledgeCandidateOccurrenceV1[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(
      /\b(wybierz|otwórz|dodaj|zatwierdź|oblicz|wygeneruj|zarejestruj|ustaw|utwórz)\b(.{0,80})/i,
    );
    if (!m) continue;
    const object = m[2].trim().replace(/^[:\-\s]+/, '').slice(0, 80);
    if (!object || object.length < 3) continue;
    out.push(
      baseCandidate(section, source, 'action', startIdx + out.length, {
        canonicalSubjectProposal: {
          label: `${m[1]} ${object}`.slice(0, 120),
          normalizedLabel: normalizeCandidateLabel(`${m[1]} ${object}`),
          proposedCanonicalKey: null,
        },
        candidateStatement: line.trim().slice(0, 400),
        structuredPayload: { actionVerb: m[1].toLowerCase(), actionObject: object },
        correlationHints: {
          formLabels: /formularz/i.test(line) ? [object] : [],
          fieldLabels: [],
          actionLabels: [m[1].toLowerCase()],
          statusLabels: [],
          parameterNames: [],
          componentCodes: [],
          functionNames: [],
          oracleIdentifiers: [],
          helpSearchTerms: [],
        },
      }),
    );
  }
  return out;
}

function extractStateTransitions(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const out: KnowledgeCandidateOccurrenceV1[] = [];
  const patterns = [
    /po\s+zatwierdzeniu\s+status\s+zmienia\s+się\s+na\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż][\w\s]{2,40})/gi,
    /status\s+zmienia\s+się\s+na\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż][\w\s]{2,40})/gi,
    /z\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż][\w]{2,30})\s+do\s+([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż][\w]{2,30})/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const toStatus = (m[2] ?? m[1]).trim();
      const fromStatus = m[2] ? m[1].trim() : null;
      if (isWeakStatusAdjective(toStatus)) continue;
      out.push(
        baseCandidate(section, source, 'state_transition', startIdx + out.length, {
          canonicalSubjectProposal: {
            label: fromStatus ? `${fromStatus} → ${toStatus}` : `→ ${toStatus}`,
            normalizedLabel: normalizeCandidateLabel(toStatus),
            proposedCanonicalKey: null,
          },
          candidateStatement: m[0].trim(),
          structuredPayload: { fromStatus, toStatus },
          correlationHints: {
            formLabels: [],
            fieldLabels: [],
            actionLabels: [],
            statusLabels: [toStatus, ...(fromStatus ? [fromStatus] : [])],
            parameterNames: [],
            componentCodes: [],
            functionNames: [],
            oracleIdentifiers: [],
            helpSearchTerms: [],
          },
        }),
      );
    }
  }
  return out;
}

function extractValidationRules(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const out: KnowledgeCandidateOccurrenceV1[] = [];
  for (const line of text.split('\n')) {
    if (!/\b(nie można|musi|wymagane|dopuszczalne tylko|wartość nie może przekraczać|nie może przekraczać)\b/i.test(line)) {
      continue;
    }
    // "należy" alone is not enough — skip soft recommendations
    if (/^\s*należy\b/i.test(line) && !/\b(musi|nie można|wymagane)\b/i.test(line)) continue;
    out.push(
      baseCandidate(section, source, 'validation_rule', startIdx + out.length, {
        canonicalSubjectProposal: {
          label: line.trim().slice(0, 100),
          normalizedLabel: normalizeCandidateLabel(line.trim().slice(0, 100)),
          proposedCanonicalKey: null,
        },
        candidateStatement: line.trim().slice(0, 500),
        structuredPayload: { constraintText: line.trim() },
      }),
    );
  }
  return out;
}

function extractTestCases(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const hasInput = /dane wejściowe|warunki wstępne|konfiguracja parametru/i.test(text);
  const hasSteps = STEP_LIST.test(text) || /kroki/i.test(text);
  const hasExpected = /oczekiwany wynik/i.test(text);
  const explicit = /przypadek testowy|test case|scenariusz testowy/i.test(text);
  if (!(explicit || (hasInput && hasSteps && hasExpected))) return [];
  return [
    baseCandidate(section, source, 'test_case', startIdx, {
      canonicalSubjectProposal: {
        label: 'Przypadek testowy',
        normalizedLabel: 'przypadek testowy',
        proposedCanonicalKey: null,
      },
      candidateStatement: text.slice(0, 800),
      structuredPayload: {
        hasInputData: hasInput,
        hasSteps,
        hasExpectedResult: hasExpected,
      },
    }),
  ];
}

function extractTechnicalRelations(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const out: KnowledgeCandidateOccurrenceV1[] = [];
  const patterns: Array<{ re: RegExp; type: string }> = [
    { re: /formularz\s+korzysta\s+z\s+(obiektu\s+)?([A-Za-z][\w.]{2,60})/gi, type: 'form_uses_object' },
    { re: /pole\s+jest\s+mapowane\s+na\s+(.{3,80})/gi, type: 'field_mapped_to' },
    { re: /dataset\s+zawiera\s+kolumn[ęe]\s+(.{3,60})/gi, type: 'dataset_column' },
    { re: /raport\s+jest\s+rejestrowany\s+w\s+(.{3,60})/gi, type: 'report_registered_in' },
    { re: /funkcja\s+odwołuje\s+się\s+do\s+(.{3,60})/gi, type: 'function_references' },
  ];
  for (const { re, type } of patterns) {
    for (const m of text.matchAll(re)) {
      const target = (m[2] ?? m[1]).trim();
      out.push(
        baseCandidate(section, source, 'technical_relation', startIdx + out.length, {
          canonicalSubjectProposal: {
            label: `${type}: ${target}`.slice(0, 120),
            normalizedLabel: normalizeCandidateLabel(target),
            proposedCanonicalKey: null,
          },
          candidateStatement: m[0].trim(),
          structuredPayload: { relationType: type, target },
          correlationHints: {
            formLabels: type === 'form_uses_object' ? [target] : [],
            fieldLabels: type === 'field_mapped_to' ? [target] : [],
            actionLabels: [],
            statusLabels: [],
            parameterNames: [],
            componentCodes: [],
            functionNames: [],
            oracleIdentifiers: [],
            helpSearchTerms: [target],
          },
        }),
      );
    }
  }
  return out;
}

function extractDocumentAndIntegration(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const out: KnowledgeCandidateOccurrenceV1[] = [];
  if (/dokument\s+faktury|typ\s+dokumentu|e-faktur/i.test(text)) {
    out.push(
      baseCandidate(section, source, 'document_type', startIdx + out.length, {
        canonicalSubjectProposal: {
          label: 'Dokument faktury / e-faktura',
          normalizedLabel: 'dokument faktury',
          proposedCanonicalKey: null,
        },
        candidateStatement: text.match(/[^\n]*dokument[^\n]*/i)?.[0]?.slice(0, 400) ?? text.slice(0, 400),
        structuredPayload: { documentHint: true },
      }),
    );
  }
  if (/integracja\s+z|integracja\s+KSeF/i.test(text) || /integracja/i.test(section.title ?? '')) {
    out.push(
      baseCandidate(section, source, 'integration', startIdx + out.length, {
        canonicalSubjectProposal: {
          label: section.title ?? 'Integracja',
          normalizedLabel: normalizeCandidateLabel(section.title ?? 'integracja'),
          proposedCanonicalKey: null,
        },
        candidateStatement: text.match(/[^\n]*integracj[^\n]*/i)?.[0]?.slice(0, 400) ?? text.slice(0, 400),
        structuredPayload: { integrationHint: true },
      }),
    );
  }
  if (/\buwaga\b|ostrzeż/i.test(text) && /nie może|wymaga|limit/i.test(text)) {
    out.push(
      baseCandidate(section, source, 'warning', startIdx + out.length, {
        canonicalSubjectProposal: {
          label: 'Ostrzeżenie',
          normalizedLabel: 'ostrzezenie',
          proposedCanonicalKey: null,
        },
        candidateStatement: text.match(/[^\n]*(uwaga|ostrzeż)[^\n]*/i)?.[0]?.slice(0, 400) ?? text.slice(0, 400),
      }),
    );
  }
  return out;
}

function extractFormulas(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const out: KnowledgeCandidateOccurrenceV1[] = [];
  const fnMatches = [...text.matchAll(FORMULA_PATTERN)].map((m) => m[1]);
  const compMatches = [...text.matchAll(COMPONENT_CODE)].map((m) => m[1]);
  const hasEquation = /[A-Z0-9_]+\s*=\s*.+/.test(text);
  if (fnMatches.length || (compMatches.length && hasEquation) || hasEquation) {
    out.push(
      baseCandidate(section, source, 'calculation_rule', startIdx, {
        canonicalSubjectProposal: {
          label: 'Reguła obliczeniowa',
          normalizedLabel: '',
          proposedCanonicalKey: null,
        },
        candidateStatement: text.slice(0, 500),
        structuredPayload: {
          formulaText: text.match(/[^.\n]{0,200}=.{0,200}/)?.[0] ?? text.slice(0, 200),
          functionNames: [...new Set(fnMatches)],
          componentReferences: [...new Set(compMatches)],
          executionStatus: 'not_executed',
        },
        correlationHints: {
          formLabels: [],
          fieldLabels: [],
          actionLabels: [],
          statusLabels: [],
          parameterNames: [],
          componentCodes: [...new Set(compMatches)],
          functionNames: [...new Set(fnMatches)],
          oracleIdentifiers: [],
          helpSearchTerms: [],
        },
      }),
    );
  }
  return out;
}

function extractExplicitSections(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const out: KnowledgeCandidateOccurrenceV1[] = [];
  const blocks = text.split(
    /\n(?=(?:Warunki wstępne|Warunki wstepne|Kroki|Oczekiwany wynik|Uwagi|Ostrzeżenia|Scenariusz|Przypadek|Konfiguracja|Parametry|Korekta|Procedura|Sposób postępowania|Wykonanie)[:\s])/i,
  );
  for (const block of blocks) {
    const m = block.match(EXPLICIT_SECTION_LABELS);
    if (!m) continue;
    const label = m[1].trim();
    if (
      isGenericHeadingLabel(label)
      && !/warunki|kroki|oczekiwany|scenariusz|przypadek|konfigurac|parametr|korekta|ostrzeż|procedur|sposób|wykonanie/i.test(label)
    ) {
      continue;
    }
    const kind: KnowledgeCandidateKind | null =
      /procedur|sposób postępowania|wykonanie|kroki/i.test(label) ? 'procedure'
      : /oczekiwany wynik|scenariusz|przypadek/i.test(label) ? 'scenario'
      : /ostrzeż/i.test(label) ? 'warning'
      : /^uwagi$/i.test(label) ? 'warning'
      : /parametr|konfigurac/i.test(label) ? 'parameter'
      : /korekta/i.test(label) ? 'exception'
      : /warunki/i.test(label) ? 'eligibility_rule'
      : null;
    if (!kind) continue;
    const stepCount = block.split('\n').filter((l) => STEP_LIST.test(l)).length;
    out.push(
      baseCandidate(section, source, kind, startIdx + out.length, {
        canonicalSubjectProposal: {
          label,
          normalizedLabel: normalizeCandidateLabel(label),
          proposedCanonicalKey: null,
        },
        candidateStatement: block.trim().slice(0, 800),
        structuredPayload: {
          sectionLabel: label,
          ...(kind === 'procedure' ? { stepCount: Math.max(stepCount, 2) } : {}),
        },
      }),
    );
  }
  // Inline "Konfiguracja parametru X"
  for (const m of text.matchAll(/Konfiguracja parametru\s+([A-Z][A-Z0-9_]{2,})/gi)) {
    out.push(
      baseCandidate(section, source, 'parameter', startIdx + out.length, {
        canonicalSubjectProposal: {
          label: m[1],
          normalizedLabel: normalizeCandidateLabel(m[1]),
          proposedCanonicalKey: null,
        },
        candidateStatement: m[0],
        structuredPayload: { parameterName: m[1] },
        correlationHints: {
          formLabels: [],
          fieldLabels: [],
          actionLabels: [],
          statusLabels: [],
          parameterNames: [m[1]],
          componentCodes: [],
          functionNames: [],
          oracleIdentifiers: [],
          helpSearchTerms: [m[1]],
        },
      }),
    );
  }
  return out;
}

function extractStatuses(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const out: KnowledgeCandidateOccurrenceV1[] = [];
  for (const m of text.matchAll(STATUS_WORDS)) {
    const statusLabel = m[2].trim();
    if (isWeakStatusAdjective(statusLabel)) continue;
    out.push(
      baseCandidate(section, source, 'status', startIdx + out.length, {
        canonicalSubjectProposal: {
          label: statusLabel,
          normalizedLabel: normalizeCandidateLabel(statusLabel),
          proposedCanonicalKey: null,
        },
        candidateStatement: m[0],
        structuredPayload: { statusLabel },
        correlationHints: {
          formLabels: [],
          fieldLabels: [],
          actionLabels: [],
          statusLabels: [statusLabel],
          parameterNames: [],
          componentCodes: [],
          functionNames: [],
          oracleIdentifiers: [],
          helpSearchTerms: [statusLabel],
        },
      }),
    );
  }
  return out;
}

function extractDates(
  text: string,
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const dates = [...text.matchAll(DATE_PATTERN)].map((m) => m[1]);
  if (!dates.length && !/obowiązuje od|od\s+\d{4}/i.test(text)) return [];
  return [
    baseCandidate(section, source, 'temporal_rule', startIdx, {
      canonicalSubjectProposal: {
        label: 'Data obowiązywania',
        normalizedLabel: 'data obowiązywania',
        proposedCanonicalKey: null,
      },
      candidateStatement: dates.length ? `Daty: ${dates.join(', ')}` : text.match(/[^\n]*obowiązuje[^\n]*/i)?.[0] ?? text.slice(0, 200),
      structuredPayload: { dates, currentnessStatus: 'not_verified' },
      applicability: { ...defaultApplicability(section), currentnessStatus: 'not_verified' },
      warnings: ['regulatory_currentness_not_verified'],
    }),
  ];
}

function extractTableRows(
  units: ContentUnitV1[],
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  if (section.sectionKind !== 'table_section') return [];
  const rows = units.filter(
    (u) => section.contentUnitRefs.includes(u.contentUnitId) && u.unitKind === 'table_row',
  );
  const out: KnowledgeCandidateOccurrenceV1[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (isGenericTableColumnLabel(row.text)) continue;
    if (/termin\s*\|\s*definicja|przez\s+.+\s+rozumie\s+się|oznacza/i.test(row.text)) {
      const term = row.text.split('|')[0]?.trim() ?? row.text.slice(0, 40);
      if (!isGenericHeadingLabel(term) && term.length >= 3) {
        out.push(
          baseCandidate(section, source, 'business_concept', startIdx + out.length, {
            canonicalSubjectProposal: {
              label: term,
              normalizedLabel: normalizeCandidateLabel(term),
              proposedCanonicalKey: null,
            },
            candidateStatement: row.text,
            structuredPayload: { tableDefinition: true, definitionPattern: true },
            evidence: [{
              sectionId: section.sectionId,
              contentUnitRefs: [row.contentUnitId],
              assetRefs: row.assetRefs,
              evidenceStrength: 'structured_table',
            }],
          }),
        );
      }
      continue;
    }
    if (!/[:=|]/.test(row.text) || !/\d|[A-Z]{2,}/.test(row.text)) continue;
    out.push(
      baseCandidate(section, source, 'parameter', startIdx + out.length, {
        canonicalSubjectProposal: {
          label: row.text.slice(0, 80),
          normalizedLabel: normalizeCandidateLabel(row.text.slice(0, 80)),
          proposedCanonicalKey: null,
        },
        candidateStatement: row.text,
        structuredPayload: { rowIndex: row.location.rowIndex, tableIndex: row.location.tableIndex },
        evidence: [{
          sectionId: section.sectionId,
          contentUnitRefs: [row.contentUnitId],
          assetRefs: row.assetRefs,
          evidenceStrength: 'structured_table',
        }],
      }),
    );
  }
  return out;
}

function extractScenarios(
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  text: string,
  startIdx: number,
): KnowledgeCandidateOccurrenceV1[] {
  const out: KnowledgeCandidateOccurrenceV1[] = [];
  const purpose = section.classificationHints.sourcePurposeIds.includes('scenario_or_test_case');
  const explicit = /scenariusz|przypadek testowy|test case|warunki wstępne/i.test(text);
  if (purpose || explicit) {
    if (/scenariusz|przypadek|warunki wstępne/i.test(text) || purpose) {
      out.push(
        baseCandidate(section, source, 'scenario', startIdx, {
          canonicalSubjectProposal: {
            label: section.title ?? 'Scenariusz',
            normalizedLabel: normalizeCandidateLabel(section.title ?? 'scenariusz'),
            proposedCanonicalKey: null,
          },
          candidateStatement: text.slice(0, 800),
          structuredPayload: { sourcePurpose: purpose ? 'scenario_or_test_case' : 'explicit_text' },
          warnings: ['scenario_not_auto_business_rule'],
        }),
      );
    }
  }
  return out;
}

export function extractDeterministicCandidates(
  section: TopicSectionV1,
  source: { logicalSourceId: string; sourceRevisionId: string },
  units: ContentUnitV1[],
): {
  candidates: KnowledgeCandidateOccurrenceV1[];
  quality: QualityGateCounters;
  accounting: ProposalAccounting;
  rawProposalCount: number;
} {
  if (section.sectionKind === 'transcript_topic' && section.warnings.some((w) => w.includes('noise'))) {
    return {
      candidates: [],
      quality: applyGatesWithProposalAccounting([]).quality,
      accounting: emptyProposalAccounting(),
      rawProposalCount: 0,
    };
  }
  const text = sectionText(units, section);
  let idx = 0;
  const all = [
    ...extractBusinessConcepts(text, section, source, idx),
    ...(() => { idx += 50; return extractExplicitSections(text, section, source, idx); })(),
    ...(() => { idx += 50; return extractBusinessProcess(text, section, source, idx); })(),
    ...(() => { idx += 50; return extractSteps(text, section, source, idx); })(),
    ...(() => { idx += 50; return extractActions(text, section, source, idx); })(),
    ...(() => { idx += 50; return extractStateTransitions(text, section, source, idx); })(),
    ...(() => { idx += 50; return extractValidationRules(text, section, source, idx); })(),
    ...(() => { idx += 50; return extractTestCases(text, section, source, idx); })(),
    ...(() => { idx += 50; return extractTechnicalRelations(text, section, source, idx); })(),
    ...(() => { idx += 50; return extractDocumentAndIntegration(text, section, source, idx); })(),
    ...(() => { idx += 50; return extractFormulas(text, section, source, idx); })(),
    ...(() => { idx += 50; return extractStatuses(text, section, source, idx); })(),
    ...(() => { idx += 50; return extractDates(text, section, source, idx); })(),
    ...(() => { idx += 50; return extractTableRows(units, section, source, idx); })(),
    ...(() => { idx += 50; return extractScenarios(section, source, text, idx); })(),
  ];
  void ACTION_VERBS;
  const gated = applyGatesWithProposalAccounting(all, { sectionHadProposals: all.length > 0 });
  return {
    candidates: gated.accepted,
    quality: gated.quality,
    accounting: gated.accounting,
    rawProposalCount: all.length,
  };
}

export function countExactCollapse(before: number, after: number): { collapsed: number; preserved: boolean } {
  return { collapsed: Math.max(0, before - after), preserved: true };
}

// re-export for callers that imported collapse from this module
export { exactCollapseWithinSection } from './teta-candidate-proposal-accounting';

export function extractCorrelationHints(
  candidates: KnowledgeCandidateOccurrenceV1[],
): import('./teta-knowledge-candidate.types').CorrelationHintV1[] {
  const hints: import('./teta-knowledge-candidate.types').CorrelationHintV1[] = [];
  for (const c of candidates) {
    const ch = c.correlationHints;
    const pairs: Array<[string[], string]> = [
      [ch.formLabels, 'form_label'],
      [ch.fieldLabels, 'field_label'],
      [ch.actionLabels, 'action_label'],
      [ch.statusLabels, 'status_label'],
      [ch.parameterNames, 'parameter_name'],
      [ch.componentCodes, 'component_code'],
      [ch.functionNames, 'function_name'],
      [ch.oracleIdentifiers, 'oracle_identifier'],
      [ch.helpSearchTerms, 'help_search_term'],
    ];
    for (const [values, kind] of pairs) {
      for (const value of values) {
        hints.push({
          value,
          hintKind: kind,
          evidenceRef: c.candidateOccurrenceId,
          resolutionStatus: 'not_resolved',
        });
      }
    }
  }
  return hints;
}
