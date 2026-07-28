import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { normalizeBasenameKey } from './teta-knowledge-source-contract';
import type { PairDiscoveryResult, PairingStatus } from './teta-knowledge-source.types';

const DOC_EXTS = new Set(['.pdf', '.docx', '.rtf', '.txt', '.html', '.json', '.jsonl', '.mp4']);
const FRAME_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function listImmediate(root: string): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  const dirs: string[] = [];
  if (!existsSync(root)) return { files, dirs };
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) dirs.push(entry.name);
    else files.push(entry.name);
  }
  return { files: files.sort(), dirs: dirs.sort() };
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export type DiscoveryScan = {
  transcriptJsonFiles: string[];
  frameDirectories: string[];
  supportedDocuments: string[];
  unsupportedFiles: string[];
  pairs: PairDiscoveryResult[];
  duplicateBasenamesInDirectory: string[];
  fuzzyPairSuggestions: number;
  fuzzyPairsAutomaticallyAccepted: number;
  exactPairs: number;
  caseInsensitiveExactPairs: number;
  transcriptsWithoutFrames: number;
  frameDirectoriesWithoutTranscript: number;
  ambiguousPairings: number;
};

export function discoverTrainingPairs(root: string): DiscoveryScan {
  const { files, dirs } = listImmediate(root);
  const dirKeys = new Map<string, string[]>();
  for (const d of dirs) {
    const k = normalizeBasenameKey(d);
    const list = dirKeys.get(k) ?? [];
    list.push(d);
    dirKeys.set(k, list);
  }

  const transcriptJsonFiles: string[] = [];
  const supportedDocuments: string[] = [];
  const unsupportedFiles: string[] = [];
  const pairs: PairDiscoveryResult[] = [];
  const duplicateBasenamesInDirectory: string[] = [];
  let fuzzyPairSuggestions = 0;
  let exactPairs = 0;
  let caseInsensitiveExactPairs = 0;
  let ambiguousPairings = 0;
  const pairedDirs = new Set<string>();

  const basenameCounts = new Map<string, number>();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const base = path.basename(f, ext);
    const key = normalizeBasenameKey(base);
    basenameCounts.set(key, (basenameCounts.get(key) ?? 0) + 1);
  }
  for (const [k, c] of basenameCounts) {
    if (c > 1) duplicateBasenamesInDirectory.push(k);
  }

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!DOC_EXTS.has(ext)) {
      unsupportedFiles.push(f);
      continue;
    }
    supportedDocuments.push(f);
    // Document samples (sample.*) are inventory assets, not whisper transcript pairs.
    if (ext !== '.json' || /^sample/i.test(f)) continue;
    transcriptJsonFiles.push(f);
    const base = path.basename(f, ext);
    const key = normalizeBasenameKey(base);
    const matches = dirKeys.get(key) ?? [];

    let pairingStatus: PairingStatus;
    let framesRelativeDirectory: string | null = null;
    let suggestedDirectory: string | null = null;
    let reason: string | null = null;

    if (matches.length === 1) {
      framesRelativeDirectory = matches[0];
      pairedDirs.add(normalizeBasenameKey(matches[0]));
      const exactCase = matches[0] === base;
      pairingStatus = exactCase ? 'exact' : 'case_insensitive_exact';
      if (exactCase) exactPairs += 1;
      else caseInsensitiveExactPairs += 1;
    } else if (matches.length > 1) {
      pairingStatus = 'ambiguous';
      ambiguousPairings += 1;
      reason = 'duplicate_directory_basenames';
    } else {
      // Fuzzy suggestion only — never auto-accept.
      let best: { dir: string; dist: number } | null = null;
      for (const d of dirs) {
        const dist = levenshtein(key, normalizeBasenameKey(d));
        if (dist > 0 && dist <= 2) {
          if (!best || dist < best.dist) best = { dir: d, dist };
        }
      }
      if (best) {
        pairingStatus = 'requires_confirmation';
        suggestedDirectory = best.dir;
        reason = 'similar_name_not_exact';
        fuzzyPairSuggestions += 1;
      } else {
        pairingStatus = 'missing_frames';
        reason = 'no_matching_directory';
      }
    }

    pairs.push({
      transcriptRelativePath: f,
      framesRelativeDirectory,
      pairingStatus,
      suggestedDirectory,
      reason,
      basename: base,
    });
  }

  const frameDirectories = dirs.filter((d) => {
    // Treat as frame directory if it contains image files or is empty-named as training dir.
    const full = path.join(root, d);
    try {
      const kids = readdirSync(full);
      return kids.some((k) => FRAME_EXTS.has(path.extname(k).toLowerCase())) || kids.length === 0 || kids.some((k) => k.toLowerCase().includes('manifest'));
    } catch {
      return false;
    }
  });

  // Orphan directories: dirs not paired and look like frame dirs
  for (const d of frameDirectories) {
    const k = normalizeBasenameKey(d);
    if (pairedDirs.has(k)) continue;
    const hasTranscript = transcriptJsonFiles.some(
      (f) => normalizeBasenameKey(path.basename(f, path.extname(f))) === k,
    );
    if (hasTranscript) continue;
    pairs.push({
      transcriptRelativePath: '',
      framesRelativeDirectory: d,
      pairingStatus: 'orphan_directory',
      suggestedDirectory: null,
      reason: 'frame_directory_without_transcript',
      basename: d,
    });
  }

  const transcriptsWithoutFrames = pairs.filter(
    (p) => p.transcriptRelativePath && (p.pairingStatus === 'missing_frames' || p.pairingStatus === 'requires_confirmation'),
  ).length;
  const frameDirectoriesWithoutTranscript = pairs.filter((p) => p.pairingStatus === 'orphan_directory').length;

  return {
    transcriptJsonFiles,
    frameDirectories,
    supportedDocuments,
    unsupportedFiles,
    pairs,
    duplicateBasenamesInDirectory,
    fuzzyPairSuggestions,
    fuzzyPairsAutomaticallyAccepted: 0,
    exactPairs,
    caseInsensitiveExactPairs,
    transcriptsWithoutFrames,
    frameDirectoriesWithoutTranscript,
    ambiguousPairings,
  };
}

export function explainPairForJson(root: string, jsonPath: string): PairDiscoveryResult | null {
  const scan = discoverTrainingPairs(root);
  const base = path.basename(jsonPath);
  return scan.pairs.find((p) => p.transcriptRelativePath === base || p.transcriptRelativePath === jsonPath) ?? null;
}

export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
