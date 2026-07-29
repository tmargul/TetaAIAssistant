import { detectNoiseKind } from './teta-transcript-topic-builder';

export type AdminCueKind =
  | 'screen_share_check'
  | 'audio_microphone_check'
  | 'break_announcement'
  | 'attendance_organizational'
  | 'repeated_thanks'
  | 'other_admin';

export type AdminCueClassification =
  | 'noise'
  | 'topic_with_context'
  | 'unresolved';

export type AdminCueSegment = {
  segmentKey: string;
  cueKind: AdminCueKind;
  classification: AdminCueClassification;
  reason: string;
};

const CUE_PATTERNS: Array<{ kind: AdminCueKind; patterns: RegExp[] }> = [
  {
    kind: 'screen_share_check',
    patterns: [/czy widać (mój )?ekran/i, /widzicie ekran/i, /share screen/i, /ekran/i],
  },
  {
    kind: 'audio_microphone_check',
    patterns: [/mikrofon/i, /słychać mnie/i, /czy mnie słychać/i, /problemy z audio/i],
  },
  {
    kind: 'break_announcement',
    patterns: [/robimy przerwę/i, /przerwa na kawę/i, /wracamy za/i, /dziesięć minut przerwy/i, /\bprzerw[aęy]\b/i],
  },
  {
    kind: 'attendance_organizational',
    patterns: [/sprawdzanie obecności/i, /dziękuję za obecność/i, /zasady quizu/i],
  },
  {
    kind: 'repeated_thanks',
    patterns: [/^(dziękuję[.!]?\s*){2,}$/i, /dziękuję za uwagę/i],
  },
];

/** Contextual exceptions: admin-like words used in substantive domain content. */
const CONTEXT_EXCEPTIONS: RegExp[] = [
  /na ekranie formularza/i,
  /ekran(ie)?\s+(formularza|raportu|listy)/i,
  /przerwa\s+(w\s+rozumieniu\s+)?RCP/i,
  /przerwa\s+(nocna|w\s+zatrudnieniu)/i,
  /mikrofon\s+(w\s+)?(opis|funkcj|konfigur)/i,
  /funkcjonalności.*mikrofon/i,
];

export function detectAdministrativeCue(text: string): { kind: AdminCueKind; reason: string } | null {
  const t = text.trim();
  for (const entry of CUE_PATTERNS) {
    if (entry.patterns.some((p) => p.test(t))) {
      return { kind: entry.kind, reason: entry.kind };
    }
  }
  return null;
}

export function classifyAdministrativeCue(text: string): AdminCueSegment | null {
  const cue = detectAdministrativeCue(text);
  if (!cue) return null;
  if (CONTEXT_EXCEPTIONS.some((p) => p.test(text))) {
    return {
      segmentKey: '',
      cueKind: cue.kind,
      classification: 'topic_with_context',
      reason: 'contextual_exception_substantive_domain',
    };
  }
  const noise = detectNoiseKind(text);
  if (noise && noise.excludedFromCandidateExtraction) {
    return {
      segmentKey: '',
      cueKind: cue.kind,
      classification: 'noise',
      reason: noise.reason,
    };
  }
  if (noise && noise.confidence === 'uncertain') {
    return {
      segmentKey: '',
      cueKind: cue.kind,
      classification: 'unresolved',
      reason: 'uncertain_noise',
    };
  }
  // Cue word present but noise detector declined (often substantive override) → topic with context
  if (!noise) {
    return {
      segmentKey: '',
      cueKind: cue.kind,
      classification: 'topic_with_context',
      reason: 'admin_cue_word_in_substantive_or_non_noise_context',
    };
  }
  return {
    segmentKey: '',
    cueKind: cue.kind,
    classification: 'unresolved',
    reason: 'admin_cue_without_confirmed_noise_classification',
  };
}

export type NoiseRecallStats = {
  administrativeCueSegmentsFound: number;
  administrativeCueSegmentsClassifiedAsNoise: number;
  administrativeCueSegmentsClassifiedAsTopicWithContext: number;
  administrativeCueSegmentsUnresolved: number;
  knownNoiseRecallPercent: number;
  substantiveSegmentsIncorrectlyMarkedNoise: number;
  administrativeSegmentsIncorrectlyMarkedTopic: number;
  uncertainNoiseSegmentsAutoExcluded: number;
  explanationWhenNoiseUnderCount: string | null;
};

export function evaluateNoiseRecall(
  segments: Array<{ key: string; text: string; classifiedAsNoise: boolean }>,
): NoiseRecallStats {
  const cues: AdminCueSegment[] = [];
  let substantiveFp = 0;
  let adminAsTopic = 0;
  let uncertainExcluded = 0;

  for (const seg of segments) {
    const cue = classifyAdministrativeCue(seg.text);
    if (cue) {
      cues.push({ ...cue, segmentKey: seg.key });
      if (cue.classification === 'noise' && !seg.classifiedAsNoise) {
        // expected noise but marked topic — may be false negative unless unresolved
        if (cue.classification === 'noise') adminAsTopic += 0;
      }
      if (cue.classification === 'topic_with_context' && seg.classifiedAsNoise) {
        substantiveFp += 1;
      }
      if (cue.classification === 'noise' && !seg.classifiedAsNoise) {
        adminAsTopic += 1;
      }
    }
    const noise = detectNoiseKind(seg.text);
    if (noise?.confidence === 'uncertain' && noise.excludedFromCandidateExtraction) {
      uncertainExcluded += 1;
    }
  }

  const asNoise = cues.filter((c) => c.classification === 'noise').length;
  const asTopic = cues.filter((c) => c.classification === 'topic_with_context').length;
  const unresolved = cues.filter((c) => c.classification === 'unresolved').length;
  const expectedNoise = asNoise; // among cues that should be noise
  const actualNoiseAmongExpected = segments.filter((s) => {
    const c = classifyAdministrativeCue(s.text);
    return c?.classification === 'noise' && s.classifiedAsNoise;
  }).length;

  const knownNoiseRecallPercent =
    expectedNoise === 0 ? 100 : Math.round((actualNoiseAmongExpected / expectedNoise) * 10000) / 100;

  let explanation: string | null = null;
  if (cues.length > 1 && segments.filter((s) => s.classifiedAsNoise).length <= 1) {
    explanation = [
      `administrativeCueSegmentsFound=${cues.length}`,
      `classifiedAsNoise=${asNoise}`,
      `classifiedAsTopicWithContext=${asTopic}`,
      `unresolved=${unresolved}`,
      'remaining cues are contextual topic exceptions or unresolved pending review',
    ].join('; ');
  }

  return {
    administrativeCueSegmentsFound: cues.length,
    administrativeCueSegmentsClassifiedAsNoise: asNoise,
    administrativeCueSegmentsClassifiedAsTopicWithContext: asTopic,
    administrativeCueSegmentsUnresolved: unresolved,
    knownNoiseRecallPercent,
    substantiveSegmentsIncorrectlyMarkedNoise: substantiveFp,
    administrativeSegmentsIncorrectlyMarkedTopic: adminAsTopic,
    uncertainNoiseSegmentsAutoExcluded: uncertainExcluded,
    explanationWhenNoiseUnderCount: explanation,
  };
}
