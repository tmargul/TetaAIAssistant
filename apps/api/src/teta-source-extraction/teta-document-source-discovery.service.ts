import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import {
  normalizeBasenameKey,
  normalizeRelativePath,
  splitRelativeDirectorySegments,
} from './teta-canonical-source-contract';
import type {
  DiscoveryCandidate,
  DocumentDiscoveryResult,
  MovieSourceBundle,
} from './teta-canonical-source.types';
import type { SourceSelectionPolicy } from './teta-source-extraction-config.loader';

function isTemporaryFile(name: string, policy: SourceSelectionPolicy): boolean {
  if (name.startsWith('~$')) return true;
  if (name.startsWith('.')) return true;
  for (const pat of policy.ignoredFilePatterns) {
    if (pat === '~$*' && name.startsWith('~$')) return true;
    if (pat === '.*' && name.startsWith('.')) return true;
    if (pat.startsWith('*.') && name.toLowerCase().endsWith(pat.slice(1))) return true;
  }
  return false;
}

function shouldIgnoreDirectory(name: string, policy: SourceSelectionPolicy): boolean {
  return policy.ignoredDirectoryNames.includes(name) || policy.pipelineOutputDirectoryNames.includes(name);
}

function isInAllMovies(relativePath: string, policy: SourceSelectionPolicy): boolean {
  const norm = normalizeRelativePath(relativePath);
  const parts = norm.split('/');
  return parts.some((p) => normalizeBasenameKey(p) === normalizeBasenameKey(policy.allMoviesRelativeDirectory));
}

function allMoviesParent(relativePath: string, policy: SourceSelectionPolicy): string | null {
  const parts = normalizeRelativePath(relativePath).split('/');
  for (let i = 0; i < parts.length; i += 1) {
    if (normalizeBasenameKey(parts[i]) === normalizeBasenameKey(policy.allMoviesRelativeDirectory)) {
      return parts.slice(0, i + 1).join('/');
    }
  }
  return null;
}

export function discoverDocumentSources(root: string, policy: SourceSelectionPolicy): DocumentDiscoveryResult {
  let filesExamined = 0;
  let directoriesExamined = 0;
  let nonFrameDirectoriesExamined = 0;
  let ignoredFiles = 0;
  let temporaryFilesIgnored = 0;
  let jsonOutsideAllMoviesIgnored = 0;
  let unsupportedExtensionsIgnored = 0;
  let otherFilesIgnored = 0;
  let documentFilesSelected = 0;
  let transcriptJsonFilesSelected = 0;
  let mp4FilesSelected = 0;
  let frameImageFilesSelected = 0;
  const documentCandidates: DiscoveryCandidate[] = [];
  const movieTranscriptCandidates: DiscoveryCandidate[] = [];
  const movieVideoCandidates: DiscoveryCandidate[] = [];
  const movieFrameDirectories: string[] = [];
  const movieBundlesMap = new Map<string, MovieSourceBundle>();

  function walk(currentAbs: string, relativePrefix: string): void {
    if (!existsSync(currentAbs)) return;
    for (const entry of readdirSync(currentAbs, { withFileTypes: true })) {
      if (shouldIgnoreDirectory(entry.name, policy)) continue;
      const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const abs = path.join(currentAbs, entry.name);
      if (entry.isDirectory()) {
        directoriesExamined += 1;
        walk(abs, rel);
        continue;
      }
      filesExamined += 1;
      if (isTemporaryFile(entry.name, policy)) {
        temporaryFilesIgnored += 1;
        ignoredFiles += 1;
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      const basename = path.basename(entry.name, ext);
      const normalizedBasename = normalizeBasenameKey(basename);
      const parentRelativeDirectory = path.posix.dirname(normalizeRelativePath(rel));
      const inAllMovies = isInAllMovies(rel, policy);

      if (inAllMovies) {
        if (/\.(jpg|jpeg|png|webp)$/i.test(ext)) {
          frameImageFilesSelected += 1;
          continue;
        }
        if (ext !== '.json' && ext !== '.mp4') {
          ignoredFiles += 1;
          if (policy.ignoredExtensionsOutsideAllMovies.includes(ext) || ext === '.json') otherFilesIgnored += 1;
          else unsupportedExtensionsIgnored += 1;
          continue;
        }
        const moviesRoot = allMoviesParent(rel, policy) ?? parentRelativeDirectory;
        const bundleKey = `${moviesRoot}|${normalizedBasename}`;
        const bundle =
          movieBundlesMap.get(bundleKey) ??
          ({
            basename,
            normalizedBasename,
            parentRelativeDirectory: moviesRoot,
            transcriptRelativePath: null,
            framesRelativeDirectory: null,
            videoRelativePath: null,
            pairingStatus: 'partial',
          } satisfies MovieSourceBundle);
        if (ext === '.json' && policy.allMoviesAllowedExtensions.transcript.includes(ext)) {
          bundle.transcriptRelativePath = rel;
          transcriptJsonFilesSelected += 1;
          movieTranscriptCandidates.push(makeCandidate('movie_transcript', rel, entry.name, ext, basename, normalizedBasename, parentRelativeDirectory, true));
        } else if (ext === '.mp4' && policy.allMoviesAllowedExtensions.video.includes(ext)) {
          bundle.videoRelativePath = rel;
          mp4FilesSelected += 1;
          movieVideoCandidates.push(makeCandidate('movie_video', rel, entry.name, ext, basename, normalizedBasename, parentRelativeDirectory, true));
        }
        movieBundlesMap.set(bundleKey, bundle);
        continue;
      }

      if (ext === '.json') {
        jsonOutsideAllMoviesIgnored += 1;
        ignoredFiles += 1;
        otherFilesIgnored += 1;
        continue;
      }

      if (policy.documentExtensions.includes(ext)) {
        documentFilesSelected += 1;
        documentCandidates.push(makeCandidate('document', rel, entry.name, ext, basename, normalizedBasename, parentRelativeDirectory, false));
        continue;
      }

      ignoredFiles += 1;
      if (policy.ignoredExtensionsOutsideAllMovies.includes(ext)) {
        unsupportedExtensionsIgnored += 1;
      } else {
        otherFilesIgnored += 1;
      }
    }
  }

  // Second pass for frame directories inside ALL_MOVIES
  function walkDirs(currentAbs: string, relativePrefix: string): void {
    if (!existsSync(currentAbs)) return;
    for (const entry of readdirSync(currentAbs, { withFileTypes: true })) {
      if (shouldIgnoreDirectory(entry.name, policy)) continue;
      const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const abs = path.join(currentAbs, entry.name);
      if (!entry.isDirectory()) continue;
      directoriesExamined += 1;
      if (isInAllMovies(rel, policy)) {
        if (normalizeBasenameKey(rel) === normalizeBasenameKey(policy.allMoviesRelativeDirectory)) {
          walkDirs(abs, rel);
          continue;
        }
        const normalizedDirName = normalizeBasenameKey(entry.name);
        const moviesRoot = allMoviesParent(rel, policy) ?? path.posix.dirname(normalizeRelativePath(rel));
        const bundleKey = `${moviesRoot}|${normalizedDirName}`;
        const bundle =
          movieBundlesMap.get(bundleKey) ??
          ({
            basename: entry.name,
            normalizedBasename: normalizedDirName,
            parentRelativeDirectory: moviesRoot,
            transcriptRelativePath: null,
            framesRelativeDirectory: null,
            videoRelativePath: null,
            pairingStatus: 'partial',
          } satisfies MovieSourceBundle);
        const childFiles = readdirSync(abs, { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => e.name);
        const hasFrames = childFiles.some((name) => /^frame_(\d{5})\.(jpg|jpeg|png|webp)$/i.test(name));
        if (normalizeBasenameKey(path.basename(rel)) === normalizedDirName && hasFrames) {
          bundle.framesRelativeDirectory = rel;
          movieFrameDirectories.push(rel);
        } else {
          nonFrameDirectoriesExamined += 1;
        }
        movieBundlesMap.set(bundleKey, bundle);
      } else {
        nonFrameDirectoriesExamined += 1;
      }
      walkDirs(abs, rel);
    }
  }

  walk(root, '');
  walkDirs(root, '');

  for (const bundle of movieBundlesMap.values()) {
    const hasTranscript = Boolean(bundle.transcriptRelativePath);
    const hasFrames = Boolean(bundle.framesRelativeDirectory);
    const hasMp4 = Boolean(bundle.videoRelativePath);
    if (hasTranscript && hasFrames && hasMp4) bundle.pairingStatus = 'transcript_and_frames_and_mp4';
    else if (hasTranscript && hasFrames) bundle.pairingStatus = 'transcript_and_frames';
    else if (hasTranscript && hasMp4) bundle.pairingStatus = 'transcript_and_mp4_without_frames';
    else if (hasFrames && hasMp4) bundle.pairingStatus = 'frames_and_mp4_without_transcript';
    else if (hasTranscript) bundle.pairingStatus = 'transcript_only';
    else if (hasFrames) bundle.pairingStatus = 'frames_only';
    else if (hasMp4) bundle.pairingStatus = 'mp4_only';
    else bundle.pairingStatus = 'complete';
  }

  const bundles = [...movieBundlesMap.values()];
  const uniqueMovieBasenames = bundles.length;
  const hasTranscript = (b: MovieSourceBundle) => Boolean(b.transcriptRelativePath);
  const hasFrames = (b: MovieSourceBundle) => Boolean(b.framesRelativeDirectory);
  const hasMp4 = (b: MovieSourceBundle) => Boolean(b.videoRelativePath);
  const bundlesWithTranscript = bundles.filter(hasTranscript).length;
  const bundlesWithFrames = bundles.filter(hasFrames).length;
  const bundlesWithTranscriptAndFrames = bundles.filter((b) => hasTranscript(b) && hasFrames(b)).length;
  const completeCoreMovieBundles = bundlesWithTranscriptAndFrames;
  const partialCoreMovieBundles = uniqueMovieBasenames - completeCoreMovieBundles;
  const bundlesWithOptionalMp4 = bundles.filter(hasMp4).length;
  const bundlesWithoutOptionalMp4 = uniqueMovieBasenames - bundlesWithOptionalMp4;
  const bundlesWithAllThreeAssets = bundles.filter((b) => hasTranscript(b) && hasFrames(b) && hasMp4(b)).length;
  const transcriptAndFramesBundles = bundles.filter((b) => b.pairingStatus === 'transcript_and_frames').length;
  const transcriptFramesAndMp4Bundles = bundles.filter((b) => b.pairingStatus === 'transcript_and_frames_and_mp4').length;
  const transcriptOnlyBundles = bundles.filter((b) => b.pairingStatus === 'transcript_only').length;
  const framesOnlyBundles = bundles.filter((b) => b.pairingStatus === 'frames_only').length;
  const mp4OnlyBundles = bundles.filter((b) => b.pairingStatus === 'mp4_only').length;
  const transcriptAndMp4WithoutFramesBundles = bundles.filter((b) => b.pairingStatus === 'transcript_and_mp4_without_frames').length;
  const framesAndMp4WithoutTranscriptBundles = bundles.filter((b) => b.pairingStatus === 'frames_and_mp4_without_transcript').length;
  const completeMovieBundles = completeCoreMovieBundles;
  const partialMovieBundles = partialCoreMovieBundles;
  const movieBundleRecordsCreated = uniqueMovieBasenames;
  const frameDirectoriesSelected = movieFrameDirectories.length;
  const frameFilesIncorrectlyCountedAsMovieBundles = 0;
  const fileCategoryReconciliationOk = filesExamined === (
    documentFilesSelected
    + transcriptJsonFilesSelected
    + mp4FilesSelected
    + frameImageFilesSelected
    + temporaryFilesIgnored
    + unsupportedExtensionsIgnored
    + otherFilesIgnored
  );

  return {
    filesExamined,
    directoriesExamined,
    nonFrameDirectoriesExamined,
    documentCandidates,
    movieBundles: bundles,
    movieTranscriptCandidates,
    movieFrameDirectories,
    movieVideoCandidates,
    frameImageFilesSelected,
    documentFilesSelected,
    transcriptJsonFilesSelected,
    mp4FilesSelected,
    otherFilesIgnored,
    ignoredFiles,
    temporaryFilesIgnored,
    jsonOutsideAllMoviesIgnored,
    unsupportedExtensionsIgnored,
    fileCategoryReconciliationOk,
    uniqueMovieBasenames,
    frameDirectoriesSelected,
    movieBundleRecordsCreated,
    completeCoreMovieBundles,
    partialCoreMovieBundles,
    bundlesWithTranscript,
    bundlesWithFrames,
    bundlesWithTranscriptAndFrames,
    bundlesWithOptionalMp4,
    bundlesWithoutOptionalMp4,
    bundlesWithAllThreeAssets,
    completeMovieBundles,
    transcriptAndFramesBundles,
    transcriptFramesAndMp4Bundles,
    transcriptOnlyBundles,
    framesOnlyBundles,
    mp4OnlyBundles,
    transcriptAndMp4WithoutFramesBundles,
    framesAndMp4WithoutTranscriptBundles,
    ambiguousMovieBundles: 0,
    partialMovieBundles,
    frameFilesIncorrectlyCountedAsMovieBundles,
    docxCandidates: documentCandidates.filter((d) => d.extension === '.docx').length,
    legacyDocCandidates: documentCandidates.filter((d) => d.extension === '.doc').length,
    pdfCandidates: documentCandidates.filter((d) => d.extension === '.pdf').length,
  };
}

function makeCandidate(
  kind: DiscoveryCandidate['kind'],
  rel: string,
  fileName: string,
  ext: string,
  basename: string,
  normalizedBasename: string,
  parentRelativeDirectory: string,
  inAllMovies: boolean,
): DiscoveryCandidate {
  return {
    kind,
    relativePath: normalizeRelativePath(rel),
    normalizedRelativePath: normalizeRelativePath(rel),
    relativeDirectorySegments: splitRelativeDirectorySegments(rel),
    fileName,
    extension: ext,
    basename,
    normalizedBasename,
    parentRelativeDirectory: normalizeRelativePath(parentRelativeDirectory),
    inAllMovies,
  };
}

export function pairMovieBundle(bundle: MovieSourceBundle): {
  accepted: boolean;
  reason: string | null;
} {
  const transcriptBase = bundle.transcriptRelativePath
    ? normalizeBasenameKey(path.basename(bundle.transcriptRelativePath, '.json'))
    : null;
  const framesBase = bundle.framesRelativeDirectory
    ? normalizeBasenameKey(path.basename(bundle.framesRelativeDirectory))
    : null;
  const videoBase = bundle.videoRelativePath
    ? normalizeBasenameKey(path.basename(bundle.videoRelativePath, '.mp4'))
    : null;
  if (transcriptBase && framesBase && transcriptBase !== framesBase) {
    return { accepted: false, reason: 'basename_mismatch_transcript_frames' };
  }
  if (transcriptBase && videoBase && transcriptBase !== videoBase) {
    return { accepted: false, reason: 'basename_mismatch_transcript_video' };
  }
  return { accepted: true, reason: null };
}
