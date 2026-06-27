export function parseOracleNullable(nullable: string | null | undefined): boolean {
  const normalized = String(nullable ?? 'Y').trim().toUpperCase();
  if (normalized === 'N') return false;
  return true;
}

export function hasOracleColumnDefault(dataDefault: string | null | undefined): boolean {
  if (dataDefault == null) return false;
  return dataDefault.length > 0;
}

export function isInsertRequiredColumn(column: {
  nullable?: boolean;
  dataDefault?: string | null;
  isPk?: boolean;
}): boolean {
  if (column.nullable !== false) return false;
  if (column.isPk) return false;
  return !hasOracleColumnDefault(column.dataDefault);
}
