/**
 * Stage 3F — SheetJS (`xlsx`) workbook adapter + OOXML structural probes.
 *
 * Community SheetJS does not always round-trip freeze panes through its high-level model, so
 * freeze / autofilter / formula / macro probes also inspect the raw OOXML via the existing
 * `jszip` dependency. The spreadsheet library never leaks past `Stage3fWorkbookAdapter`.
 */
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {
  STAGE3F_ALLOWED_DEFINED_NAMES,
  type Stage3fWorkbookAdapter,
  type Stage3fXlsxCell,
  type Stage3fXlsxReadbackCell,
  type Stage3fXlsxReadbackSheet,
  type Stage3fXlsxReadbackWorkbook,
  type Stage3fXlsxWorkbookSpec,
} from './teta-oracle-executor.types';

function cellToSheetJs(cell: Stage3fXlsxCell): XLSX.CellObject {
  if (cell.value === null || cell.value === undefined) {
    return { t: 'z' };
  }
  if (cell.type === 'd' && cell.value instanceof Date) {
    return {
      t: 'd',
      v: cell.value,
      z: cell.numberFormat ?? 'yyyy-mm-dd',
    };
  }
  if (cell.type === 'n' && typeof cell.value === 'number') {
    return { t: 'n', v: cell.value, z: cell.numberFormat };
  }
  return { t: 's', v: String(cell.value) };
}

function sheetFromSpec(rows: Stage3fXlsxCell[][]): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {};
  let maxCol = 0;
  let maxRow = 0;
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      sheet[address] = cellToSheetJs(cell);
      maxCol = Math.max(maxCol, colIndex);
      maxRow = Math.max(maxRow, rowIndex);
    });
  });
  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(maxRow, 0), c: Math.max(maxCol, 0) },
  });
  return sheet;
}

function readCell(raw: XLSX.CellObject | undefined): Stage3fXlsxReadbackCell {
  if (!raw) {
    return {
      value: null,
      type: 'z',
      formula: null,
      numberFormat: null,
      formattedText: null,
    };
  }
  const formula =
    typeof (raw as { f?: unknown }).f === 'string' ? ((raw as { f: string }).f ?? null) : null;
  let value: string | number | Date | null = null;
  if (raw.t === 'd' && raw.v instanceof Date) value = raw.v;
  else if (raw.t === 'n' && typeof raw.v === 'number') value = raw.v;
  else if (raw.t === 's') value = String(raw.v ?? '');
  else if ((raw as { t?: string }).t === 'str') value = String(raw.v ?? '');
  else if (raw.v instanceof Date) value = raw.v;
  else if (typeof raw.v === 'number' || typeof raw.v === 'string') value = raw.v;
  else if (raw.v == null) value = null;
  else value = String(raw.v);

  return {
    value,
    type: String(raw.t ?? 'z'),
    formula,
    numberFormat: typeof raw.z === 'string' ? raw.z : null,
    formattedText: typeof raw.w === 'string' ? raw.w : null,
  };
}

function readSheet(name: string, sheet: XLSX.WorkSheet): Stage3fXlsxReadbackSheet {
  const ref = sheet['!ref'] ?? 'A1';
  const range = XLSX.utils.decode_range(ref);
  const cells: Stage3fXlsxReadbackCell[][] = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row: Stage3fXlsxReadbackCell[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const address = XLSX.utils.encode_cell({ r, c });
      row.push(readCell(sheet[address] as XLSX.CellObject | undefined));
    }
    cells.push(row);
  }

  const freeze = sheet['!freeze'] as { ySplit?: number } | undefined;
  const views = sheet['!views'] as Array<{ state?: string; ySplit?: number }> | undefined;
  const freezeFirstRow =
    (freeze?.ySplit ?? 0) >= 1 ||
    Boolean(views?.some((view) => (view.ySplit ?? 0) >= 1 || view.state === 'frozen'));
  const autoFilter = Boolean(
    sheet['!autofilter'] || (sheet as { '!autoFilter'?: unknown })['!autoFilter'],
  );

  return { name, cells, freezeFirstRow, autoFilter };
}

type OoxmlProbe = {
  freezeBySheet: Record<string, boolean>;
  autoFilterBySheet: Record<string, boolean>;
  formulaCells: number;
  hasMacros: boolean;
  externalLinks: string[];
};

async function probeOoxml(bytes: Buffer): Promise<OoxmlProbe> {
  const zip = await JSZip.loadAsync(bytes);
  const freezeBySheet: Record<string, boolean> = {};
  const autoFilterBySheet: Record<string, boolean> = {};
  let formulaCells = 0;
  const externalLinks: string[] = [];

  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const sheetNameByPath: Record<string, string> = {};
  if (workbookXml) {
    const sheetMatches = [
      ...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g),
    ];
    const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
    const relMap: Record<string, string> = {};
    if (rels) {
      for (const match of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
        relMap[match[1]!] = match[2]!.replace(/^\//, '');
      }
    }
    for (const match of sheetMatches) {
      const name = match[1]!;
      const rid = match[2]!;
      const target = relMap[rid] ?? '';
      const normalized = target.startsWith('xl/') ? target : `xl/${target}`;
      sheetNameByPath[normalized] = name;
    }
  }

  for (const [filePath, file] of Object.entries(zip.files)) {
    if (!filePath.startsWith('xl/worksheets/') || !filePath.endsWith('.xml') || file.dir) {
      continue;
    }
    const xml = await file.async('string');
    const sheetName = sheetNameByPath[filePath] ?? filePath;
    freezeBySheet[sheetName] = /<pane[^>]*ySplit="1"/i.test(xml) || /state="frozen"/i.test(xml);
    autoFilterBySheet[sheetName] = /<autoFilter\b/i.test(xml);
    const formulas = xml.match(/<f[\s>]/g);
    formulaCells += formulas?.length ?? 0;
  }

  const hasMacros = Boolean(
    zip.file('xl/vbaProject.bin') ||
      Object.keys(zip.files).some((name) => name.toLowerCase().includes('vbaproject')),
  );

  for (const name of Object.keys(zip.files)) {
    if (name.startsWith('xl/externalLinks/')) externalLinks.push(name);
  }

  return { freezeBySheet, autoFilterBySheet, formulaCells, hasMacros, externalLinks };
}

export function createSheetJsWorkbookAdapter(): Stage3fWorkbookAdapter {
  return {
    async write(spec: Stage3fXlsxWorkbookSpec): Promise<Buffer> {
      const workbook = XLSX.utils.book_new();
      for (const sheetSpec of spec.sheets) {
        const sheet = sheetFromSpec(sheetSpec.rows);
        if (sheetSpec.freezeFirstRow) {
          sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
          sheet['!views'] = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }];
        }
        if (sheetSpec.autoFilter && sheetSpec.rows.length > 0) {
          const lastCol = Math.max(0, (sheetSpec.rows[0]?.length ?? 1) - 1);
          const lastRow = Math.max(0, sheetSpec.rows.length - 1);
          sheet['!autofilter'] = {
            ref: XLSX.utils.encode_range({
              s: { r: 0, c: 0 },
              e: { r: lastRow, c: lastCol },
            }),
          };
        }
        if (sheetSpec.columnWidths.length) {
          sheet['!cols'] = sheetSpec.columnWidths.map((width) => ({ wch: width }));
        }
        XLSX.utils.book_append_sheet(workbook, sheet, sheetSpec.name);
      }

      let bytes = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
        cellDates: true,
        bookSST: false,
      }) as Buffer;
      bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

      // Ensure freeze panes survive in OOXML even when SheetJS omits them from the high-level model.
      bytes = await ensureFreezeAndFilterInOoxml(bytes, spec);
      bytes = await normalizeWorkbookBytes(bytes);
      return bytes;
    },

    async read(bytes: Buffer): Promise<Stage3fXlsxReadbackWorkbook> {
      const workbook = XLSX.read(bytes, {
        type: 'buffer',
        cellDates: true,
        cellNF: true,
        cellText: true,
      });
      const sheets = workbook.SheetNames.map((name) => readSheet(name, workbook.Sheets[name]!));
      const probe = await probeOoxml(bytes);

      for (const sheet of sheets) {
        if (probe.freezeBySheet[sheet.name]) sheet.freezeFirstRow = true;
        if (probe.autoFilterBySheet[sheet.name]) sheet.autoFilter = true;
      }

      const definedNames = (workbook.Workbook?.Names ?? [])
        .map((entry) => String((entry as { Name?: string; name?: string }).Name ?? (entry as { name?: string }).name ?? ''))
        .filter(Boolean);

      let formulaCells = probe.formulaCells;
      for (const sheet of sheets) {
        for (const row of sheet.cells) {
          for (const cell of row) {
            if (cell.formula) formulaCells += 1;
          }
        }
      }

      const externalLinks = [
        ...probe.externalLinks,
        ...definedNames.filter(
          (name) => !(STAGE3F_ALLOWED_DEFINED_NAMES as readonly string[]).includes(name),
        ),
      ];

      return {
        sheetNames: workbook.SheetNames,
        sheets,
        definedNames,
        formulaCells,
        hasMacros: probe.hasMacros,
        externalLinks,
      };
    },
  };
}

/**
 * Patches worksheet XML so freeze panes and autofilter are present for parseback, without changing
 * cell values. Uses the already-declared `jszip` dependency.
 */
async function ensureFreezeAndFilterInOoxml(
  bytes: Buffer,
  spec: Stage3fXlsxWorkbookSpec,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  if (!workbookXml) return bytes;

  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!rels) return bytes;

  const relMap: Record<string, string> = {};
  for (const match of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relMap[match[1]!] = match[2]!.replace(/^\//, '');
  }

  const sheetMatches = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)];
  for (const match of sheetMatches) {
    const sheetName = match[1]!;
    const sheetSpec = spec.sheets.find((entry) => entry.name === sheetName);
    if (!sheetSpec) continue;
    const target = relMap[match[2]!] ?? '';
    const filePath = target.startsWith('xl/') ? target : `xl/${target}`;
    const file = zip.file(filePath);
    if (!file) continue;
    let xml = await file.async('string');

    if (sheetSpec.freezeFirstRow && !/<pane\b/i.test(xml)) {
      const pane =
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
      if (/<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)) {
        xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, pane);
      } else if (/<sheetPr[\s\S]*?\/>/.test(xml)) {
        xml = xml.replace(/(<sheetPr[\s\S]*?\/>)/, `$1${pane}`);
      } else {
        xml = xml.replace(/<worksheet([^>]*)>/, `<worksheet$1>${pane}`);
      }
    }

    if (sheetSpec.autoFilter && sheetSpec.rows.length > 0 && !/<autoFilter\b/i.test(xml)) {
      const lastCol = Math.max(0, (sheetSpec.rows[0]?.length ?? 1) - 1);
      const lastRow = Math.max(0, sheetSpec.rows.length - 1);
      const ref = XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: lastRow, c: lastCol },
      });
      const autoFilter = `<autoFilter ref="${ref}"/>`;
      if (/<\/worksheet>/.test(xml)) {
        xml = xml.replace(/<\/worksheet>/, `${autoFilter}</worksheet>`);
      }
    }

    zip.file(filePath, xml);
  }

  zip.forEach((_path, file) => {
    file.date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  });

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

/** Strip volatile OOXML timestamps so identical inputs produce identical file bytes. */
async function normalizeWorkbookBytes(bytes: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  const core = zip.file('docProps/core.xml');
  if (core) {
    let xml = await core.async('string');
    xml = xml.replace(
      /<dcterms:created[^>]*>[^<]*<\/dcterms:created>/g,
      '<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>',
    );
    xml = xml.replace(
      /<dcterms:modified[^>]*>[^<]*<\/dcterms:modified>/g,
      '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>',
    );
    zip.file('docProps/core.xml', xml);
  }
  const app = zip.file('docProps/app.xml');
  if (app) {
    let xml = await app.async('string');
    xml = xml.replace(/<TotalTime>\d+<\/TotalTime>/g, '<TotalTime>0</TotalTime>');
    zip.file('docProps/app.xml', xml);
  }
  zip.forEach((_path, file) => {
    file.date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  });
  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
