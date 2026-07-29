import type { VideoArchiveDefaults } from './teta-source-extraction-config.loader';

export type FrameTimelineEntry = {
  fileName: string;
  frameIndex: number;
  timestampSeconds: number;
};

export type FrameTimelineInventory = {
  namingScheme: string;
  frameIndexBase: number;
  firstFrameTimestampSeconds: number;
  frameIntervalSeconds: number;
  configVersion: string;
  frames: FrameTimelineEntry[];
  duplicateFrameIndexes: number[];
  frameTimelineGaps: number[];
  invalidFrameIndexes: number[];
  unmatchedFileNames: string[];
};

export function computeFrameTimestampSeconds(
  frameIndex: number,
  defaults: VideoArchiveDefaults['frames'],
): number | null {
  if (!Number.isInteger(frameIndex) || frameIndex < defaults.frameIndexBase) return null;
  return (
    defaults.firstFrameTimestampSeconds +
    (frameIndex - defaults.frameIndexBase) * defaults.frameIntervalSeconds
  );
}

export function expectedFrameCountForDuration(
  durationSeconds: number,
  defaults: VideoArchiveDefaults['frames'],
): number {
  if (durationSeconds < defaults.firstFrameTimestampSeconds) return 0;
  return Math.floor((durationSeconds - defaults.firstFrameTimestampSeconds) / defaults.frameIntervalSeconds) + 1;
}

export function inventoryFrameTimeline(
  frameFileNames: string[],
  defaults: VideoArchiveDefaults,
): FrameTimelineInventory {
  const cfg = defaults.frames;
  const pattern = new RegExp(cfg.fileNamePattern, 'i');
  const frames: FrameTimelineEntry[] = [];
  const duplicateFrameIndexes: number[] = [];
  const invalidFrameIndexes: number[] = [];
  const unmatchedFileNames: string[] = [];
  const seen = new Map<number, number>();

  for (const fileName of [...frameFileNames].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const m = fileName.match(pattern);
    if (!m) {
      unmatchedFileNames.push(fileName);
      continue;
    }
    const frameIndex = Number(m[1]);
    const ts = computeFrameTimestampSeconds(frameIndex, cfg);
    if (ts == null) {
      invalidFrameIndexes.push(frameIndex);
      continue;
    }
    seen.set(frameIndex, (seen.get(frameIndex) ?? 0) + 1);
    frames.push({ fileName, frameIndex, timestampSeconds: ts });
  }

  for (const [idx, count] of seen) {
    if (count > 1) duplicateFrameIndexes.push(idx);
  }

  const sortedIndexes = frames.map((f) => f.frameIndex).sort((a, b) => a - b);
  const frameTimelineGaps: number[] = [];
  for (let i = 1; i < sortedIndexes.length; i += 1) {
    const prev = sortedIndexes[i - 1];
    const curr = sortedIndexes[i];
    if (curr - prev > 1) {
      for (let missing = prev + 1; missing < curr; missing += 1) frameTimelineGaps.push(missing);
    }
  }

  return {
    namingScheme: cfg.namingScheme,
    frameIndexBase: cfg.frameIndexBase,
    firstFrameTimestampSeconds: cfg.firstFrameTimestampSeconds,
    frameIntervalSeconds: cfg.frameIntervalSeconds,
    configVersion: defaults.contractVersion,
    frames,
    duplicateFrameIndexes,
    frameTimelineGaps,
    invalidFrameIndexes,
    unmatchedFileNames,
  };
}

export function linkSegmentToFrames(
  startSeconds: number,
  endSeconds: number,
  frames: FrameTimelineEntry[],
): {
  precedingFrameRef: FrameTimelineEntry | null;
  nearestFrameRef: FrameTimelineEntry | null;
  followingFrameRef: FrameTimelineEntry | null;
} {
  const midpoint = (startSeconds + endSeconds) / 2;
  let preceding: FrameTimelineEntry | null = null;
  let following: FrameTimelineEntry | null = null;
  let nearest: FrameTimelineEntry | null = null;
  let nearestDist = Infinity;

  for (const fr of frames) {
    if (fr.timestampSeconds <= midpoint) {
      if (!preceding || fr.timestampSeconds > preceding.timestampSeconds) preceding = fr;
    }
    if (fr.timestampSeconds >= midpoint) {
      if (!following || fr.timestampSeconds < following.timestampSeconds) following = fr;
    }
    const dist = Math.abs(fr.timestampSeconds - midpoint);
    if (dist < nearestDist || (dist === nearestDist && fr.timestampSeconds <= midpoint)) {
      nearestDist = dist;
      nearest = fr;
    }
  }

  return { precedingFrameRef: preceding, nearestFrameRef: nearest, followingFrameRef: following };
}
