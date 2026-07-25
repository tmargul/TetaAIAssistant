/**
 * Stage 3F — shared fixtures for unit tests / offline audit.
 *
 * Builds compiled selects via the Stage 3E fixture compiler so gate + revalidation exercise real
 * statement text without touching live Oracle or the Stage 3A index.
 */
import { createHash } from 'crypto';
import {
  compileStage3eFixture,
} from '../teta-oracle-compiler/teta-stage3e-audit';
import type { TetaCompiledOracleSelect } from '../teta-oracle-compiler/teta-oracle-compiler.types';
import { sha256Utf8 } from './teta-oracle-executor-contract';
import type { Stage3fAdapterSelectResult } from './teta-oracle-executor.types';

export function cloneCompiled(compiled: TetaCompiledOracleSelect): TetaCompiledOracleSelect {
  return JSON.parse(JSON.stringify(compiled)) as TetaCompiledOracleSelect;
}

/** Fresh Stage 3E fixture compile (deterministic SQL, zero Oracle). */
export function compileFixtureSelect(): TetaCompiledOracleSelect {
  return compileStage3eFixture();
}

export function withMutatedSql(
  compiled: TetaCompiledOracleSelect,
  sqlText: string,
  opts: { rehash?: boolean; keepValidation?: boolean } = {},
): TetaCompiledOracleSelect {
  const next = cloneCompiled(compiled);
  next.sqlText = sqlText;
  if (opts.rehash !== false) {
    next.sqlSha256 = sha256Utf8(sqlText);
  }
  if (opts.keepValidation === false) {
    next.validation = { ...next.validation, ok: false };
  }
  return next;
}

export function fixtureSelectResult(
  compiled: TetaCompiledOracleSelect,
  rows: unknown[][],
): Stage3fAdapterSelectResult {
  const columns = compiled.projections.map((projection) => projection.resultAlias);
  return {
    columns,
    rows,
    metaData: columns.map((name) => ({
      name,
      dbTypeName: name.includes('VALID') ? 'DATE' : 'VARCHAR2',
    })),
  };
}

/** Synthetic rows — never real personal data. */
export function sampleBusinessRows(): unknown[][] {
  return [
    [
      '000123',
      'Anna',
      'Kowalska',
      'Wstępne',
      new Date(2026, 6, 1),
      new Date(2026, 6, 31),
      'Specjalista',
      'Dział IT',
    ],
    [
      '000124',
      '=HYPERLINK("http://evil")',
      '+CMD',
      'Okresowe',
      new Date(2026, 6, 5),
      new Date(2026, 6, 20),
      'Analityk',
      'HR',
    ],
  ];
}

export function emptyBusinessRows(): unknown[][] {
  return [];
}

export function sha256Of(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
