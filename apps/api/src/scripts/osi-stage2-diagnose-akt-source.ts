import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import {
  extractWrappedBase64Payload,
  unwrapOraclePlsqlSource,
  sha256Buffer,
} from '../teta-oracle-source-index-stage2/teta-stage2-unwrap';

function loadDotEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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

async function main() {
  const repoRoot = path.resolve(__dirname, '../../../..');
  loadDotEnv(path.join(repoRoot, 'apps/api/.env'));
  const secret = process.env.JWT_SECRET!.trim();
  const db = new Database(path.join(repoRoot, 'apps/api/data/teta.sqlite'), {
    readonly: true,
  });
  const row = db
    .prepare(
      `SELECT host, port, identifier, username, password_encrypted FROM oracle_connection WHERE id = 1`,
    )
    .get() as {
    host: string;
    port: number;
    identifier: string;
    username: string;
    password_encrypted: string;
  };
  db.close();
  const password = decryptSecret(row.password_encrypted, secret);
  const connectString = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${row.host})(PORT=${row.port ?? 1521}))(CONNECT_DATA=(SID=${row.identifier})))`;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const oracledb = require('oracledb');
  const c = await oracledb.getConnection({
    user: row.username,
    password,
    connectString,
  });
  try {
    const stats = await c.execute(
      `SELECT COUNT(*) AS "CNT",
              SUM(LENGTH(text)) AS "SUMLEN",
              MAX(LENGTH(text)) AS "MAXLEN",
              MIN(line) AS "MINL",
              MAX(line) AS "MAXL"
       FROM all_source
       WHERE owner = 'TETA_ADMIN' AND name = 'AKT_DANE' AND type = 'PACKAGE BODY'`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    // eslint-disable-next-line no-console
    console.log('stats', stats.rows?.[0]);

    const r = await c.execute(
      `SELECT line AS "LINE", text AS "TEXT", LENGTH(text) AS "L"
       FROM all_source
       WHERE owner = 'TETA_ADMIN' AND name = 'AKT_DANE' AND type = 'PACKAGE BODY'
       ORDER BY line`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchArraySize: 2000 },
    );
    const rows = r.rows ?? [];
    let join = '';
    let nullish = 0;
    for (const x of rows as Array<{ TEXT: string | null; L: number }>) {
      if (x.TEXT == null) nullish += 1;
      join += x.TEXT == null ? '' : String(x.TEXT);
    }
    // eslint-disable-next-line no-console
    console.log({
      rows: rows.length,
      joinLen: join.length,
      nullish,
      head: join.slice(0, 100),
    });

    const extracted = extractWrappedBase64Payload(join);
    // eslint-disable-next-line no-console
    console.log({
      extractOk: extracted.ok,
      declared: extracted.declaredLength,
      got: extracted.base64?.length ?? null,
      diags: extracted.diagnostics,
    });

    // Try RPAD-safe: Oracle sometimes pads CHAR; use RTRIM
    const r2 = await c.execute(
      `SELECT line AS "LINE", RTRIM(text) AS "TEXT"
       FROM all_source
       WHERE owner = 'TETA_ADMIN' AND name = 'AKT_DANE' AND type = 'PACKAGE BODY'
       ORDER BY line`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchArraySize: 2000 },
    );
    let join2 = '';
    for (const x of (r2.rows ?? []) as Array<{ TEXT: string | null }>) {
      join2 += x.TEXT == null ? '' : String(x.TEXT);
    }
    const ex2 = extractWrappedBase64Payload(join2);
    const u2 = unwrapOraclePlsqlSource(join2);
    const buf = u2.unwrappedSourceText
      ? Buffer.from(u2.unwrappedSourceText, 'latin1')
      : null;
    // eslint-disable-next-line no-console
    console.log({
      rtrimLen: join2.length,
      extractDeclared: ex2.declaredLength,
      extractGot: ex2.base64?.length ?? null,
      unwrap: u2.status,
      unwrappedLen: buf?.length ?? null,
      unwrappedHash: buf ? sha256Buffer(buf) : null,
      head: u2.unwrappedSourceText?.slice(0, 60) ?? null,
      diags: u2.diagnostics,
    });

    // DBMS_METADATA.GET_DDL for package body
    try {
      const ddl = await c.execute(
        `SELECT DBMS_METADATA.GET_DDL('PACKAGE_BODY','AKT_DANE','TETA_ADMIN') AS "DDL" FROM dual`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const lob = ddl.rows?.[0]?.DDL as { getData?: () => Promise<string> } | string | null;
      let ddlText = '';
      if (lob && typeof lob === 'object' && typeof lob.getData === 'function') {
        ddlText = await lob.getData();
      } else {
        ddlText = String(lob ?? '');
      }
      // eslint-disable-next-line no-console
      console.log({
        ddlLen: ddlText.length,
        ddlHead: ddlText.slice(0, 120).replace(/\s+/g, ' '),
        ddlWrapped: /wrapped/i.test(ddlText.slice(0, 500)),
      });
      if (/wrapped/i.test(ddlText)) {
        const ud = unwrapOraclePlsqlSource(ddlText);
        const b = ud.unwrappedSourceText
          ? Buffer.from(ud.unwrappedSourceText, 'latin1')
          : null;
        // eslint-disable-next-line no-console
        console.log({
          ddlUnwrap: ud.status,
          len: b?.length ?? null,
          hash: b ? sha256Buffer(b) : null,
          head: ud.unwrappedSourceText?.slice(0, 60) ?? null,
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('get_ddl_err', String(e));
    }
  } finally {
    await c.close();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
