const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '../../test-fixtures/teta-source-extraction/stage3j2b');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function makeDocx(outPath, blocks) {
  const zip = new JSZip();
  const paragraphs = blocks
    .map((b) => {
      if (b.kind === 'heading') {
        return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(b.text)}</w:t></w:r></w:p>`;
      }
      if (b.kind === 'list') {
        return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r><w:t>${escapeXml(b.text)}</w:t></w:r></w:p>`;
      }
      if (b.kind === 'table') {
        const rows = b.rows
          .map(
            (row) =>
              `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t>${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`,
          )
          .join('');
        return `<w:tbl>${rows}</w:tbl>`;
      }
      return `<w:p><w:r><w:t>${escapeXml(b.text)}</w:t></w:r></w:p>`;
    })
    .join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs}<w:sectPr/></w:body>
</w:document>`;
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/document.xml', documentXml);
  if (blocks.some((b) => b.image)) {
    zip.file('word/media/image1.png', png);
    zip.file(
      'word/_rels/document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`,
    );
  }
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Synthetic Fixture</dc:title>
</cp:coreProperties>`,
  );
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function whisperJson(label) {
  return {
    language: 'pl',
    segments: [
      { start: 0, end: 5, text: `Synthetic ${label} segment one`, avg_logprob: -0.2, compression_ratio: 1.1, no_speech_prob: 0.01 },
      { start: 5, end: 12, text: `Synthetic ${label} segment two`, avg_logprob: -0.25, compression_ratio: 1.2, no_speech_prob: 0.02 },
    ],
  };
}

async function main() {
  fs.mkdirSync(root, { recursive: true });

  // Reference A - scenario DOCX
  await makeDocx(path.join(root, 'SCENARIUSZE/ref-a-scenario.docx'), [
    { kind: 'heading', text: 'Scenario prerequisites' },
    { kind: 'paragraph', text: 'Open the application module.' },
    { kind: 'list', text: 'Step 1: login' },
    { kind: 'table', rows: [['Case', 'Expected'], ['A1', 'Pass']] },
    { kind: 'paragraph', text: 'See screenshot evidence.', image: true },
  ]);

  // Reference B - EDU
  await makeDocx(path.join(root, 'EDU/ref-b-edu-variant.docx'), [
    { kind: 'heading', text: 'EDU process branch A' },
    { kind: 'paragraph', text: 'University specific flow without HR inheritance.' },
    { kind: 'paragraph', text: 'Branch B continues here.' },
  ]);

  // Reference C - legacy doc placeholder + converted docx target
  const legacyDir = path.join(root, 'reference-c/doc');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'legacy-sample.doc'), Buffer.from('legacy-doc-placeholder'));
  await makeDocx(path.join(legacyDir, 'input.docx'), [
    { kind: 'paragraph', text: 'Converted legacy document body preserved.' },
  ]);

  // Reference D
  await makeDocx(path.join(root, 'PRZELOM ROKU/ref-d-year-transition.docx'), [
    { kind: 'heading', text: 'Year transition checklist' },
    { kind: 'paragraph', text: 'Cross-domain operational steps.' },
  ]);

  // Reference E
  await makeDocx(path.join(root, 'FINANSE/KSEF/ref-e-ksef.docx'), [
    { kind: 'paragraph', text: 'KSeF e-invoice configuration overview.' },
  ]);

  // Reference G duplicate paragraph
  const dupText = 'Identical canonical paragraph for exact dedup test.';
  await makeDocx(path.join(root, 'PROCESY/ref-g-one.docx'), [{ kind: 'paragraph', text: dupText }]);
  await makeDocx(path.join(root, 'WORKFLOW/ref-g-two.docx'), [{ kind: 'paragraph', text: dupText }]);

  // Scanned-like PDF
  fs.mkdirSync(path.join(root, 'SCANNED'), { recursive: true });
  fs.writeFileSync(path.join(root, 'SCANNED/ref-f-empty.pdf'), Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'));

  // Valid minimal PDF with text - hard to generate; use pdf with text layer stub via fixture that pdf-parse may reject - we'll use a real tiny approach
  // For tests, scanned PDF invalid path triggers invalidPdf

  // ALL_MOVIES zu1
  const movies = path.join(root, 'ALL_MOVIES');
  fs.mkdirSync(path.join(movies, 'ZU1'), { recursive: true });
  fs.writeFileSync(path.join(movies, 'zu1.json'), JSON.stringify(whisperJson('zu1'), null, 2));
  for (const idx of [1, 2, 3]) {
    fs.writeFileSync(path.join(movies, 'ZU1', `frame_${String(idx).padStart(5, '0')}.jpg`), png);
  }
  fs.writeFileSync(path.join(movies, 'zu1.mp4'), Buffer.from('ftypisomsamplemp4'));

  // JSON outside ALL_MOVIES - should be ignored
  fs.mkdirSync(path.join(root, 'KADRY'), { recursive: true });
  fs.writeFileSync(path.join(root, 'KADRY/ignored-transcript.json'), JSON.stringify({ foo: 1 }));

  // Ignored extensions
  fs.mkdirSync(path.join(root, 'ignored'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ignored/sample.xlsx'), Buffer.from('xlsx'));
  fs.writeFileSync(path.join(root, 'ignored/sample.txt'), 'text');
  fs.writeFileSync(path.join(root, 'ignored/~$temp.docx'), 'temp');
  fs.writeFileSync(path.join(root, 'KADRY/valid-kadry.docx'), Buffer.from(''));
  await makeDocx(path.join(root, 'KADRY/valid-kadry.docx'), [{ kind: 'paragraph', text: 'Kadry payroll document sample.' }]);

  // TETA ME folder sample
  await makeDocx(path.join(root, 'TETA ME/me-surface.docx'), [{ kind: 'paragraph', text: 'Teta ME surface documentation.' }]);

  console.log('Stage 3J.2B fixtures written to', root);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
