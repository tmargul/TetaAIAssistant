import { normalizeBasenameKey } from './teta-knowledge-source-contract';
import type { LoadedKnowledgeSourceRegistries } from './teta-knowledge-source-registry.loader';
import type { ParsedSeriesLabel, TrainingSourceSeriesEntry } from './teta-knowledge-source.types';

/** Longest-prefix match against approved series aliases; no fuzzy auto-classification. */
export function parseTrainingSourceLabel(
  rawLabel: string,
  series: TrainingSourceSeriesEntry[],
): ParsedSeriesLabel {
  const sourceLabel = rawLabel.normalize('NFKC').trim();
  const key = normalizeBasenameKey(sourceLabel);
  const approved = series.filter((s) => s.status === 'approved');

  const candidates: Array<{ series: TrainingSourceSeriesEntry; alias: string }> = [];
  for (const s of approved) {
    for (const alias of [s.seriesId, ...s.aliases]) {
      candidates.push({ series: s, alias: normalizeBasenameKey(alias) });
    }
  }
  candidates.sort((a, b) => b.alias.length - a.alias.length);

  for (const c of candidates) {
    if (key === c.alias) {
      return {
        sourceSeriesId: c.series.seriesId,
        sequenceNumber: null,
        sourceLabel,
        classificationStatus: 'classified',
      };
    }
    if (key.startsWith(c.alias)) {
      const rest = key.slice(c.alias.length);
      if (rest === '') {
        return {
          sourceSeriesId: c.series.seriesId,
          sequenceNumber: null,
          sourceLabel,
          classificationStatus: 'classified',
        };
      }
      if (/^\d+$/.test(rest)) {
        return {
          sourceSeriesId: c.series.seriesId,
          sequenceNumber: Number(rest),
          sourceLabel,
          classificationStatus: 'classified',
        };
      }
    }
  }

  return {
    sourceSeriesId: null,
    sequenceNumber: null,
    sourceLabel,
    classificationStatus: 'unclassified',
  };
}

export function findSeriesEntry(
  seriesId: string | null,
  regs: LoadedKnowledgeSourceRegistries,
): TrainingSourceSeriesEntry | null {
  if (!seriesId) return null;
  return regs.series.find((s) => s.seriesId === seriesId && s.status === 'approved') ?? null;
}
