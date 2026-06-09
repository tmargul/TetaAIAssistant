import { readFile } from 'fs/promises';
import * as path from 'path';
import pdfParse from 'pdf-parse';
import {
  CLIENT_RAG_SUPPORTED_EXTENSIONS,
  isClientRagSupportedExtension,
} from '@teta/shared';

export async function extractDocumentText(filePath: string, displayName: string): Promise<string> {
  const ext = path.extname(displayName).toLowerCase();

  if (!isClientRagSupportedExtension(ext)) {
    throw new Error(
      `Nieobsługiwany format pliku: ${ext}. Dozwolone: ${CLIENT_RAG_SUPPORTED_EXTENSIONS.join(', ')}`,
    );
  }

  if (ext === '.pdf') {
    const buffer = await readFile(filePath);
    const parsed = await pdfParse(buffer);
    return normalizeExtractedText(parsed.text);
  }

  const content = await readFile(filePath, 'utf8');
  return normalizeExtractedText(content);
}

function normalizeExtractedText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
}
