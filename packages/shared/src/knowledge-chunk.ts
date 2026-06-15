import type { TetaKnowledgeChunkInput } from './rag.js';
import { KNOWLEDGE_SOURCE_TYPES, TETA_KNOWLEDGE_CHUNK_FORMAT } from './rag.js';

export interface KnowledgeChunkValidationIssue {
  line: number;
  message: string;
}

export interface KnowledgeChunkValidationResult {
  valid: boolean;
  format: typeof TETA_KNOWLEDGE_CHUNK_FORMAT;
  chunkCount: number;
  sources: string[];
  issues: KnowledgeChunkValidationIssue[];
}

export function parseKnowledgeChunkLine(
  line: string,
  lineNumber: number,
): TetaKnowledgeChunkInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`Linia ${lineNumber}: niepoprawny JSON.`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Linia ${lineNumber}: oczekiwano obiektu JSON (${TETA_KNOWLEDGE_CHUNK_FORMAT}).`);
  }

  const record = parsed as Record<string, unknown>;
  const source = typeof record.source === 'string' ? record.source.trim() : '';
  const text = typeof record.text === 'string' ? record.text.trim() : '';

  if (!source) {
    throw new Error(`Linia ${lineNumber}: brak wymaganego pola „source”.`);
  }
  if (!text) {
    throw new Error(`Linia ${lineNumber}: brak wymaganego pola „text”.`);
  }

  const sourceType = record.source_type;
  if (
    sourceType !== undefined &&
    (typeof sourceType !== 'string' ||
      !KNOWLEDGE_SOURCE_TYPES.includes(sourceType as (typeof KNOWLEDGE_SOURCE_TYPES)[number]))
  ) {
    throw new Error(
      `Linia ${lineNumber}: niepoprawne source_type (dozwolone: ${KNOWLEDGE_SOURCE_TYPES.join(', ')}).`,
    );
  }

  return {
    id: typeof record.id === 'string' ? record.id.trim() : undefined,
    source,
    source_type: sourceType as TetaKnowledgeChunkInput['source_type'],
    start: typeof record.start === 'number' ? record.start : undefined,
    end: typeof record.end === 'number' ? record.end : undefined,
    text,
    summary: typeof record.summary === 'string' ? record.summary.trim() : undefined,
    keywords: readStringArray(record.keywords, lineNumber, 'keywords'),
    concepts: readStringArray(record.concepts, lineNumber, 'concepts'),
    plugin_names: readStringArray(record.plugin_names, lineNumber, 'plugin_names'),
    form_names: readStringArray(record.form_names, lineNumber, 'form_names'),
    business_objects: readStringArray(record.business_objects, lineNumber, 'business_objects'),
    datasets: readStringArray(record.datasets, lineNumber, 'datasets'),
    tables: readStringArray(record.tables, lineNumber, 'tables'),
    packages: readStringArray(record.packages, lineNumber, 'packages'),
    shortcuts: readStringArray(record.shortcuts, lineNumber, 'shortcuts'),
    module: typeof record.module === 'string' ? record.module.trim() : undefined,
    topic: typeof record.topic === 'string' ? record.topic.trim() : undefined,
    teta_version: typeof record.teta_version === 'string' ? record.teta_version.trim() : undefined,
    training_date:
      typeof record.training_date === 'string' ? record.training_date.trim() : undefined,
    knowledge_version:
      typeof record.knowledge_version === 'string' ? record.knowledge_version.trim() : undefined,
    frames: readStringArray(record.frames, lineNumber, 'frames'),
  };
}

function readStringArray(
  value: unknown,
  lineNumber: number,
  field: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Linia ${lineNumber}: pole „${field}” musi być tablicą stringów.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

export function buildKnowledgeEmbeddingText(chunk: TetaKnowledgeChunkInput): string {
  const summary = chunk.summary?.trim();
  if (summary) {
    return `${summary}\n\n${chunk.text}`;
  }
  return chunk.text;
}

export function validateKnowledgeChunkLines(content: string): KnowledgeChunkValidationResult {
  const issues: KnowledgeChunkValidationIssue[] = [];
  const sources = new Set<string>();
  let chunkCount = 0;

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const trimmed = lines[index]?.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    try {
      const chunk = parseKnowledgeChunkLine(trimmed, lineNumber);
      chunkCount += 1;
      sources.add(chunk.source);
    } catch (error) {
      issues.push({
        line: lineNumber,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (chunkCount === 0 && issues.length === 0) {
    issues.push({ line: 0, message: 'Plik nie zawiera rekordów wiedzy.' });
  }

  return {
    valid: issues.length === 0 && chunkCount > 0,
    format: TETA_KNOWLEDGE_CHUNK_FORMAT,
    chunkCount,
    sources: [...sources].sort(),
    issues,
  };
}
