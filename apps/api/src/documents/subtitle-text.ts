import { readFile } from 'fs/promises';

const SRT_TIMESTAMP = /^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}$/;

export async function extractSubtitleText(filePath: string, ext: '.vtt' | '.srt'): Promise<string> {
  const raw = await readFile(filePath, 'utf8');
  if (ext === '.vtt') {
    return normalizeExtractedText(parseVtt(raw));
  }
  return normalizeExtractedText(parseSrt(raw));
}

function parseVtt(content: string): string {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const textLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'WEBVTT' || trimmed.startsWith('NOTE')) {
      continue;
    }
    if (trimmed.includes('-->') || /^\d+$/.test(trimmed)) {
      continue;
    }
    if (/^STYLE:|^REGION:/.test(trimmed)) {
      continue;
    }
    textLines.push(stripInlineTags(trimmed));
  }

  return textLines.join('\n');
}

function parseSrt(content: string): string {
  const blocks = content.replace(/^\uFEFF/, '').trim().split(/\n\s*\n/);
  const textLines: string[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      continue;
    }

    let cursor = 0;
    if (/^\d+$/.test(lines[0] ?? '')) {
      cursor = 1;
    }
    if (lines[cursor] && SRT_TIMESTAMP.test(lines[cursor])) {
      cursor += 1;
    }

    for (let i = cursor; i < lines.length; i += 1) {
      textLines.push(stripInlineTags(lines[i] ?? ''));
    }
  }

  return textLines.join('\n');
}

function stripInlineTags(line: string): string {
  return line.replace(/<[^>]+>/g, '').trim();
}

function normalizeExtractedText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
}
