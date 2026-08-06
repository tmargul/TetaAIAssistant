/**
 * Stage 3H — execution fingerprint and bind-value validation.
 * User values never enter sqlText; fingerprint distinguishes same SQL + different binds.
 */
import { createHash } from 'crypto';
import type { CompiledBind, TetaCompiledOracleSelect } from '../teta-oracle-compiler/teta-oracle-compiler.types';
import { isValidIsoLocalDate } from '../teta-report-period/teta-report-period-calendar';
import {
  STAGE3H_MAX_PERIOD_DAYS,
  STAGE3H_MIN_PERIOD_DAYS,
} from '../teta-report-period/teta-report-period.types';

export type OrderedBindValue = {
  name: string;
  oracleType: string;
  semanticType: string;
  value: string | number;
};

export function computeExecutionFingerprintSha256(input: {
  compiledContractVersion: string;
  sqlSha256: string;
  orderedBindValues: OrderedBindValue[];
}): string {
  const canonical = {
    compiledContractVersion: input.compiledContractVersion,
    sqlSha256: input.sqlSha256,
    orderedBindValues: input.orderedBindValues.map((b) => ({
      name: b.name,
      oracleType: b.oracleType,
      semanticType: b.semanticType,
      value: b.value,
    })),
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

export type BindValidationResult =
  | {
      ok: true;
      orderedBindValues: OrderedBindValue[];
      missingBindValues: number;
      extraBindValues: number;
      invalidBindValues: number;
    }
  | {
      ok: false;
      code: 'invalid_execution_bind';
      message: string;
      missingBindValues: number;
      extraBindValues: number;
      invalidBindValues: number;
    };

function normalizeBindValue(
  bind: CompiledBind,
  raw: string | number | Date | undefined,
): { ok: true; value: string | number } | { ok: false; message: string } {
  if (raw === undefined) {
    return { ok: false, message: `missing bind ${bind.name}` };
  }
  if (bind.semanticType === 'positive_integer_days' || bind.oracleType === 'number') {
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(num) || num < STAGE3H_MIN_PERIOD_DAYS || num > STAGE3H_MAX_PERIOD_DAYS) {
      return { ok: false, message: `invalid days bind ${bind.name}` };
    }
    return { ok: true, value: num };
  }
  if (bind.semanticType === 'local_date') {
    if (typeof raw !== 'string' || !isValidIsoLocalDate(raw)) {
      return { ok: false, message: `invalid local_date bind ${bind.name}` };
    }
    return { ok: true, value: raw };
  }
  if (bind.oracleType === 'string' || bind.semanticType === 'user_literal') {
    if (typeof raw !== 'string') {
      return { ok: false, message: `invalid string bind ${bind.name}` };
    }
    return { ok: true, value: raw };
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    return { ok: true, value: raw };
  }
  return { ok: false, message: `unsupported bind type ${bind.name}` };
}

export function validateExecutionBindValues(options: {
  compiled: TetaCompiledOracleSelect;
  bindValues?: Record<string, string | number | Date> | null;
}): BindValidationResult {
  const required = options.compiled.binds ?? [];
  const provided = options.bindValues ?? {};
  const providedKeys = Object.keys(provided);
  const requiredNames = new Set(required.map((b) => b.name));
  let missing = 0;
  let extra = 0;
  let invalid = 0;

  for (const name of providedKeys) {
    if (!requiredNames.has(name)) extra += 1;
  }
  for (const bind of required) {
    if (!(bind.name in provided)) missing += 1;
  }

  if (missing > 0 || extra > 0) {
    return {
      ok: false,
      code: 'invalid_execution_bind',
      message: `bind set mismatch missing=${missing} extra=${extra}`,
      missingBindValues: missing,
      extraBindValues: extra,
      invalidBindValues: 0,
    };
  }

  const ordered: OrderedBindValue[] = [];
  for (const bind of [...required].sort((a, b) => a.ordinal - b.ordinal)) {
    const normalized = normalizeBindValue(bind, provided[bind.name]);
    if (!normalized.ok) {
      invalid += 1;
      return {
        ok: false,
        code: 'invalid_execution_bind',
        message: normalized.message,
        missingBindValues: 0,
        extraBindValues: 0,
        invalidBindValues: invalid,
      };
    }
    ordered.push({
      name: bind.name,
      oracleType: bind.oracleType === 'number' ? 'NUMBER' : 'VARCHAR2',
      semanticType: bind.semanticType ?? 'user_literal',
      value: normalized.value,
    });
  }

  return {
    ok: true,
    orderedBindValues: ordered,
    missingBindValues: 0,
    extraBindValues: 0,
    invalidBindValues: 0,
  };
}
