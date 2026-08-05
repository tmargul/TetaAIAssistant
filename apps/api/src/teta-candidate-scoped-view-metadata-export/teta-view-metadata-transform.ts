import {
  fingerprint,
  sha256,
  TRANSFORM_PROFILE_ID,
  TRANSFORM_PROFILE_VERSION,
} from './teta-view-metadata.types';

export const TRANSFORM_PROFILE = {
  id: TRANSFORM_PROFILE_ID,
  version: TRANSFORM_PROFILE_VERSION,
  rules: ['strip_utf8_bom', 'crlf_to_lf', 'remove_one_trailing_newline'] as const,
  parameters: {
    stripBom: true,
    normalizeCrlfToLf: true,
    removeOneTrailingNewline: true,
    stripPerLineTrailingWhitespace: false,
    stripComments: false,
    normalizeLiterals: false,
  },
};

export function transformProfileHash(): string {
  return fingerprint(TRANSFORM_PROFILE);
}

/** Canonicalization v1: BOM + CRLF/LF + optional single trailing newline only. */
export function canonicalizeViewDdl(raw: Buffer | string): {
  rawPayloadSha256: string;
  canonicalPayloadSha256: string;
  canonical: string;
  transformProfileId: string;
  transformProfileVersion: string;
  transformProfileHash: string;
  metadataTransformParameters: typeof TRANSFORM_PROFILE.parameters;
} {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
  const text = buf.toString('utf8');
  let canonical = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (canonical.endsWith('\n')) canonical = canonical.slice(0, -1);
  return {
    rawPayloadSha256: sha256(buf),
    canonicalPayloadSha256: sha256(canonical),
    canonical,
    transformProfileId: TRANSFORM_PROFILE.id,
    transformProfileVersion: TRANSFORM_PROFILE.version,
    transformProfileHash: transformProfileHash(),
    metadataTransformParameters: TRANSFORM_PROFILE.parameters,
  };
}
