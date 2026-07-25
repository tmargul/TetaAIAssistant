/**
 * Stage 3F — XLSX exporter.
 *
 * Accepts only a validated `TetaOracleReadResult`. Never opens Oracle, never reads SQL text into the
 * workbook, and never invents rows. Formula-like text is forced into string cells so Excel cannot
 * evaluate it.
 */
import { writeFileSync } from 'fs';
import path from 'path';
import {
  buildExportFileName,
  isFormulaLikeText,
  isValidExportFileName,
  sha256Bytes,
} from './teta-oracle-executor-contract';
import { headerLabelsOf } from './teta-oracle-result-metadata';
import {
  STAGE3F_DATE_NUMBER_FORMAT,
  STAGE3F_SHEET_DATA,
  STAGE3F_SHEET_INFO,
  STAGE3F_XLSX_CONTRACT_VERSION,
  type Stage3fExportRequest,
  type Stage3fExportStatus,
  type Stage3fResultColumn,
  type Stage3fViolation,
  type Stage3fXlsxCell,
  type Stage3fXlsxWorkbookSpec,
  type TetaOracleReadResult,
  type TetaOracleXlsxExport,
} from './teta-oracle-executor.types';
import { assertExportFilePath, ensureExportDir, resolveExportDir } from './teta-oracle-xlsx-paths';
import { validateXlsxParseback } from './teta-oracle-xlsx-validator';

export const STAGE3F_REPORT_DEFINITION = {
  title: 'Badania BHP kończące się w bieżącym miesiącu',
  sheetName: STAGE3F_SHEET_DATA,
  informationSheetName: STAGE3F_SHEET_INFO,
  fileNameBase: 'badania_bhp_koniec_waznosci',
  criterion: 'Data ważności badania przypada w bieżącym miesiącu',
  employeeScope: 'Pracownicy z aktywną umową o pracę',
  clockSource: 'Oracle SYSDATE',
  tableName: 'BadaniaBhpTable',
} as const;

const MIN_COL_WIDTH = 10;
const MAX_COL_WIDTH = 40;

function textCell(value: string | null): Stage3fXlsxCell {
  if (value === null) return { value: null, type: 's' };
  // SheetJS stores t:'s' literally; formula-like prefixes stay text without an apostrophe prefix.
  return { value, type: 's' };
}

function dateCell(value: Date | null): Stage3fXlsxCell {
  if (value === null) return { value: null, type: 'd', numberFormat: STAGE3F_DATE_NUMBER_FORMAT };
  return { value, type: 'd', numberFormat: STAGE3F_DATE_NUMBER_FORMAT };
}

function numberCell(value: number | null): Stage3fXlsxCell {
  if (value === null) return { value: null, type: 'n' };
  return { value, type: 'n' };
}

function cellFor(column: Stage3fResultColumn, value: string | number | Date | null): Stage3fXlsxCell {
  if (value === null) {
    if (column.valueKind === 'date') return dateCell(null);
    if (column.valueKind === 'number') return numberCell(null);
    return textCell(null);
  }
  if (column.valueKind === 'date' && value instanceof Date) return dateCell(value);
  if (column.valueKind === 'number' && typeof value === 'number') return numberCell(value);
  return textCell(String(value));
}

function fitWidth(label: string, values: Array<string | number | Date | null>): number {
  let width = label.length;
  for (const value of values) {
    if (value === null) continue;
    const text =
      value instanceof Date
        ? value.toISOString().slice(0, 10)
        : String(value);
    width = Math.max(width, Math.min(text.length, MAX_COL_WIDTH));
  }
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, width + 2));
}

function buildInfoRows(result: TetaOracleReadResult, generatedAt: Date): Stage3fXlsxCell[][] {
  const pairs: Array<[string, string]> = [
    ['Nazwa raportu', STAGE3F_REPORT_DEFINITION.title],
    ['Data i czas wygenerowania', generatedAt.toISOString()],
    ['Kryterium', STAGE3F_REPORT_DEFINITION.criterion],
    ['Zakres pracowników', STAGE3F_REPORT_DEFINITION.employeeScope],
    ['Źródło czasu', STAGE3F_REPORT_DEFINITION.clockSource],
    ['Liczba wierszy', String(result.rowCount)],
    ['Limit wierszy', String(result.limits.maxRows)],
    [
      'Limit osiągnięty',
      result.limitReached
        ? 'Zwrócono maksymalny limit 500 wierszy. Wynik może być niepełny.'
        : 'nie',
    ],
    ['reportGrain', result.reportGrain ?? ''],
    ['sqlSha256', result.sqlSha256 ?? ''],
    ['executionId', result.audit.generatedAt],
    [
      'Uwagi',
      result.rowCount === 0
        ? 'Brak rekordów spełniających kryteria raportu.'
        : result.limitReached
          ? 'Zwrócono maksymalny limit 500 wierszy. Wynik może być niepełny.'
          : '',
    ],
  ];
  return pairs.map(([label, value]) => [textCell(label), textCell(value)]);
}

export function buildWorkbookSpec(
  result: TetaOracleReadResult,
  generatedAt: Date,
): Stage3fXlsxWorkbookSpec {
  const headers = headerLabelsOf(result.columns);
  const headerRow: Stage3fXlsxCell[] = headers.map((label) => textCell(label));
  const dataRows: Stage3fXlsxCell[][] = result.rows.map((row) =>
    result.columns.map((column, index) => cellFor(column, row[index] ?? null)),
  );

  const columnWidths = result.columns.map((column, index) =>
    fitWidth(
      column.displayLabel,
      result.rows.map((row) => row[index] ?? null),
    ),
  );

  return {
    sheets: [
      {
        name: STAGE3F_SHEET_DATA,
        rows: [headerRow, ...dataRows],
        freezeFirstRow: true,
        autoFilter: true,
        columnWidths,
      },
      {
        name: STAGE3F_SHEET_INFO,
        rows: buildInfoRows(result, generatedAt),
        freezeFirstRow: false,
        autoFilter: false,
        columnWidths: [28, 64],
      },
    ],
  };
}

function emptyExport(
  status: Stage3fExportStatus,
  rejection: Stage3fViolation | null,
  extras: Partial<TetaOracleXlsxExport> = {},
): TetaOracleXlsxExport {
  return {
    contractVersion: STAGE3F_XLSX_CONTRACT_VERSION,
    exportStatus: status,
    fileName: null,
    relativePath: null,
    absolutePath: null,
    byteLength: 0,
    fileSha256: null,
    sheetNames: [],
    dataSheetName: STAGE3F_SHEET_DATA,
    infoSheetName: STAGE3F_SHEET_INFO,
    headerLabels: [],
    rowCount: 0,
    columnCount: 0,
    limitReached: false,
    sqlSha256: null,
    parseback: null,
    rejection,
    warnings: [],
    audit: {
      deterministic: true,
      exporterContractVersion: STAGE3F_XLSX_CONTRACT_VERSION,
      resultContractVersion: resultContractOrUnknown(extras),
      generatedAt: new Date().toISOString(),
      rowValuesPersistedToDocs: 0,
      formulasWritten: 0,
      macrosWritten: 0,
      externalLinksWritten: 0,
    },
    ...extras,
  };
}

function resultContractOrUnknown(extras: Partial<TetaOracleXlsxExport>): string {
  return extras.audit?.resultContractVersion ?? 'teta-aia-oracle-read-result-v1';
}

export class TetaOracleXlsxExporterService {
  async export(request: Stage3fExportRequest): Promise<TetaOracleXlsxExport> {
    const clock = request.clock ?? (() => new Date());
    const generatedAt = clock();
    const result = request.result;
    const warnings: Stage3fViolation[] = [];

    if (!result || result.contractVersion !== 'teta-aia-oracle-read-result-v1') {
      return emptyExport('rejected_result', {
        code: 'invalid_result_contract',
        message: 'Exporter accepts only teta-aia-oracle-read-result-v1',
      });
    }
    if (
      result.executionStatus !== 'completed' &&
      result.executionStatus !== 'completed_empty' &&
      result.executionStatus !== 'limit_reached'
    ) {
      return emptyExport('rejected_result', {
        code: 'result_not_exportable',
        message: `Result status ${result.executionStatus} cannot be exported`,
      });
    }
    if (!result.columns.length) {
      return emptyExport('rejected_result', {
        code: 'result_without_columns',
        message: 'Result has no columns to export',
      });
    }

    let exportDir: string;
    try {
      exportDir = resolveExportDir(request.repoRoot, request.exportDir);
      ensureExportDir(exportDir);
    } catch (error) {
      return emptyExport('rejected_result', {
        code: 'export_path_rejected',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const fileName = request.fileName ?? buildExportFileName(generatedAt);
    if (!isValidExportFileName(fileName)) {
      return emptyExport('rejected_result', {
        code: 'invalid_export_file_name',
        message: `Unsafe export file name: ${fileName}`,
      });
    }

    const absolutePath = path.join(exportDir, fileName);
    try {
      assertExportFilePath(request.repoRoot, absolutePath);
    } catch (error) {
      return emptyExport('rejected_result', {
        code: 'export_path_rejected',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const spec = buildWorkbookSpec(result, generatedAt);
    let bytes: Buffer;
    try {
      bytes = await request.workbook.write(spec);
    } catch (error) {
      return emptyExport('failed_write', {
        code: 'xlsx_write_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      writeFileSync(absolutePath, bytes);
    } catch (error) {
      return emptyExport('failed_write', {
        code: 'xlsx_filesystem_write_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    let parseback;
    try {
      const readback = await request.workbook.read(bytes);
      parseback = validateXlsxParseback({
        workbook: readback,
        result,
        expectedHeaders: headerLabelsOf(result.columns),
        infoTitle: STAGE3F_REPORT_DEFINITION.title,
      });
    } catch (error) {
      return emptyExport(
        'failed_parseback',
        {
          code: 'xlsx_parseback_failed',
          message: error instanceof Error ? error.message : String(error),
        },
        {
          fileName,
          absolutePath,
          relativePath: path.join('.local', 'exports', fileName),
          byteLength: bytes.length,
          fileSha256: sha256Bytes(bytes),
          rowCount: result.rowCount,
          columnCount: result.columnCount,
          limitReached: result.limitReached,
          sqlSha256: result.sqlSha256,
        },
      );
    }

    if (!parseback.ok) {
      return {
        contractVersion: STAGE3F_XLSX_CONTRACT_VERSION,
        exportStatus: 'failed_parseback',
        fileName,
        relativePath: path.join('.local', 'exports', fileName),
        absolutePath,
        byteLength: bytes.length,
        fileSha256: sha256Bytes(bytes),
        sheetNames: parseback.sheetNames,
        dataSheetName: STAGE3F_SHEET_DATA,
        infoSheetName: STAGE3F_SHEET_INFO,
        headerLabels: parseback.headerLabels,
        rowCount: result.rowCount,
        columnCount: result.columnCount,
        limitReached: result.limitReached,
        sqlSha256: result.sqlSha256,
        parseback,
        rejection: {
          code: parseback.violations[0]?.code ?? 'xlsx_parseback_rejected',
          message: `XLSX parseback failed with ${parseback.violations.length} violation(s)`,
        },
        warnings,
        audit: {
          deterministic: true,
          exporterContractVersion: STAGE3F_XLSX_CONTRACT_VERSION,
          resultContractVersion: result.contractVersion,
          generatedAt: generatedAt.toISOString(),
          rowValuesPersistedToDocs: 0,
          formulasWritten: parseback.formulaCells,
          macrosWritten: 0,
          externalLinksWritten: 0,
        },
      };
    }

    // Count formula-like literals that stayed text — they are intentional, not violations.
    for (const row of result.rows) {
      for (const value of row) {
        if (typeof value === 'string' && isFormulaLikeText(value)) {
          // tracked only via parseback.formulaLikeTextCells
        }
      }
    }

    return {
      contractVersion: STAGE3F_XLSX_CONTRACT_VERSION,
      exportStatus: 'exported',
      fileName,
      relativePath: path.join('.local', 'exports', fileName),
      absolutePath,
      byteLength: bytes.length,
      fileSha256: sha256Bytes(bytes),
      sheetNames: parseback.sheetNames,
      dataSheetName: STAGE3F_SHEET_DATA,
      infoSheetName: STAGE3F_SHEET_INFO,
      headerLabels: parseback.headerLabels,
      rowCount: result.rowCount,
      columnCount: result.columnCount,
      limitReached: result.limitReached,
      sqlSha256: result.sqlSha256,
      parseback,
      rejection: null,
      warnings,
      audit: {
        deterministic: true,
        exporterContractVersion: STAGE3F_XLSX_CONTRACT_VERSION,
        resultContractVersion: result.contractVersion,
        generatedAt: generatedAt.toISOString(),
        rowValuesPersistedToDocs: 0,
        formulasWritten: 0,
        macrosWritten: 0,
        externalLinksWritten: 0,
      },
    };
  }

  /** Buffer-only export for a future UI download path — no filesystem write. */
  async exportToBuffer(
    result: TetaOracleReadResult,
    workbook: Stage3fExportRequest['workbook'],
    clock: () => Date = () => new Date(),
  ): Promise<{ bytes: Buffer; fileSha256: string; fileName: string }> {
    const generatedAt = clock();
    const spec = buildWorkbookSpec(result, generatedAt);
    const bytes = await workbook.write(spec);
    return {
      bytes,
      fileSha256: sha256Bytes(bytes),
      fileName: buildExportFileName(generatedAt),
    };
  }
}
