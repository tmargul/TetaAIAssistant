import { readFileSync } from 'fs';
import type { TetaFormHelpSnapshot, TetaHelpFieldEntry } from './teta-application-object.types';

function decodeHelpHtml(buffer: Buffer): string {
  try {
    return new TextDecoder('iso-8859-2').decode(buffer);
  } catch {
    return buffer.toString('latin1');
  }
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/gi, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return stripHtmlTags(h1);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? stripHtmlTags(title) : 'Pomoc Teta';
}

function extractSections(html: string): string[] {
  const sections: string[] = [];
  const pattern = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const label = stripHtmlTags(match[1] ?? '');
    if (label) sections.push(label);
  }
  return sections;
}

function findSectionForIndex(html: string, index: number): string | null {
  const headings: { label: string; index: number }[] = [];
  const pattern = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (match.index === undefined) continue;
    const label = stripHtmlTags(match[1] ?? '');
    if (label) headings.push({ label, index: match.index });
  }

  let current: string | null = null;
  for (const heading of headings) {
    if (heading.index <= index) {
      current = heading.label;
    } else {
      break;
    }
  }
  return current;
}

function extractFieldEntries(html: string): TetaHelpFieldEntry[] {
  const entries: TetaHelpFieldEntry[] = [];
  const seen = new Set<string>();
  const pattern =
    /<b>\s*([^<]+?)\s*<\/b>\s*(?:&nbsp;)?\s*(?:&#8211;|&#8212;|&ndash;|&mdash;|-)\s*([\s\S]*?)(?=<\/p>|<\/li>|<b>|<h[1-6]|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const label = stripHtmlTags(match[1] ?? '').replace(/\s+/g, ' ').trim();
    const rawDescription = match[2] ?? '';
    const description = stripHtmlTags(rawDescription).replace(/\s+/g, ' ').trim();
    if (!label || label.length < 2 || label.length > 80) continue;
    if (!description || description.length < 4) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({
      label,
      description,
      section: match.index !== undefined ? findSectionForIndex(html, match.index) : null,
    });
  }

  return entries;
}

function buildSummary(html: string, title: string): string {
  const firstParagraph = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const text = firstParagraph ? stripHtmlTags(firstParagraph) : '';
  if (text.length >= 40) {
    return text.length > 600 ? `${text.slice(0, 580).trim()}…` : text;
  }
  return `Pomoc kontekstowa formularza ${title} w systemie Teta.`;
}

export function parseTetaHelpHtml(html: string, sourcePath: string, guid: string): TetaFormHelpSnapshot {
  const title = extractTitle(html);
  const sections = extractSections(html);
  const fields = extractFieldEntries(html);
  const summary = buildSummary(html, title);

  return {
    guid,
    title,
    summary,
    sections,
    fields,
    sourcePath,
  };
}

export function readTetaHelpHtmlFile(filePath: string, guid: string): TetaFormHelpSnapshot | null {
  try {
    const buffer = readFileSync(filePath);
    const html = decodeHelpHtml(buffer);
    return parseTetaHelpHtml(html, filePath, guid);
  } catch {
    return null;
  }
}
