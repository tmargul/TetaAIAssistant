/**
 * Stage 3I — chat gate for payroll configuration questions.
 * Stage 3J.1: lexicon-only scope for migrated payroll gate paths.
 * No DOMAN fallback, no Oracle/LLM/Qdrant.
 */
import type { PayrollChatGateResult } from './teta-payroll-snapshot.types';
import type { TetaPayrollSnapshotQueryService } from './teta-payroll-snapshot-query.service';
import { resolveDomainLexicon } from '../teta-domain-lexicon/teta-domain-lexicon-resolver';

const CODE_RE = /\b(\d{3,5})\b/;

export function isGenericPayrollKnowledgeQuestion(question: string): boolean {
  const lexicon = resolveDomainLexicon(question);
  return lexicon.mapping.scope === 'generic_payroll_knowledge';
}

export function isClientPayrollConfigurationQuestion(question: string): boolean {
  const lexicon = resolveDomainLexicon(question);
  if (lexicon.mapping.scope === 'client_payroll_configuration') return true;
  if (lexicon.mapping.scope === 'recognized_but_not_routed') return false;
  if (isGenericPayrollKnowledgeQuestion(question)) return false;
  return false;
}

export function extractPayrollComponentCode(question: string): string | null {
  const m = CODE_RE.exec(question);
  return m?.[1] ?? null;
}

export function evaluatePayrollChatGate(options: {
  question: string;
  queryService: TetaPayrollSnapshotQueryService;
  uploadAllowed: boolean;
}): PayrollChatGateResult {
  const { question, queryService, uploadAllowed } = options;

  if (isGenericPayrollKnowledgeQuestion(question)) {
    return { kind: 'generic_payroll_knowledge', scope: 'generic_payroll_knowledge' };
  }

  if (!isClientPayrollConfigurationQuestion(question)) {
    return { kind: 'generic_payroll_knowledge', scope: 'generic_payroll_knowledge' };
  }

  const active = queryService.getActiveSummary();
  if (!active) {
    return {
      kind: 'snapshot_required',
      scope: 'client_payroll_configuration',
      response: {
        type: 'payroll_parameter_snapshot_required',
        message:
          'Aby przeanalizować składniki płacowe w Państwa bazie, potrzebuję systemowego raportu parametrów płacowych.',
        instructions: [
          'Otwórz w Teta menu Wydruki.',
          'Wybierz Płace.',
          'Uruchom Wydruk parametrów płacowych.',
          'Zapisz raport jako RTF i załaduj go tutaj.',
          ...(uploadAllowed
            ? []
            : ['Przekaż plik RTF administratorowi AIA, aby mógł go załadować.']),
        ],
        uploadAllowed,
      },
    };
  }

  const code = extractPayrollComponentCode(question);
  if (!code) {
    return {
      kind: 'component_summary',
      scope: 'client_payroll_configuration',
      code: '',
      title: null,
      typeCode: null,
      directDependencyCount: 0,
      snapshotId: active.snapshotId,
    };
  }

  const inspected = queryService.inspectComponent(code);
  if (inspected.status === 'not_found') {
    const dateLabel = inspected.reportGeneratedAt ?? 'nieznana';
    return {
      kind: 'component_not_found',
      scope: 'client_payroll_configuration',
      response: {
        type: 'payroll_component_not_found_in_active_snapshot',
        message: `Składnik nie występuje w aktualnie załadowanym raporcie parametrów płacowych. Raport wygenerowano dnia ${dateLabel}. Jeżeli składnik został dodany później, załaduj aktualny raport.`,
        reportGeneratedAt: inspected.reportGeneratedAt,
      },
    };
  }
  if (inspected.status !== 'found') {
    return {
      kind: 'snapshot_required',
      scope: 'client_payroll_configuration',
      response: {
        type: 'payroll_parameter_snapshot_required',
        message:
          'Aby przeanalizować składniki płacowe w Państwa bazie, potrzebuję systemowego raportu parametrów płacowych.',
        instructions: [
          'Otwórz w Teta menu Wydruki.',
          'Wybierz Płace.',
          'Uruchom Wydruk parametrów płacowych.',
          'Zapisz raport jako RTF i załaduj go tutaj.',
        ],
        uploadAllowed,
      },
    };
  }

  return {
    kind: 'component_summary',
    scope: 'client_payroll_configuration',
    code: inspected.code,
    title: inspected.title,
    typeCode: inspected.typeCode,
    directDependencyCount: inspected.directDependencyCount,
    snapshotId: inspected.snapshotId,
  };
}

/** Deterministic chat message for Stage 3I gate results (no LLM). */
export function formatPayrollChatGateMessage(result: PayrollChatGateResult): string | null {
  if (result.kind === 'generic_payroll_knowledge') return null;

  if (result.kind === 'snapshot_required') {
    const lines = [result.response.message, '', ...result.response.instructions.map((s, i) => `${i + 1}. ${s}`)];
    return lines.join('\n');
  }

  if (result.kind === 'component_not_found') {
    return result.response.message;
  }

  if (!result.code) {
    return 'Aktywny raport parametrów płacowych jest załadowany. Podaj kod składnika, aby zobaczyć szczegóły konfiguracji.';
  }
  const titlePart = result.title ? ` (${result.title})` : '';
  const typePart = result.typeCode ? `, typ ${result.typeCode}` : '';
  return [
    'Aktywny raport parametrów płacowych jest dostępny.',
    `Składnik ${result.code}${titlePart}${typePart} — znaleziony.`,
    `Bezpośrednie zależności: ${result.directDependencyCount}.`,
  ].join(' ');
}
