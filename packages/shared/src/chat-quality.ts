export const CHAT_QUALITY_MODES = ['low', 'medium', 'high'] as const;
export type ChatQualityMode = (typeof CHAT_QUALITY_MODES)[number];

export const DEFAULT_CHAT_QUALITY: ChatQualityMode = 'low';

export const CHAT_QUALITY_LABELS: Record<ChatQualityMode, string> = {
  low: 'Niska (szybko)',
  medium: 'Średnia',
  high: 'Najlepsza',
};

export const CHAT_QUALITY_HINTS: Record<ChatQualityMode, string> = {
  low: 'Krótkie odpowiedzi, minimum czasu — ustawienia jak dotychczas.',
  medium: 'Więcej kontekstu RAG i dłuższe odpowiedzi.',
  high: 'Maksymalna jakość — model dłużej rozumuje, pełniejsze odpowiedzi bez ucinania.',
};

export function resolveChatQualityMode(value: unknown): ChatQualityMode {
  if (typeof value === 'string' && (CHAT_QUALITY_MODES as readonly string[]).includes(value)) {
    return value as ChatQualityMode;
  }
  return DEFAULT_CHAT_QUALITY;
}
