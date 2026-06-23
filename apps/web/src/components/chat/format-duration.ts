/** Formatuje czas trwania zapytania do wyświetlenia w UI. */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }

  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) {
    return `${totalSec} s`;
  }

  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min} min ${sec} s` : `${min} min`;
}

export function formatChatTiming(timing: {
  totalMs: number;
  ragMs: number;
  llmMs: number;
}): string {
  return `Czas odpowiedzi: ${formatDuration(timing.totalMs)} (RAG ${formatDuration(timing.ragMs)} · model ${formatDuration(timing.llmMs)})`;
}
