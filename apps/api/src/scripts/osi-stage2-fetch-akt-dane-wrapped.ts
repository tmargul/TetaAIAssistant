/**
 * Fetch AKT_DANE wrapped ALL_SOURCE into local-only fixture (not for git).
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
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
    const r = await c.execute(
      `SELECT text AS "TEXT"
       FROM all_source
       WHERE owner = 'TETA_ADMIN' AND name = 'AKT_DANE' AND type = 'PACKAGE BODY'
       ORDER BY line`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const text = (r.rows ?? [])
      .map((row: { TEXT: string }) => String(row.TEXT ?? ''))
      .join('');
    const outDir = path.join(
      repoRoot,
      '.local/oracle-source-index-stage2/unwrap-fixtures',
    );
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'AKT_DANE.wrapped.plb'), text, 'utf8');
    const sha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    const meta = {
      object: 'TETA_ADMIN.AKT_DANE',
      objectType: 'PACKAGE BODY',
      wrappedByteLength: Buffer.byteLength(text, 'utf8'),
      wrappedSha256: sha256,
      expectedWrappedSha256:
        '6da86cffb3420b4f4d8d0368b6791e3cc13221f544c73ac94c914c8554765e64',
      head: text.slice(0, 160).replace(/\s+/g, ' '),
    };
    fs.writeFileSync(
      path.join(outDir, 'AKT_DANE.wrapped.meta.json'),
      JSON.stringify(meta, null, 2),
      'utf8',
    );
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(meta, null, 2));
  } finally {
    await c.close();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
