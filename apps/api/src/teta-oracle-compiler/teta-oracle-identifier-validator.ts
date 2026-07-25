/**
 * Stage 3E — Oracle identifier validation.
 *
 * Identifiers are never quoted and never concatenated from free text: every owner, object, column
 * and alias is validated against a strict pattern and then assembled from validated parts.
 */

export const ORACLE_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9_$#]*$/;
export const ORACLE_IDENTIFIER_MAX_LENGTH = 128;

export type IdentifierIssue = {
  code: string;
  message: string;
  kind: string;
  value: string;
};

const FORBIDDEN_FRAGMENTS: Array<{ fragment: string; code: string }> = [
  { fragment: '"', code: 'quoted_identifier_forbidden' },
  { fragment: "'", code: 'string_literal_in_identifier' },
  { fragment: '`', code: 'backtick_in_identifier' },
  { fragment: ' ', code: 'whitespace_in_identifier' },
  { fragment: '\t', code: 'whitespace_in_identifier' },
  { fragment: '\n', code: 'whitespace_in_identifier' },
  { fragment: ';', code: 'statement_separator_in_identifier' },
  { fragment: '@', code: 'db_link_in_identifier' },
  { fragment: '--', code: 'comment_in_identifier' },
  { fragment: '/*', code: 'comment_in_identifier' },
  { fragment: '*/', code: 'comment_in_identifier' },
  { fragment: '*', code: 'wildcard_in_identifier' },
  { fragment: '(', code: 'parenthesis_in_identifier' },
  { fragment: ')', code: 'parenthesis_in_identifier' },
  { fragment: ',', code: 'comma_in_identifier' },
  { fragment: '.', code: 'dot_in_identifier_part' },
  { fragment: '=', code: 'operator_in_identifier' },
  { fragment: '|', code: 'operator_in_identifier' },
  { fragment: ':', code: 'bind_marker_in_identifier' },
];

export function isValidOracleIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= ORACLE_IDENTIFIER_MAX_LENGTH &&
    ORACLE_IDENTIFIER_PATTERN.test(value)
  );
}

export function validateIdentifier(kind: string, value: unknown): IdentifierIssue | null {
  if (typeof value !== 'string' || value.length === 0) {
    return {
      code: 'empty_identifier',
      kind,
      value: String(value ?? ''),
      message: `${kind} identifier is empty`,
    };
  }
  for (const { fragment, code } of FORBIDDEN_FRAGMENTS) {
    if (value.includes(fragment)) {
      return {
        code,
        kind,
        value,
        message: `${kind} identifier "${value}" contains forbidden fragment ${JSON.stringify(fragment)}`,
      };
    }
  }
  if (value.length > ORACLE_IDENTIFIER_MAX_LENGTH) {
    return {
      code: 'identifier_too_long',
      kind,
      value,
      message: `${kind} identifier "${value}" exceeds ${ORACLE_IDENTIFIER_MAX_LENGTH} characters`,
    };
  }
  if (!ORACLE_IDENTIFIER_PATTERN.test(value)) {
    return {
      code: 'identifier_pattern_mismatch',
      kind,
      value,
      message: `${kind} identifier "${value}" does not match ${ORACLE_IDENTIFIER_PATTERN}`,
    };
  }
  return null;
}

export type QualifiedNameResult =
  | { ok: true; text: string }
  | { ok: false; issue: IdentifierIssue };

/** Builds `OWNER.OBJECT_NAME` from separately validated parts. */
export function buildQualifiedObjectName(owner: unknown, objectName: unknown): QualifiedNameResult {
  const ownerIssue = validateIdentifier('owner', owner);
  if (ownerIssue) return { ok: false, issue: ownerIssue };
  const objectIssue = validateIdentifier('objectName', objectName);
  if (objectIssue) return { ok: false, issue: objectIssue };
  return { ok: true, text: `${owner as string}.${objectName as string}` };
}

/** Builds `ALIAS.COLUMN_NAME` from separately validated parts. */
export function buildQualifiedColumn(alias: unknown, columnName: unknown): QualifiedNameResult {
  const aliasIssue = validateIdentifier('alias', alias);
  if (aliasIssue) return { ok: false, issue: aliasIssue };
  const columnIssue = validateIdentifier('columnName', columnName);
  if (columnIssue) return { ok: false, issue: columnIssue };
  return { ok: true, text: `${alias as string}.${columnName as string}` };
}

/** Converts a business role such as `employee_number` to the result alias `EMPLOYEE_NUMBER`. */
export function toUpperSnakeIdentifier(businessRole: string): string {
  const upper = (businessRole ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_$#]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
  if (!upper) return '';
  return /^[A-Z]/.test(upper) ? upper : `C_${upper}`;
}

export type ParsedOracleColumnNodeId = {
  owner: string;
  objectName: string;
  columnName: string;
};

/** Parses `oracle-column:OWNER:OBJECT:COLUMN`. */
export function parseOracleColumnNodeId(nodeId: string | null): ParsedOracleColumnNodeId | null {
  if (!nodeId) return null;
  const parts = nodeId.split(':');
  if (parts[0] !== 'oracle-column' || parts.length < 4) return null;
  const [, owner, objectName, ...rest] = parts;
  if (!owner || !objectName || !rest.length) return null;
  return { owner, objectName, columnName: rest.join(':') };
}

export type ParsedOracleObjectNodeId = {
  owner: string;
  objectType: string;
  objectName: string;
};

/** Parses `oracle-object:OWNER:TYPE:NAME`. */
export function parseOracleObjectNodeId(nodeId: string | null): ParsedOracleObjectNodeId | null {
  if (!nodeId) return null;
  const parts = nodeId.split(':');
  if (parts[0] !== 'oracle-object' || parts.length < 4) return null;
  const [, owner, objectType, ...rest] = parts;
  if (!owner || !objectType || !rest.length) return null;
  return { owner, objectType, objectName: rest.join(':') };
}

/** Builds `oracle-column:OWNER:OBJECT:COLUMN` from validated parts. */
export function buildOracleColumnNodeId(
  owner: string,
  objectName: string,
  columnName: string,
): string {
  return `oracle-column:${owner}:${objectName}:${columnName}`;
}
