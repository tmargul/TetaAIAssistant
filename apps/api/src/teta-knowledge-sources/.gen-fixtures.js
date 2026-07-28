const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../test-fixtures/teta-knowledge-sources/stage3j2a');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function whisper(text, lang = 'pl') {
  return {
    text,
    language: lang,
    segments: [
      { start: 0, end: 1.5, text: text.slice(0, 40), avg_logprob: -0.2, compression_ratio: 1.1, no_speech_prob: 0.01 },
      { start: 1.5, end: 3.0, text: text.slice(0, 40) + ' cont', avg_logprob: -0.25, compression_ratio: 1.2, no_speech_prob: 0.02 },
    ],
  };
}

function ensurePair(label, dirName, opts = {}) {
  const jsonName = `${label}.json`;
  fs.mkdirSync(path.join(root, dirName), { recursive: true });
  const body = opts.invalid
    ? '{ not json'
    : opts.generic
      ? { foo: 1 }
      : opts.emptySegments
        ? { language: 'pl', segments: [{ start: 0, end: 1, text: '   ' }] }
        : opts.nonMono
          ? { language: 'pl', segments: [{ start: 2, end: 3, text: 'a' }, { start: 1, end: 1.5, text: 'b' }] }
          : whisper(opts.text || `Synthetic training ${label}`);
  if (typeof body === 'string') fs.writeFileSync(path.join(root, jsonName), body);
  else fs.writeFileSync(path.join(root, jsonName), JSON.stringify(body, null, 2));

  if (opts.noFrames) return;
  if (opts.emptyDir) return;
  if (opts.sequential) {
    fs.writeFileSync(path.join(root, dirName, 'frame_001.png'), png);
    fs.writeFileSync(path.join(root, dirName, 'frame_002.png'), png);
    return;
  }
  if (opts.manifest) {
    fs.writeFileSync(
      path.join(root, dirName, 'frames-manifest.json'),
      JSON.stringify(
        {
          contractVersion: 'teta-video-frames-manifest-v1',
          frames: [
            { relativePath: 'frame_0001.png', timestampSeconds: 0 },
            { relativePath: 'frame_0002.png', timestampSeconds: 5 },
          ],
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(root, dirName, 'frame_0001.png'), png);
    fs.writeFileSync(path.join(root, dirName, 'frame_0002.png'), png);
    return;
  }
  if (opts.invalidManifest) {
    fs.writeFileSync(
      path.join(root, dirName, 'frames-manifest.json'),
      JSON.stringify({ contractVersion: 'wrong', frames: 'nope' }),
    );
    fs.writeFileSync(path.join(root, dirName, '0s.png'), png);
    return;
  }
  if (opts.ms) {
    fs.writeFileSync(path.join(root, dirName, '1000ms.png'), png);
    fs.writeFileSync(path.join(root, dirName, '5000ms.png'), png);
    return;
  }
  if (opts.hhmmss) {
    fs.writeFileSync(path.join(root, dirName, '00_00_00.png'), png);
    fs.writeFileSync(path.join(root, dirName, '00_00_05.png'), png);
    return;
  }
  if (opts.unknownNames) {
    fs.writeFileSync(path.join(root, dirName, 'slide-a.png'), png);
    fs.writeFileSync(path.join(root, dirName, 'slide-b.png'), png);
    return;
  }
  fs.writeFileSync(path.join(root, dirName, '0s.png'), png);
  fs.writeFileSync(path.join(root, dirName, '5s.png'), png);
}

fs.mkdirSync(root, { recursive: true });

const pairs = [
  ['ds', 'DS'],
  ['edu', 'EDU'],
  ['kadry1', 'KADRY1'],
  ['me1', 'ME1'],
  ['obd1', 'OBD1'],
  ['pit1', 'PIT1'],
  ['place1', 'PLACE1'],
  ['ppk1', 'PPK1'],
  ['proj1', 'PROJ1'],
  ['rap1', 'RAP1'],
  ['rcp1', 'RCP1'],
  ['wcag1', 'WCAG1'],
  ['workflow1', 'WORKFLOW1'],
  ['wstep1', 'WSTEP1'],
  ['zu1', 'ZU1'],
];

for (const [label, dir] of pairs) ensurePair(label, dir);

ensurePair('workflow2', 'WORFLOW2');
ensurePair('missingframes', 'MISSINGFRAMES_SHOULD_NOT_EXIST', { noFrames: true });
const bad = path.join(root, 'MISSINGFRAMES_SHOULD_NOT_EXIST');
if (fs.existsSync(bad)) fs.rmSync(bad, { recursive: true, force: true });

fs.mkdirSync(path.join(root, 'ORPHAN1'), { recursive: true });
fs.writeFileSync(path.join(root, 'ORPHAN1', '0s.png'), png);

ensurePair('kadry01', 'KADRY01');
ensurePair('invalid1', 'INVALID1', { invalid: true });
ensurePair('generic1', 'GENERIC1', { generic: true });
ensurePair('emptyframes1', 'EMPTYFRAMES1', { emptyDir: true });
ensurePair('seq1', 'SEQ1', { sequential: true });
ensurePair('manif1', 'MANIF1', { manifest: true });
ensurePair('nonmono1', 'NONMONO1', { nonMono: true });
ensurePair('ms1', 'MS1', { ms: true });
ensurePair('hms1', 'HMS1', { hhmmss: true });
ensurePair('badmanif1', 'BADMANIF1', { invalidManifest: true });
ensurePair('unk1', 'UNK1', { unknownNames: true });

// Document / asset inventory samples (not whisper transcripts)
fs.writeFileSync(path.join(root, 'sample.pdf'), '%PDF-1.4\n%\xe2\xe3\xcf\xd3\nsample\n');
fs.writeFileSync(
  path.join(root, 'sample.docx'),
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
);
fs.writeFileSync(path.join(root, 'sample.rtf'), '{\\rtf1\\ansi sample}');
fs.writeFileSync(path.join(root, 'sample.txt'), 'plain text sample\n');
fs.writeFileSync(path.join(root, 'sample.html'), '<!DOCTYPE html><html><body>sample</body></html>\n');
fs.writeFileSync(path.join(root, 'sample.jsonl'), '{"a":1}\n{"b":2}\n');
fs.writeFileSync(path.join(root, 'sample.mp4'), Buffer.from('ftypisomsamplemp4', 'ascii'));
fs.writeFileSync(path.join(root, 'sample-generic.json'), JSON.stringify({ note: 'generic document fixture', v: 1 }, null, 2));
fs.writeFileSync(path.join(root, 'unsupported.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]));

// case-insensitive zu2
ensurePair('zu2', 'zu2');

console.log('fixtures written to', root);
