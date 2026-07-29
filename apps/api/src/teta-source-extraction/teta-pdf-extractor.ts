import { readFileSync } from 'fs';
import pdfParse from 'pdf-parse';
import {
  contentUnitId,
  normalizeTextForHash,
  sha256,
  sourceOccurrenceId,
} from './teta-canonical-source-contract';
import type { ContentUnitV1 } from './teta-canonical-source.types';

export type PdfExtractionResult = {
  contentUnits: ContentUnitV1[];
  warnings: string[];
  pagesTotal: number;
  pagesWithText: number;
  pagesWithoutText: number;
  pagesRequiringOcr: number;
  embeddedImagesExtracted: number;
  encryptedPdf: boolean;
  invalidPdf: boolean;
  pageRenderingStatus: 'unavailable';
};

export async function extractPdfSource(
  filePath: string,
  logicalSourceId: string,
): Promise<PdfExtractionResult> {
  const warnings: string[] = [];
  let encryptedPdf = false;
  let invalidPdf = false;
  const pageTexts: string[] = [];

  try {
    const buffer = readFileSync(filePath);
    const pageRender = async (pageData: { getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }) => {
      const textContent = await pageData.getTextContent();
      const strings = textContent.items.map((item) => item.str ?? '').join(' ');
      pageTexts.push(strings);
      return strings;
    };
    const parsed = await pdfParse(buffer, { pagerender: pageRender });
    if (!parsed.text && pageTexts.every((p) => !p.trim())) warnings.push('empty_pdf_text_layer');
    const pagesTotal = parsed.numpages ?? pageTexts.length;
    let pagesWithText = 0;
    let pagesWithoutText = 0;
    let pagesRequiringOcr = 0;
    const contentUnits: ContentUnitV1[] = [];
    let order = 1;
    for (let pageNumber = 1; pageNumber <= pagesTotal; pageNumber += 1) {
      const text = (pageTexts[pageNumber - 1] ?? '').trim();
      if (!text) {
        pagesWithoutText += 1;
        pagesRequiringOcr += 1;
        contentUnits.push(makePageUnit(logicalSourceId, order, pageNumber, '', ['ocrRequired=true']));
        order += 1;
        continue;
      }
      pagesWithText += 1;
      contentUnits.push(makePageUnit(logicalSourceId, order, pageNumber, text, []));
      order += 1;
    }
    return {
      contentUnits,
      warnings,
      pagesTotal,
      pagesWithText,
      pagesWithoutText,
      pagesRequiringOcr,
      embeddedImagesExtracted: 0,
      encryptedPdf,
      invalidPdf,
      pageRenderingStatus: 'unavailable',
    };
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (/password|encrypted/i.test(msg)) encryptedPdf = true;
    else invalidPdf = true;
    warnings.push(msg);
    return {
      contentUnits: [],
      warnings,
      pagesTotal: 0,
      pagesWithText: 0,
      pagesWithoutText: 0,
      pagesRequiringOcr: 0,
      embeddedImagesExtracted: 0,
      encryptedPdf,
      invalidPdf,
      pageRenderingStatus: 'unavailable',
    };
  }
}

function makePageUnit(
  logicalSourceId: string,
  order: number,
  pageNumber: number,
  text: string,
  qualityFlags: string[],
): ContentUnitV1 {
  const id = contentUnitId(logicalSourceId, order, 'page_text');
  return {
    contentUnitId: id,
    unitKind: 'page_text',
    order,
    headingPath: [],
    text,
    normalizedTextSha256: sha256(normalizeTextForHash(text)),
    location: {
      pageNumber,
      paragraphIndex: null,
      tableIndex: null,
      rowIndex: null,
      segmentIndex: null,
      startSeconds: null,
      endSeconds: null,
    },
    assetRefs: [],
    sourceOccurrenceId: sourceOccurrenceId(logicalSourceId, id),
    classificationStatus: 'unclassified',
    qualityFlags: qualityFlags.length ? qualityFlags : undefined,
  };
}
