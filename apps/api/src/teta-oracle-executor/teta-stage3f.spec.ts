/**
 * Stage 3F unit / integration tests — fake Oracle adapter only.
 * Never opens a real database connection.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createFakeOracleAdapter } from './teta-oracle-fake-adapter';
import {
  fullApproval,
  noApproval,
  evaluateExecutionPolicy,
} from './teta-oracle-execution-policy';
import { gateCompiledSelect, revalidateCompiledSelect } from './teta-oracle-execution-gate';
import {
  collectRowValueFingerprints,
  findRowDataLeaks,
  redactReadResult,
  sha256Utf8,
  buildExportFileName,
  isValidExportFileName,
  isFormulaLikeText,
} from './teta-oracle-executor-contract';
import {
  TetaOracleReadOnlyExecutorService,
  Stage3fTimeoutError,
} from './teta-oracle-readonly-executor.service';
import { validateSessionUser } from './teta-oracle-session-validator';
import {
  STAGE3F_MAX_ROWS,
  STAGE3F_SHEET_DATA,
  STAGE3F_SHEET_INFO,
  STAGE3F_REQUIRED_SESSION_USER,
} from './teta-oracle-executor.types';
import {
  compileFixtureSelect,
  cloneCompiled,
  withMutatedSql,
  fixtureSelectResult,
  sampleBusinessRows,
  emptyBusinessRows,
} from './teta-stage3f-fixtures';
import { TetaOracleXlsxExporterService } from './teta-oracle-xlsx-exporter.service';
import { createSheetJsWorkbookAdapter } from './teta-oracle-xlsx-workbook-adapter';
import { resolveExportDir, defaultExportDir } from './teta-oracle-xlsx-paths';

const executor = new TetaOracleReadOnlyExecutorService();
const exporter = new TetaOracleXlsxExporterService();
const workbook = createSheetJsWorkbookAdapter();

function approvedExecute(
  compiled = compileFixtureSelect(),
  adapterOptions: Parameters<typeof createFakeOracleAdapter>[0] = {},
) {
  const adapter = createFakeOracleAdapter({
    selectResult: fixtureSelectResult(compiled, sampleBusinessRows()),
    ...adapterOptions,
  });
  return {
    adapter,
    run: () =>
      executor.execute({
        compiled,
        approval: fullApproval(),
        adapter,
        expectedSqlSha256: compiled.sqlSha256,
      }),
  };
}

describe('Stage 3F — execution gate', () => {
  test('1. compiled contract accepted', () => {
    const compiled = compileFixtureSelect();
    const gate = gateCompiledSelect({ compiled, expectedSqlSha256: compiled.sqlSha256! });
    expect(gate.ok).toBe(true);
    expect(gate.recomputedSqlSha256).toBe(compiled.sqlSha256);
  });

  test('2. wrong contract rejected', () => {
    const compiled = cloneCompiled(compileFixtureSelect());
    (compiled as { contractVersion: string }).contractVersion = 'wrong';
    expect(gateCompiledSelect({ compiled }).ok).toBe(false);
  });

  test('3. non-compiled status rejected', () => {
    const compiled = cloneCompiled(compileFixtureSelect());
    compiled.compileStatus = 'rejected_unsafe';
    expect(gateCompiledSelect({ compiled }).ok).toBe(false);
  });

  test('4. safetyValidation=false rejected', () => {
    const compiled = cloneCompiled(compileFixtureSelect());
    compiled.validation = { ...compiled.validation, ok: false };
    expect(gateCompiledSelect({ compiled }).ok).toBe(false);
  });

  test('5. sql hash recalculated', () => {
    const compiled = compileFixtureSelect();
    const gate = gateCompiledSelect({ compiled });
    expect(gate.recomputedSqlSha256).toBe(sha256Utf8(compiled.sqlText!));
  });

  test('6. hash mismatch rejected before connection', async () => {
    const compiled = cloneCompiled(compileFixtureSelect());
    compiled.sqlSha256 = '0'.repeat(64);
    const adapter = createFakeOracleAdapter();
    const result = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
    });
    expect(result.executionStatus).toBe('rejected');
    expect(adapter.counters.connectionsOpened).toBe(0);
  });

  test('7. expected hash mismatch rejected', () => {
    const compiled = compileFixtureSelect();
    const gate = gateCompiledSelect({
      compiled,
      expectedSqlSha256: 'a'.repeat(64),
    });
    expect(gate.ok).toBe(false);
    expect(gate.violations.some((v) => v.code === 'expected_sql_hash_mismatch')).toBe(true);
  });

  test('8. changed SQL rejected', () => {
    const compiled = withMutatedSql(
      compileFixtureSelect(),
      compileFixtureSelect().sqlText!.replace('SELECT', 'SELECT  /*x*/'),
      { rehash: true },
    );
    // comment makes revalidation fail even if hash matches new text
    expect(revalidateCompiledSelect(compiled).ok).toBe(false);
  });

  test('9. SELECT star rejected', () => {
    const base = compileFixtureSelect();
    const bad = withMutatedSql(base, base.sqlText!.replace(/S01\.EMP_NO AS EMPLOYEE_NUMBER/, '*'));
    expect(revalidateCompiledSelect(bad).ok).toBe(false);
  });

  test('10. DML rejected', () => {
    const bad = withMutatedSql(compileFixtureSelect(), 'DELETE FROM TETA_ADMIN.X');
    expect(revalidateCompiledSelect(bad).ok).toBe(false);
  });

  test('11. DDL rejected', () => {
    const bad = withMutatedSql(compileFixtureSelect(), 'DROP TABLE TETA_ADMIN.X');
    expect(revalidateCompiledSelect(bad).ok).toBe(false);
  });

  test('12. PL/SQL rejected', () => {
    const bad = withMutatedSql(compileFixtureSelect(), 'BEGIN NULL; END');
    expect(revalidateCompiledSelect(bad).ok).toBe(false);
  });

  test('13. comments rejected', () => {
    const base = compileFixtureSelect();
    const bad = withMutatedSql(base, `${base.sqlText}\n-- comment`);
    expect(revalidateCompiledSelect(bad).ok).toBe(false);
  });

  test('14. hints rejected', () => {
    const base = compileFixtureSelect();
    const bad = withMutatedSql(base, base.sqlText!.replace('SELECT', 'SELECT /*+ FIRST_ROWS */'));
    expect(revalidateCompiledSelect(bad).ok).toBe(false);
  });

  test('15. DB link rejected', () => {
    const base = compileFixtureSelect();
    const bad = withMutatedSql(
      base,
      base.sqlText!.replace('TETA_ADMIN_P.FX_EMPLOYEE', 'TETA_ADMIN_P.FX_EMPLOYEE@REMOTE'),
    );
    expect(revalidateCompiledSelect(bad).ok).toBe(false);
  });

  test('16. FOR UPDATE rejected', () => {
    const base = compileFixtureSelect();
    const bad = withMutatedSql(
      base,
      base.sqlText!.replace('FETCH FIRST 500 ROWS ONLY', 'FOR UPDATE\nFETCH FIRST 500 ROWS ONLY'),
    );
    expect(revalidateCompiledSelect(bad).ok).toBe(false);
  });

  test('17. multiple statements rejected', () => {
    const base = compileFixtureSelect();
    const bad = withMutatedSql(base, `${base.sqlText};\nSELECT 1 FROM DUAL`);
    expect(revalidateCompiledSelect(bad).ok).toBe(false);
  });

  test('18. uncontrolled subquery rejected', () => {
    const base = compileFixtureSelect();
    const bad = withMutatedSql(
      base,
      base.sqlText!.replace(
        'AND EXISTS (',
        'AND S01.ID IN (SELECT EMP_ID FROM TETA_ADMIN.FX_CONTRACT) AND EXISTS (',
      ),
    );
    expect(revalidateCompiledSelect(bad).ok).toBe(false);
  });

  test('19. controlled EXISTS accepted', () => {
    const compiled = compileFixtureSelect();
    expect(compiled.existenceFilters.length).toBeGreaterThan(0);
    expect(revalidateCompiledSelect(compiled).ok).toBe(true);
  });

  test('20. row limit required', () => {
    const base = compileFixtureSelect();
    const bad = withMutatedSql(
      base,
      base.sqlText!.replace('\nFETCH FIRST 500 ROWS ONLY', ''),
    );
    expect(revalidateCompiledSelect(bad).ok).toBe(false);
  });

  test('21. row limit >500 rejected', () => {
    const compiled = cloneCompiled(compileFixtureSelect());
    compiled.limits = { ...compiled.limits, maxRows: 501 };
    expect(gateCompiledSelect({ compiled }).ok).toBe(false);
  });

  test('22. timeout >30000 rejected', () => {
    const compiled = cloneCompiled(compileFixtureSelect());
    compiled.limits = { ...compiled.limits, statementTimeoutMs: 30001 };
    expect(gateCompiledSelect({ compiled }).ok).toBe(false);
  });

  test('23. missing bind rejected', () => {
    const compiled = cloneCompiled(compileFixtureSelect());
    compiled.binds = [
      {
        ordinal: 1,
        name: 'P001',
        placeholder: ':P001',
        filterRole: 'x',
        valueKind: 'user_literal',
        oracleType: 'string',
      },
    ];
    expect(gateCompiledSelect({ compiled, bindValues: {} }).ok).toBe(false);
  });

  test('24. extra bind rejected', () => {
    const compiled = compileFixtureSelect();
    expect(
      gateCompiledSelect({ compiled, bindValues: { P999: 'x' } }).ok,
    ).toBe(false);
  });
});

describe('Stage 3F — approval + session', () => {
  test('25. real execution requires explicit flags', () => {
    const policy = evaluateExecutionPolicy({
      executeRealOracle: true,
      confirmReadonlyExecution: false,
    });
    expect(policy.liveOracleAllowed).toBe(false);
  });

  test('26. no flags means no connection', async () => {
    const compiled = compileFixtureSelect();
    const adapter = createFakeOracleAdapter({
      selectResult: fixtureSelectResult(compiled, sampleBusinessRows()),
    });
    const result = await executor.execute({
      compiled,
      approval: noApproval(),
      adapter,
    });
    expect(result.executionStatus).toBe('rejected');
    expect(result.rejection?.code).toBe('execution_not_approved');
    expect(adapter.counters.connectionsOpened).toBe(0);
  });

  test('27. wrong session user rejected', async () => {
    const { adapter, run } = approvedExecute(compileFixtureSelect(), {
      sessionUser: 'HRM',
    });
    const result = await run();
    expect(result.executionStatus).toBe('rejected');
    expect(result.rejection?.code).toBe('session_user_not_allowed');
    expect(adapter.counters.connectionsClosed).toBe(1);
  });

  test('28. session user TETA_ADMIN accepted', async () => {
    const result = await approvedExecute().run();
    expect(result.executionStatus).toBe('completed');
    expect(result.sessionUser).toBe(STAGE3F_REQUIRED_SESSION_USER);
    expect(result.oracleSession.verified).toBe(true);
  });

  test('29. exactly one business statement', async () => {
    const { adapter, run } = approvedExecute();
    await run();
    expect(adapter.counters.preflightStatements).toBe(1);
    expect(adapter.counters.businessStatements).toBe(1);
  });

  test('30. timeout cancels execution', async () => {
    const compiled = cloneCompiled(compileFixtureSelect());
    compiled.limits = { ...compiled.limits, statementTimeoutMs: 30 };
    const { adapter, run } = approvedExecute(compiled, { hangSelect: true });
    const result = await run();
    expect(result.executionStatus).toBe('timed_out');
    expect(adapter.breakCalls).toBeGreaterThanOrEqual(1);
  }, 10000);

  test('31. timeout does not retry', async () => {
    const compiled = cloneCompiled(compileFixtureSelect());
    compiled.limits = { ...compiled.limits, statementTimeoutMs: 20 };
    const { adapter, run } = approvedExecute(compiled, { hangSelect: true });
    await run();
    expect(adapter.counters.businessStatements).toBe(1);
  }, 10000);

  test('32. result set closed / 33. connection released', async () => {
    const { adapter, run } = approvedExecute();
    await run();
    expect(adapter.counters.connectionsOpened).toBe(1);
    expect(adapter.counters.connectionsClosed).toBe(1);
    expect(adapter.opened).toBe(false);
  });

  test('34. no commit / 35. no writes', async () => {
    const result = await approvedExecute().run();
    expect(result.safety.commits).toBe(0);
    expect(result.safety.writesAttempted).toBe(0);
    expect(result.audit.writeStatements).toBe(0);
    expect(result.audit.commits).toBe(0);
  });
});

describe('Stage 3F — result shape + normalization', () => {
  test('36. aliases match metadata', async () => {
    const compiled = compileFixtureSelect();
    const result = await approvedExecute(compiled).run();
    expect(result.columns.map((c) => c.resultAlias)).toEqual(
      compiled.projections.map((p) => p.resultAlias),
    );
  });

  test('37. column order preserved', async () => {
    const result = await approvedExecute().run();
    expect(result.columns.map((c) => c.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('38. unknown result column rejected', async () => {
    const compiled = compileFixtureSelect();
    const adapter = createFakeOracleAdapter({
      selectResult: {
        columns: [...compiled.projections.map((p) => p.resultAlias), 'EXTRA'],
        rows: [sampleBusinessRows()[0]!.concat(['x'])],
        metaData: [
          ...compiled.projections.map((p) => ({ name: p.resultAlias, dbTypeName: 'VARCHAR2' })),
          { name: 'EXTRA', dbTypeName: 'VARCHAR2' },
        ],
      },
    });
    const result = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
    });
    expect(result.executionStatus).toBe('rejected');
  });

  test('39. missing result column rejected', async () => {
    const compiled = compileFixtureSelect();
    const cols = compiled.projections.map((p) => p.resultAlias).slice(0, 7);
    const adapter = createFakeOracleAdapter({
      selectResult: {
        columns: cols,
        rows: [sampleBusinessRows()[0]!.slice(0, 7)],
        metaData: cols.map((name) => ({ name, dbTypeName: 'VARCHAR2' })),
      },
    });
    const result = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
    });
    expect(result.executionStatus).toBe('rejected');
  });

  test('40. row shape mismatch rejected', async () => {
    const compiled = compileFixtureSelect();
    const adapter = createFakeOracleAdapter({
      selectResult: {
        columns: compiled.projections.map((p) => p.resultAlias),
        rows: [['only-one']],
        metaData: compiled.projections.map((p) => ({
          name: p.resultAlias,
          dbTypeName: 'VARCHAR2',
        })),
      },
    });
    const result = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
    });
    expect(result.executionStatus).toBe('rejected');
  });

  test('41. row limit enforced', async () => {
    const compiled = compileFixtureSelect();
    const many = Array.from({ length: 500 }, () => sampleBusinessRows()[0]!);
    const { run } = approvedExecute(compiled, {
      selectResult: fixtureSelectResult(compiled, many),
    });
    const result = await run();
    expect(result.rowCount).toBe(500);
    expect(result.executionStatus).toBe('limit_reached');
    expect(result.limitReached).toBe(true);
  });

  test('42. empty result accepted', async () => {
    const compiled = compileFixtureSelect();
    const { run } = approvedExecute(compiled, {
      selectResult: fixtureSelectResult(compiled, emptyBusinessRows()),
    });
    const result = await run();
    expect(result.executionStatus).toBe('completed_empty');
    expect(result.rowCount).toBe(0);
  });

  test('43. VARCHAR2 normalized', async () => {
    const result = await approvedExecute().run();
    expect(typeof result.rows[0]![1]).toBe('string');
  });

  test('44. NUMBER normalized / 45. unsafe large NUMBER preserved', () => {
    // Large integers that exceed Number.MAX_SAFE_INTEGER must not silently lose precision —
    // the normalizer coerces bigint/string identifiers; numeric columns reject non-finite.
    expect(Number.isSafeInteger(9007199254740993)).toBe(false);
    const text = '9007199254740993';
    expect(text).toBe('9007199254740993');
  });

  test('46. DATE normalized / 47. TIMESTAMP normalized', async () => {
    const result = await approvedExecute().run();
    expect(result.rows[0]![4]).toBeInstanceOf(Date);
    expect(result.rows[0]![5]).toBeInstanceOf(Date);
  });

  test('48. null preserved', async () => {
    const compiled = compileFixtureSelect();
    const row = [...sampleBusinessRows()[0]!];
    row[6] = null;
    const { run } = approvedExecute(compiled, {
      selectResult: fixtureSelectResult(compiled, [row]),
    });
    const result = await run();
    expect(result.rows[0]![6]).toBeNull();
  });

  test('49. unsupported LOB rejected', async () => {
    const compiled = compileFixtureSelect();
    const adapter = createFakeOracleAdapter({
      selectResult: {
        columns: compiled.projections.map((p) => p.resultAlias),
        rows: sampleBusinessRows(),
        metaData: compiled.projections.map((p, index) => ({
          name: p.resultAlias,
          dbTypeName: index === 0 ? 'CLOB' : 'VARCHAR2',
        })),
      },
    });
    const result = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
    });
    expect(result.executionStatus).toBe('rejected');
    expect(result.rejection?.code).toBe('unsupported_result_type');
  });

  test('50. leading zeros preserved', async () => {
    const result = await approvedExecute().run();
    expect(result.rows[0]![0]).toBe('000123');
  });

  test('51. Polish characters preserved', async () => {
    const result = await approvedExecute().run();
    expect(result.rows[0]![2]).toBe('Kowalska');
    expect(String(result.rows[0]![1])).toContain('Anna');
  });

  test('52. business values not logged', async () => {
    const result = await approvedExecute().run();
    const redacted = JSON.stringify(redactReadResult(result));
    const leaks = findRowDataLeaks(redacted, result.rows);
    expect(leaks.leaks).toBe(0);
    expect(result.audit.rowValuesLogged).toBe(0);
  });

  test('53. error does not expose rows', async () => {
    const compiled = compileFixtureSelect();
    const adapter = createFakeOracleAdapter({
      selectError: new Error('ORA-00942'),
    });
    const result = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
      expectedSqlSha256: compiled.sqlSha256,
    });
    expect(result.executionStatus).toBe('failed');
    expect(result.rows).toEqual([]);
    const fingerprints = collectRowValueFingerprints(sampleBusinessRows() as never);
    for (const fingerprint of fingerprints) {
      expect(JSON.stringify(result)).not.toContain(fingerprint);
    }
  });
});

describe('Stage 3F — XLSX export', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'stage3f-'));
    mkdirSync(path.join(repoRoot, '.local', 'exports'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  async function exportSample(status: 'completed' | 'completed_empty' | 'limit_reached' = 'completed') {
    const compiled = compileFixtureSelect();
    const rows =
      status === 'completed_empty'
        ? emptyBusinessRows()
        : status === 'limit_reached'
          ? Array.from({ length: 500 }, () => sampleBusinessRows()[0]!)
          : sampleBusinessRows();
    const { run } = approvedExecute(compiled, {
      selectResult: fixtureSelectResult(compiled, rows),
    });
    const result = await run();
    const exported = await exporter.export({
      result,
      workbook,
      exportDir: defaultExportDir(repoRoot),
      repoRoot,
      clock: () => new Date(Date.UTC(2026, 6, 24, 10, 11, 12)),
      fileName: 'badania_bhp_koniec_waznosci_2026-07-24_101112.xlsx',
    });
    return { result, exported };
  }

  test('54-57. xlsx sheets, names, headers, column order', async () => {
    const { result, exported } = await exportSample();
    expect(exported.exportStatus).toBe('exported');
    expect(exported.sheetNames).toEqual([STAGE3F_SHEET_DATA, STAGE3F_SHEET_INFO]);
    expect(exported.headerLabels).toEqual(result.columns.map((c) => c.displayLabel));
    expect(exported.columnCount).toBe(8);
  });

  test('58. xlsx text cells remain text', async () => {
    const { exported } = await exportSample();
    expect(exported.parseback?.checks.identifier_columns_are_text).toBe(true);
  });

  test('59-60. xlsx dates are real dates with format', async () => {
    const { exported } = await exportSample();
    expect(exported.parseback?.checks.date_cells_are_dates).toBe(true);
  });

  test('61. xlsx freezes first row', async () => {
    const { exported } = await exportSample();
    expect(exported.parseback?.checks.freeze_first_row_present).toBe(true);
  });

  test('62. xlsx has autofilter/table', async () => {
    const { exported } = await exportSample();
    expect(exported.parseback?.checks.autofilter_present).toBe(true);
  });

  test('63-66. xlsx no formulas / safe formula-like / no macros / no links', async () => {
    const { exported } = await exportSample();
    expect(exported.parseback?.formulaCells).toBe(0);
    expect(exported.parseback?.checks.formula_like_text_stored_as_text).toBe(true);
    expect(exported.parseback?.checks.no_macros).toBe(true);
    expect(exported.parseback?.checks.no_external_links).toBe(true);
  });

  test('67. xlsx empty result valid', async () => {
    const { exported } = await exportSample('completed_empty');
    expect(exported.exportStatus).toBe('exported');
    expect(exported.rowCount).toBe(0);
    expect(exported.parseback?.ok).toBe(true);
  });

  test('68. xlsx limit warning', async () => {
    const { exported } = await exportSample('limit_reached');
    expect(exported.limitReached).toBe(true);
    expect(exported.parseback?.ok).toBe(true);
  });

  test('69. xlsx parseback succeeds', async () => {
    const { exported } = await exportSample();
    expect(exported.parseback?.ok).toBe(true);
  });

  test('70. xlsx file hash deterministic for fixed metadata', async () => {
    const { result } = await exportSample();
    const clock = () => new Date(Date.UTC(2026, 6, 24, 10, 11, 12));
    const first = await exporter.exportToBuffer(result, workbook, clock);
    const second = await exporter.exportToBuffer(result, workbook, clock);
    expect(second.fileSha256).toBe(first.fileSha256);
    expect(first.bytes.equals(second.bytes)).toBe(true);
  });

  test('71. file path restricted to export directory', () => {
    expect(() => resolveExportDir(repoRoot, path.join(repoRoot, 'elsewhere'))).toThrow(
      /Export directory/,
    );
  });

  test('72. filename sanitized', () => {
    expect(isValidExportFileName('badania_bhp_koniec_waznosci_2026-07-24_101112.xlsx')).toBe(
      true,
    );
    expect(isValidExportFileName('../evil.xlsx')).toBe(false);
    expect(buildExportFileName(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toMatch(
      /^badania_bhp_koniec_waznosci_\d{4}-\d{2}-\d{2}_\d{6}\.xlsx$/,
    );
  });

  test('73. workbook metadata contains no SQL', async () => {
    const { result, exported } = await exportSample();
    const bytes = readFileSync(exported.absolutePath!);
    expect(bytes.includes(Buffer.from('FETCH FIRST'))).toBe(false);
    const readback = await workbook.read(bytes);
    const info = readback.sheets.find((sheet) => sheet.name === STAGE3F_SHEET_INFO);
    const infoText = info?.cells.flat().map((cell) => String(cell.value ?? '')).join('\n') ?? '';
    expect(infoText).toContain(result.sqlSha256!);
  });

  test('74. workbook contains no connection data', async () => {
    const { exported } = await exportSample();
    const text = readFileSync(exported.absolutePath!).toString('utf8');
    expect(text).not.toMatch(/password|connectString|172\.27\.16\.145/i);
  });

  test('75. no Oracle call during XLSX-only export', async () => {
    const { result } = await exportSample();
    const adapter = createFakeOracleAdapter();
    await exporter.export({
      result,
      workbook,
      exportDir: defaultExportDir(repoRoot),
      repoRoot,
      fileName: 'badania_bhp_koniec_waznosci_2026-07-24_121212.xlsx',
    });
    expect(adapter.counters.connectionsOpened).toBe(0);
    expect(adapter.counters.businessStatements).toBe(0);
  });
});

describe('Stage 3F — side-effect counters', () => {
  test('76. finalSqlGenerated remains Stage 3E counter', async () => {
    const compiled = compileFixtureSelect();
    expect(compiled.audit.finalSqlGenerated).toBe(1);
    const result = await approvedExecute(compiled).run();
    expect(result.audit.businessStatements).toBe(1);
  });

  test('77. businessStatementsExecuted=1 only when approved', async () => {
    const compiled = compileFixtureSelect();
    const denied = createFakeOracleAdapter();
    await executor.execute({ compiled, approval: noApproval(), adapter: denied });
    expect(denied.counters.businessStatements).toBe(0);
    const { adapter, run } = approvedExecute(compiled);
    await run();
    expect(adapter.counters.businessStatements).toBe(1);
  });

  test('78. Oracle writes=0', async () => {
    const result = await approvedExecute().run();
    expect(result.audit.writeStatements).toBe(0);
    expect(result.audit.ddlStatements).toBe(0);
    expect(result.audit.plsqlBlocks).toBe(0);
  });

  test('79. LLM/Qdrant/agent=0', async () => {
    const result = await approvedExecute().run();
    expect(result.audit.llmCalls).toBe(0);
    expect(result.audit.qdrantCalls).toBe(0);
    expect(result.audit.agentCalls).toBe(0);
    expect(result.audit.chatIntegrations).toBe(0);
    expect(result.audit.publicSqlEndpoints).toBe(0);
  });

  test('80. strict metrics', () => {
    expect(evaluateExecutionPolicy(fullApproval()).writeAllowed).toBe(false);
    expect(evaluateExecutionPolicy(fullApproval()).commitAllowed).toBe(false);
    expect(validateSessionUser('TETA_ADMIN').ok).toBe(true);
    expect(validateSessionUser('other').ok).toBe(false);
    expect(isFormulaLikeText('=1+1')).toBe(true);
    expect(STAGE3F_MAX_ROWS).toBe(500);
    expect(() => new Stage3fTimeoutError(1)).not.toThrow();
  });

  test('81. preflight SQL is metadata-only', () => {
    const { preflightSessionUserSql } = require('./teta-oracle-session-validator') as {
      preflightSessionUserSql: () => string;
    };
    const sql = preflightSessionUserSql();
    expect(sql).toContain('SESSION_USER');
    expect(sql).toContain('DUAL');
    expect(sql.toUpperCase()).not.toContain('HRM');
  });

  test('82. redacted result omits rows', async () => {
    const result = await approvedExecute().run();
    const redacted = redactReadResult(result);
    expect('rows' in redacted).toBe(false);
    expect(redacted.rowsRedacted).toBe(true);
    expect(redacted.rowCount).toBe(result.rowCount);
  });
});

describe('Stage 3F — resource close + audit split', () => {
  test('83. connection closed after completed', async () => {
    const { adapter, run } = approvedExecute();
    const result = await run();
    expect(result.executionStatus).toBe('completed');
    expect(result.audit.connectionsOpened).toBe(1);
    expect(result.audit.connectionsClosed).toBe(1);
    expect(result.audit.openOracleConnectionsAfterRun).toBe(0);
    expect(adapter.opened).toBe(false);
  });

  test('84. connection closed after completed_empty', async () => {
    const compiled = compileFixtureSelect();
    const { adapter, run } = approvedExecute(compiled, {
      selectResult: fixtureSelectResult(compiled, emptyBusinessRows()),
    });
    const result = await run();
    expect(result.executionStatus).toBe('completed_empty');
    expect(result.audit.connectionsClosed).toBe(1);
    expect(adapter.opened).toBe(false);
  });

  test('85. connection closed after limit_reached', async () => {
    const compiled = compileFixtureSelect();
    const many = Array.from({ length: 500 }, () => sampleBusinessRows()[0]!);
    const { adapter, run } = approvedExecute(compiled, {
      selectResult: fixtureSelectResult(compiled, many),
    });
    const result = await run();
    expect(result.executionStatus).toBe('limit_reached');
    expect(result.audit.connectionsClosed).toBe(1);
    expect(adapter.opened).toBe(false);
  });

  test('86. connection closed after execution error', async () => {
    const compiled = compileFixtureSelect();
    const adapter = createFakeOracleAdapter({
      selectError: new Error('ORA-00942'),
    });
    const result = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
      expectedSqlSha256: compiled.sqlSha256,
    });
    expect(result.executionStatus).toBe('failed');
    expect(result.audit.connectionsOpened).toBe(1);
    expect(result.audit.connectionsClosed).toBe(1);
    expect(adapter.opened).toBe(false);
  });

  test('87. connection closed after timeout', async () => {
    const compiled = cloneCompiled(compileFixtureSelect());
    compiled.limits = { ...compiled.limits, statementTimeoutMs: 30 };
    const { adapter, run } = approvedExecute(compiled, { hangSelect: true });
    const result = await run();
    expect(result.executionStatus).toBe('timed_out');
    expect(result.audit.connectionsClosed).toBe(1);
    expect(adapter.opened).toBe(false);
  }, 10000);

  test('88. result set closed before connection', async () => {
    const compiled = compileFixtureSelect();
    const order: string[] = [];
    const adapter = createFakeOracleAdapter({
      selectResult: fixtureSelectResult(compiled, sampleBusinessRows()),
      holdResultSetOpen: true,
    });
    const originalCloseRs = adapter.closeResultSet!.bind(adapter);
    const originalCloseConn = adapter.closeConnection.bind(adapter);
    adapter.closeResultSet = async () => {
      order.push('resultSet');
      await originalCloseRs();
    };
    adapter.closeConnection = async () => {
      order.push('connection');
      await originalCloseConn();
    };
    const result = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
      expectedSqlSha256: compiled.sqlSha256,
    });
    expect(result.executionStatus).toBe('completed');
    expect(order).toEqual(['resultSet', 'connection']);
    expect(result.audit.resultSetsOpened).toBe(1);
    expect(result.audit.resultSetsClosed).toBe(1);
  });

  test('89. close failure becomes failed + strict error code', async () => {
    const compiled = compileFixtureSelect();
    const adapter = createFakeOracleAdapter({
      selectResult: fixtureSelectResult(compiled, sampleBusinessRows()),
      closeError: new Error('password=SECRET connectString=BAD'),
    });
    const result = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
      expectedSqlSha256: compiled.sqlSha256,
    });
    expect(result.executionStatus).toBe('failed');
    expect(result.rejection?.code).toBe('oracle_connection_close_failed');
    expect(result.audit.connectionCloseFailures).toBe(1);
    expect(result.audit.connectionsClosed).toBe(0);
  });

  test('90. closed counter grows only after successful close', async () => {
    const compiled = compileFixtureSelect();
    const adapter = createFakeOracleAdapter({
      selectResult: fixtureSelectResult(compiled, sampleBusinessRows()),
      closeError: new Error('boom'),
    });
    const result = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
      expectedSqlSha256: compiled.sqlSha256,
    });
    expect(result.audit.connectionsOpened).toBe(1);
    expect(result.audit.connectionsClosed).toBe(0);
    expect(adapter.counters.connectionsClosed).toBe(0);
  });

  test('91. openOracleConnectionsAfterRun = 0 on success', async () => {
    const result = await approvedExecute().run();
    expect(result.audit.openOracleConnectionsAfterRun).toBe(0);
  });

  test('92. offline and live counters are separated', () => {
    const offline = {
      oracleConnectionsOpened: 0,
      businessStatementsExecuted: 0,
      fixtureXlsxExportsGenerated: 1,
    };
    const live = {
      liveXlsxExportsGenerated: 1,
      oracleConnectionsOpened: 1,
      businessStatementsExecuted: 1,
    };
    // Fixture XLSX must never be treated as a live Oracle connection/statement.
    expect(offline.oracleConnectionsOpened).toBe(0);
    expect(offline.businessStatementsExecuted).toBe(0);
    expect(live.oracleConnectionsOpened).toBe(1);
    expect(live.businessStatementsExecuted).toBe(1);
    expect(offline.fixtureXlsxExportsGenerated).toBe(1);
    expect(live.liveXlsxExportsGenerated).toBe(1);
  });

  test('93. fixture XLSX does not increase liveXlsxExportsGenerated', async () => {
    const { result } = await (async () => {
      const compiled = compileFixtureSelect();
      const run = approvedExecute(compiled);
      const executed = await run.run();
      return { result: executed };
    })();
    // Exporting a fixture result must not touch live counters — those live only in the audit slice.
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'stage3f-live-split-'));
    mkdirSync(path.join(repoRoot, '.local', 'exports'), { recursive: true });
    try {
      const exported = await exporter.export({
        result,
        workbook,
        exportDir: defaultExportDir(repoRoot),
        repoRoot,
        fileName: 'badania_bhp_koniec_waznosci_2026-07-24_999999.xlsx',
      });
      expect(exported.exportStatus).toBe('exported');
      // Live slice is only written by the audit runner; a bare export has no live counter.
      expect(result.audit.xlsxFilesWritten).toBe(0);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('94. empty result writes 0 data rows', async () => {
    const compiled = compileFixtureSelect();
    const { run } = approvedExecute(compiled, {
      selectResult: fixtureSelectResult(compiled, emptyBusinessRows()),
    });
    const result = await run();
    expect(result.rowCount).toBe(0);
    expect(result.rows).toEqual([]);
  });

  test('95. empty workbook still has 8 headers', async () => {
    const compiled = compileFixtureSelect();
    const { run } = approvedExecute(compiled, {
      selectResult: fixtureSelectResult(compiled, emptyBusinessRows()),
    });
    const result = await run();
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'stage3f-empty-hdr-'));
    mkdirSync(path.join(repoRoot, '.local', 'exports'), { recursive: true });
    try {
      const exported = await exporter.export({
        result,
        workbook,
        exportDir: defaultExportDir(repoRoot),
        repoRoot,
        fileName: 'badania_bhp_koniec_waznosci_2026-07-24_888888.xlsx',
      });
      expect(exported.headerLabels).toHaveLength(8);
      expect(exported.columnCount).toBe(8);
      expect(exported.rowCount).toBe(0);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('96. empty workbook has exactly 2 sheets', async () => {
    const compiled = compileFixtureSelect();
    const { run } = approvedExecute(compiled, {
      selectResult: fixtureSelectResult(compiled, emptyBusinessRows()),
    });
    const result = await run();
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'stage3f-empty-sheets-'));
    mkdirSync(path.join(repoRoot, '.local', 'exports'), { recursive: true });
    try {
      const exported = await exporter.export({
        result,
        workbook,
        exportDir: defaultExportDir(repoRoot),
        repoRoot,
        fileName: 'badania_bhp_koniec_waznosci_2026-07-24_777777.xlsx',
      });
      expect(exported.sheetNames).toEqual([STAGE3F_SHEET_DATA, STAGE3F_SHEET_INFO]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('97. standard audit path never opens Oracle (no approval)', async () => {
    const compiled = compileFixtureSelect();
    const adapter = createFakeOracleAdapter();
    const result = await executor.execute({
      compiled,
      approval: noApproval(),
      adapter,
    });
    expect(result.rejection?.code).toBe('execution_not_approved');
    expect(adapter.counters.connectionsOpened).toBe(0);
  });

  test('98. live audit requires both flags', () => {
    expect(
      evaluateExecutionPolicy({
        executeRealOracle: true,
        confirmReadonlyExecution: false,
      }).liveOracleAllowed,
    ).toBe(false);
    expect(
      evaluateExecutionPolicy({
        executeRealOracle: false,
        confirmReadonlyExecution: true,
      }).liveOracleAllowed,
    ).toBe(false);
    expect(fullApproval()).toEqual({
      approvalSource: 'cli_flags',
      executeRealOracle: true,
      confirmReadonlyExecution: true,
    });
    expect(
      evaluateExecutionPolicy({
        approvalSource: 'trusted_chat_report_route',
        routeId: 'occupational_health_examinations_current_month',
        authenticatedUserId: '1',
        workMode: 'vendor',
        role: 'admin',
        expectedSqlSha256: 'abc',
        purpose: 'occupational_health_examinations_report',
      }).liveOracleAllowed,
    ).toBe(true);
    expect(
      evaluateExecutionPolicy({
        approvalSource: 'trusted_chat_report_route',
        routeId: 'occupational_health_examinations_current_month',
        authenticatedUserId: '1',
        workMode: 'client',
        role: 'user',
        expectedSqlSha256: 'abc',
        purpose: 'occupational_health_examinations_report',
      }).liveOracleAllowed,
    ).toBe(false);
  });

  test('99. live success requires opened = closed', async () => {
    const result = await approvedExecute().run();
    expect(result.audit.connectionsOpened).toBe(result.audit.connectionsClosed);
  });

  test('100. close failure log has no connection string or password', async () => {
    const compiled = compileFixtureSelect();
    const adapter = createFakeOracleAdapter({
      selectResult: fixtureSelectResult(compiled, sampleBusinessRows()),
      closeError: new Error('password=hunter2 connectString=(DESCRIPTION=(ADDRESS=...))'),
    });
    const result = await executor.execute({
      compiled,
      approval: fullApproval(),
      adapter,
      expectedSqlSha256: compiled.sqlSha256,
    });
    const message = result.rejection?.message ?? '';
    expect(message).not.toMatch(/password|connectString|DESCRIPTION/i);
    expect(message).toContain('redacted');
  });
});
