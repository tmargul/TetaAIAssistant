import * as fs from 'fs';
import * as path from 'path';
import {
  decodeTeusinkWrappedBase64,
  sha256Buffer,
} from '../teta-oracle-source-index-stage2/teta-stage2-unwrap';

const text = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../../.local/oracle-source-index-stage2/unwrap-fixtures/AKT_DANE.wrapped.plb',
  ),
  'utf8',
);
const lines = text.replace(/\r\n/g, '\n').split('\n');
const headerRe = /^[0-9a-f]+ ([0-9a-f]+)$/i;
let hi = -1;
let declared = 0;
for (let i = 0; i < lines.length; i += 1) {
  const m = headerRe.exec(lines[i]!.trim());
  if (m) {
    hi = i;
    declared = parseInt(m[1]!, 16);
    break;
  }
}
let rest = '';
for (let j = hi + 1; j < lines.length; j += 1) rest += lines[j];
const stripped = rest.replace(/\n/g, '').replace(/\r/g, '');
// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      hi,
      declared,
      lineCount: lines.length,
      lineAtHi: lines[hi],
      restLen: rest.length,
      strippedLen: stripped.length,
      deficit: declared - stripped.length,
      last3: lines.slice(-3),
    },
    null,
    2,
  ),
);

function show(label: string, d: ReturnType<typeof decodeTeusinkWrappedBase64>) {
  const b = d.text ? Buffer.from(d.text, 'latin1') : null;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        label,
        ok: d.ok,
        diags: d.diagnostics,
        len: b?.length ?? null,
        hash: b ? sha256Buffer(b) : null,
        head: d.text?.slice(0, 60) ?? null,
      },
      null,
      2,
    ),
  );
}

show('all_stripped', decodeTeusinkWrappedBase64(stripped));
show('slice_declared_if_enough', decodeTeusinkWrappedBase64(stripped.slice(0, Math.min(declared, stripped.length))));

// Teusink accumulates until len >= declared, reading raw lines WITH newlines then strips.
// Replicate exactly:
let base64str = '';
let j = 0;
while (base64str.length < declared && hi + j + 1 < lines.length) {
  j += 1;
  base64str += lines[hi + j];
}
const teusink = base64str.replace(/\n/g, '');
// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      teusinkAccumLenBeforeStrip: base64str.length,
      teusinkAfterStrip: teusink.length,
      linesConsumed: j,
    },
    null,
    2,
  ),
);
show('teusink_exact', decodeTeusinkWrappedBase64(teusink));
