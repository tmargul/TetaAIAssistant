import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { normalizeBasenameKey, sha256 } from './teta-knowledge-source-contract';
import {
  buildLogicalSourceId,
  computeInventoryFingerprint,
  computeMetadataFingerprint,
  computeSourceRevisionId,
} from './teta-knowledge-source-fingerprint';
import { inventoryFrameDirectory } from './teta-frame-directory-inventory.service';
import { loadKnowledgeSourceRegistries } from './teta-knowledge-source-registry.loader';
import { discoverTrainingPairs } from './teta-training-pair-discovery.service';
import { findSeriesEntry, parseTrainingSourceLabel } from './teta-training-source-series.parser';
import { validateWhisperTranscriptJson } from './teta-whisper-transcript-json.adapter';
import {
  STAGE3J2A_INVENTORY_VERSION,
  TETA_KNOWLEDGE_SOURCE_CONTRACT_VERSION,
  type FrameHashMode,
  type KnowledgeSourceInventoryResult,
  type KnowledgeSourceRecordV1,
  type KnowledgeScope,
  type ScopeClassificationStatus,
} from './teta-knowledge-source.types';

function defaultFixtureRoot(): string {
  return path.resolve(__dirname, '../../test-fixtures/teta-knowledge-sources/stage3j2a');
}

const DOC_EXTS = new Set(['.pdf', '.docx', '.rtf', '.txt', '.html', '.jsonl', '.mp4', '.json']);

export type DocumentInventoryItem = {
  relativePath: string;
  sourceType: string;
  sha256: string;
  sizeBytes: number;
  signatureStatus: 'ok' | 'invalid' | 'unknown';
};

function detectDocumentSignature(ext: string, buf: Buffer): 'ok' | 'invalid' | 'unknown' {
  const head = buf.slice(0, 16).toString('latin1');
  if (ext === '.pdf') return head.startsWith('%PDF-') ? 'ok' : 'invalid';
  if (ext === '.rtf') return head.startsWith('{\\rtf') ? 'ok' : 'invalid';
  if (ext === '.html') return /<html|<!doctype html/i.test(buf.slice(0, 200).toString('utf8')) ? 'ok' : 'invalid';
  if (ext === '.txt') return 'ok';
  if (ext === '.json') {
    try {
      JSON.parse(buf.toString('utf8'));
      return 'ok';
    } catch {
      return 'invalid';
    }
  }
  if (ext === '.jsonl') {
    const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim());
    try {
      for (const l of lines) JSON.parse(l);
      return lines.length ? 'ok' : 'invalid';
    } catch {
      return 'invalid';
    }
  }
  if (ext === '.docx') return buf[0] === 0x50 && buf[1] === 0x4b ? 'ok' : 'invalid'; // ZIP magic
  if (ext === '.mp4') return 'unknown'; // accept as asset without decoding
  return 'unknown';
}

export function inventoryDocumentFiles(root: string): DocumentInventoryItem[] {
  const out: DocumentInventoryItem[] = [];
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root).sort()) {
    const full = path.join(root, name);
    if (!statSync(full).isFile()) continue;
    const ext = path.extname(name).toLowerCase();
    if (!DOC_EXTS.has(ext)) {
      if (ext === '.bin' || ext === '.exe') {
        out.push({
          relativePath: name,
          sourceType: 'unsupported',
          sha256: sha256(readFileSync(full)),
          sizeBytes: statSync(full).size,
          signatureStatus: 'invalid',
        });
      }
      continue;
    }
    // Whisper transcript JSON files are counted separately as transcript assets.
    if (ext === '.json' && !/^sample/i.test(name)) continue;
    const buf = readFileSync(full);
    out.push({
      relativePath: name,
      sourceType: ext.slice(1),
      sha256: sha256(buf),
      sizeBytes: buf.length,
      signatureStatus: detectDocumentSignature(ext, buf),
    });
  }
  return out;
}

export function inventoryKnowledgeSourcesStage3j2a(input?: {
  root?: string;
  frameHashMode?: FrameHashMode;
  seriesFilter?: string;
  sourceFilter?: string;
  maxFiles?: number;
}): KnowledgeSourceInventoryResult & { documents: DocumentInventoryItem[] } {
  const root = path.resolve(input?.root ?? defaultFixtureRoot());
  if (!existsSync(root)) throw new Error(`inventory root does not exist: ${root}`);
  const frameHashMode: FrameHashMode = input?.frameHashMode ?? 'content';
  const regs = loadKnowledgeSourceRegistries();
  const discovery = discoverTrainingPairs(root);
  let pairs = discovery.pairs.filter((p) => p.transcriptRelativePath);
  if (typeof input?.maxFiles === 'number') pairs = pairs.slice(0, input.maxFiles);

  const sources: KnowledgeSourceRecordV1[] = [];
  const logicalCounts = new Map<string, number>();

  for (const pair of pairs) {
    const base = pair.basename;
    const parsed = parseTrainingSourceLabel(base, regs.series);
    if (input?.seriesFilter && parsed.sourceSeriesId !== input.seriesFilter) continue;

    const series = findSeriesEntry(parsed.sourceSeriesId, regs);
    const transcriptPath = path.join(root, pair.transcriptRelativePath);
    const transcriptBuf = readFileSync(transcriptPath);
    const whisper = validateWhisperTranscriptJson(transcriptBuf);
    // Prefer canonical semantic hash for whisper; fall back to raw bytes for invalid JSON.
    const transcriptSha = whisper.canonicalSha256 ?? sha256(transcriptBuf);

    let framesInv = null as ReturnType<typeof inventoryFrameDirectory> | null;
    if (pair.framesRelativeDirectory) {
      framesInv = inventoryFrameDirectory(
        path.join(root, pair.framesRelativeDirectory),
        pair.framesRelativeDirectory,
        frameHashMode,
      );
    }

    const logicalSourceId = buildLogicalSourceId({
      seriesId: parsed.sourceSeriesId,
      sequenceNumber: parsed.sequenceNumber,
      sourceLabel: parsed.sourceLabel,
      relativePath: pair.transcriptRelativePath,
    });
    if (input?.sourceFilter && logicalSourceId !== input.sourceFilter) continue;
    logicalCounts.set(logicalSourceId, (logicalCounts.get(logicalSourceId) ?? 0) + 1);

    const platformId = series?.platformId ?? (parsed.classificationStatus === 'unclassified' ? null : 'teta_platform');
    const productFamilyIds = [...(series?.productFamilyIds ?? [])];
    const productSurfaceIds = [...(series?.productSurfaceIds ?? [])];
    const domainHints = [...(series?.domainHints ?? [])];
    const businessAreaIds = [...(series?.businessAreaIds ?? [])];
    const knowledgeAreaIds = [...(series?.knowledgeAreaIds ?? [])];
    const audience = [...(series?.audience ?? ['unknown'])];
    const clientSpecificRisk = series?.clientSpecificRisk ?? 'unknown';
    const scopePolicy = series?.scopePolicy ?? null;
    const scope: KnowledgeScope = 'unclassified';
    const scopeClassificationStatus: ScopeClassificationStatus = 'requires_review';

    const warnings: string[] = [...whisper.warnings];
    if (pair.pairingStatus === 'requires_confirmation') {
      warnings.push(`fuzzy_pair_suggestion:${pair.suggestedDirectory ?? ''}`);
    }
    if (pair.pairingStatus === 'missing_frames') warnings.push('transcript_without_frames');
    if (framesInv?.timelineStatus === 'requires_interval_or_manifest') {
      warnings.push('frames_require_interval_or_manifest');
    }
    if (framesInv?.empty) warnings.push('empty_frames_directory');
    if (framesInv?.invalidFrameManifest) warnings.push('invalid_frame_manifest');

    if (productSurfaceIds.includes('teta_me') && domainHints.some((d) => d.domainId === 'teta_me')) {
      warnings.push('rejected_legacy_teta_me_domain_hint');
    }
    const sanitizedDomainHints = domainHints.filter((d) => d.domainId !== 'teta_me');

    let inventoryStatus: KnowledgeSourceRecordV1['inventoryStatus'] = 'ready';
    if (whisper.validationStatus === 'invalid' || pair.pairingStatus === 'ambiguous') {
      inventoryStatus = 'invalid';
    } else if (
      pair.pairingStatus === 'requires_confirmation' ||
      pair.pairingStatus === 'missing_frames' ||
      parsed.classificationStatus === 'unclassified' ||
      scopeClassificationStatus === 'requires_review'
    ) {
      inventoryStatus = 'requires_review';
    } else if (warnings.length || whisper.validationStatus === 'valid_with_warnings') {
      inventoryStatus = 'ready_with_warnings';
    }

    const metadataFingerprint = computeMetadataFingerprint({
      logicalSourceId,
      sourceSeriesId: parsed.sourceSeriesId,
      sequenceNumber: parsed.sequenceNumber,
      pairingStatus: pair.pairingStatus,
      productFamilyIds,
      productSurfaceIds,
      scope,
      clientSpecificRisk,
    });
    const sourceRevisionId = computeSourceRevisionId({
      transcriptSha256: transcriptSha,
      framesFingerprint: framesInv?.fingerprint ?? null,
      metadataFingerprint,
    });

    sources.push({
      contractVersion: TETA_KNOWLEDGE_SOURCE_CONTRACT_VERSION,
      logicalSourceId,
      sourceRevisionId,
      sourceType: 'video_training',
      sourceLabel: parsed.sourceLabel,
      sourceSeriesId: parsed.sourceSeriesId,
      sequenceNumber: parsed.sequenceNumber,
      platformId,
      productFamilyIds,
      productSurfaceIds,
      domainHints: sanitizedDomainHints,
      businessAreaIds,
      knowledgeAreaIds,
      audience,
      scope,
      scopePolicy,
      scopeClassificationStatus,
      clientSpecificRisk,
      assets: {
        transcript: {
          relativePath: pair.transcriptRelativePath,
          sha256: transcriptSha,
          format: whisper.transcriptFormat,
          canonicalSha256: whisper.canonicalSha256 ?? undefined,
        },
        frames: framesInv
          ? {
              relativeDirectory: framesInv.relativeDirectory,
              count: framesInv.count,
              fingerprint: framesInv.fingerprint,
              hashMode: framesInv.hashMode,
              timelineStatus: framesInv.timelineStatus,
              namingScheme: framesInv.namingScheme,
              hasExistingManifest: framesInv.hasExistingManifest,
            }
          : null,
        video: null,
      },
      inventoryStatus,
      warnings,
      pairingStatus: pair.pairingStatus,
      provenance: {
        inventoryVersion: STAGE3J2A_INVENTORY_VERSION,
        registryVersions: [
          regs.platformRegistryVersion,
          regs.productFamilyRegistryVersion,
          regs.productSurfaceRegistryVersion,
          regs.businessAreaRegistryVersion,
          regs.knowledgeAreaRegistryVersion,
          regs.sourceSeriesRegistryVersion,
        ],
      },
    });
  }

  for (const s of sources) {
    if ((logicalCounts.get(s.logicalSourceId) ?? 0) > 1) {
      s.warnings.push('duplicate_logical_source');
      if (s.inventoryStatus !== 'invalid') s.inventoryStatus = 'requires_review';
    }
  }

  const documents = inventoryDocumentFiles(root);
  const fingerprintSha256 = computeInventoryFingerprint(sources);
  return {
    contractVersion: TETA_KNOWLEDGE_SOURCE_CONTRACT_VERSION,
    inventoryVersion: STAGE3J2A_INVENTORY_VERSION,
    rootLabel: path.basename(root),
    frameHashMode,
    sources,
    pairs: discovery.pairs,
    fingerprintSha256,
    documents,
  };
}

export { normalizeBasenameKey };
