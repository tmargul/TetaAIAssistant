import type { TetaCandidateModelProvider } from './teta-candidate-model-provider';
import type { TopicSectionV1 } from './teta-topic-section.types';
import type { CanonicalSourceRecordV1 } from '../teta-source-extraction/teta-canonical-source.types';

export async function extractLocalModelCandidatesForSection(
  section: TopicSectionV1,
  source: CanonicalSourceRecordV1,
  provider: TetaCandidateModelProvider,
  modelRunId: string,
): Promise<{ status: 'ok' | 'unavailable' | 'model_output_invalid'; reason?: string }> {
  const status = await provider.getStatus();
  if (!status.available) {
    return { status: 'unavailable', reason: status.reason ?? 'model unavailable' };
  }
  const text = source.contentUnits
    .filter((u) => section.contentUnitRefs.includes(u.contentUnitId))
    .map((u) => u.text)
    .join('\n');
  try {
    await provider.extractCandidates({
      sectionTitle: section.title,
      headingPath: section.headingPath,
      sectionText: text,
      classificationHints: section.classificationHints as unknown as Record<string, string[]>,
      modelRunId,
    });
    return { status: 'ok' };
  } catch (e) {
    return { status: 'model_output_invalid', reason: String(e) };
  }
}
