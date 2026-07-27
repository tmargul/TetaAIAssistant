import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  STAGE3G_DOWNLOAD_TTL_MS,
  STAGE3G_MAX_BUFFER_BYTES,
  STAGE3G_MAX_DOWNLOADS_GLOBAL,
  STAGE3G_MAX_DOWNLOADS_PER_USER,
  STAGE3G_MAX_REGISTRY_BYTES,
  STAGE3G_MAX_SUCCESSFUL_DOWNLOADS,
  type Stage3gDownloadEntry,
  type Stage3gErrorCode,
} from './teta-chat-report.types';
import { hashReportDownloadToken, issueReportDownloadToken } from './teta-report-download-token.service';

export type RegisterDownloadInput = {
  userId: string;
  sessionId?: string | null;
  conversationId?: string | null;
  executionId: string;
  routeId: string;
  fileName: string;
  mimeType: string;
  fileSha256: string;
  buffer: Buffer;
  now?: Date;
  ttlMs?: number;
};

export type RegisterDownloadResult =
  | { ok: true; token: string; expiresAt: string; entry: Omit<Stage3gDownloadEntry, 'buffer'> }
  | { ok: false; code: Stage3gErrorCode };

export type ConsumeDownloadResult =
  | { ok: true; entry: Stage3gDownloadEntry }
  | { ok: false; code: Stage3gErrorCode; httpStatus: 403 | 404 | 410 };

export type Stage3gDownloadMetrics = {
  downloadRequests: number;
  downloadsSuccessful: number;
  downloadsExpired: number;
  downloadOwnerMismatches: number;
  downloadLimitRejections: number;
};

@Injectable()
export class TetaReportDownloadRegistryService implements OnModuleDestroy {
  private readonly entries = new Map<string, Stage3gDownloadEntry>();
  private timer: NodeJS.Timeout | null = null;
  private expiredBuffersRemoved = 0;
  private downloadMetrics: Stage3gDownloadMetrics = {
    downloadRequests: 0,
    downloadsSuccessful: 0,
    downloadsExpired: 0,
    downloadOwnerMismatches: 0,
    downloadLimitRejections: 0,
  };

  constructor() {
    this.timer = setInterval(() => this.cleanupExpired(), 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    this.shutdown();
  }

  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const hash of [...this.entries.keys()]) {
      this.removeEntry(hash);
    }
  }

  getExpiredBuffersRemoved(): number {
    return this.expiredBuffersRemoved;
  }

  getDownloadMetrics(): Stage3gDownloadMetrics {
    return { ...this.downloadMetrics };
  }

  /** Test helper — reset download counters between isolated audit steps. */
  resetDownloadMetrics(): void {
    this.downloadMetrics = {
      downloadRequests: 0,
      downloadsSuccessful: 0,
      downloadsExpired: 0,
      downloadOwnerMismatches: 0,
      downloadLimitRejections: 0,
    };
  }

  recordDownloadRequest(): void {
    this.downloadMetrics.downloadRequests += 1;
  }

  recordDownloadSuccess(): void {
    this.downloadMetrics.downloadsSuccessful += 1;
  }

  recordDownloadRejection(code: Stage3gErrorCode): void {
    if (code === 'report_download_expired') {
      this.downloadMetrics.downloadsExpired += 1;
    } else if (code === 'report_download_owner_mismatch') {
      this.downloadMetrics.downloadOwnerMismatches += 1;
    } else if (code === 'report_download_limit_reached') {
      this.downloadMetrics.downloadLimitRejections += 1;
    }
  }

  /** Snapshot entry metadata after successful consume (buffer excluded). */
  getEntryMeta(tokenHash: string): Omit<Stage3gDownloadEntry, 'buffer'> | null {
    const entry = this.entries.get(tokenHash);
    if (!entry) return null;
    const { buffer: _b, ...meta } = entry;
    return meta;
  }

  getStats(): { activeEntries: number; activeBytes: number } {
    this.cleanupExpired();
    let activeBytes = 0;
    for (const entry of this.entries.values()) {
      activeBytes += entry.buffer.byteLength;
    }
    return { activeEntries: this.entries.size, activeBytes };
  }

  register(input: RegisterDownloadInput): RegisterDownloadResult {
    this.cleanupExpired();

    if (input.buffer.byteLength > STAGE3G_MAX_BUFFER_BYTES) {
      return { ok: false, code: 'report_download_registry_limit' };
    }

    const userCount = [...this.entries.values()].filter((e) => e.userId === input.userId).length;
    if (userCount >= STAGE3G_MAX_DOWNLOADS_PER_USER) {
      return { ok: false, code: 'report_download_registry_limit' };
    }
    if (this.entries.size >= STAGE3G_MAX_DOWNLOADS_GLOBAL) {
      return { ok: false, code: 'report_download_registry_limit' };
    }

    const currentBytes = this.getStats().activeBytes;
    if (currentBytes + input.buffer.byteLength > STAGE3G_MAX_REGISTRY_BYTES) {
      return { ok: false, code: 'report_download_registry_limit' };
    }

    const now = input.now ?? new Date();
    const ttlMs = input.ttlMs ?? STAGE3G_DOWNLOAD_TTL_MS;
    const { token, tokenHash } = issueReportDownloadToken();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

    const entry: Stage3gDownloadEntry = {
      tokenHash,
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      conversationId: input.conversationId ?? null,
      executionId: input.executionId,
      routeId: input.routeId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSha256: input.fileSha256,
      buffer: input.buffer,
      createdAt: now.toISOString(),
      expiresAt,
      successfulDownloads: 0,
      maxSuccessfulDownloads: STAGE3G_MAX_SUCCESSFUL_DOWNLOADS,
    };

    this.entries.set(tokenHash, entry);
    const { buffer: _b, ...meta } = entry;
    return { ok: true, token, expiresAt, entry: meta };
  }

  consume(options: {
    token: string;
    userId: string;
    sessionId?: string | null;
    conversationId?: string | null;
    now?: Date;
  }): ConsumeDownloadResult {
    const now = options.now ?? new Date();
    const tokenHash = hashReportDownloadToken(options.token);
    const entry = this.entries.get(tokenHash);
    if (!entry) {
      this.cleanupExpired(now);
      return { ok: false, code: 'report_download_not_found', httpStatus: 404 };
    }

    if (new Date(entry.expiresAt).getTime() <= now.getTime()) {
      this.removeEntry(tokenHash);
      this.cleanupExpired(now);
      return { ok: false, code: 'report_download_expired', httpStatus: 410 };
    }

    this.cleanupExpired(now);

    if (entry.userId !== options.userId) {
      return { ok: false, code: 'report_download_owner_mismatch', httpStatus: 403 };
    }

    if (
      options.sessionId &&
      entry.sessionId &&
      options.sessionId !== entry.sessionId
    ) {
      return { ok: false, code: 'report_download_owner_mismatch', httpStatus: 403 };
    }

    if (
      options.conversationId &&
      entry.conversationId &&
      options.conversationId !== entry.conversationId
    ) {
      return { ok: false, code: 'report_download_owner_mismatch', httpStatus: 403 };
    }

    if (entry.successfulDownloads >= entry.maxSuccessfulDownloads) {
      return { ok: false, code: 'report_download_limit_reached', httpStatus: 410 };
    }

    entry.successfulDownloads += 1;
    if (entry.successfulDownloads >= entry.maxSuccessfulDownloads) {
      // Keep until TTL so owner mismatch still distinguishes; buffer remains until expiry.
    }
    return { ok: true, entry };
  }

  cleanupExpired(now = new Date()): number {
    let removed = 0;
    const nowMs = now.getTime();
    for (const [hash, entry] of this.entries) {
      if (new Date(entry.expiresAt).getTime() <= nowMs) {
        this.removeEntry(hash);
        removed += 1;
      }
    }
    return removed;
  }

  private removeEntry(tokenHash: string): void {
    const entry = this.entries.get(tokenHash);
    if (!entry) return;
    // Drop Buffer reference before deleting the map entry.
    (entry as { buffer: Buffer | null }).buffer = null as unknown as Buffer;
    this.entries.delete(tokenHash);
    this.expiredBuffersRemoved += 1;
  }

  /** Test helper — never expose raw tokens. */
  hasHash(tokenHash: string): boolean {
    return this.entries.has(tokenHash);
  }

  /** Test helper. */
  size(): number {
    return this.entries.size;
  }
}
