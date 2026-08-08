/**
 * Local review helper — KP/HH/CR program-read verification + owner/view audits.
 * Not part of Stage 2 runtime contract.
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
    const pkgs = [
      { name: 'KP_ABFM_AGL', table: 'KP_KDR_ABSENCE_FAMILY_MEMBERS', module: 'KP' },
      { name: 'HH_DIC_DPTY_AGD', table: 'HH_DIC_PLACE_TYPES', module: 'HH' },
      { name: 'CR_CAAT_AGL', table: 'CR_CAKT_ATTRIBUTES', module: 'CR' },
    ];

    const programReadExamples = [];
    for (const p of pkgs) {
      const r = await c.execute(
        `SELECT text AS "TEXT"
         FROM all_source
         WHERE owner = 'TETA_ADMIN' AND name = :n AND type = 'PACKAGE BODY'
         ORDER BY line`,
        { n: p.name },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const src = (r.rows ?? []).map((row: { TEXT: string }) => String(row.TEXT ?? '')).join('');
      const wrapped = /\bwrapped\b/i.test(src.slice(0, 200));
      const re = new RegExp(
        `SELECT[\\s\\S]{0,160}?FROM\\s+(?:TETA_ADMIN\\.)?${p.table}\\b`,
        'i',
      );
      const m = src.match(re);
      let excerpt = m ? m[0].replace(/\s+/g, ' ').slice(0, 240) : null;
      if (!excerpt) {
        const idx = src.toUpperCase().indexOf(p.table);
        excerpt =
          idx >= 0
            ? src
                .slice(Math.max(0, idx - 50), idx + p.table.length + 60)
                .replace(/\s+/g, ' ')
            : null;
      }
      programReadExamples.push({
        module: p.module,
        programUnit: `TETA_ADMIN.${p.name}`,
        objectType: 'PACKAGE BODY',
        expectedObject: `TETA_ADMIN.${p.table}`,
        wrapped,
        sourceLength: src.length,
        selectFromExcerpt: excerpt,
        actualReadEdge: `oracle-object:TETA_ADMIN:TABLE:${p.table}`,
        verifiedInSource: Boolean(excerpt && excerpt.toUpperCase().includes(p.table)),
      });
    }

    const longView = await c.execute(
      `SELECT view_name AS "VIEW_NAME", text_length AS "TEXT_LENGTH"
       FROM all_views
       WHERE owner = 'TETA_ADMIN'
       ORDER BY text_length DESC NULLS LAST
       FETCH FIRST 8 ROWS ONLY`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const longestName = String(longView.rows?.[0]?.VIEW_NAME ?? '');
    let longViewFetch: Record<string, unknown> | null = null;
    if (longestName) {
      const vr = await c.execute(
        `SELECT text AS "TEXT", text_length AS "TEXT_LENGTH"
         FROM all_views WHERE owner = 'TETA_ADMIN' AND view_name = :n`,
        { n: longestName },
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: { TEXT: { type: oracledb.STRING } },
        },
      );
      const text = String(vr.rows?.[0]?.TEXT ?? '');
      const textLength = Number(vr.rows?.[0]?.TEXT_LENGTH ?? 0);
      longViewFetch = {
        view: `TETA_ADMIN.${longestName}`,
        textLength,
        fetchedLength: text.length,
        sourceComplete: textLength > 0 ? text.length >= textLength : text.length > 0,
        sourceAcquisitionMethod: 'ALL_VIEWS.TEXT',
        sourceHash: crypto.createHash('sha256').update(text).digest('hex'),
        head: text.slice(0, 120).replace(/\s+/g, ' '),
      };
    }

    const cross = await c.execute(
      `SELECT referenced_owner AS "REFERENCED_OWNER", COUNT(*) AS "CNT"
       FROM all_dependencies
       WHERE owner = 'TETA_ADMIN'
         AND referenced_owner NOT IN ('TETA_ADMIN', 'SYS', 'PUBLIC', 'SYSTEM')
       GROUP BY referenced_owner
       ORDER BY COUNT(*) DESC
       FETCH FIRST 25 ROWS ONLY`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const ownersDisc = await c.execute(
      `SELECT DISTINCT owner AS "OWNER"
       FROM all_objects
       WHERE owner LIKE 'TETA%' OR owner LIKE '%ADMIN%'
       ORDER BY 1`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const report = {
      programReadExamples,
      longViewSample: longView.rows,
      longViewFetch,
      crossOwnerFromTetaAdmin: cross.rows,
      tetaLikeOwners: ownersDisc.rows,
    };

    const outPath = path.join(
      repoRoot,
      '.local/oracle-source-index-stage2/review/manual-verify-live-v1.json',
    );
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await c.close();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
