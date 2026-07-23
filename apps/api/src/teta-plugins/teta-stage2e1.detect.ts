/**
 * Stage 2E.1 — deterministic detectors for .NET types vs Oracle vs dataset columns.
 */

const DOTNET_ROLE_SEGMENTS = /\.(BO|DF|TG|MTG|STG)\./i;
const DOTNET_SUFFIX = /(BO|DF|TG|MTG|STG)$/i;
const TETA_PREFIX = /^Teta\./i;
const TETA_PREFIX_UPPER = /^TETA\./;

/** PascalCase dataset-like token without Oracle prefixes. */
const DATASET_COLUMN_RE =
  /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/;

const ORACLE_NAME_RE =
  /^(NT_|V_|T_|KP_|LG_|PA_|ALL_|USER_|DBA_|GV\$|V\$)[A-Z0-9_$#]*$/i;

export type InvalidOracleCandidateClass =
  | 'invalid_oracle_candidate_dotnet_type'
  | 'invalid_oracle_candidate_dataset_column'
  | 'invalid_oracle_candidate_dataset_name'
  | 'invalid_oracle_candidate_control'
  | 'invalid_oracle_candidate_unknown';

export function looksLikeOraclePhysicalName(name?: string | null): boolean {
  if (!name) return false;
  const n = name.trim();
  if (!n) return false;
  if (n.includes('.')) {
    // OWNER.OBJECT — both sides typically ALL_CAPS Oracle identifiers
    if (
      /^[A-Z][A-Z0-9_$#]*\.[A-Z][A-Z0-9_$#]*$/.test(n) &&
      !TETA_PREFIX.test(n) &&
      !TETA_PREFIX_UPPER.test(n)
    ) {
      return true;
    }
    return false;
  }
  return ORACLE_NAME_RE.test(n) || (/^[A-Z][A-Z0-9_$#]{2,}$/.test(n) && !DOTNET_SUFFIX.test(n));
}

export function isDotNetTypeName(name?: string | null): boolean {
  if (!name) return false;
  const n = name.trim();
  if (!n) return false;
  if (TETA_PREFIX.test(n) || TETA_PREFIX_UPPER.test(n)) return true;
  if (DOTNET_ROLE_SEGMENTS.test(n)) return true;
  // Uppercased full type: TETA.SUMO....MTG....
  if (/^TETA\.[A-Z0-9.]+$/i.test(n) && /\.(BO|DF|TG|MTG|STG)\./i.test(n)) return true;
  if (/\.(BO|DF|TG|MTG|STG)\./i.test(n)) return true;
  // Simple type ending with role suffix and containing dots (namespace)
  if (n.includes('.') && DOTNET_SUFFIX.test(n.split('.').pop() || '')) return true;
  return false;
}

export function parseDatasetColumnRef(
  name?: string | null,
): { datasetTable: string; columnName: string } | null {
  if (!name) return null;
  const n = name.trim();
  const m = n.match(DATASET_COLUMN_RE);
  if (!m) return null;
  const datasetTable = m[1]!;
  const columnName = m[2]!;
  // Exclude Oracle-qualified OWNER.OBJECT
  if (looksLikeOraclePhysicalName(datasetTable) && looksLikeOraclePhysicalName(columnName)) {
    // Could be OWNER.OBJECT — not dataset.column
    if (/^[A-Z0-9_$#]+$/.test(datasetTable) && datasetTable === datasetTable.toUpperCase()) {
      return null;
    }
  }
  // Dataset tables are typically PascalCase / mixed
  if (isDotNetTypeName(n)) return null;
  if (looksLikeOraclePhysicalName(n)) return null;
  // Heuristic: PascalCase left side OR known logical lookup names
  if (/[a-z]/.test(datasetTable) || /^[A-Z][a-z]/.test(datasetTable)) {
    return { datasetTable, columnName };
  }
  // All-caps short left with common column right (ID, NAZWA) from Stage 2C stubs
  if (/^(ID|NAZWA|KOD|OPIS|STATUS|UP_TO_DATE)$/i.test(columnName) && !looksLikeOraclePhysicalName(datasetTable)) {
    return { datasetTable, columnName };
  }
  return null;
}

export function classifyInvalidOracleCandidate(
  name: string,
  opts?: {
    matchedDotNetNode?: boolean;
    matchedDatasetTable?: boolean;
    matchedControl?: boolean;
  },
): InvalidOracleCandidateClass | null {
  if (isDotNetTypeName(name) || opts?.matchedDotNetNode) {
    return 'invalid_oracle_candidate_dotnet_type';
  }
  if (parseDatasetColumnRef(name)) {
    return 'invalid_oracle_candidate_dataset_column';
  }
  if (opts?.matchedDatasetTable) {
    return 'invalid_oracle_candidate_dataset_name';
  }
  if (opts?.matchedControl) {
    return 'invalid_oracle_candidate_control';
  }
  return 'invalid_oracle_candidate_unknown';
}

export function isConfirmedOracleFact(attrs: Record<string, unknown>): boolean {
  const status = String(attrs.oracleValidationStatus ?? '');
  const owner = String(attrs.owner ?? '');
  const objectName = String(attrs.objectName ?? attrs.name ?? '');
  if (isDotNetTypeName(objectName)) return false;
  if (status === 'confirmed' && owner && owner !== 'UNKNOWN') {
    return true;
  }
  if (status === 'synonym_resolved') return true;
  if (
    status === 'missing_in_current_db' &&
    looksLikeOraclePhysicalName(objectName) &&
    !isDotNetTypeName(objectName)
  ) {
    return true;
  }
  return false;
}
