import { readFileSync } from 'fs';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import {
  assetIdFromHash,
  contentUnitId,
  normalizeTextForHash,
  portableAssetPath,
  sha256,
  sourceOccurrenceId,
} from './teta-canonical-source-contract';
import type { AssetReferenceV1, ContentUnitV1 } from './teta-canonical-source.types';

export type DocxExtractionResult = {
  contentUnits: ContentUnitV1[];
  assets: Array<{ assetId: string; relativePortablePath: string; mimeType: string; buffer: Buffer; ext: string }>;
  warnings: string[];
  tablesExtracted: number;
  listsExtracted: number;
  embeddedImagesExtracted: number;
  title: string | null;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  isArray: (name) =>
    ['p', 'r', 't', 'tbl', 'tr', 'tc', 'drawing', 'blip', 'headerReference', 'footerReference'].includes(name),
});

export async function extractDocxSource(
  filePath: string,
  logicalSourceId: string,
): Promise<DocxExtractionResult> {
  const warnings: string[] = [];
  const buffer = readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const docXml = zip.file('word/document.xml');
  if (!docXml) {
    return emptyResult(['missing_document_xml']);
  }
  const relsXml = zip.file('word/_rels/document.xml.rels');
  const relMap = new Map<string, string>();
  if (relsXml) {
    const relParsed = xmlParser.parse(await relsXml.async('string'));
    const rels = relParsed?.Relationships?.Relationship;
    const relList = Array.isArray(rels) ? rels : rels ? [rels] : [];
    for (const rel of relList) {
      if (rel?.['@_Id'] && rel?.['@_Target']) relMap.set(rel['@_Id'], rel['@_Target']);
    }
  }

  const assets: DocxExtractionResult['assets'] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!name.startsWith('word/media/') || entry.dir) continue;
    const imgBuf = Buffer.from(await entry.async('arraybuffer'));
    const hash = sha256(imgBuf);
    const ext = name.slice(name.lastIndexOf('.'));
    const mimeType = ext.toLowerCase() === '.png' ? 'image/png' : ext.toLowerCase() === '.jpg' || ext.toLowerCase() === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
    assets.push({
      assetId: assetIdFromHash(hash),
      relativePortablePath: portableAssetPath(hash, ext),
      mimeType,
      buffer: imgBuf,
      ext,
    });
  }

  const parsed = xmlParser.parse(await docXml.async('string'));
  const body = parsed?.document?.body;
  const blocks = normalizeBlocks(body);
  const contentUnits: ContentUnitV1[] = [];
  let order = 1;
  let paragraphIndex = 0;
  let tableIndex = 0;
  let listsExtracted = 0;
  let tablesExtracted = 0;
  const headingPath: string[] = [];

  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      paragraphIndex += 1;
      const style = block.style ?? '';
      const text = block.text.trim();
      if (!text) continue;
      const isHeading = /^heading/i.test(style) || /^nag/.test(style);
      const isList = /list/i.test(style);
      const unitKind = isHeading ? 'heading' : isList ? 'list_item' : 'paragraph';
      if (isHeading) {
        headingPath.length = 0;
        headingPath.push(text);
      }
      if (isList) listsExtracted += 1;
      const id = contentUnitId(logicalSourceId, order, unitKind);
      contentUnits.push({
        contentUnitId: id,
        unitKind,
        order,
        headingPath: [...headingPath],
        text,
        normalizedTextSha256: sha256(normalizeTextForHash(text)),
        location: {
          pageNumber: null,
          paragraphIndex,
          tableIndex: null,
          rowIndex: null,
          segmentIndex: null,
          startSeconds: null,
          endSeconds: null,
        },
        assetRefs: block.imageAssetIds ?? [],
        sourceOccurrenceId: sourceOccurrenceId(logicalSourceId, id),
        classificationStatus: 'unclassified',
      });
      order += 1;
    } else if (block.kind === 'table') {
      tableIndex += 1;
      tablesExtracted += 1;
      let rowIndex = 0;
      for (const row of block.rows) {
        rowIndex += 1;
        const text = row.join('\t');
        const id = contentUnitId(logicalSourceId, order, 'table_row');
        contentUnits.push({
          contentUnitId: id,
          unitKind: 'table_row',
          order,
          headingPath: [...headingPath],
          text,
          normalizedTextSha256: sha256(normalizeTextForHash(text)),
          location: {
            pageNumber: null,
            paragraphIndex: null,
            tableIndex,
            rowIndex,
            segmentIndex: null,
            startSeconds: null,
            endSeconds: null,
          },
          assetRefs: [],
          sourceOccurrenceId: sourceOccurrenceId(logicalSourceId, id),
          classificationStatus: 'unclassified',
        });
        order += 1;
      }
    }
  }

  const core = zip.file('docProps/core.xml');
  let title: string | null = null;
  if (core) {
    const coreParsed = xmlParser.parse(await core.async('string'));
    title = coreParsed?.coreProperties?.title ?? null;
  }

  return {
    contentUnits,
    assets,
    warnings,
    tablesExtracted,
    listsExtracted,
    embeddedImagesExtracted: assets.length,
    title,
  };
}

type ParsedBlock =
  | { kind: 'paragraph'; text: string; style?: string; imageAssetIds?: string[] }
  | { kind: 'table'; rows: string[][] };

function normalizeBlocks(body: unknown): ParsedBlock[] {
  if (!body || typeof body !== 'object') return [];
  const obj = body as Record<string, unknown>;
  const out: ParsedBlock[] = [];
  const children = collectChildren(obj);
  for (const child of children) {
    if (child.p) {
      const paras = Array.isArray(child.p) ? child.p : [child.p];
      for (const p of paras) out.push(parseParagraph(p));
    }
    if (child.tbl) {
      const tables = Array.isArray(child.tbl) ? child.tbl : [child.tbl];
      for (const tbl of tables) out.push(parseTable(tbl));
    }
  }
  return out;
}

function collectChildren(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const keys = ['p', 'tbl', 'sectPr'];
  const items: Array<Record<string, unknown>> = [];
  for (const key of Object.keys(body)) {
    if (keys.includes(key)) items.push({ [key]: body[key] });
  }
  return items.length ? items : [body];
}

function parseParagraph(p: unknown): ParsedBlock {
  const para = p as Record<string, unknown>;
  const style = extractStyle(para);
  return { kind: 'paragraph', text: extractText(para), style };
}

function parseTable(tbl: unknown): ParsedBlock {
  const table = tbl as Record<string, unknown>;
  const rowsRaw = table.tr;
  const rowsArr = Array.isArray(rowsRaw) ? rowsRaw : rowsRaw ? [rowsRaw] : [];
  const rows: string[][] = [];
  for (const row of rowsArr) {
    const cells = (row as Record<string, unknown>).tc;
    const cellArr = Array.isArray(cells) ? cells : cells ? [cells] : [];
    rows.push(cellArr.map((c) => extractText(c as Record<string, unknown>)));
  }
  return { kind: 'table', rows };
}

function extractStyle(para: Record<string, unknown>): string | undefined {
  const pPr = para.pPr as Record<string, unknown> | undefined;
  const pStyle = pPr?.pStyle as Record<string, unknown> | undefined;
  return typeof pStyle?.['@_val'] === 'string' ? pStyle['@_val'] : undefined;
}

function extractText(node: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof node.t === 'string') parts.push(node.t);
  if (Array.isArray(node.t)) parts.push(...node.t.map(String));
  if (node.r) {
    const runs = Array.isArray(node.r) ? node.r : [node.r];
    for (const run of runs) {
      const r = run as Record<string, unknown>;
      if (typeof r.t === 'string') parts.push(r.t);
      if (Array.isArray(r.t)) parts.push(...r.t.map(String));
    }
  }
  if (node.p) {
    const paras = Array.isArray(node.p) ? node.p : [node.p];
    for (const p of paras) parts.push(extractText(p as Record<string, unknown>));
  }
  if (node.tc) {
    const cells = Array.isArray(node.tc) ? node.tc : [node.tc];
    for (const c of cells) parts.push(extractText(c as Record<string, unknown>));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function emptyResult(warnings: string[]): DocxExtractionResult {
  return {
    contentUnits: [],
    assets: [],
    warnings,
    tablesExtracted: 0,
    listsExtracted: 0,
    embeddedImagesExtracted: 0,
    title: null,
  };
}

export function toAssetReferences(
  assets: DocxExtractionResult['assets'],
  logicalSourceId: string,
): AssetReferenceV1[] {
  return assets.map((a) => ({
    assetId: a.assetId,
    relativePortablePath: a.relativePortablePath,
    mimeType: a.mimeType,
    sourceOccurrences: [{ logicalSourceId, occurrenceKind: 'embedded_image' }],
  }));
}
