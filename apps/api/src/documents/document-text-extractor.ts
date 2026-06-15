import { readFile } from 'fs/promises';
import * as path from 'path';
import { convert as htmlToText } from 'html-to-text';
import pdfParse from 'pdf-parse';
import WordExtractor from 'word-extractor';
import * as XLSX from 'xlsx';
import {
  RAG_SOURCE_EXTENSIONS,
  isRagSourceExtension,
} from '@teta/shared';
import { extractPptxText } from './pptx-text';
import { extractSubtitleText } from './subtitle-text';

const wordExtractor = new WordExtractor();

export async function extractDocumentText(filePath: string, displayName: string): Promise<string> {
  const ext = path.extname(displayName).toLowerCase();

  if (!isRagSourceExtension(ext)) {
    throw new Error(
      `Nieobsługiwany format pliku: ${ext}. Dozwolone: ${RAG_SOURCE_EXTENSIONS.join(', ')}`,
    );
  }

  if (ext === '.pdf') {
    const buffer = await readFile(filePath);
    const parsed = await pdfParse(buffer);
    return normalizeExtractedText(parsed.text);
  }

  if (ext === '.doc' || ext === '.docx') {
    const extracted = await wordExtractor.extract(filePath);
    return normalizeExtractedText(extracted.getBody());
  }

  if (ext === '.xls' || ext === '.xlsx') {
    return extractSpreadsheetText(filePath);
  }

  if (ext === '.html' || ext === '.htm') {
    const html = await readFile(filePath, 'utf8');
    return normalizeExtractedText(
      htmlToText(html, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
          { selector: 'script', format: 'skip' },
          { selector: 'style', format: 'skip' },
        ],
      }),
    );
  }

  if (ext === '.pptx') {
    return normalizeExtractedText(await extractPptxText(filePath));
  }

  if (ext === '.vtt' || ext === '.srt') {
    return normalizeExtractedText(await extractSubtitleText(filePath, ext));
  }

  const content = await readFile(filePath, 'utf8');
  return normalizeExtractedText(content);
}

async function extractSpreadsheetText(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const parts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    const lines = rows
      .map((row) =>
        row
          .map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim()))
          .filter(Boolean)
          .join('\t'),
      )
      .filter(Boolean);

    if (lines.length > 0) {
      parts.push(`# ${sheetName}\n${lines.join('\n')}`);
    }
  }

  return normalizeExtractedText(parts.join('\n\n'));
}

function normalizeExtractedText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
}
