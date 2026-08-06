import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import {
  REAL_EMPLOYEE_OBJECT_NAME,
  REAL_EMPLOYEE_OBJECT_OWNER,
} from '../teta-employee-card-foundation/teta-foundation-real-graph';
import { fingerprint, sha256 } from './teta-view-metadata.types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const oracledb = require('oracledb') as {
  OUT_FORMAT_OBJECT: number;
  CLOB: unknown;
  STRING: unknown;
  getConnection: (config: {
    user: string;
    password: string;
    connectString: string;
  }) => Promise<OracleConnection>;
};

export interface OracleConnection {
  execute: (
    sql: string,
    binds?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<{ rows?: Array<Record<string, unknown>>; metaData?: Array<{ name: string }> }>;
  close: () => Promise<void>;
}

export interface SafeOracleConfigPresence {
  configExists: boolean;
  mode: string | null;
  identifierType: string | null;
  hasHost: boolean;
  hasUser: boolean;
  hasPassword: boolean;
  port: number | null;
}

function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function resolveAppSqlitePath(repoRoot: string): string | null {
  const candidates = [
    path.join(repoRoot, 'apps', 'api', 'data', 'teta.sqlite'),
    path.join(repoRoot, 'data', 'teta.sqlite'),
    path.join(repoRoot, 'apps', 'api', 'teta.sqlite'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function inspectOracleConfigPresence(repoRoot: string): SafeOracleConfigPresence {
  loadDotEnv(path.join(repoRoot, 'apps', 'api', '.env'));
  const dbPath = resolveAppSqlitePath(repoRoot);
  if (!dbPath) {
    return {
      configExists: false,
      mode: null,
      identifierType: null,
      hasHost: false,
      hasUser: false,
      hasPassword: false,
      port: null,
    };
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare(
        `SELECT mode, identifier_type, port,
                host IS NOT NULL AS has_host,
                length(coalesce(username,'')) > 0 AS has_user,
                length(coalesce(password_encrypted,'')) > 0 AS has_pw
         FROM oracle_connection WHERE id = 1`,
      )
      .get() as
      | {
          mode: string;
          identifier_type: string | null;
          port: number | null;
          has_host: number;
          has_user: number;
          has_pw: number;
        }
      | undefined;
    if (!row) {
      return {
        configExists: false,
        mode: null,
        identifierType: null,
        hasHost: false,
        hasUser: false,
        hasPassword: false,
        port: null,
      };
    }
    return {
      configExists: true,
      mode: row.mode,
      identifierType: row.identifier_type,
      hasHost: Boolean(row.has_host),
      hasUser: Boolean(row.has_user),
      hasPassword: Boolean(row.has_pw),
      port: row.port,
    };
  } finally {
    db.close();
  }
}

function readOracleCredentials(repoRoot: string): {
  user: string;
  password: string;
  connectString: string;
} {
  loadDotEnv(path.join(repoRoot, 'apps', 'api', '.env'));
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret === 'change-me-in-production') {
    throw new Error('JWT_SECRET_missing');
  }
  const dbPath = resolveAppSqlitePath(repoRoot);
  if (!dbPath) throw new Error('sqlite_missing');
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare(
        `SELECT mode, host, port, identifier_type, identifier, tns_alias, username, password_encrypted
         FROM oracle_connection WHERE id = 1`,
      )
      .get() as
      | {
          mode: string;
          host: string | null;
          port: number | null;
          identifier_type: string | null;
          identifier: string | null;
          tns_alias: string | null;
          username: string;
          password_encrypted: string;
        }
      | undefined;
    if (!row) throw new Error('oracle_connection_missing');
    const password = decryptSecret(row.password_encrypted, secret);
    let connectString: string;
    if (row.mode === 'tns') connectString = row.tns_alias?.trim() || '';
    else if (row.identifier_type === 'serviceName') {
      connectString = `${row.host}:${row.port ?? 1521}/${row.identifier}`;
    } else {
      connectString = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${row.host})(PORT=${row.port ?? 1521}))(CONNECT_DATA=(SID=${row.identifier})))`;
    }
    return { user: row.username, password, connectString };
  } finally {
    db.close();
  }
}

async function readClobValue(value: unknown): Promise<string> {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  const lob = value as {
    getData?: () => Promise<string>;
    on?: (event: string, cb: (...args: unknown[]) => void) => void;
    setEncoding?: (enc: string) => void;
  };
  if (typeof lob.getData === 'function') {
    return await lob.getData();
  }
  if (typeof lob.on === 'function') {
    return await new Promise<string>((resolve, reject) => {
      let data = '';
      lob.setEncoding?.('utf8');
      lob.on!('data', (chunk: unknown) => {
        data += String(chunk);
      });
      lob.on!('end', () => resolve(data));
      lob.on!('error', (err: unknown) => reject(err));
    });
  }
  return String(value);
}

export interface DatabaseIdentityResult {
  sourceDatabaseIdentityFingerprint: string;
  sourceProductVersion: string | null;
  databaseIdentityConfidence: 'verified' | 'supported' | 'unverified' | 'conflicting';
  connectionOpened: boolean;
  connectionClosed: boolean;
  connectionOpenAfterRun: boolean;
}

export interface ObjectIdentityLookupResult {
  found: boolean;
  owner: string | null;
  objectName: string | null;
  objectType: string | null;
  objectId: number | null;
  objectStatus: 'VALID' | 'INVALID' | 'UNKNOWN';
  lastDdlTime: string | null;
  editionableStatus: 'EDITIONABLE' | 'NONEDITIONABLE' | 'UNKNOWN';
  objectEdition: string | null;
  rowCount: number;
}

export interface SessionEditionResult {
  sessionEdition: string | null;
  sessionNlsSettingsFingerprint: string | null;
}

export interface TetaOwnerEditionCapabilityEvidence {
  owner: string;
  ownerEditionsEnabledStatus: 'enabled' | 'disabled' | 'unavailable' | 'conflicting';
  ownerEditionEvidenceSource: 'DBA_USERS.EDITIONS_ENABLED' | 'ALL_USERS.EDITIONS_ENABLED' | 'unavailable';
  ownerEditionEvidenceFingerprint: string;
}

export interface TetaExactObjectEditionActualizationEvidence {
  allEditionsVisibilityStatus:
    | 'complete_dba_visibility'
    | 'accessible_object_visibility'
    | 'insufficient_visibility'
    | 'unavailable'
    | 'conflicting';
  allEditionsEvidenceSource: 'DBA_OBJECTS_AE' | 'ALL_OBJECTS_AE' | 'unavailable';
  actualObjectVersionCount: number;
  actualEditionNames: string[];
  nullEditionRowCount: number;
  namedEditionRowCount: number;
  multipleActualDefinitionsDetected: boolean;
}

export async function withMetadataOracleConnection<T>(
  repoRoot: string,
  fn: (connection: OracleConnection) => Promise<T>,
): Promise<{
  result: T | null;
  connectionOpened: boolean;
  connectionClosed: boolean;
  connectionOpenAfterRun: boolean;
  error: string | null;
}> {
  let connection: OracleConnection | null = null;
  let connectionOpened = false;
  let connectionClosed = false;
  try {
    const creds = readOracleCredentials(repoRoot);
    connection = await oracledb.getConnection(creds);
    connectionOpened = true;
    const result = await fn(connection);
    await connection.close();
    connectionClosed = true;
    connection = null;
    return {
      result,
      connectionOpened,
      connectionClosed,
      connectionOpenAfterRun: false,
      error: null,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (connection) {
      try {
        await connection.close();
        connectionClosed = true;
      } catch {
        /* ignore */
      }
    }
    return {
      result: null,
      connectionOpened,
      connectionClosed,
      connectionOpenAfterRun: Boolean(connection && !connectionClosed),
      error,
    };
  }
}

export async function probeDatabaseIdentity(
  connection: OracleConnection,
): Promise<DatabaseIdentityResult> {
  const db = await connection.execute(
    `SELECT DBID, NAME, DATABASE_ROLE FROM V$DATABASE`,
    {},
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  const dbRow = (db.rows?.[0] ?? {}) as Record<string, unknown>;
  let version: string | null = null;
  try {
    const ver = await connection.execute(
      `SELECT BANNER FROM V$VERSION WHERE BANNER LIKE 'Oracle%' AND ROWNUM = 1`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    version = String((ver.rows?.[0] as Record<string, unknown> | undefined)?.BANNER ?? '') || null;
  } catch {
    version = null;
  }
  const dbid = dbRow.DBID != null ? String(dbRow.DBID) : null;
  const name = dbRow.NAME != null ? String(dbRow.NAME) : null;
  const role = dbRow.DATABASE_ROLE != null ? String(dbRow.DATABASE_ROLE) : null;
  const confidence: DatabaseIdentityResult['databaseIdentityConfidence'] =
    dbid && name ? 'verified' : 'unverified';
  return {
    sourceDatabaseIdentityFingerprint: fingerprint({
      // no host/user/password
      dbid,
      name,
      role,
      productVersion: version,
    }),
    sourceProductVersion: version,
    databaseIdentityConfidence: confidence,
    connectionOpened: true,
    connectionClosed: false,
    connectionOpenAfterRun: true,
  };
}

export async function probeSessionEdition(
  connection: OracleConnection,
): Promise<SessionEditionResult> {
  const sess = await connection.execute(
    `SELECT SYS_CONTEXT('USERENV','SESSION_EDITION_NAME') AS SESSION_EDITION,
            SYS_CONTEXT('USERENV','LANGUAGE') AS NLS_LANG,
            SYS_CONTEXT('USERENV','NLS_DATE_FORMAT') AS NLS_DATE_FORMAT
     FROM DUAL`,
    {},
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  const row = (sess.rows?.[0] ?? {}) as Record<string, unknown>;
  return {
    sessionEdition: row.SESSION_EDITION != null ? String(row.SESSION_EDITION) : null,
    sessionNlsSettingsFingerprint: fingerprint({
      language: row.NLS_LANG ?? null,
      dateFormat: row.NLS_DATE_FORMAT ?? null,
    }),
  };
}

export async function executeExactObjectIdentityLookup(
  connection: OracleConnection,
  sqlText: string,
): Promise<ObjectIdentityLookupResult> {
  const result = await connection.execute(
    sqlText,
    {
      owner: REAL_EMPLOYEE_OBJECT_OWNER,
      object_name: REAL_EMPLOYEE_OBJECT_NAME,
      object_type: 'VIEW',
    },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  const rows = result.rows ?? [];
  if (rows.length === 0) {
    return {
      found: false,
      owner: null,
      objectName: null,
      objectType: null,
      objectId: null,
      objectStatus: 'UNKNOWN',
      lastDdlTime: null,
      editionableStatus: 'UNKNOWN',
      objectEdition: null,
      rowCount: 0,
    };
  }
  if (rows.length > 1) {
    return {
      found: true,
      owner: String(rows[0].OWNER ?? ''),
      objectName: String(rows[0].OBJECT_NAME ?? ''),
      objectType: String(rows[0].OBJECT_TYPE ?? ''),
      objectId: rows[0].OBJECT_ID != null ? Number(rows[0].OBJECT_ID) : null,
      objectStatus: 'UNKNOWN',
      lastDdlTime: null,
      editionableStatus: 'UNKNOWN',
      objectEdition: null,
      rowCount: rows.length,
    };
  }
  const row = rows[0];
  const statusRaw = String(row.STATUS ?? 'UNKNOWN').toUpperCase();
  const objectStatus =
    statusRaw === 'VALID' || statusRaw === 'INVALID' ? statusRaw : 'UNKNOWN';
  const edRaw = String(row.EDITIONABLE ?? '').toUpperCase();
  const editionableStatus =
    edRaw === 'Y' || edRaw === 'EDITIONABLE'
      ? 'EDITIONABLE'
      : edRaw === 'N' || edRaw === 'NONEDITIONABLE'
        ? 'NONEDITIONABLE'
        : 'UNKNOWN';
  return {
    found: true,
    owner: String(row.OWNER ?? ''),
    objectName: String(row.OBJECT_NAME ?? ''),
    objectType: String(row.OBJECT_TYPE ?? ''),
    objectId: row.OBJECT_ID != null ? Number(row.OBJECT_ID) : null,
    objectStatus,
    lastDdlTime: row.LAST_DDL_TIME != null ? String(row.LAST_DDL_TIME) : null,
    editionableStatus,
    objectEdition: row.EDITION_NAME != null ? String(row.EDITION_NAME) : null,
    rowCount: 1,
  };
}

export async function executeOwnerEditionCapabilityLookup(
  connection: OracleConnection,
  owner: string,
): Promise<TetaOwnerEditionCapabilityEvidence> {
  const tryLookup = async (sqlText: string, source: TetaOwnerEditionCapabilityEvidence['ownerEditionEvidenceSource']) => {
    const result = await connection.execute(sqlText, { owner }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const row = (result.rows?.[0] ?? null) as Record<string, unknown> | null;
    if (!row) {
      return {
        owner,
        ownerEditionsEnabledStatus: 'unavailable' as const,
        ownerEditionEvidenceSource: source,
      };
    }
    const raw = String(row.EDITIONS_ENABLED ?? '').toUpperCase();
    const ownerEditionsEnabledStatus =
      raw === 'Y' ? ('enabled' as const) : raw === 'N' ? ('disabled' as const) : ('conflicting' as const);
    return { owner, ownerEditionsEnabledStatus, ownerEditionEvidenceSource: source };
  };

  try {
    const fromDba = await tryLookup(
      'SELECT USERNAME, EDITIONS_ENABLED FROM DBA_USERS WHERE USERNAME = :owner',
      'DBA_USERS.EDITIONS_ENABLED',
    );
    return {
      ...fromDba,
      ownerEditionEvidenceFingerprint: fingerprint(fromDba),
    };
  } catch {
    try {
      const fromAll = await tryLookup(
        'SELECT USERNAME, EDITIONS_ENABLED FROM ALL_USERS WHERE USERNAME = :owner',
        'ALL_USERS.EDITIONS_ENABLED',
      );
      return {
        ...fromAll,
        ownerEditionEvidenceFingerprint: fingerprint(fromAll),
      };
    } catch {
      const fallback = {
        owner,
        ownerEditionsEnabledStatus: 'unavailable' as const,
        ownerEditionEvidenceSource: 'unavailable' as const,
      };
      return {
        ...fallback,
        ownerEditionEvidenceFingerprint: fingerprint(fallback),
      };
    }
  }
}

export async function executeExactObjectAllEditionsLookup(
  connection: OracleConnection,
  owner: string,
  objectName: string,
  objectType: string,
): Promise<TetaExactObjectEditionActualizationEvidence> {
  const summarize = (
    rows: Array<Record<string, unknown>>,
    source: TetaExactObjectEditionActualizationEvidence['allEditionsEvidenceSource'],
    visibility: TetaExactObjectEditionActualizationEvidence['allEditionsVisibilityStatus'],
  ): TetaExactObjectEditionActualizationEvidence => {
    const editionNames = rows
      .map((r) => (r.EDITION_NAME == null ? null : String(r.EDITION_NAME)))
      .filter((x): x is string => Boolean(x));
    const objectIds = new Set(rows.map((r) => String(r.OBJECT_ID ?? '')));
    return {
      allEditionsVisibilityStatus: visibility,
      allEditionsEvidenceSource: source,
      actualObjectVersionCount: rows.length,
      actualEditionNames: Array.from(new Set(editionNames)).sort(),
      nullEditionRowCount: rows.filter((r) => r.EDITION_NAME == null).length,
      namedEditionRowCount: rows.filter((r) => r.EDITION_NAME != null).length,
      multipleActualDefinitionsDetected: objectIds.size > 1 || rows.length > 1,
    };
  };

  try {
    const dba = await connection.execute(
      'SELECT OWNER, OBJECT_NAME, OBJECT_TYPE, EDITION_NAME, OBJECT_ID, STATUS, EDITIONABLE FROM DBA_OBJECTS_AE WHERE OWNER = :owner AND OBJECT_NAME = :object_name AND OBJECT_TYPE = :object_type',
      { owner, object_name: objectName, object_type: objectType },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return summarize(dba.rows ?? [], 'DBA_OBJECTS_AE', 'complete_dba_visibility');
  } catch {
    try {
      const all = await connection.execute(
        'SELECT OWNER, OBJECT_NAME, OBJECT_TYPE, EDITION_NAME, OBJECT_ID, STATUS, EDITIONABLE FROM ALL_OBJECTS_AE WHERE OWNER = :owner AND OBJECT_NAME = :object_name AND OBJECT_TYPE = :object_type',
        { owner, object_name: objectName, object_type: objectType },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const rows = all.rows ?? [];
      return summarize(
        rows,
        'ALL_OBJECTS_AE',
        rows.length > 0 ? 'accessible_object_visibility' : 'insufficient_visibility',
      );
    } catch {
      return {
        allEditionsVisibilityStatus: 'unavailable',
        allEditionsEvidenceSource: 'unavailable',
        actualObjectVersionCount: 0,
        actualEditionNames: [],
        nullEditionRowCount: 0,
        namedEditionRowCount: 0,
        multipleActualDefinitionsDetected: false,
      };
    }
  }
}

export async function executeExactViewDdlExport(
  connection: OracleConnection,
  sqlText: string,
): Promise<{ raw: Buffer; declaredLength: number | null; textLengthHint: number | null }> {
  let textLengthHint: number | null = null;
  try {
    const len = await connection.execute(
      `SELECT TEXT_LENGTH FROM ALL_VIEWS WHERE OWNER = :owner AND VIEW_NAME = :object_name`,
      { owner: REAL_EMPLOYEE_OBJECT_OWNER, object_name: REAL_EMPLOYEE_OBJECT_NAME },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const v = (len.rows?.[0] as Record<string, unknown> | undefined)?.TEXT_LENGTH;
    textLengthHint = v != null ? Number(v) : null;
  } catch {
    textLengthHint = null;
  }

  const result = await connection.execute(
    sqlText,
    {
      object_type: 'VIEW',
      object_name: REAL_EMPLOYEE_OBJECT_NAME,
      owner: REAL_EMPLOYEE_OBJECT_OWNER,
    },
    {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      fetchInfo: { DDL: { type: oracledb.STRING } },
    },
  );
  const cell = result.rows?.[0]?.DDL;
  const text = await readClobValue(cell);
  return {
    raw: Buffer.from(text, 'utf8'),
    declaredLength: textLengthHint,
    textLengthHint,
  };
}

export function hashOpaque(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export { sha256 };
