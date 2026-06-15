import { readFile } from 'fs/promises';
import JSZip from 'jszip';

export async function extractPptxText(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const parts: string[] = [];
  for (const slidePath of slidePaths) {
    const xml = await zip.file(slidePath)?.async('string');
    if (!xml) {
      continue;
    }
    const lines = extractTextFromSlideXml(xml);
    if (lines.length > 0) {
      parts.push(`# Slajd ${slideNumber(slidePath)}\n${lines.join('\n')}`);
    }
  }

  return parts.join('\n\n').trim();
}

function slideNumber(path: string): number {
  const match = path.match(/slide(\d+)\.xml/i);
  return match ? Number(match[1]) : 0;
}

function extractTextFromSlideXml(xml: string): string[] {
  const matches = xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g);
  const lines: string[] = [];
  for (const match of matches) {
    const text = match[1]?.replace(/\s+/g, ' ').trim();
    if (text) {
      lines.push(text);
    }
  }
  return lines;
}
