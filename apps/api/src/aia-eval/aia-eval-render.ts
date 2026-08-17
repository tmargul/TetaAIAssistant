import type { EvalInteractionTrace } from './aia-eval.types';

export function renderUserFacingAnswer(input: {
  evaluationState: EvalInteractionTrace['evaluationState'];
  capabilityLabel: string | null;
  executorDetail: string;
  renderedRows: string[][];
  stage5Question: string | null;
  insufficientTopic?: string;
}): string {
  if (input.evaluationState === 'CLARIFICATION_REQUIRED' && input.stage5Question) {
    return input.stage5Question;
  }

  if (input.evaluationState === 'INSUFFICIENT_EVIDENCE') {
    const topic = input.insufficientTopic ?? 'tego pytania';
    return `Nie mam jeszcze wystarczających danych technicznych, żeby bezpiecznie odpowiedzieć na ${topic}.`;
  }

  if (input.evaluationState === 'RESOLVED_BUT_NO_EXECUTOR') {
    return 'Rozpoznano pytanie, ale nie ma jeszcze bezpiecznego wykonawcy dla tego typu zapytań.';
  }

  if (input.evaluationState === 'UNSUPPORTED_REQUEST') {
    return 'Nie rozpoznaję jeszcze tego typu pytania w bieżącym zakresie oceny AIA.';
  }

  if (input.evaluationState === 'ERROR') {
    return 'Wystąpił błąd techniczny podczas przetwarzania pytania.';
  }

  if (input.renderedRows.length === 0) {
    return input.executorDetail || 'Brak wyników do wyświetlenia.';
  }

  if (input.renderedRows.length === 1 && input.renderedRows[0]!.length >= 3) {
    const row = input.renderedRows[0]!;
    const lines: string[] = [];
    if (row[0] || row[1]) {
      lines.push([row[0], row[1]].filter(Boolean).join(' ').trim());
    }
    if (row.length >= 3 && row[2]) lines.push(`Nr ewidencyjny: ${row[2]}`);
    if (row.length >= 4 && row[3]) lines.push(`Aktualne stanowisko: ${row[3]}`);
    if (row.length >= 4 && row[3] === 'Brak aktualnego stanowiska') {
      lines[lines.length - 1] = 'Aktualne stanowisko: brak';
    }
    if (lines.length > 0) return lines.join('\n');
  }

  const header =
    input.renderedRows[0]?.length === 4 && input.capabilityLabel?.includes('stanowisko')
      ? ['Imię', 'Nazwisko', 'Nr ewid.', 'Stanowisko']
      : input.renderedRows[0]?.length === 4
        ? ['Imię', 'Nazwisko', 'Nr ewid.', 'Data ur.']
        : null;

  const body = input.renderedRows
    .slice(0, 50)
    .map((row) => row.map((c) => (c == null || c === '' ? '—' : c)).join(' | '))
    .join('\n');

  const prefix = input.executorDetail ? `${input.executorDetail}\n\n` : '';
  if (header) {
    return `${prefix}${header.join(' | ')}\n${body}`;
  }
  return `${prefix}${body}`.trim();
}

export function formatTraceSummary(trace: EvalInteractionTrace): string {
  return [
    `evaluationState=${trace.evaluationState}`,
    `recognizedCapability=${trace.recognizedCapability ?? 'none'}`,
    `Stage4=${trace.stage4.resolutionStatus}`,
    `Stage5 clarificationRequired=${trace.stage5.clarificationRequired}`,
    `Stage5 technicalGapOnly=${trace.stage5.technicalGapOnly}`,
    `executor=${trace.executor.executorId ?? 'none'}`,
    `rows=${trace.executor.rowCount ?? 0}`,
    `falseStrongBindings=${trace.falseStrongBindings}`,
    `duration=${trace.durationMs}ms`,
  ].join('\n');
}
