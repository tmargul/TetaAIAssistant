import { existsSync, readFileSync } from 'fs';
import path from 'path';

export type SourceSelectionPolicy = {
  contractVersion: string;
  registryVersion: string;
  documentExtensions: string[];
  allMoviesRelativeDirectory: string;
  allMoviesAllowedExtensions: {
    transcript: string[];
    video: string[];
    framesDirectory: boolean;
  };
  ignoredFilePatterns: string[];
  ignoredDirectoryNames: string[];
  ignoredExtensionsOutsideAllMovies: string[];
  jsonOutsideAllMoviesPolicy: string;
  pipelineOutputDirectoryNames: string[];
};

export type FolderHintEntry = {
  folderLabel: string;
  normalizedKey: string;
  hints: Array<{ hintKind: string; value: string }>;
  classificationStatus?: string;
  sectionLevelClassificationRequired?: boolean;
  applicabilityReviewRequired?: boolean;
  scopeClassificationRequired?: boolean;
};

export type DocumentFolderHintsRegistry = {
  contractVersion: string;
  registryVersion: string;
  hintKinds: string[];
  folders: FolderHintEntry[];
};

export type VideoArchiveDefaults = {
  contractVersion: string;
  scope: { relativeDirectory: string };
  transcription: Record<string, string>;
  frames: {
    namingScheme: string;
    fileNamePattern: string;
    frameIndexBase: number;
    firstFrameTimestampSeconds: number;
    frameIntervalSeconds: number;
    timestampFormula: string;
    timelineSource: string;
  };
};

export type Stage3j2bRegistries = {
  selectionPolicy: SourceSelectionPolicy;
  folderHints: DocumentFolderHintsRegistry;
  videoArchiveDefaults: VideoArchiveDefaults;
  selectionPolicyVersion: string;
  folderHintsVersion: string;
  videoArchiveDefaultsVersion: string;
};

function configDir(explicit?: string): string {
  return explicit ?? path.resolve(__dirname, '../../config/teta-knowledge-sources');
}

function readJson<T>(filePath: string): T {
  if (!existsSync(filePath)) throw new Error(`Missing config: ${filePath}`);
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

let cache: Stage3j2bRegistries | null = null;

export function loadStage3j2bRegistries(configDirectory?: string): Stage3j2bRegistries {
  if (cache && !configDirectory) return cache;
  const dir = configDir(configDirectory);
  const selectionPolicy = readJson<SourceSelectionPolicy>(
    path.join(dir, 'teta-source-selection-policy-v1.json'),
  );
  const folderHints = readJson<DocumentFolderHintsRegistry>(
    path.join(dir, 'teta-document-folder-hints-v1.json'),
  );
  const videoArchiveDefaults = readJson<VideoArchiveDefaults>(
    path.join(dir, 'teta-video-archive-defaults-v1.json'),
  );
  const loaded: Stage3j2bRegistries = {
    selectionPolicy,
    folderHints,
    videoArchiveDefaults,
    selectionPolicyVersion: selectionPolicy.registryVersion,
    folderHintsVersion: folderHints.registryVersion,
    videoArchiveDefaultsVersion: videoArchiveDefaults.contractVersion,
  };
  if (!configDirectory) cache = loaded;
  return loaded;
}

export function resetStage3j2bRegistryCache(): void {
  cache = null;
}

export function validateStage3j2bRegistries(regs: Stage3j2bRegistries): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (regs.selectionPolicy.contractVersion !== 'teta-source-selection-policy-v1') {
    errors.push('invalid_selection_policy_version');
  }
  if (regs.folderHints.contractVersion !== 'teta-document-folder-hints-v1') {
    errors.push('invalid_folder_hints_version');
  }
  if (regs.videoArchiveDefaults.contractVersion !== 'teta-video-archive-defaults-v1') {
    errors.push('invalid_video_archive_defaults_version');
  }
  if (regs.videoArchiveDefaults.frames.firstFrameTimestampSeconds !== 1) {
    errors.push('first_frame_must_be_1_second');
  }
  if (regs.videoArchiveDefaults.frames.frameIntervalSeconds !== 10) {
    errors.push('frame_interval_must_be_10_seconds');
  }
  const requiredFolders = ['EDU', 'TETA ME', 'KADRY', 'PLACE', 'RCP', 'FINANSE', 'PRZELOM ROKU', 'SCENARIUSZE', 'PROCESY', 'KSEF'];
  for (const label of requiredFolders) {
    if (!regs.folderHints.folders.some((f) => f.folderLabel === label)) {
      errors.push(`missing_folder_hint:${label}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
