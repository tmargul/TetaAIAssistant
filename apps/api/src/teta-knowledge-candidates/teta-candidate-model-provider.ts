import {
  DEFAULT_MODEL_BUDGET_CONFIG,
  estimateTokens,
  type ModelBudgetConfig,
  type RuntimeProcessor,
} from './teta-candidate-model-config';

export type ModelCandidateRecord = {
  candidateKind: string;
  label: string;
  predicate?: string;
  object?: string | null;
  candidateStatement: string;
  structuredPayload?: Record<string, unknown>;
  uncertainty?: string;
  warnings?: string[];
  evidenceSummary?: string;
  evidence?: Array<{ contentUnitRefs?: string[]; assetRefs?: string[] }>;
};

export type ModelExtractionResult = {
  candidates: ModelCandidateRecord[];
  warnings: string[];
};

export type LocalModelStatus = {
  configured: boolean;
  available: boolean;
  modelName: string | null;
  modelDigest: string | null;
  quantization: string | null;
  contextSize: number | null;
  providerEndpoint: string | null;
  runtimeProcessor: RuntimeProcessor;
  reason: string | null;
};

export type ModelCallOutcome = 'succeeded' | 'timed_out' | 'failed' | 'skipped_by_budget' | 'invalid_output';

export interface TetaCandidateModelProvider {
  getStatus(): Promise<LocalModelStatus>;
  extractCandidates(input: {
    sectionTitle: string | null;
    headingPath: string[];
    sectionText: string;
    classificationHints: Record<string, string[]>;
    modelRunId: string;
    timeoutMs?: number;
  }): Promise<ModelExtractionResult>;
}

export class DeterministicFixtureModelProvider implements TetaCandidateModelProvider {
  async getStatus(): Promise<LocalModelStatus> {
    return {
      configured: true,
      available: true,
      modelName: 'fixture-deterministic',
      modelDigest: null,
      quantization: null,
      contextSize: null,
      providerEndpoint: 'fixture://local',
      runtimeProcessor: 'unknown',
      reason: null,
    };
  }

  async extractCandidates(input: {
    sectionTitle: string | null;
    sectionText: string;
  }): Promise<ModelExtractionResult> {
    const out: ModelCandidateRecord[] = [];
    if (/plugin|wtyczk|dataset|business object/i.test(input.sectionText)) {
      out.push({
        candidateKind: 'business_concept',
        label: 'Obiekt biznesowy / plugin',
        candidateStatement: input.sectionText.slice(0, 200),
        structuredPayload: { fixture: true },
        evidence: [{ contentUnitRefs: [] }],
      });
    }
    if (/krok|procedure|procedur/i.test(input.sectionText)) {
      out.push({
        candidateKind: 'procedure',
        label: input.sectionTitle ?? 'Procedura',
        candidateStatement: input.sectionText.slice(0, 300),
        evidence: [{ contentUnitRefs: [] }],
      });
    }
    return { candidates: out, warnings: [] };
  }
}

export class UnavailableModelProvider implements TetaCandidateModelProvider {
  constructor(private readonly reason: string) {}

  async getStatus(): Promise<LocalModelStatus> {
    return {
      configured: false,
      available: false,
      modelName: null,
      modelDigest: null,
      quantization: null,
      contextSize: null,
      providerEndpoint: null,
      runtimeProcessor: 'unknown',
      reason: this.reason,
    };
  }

  async extractCandidates(): Promise<ModelExtractionResult> {
    throw new Error(this.reason);
  }
}

export class OllamaCandidateModelProvider implements TetaCandidateModelProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly modelName: string,
    private readonly temperature = 0,
    private readonly budget: ModelBudgetConfig = DEFAULT_MODEL_BUDGET_CONFIG,
  ) {}

  async getStatus(): Promise<LocalModelStatus> {
    const endpoint = this.baseUrl.replace(/\/$/, '');
    try {
      const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        return {
          configured: true,
          available: false,
          modelName: this.modelName,
          modelDigest: null,
          quantization: null,
          contextSize: null,
          providerEndpoint: endpoint,
          runtimeProcessor: 'unknown',
          reason: `HTTP ${res.status}`,
        };
      }
      const data = (await res.json()) as {
        models?: Array<{ name: string; digest?: string; details?: { quantization_level?: string; parameter_size?: string } }>;
      };
      const match = (data.models ?? []).find(
        (m) => m.name === this.modelName || m.name.startsWith(`${this.modelName}:`),
      );
      let runtimeProcessor: RuntimeProcessor = 'unknown';
      try {
        const ps = await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(3000) });
        if (ps.ok) {
          const psData = (await ps.json()) as { models?: Array<{ size_vram?: number }> };
          const loaded = psData.models ?? [];
          if (loaded.some((m) => (m.size_vram ?? 0) > 0)) runtimeProcessor = 'gpu';
          else if (loaded.length) runtimeProcessor = 'cpu';
        }
      } catch {
        /* keep unknown */
      }
      return {
        configured: true,
        available: Boolean(match),
        modelName: this.modelName,
        modelDigest: match?.digest ?? null,
        quantization: match?.details?.quantization_level ?? null,
        contextSize: null,
        providerEndpoint: endpoint,
        runtimeProcessor,
        reason: match ? null : `Model ${this.modelName} not installed locally`,
      };
    } catch (e) {
      return {
        configured: true,
        available: false,
        modelName: this.modelName,
        modelDigest: null,
        quantization: null,
        contextSize: null,
        providerEndpoint: endpoint,
        runtimeProcessor: 'unknown',
        reason: String(e),
      };
    }
  }

  async extractCandidates(input: {
    sectionTitle: string | null;
    headingPath: string[];
    sectionText: string;
    classificationHints: Record<string, string[]>;
    modelRunId: string;
    timeoutMs?: number;
  }): Promise<ModelExtractionResult> {
    const timeoutMs = input.timeoutMs ?? this.budget.perModelCallTimeoutMs;
    const clipped = input.sectionText.slice(0, this.budget.maxModelInputCharacters);
    const system = [
      'Jesteś ekstraktorem KANDYDATÓW wiedzy dla systemu Teta HR/Edu.',
      'Używaj WYŁĄCZNIE dostarczonej sekcji. Bez wiedzy zewnętrznej.',
      'Nie zgaduj wersji produktu ani domeny z samej nazwy folderu.',
      'Rozróżniaj Teta HR, Teta Edu i Teta ME (product surface, nie domena).',
      'Zachowuj polskie znaki, kody i nazwy funkcji.',
      'Wydobądź wszystkie jawnie opisane: pojęcia, procedury, kroki, stany, przejścia, reguły, parametry, scenariusze i relacje techniczne.',
      'Nie pomijaj informacji tylko dlatego, że inny ekstraktor coś już wykrył.',
      'Jeden fragment może utworzyć kilka różnych rodzajów kandydatów, jeżeli każdy ma osobny dowód.',
      'Nie zwracaj pustej listy, gdy sekcja jawnie zawiera numerowane kroki, definicję, formułę, parametr albo oczekiwany wynik.',
      'Nie twórz kandydata z samego ogólnego nagłówka bez treści.',
      'Każdy kandydat musi mieć evidence z fragmentu sekcji.',
      'Zwróć pustą listę candidates TYLKO gdy brak jawnych dowodów.',
      'Nie zatwierdzaj kandydatów. Nie uznawaj przepisów za aktualne.',
      'Odpowiedz WYŁĄCZNIE poprawnym JSON: {"candidates":[],"warnings":[]}',
    ].join(' ');

    const user = JSON.stringify({
      sectionTitle: input.sectionTitle,
      headingPath: input.headingPath,
      hints: input.classificationHints,
      sectionText: clipped,
    });

    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        stream: false,
        options: { temperature: this.temperature, seed: 42 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        format: {
          type: 'object',
          properties: {
            candidates: { type: 'array' },
            warnings: { type: 'array' },
          },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Ollama chat failed (${res.status})`);
    const data = (await res.json()) as { message?: { content?: string } };
    const raw = data.message?.content ?? '{}';
    return JSON.parse(raw) as ModelExtractionResult;
  }
}

export function resolveCandidateModelProvider(options: {
  executeLocalModel: boolean;
  modelOverride?: string;
  budget?: ModelBudgetConfig;
}): TetaCandidateModelProvider {
  if (!options.executeLocalModel) {
    return new UnavailableModelProvider('local model disabled — requires --execute-local-model --confirm-candidate-only');
  }
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
  const modelName = options.modelOverride ?? process.env.OLLAMA_MODEL_CHAT ?? 'qwen3';
  return new OllamaCandidateModelProvider(baseUrl, modelName, 0, options.budget ?? DEFAULT_MODEL_BUDGET_CONFIG);
}

export function clipSectionTextForModel(text: string, budget: ModelBudgetConfig = DEFAULT_MODEL_BUDGET_CONFIG): {
  text: string;
  characters: number;
  estimatedTokens: number;
  truncated: boolean;
} {
  const clipped = text.slice(0, budget.maxModelInputCharacters);
  return {
    text: clipped,
    characters: clipped.length,
    estimatedTokens: estimateTokens(clipped),
    truncated: text.length > budget.maxModelInputCharacters,
  };
}

export function isTimeoutError(err: unknown): boolean {
  const s = String(err);
  return /timeout|aborted|AbortError/i.test(s);
}
