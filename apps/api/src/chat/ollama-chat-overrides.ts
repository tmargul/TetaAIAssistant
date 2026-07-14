export type OllamaChatOverrides = {
  /** Wymusza tryb think (qwen3) — domyślnie z profilu jakości. */
  think?: boolean;
  minNumPredict?: number;
  maxNumPredict?: number;
  temperature?: number;
  numCtx?: number;
  /** Limit czasu pojedynczego wywołania Ollama (ms). Domyślnie OLLAMA_CHAT_TIMEOUT_MS. */
  timeoutMs?: number;
};

export function applyOllamaChatOverrides(
  options: {
    temperature: number;
    num_predict: number;
    num_thread: number;
    num_ctx: number;
    num_batch: number;
  },
  overrides?: OllamaChatOverrides,
): typeof options {
  const next = { ...options };
  if (overrides?.temperature !== undefined) {
    next.temperature = overrides.temperature;
  }
  if (overrides?.numCtx !== undefined) {
    next.num_ctx = overrides.numCtx;
  }
  if (overrides?.maxNumPredict !== undefined) {
    next.num_predict = Math.min(next.num_predict, overrides.maxNumPredict);
  }
  if (overrides?.minNumPredict !== undefined) {
    next.num_predict = Math.max(next.num_predict, overrides.minNumPredict);
  }
  return next;
}
