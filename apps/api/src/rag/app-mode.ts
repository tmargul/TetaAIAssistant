import type { AppMode } from '@teta/shared';

export function getAppMode(): AppMode {
  const raw = process.env.TETA_APP_MODE?.trim().toLowerCase();
  return raw === 'vendor' ? 'vendor' : 'client';
}

export function isVendorMode(): boolean {
  return getAppMode() === 'vendor';
}
