import * as fs from 'fs';
import * as path from 'path';
import {
  OraclePlsqlUnwrapProvider,
  sha256Buffer,
  unwrapOraclePlsqlSource,
} from '../teta-oracle-source-index-stage2/teta-stage2-unwrap';

const p = path.resolve(
  __dirname,
  '../../../../.local/oracle-source-index-stage2/unwrap-fixtures/AKT_DANE.wrapped.plb',
);
const text = fs.readFileSync(p, 'utf8');
const r = unwrapOraclePlsqlSource(text);
const buf = r.unwrappedSourceText
  ? Buffer.from(r.unwrappedSourceText, 'latin1')
  : null;
// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      status: r.status,
      diagnostics: r.diagnostics,
      len: buf?.length ?? null,
      hash: buf ? sha256Buffer(buf) : null,
      head: r.unwrappedSourceText?.slice(0, 80) ?? null,
      expectedLen: 247210,
      expectedHash:
        '5c10b6ad76101677bd37e8fc135522d0f8e6c17944731fb242d51d357a56e3f0',
    },
    null,
    2,
  ),
);
const o = new OraclePlsqlUnwrapProvider().unwrap({
  owner: 'TETA_ADMIN',
  objectName: 'AKT_DANE',
  objectType: 'PACKAGE_BODY',
  wrappedSourceText: text,
  wrappedSourceHash: 'x',
});
// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      providerStatus: o.status,
      len: o.unwrappedByteLength,
      hash: o.unwrappedSourceHash,
      head: o.unwrappedSourceText?.slice(0, 60),
    },
    null,
    2,
  ),
);
