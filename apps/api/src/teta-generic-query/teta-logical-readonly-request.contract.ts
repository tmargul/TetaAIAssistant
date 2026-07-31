import { createHash } from 'crypto';
import {
  FORBIDDEN_LOGICAL_REQUEST_KEYS,
  STAGE3K1_CONTRACT_VERSION,
  type LogicalReadonlyRequest,
} from './teta-logical-readonly-request.types';
import {
  CANONICAL_BUSINESS_CONCEPT_KEYS,
  PSEUDO_CONCEPT_KEYS_FORBIDDEN,
} from './teta-query-capability.types';

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
    return out;
  }
  return value;
}

export function computeInputFingerprint(queryNormalized: string, configVersions: Record<string, string>): string {
  return sha256(stableStringify({ queryNormalized, configVersions }));
}

export function computeSemanticFingerprint(
  request: Omit<
    LogicalReadonlyRequest,
    | 'logicalRequestFingerprintSha256'
    | 'requestId'
    | 'inputFingerprintSha256'
    | 'semanticFingerprintSha256'
  >,
): string {
  return sha256(stableStringify(request));
}

export function makeRequestId(inputFingerprint: string): string {
  return `logical-req:${inputFingerprint.slice(0, 24)}`;
}

export function assertNoForbiddenLogicalFields(obj: unknown, path = '$'): string[] {
  const errors: string[] = [];
  if (!obj || typeof obj !== 'object') return errors;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => errors.push(...assertNoForbiddenLogicalFields(item, `${path}[${i}]`)));
    return errors;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if ((FORBIDDEN_LOGICAL_REQUEST_KEYS as readonly string[]).includes(key)) {
      errors.push(`forbidden_field:${path}.${key}`);
    }
    if (key === 'conceptKey' && typeof value === 'string') {
      if ((PSEUDO_CONCEPT_KEYS_FORBIDDEN as readonly string[]).includes(value)) {
        errors.push(`pseudo_conceptKey:${path}:${value}`);
      }
      if (/^(NT_|T_)/i.test(value) || value.includes('.')) {
        errors.push(`oracle_like_conceptKey:${path}:${value}`);
      }
      if (!CANONICAL_BUSINESS_CONCEPT_KEYS.has(value)) {
        errors.push(`non_canonical_conceptKey:${path}:${value}`);
      }
    }
    errors.push(...assertNoForbiddenLogicalFields(value, `${path}.${key}`));
  }
  return errors;
}

export function looksLikeOracleObjectName(text: string): boolean {
  return /^(NT_|T_)[A-Z0-9_]+$/i.test(text.trim()) || /\bTETA_ADMIN\b/i.test(text);
}

export function looksLikeOracleColumnName(text: string): boolean {
  return /^(NAZWISKO|IMIE|NR_EW|DATA_OD|DATA_DO|PRAC_ID|SSTN_ID|JEOR_ID)$/i.test(text.trim());
}

export function validateContractVersion(request: LogicalReadonlyRequest): string[] {
  return request.contractVersion !== STAGE3K1_CONTRACT_VERSION ? ['invalid_contract_version'] : [];
}

export function countPseudoConceptKeys(obj: unknown): number {
  let n = 0;
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'conceptKey' && typeof val === 'string') {
        if ((PSEUDO_CONCEPT_KEYS_FORBIDDEN as readonly string[]).includes(val)) n += 1;
      }
      walk(val);
    }
  };
  walk(obj);
  return n;
}
