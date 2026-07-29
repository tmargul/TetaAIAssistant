import type { CanonicalSourceRecordV1, ContentUnitV1 } from '../teta-source-extraction/teta-canonical-source.types';
import {
  STAGE3J2C_EXTRACTOR_VERSION,
  TETA_TOPIC_SECTION_CONTRACT_VERSION,
  type SectionBuildStats,
  type TopicSectionV1,
  type TranscriptNoiseBucketV1,
  type TranscriptNoiseKind,
} from './teta-topic-section.types';
import { applyApplicabilityFromSource, classifySectionHints } from './teta-section-classification-hints';
import { buildSectionId, computeSectionFingerprintSha256 } from './teta-topic-section-contract';
import { reconcileAssignment } from './teta-document-section-builder';
import {
  DEFAULT_MODEL_BUDGET_CONFIG,
  deriveNoiseClassificationStatus,
  type NoiseClassificationStatus,
} from './teta-candidate-model-config';

const TARGET_MIN_SECONDS = 45;
const TARGET_MAX_SECONDS = 120;
const ABS_MAX_SECONDS = 180;
const GAP_BOUNDARY_SECONDS = 8;

/** Substantive domain signals — if present, do NOT classify as noise even when admin words appear. */
const SUBSTANTIVE_OVERRIDE = [
  /formularz/i,
  /umow/i,
  /pracownik/i,
  /list[y]?\s+płac/i,
  /\bRCP\b/,
  /\bstatus\b/i,
  /składnik/i,
  /parametr/i,
  /konfigurac/i,
  /nalicz/i,
  /zatrudn/i,
  /przejęcie|przerwa\s+w\s+zatrudnieniu/i,
  /przerwa\s+nocna/i,
  /wpływ/i,
  /działanie/i,
  /wybrać/i,
  /utworzyć/i,
  /rejestrow/i,
];

const NOISE_PATTERNS: Array<{ kind: TranscriptNoiseKind; patterns: RegExp[]; reason: string }> = [
  {
    kind: 'screen_share_check',
    patterns: [/czy widać (mój )?ekran/i, /widzicie ekran/i, /share screen/i, /czy widać mój ekran/i],
    reason: 'screen visibility check',
  },
  {
    kind: 'audio_problem',
    patterns: [
      /proszę włączyć mikrofon/i,
      /słychać mnie/i,
      /czy mnie słychać/i,
      /sprawdźcie mikrofon/i,
      /nie słyszę/i,
      /problemy z mikrofon/i,
    ],
    reason: 'audio/microphone issue',
  },
  {
    kind: 'break_announcement',
    patterns: [/zrobimy teraz .+przerw/i, /dziesięć minut przerwy/i, /wracamy za/i, /przerwa na kawę/i, /robimy przerwę/i],
    reason: 'break announcement',
  },
  {
    kind: 'training_admin',
    patterns: [/sprawdzanie obecności/i, /zasady quizu/i, /dziękuję za uwagę/i, /dziękuję za obecność/i],
    reason: 'training administration',
  },
  {
    kind: 'repeated_phrase',
    patterns: [/^(dziękuję[.!]?\s*){2,}$/i, /^(ok\.?\s*){3,}$/i],
    reason: 'repeated filler phrase',
  },
];

export type NoiseDetectionResult = {
  kind: TranscriptNoiseKind;
  reason: string;
  confidence: 'high' | 'medium' | 'uncertain';
  excludedFromCandidateExtraction: boolean;
};

export function detectNoiseKind(text: string): NoiseDetectionResult | null {
  const t = text.trim();
  if (t.length < 4) {
    return {
      kind: 'uncertain',
      reason: 'very short segment',
      confidence: 'uncertain',
      excludedFromCandidateExtraction: false,
    };
  }
  if (SUBSTANTIVE_OVERRIDE.some((p) => p.test(t))) {
    return null;
  }
  for (const entry of NOISE_PATTERNS) {
    if (entry.patterns.some((p) => p.test(t))) {
      return {
        kind: entry.kind,
        reason: entry.reason,
        confidence: 'high',
        excludedFromCandidateExtraction: true,
      };
    }
  }
  if (/^(hm+|eee+|yyy+)\.?$/i.test(t)) {
    return {
      kind: 'repeated_phrase',
      reason: 'filler sounds',
      confidence: 'high',
      excludedFromCandidateExtraction: true,
    };
  }
  if (/mikrofon/i.test(t) && !SUBSTANTIVE_OVERRIDE.some((p) => p.test(t))) {
    return {
      kind: 'audio_problem',
      reason: 'microphone mention without domain context',
      confidence: 'medium',
      excludedFromCandidateExtraction: true,
    };
  }
  return null;
}

function segmentDuration(seg: ContentUnitV1): number {
  const start = seg.location.startSeconds ?? 0;
  const end = seg.location.endSeconds ?? start;
  return Math.max(0, end - start);
}

function segmentRange(segments: ContentUnitV1[]): { startSeconds: number | null; endSeconds: number | null } {
  if (!segments.length) return { startSeconds: null, endSeconds: null };
  const starts = segments.map((s) => s.location.startSeconds).filter((v): v is number => v != null);
  const ends = segments.map((s) => s.location.endSeconds).filter((v): v is number => v != null);
  return {
    startSeconds: starts.length ? Math.min(...starts) : null,
    endSeconds: ends.length ? Math.max(...ends) : null,
  };
}

function collectFrameRefs(segments: ContentUnitV1[]): {
  precedingFrameRefs: string[];
  nearestFrameRefs: string[];
  followingFrameRefs: string[];
} {
  const preceding = new Set<string>();
  const nearest = new Set<string>();
  const following = new Set<string>();
  for (const s of segments) {
    const fr = s.frameRefs;
    if (!fr) continue;
    if (fr.precedingFrameRef) preceding.add(fr.precedingFrameRef.assetId);
    if (fr.nearestFrameRef) nearest.add(fr.nearestFrameRef.assetId);
    if (fr.followingFrameRef) following.add(fr.followingFrameRef.assetId);
  }
  return {
    precedingFrameRefs: [...preceding].sort(),
    nearestFrameRefs: [...nearest].sort(),
    followingFrameRefs: [...following].sort(),
  };
}

function isTopicBoundary(prev: ContentUnitV1, next: ContentUnitV1, topicSeconds: number): boolean {
  const gap =
    (next.location.startSeconds ?? 0) - (prev.location.endSeconds ?? prev.location.startSeconds ?? 0);
  if (gap >= GAP_BOUNDARY_SECONDS) return true;
  if (topicSeconds >= TARGET_MAX_SECONDS) return true;
  const nextText = next.text.trim().toLowerCase();
  if (/^(teraz|następnie|kolejny temat|przejdźmy|rozdział|slajd)/i.test(nextText)) return true;
  if (/^#{1,3}\s/.test(next.text)) return true;
  return false;
}

function finalizeTranscriptSection(
  source: CanonicalSourceRecordV1,
  segments: ContentUnitV1[],
  order: number,
): TopicSectionV1 {
  const refs = segments.map((s) => s.contentUnitId);
  const range = segmentRange(segments);
  const duration = (range.endSeconds ?? 0) - (range.startSeconds ?? 0);
  const frames = collectFrameRefs(segments);
  const title = segments[0]?.text.slice(0, 120).trim() || null;
  const partial = {
    logicalSourceId: source.logicalSourceId,
    sourceRevisionId: source.sourceRevisionId,
    sourceType: source.sourceType as 'video_training',
    sectionKind: 'transcript_topic' as const,
    title,
    headingPath: title ? [title] : [],
    order,
    contentUnitRefs: refs,
    assetRefs: collectAssetRefsFromSegments(segments),
    location: { pageFrom: null, pageTo: null, ...range },
    qualityFlags: duration > ABS_MAX_SECONDS ? ['oversized_section'] : [],
    warnings: duration > ABS_MAX_SECONDS ? [`section_duration_${Math.round(duration)}s_exceeds_${ABS_MAX_SECONDS}s`] : [],
    segmentRefs: refs,
    ...frames,
  };
  const text = segments.map((s) => s.text).join('\n');
  const { hints, status, warnings: cw } = classifySectionHints(source, partial, text);
  const fp = computeSectionFingerprintSha256(partial);
  return {
    contractVersion: TETA_TOPIC_SECTION_CONTRACT_VERSION,
    sectionId: buildSectionId(partial),
    sectionFingerprintSha256: fp,
    ...partial,
    classificationHints: hints,
    classificationStatus: status,
    applicability: applyApplicabilityFromSource(source, hints),
    warnings: [...partial.warnings, ...cw],
    extractorVersion: STAGE3J2C_EXTRACTOR_VERSION,
  };
}

function collectAssetRefsFromSegments(segments: ContentUnitV1[]): string[] {
  const refs = new Set<string>();
  for (const s of segments) for (const a of s.assetRefs) refs.add(a);
  return [...refs].sort();
}

export type EnrichedNoiseBucket = TranscriptNoiseBucketV1 & {
  startSeconds: number | null;
  endSeconds: number | null;
  classifierMethod: 'deterministic_pattern';
  confidence: 'high' | 'medium' | 'uncertain';
};

export function buildTranscriptTopicSections(source: CanonicalSourceRecordV1): {
  sections: TopicSectionV1[];
  noiseBuckets: EnrichedNoiseBucket[];
  stats: SectionBuildStats;
  noiseClassificationStatus: NoiseClassificationStatus;
} {
  const units = [...source.contentUnits].sort((a, b) => a.order - b.order);
  const segments = units.filter((u) => u.unitKind === 'transcript_segment');
  const noiseBuckets: EnrichedNoiseBucket[] = [];
  const contentSegments: ContentUnitV1[] = [];
  let uncertainPreserved = 0;

  for (const seg of segments) {
    const noise = detectNoiseKind(seg.text);
    if (noise && noise.excludedFromCandidateExtraction) {
      noiseBuckets.push({
        noiseKind: noise.kind,
        segmentRefs: [seg.contentUnitId],
        excludedFromCandidateExtraction: true,
        reason: noise.reason,
        startSeconds: seg.location.startSeconds,
        endSeconds: seg.location.endSeconds,
        classifierMethod: 'deterministic_pattern',
        confidence: noise.confidence,
      });
    } else {
      if (noise?.kind === 'uncertain') uncertainPreserved += 1;
      contentSegments.push(seg);
    }
  }

  const sections: TopicSectionV1[] = [];
  let order = 0;
  let bucket: ContentUnitV1[] = [];
  let bucketSeconds = 0;

  const flush = () => {
    if (!bucket.length) return;
    order += 1;
    sections.push(finalizeTranscriptSection(source, bucket, order));
    bucket = [];
    bucketSeconds = 0;
  };

  for (let i = 0; i < contentSegments.length; i++) {
    const seg = contentSegments[i];
    const dur = segmentDuration(seg);
    if (bucket.length && isTopicBoundary(bucket[bucket.length - 1], seg, bucketSeconds)) {
      flush();
    }
    bucket.push(seg);
    bucketSeconds += dur;
    if (bucketSeconds >= TARGET_MIN_SECONDS && bucketSeconds <= TARGET_MAX_SECONDS) {
      const next = contentSegments[i + 1];
      if (!next || isTopicBoundary(seg, next, bucketSeconds)) flush();
    }
    if (bucketSeconds > ABS_MAX_SECONDS) flush();
  }
  flush();

  const assigned = new Map<string, number>();
  for (const s of sections) for (const r of s.contentUnitRefs) assigned.set(r, (assigned.get(r) ?? 0) + 1);
  const stats = reconcileAssignment(units, assigned, sections, noiseBuckets);
  const share = computeNoiseSharePercent(stats);
  const noiseClassificationStatus = deriveNoiseClassificationStatus(
    share,
    DEFAULT_MODEL_BUDGET_CONFIG.noiseShareReviewThresholdPercent,
  );
  void uncertainPreserved;
  return { sections, noiseBuckets, stats, noiseClassificationStatus };
}

export function computeNoiseSharePercent(stats: SectionBuildStats): number {
  if (stats.transcriptSegmentsTotal === 0) return 0;
  return Math.round((stats.transcriptSegmentsAssignedToNoise / stats.transcriptSegmentsTotal) * 10000) / 100;
}

export function computeTopicSharePercent(stats: SectionBuildStats): number {
  if (stats.transcriptSegmentsTotal === 0) return 0;
  return Math.round((stats.transcriptSegmentsAssignedToTopics / stats.transcriptSegmentsTotal) * 10000) / 100;
}

export function isSuspiciouslyHighNoise(stats: SectionBuildStats): boolean {
  return computeNoiseSharePercent(stats) > DEFAULT_MODEL_BUDGET_CONFIG.noiseShareReviewThresholdPercent;
}

export function reconcileTranscriptSegments(stats: SectionBuildStats): boolean {
  return (
    stats.transcriptSegmentsTotal
      === stats.transcriptSegmentsAssignedToTopics + stats.transcriptSegmentsAssignedToNoise
    && stats.transcriptSegmentsLost === 0
    && stats.transcriptSegmentsAssignedMultipleTimes === 0
  );
}
