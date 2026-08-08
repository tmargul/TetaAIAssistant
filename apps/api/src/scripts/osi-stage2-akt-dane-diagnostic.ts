import * as fs from 'fs';
import * as path from 'path';
import { OraclePlsqlUnwrapProvider } from '../teta-oracle-source-index-stage2/teta-stage2-unwrap';
import { extractProgramSqlReads } from '../teta-oracle-source-index-stage2/teta-stage2-parse';

const text = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../../.local/oracle-source-index-stage2/unwrap-fixtures/AKT_DANE.wrapped.plb',
  ),
  'utf8',
);
const u = new OraclePlsqlUnwrapProvider().unwrap({
  owner: 'TETA_ADMIN',
  objectName: 'AKT_DANE',
  objectType: 'PACKAGE_BODY',
  wrappedSourceText: text,
  wrappedSourceHash: 'x',
});
const t = u.unwrappedSourceText || '';
const reads = extractProgramSqlReads(t);
const names = new Set(reads.map((r) => r.qualified.objectName));
const out = {
  unwrap: u.status,
  len: u.unwrappedByteLength,
  hash: u.unwrappedSourceHash,
  head: t.slice(0, 40),
  sgrcFn: /FUNCTION\s+SGRC_NAZWA/i.test(t),
  has_L_GR_CZ_PRACY: names.has('L_GR_CZ_PRACY'),
  has_SL_GR_CZ: names.has('SL_GR_CZ'),
  has_T_PRAC: names.has('T_PRAC'),
  readCount: reads.length,
  sample: [...names].slice(0, 30),
};
fs.writeFileSync(
  path.resolve(
    __dirname,
    '../../../../.local/oracle-source-index-stage2/review/akt-dane-unwrap-diagnostic-v1.json',
  ),
  JSON.stringify(out, null, 2),
);
// eslint-disable-next-line no-console
console.log(JSON.stringify(out, null, 2));
