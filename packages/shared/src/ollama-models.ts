export const OLLAMA_MODELS_PACK_FORMAT = 'teta-ollama-models' as const;

export const OLLAMA_PULL_MODELS = ['qwen3', 'deepseek-r1', 'nomic-embed-text'] as const;
export type OllamaPullModel = (typeof OLLAMA_PULL_MODELS)[number];

export interface OllamaModelsPackManifest {
  format: typeof OLLAMA_MODELS_PACK_FORMAT;
  version: string;
  createdAt: string;
  models: string[];
  notes?: string;
}

export interface OllamaModelsImportResult {
  importedModels: string[];
  mergedFiles: number;
  targetDir: string;
  restartOllamaRecommended: boolean;
}

export interface OllamaModelPullResult {
  model: string;
  status: 'complete';
}

export interface OllamaModelPullProgress {
  status: string;
  completed?: number;
  total?: number;
  percent: number | null;
}

export type OllamaModelPullStreamEvent =
  | ({ type: 'progress' } & OllamaModelPullProgress)
  | ({ type: 'complete' } & OllamaModelPullResult)
  | { type: 'error'; message: string };
