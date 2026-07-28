/**
 * Stage 3J — chat/API response mapper.
 */
import type {
  PayrollExplanationFocus,
  TetaPayrollComponentChatResponse,
  TetaPayrollComponentExplanation,
} from './teta-payroll-explanation.types';
import { STAGE3J_CHAT_RESPONSE_CONTRACT_VERSION } from './teta-payroll-explanation.types';

export function mapExplanationToChatResponse(
  explanation: TetaPayrollComponentExplanation,
): TetaPayrollComponentChatResponse {
  const code = explanation.component?.code;
  const title = explanation.component?.title;
  const cardTitle = code
    ? `Składnik ${code}${title ? ` — ${title}` : ''}`
    : 'Analiza składnika płacowego';

  let message = explanation.narrative.summary;
  if (explanation.status === 'snapshot_required') {
    message =
      'Aby przeanalizować składniki płacowe w Państwa bazie, potrzebuję systemowego raportu parametrów płacowych.';
  } else if (explanation.status === 'component_not_found') {
    message = explanation.narrative.summary;
  } else if (explanation.status === 'ambiguous_component') {
    message = explanation.narrative.summary;
  } else if (explanation.status === 'capability_not_available') {
    message = explanation.narrative.summary;
  }

  return {
    contractVersion: STAGE3J_CHAT_RESPONSE_CONTRACT_VERSION,
    type: 'payroll_component_explanation',
    status: explanation.status,
    title: cardTitle,
    message,
    explanation,
    historyRedaction: {
      rawFormulaPersisted: false,
      dependencyFragmentsPersisted: false,
      dataExpired: true,
    },
  };
}

export function formatExplanationAsPlainText(
  explanation: TetaPayrollComponentExplanation,
  focus: PayrollExplanationFocus = explanation.request.focus,
): string {
  const lines: string[] = [];
  lines.push(explanation.narrative.summary);
  if (focus === 'full' || focus === 'overview') {
    if (explanation.component) {
      lines.push('', '## Konfiguracja składnika');
      lines.push(`Kod: ${explanation.component.code}`);
      if (explanation.component.title) lines.push(`Tytuł: ${explanation.component.title}`);
      if (explanation.component.typeCode) {
        lines.push(
          `Typ: ${explanation.component.typeCode}${explanation.component.typeMeaning ? ` — ${explanation.component.typeMeaning}` : ''}`,
        );
      }
      if (explanation.component.correctionMode != null) {
        lines.push(
          `Tryb korekty: ${explanation.component.correctionMode}${explanation.component.correctionModeMeaning ? ` — ${explanation.component.correctionModeMeaning}` : ''}`,
        );
      } else {
        lines.push('Tryb korekty: nie określono w raporcie.');
      }
    }
  }
  if ((focus === 'full' || focus === 'formula') && explanation.formula.available) {
    lines.push('', '## Jak działa wzór');
    if (explanation.formula.raw) lines.push(explanation.formula.raw);
    if (explanation.narrative.formulaExplanation) {
      lines.push(explanation.narrative.formulaExplanation);
    }
  }
  if (focus === 'full' || focus === 'dependencies') {
    lines.push('', '## Zależności');
    lines.push(explanation.narrative.dependencyExplanation);
  }
  if (focus === 'full' || focus === 'impact') {
    lines.push('', '## Wpływ / wykorzystanie');
    lines.push(explanation.narrative.impactExplanation);
  }
  if (explanation.narrative.warnings.length) {
    lines.push('', '## Ostrzeżenia');
    for (const w of explanation.narrative.warnings) lines.push(`- ${w}`);
  }
  if (explanation.source?.reportGeneratedAt) {
    lines.push(
      '',
      `Analiza została wykonana na podstawie raportu parametrów płacowych z dnia ${formatReportDate(explanation.source.reportGeneratedAt)}.`,
    );
  }
  return lines.join('\n');
}

function formatReportDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function buildCapabilityNotAvailableExplanation(query: string): TetaPayrollComponentExplanation {
  return {
    contractVersion: 'teta-aia-payroll-component-explanation-v1',
    status: 'capability_not_available',
    explanationId: 'capability-not-available',
    explanationFingerprintSha256: 'capability-not-available',
    request: { focus: 'full', requestedDepth: 5, intent: null },
    source: null,
    component: null,
    formula: {
      available: false,
      raw: null,
      parseStatus: 'unsupported',
      plainLanguageSteps: [],
      references: [],
      unknownCalls: [],
      warnings: [],
    },
    dependencies: {
      direct: [],
      transitive: [],
      maximumDepthReached: 0,
      truncated: false,
      cycles: [],
      missingTargets: [],
    },
    impact: {
      directDependents: [],
      transitiveDependents: [],
      calculationFormulaUses: [],
      sqlFormulaUses: [],
      maximumDepthReached: 0,
      truncated: false,
    },
    diagnostics: [],
    evidenceSummary: {
      snapshotExactFacts: 0,
      graphExactFacts: 0,
      verifiedSemanticFacts: 0,
      unknownSemanticFacts: 0,
      warnings: 0,
    },
    narrative: {
      summary:
        'Ta funkcja nie jest jeszcze dostępna w asystencie AIA. Mogę wyjaśnić konfigurację i zależności składnika na podstawie raportu parametrów płacowych, ale analiza konkretnej wartości, projektowanie nowych składników i porównywanie wymagają kolejnego etapu.',
      formulaExplanation: '',
      dependencyExplanation: '',
      impactExplanation: '',
      warnings: [],
    },
  };
}

export function buildEmployeeValueNotAvailableMessage(): string {
  return 'Mogę wyjaśnić konfigurację i zależności składnika, ale analiza konkretnej wartości wymaga danych wykonania listy płac. Ten zakres będzie obsługiwany przez kolejny etap.';
}
