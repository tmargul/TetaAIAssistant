import type { AppMode } from '@teta/shared';
import { TETA_WORK_MODE_HEADER } from '@teta/shared';

const STORAGE_KEY = 'teta_work_mode';

export function getStoredWorkMode(): AppMode {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === 'client' || raw === 'vendor') {
    return raw;
  }
  return 'vendor';
}

export function setStoredWorkMode(mode: AppMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
}

export function applyWorkModeHeader(headers: Headers): void {
  const mode = getStoredWorkMode();
  headers.set(TETA_WORK_MODE_HEADER, mode);
}
