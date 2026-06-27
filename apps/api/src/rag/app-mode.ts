import type { AppMode } from '@teta/shared';
import { isVendorBuild } from '../build-profile';

export function getAppMode(): AppMode {
  const raw = process.env.TETA_APP_MODE?.trim().toLowerCase();
  return raw === 'vendor' ? 'vendor' : 'client';
}

/** Tryb pakietu — vendor MSI vs client MSI. */
export function getBuildAppMode(): AppMode {
  if (!isVendorBuild()) {
    return 'client';
  }
  return getAppMode();
}

export function canSwitchWorkMode(): boolean {
  return isVendorBuild();
}

/** Efektywny tryb UI/API — na paczce vendor można wybrać „klient” przy logowaniu. */
export function getEffectiveAppMode(workModeHeader?: string | null): AppMode {
  if (!canSwitchWorkMode()) {
    return 'client';
  }
  const normalized = workModeHeader?.trim().toLowerCase();
  if (normalized === 'client' || normalized === 'vendor') {
    return normalized;
  }
  return getBuildAppMode();
}

export function isVendorMode(): boolean {
  return getAppMode() === 'vendor';
}
