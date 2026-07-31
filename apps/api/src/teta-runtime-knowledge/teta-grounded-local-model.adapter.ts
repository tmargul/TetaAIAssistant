import { getOllamaBaseUrl } from '../chat/ollama-config.util';
import type { ConfigService } from '@nestjs/config';
import {
  parseStructuredModelAnswer,
  validateStructuredModelAnswer,
  type SanitizedModelInputEnvelope,
  type StructuredModelAnswer,
} from './teta-sanitized-model-input';
import { isTimeoutError } from '../teta-knowledge-candidates/teta-candidate-model-provider';

export type LocalGroundedModelCallResult = {
  ok: boolean;
  timedOut: boolean;
  retried: boolean;
  modelName: string;
  baseUrl: string;
  latencyMs: number;
  rawContent: string | null;
  structured: StructuredModelAnswer | null;
  validationErrors: string[];
  error: string | null;
};

function resolveBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
}

function resolveModelName(override?: string): string {
  return override ?? process.env.OLLAMA_MODEL_CHAT ?? 'qwen3';
}

function smokeTimeoutMs(): number {
  const configured = Number(process.env.OLLAMA_CHAT_TIMEOUT_MS ?? 600_000);
  // Smoke uses a safer per-call budget, capped below full chat timeout.
  return Math.min(90_000, Number.isFinite(configured) && configured > 0 ? configured : 90_000);
}

export async function getLocalGroundedModelStatus(opts?: { modelOverride?: string }): Promise<{
  available: boolean;
  modelName: string;
  baseUrl: string;
  installedModels: string[];
  reason: string | null;
}> {
  const baseUrl = resolveBaseUrl();
  const modelName = resolveModelName(opts?.modelOverride);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return {
        available: false,
        modelName,
        baseUrl,
        installedModels: [],
        reason: `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const installedModels = (data.models ?? []).map((m) => m.name);
    const match = installedModels.find((n) => n === modelName || n.startsWith(`${modelName}:`));
    return {
      available: Boolean(match),
      modelName,
      baseUrl,
      installedModels,
      reason: match ? null : `Model ${modelName} not installed locally`,
    };
  } catch (e) {
    return {
      available: false,
      modelName,
      baseUrl,
      installedModels: [],
      reason: String(e),
    };
  }
}

function buildSystemPrompt(opts?: { paraphraseRetry?: boolean }): string {
  const lines = [
    'Jesteś asystentem produktowym Teta.',
    'Odpowiadasz WYŁĄCZNIE na podstawie dostarczonych claims.',
    'Nie wymyślaj brakujących kroków, faktów, dokumentów ani źródeł.',
    'Nie ujawniaj wewnętrznych źródeł, ścieżek, nazw plików, filmów, identyfikatorów ani provenance.',
    'Nie używaj słów: Vendor, Stage 3J, runtime unit, evidence, approved_canonical, source_backed, internal trace, knowledge mode.',
    'Nie zaczynaj od „W mojej bazie wiedzy”.',
    'Odpowiadaj naturalnie po polsku.',
    'Jeśli completeness=partial lub requiredDisclosures zawiera partiality — jawnie powiedz, że nie masz pełnej informacji.',
    'Dla claimów z paraphraseRequired=true MUSISZ parafrazować treść — bez cudzysłowów i bez przepisywania całego zdania 1:1.',
    'Dla claimExpansionPolicy=forbidden (public_authority) NIE wolno dodawać liczb, terminów, wyjątków, wymiarów urlopu, dodatkowych artykułów ani obowiązków spoza claimu.',
    'Możesz użyć placeholderów cytowań z listy visibleCitationPlaceholders (np. [C1], [P1]), ale nie twórz własnych nazw aktów/artykułów.',
    'Zwróć WYŁĄCZNIE JSON: {"answer":"...","usedClaimIds":[],"usedCitationPlaceholders":[],"disclosuresApplied":[]}',
  ];
  if (opts?.paraphraseRetry) {
    lines.unshift(
      'PARAPHRASE RETRY: poprzednia odpowiedź była zbyt wiernym przepisaniem claimu. Napisz inną, naturalną parafrazę bez cytatu.',
    );
  }
  return lines.join(' ');
}

async function postChat(opts: {
  baseUrl: string;
  modelName: string;
  envelope: SanitizedModelInputEnvelope;
  timeoutMs: number;
  paraphraseRetry?: boolean;
}): Promise<string> {
  const res = await fetch(`${opts.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.modelName,
      stream: false,
      think: false,
      options: {
        temperature: 0,
        seed: 42,
        num_predict: 512,
      },
      messages: [
        { role: 'system', content: buildSystemPrompt({ paraphraseRetry: opts.paraphraseRetry }) },
        { role: 'user', content: JSON.stringify(opts.envelope) },
      ],
      format: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          usedClaimIds: { type: 'array', items: { type: 'string' } },
          usedCitationPlaceholders: { type: 'array', items: { type: 'string' } },
          disclosuresApplied: { type: 'array', items: { type: 'string' } },
        },
        required: ['answer', 'usedClaimIds', 'usedCitationPlaceholders', 'disclosuresApplied'],
      },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!res.ok) throw new Error(`Ollama chat failed (${res.status})`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? '';
}

export async function callLocalGroundedModel(opts: {
  envelope: SanitizedModelInputEnvelope;
  modelOverride?: string;
  allowRetryOnInvalidStructuredOutput?: boolean;
  forceParaphraseRetry?: boolean;
}): Promise<LocalGroundedModelCallResult> {
  const baseUrl = resolveBaseUrl();
  const modelName = resolveModelName(opts.modelOverride);
  const timeoutMs = smokeTimeoutMs();
  const started = Date.now();
  let retried = false;
  let rawContent: string | null = null;

  try {
    rawContent = await postChat({
      baseUrl,
      modelName,
      envelope: opts.envelope,
      timeoutMs,
      paraphraseRetry: opts.forceParaphraseRetry === true,
    });
    let structured: StructuredModelAnswer;
    try {
      structured = parseStructuredModelAnswer(rawContent);
    } catch (parseErr) {
      if (opts.allowRetryOnInvalidStructuredOutput !== false) {
        retried = true;
        rawContent = await postChat({
          baseUrl,
          modelName,
          envelope: opts.envelope,
          timeoutMs,
          paraphraseRetry: true,
        });
        structured = parseStructuredModelAnswer(rawContent);
      } else {
        throw parseErr;
      }
    }
    const validation = validateStructuredModelAnswer(structured, opts.envelope);
    return {
      ok: validation.ok,
      timedOut: false,
      retried,
      modelName,
      baseUrl,
      latencyMs: Date.now() - started,
      rawContent,
      structured,
      validationErrors: validation.errors,
      error: validation.ok ? null : validation.errors.join('|'),
    };
  } catch (e) {
    const timedOut = isTimeoutError(e);
    return {
      ok: false,
      timedOut,
      retried,
      modelName,
      baseUrl,
      latencyMs: Date.now() - started,
      rawContent,
      structured: null,
      validationErrors: timedOut ? ['timeout'] : ['model_call_failed'],
      error: String(e),
    };
  }
}

/** Optional Nest-friendly helper when ConfigService is available. */
export function resolveChatModelFromConfig(config?: ConfigService): string {
  if (!config) return resolveModelName();
  return config.get<string>('OLLAMA_MODEL_CHAT', 'qwen3') ?? 'qwen3';
}

export function resolveOllamaBaseFromConfig(config?: ConfigService): string {
  if (!config) return resolveBaseUrl();
  return getOllamaBaseUrl(config);
}
