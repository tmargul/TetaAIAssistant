/**
 * Oracle 10g/11g PL/SQL unwrap — local TypeScript adaptation of
 * Niels Teusink's public-domain unwrap.py (blog.teusink.net, 2010).
 *
 * Algorithm (unchanged):
 *   wrapped payload → Base64 decode → skip first 20 bytes →
 *   256-byte substitution map → zlib inflate
 *
 * License of reference algorithm: Public domain.
 * No online unwrap API. No Oracle DDL/DML/PLSQL execution.
 */

import { createHash } from 'crypto';
import { inflateSync } from 'zlib';
import type { Stage2ObjectType } from './teta-stage2.types';

export const UNWRAP_PROVIDER_VERSION = 'osi-s2-unwrap-teusink-10g11g-v1';
export const UNWRAP_ALGORITHM_REFERENCE =
  'Niels Teusink unwrap.py (public domain) — Oracle 10g/11g';

/**
 * Exact 256-byte substitution table from Teusink unwrap.py (public domain).
 * Do not alter.
 */
export const TEUSINK_SUBSTITUTION_MAP: readonly number[] = [
  0x3d, 0x65, 0x85, 0xb3, 0x18, 0xdb, 0xe2, 0x87, 0xf1, 0x52, 0xab, 0x63, 0x4b, 0xb5,
  0xa0, 0x5f, 0x7d, 0x68, 0x7b, 0x9b, 0x24, 0xc2, 0x28, 0x67, 0x8a, 0xde, 0xa4, 0x26,
  0x1e, 0x03, 0xeb, 0x17, 0x6f, 0x34, 0x3e, 0x7a, 0x3f, 0xd2, 0xa9, 0x6a, 0x0f, 0xe9,
  0x35, 0x56, 0x1f, 0xb1, 0x4d, 0x10, 0x78, 0xd9, 0x75, 0xf6, 0xbc, 0x41, 0x04, 0x81,
  0x61, 0x06, 0xf9, 0xad, 0xd6, 0xd5, 0x29, 0x7e, 0x86, 0x9e, 0x79, 0xe5, 0x05, 0xba,
  0x84, 0xcc, 0x6e, 0x27, 0x8e, 0xb0, 0x5d, 0xa8, 0xf3, 0x9f, 0xd0, 0xa2, 0x71, 0xb8,
  0x58, 0xdd, 0x2c, 0x38, 0x99, 0x4c, 0x48, 0x07, 0x55, 0xe4, 0x53, 0x8c, 0x46, 0xb6,
  0x2d, 0xa5, 0xaf, 0x32, 0x22, 0x40, 0xdc, 0x50, 0xc3, 0xa1, 0x25, 0x8b, 0x9c, 0x16,
  0x60, 0x5c, 0xcf, 0xfd, 0x0c, 0x98, 0x1c, 0xd4, 0x37, 0x6d, 0x3c, 0x3a, 0x30, 0xe8,
  0x6c, 0x31, 0x47, 0xf5, 0x33, 0xda, 0x43, 0xc8, 0xe3, 0x5e, 0x19, 0x94, 0xec, 0xe6,
  0xa3, 0x95, 0x14, 0xe0, 0x9d, 0x64, 0xfa, 0x59, 0x15, 0xc5, 0x2f, 0xca, 0xbb, 0x0b,
  0xdf, 0xf2, 0x97, 0xbf, 0x0a, 0x76, 0xb4, 0x49, 0x44, 0x5a, 0x1d, 0xf0, 0x00, 0x96,
  0x21, 0x80, 0x7f, 0x1a, 0x82, 0x39, 0x4f, 0xc1, 0xa7, 0xd7, 0x0d, 0xd1, 0xd8, 0xff,
  0x13, 0x93, 0x70, 0xee, 0x5b, 0xef, 0xbe, 0x09, 0xb9, 0x77, 0x72, 0xe7, 0xb2, 0x54,
  0xb7, 0x2a, 0xc7, 0x73, 0x90, 0x66, 0x20, 0x0e, 0x51, 0xed, 0xf8, 0x7c, 0x8f, 0x2e,
  0xf4, 0x12, 0xc6, 0x2b, 0x83, 0xcd, 0xac, 0xcb, 0x3b, 0xc4, 0x4e, 0xc0, 0x69, 0x36,
  0x62, 0x02, 0xae, 0x88, 0xfc, 0xaa, 0x42, 0x08, 0xa6, 0x45, 0x57, 0xd3, 0x9a, 0xbd,
  0xe1, 0x23, 0x8d, 0x92, 0x4a, 0x11, 0x89, 0x74, 0x6b, 0x91, 0xfb, 0xfe, 0xc9, 0x01,
  0xea, 0x1b, 0xf7, 0xce,
];

export type OraclePlsqlUnwrapInput = {
  owner: string;
  objectName: string;
  objectType: Stage2ObjectType;
  wrappedSourceText: string;
  wrappedSourceHash: string;
};

export type OraclePlsqlUnwrapOutput = {
  status:
    | 'not_wrapped'
    | 'unwrapped'
    | 'unsupported_wrap_format'
    | 'unwrap_failed'
    | 'unwrap_unavailable';
  unwrappedSourceText: string | null;
  unwrappedSourceHash: string | null;
  unwrappedByteLength: number | null;
  toolVersion: string;
  diagnostics: string[];
};

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Simpler, robust detection used by Stage 2. */
export function isOracleWrappedPlsql(text: string): boolean {
  const head = text.slice(0, 4000);
  if (/\bwrapped\b/i.test(head)) {
    if (
      /(?:PACKAGE(?:\s+BODY)?|PROCEDURE|FUNCTION|TYPE(?:\s+BODY)?)\b[\s\S]{0,300}?\bwrapped\b/i.test(
        head,
      )
    ) {
      return true;
    }
    if (/^\s*wrapped\s*$/im.test(head)) return true;
  }
  return false;
}

export function detectOracleWrappedSource(text: string): boolean {
  return isOracleWrappedPlsql(text);
}

/**
 * Extract base64 payload after the hex length header line:
 *   ^[0-9a-f]+ ([0-9a-f]+)$
 *
 * ALL_SOURCE may yield slightly fewer base64 characters than declared
 * (VARCHAR2(4000) splitting). Prefer all remaining payload and decode.
 */
export function extractWrappedBase64Payload(wrapped: string): {
  ok: boolean;
  base64: string | null;
  declaredLength: number | null;
  diagnostics: string[];
} {
  const lines = wrapped.replace(/\r\n/g, '\n').split('\n');
  const headerRe = /^[0-9a-f]+ ([0-9a-f]+)$/i;
  for (let i = 0; i < lines.length; i += 1) {
    const m = headerRe.exec(lines[i]!.trim());
    if (!m) continue;
    const declaredLength = parseInt(m[1]!, 16);
    let raw = '';
    let j = i;
    while (j + 1 < lines.length) {
      j += 1;
      raw += lines[j];
      if (raw.replace(/\n/g, '').replace(/\r/g, '').length >= declaredLength) break;
    }
    const base64 = raw.replace(/\n/g, '').replace(/\r/g, '');
    if (!base64.length) {
      return {
        ok: false,
        base64: null,
        declaredLength,
        diagnostics: ['wrapped_payload_empty'],
      };
    }
    const diagnostics: string[] = [];
    if (base64.length < declaredLength) {
      diagnostics.push(
        `wrapped_payload_shorter_than_declared: got=${base64.length} declared=${declaredLength}`,
      );
    }
    return {
      ok: true,
      base64: base64.length > declaredLength ? base64.slice(0, declaredLength) : base64,
      declaredLength,
      diagnostics,
    };
  }
  return {
    ok: false,
    base64: null,
    declaredLength: null,
    diagnostics: ['wrapped_payload_header_not_found'],
  };
}

/**
 * Core Teusink decode: base64 → skip 20 → substitute → zlib inflate.
 * rawByteLength/rawSha256 are over inflated bytes (may include trailing NUL).
 * text is latin1 without a single trailing NUL (parser-friendly).
 */
export function decodeTeusinkWrappedBase64(base64str: string): {
  ok: boolean;
  text: string | null;
  diagnostics: string[];
  rawByteLength?: number;
  rawSha256?: string;
} {
  if (TEUSINK_SUBSTITUTION_MAP.length !== 256) {
    return {
      ok: false,
      text: null,
      diagnostics: [`charmap_length=${TEUSINK_SUBSTITUTION_MAP.length} expected=256`],
    };
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(base64str, 'base64');
  } catch (e) {
    return { ok: false, text: null, diagnostics: [`base64_decode_failed:${String(e)}`] };
  }
  if (decoded.length <= 20) {
    return {
      ok: false,
      text: null,
      diagnostics: [`decoded_too_short:${decoded.length}`],
    };
  }
  const body = decoded.subarray(20);
  const substituted = Buffer.alloc(body.length);
  for (let i = 0; i < body.length; i += 1) {
    substituted[i] = TEUSINK_SUBSTITUTION_MAP[body[i]!]!;
  }
  try {
    const inflated = inflateSync(substituted);
    const rawSha256 = createHash('sha256').update(inflated).digest('hex');
    const forText =
      inflated.length > 0 && inflated[inflated.length - 1] === 0
        ? inflated.subarray(0, inflated.length - 1)
        : inflated;
    return {
      ok: true,
      text: forText.toString('latin1'),
      diagnostics: [],
      rawByteLength: inflated.length,
      rawSha256,
    };
  } catch (e) {
    return { ok: false, text: null, diagnostics: [`zlib_inflate_failed:${String(e)}`] };
  }
}

export function unwrapOraclePlsqlSource(wrappedSourceText: string): {
  status: OraclePlsqlUnwrapOutput['status'];
  unwrappedSourceText: string | null;
  unwrappedSourceHash: string | null;
  unwrappedByteLength: number | null;
  diagnostics: string[];
} {
  if (!isOracleWrappedPlsql(wrappedSourceText)) {
    return {
      status: 'not_wrapped',
      unwrappedSourceText: wrappedSourceText,
      unwrappedSourceHash: sha256Text(wrappedSourceText),
      unwrappedByteLength: Buffer.byteLength(wrappedSourceText, 'utf8'),
      diagnostics: ['source_not_wrapped'],
    };
  }
  const extracted = extractWrappedBase64Payload(wrappedSourceText);
  if (!extracted.ok || !extracted.base64) {
    if (/CREATE OR REPLACE .+ wrapped\s*$/i.test(wrappedSourceText.trim())) {
      return {
        status: 'unwrap_failed',
        unwrappedSourceText: null,
        unwrappedSourceHash: null,
        unwrappedByteLength: null,
        diagnostics: ['wrapped_marker_without_payload', ...extracted.diagnostics],
      };
    }
    return {
      status: 'unsupported_wrap_format',
      unwrappedSourceText: null,
      unwrappedSourceHash: null,
      unwrappedByteLength: null,
      diagnostics: extracted.diagnostics,
    };
  }
  const decoded = decodeTeusinkWrappedBase64(extracted.base64);
  if (!decoded.ok || decoded.text == null) {
    return {
      status: 'unwrap_failed',
      unwrappedSourceText: null,
      unwrappedSourceHash: null,
      unwrappedByteLength: null,
      diagnostics: [...extracted.diagnostics, ...decoded.diagnostics],
    };
  }
  return {
    status: 'unwrapped',
    unwrappedSourceText: decoded.text,
    unwrappedSourceHash: decoded.rawSha256 ?? null,
    unwrappedByteLength: decoded.rawByteLength ?? null,
    diagnostics: [
      `algorithm=${UNWRAP_ALGORITHM_REFERENCE}`,
      `declaredBase64Length=${extracted.declaredLength}`,
      ...extracted.diagnostics,
    ],
  };
}

/**
 * Production adapter — local Teusink 10g/11g unwrap only.
 * Never invents plaintext. Never calls Copilot / remote unwrap APIs.
 */
export class OraclePlsqlUnwrapProvider {
  readonly toolVersion = UNWRAP_PROVIDER_VERSION;
  readonly existingUnwrapToolFound = true;
  readonly runtimeCopilotDependencies = 0;
  readonly remoteUnwrapCalls = 0;

  unwrap(input: OraclePlsqlUnwrapInput): OraclePlsqlUnwrapOutput {
    const result = unwrapOraclePlsqlSource(input.wrappedSourceText);
    return {
      status: result.status,
      unwrappedSourceText: result.unwrappedSourceText,
      unwrappedSourceHash: result.unwrappedSourceHash,
      unwrappedByteLength: result.unwrappedByteLength,
      toolVersion: this.toolVersion,
      diagnostics: [
        ...result.diagnostics,
        `object=${input.owner}.${input.objectName} type=${input.objectType}`,
        `wrappedSourceHash=${input.wrappedSourceHash}`,
      ],
    };
  }
}

export const defaultUnwrapProvider = new OraclePlsqlUnwrapProvider();

export const UNWRAP_SEARCH_REPORT = {
  existingUnwrapToolFound: true,
  path: 'apps/api/src/teta-oracle-source-index-stage2/teta-stage2-unwrap.ts',
  language: 'TypeScript',
  entryPoint: 'OraclePlsqlUnwrapProvider.unwrap',
  supportedOracleWrapFormat: 'Oracle 10g/11g wrap (Teusink)',
  inputContract: 'full ALL_SOURCE wrapped text (ordered lines)',
  outputContract: 'latin1/plaintext PL/SQL after local inflate',
  tests: 'teta-stage2.spec.ts + local AKT_DANE fixture hashes',
  productionSuitability: 'local_offline_teusink_adaptation_approved',
  algorithmReference: UNWRAP_ALGORITHM_REFERENCE,
  license: 'Public domain (Niels Teusink unwrap.py)',
  remoteUnwrapCalls: 0,
} as const;
