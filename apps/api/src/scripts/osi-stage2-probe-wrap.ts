/**
 * Quick probe: wrapped body ratio + payroll view + AKT_DANE head.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';

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
    const q = async (sql: string, binds: Record<string, unknown> = {}) => {
      const r = await c.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return r.rows ?? [];
    };
    const wrapped = await q(
      `SELECT COUNT(DISTINCT name) AS CNT FROM all_source
       WHERE owner='TETA_ADMIN' AND type='PACKAGE BODY' AND line=1
         AND UPPER(text) LIKE '%WRAPPED%'`,
    );
    const bodies = await q(
      `SELECT COUNT(*) AS CNT FROM all_objects WHERE owner='TETA_ADMIN' AND object_type='PACKAGE BODY'`,
    );
    const akt = await q(
      `SELECT line AS LINE, SUBSTR(text,1,100) AS T
       FROM all_source
       WHERE owner='TETA_ADMIN' AND name='AKT_DANE' AND type='PACKAGE BODY' AND line<=5
       ORDER BY line`,
    );
    let payrollDdl: unknown = null;
    try {
      const r = await q(
        `SELECT DBMS_METADATA.GET_DDL('VIEW','NT_KP_PLC_SKLADNIKI_OBL','TETA_ADMIN') AS DDL FROM dual`,
      );
      const ddl = r[0]?.DDL;
      const text = ddl == null ? '' : String(ddl);
      payrollDdl = { len: text.length, head: text.slice(0, 400) };
    } catch (e) {
      payrollDdl = { error: String(e) };
    }
    let payrollText: unknown = null;
    try {
      const r = await c.execute(
        `SELECT text FROM all_views WHERE owner='TETA_ADMIN' AND view_name='NT_KP_PLC_SKLADNIKI_OBL'`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchInfo: { TEXT: { type: oracledb.STRING } } },
      );
      const text = String((r.rows?.[0] as { TEXT?: string } | undefined)?.TEXT ?? '');
      payrollText = { len: text.length, head: text.slice(0, 400), hasLSklObl: /L_SKL_OBL/i.test(text) };
    } catch (e) {
      payrollText = { error: String(e) };
    }
    console.log(
      JSON.stringify(
        {
          wrappedBodies: wrapped[0],
          totalBodies: bodies[0],
          akt: akt.map((a: { LINE: number; T: string }) => ({ line: a.LINE, t: String(a.T) })),
          payrollDdl,
          payrollText,
        },
        null,
        2,
      ),
    );
  } finally {
    await c.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
