/**
 * Stage 3I — safe RTF → plain text extractor (adapter).
 * Handles ansicpg1250 \'xx escapes and basic table/paragraph controls.
 * No Word/LibreOffice, no network, no macros, no eval.
 */
import {
  STAGE3I_MAX_DECODED_TEXT_BYTES,
  STAGE3I_MAX_PARSE_MS,
  STAGE3I_MAX_UPLOAD_BYTES,
} from './teta-payroll-snapshot.types';

export type RtfExtractResult =
  | {
      ok: true;
      text: string;
      ansiCodePage: number | null;
      elapsedMs: number;
      byteLength: number;
    }
  | {
      ok: false;
      code: 'malformed_rtf' | 'rejected_by_limits' | 'parse_timeout';
      message: string;
      elapsedMs: number;
    };

function expandHexEscapesToBytes(rtfLatin1: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < rtfLatin1.length; i++) {
    if (
      rtfLatin1[i] === '\\' &&
      rtfLatin1[i + 1] === "'" &&
      /^[0-9a-fA-F]{2}/.test(rtfLatin1.slice(i + 2, i + 4))
    ) {
      bytes.push(parseInt(rtfLatin1.slice(i + 2, i + 4), 16));
      i += 3;
    } else {
      bytes.push(rtfLatin1.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function stripControls(decoded: string): string {
  let s = decoded;
  // Drop nested ignorable destinations (TOC fields / bookmarks) — bounded iterations.
  for (let n = 0; n < 8; n++) {
    const next = s.replace(/\{\\\*\\[^{}]*\}/g, '');
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\\fldinst[^\n\\]*HYPERLINK[^\\]*/gi, ' ');

  // Split on \row: inside table fragments \par is a soft break; outside it is a paragraph.
  const rowParts = s.split(/\\row\b ?/);
  const lines = rowParts.map((part) => {
    const isTableFragment = /\\cell\b/.test(part);
    let chunk = part.replace(/\r?\n/g, ' ');
    chunk = chunk.replace(/\\cell\b ?/g, '\t');
    chunk = chunk.replace(/\\par\b ?/g, isTableFragment ? ' ' : '\n');
    chunk = chunk.replace(/\\tab\b ?/g, '\t');
    chunk = chunk.replace(/\\line\b ?/g, isTableFragment ? ' ' : '\n');
    chunk = chunk.replace(/\\u(-?\d+)\??/g, (_m, n) => {
      const code = Number(n);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    });
    chunk = chunk.replace(/\\[a-zA-Z]+\d* ?/g, '');
    chunk = chunk.replace(/\\[^a-zA-Z\n]/g, '');
    chunk = chunk.replace(/[{}]/g, '');
    chunk = chunk.replace(/ {2,}/g, ' ');
    return chunk.trimEnd();
  });

  return lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

export class TetaPayrollRtfTextExtractor {
  extractFromBuffer(buffer: Buffer, options?: { timeoutMs?: number }): RtfExtractResult {
    const started = Date.now();
    const timeoutMs = options?.timeoutMs ?? STAGE3I_MAX_PARSE_MS;

    if (buffer.byteLength > STAGE3I_MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        code: 'rejected_by_limits',
        message: 'RTF exceeds max upload size',
        elapsedMs: Date.now() - started,
      };
    }

    const head = buffer.subarray(0, Math.min(64, buffer.byteLength)).toString('latin1');
    if (!head.startsWith('{\\rtf')) {
      return {
        ok: false,
        code: 'malformed_rtf',
        message: 'Missing RTF signature',
        elapsedMs: Date.now() - started,
      };
    }

    try {
      const latin1 = buffer.toString('latin1');
      const cpMatch = /\\ansicpg(\d+)/.exec(latin1);
      const ansiCodePage = cpMatch ? Number(cpMatch[1]) : null;
      const expanded = expandHexEscapesToBytes(latin1);
      if (Date.now() - started > timeoutMs) {
        return {
          ok: false,
          code: 'parse_timeout',
          message: 'RTF decode timeout',
          elapsedMs: Date.now() - started,
        };
      }

      const decoder =
        ansiCodePage === 1250
          ? new TextDecoder('windows-1250')
          : new TextDecoder('windows-1250');
      const decoded = decoder.decode(expanded);
      const text = stripControls(decoded);
      const textBytes = Buffer.byteLength(text, 'utf8');
      if (textBytes > STAGE3I_MAX_DECODED_TEXT_BYTES) {
        return {
          ok: false,
          code: 'rejected_by_limits',
          message: 'Decoded text exceeds limit',
          elapsedMs: Date.now() - started,
        };
      }
      if (Date.now() - started > timeoutMs) {
        return {
          ok: false,
          code: 'parse_timeout',
          message: 'RTF parse timeout',
          elapsedMs: Date.now() - started,
        };
      }
      return {
        ok: true,
        text,
        ansiCodePage,
        elapsedMs: Date.now() - started,
        byteLength: buffer.byteLength,
      };
    } catch (error) {
      return {
        ok: false,
        code: 'malformed_rtf',
        message: error instanceof Error ? error.message : 'RTF extract failed',
        elapsedMs: Date.now() - started,
      };
    }
  }
}
