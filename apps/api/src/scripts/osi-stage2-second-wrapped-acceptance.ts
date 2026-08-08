/**
 * Second wrapped PACKAGE BODY acceptance (not AKT_DANE / AKT_DANE_ID).
 * Local-only; does not commit client source.
 */
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { decryptSecret } from '../oracle/oracle-crypto';
import {
  OraclePlsqlUnwrapProvider,
  isOracleWrappedPlsql,
} from '../teta-oracle-source-index-stage2/teta-stage2-unwrap';
import {
  extractDirectCalls,
  extractDmlTargets,
  extractProgramSqlReads,
} from '../teta-oracle-source-index-stage2/teta-stage2-parse';

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
    const candidates = await c.execute(
      `SELECT object_name AS "OBJECT_NAME"
       FROM all_objects
       WHERE owner = 'TETA_ADMIN'
         AND object_type = 'PACKAGE BODY'
         AND object_name NOT IN ('AKT_DANE','AKT_DANE_ID')
         AND object_name LIKE 'KP_%'
       ORDER BY object_name
       FETCH FIRST 40 ROWS ONLY`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const provider = new OraclePlsqlUnwrapProvider();
    let chosen: Record<string, unknown> | null = null;
    for (const cand of (candidates.rows ?? []) as Array<{ OBJECT_NAME: string }>) {
      const name = String(cand.OBJECT_NAME);
      const srcRows = await c.execute(
        `SELECT text AS "TEXT" FROM all_source
         WHERE owner='TETA_ADMIN' AND name=:n AND type='PACKAGE BODY'
         ORDER BY line`,
        { n: name },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const text = ((srcRows.rows ?? []) as Array<{ TEXT: string }>)
        .map((r) => String(r.TEXT ?? ''))
        .join('');
      if (!isOracleWrappedPlsql(text)) continue;
      const u = provider.unwrap({
        owner: 'TETA_ADMIN',
        objectName: name,
        objectType: 'PACKAGE_BODY',
        wrappedSourceText: text,
        wrappedSourceHash: 'live',
      });
      if (u.status !== 'unwrapped' || !u.unwrappedSourceText) continue;
      const body = u.unwrappedSourceText;
      const reads = extractProgramSqlReads(body);
      const writes = extractDmlTargets(body);
      const calls = extractDirectCalls(body);
      chosen = {
        object: `TETA_ADMIN.${name}`,
        unwrapStatus: u.status,
        unwrappedByteLength: u.unwrappedByteLength,
        unwrappedSourceHash: u.unwrappedSourceHash,
        unwrappedHead: body.slice(0, 100).replace(/\s+/g, ' '),
        plausiblePlsql: /^\s*PACKAGE\s+BODY\b/i.test(body),
        readCount: reads.length,
        writeCount: writes.length,
        callCount: calls.length,
        sampleReads: reads.slice(0, 8).map((r) => r.qualified.objectName),
        acceptance:
          u.status === 'unwrapped' && /^\s*PACKAGE\s+BODY\b/i.test(body)
            ? 'unwrapped_successfully_local_teusink_algorithm'
            : u.status,
      };
      break;
    }
    const outPath = path.join(
      repoRoot,
      '.local/oracle-source-index-stage2/review/second-wrapped-acceptance-v1.json',
    );
    fs.writeFileSync(outPath, JSON.stringify(chosen, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(chosen, null, 2));
  } finally {
    await c.close();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
