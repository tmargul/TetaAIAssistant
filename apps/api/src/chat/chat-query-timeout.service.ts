import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatAssistantSettingsResponse, ChatAssistantSettingsUpdateRequest } from '@teta/shared';
import { DatabaseService } from '../database/database.service';

const SETTINGS_KEY = 'chat.query_timeout_ms';
export const DEFAULT_CHAT_QUERY_TIMEOUT_MS = 180_000;
const MIN_CHAT_QUERY_TIMEOUT_MS = 30_000;
const MAX_CHAT_QUERY_TIMEOUT_MS = 600_000;

@Injectable()
export class ChatQueryTimeoutService {
  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {}

  /** Jeden budżet czasu dla całego zapytania czatu (wszystkie fazy). */
  getQueryTimeoutMs(): number {
    const fromDb = this.readStoredMs();
    if (fromDb != null) {
      return fromDb;
    }
    const fromEnv = Number(this.config.get('TETA_CHAT_QUERY_TIMEOUT_MS'));
    if (Number.isFinite(fromEnv) && fromEnv >= MIN_CHAT_QUERY_TIMEOUT_MS) {
      return Math.min(fromEnv, MAX_CHAT_QUERY_TIMEOUT_MS);
    }
    return DEFAULT_CHAT_QUERY_TIMEOUT_MS;
  }

  /** Limit UI — kilka sekund ponad budżet serwera. */
  getClientStreamTimeoutMs(): number {
    return this.getQueryTimeoutMs() + 15_000;
  }

  getSettings(): ChatAssistantSettingsResponse {
    const stored = this.db.connection
      .prepare('SELECT value, updated_at FROM app_settings WHERE key = ?')
      .get(SETTINGS_KEY) as { value: string; updated_at: string } | undefined;

    const queryTimeoutMs = this.getQueryTimeoutMs();
    return {
      queryTimeoutMs,
      queryTimeoutSec: Math.round(queryTimeoutMs / 1000),
      clientStreamTimeoutMs: this.getClientStreamTimeoutMs(),
      updatedAt: stored?.updated_at ?? null,
      source: stored?.value ? 'settings' : 'default',
    };
  }

  saveSettings(
    input: ChatAssistantSettingsUpdateRequest,
    updatedBy?: number,
  ): ChatAssistantSettingsResponse {
    const sec = input.queryTimeoutSec;
    if (!Number.isFinite(sec) || sec < MIN_CHAT_QUERY_TIMEOUT_MS / 1000) {
      throw new BadRequestException(
        `Limit czasu musi wynosić co najmniej ${MIN_CHAT_QUERY_TIMEOUT_MS / 1000} s.`,
      );
    }
    if (sec > MAX_CHAT_QUERY_TIMEOUT_MS / 1000) {
      throw new BadRequestException(
        `Limit czasu nie może przekraczać ${MAX_CHAT_QUERY_TIMEOUT_MS / 1000} s.`,
      );
    }

    const ms = Math.round(sec * 1000);
    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at, updated_by)
         VALUES (@key, @value, @updated_at, @updated_by)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      )
      .run({
        key: SETTINGS_KEY,
        value: String(ms),
        updated_at: now,
        updated_by: updatedBy ?? null,
      });

    return this.getSettings();
  }

  private readStoredMs(): number | null {
    const row = this.db.connection
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(SETTINGS_KEY) as { value: string } | undefined;
    if (!row?.value?.trim()) {
      return null;
    }
    const parsed = Number(row.value);
    if (!Number.isFinite(parsed) || parsed < MIN_CHAT_QUERY_TIMEOUT_MS) {
      return null;
    }
    return Math.min(parsed, MAX_CHAT_QUERY_TIMEOUT_MS);
  }
}
