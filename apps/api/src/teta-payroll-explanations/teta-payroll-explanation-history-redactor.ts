/**
 * Stage 3J — redact sensitive explanation payload before history persistence.
 */
import type {
  TetaPayrollComponentChatResponse,
  TetaPayrollComponentExplanation,
} from './teta-payroll-explanation.types';

export function redactExplanationForHistory(
  explanation: TetaPayrollComponentExplanation,
): TetaPayrollComponentExplanation {
  return {
    ...explanation,
    formula: {
      ...explanation.formula,
      raw: null,
      plainLanguageSteps: [],
      references: [],
      unknownCalls: [],
    },
    dependencies: {
      ...explanation.dependencies,
      direct: explanation.dependencies.direct.map((d) => ({
        ...d,
        sourceFragment: '[redacted]',
      })),
    },
    impact: {
      ...explanation.impact,
      calculationFormulaUses: explanation.impact.calculationFormulaUses.map((u) => ({
        ...u,
        title: u.title,
      })),
      sqlFormulaUses: [],
    },
    narrative: {
      ...explanation.narrative,
      formulaExplanation: explanation.narrative.summary,
    },
  };
}

export function redactChatResponseForHistory(
  response: TetaPayrollComponentChatResponse,
): TetaPayrollComponentChatResponse {
  if (!response.explanation) return response;
  const explanation = redactExplanationForHistory(response.explanation);
  return {
    ...response,
    explanation,
    historyRedaction: {
      rawFormulaPersisted: false,
      dependencyFragmentsPersisted: false,
      dataExpired: true,
    },
  };
}

export function buildHistoryExpiredNotice(): string {
  return 'Szczegóły konfiguracji nie są trwale przechowywane. Uruchom analizę ponownie, aby odczytać aktualny snapshot.';
}
