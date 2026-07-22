import type { Stage2cEncodingResult } from './teta-stage2c.types';

const REPLACEMENT = '\uFFFD';

function countReplacements(text: string): number {
  let n = 0;
  for (const ch of text) if (ch === REPLACEMENT) n += 1;
  return n;
}

function tryDecode(buffer: Buffer, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(buffer);
  } catch {
    return null;
  }
}

function scoreDecoded(text: string): number {
  const repl = countReplacements(text);
  const polish =
    (text.match(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g) ?? []).length +
    (text.match(/&#\d+;/g) ?? []).length;
  const mojibake = (text.match(/Ã.|Â.|Ä.|Å./g) ?? []).length;
  // Prefer few replacements, many Polish chars, few mojibake
  return polish * 3 - repl * 10 - mojibake * 5 + Math.min(text.length, 5000) * 0.001;
}

/**
 * Deterministic Help encoding detection among ISO-8859-2 / Windows-1250 / UTF-8 (±BOM).
 */
export function decodeHelpBuffer(buffer: Buffer): Stage2cEncodingResult {
  if (buffer.length === 0) {
    return {
      detectedEncoding: 'utf-8',
      decodingStatus: 'failed',
      replacementCharacterCount: 0,
      text: '',
    };
  }

  // UTF-8 BOM
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    const text = buffer.subarray(3).toString('utf8');
    const repl = countReplacements(text);
    return {
      detectedEncoding: 'utf-8-bom',
      decodingStatus: repl > Math.max(20, text.length * 0.02) ? 'high_replacement' : 'ok',
      replacementCharacterCount: repl,
      text,
    };
  }

  // Meta charset hint
  const headAscii = buffer.subarray(0, Math.min(buffer.length, 2048)).toString('latin1');
  const meta =
    headAscii.match(/charset\s*=\s*["']?([a-zA-Z0-9\-]+)/i)?.[1]?.toLowerCase() ?? null;

  const candidates: string[] = [];
  if (meta) {
    if (meta.includes('1250') || meta.includes('windows-1250')) candidates.push('windows-1250');
    if (meta.includes('8859-2') || meta.includes('iso-8859-2') || meta.includes('latin2')) {
      candidates.push('iso-8859-2');
    }
    if (meta.includes('utf-8') || meta.includes('utf8')) candidates.push('utf-8');
  }
  for (const enc of ['iso-8859-2', 'windows-1250', 'utf-8']) {
    if (!candidates.includes(enc)) candidates.push(enc);
  }

  let best: Stage2cEncodingResult | null = null;
  let bestScore = -Infinity;
  for (const enc of candidates) {
    const text = tryDecode(buffer, enc);
    if (text == null) continue;
    const repl = countReplacements(text);
    const score = scoreDecoded(text);
    if (score > bestScore) {
      bestScore = score;
      const high = repl > Math.max(20, text.length * 0.02);
      best = {
        detectedEncoding: enc,
        decodingStatus: high ? 'high_replacement' : 'ok',
        replacementCharacterCount: repl,
        text,
      };
    }
  }

  if (!best) {
    return {
      detectedEncoding: 'latin1',
      decodingStatus: 'failed',
      replacementCharacterCount: 0,
      text: buffer.toString('latin1'),
    };
  }
  return best;
}

export function hasPolishChars(text: string): boolean {
  return /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text);
}
