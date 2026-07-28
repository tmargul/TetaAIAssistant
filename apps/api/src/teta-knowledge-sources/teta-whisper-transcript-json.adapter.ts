import { readFileSync } from 'fs';
import { computeCanonicalTranscriptHash } from './teta-knowledge-source-fingerprint';
import type { TranscriptFormat, WhisperTranscriptValidation } from './teta-knowledge-source.types';

type WhisperSegment = {
  start?: unknown;
  end?: unknown;
  text?: unknown;
  avg_logprob?: unknown;
  compression_ratio?: unknown;
  no_speech_prob?: unknown;
};

export type WhisperTranscriptValidationExtended = WhisperTranscriptValidation & {
  canonicalSha256: string | null;
  canonicalSegments: Array<{ start: number; end: number; text: string }>;
};

export function validateWhisperTranscriptJson(raw: string | Buffer): WhisperTranscriptValidationExtended {
  const warnings: string[] = [];
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  } catch {
    return {
      transcriptFormat: 'unsupported_json',
      segmentCount: 0,
      durationSeconds: 0,
      language: null,
      qualityMetricsAvailable: false,
      validationStatus: 'invalid',
      emptySegments: 0,
      nonMonotonicSegments: 0,
      invalidSegmentTimes: 0,
      warnings,
      errors: ['json_parse_error'],
      canonicalSha256: null,
      canonicalSegments: [],
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      transcriptFormat: 'unsupported_json',
      segmentCount: 0,
      durationSeconds: 0,
      language: null,
      qualityMetricsAvailable: false,
      validationStatus: 'invalid',
      emptySegments: 0,
      nonMonotonicSegments: 0,
      invalidSegmentTimes: 0,
      warnings,
      errors: ['not_object'],
      canonicalSha256: null,
      canonicalSegments: [],
    };
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.segments)) {
    return {
      transcriptFormat: 'generic_json',
      segmentCount: 0,
      durationSeconds: 0,
      language: typeof obj.language === 'string' ? obj.language : null,
      qualityMetricsAvailable: false,
      validationStatus: 'invalid',
      emptySegments: 0,
      nonMonotonicSegments: 0,
      invalidSegmentTimes: 0,
      warnings,
      errors: ['segments_not_array'],
      canonicalSha256: null,
      canonicalSegments: [],
    };
  }

  const segments = obj.segments as WhisperSegment[];
  let emptySegments = 0;
  let nonMonotonicSegments = 0;
  let invalidSegmentTimes = 0;
  let prevEnd = -Infinity;
  let maxEnd = 0;
  let qualityMetricsAvailable = false;
  const canonicalSegments: Array<{ start: number; end: number; text: string }> = [];

  for (const seg of segments) {
    const start = Number(seg.start);
    const end = Number(seg.end);
    const text = typeof seg.text === 'string' ? seg.text : '';
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      invalidSegmentTimes += 1;
      errors.push('nan_or_infinity_time');
      continue;
    }
    if (start < 0 || end < start) {
      invalidSegmentTimes += 1;
      continue;
    }
    if (start < prevEnd - 1e-9) nonMonotonicSegments += 1;
    prevEnd = start;
    if (end > maxEnd) maxEnd = end;
    if (!text.trim()) emptySegments += 1;
    if (seg.avg_logprob != null || seg.compression_ratio != null || seg.no_speech_prob != null) {
      qualityMetricsAvailable = true;
    }
    canonicalSegments.push({ start, end, text });
  }

  if (emptySegments) warnings.push('empty_segments');
  if (nonMonotonicSegments) warnings.push('non_monotonic_segments');
  if (invalidSegmentTimes) errors.push('invalid_segment_times');
  if (obj.language == null) warnings.push('language_missing');

  const language = typeof obj.language === 'string' ? obj.language : null;
  const validationStatus: WhisperTranscriptValidation['validationStatus'] =
    errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'valid_with_warnings' : 'valid';

  return {
    transcriptFormat: 'whisper_segments_json' as TranscriptFormat,
    segmentCount: segments.length,
    durationSeconds: maxEnd,
    language,
    qualityMetricsAvailable,
    validationStatus,
    emptySegments,
    nonMonotonicSegments,
    invalidSegmentTimes,
    warnings,
    errors,
    canonicalSha256: computeCanonicalTranscriptHash({ language, segments: canonicalSegments }),
    canonicalSegments,
  };
}

export function validateWhisperTranscriptFile(filePath: string): WhisperTranscriptValidationExtended {
  return validateWhisperTranscriptJson(readFileSync(filePath));
}
