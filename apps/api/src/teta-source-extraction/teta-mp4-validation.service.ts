import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { expectedFrameCountForDuration } from './teta-frame-timeline.service';
import { sha256 } from './teta-canonical-source-contract';
import type { VideoArchiveDefaults } from './teta-source-extraction-config.loader';
import type { VideoValidationSummary } from './teta-canonical-source.types';

const execFileAsync = promisify(execFile);

export type Mp4ValidationInput = {
  videoPath: string | null;
  actualFrameCount: number;
  lastFrameTimestampSeconds: number | null;
  transcriptEndSeconds: number | null;
  ffprobePath?: string | null;
  videoDefaults: VideoArchiveDefaults;
};

export async function validateMp4Asset(input: Mp4ValidationInput): Promise<VideoValidationSummary> {
  const base: VideoValidationSummary = {
    videoDurationSeconds: null,
    expectedFrameCount: null,
    actualFrameCount: input.actualFrameCount,
    frameCountDifference: null,
    frameTimelineWithinVideo: null,
    transcriptEndWithinVideo: null,
    ffprobeAvailable: false,
    videoDurationValidation: 'unavailable',
    videoValidationWarnings: [],
    rawSourcePolicy: 'vendor_only',
    clientDistributionDefault: 'exclude',
  };
  if (!input.videoPath || !existsSync(input.videoPath)) {
    base.videoValidationWarnings.push('mp4_missing');
    return base;
  }
  const ffprobe = input.ffprobePath ?? 'ffprobe';
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      input.videoPath,
    ], { timeout: 30_000 });
    base.ffprobeAvailable = true;
    const durationSeconds = Number(String(stdout).trim());
    if (!Number.isFinite(durationSeconds)) {
      base.videoValidationWarnings.push('invalid_duration');
      return base;
    }
    base.videoDurationSeconds = durationSeconds;
    base.expectedFrameCount = expectedFrameCountForDuration(durationSeconds, input.videoDefaults.frames);
    base.frameCountDifference = Math.abs(input.actualFrameCount - base.expectedFrameCount);
    const tolerance = 1;
    base.frameTimelineWithinVideo =
      input.lastFrameTimestampSeconds == null ? null : input.lastFrameTimestampSeconds <= durationSeconds + tolerance;
    base.transcriptEndWithinVideo =
      input.transcriptEndSeconds == null ? null : input.transcriptEndSeconds <= durationSeconds + tolerance;
    if (base.frameCountDifference <= tolerance) base.videoDurationValidation = 'ok';
    else {
      base.videoDurationValidation = 'mismatch';
      base.videoValidationWarnings.push('frame_count_mismatch');
    }
    if (base.frameTimelineWithinVideo === false) base.videoValidationWarnings.push('last_frame_beyond_video');
    if (base.transcriptEndWithinVideo === false) base.videoValidationWarnings.push('transcript_end_beyond_video');
    void sha256(readFileSync(input.videoPath));
    return base;
  } catch {
    base.videoValidationWarnings.push('ffprobe_unavailable');
    return base;
  }
}

export function resolveFfprobePath(explicit?: string | null): string {
  return explicit ?? process.env.TETA_FFPROBE_PATH ?? 'ffprobe';
}
