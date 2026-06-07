import { timingSafeEqual } from 'crypto';
import { isVendorMode } from './app-mode';

export const MIN_VENDOR_SECRET_LENGTH = 32;

const PLACEHOLDER_SECRETS = new Set([
  'change-me-vendor-secret',
  'change-me-in-production',
  'vendor-secret',
]);

export function getVendorSecret(): string | undefined {
  const secret = process.env.TETA_VENDOR_SECRET?.trim();
  return secret || undefined;
}

export function isVendorSecretValid(secret: string | undefined): secret is string {
  if (!secret) {
    return false;
  }
  if (secret.length < MIN_VENDOR_SECRET_LENGTH) {
    return false;
  }
  if (PLACEHOLDER_SECRETS.has(secret.toLowerCase())) {
    return false;
  }
  return true;
}

/** Tryb vendor wymaga TETA_APP_MODE=vendor oraz poprawnego TETA_VENDOR_SECRET w .env. */
export function isVendorEnabled(): boolean {
  return isVendorMode() && isVendorSecretValid(getVendorSecret());
}

export function getVendorDisabledReason(): string {
  if (!isVendorMode()) {
    return 'Operacje vendor wymagają TETA_APP_MODE=vendor.';
  }

  const secret = getVendorSecret();
  if (!secret) {
    return 'Operacje vendor wymagają ustawienia TETA_VENDOR_SECRET (min. 32 znaki).';
  }
  if (secret.length < MIN_VENDOR_SECRET_LENGTH) {
    return `TETA_VENDOR_SECRET musi mieć co najmniej ${MIN_VENDOR_SECRET_LENGTH} znaków.`;
  }
  if (PLACEHOLDER_SECRETS.has(secret.toLowerCase())) {
    return 'TETA_VENDOR_SECRET nie może być wartością domyślną — ustaw losowy klucz.';
  }

  return 'Operacje vendor są wyłączone.';
}

export function assertVendorEnabled(): void {
  if (!isVendorEnabled()) {
    throw new Error(getVendorDisabledReason());
  }
}

const VENDOR_SECRET_HEADER = 'x-teta-vendor-secret';

export function validateVendorRequestHeader(headerValue: string | undefined): boolean {
  if (!isVendorEnabled()) {
    return false;
  }

  const expected = getVendorSecret();
  if (!expected || !headerValue) {
    return false;
  }

  const received = headerValue.trim();
  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export function getVendorSecretHeaderName(): string {
  return VENDOR_SECRET_HEADER;
}
