import type { AppMode } from './rag.js';

export const TETA_WORK_MODE_HEADER = 'x-teta-work-mode';

export const WORK_MODE_LABELS: Record<AppMode, { title: string; hint: string }> = {
  client: {
    title: 'Klient',
    hint: 'Widok wdrożenia — bez podglądu SQL i narzędzi vendor',
  },
  vendor: {
    title: 'Vendor',
    hint: 'Budowa RAG, metadane Oracle i pełna diagnostyka',
  },
};
