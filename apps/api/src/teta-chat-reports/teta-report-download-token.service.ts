import { createHash, randomBytes } from 'crypto';

/** 256-bit random token, base64url, never logged or persisted in cleartext. */
export function issueReportDownloadToken(): { token: string; tokenHash: string } {
  const raw = randomBytes(32);
  const token = raw.toString('base64url');
  return { token, tokenHash: hashReportDownloadToken(token) };
}

export function hashReportDownloadToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function assertTokenEntropy(token: string): void {
  // base64url of 32 bytes ≈ 43 chars; reject short/predictable values.
  if (token.length < 40) {
    throw new Error('Download token entropy too low');
  }
}
