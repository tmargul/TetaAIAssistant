import { readFileSync } from 'fs';
import {
  assetIdFromHash,
  contentUnitId,
  logicalSourceIdForVideo,
  normalizeTextForHash,
  sha256,
  sourceOccurrenceId,
} from './teta-canonical-source-contract';
import { inventoryFrameTimeline, linkSegmentToFrames } from './teta-frame-timeline.service';
import type { VideoArchiveDefaults } from './teta-source-extraction-config.loader';
import type { ContentUnitV1, FrameRef } from './teta-canonical-source.types';
import { validateWhisperTranscriptJson } from '../teta-knowledge-sources/teta-whisper-transcript-json.adapter';

export type TranscriptExtractionResult = {
  contentUnits: ContentUnitV1[];
  warnings: string[];
  transcriptSegments: number;
  language: string | null;
  durationSeconds: number;
  qualityFlagsCount: Record<string, number>;
};

export function extractWhisperTranscript(
  jsonPath: string,
  logicalSourceId: string,
  frameFileNames: string[],
  videoDefaults: VideoArchiveDefaults,
  frameAssetByFileName: Map<string, { assetId: string; relativePortablePath: string }>,
): TranscriptExtractionResult {
  const raw = readFileSync(jsonPath, 'utf8');
  const parsed = validateWhisperTranscriptJson(raw);
  const timeline = inventoryFrameTimeline(frameFileNames, videoDefaults);
  const warnings = [...parsed.warnings];
  const qualityFlagsCount: Record<string, number> = {};
  const contentUnits: ContentUnitV1[] = [];
  let order = 1;

  const segments = parsed.canonicalSegments.length
    ? parsed.canonicalSegments
    : [];

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const flags: string[] = [];
    if (!seg.text.trim()) {
      flags.push('empty_text');
      qualityFlagsCount.empty_text = (qualityFlagsCount.empty_text ?? 0) + 1;
    }
    const links = linkSegmentToFrames(seg.start, seg.end, timeline.frames);
    const frameRefs = {
      precedingFrameRef: toFrameRef(links.precedingFrameRef, frameAssetByFileName),
      nearestFrameRef: toFrameRef(links.nearestFrameRef, frameAssetByFileName),
      followingFrameRef: toFrameRef(links.followingFrameRef, frameAssetByFileName),
    };
    const id = contentUnitId(logicalSourceId, order, 'transcript_segment');
    contentUnits.push({
      contentUnitId: id,
      unitKind: 'transcript_segment',
      order,
      headingPath: [],
      text: seg.text,
      normalizedTextSha256: sha256(normalizeTextForHash(seg.text)),
      location: {
        pageNumber: null,
        paragraphIndex: null,
        tableIndex: null,
        rowIndex: null,
        segmentIndex: i,
        startSeconds: seg.start,
        endSeconds: seg.end,
      },
      assetRefs: [frameRefs.nearestFrameRef?.assetId].filter(Boolean) as string[],
      sourceOccurrenceId: sourceOccurrenceId(logicalSourceId, id),
      classificationStatus: 'unclassified',
      qualityFlags: flags.length ? flags : undefined,
      frameRefs,
    });
    order += 1;
  }

  return {
    contentUnits,
    warnings,
    transcriptSegments: segments.length,
    language: parsed.language,
    durationSeconds: parsed.durationSeconds,
    qualityFlagsCount,
  };
}

function toFrameRef(
  entry: { fileName: string; frameIndex: number; timestampSeconds: number } | null,
  frameAssetByFileName: Map<string, { assetId: string; relativePortablePath: string }>,
): FrameRef | null {
  if (!entry) return null;
  const asset = frameAssetByFileName.get(entry.fileName);
  if (!asset) {
    return {
      assetId: assetIdFromHash(sha256(entry.fileName)),
      relativePortablePath: `frames/${entry.fileName}`,
      timestampSeconds: entry.timestampSeconds,
      frameIndex: entry.frameIndex,
    };
  }
  return {
    assetId: asset.assetId,
    relativePortablePath: asset.relativePortablePath,
    timestampSeconds: entry.timestampSeconds,
    frameIndex: entry.frameIndex,
  };
}

export function buildVideoLogicalSourceId(bundleBasename: string): string {
  return logicalSourceIdForVideo(bundleBasename, 'ALL_MOVIES');
}
