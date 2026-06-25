import {
  CHAT_QUALITY_MODES,
  DEFAULT_CHAT_QUALITY,
  type ChatQualityMode,
} from '@teta/shared';

const STORAGE_KEY = 'teta_chat_quality';

export function loadChatQualityPreference(): ChatQualityMode {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw && (CHAT_QUALITY_MODES as readonly string[]).includes(raw)) {
      return raw as ChatQualityMode;
    }
  } catch {
    // ignore
  }
  return DEFAULT_CHAT_QUALITY;
}

export function saveChatQualityPreference(quality: ChatQualityMode): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, quality);
  } catch {
    // ignore
  }
}

export function historyClientLimit(quality: ChatQualityMode): number {
  switch (quality) {
    case 'high':
      return 14;
    case 'medium':
      return 8;
    default:
      return 4;
  }
}
