export const VIDEO_INGEST_STATUSES = [
  'queued',
  'extracting',
  'transcribing',
  'indexing',
  'done',
  'failed',
] as const;

export type VideoIngestJobStatus = (typeof VIDEO_INGEST_STATUSES)[number];

export const VIDEO_INGEST_ACCEPT = '.mp4,video/mp4';

export interface VideoIngestJobRecord {
  id: number;
  originalFilename: string;
  status: VideoIngestJobStatus;
  progress: number;
  progressMessage: string | null;
  errorMessage: string | null;
  chunkCount: number | null;
  source: string | null;
  filmKey: string | null;
  mergeMode: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface VideoIngestJobsListResponse {
  jobs: VideoIngestJobRecord[];
}

export type VideoIngestStreamEvent =
  | {
      type: 'progress';
      jobId: number;
      status: VideoIngestJobStatus;
      progress: number;
      message: string;
    }
  | {
      type: 'complete';
      jobId: number;
      status: 'done';
      chunkCount: number;
      source: string | null;
    }
  | {
      type: 'error';
      jobId: number;
      message: string;
    };
