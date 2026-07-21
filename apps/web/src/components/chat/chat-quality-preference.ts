import { DEFAULT_CHAT_QUALITY, type ChatQualityMode } from '@teta/shared';

/** Limity historii UI — zawsze profil najwyższej jakości. */
export function historyClientLimit(_quality: ChatQualityMode = DEFAULT_CHAT_QUALITY): number {
  return 6;
}

export function historyOracleLimit(_quality: ChatQualityMode = DEFAULT_CHAT_QUALITY): number {
  return Math.max(historyClientLimit(), 8);
}
