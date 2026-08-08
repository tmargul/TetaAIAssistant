import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { inflateSync } from 'zlib';
import {
  TEUSINK_SUBSTITUTION_MAP,
  extractWrappedBase64Payload,
} from '../teta-oracle-source-index-stage2/teta-stage2-unwrap';

const text = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../../../.local/oracle-source-index-stage2/unwrap-fixtures/AKT_DANE.wrapped.plb',
  ),
  'utf8',
);

// Force extract using all remaining content even if shorter than declared
const lines = text.replace(/\r\n/g, '\n').split('\n');
const headerRe = /^[0-9a-f]+ ([0-9a-f]+)$/i;
let hi = -1;
for (let i = 0; i < lines.length; i += 1) {
  if (headerRe.test(lines[i]!.trim())) {
    hi = i;
    break;
  }
}
let base64 = '';
for (let j = hi + 1; j < lines.length; j += 1) base64 += lines[j];
base64 = base64.replace(/\n/g, '').replace(/\r/g, '');

const decoded = Buffer.from(base64, 'base64').subarray(20);
const substituted = Buffer.alloc(decoded.length);
for (let i = 0; i < decoded.length; i += 1) {
  substituted[i] = TEUSINK_SUBSTITUTION_MAP[decoded[i]!]!;
}
const inflated = inflateSync(substituted);
const withNul = inflated;
const withoutNul =
  inflated.length > 0 && inflated[inflated.length - 1] === 0
    ? inflated.subarray(0, inflated.length - 1)
    : inflated;

const expectedLen = 247210;
const expectedHash =
  '5c10b6ad76101677bd37e8fc135522d0f8e6c17944731fb242d51d357a56e3f0';

function h(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex');
}

// eslint-disable-next-line no-console
console.log(
  JSON.stringify(
    {
      extractOfficial: extractWrappedBase64Payload(text),
      base64Len: base64.length,
      inflatedLen: inflated.length,
      lastByte: inflated[inflated.length - 1],
      withNul: { len: withNul.length, hash: h(withNul), matchLen: withNul.length === expectedLen, matchHash: h(withNul) === expectedHash },
      withoutNul: {
        len: withoutNul.length,
        hash: h(withoutNul),
        matchLen: withoutNul.length === expectedLen,
        matchHash: h(withoutNul) === expectedHash,
      },
      latin1WithNulHash: createHash('sha256')
        .update(withNul.toString('latin1'), 'utf8')
        .digest('hex'),
      headWith: withNul.toString('latin1').slice(0, 40),
      expectedLen,
      expectedHash,
    },
    null,
    2,
  ),
);
