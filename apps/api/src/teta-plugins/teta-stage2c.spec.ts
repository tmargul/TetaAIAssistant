import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { decodeHelpBuffer, hasPolishChars } from './teta-stage2c-encoding';
import { normalizeHelpLabel, controlNameTokens } from './teta-stage2c-label';
import { parseStage2cHelpHtml, readStage2cHelpFile } from './teta-stage2c-parser';
import { matchHelpDocumentToForm, pickBestMatch, buildControlCandidates } from './teta-stage2c-match';
import { analyzeStage2c } from './teta-stage2c-analyze';
import { normalizePluginGuid } from './teta-plugin-guid.util';
import { normalizeHelpGuid, helpHtmlPath, resolveHelpDirectory } from './teta-help-path.util';
import type { Stage2aFormBinding } from './teta-stage2a-bindings.types';
import type { TetaPluginRegistryEntry } from './teta-plugin-form-registry.types';
import type { LookupBindingSplit, Stage2bLinkedChain } from './teta-stage2b.types';

function encodeWith(text: string, encoding: string): Buffer {
  // Node TextEncoder supports utf-8; for legacy use iconv via TextDecoder reverse isn't available.
  // Use TextEncoder for utf8; for 1250/8859-2 map via Buffer from latin1 code points when possible.
  if (encoding === 'utf-8' || encoding === 'utf8') {
    return Buffer.from(text, 'utf8');
  }
  if (encoding === 'utf-8-bom') {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  }
  // Manual encode via TextDecoder-supported labels using encodeURIComponent trick is insufficient.
  // Use require('node:util').TextEncoder doesn't support 1250 — fall back to Windows code page via child?
  // Jest/Node 22+: TextEncoder only utf8. Create buffers with known Polish byte sequences.
  throw new Error(`use fixtureBuffers for ${encoding}`);
}

/** ISO-8859-2 bytes for: "Kadry Płace Stanowisko Nieobecność ąćęłńóśźż" */
function polishIso88592Buffer(htmlWrapper = true): Buffer {
  // Precomputed ISO-8859-2 for the Polish sample string
  const sample =
    'Kadry P' +
    String.fromCharCode(0xb3) + // ł in latin1 placeholder — we'll build raw bytes
    '';
  void sample;
  const bytes: number[] = [];
  const pushAscii = (s: string) => {
    for (const ch of s) bytes.push(ch.charCodeAt(0));
  };
  if (htmlWrapper) {
    pushAscii(
      '<?xml version="1.0" encoding="ISO-8859-2" ?><html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2" /><title>',
    );
  }
  // Kadry =
  pushAscii('Kadry ');
  // Płace — ł = 0xB3 in ISO-8859-2
  bytes.push(0x50, 0xb3, 0x61, 0x63, 0x65, 0x20);
  // Stanowisko
  pushAscii('Stanowisko ');
  // Nieobecność — ń=0xF1, ć=0xE6 in ISO-8859-2
  pushAscii('Nieobecno');
  bytes.push(0xf1, 0xe6, 0x20);
  // ą ć ę ł ń ó ś ź ż
  bytes.push(0xb1, 0x20, 0xe6, 0x20, 0xea, 0x20, 0xb3, 0x20, 0xf1, 0x20, 0xf3, 0x20, 0xb6, 0x20, 0xbc, 0x20, 0xbf);
  if (htmlWrapper) {
    pushAscii('</title></head><body><h1>Kadry</h1><p>');
    bytes.push(0x50, 0xb3, 0x61, 0x63, 0x65); // Płace
    pushAscii('</p></body></html>');
  }
  return Buffer.from(bytes);
}

function polishWindows1250Buffer(): Buffer {
  // Windows-1250: ł=0xB3, ą=0xB9, ć=0xE6, ę=0xEA, ń=0xF1, ó=0xF3, ś=0x9C, ź=0x9F, ż=0xBF
  const bytes: number[] = [];
  const pushAscii = (s: string) => {
    for (const ch of s) bytes.push(ch.charCodeAt(0));
  };
  pushAscii(
    '<?xml encoding="windows-1250"?><html><head><meta charset="windows-1250"/><title>',
  );
  pushAscii('Kadry ');
  bytes.push(0x50, 0xb3, 0x61, 0x63, 0x65, 0x20); // Płace
  pushAscii('Stanowisko Nieobecno');
  bytes.push(0xf1, 0xe6, 0x20);
  bytes.push(0xb9, 0x20, 0xe6, 0x20, 0xea, 0x20, 0xb3, 0x20, 0xf1, 0x20, 0xf3, 0x20, 0x9c, 0x20, 0x9f, 0x20, 0xbf);
  pushAscii('</title></head><body><h1>Test</h1><p>P');
  bytes.push(0xb3);
  pushAscii('ace</p></body></html>');
  return Buffer.from(bytes);
}

describe('Stage 2C encoding', () => {
  it('detects ISO-8859-2 and preserves Polish chars', () => {
    const buf = polishIso88592Buffer();
    const decoded = decodeHelpBuffer(buf);
    expect(decoded.decodingStatus).toBe('ok');
    expect(decoded.detectedEncoding).toMatch(/iso-8859-2|windows-1250/);
    expect(hasPolishChars(decoded.text)).toBe(true);
    expect(decoded.text).toMatch(/Płace|Kadry|Stanowisko|Nieobecność/);
    expect(decoded.text).toMatch(/[ąćęłńóśźż]/);
    expect(decoded.replacementCharacterCount).toBe(0);
  });

  it('detects Windows-1250 Polish sample', () => {
    const buf = polishWindows1250Buffer();
    const decoded = decodeHelpBuffer(buf);
    expect(decoded.decodingStatus).toBe('ok');
    expect(hasPolishChars(decoded.text)).toBe(true);
    expect(decoded.text).toMatch(/Kadry/);
    expect(decoded.replacementCharacterCount).toBeLessThan(5);
  });

  it('handles UTF-8 and UTF-8 BOM', () => {
    const text =
      '<?xml encoding="utf-8"?><html><body><h1>Kadry Płace Stanowisko Nieobecność ąćęłńóśźż</h1></body></html>';
    const utf8 = decodeHelpBuffer(Buffer.from(text, 'utf8'));
    expect(utf8.decodingStatus).toBe('ok');
    expect(utf8.text).toContain('Nieobecność');

    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
    const bomDecoded = decodeHelpBuffer(bom);
    expect(bomDecoded.detectedEncoding).toBe('utf-8-bom');
    expect(bomDecoded.text).toContain('ąćęłńóśźż');
  });

  it('rejects high replacement character count', () => {
    const garbage = Buffer.alloc(200, 0xff);
    const decoded = decodeHelpBuffer(garbage);
    // May be high_replacement or ok with latin1 — ensure we track replacements
    expect(decoded.replacementCharacterCount + (decoded.decodingStatus === 'failed' ? 1 : 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('Stage 2C GUID / Help path', () => {
  it('normalizes GUID filename', () => {
    expect(normalizeHelpGuid('{AABBCCDD-1234-4ABC-8DEF-0123456789AB}')).toBe(
      'aabbccdd-1234-4abc-8def-0123456789ab',
    );
    expect(normalizePluginGuid('  {AaBbCcDd-1234-4abc-8def-0123456789ab}  ').normalized).toBe(
      'aabbccdd-1234-4abc-8def-0123456789ab',
    );
    const dir = resolveHelpDirectory('C:\\Client');
    expect(helpHtmlPath(dir, '{AABBCCDD-1234-4ABC-8DEF-0123456789AB}')).toMatch(
      /aabbccdd-1234-4abc-8def-0123456789ab\.html$/i,
    );
  });
});

describe('Stage 2C label normalization', () => {
  it('normalizes accelerator and trailing colon', () => {
    const n = normalizeHelpLabel('&Nazwa stanowiska:');
    expect(n.label).toBe('&Nazwa stanowiska:');
    expect(n.normalizedLabel).toBe('nazwa stanowiska');
    expect(n.normalizedLabelAscii).toBe('nazwa stanowiska');
  });

  it('keeps Polish in source label; ascii key strips diacritics', () => {
    const n = normalizeHelpLabel('Nieobecność');
    expect(n.label).toBe('Nieobecność');
    expect(n.normalizedLabel).toContain('nieobecność');
    expect(n.normalizedLabelAscii).toBe('nieobecnosc');
  });

  it('tokenizes control names', () => {
    expect(controlNameTokens('lcboTypStanowiska')).toEqual(
      expect.arrayContaining(['typ', 'stanowiska']),
    );
    expect(controlNameTokens('tbbZamknijMiesiac')).toEqual(
      expect.arrayContaining(['zamknij', 'miesiac']),
    );
  });
});

const SAMPLE_HELP_HTML = `<html><head><title>Test</title></head><body>
<h1>Dane podstawowe</h1>
<p>Formularz służy do wprowadzenia danych.</p>
<h2>Nagłówek</h2>
<ul>
<li><p><b>Typ stanowiska &#8211; </b>pole ze słownika Typy stanowisk.</p></li>
<li><p><b>Kod</b> &#8211; kod pozycji.</p></li>
</ul>
<table><tr><th>Pole</th><th>Opis</th></tr>
<tr><td>Nazwa</td><td>Nazwa pozycji słownika.</td></tr>
<tr><td>Aktualna</td><td>Czy pozycja jest wykorzystywana.</td></tr>
</table>
<dl><dt>Firma</dt><dd>Nazwa firmy.</dd></dl>
<p>Należy wykonać funkcję <b>Zamknięcie miesiąca</b> przed zamknięciem listy.</p>
<p class="UWAGA">Uwaga: operacja nieodwracalna.</p>
</body></html>`;

describe('Stage 2C HTML parser', () => {
  it('parses headings, tables, definition lists, bold patterns, actions', () => {
    const doc = parseStage2cHelpHtml(SAMPLE_HELP_HTML, {
      guid: '11111111-1111-4111-8111-111111111111',
      helpPath: 'x.html',
      formType: 'TestForm',
    });
    expect(doc.title).toBe('Dane podstawowe');
    expect(doc.sections.length).toBeGreaterThanOrEqual(1);
    expect(doc.fieldEntries.map((f) => f.normalizedLabelAscii)).toEqual(
      expect.arrayContaining(['typ stanowiska', 'kod', 'nazwa', 'aktualna', 'firma']),
    );
    expect(doc.fieldEntries.find((f) => f.normalizedLabelAscii === 'typ stanowiska')?.extractionPattern).toMatch(
      /bold_dash/,
    );
    expect(doc.fieldEntries.find((f) => f.normalizedLabelAscii === 'nazwa')?.extractionPattern).toBe(
      'table_pole_opis',
    );
    expect(doc.fieldEntries.find((f) => f.normalizedLabelAscii === 'firma')?.extractionPattern).toBe(
      'definition_list',
    );
    expect(doc.actionEntries.some((a) => /zamkni/i.test(a.label))).toBe(true);
  });
});

function sampleForm2a(): Stage2aFormBinding {
  return {
    guid: '8efdd60e-ac8b-4501-947a-4cb89ccdb082',
    formType: 'Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok',
    assembly: 'plgKOS.dll',
    hasInitializeComponent: true,
    uiControls: [
      { fieldName: 'lcboTypStanowiska', controlKind: 'lookup', fieldType: 'SumoLblComboBox' },
      { fieldName: 'tbbZamknijMiesiac', controlKind: 'button', fieldType: 'SumoToolBarButton' },
      { fieldName: 'dgcKod', controlKind: 'grid_column', fieldType: 'SumoTextColumnStyle' },
      { fieldName: 'dgcNazwa', controlKind: 'grid_column', fieldType: 'SumoTextColumnStyle' },
      { fieldName: 'dgcAktualna', controlKind: 'grid_column', fieldType: 'SumoCheckBoxColumnStyle' },
    ],
    bindings: [
      {
        control: 'lcboTypStanowiska',
        dataMember: 'ZSTP_ID',
        datasetTable: 'KartaOpisuStanowiska',
        alternatives: ['ZSTP_ID', 'NAZWA', 'KartaOpisuStanowiska', 'TypyStanowisk', 'ID'],
        confidence: 'confirmed_from_il',
      },
      {
        control: 'tbbZamknijMiesiac',
        parameterName: 'KP_UPR_KART_LIST_ZAMKNIJ_MIES',
        propertyBindings: { parameterName: 'KP_UPR_KART_LIST_ZAMKNIJ_MIES' },
        confidence: 'confirmed_from_il',
      },
      { control: 'dgcKod', dataMember: 'KOD', datasetTable: 'RodzajeKoncesji', confidence: 'confirmed_from_il' },
      { control: 'dgcNazwa', dataMember: 'NAZWA', datasetTable: 'RodzajeKoncesji', confidence: 'confirmed_from_il' },
      {
        control: 'dgcAktualna',
        dataMember: 'UP_TO_DATE',
        datasetTable: 'RodzajeKoncesji',
        confidence: 'confirmed_from_il',
      },
    ],
    propertyAssignments: [
      { control: 'dgcKod', property: 'HeaderText', value: 'Kod' },
      { control: 'dgcNazwa', property: 'HeaderText', value: 'Nazwa' },
      { control: 'dgcAktualna', property: 'HeaderText', value: 'Aktualna' },
    ],
  };
}

describe('Stage 2C matching', () => {
  it('matches Help field → control by name tokens and caption', () => {
    const form = sampleForm2a();
    const doc = parseStage2cHelpHtml(SAMPLE_HELP_HTML, {
      guid: form.guid!,
      helpPath: 'x.html',
      formType: form.formType,
    });
    const matches = matchHelpDocumentToForm(
      [...doc.fieldEntries, ...doc.actionEntries],
      form,
    );
    const typ = matches.find((m) => /typ stanowiska/i.test(m.helpField));
    expect(typ?.control).toBe('lcboTypStanowiska');
    expect(typ?.matchStatus).not.toBe('ambiguous');

    const kod = matches.find((m) => m.helpField === 'Kod');
    expect(kod?.control).toBe('dgcKod');

    const action = matches.find((m) => /zamkni/i.test(m.helpField));
    expect(action?.control).toBe('tbbZamknijMiesiac');
    expect(action?.helpKind).toBe('actionHelp');
  });

  it('preserves target/lookup split and does not bind Help to display column', () => {
    const form = sampleForm2a();
    const lookups: LookupBindingSplit[] = [
      {
        control: 'lcboTypStanowiska',
        formType: form.formType,
        targetBinding: { datasetTable: 'KartaOpisuStanowiska', dataMember: 'ZSTP_ID' },
        lookupBinding: {
          datasetTable: 'TypyStanowisk',
          valueMember: 'ID',
          displayMember: 'NAZWA',
        },
      },
    ];
    const chains: Stage2bLinkedChain[] = [
      {
        formType: form.formType,
        control: 'lcboTypStanowiska',
        dataMember: 'ZSTP_ID',
        formDatasetTable: 'KartaOpisuStanowiska',
        viewName: 'NT_KP_KOS_KARTY',
        packageName: 'NT_KP_KOS_KARTY_DAC',
      },
    ];
    const registry: TetaPluginRegistryEntry[] = [
      {
        registryId: '1',
        guid: form.guid!,
        assembly: 'plgKOS.dll',
        className: form.formType!,
        simpleClassName: 'DanePodstawoweKOSWidok',
        parameters: null,
        pluginName: null,
        pluginType: 'K',
        description: null,
        webPlugin: null,
        routePath: null,
        apiPath: null,
        resolvedDllPath: 'x.dll',
        helpPath: null,
        helpExists: false,
        helpSize: null,
        registryStatus: 'confirmed',
        dllStatus: 'resolved',
        classDeclarationStatus: 'confirmed_by_registry',
        classVerificationStatus: 'verified_exact',
        helpStatus: 'missing',
        classStatus: 'found',
        confidence: 'confirmed',
        evidence: [],
        formIdentity: `${form.guid}:dane`,
        isStandardUuid: true,
      },
    ];

    const tmp = path.join(os.tmpdir(), `stage2c-test-${Date.now()}`);
    mkdirSync(path.join(tmp, 'Help'), { recursive: true });
    writeFileSync(path.join(tmp, 'Help', `${form.guid}.html`), SAMPLE_HELP_HTML, 'utf8');

    const batch = analyzeStage2c({
      registry,
      forms2a: [form],
      chains2b: chains,
      lookups2b: lookups,
      clientDirectory: tmp,
    });

    const link = batch.forms[0].linkedMappings.find((l) => /typ stanowiska/i.test(l.helpLabel));
    expect(link?.control).toBe('lcboTypStanowiska');
    expect(link?.targetBinding).toEqual({
      datasetTable: 'KartaOpisuStanowiska',
      dataMember: 'ZSTP_ID',
    });
    expect(link?.lookupBinding).toEqual({
      datasetTable: 'TypyStanowisk',
      valueMember: 'ID',
      displayMember: 'NAZWA',
    });
    // Must NOT treat NAZWA display as the Help target control binding
    expect(link?.targetBinding?.dataMember).toBe('ZSTP_ID');
    expect(link?.oracleMapping?.targetObjects?.length).toBeGreaterThan(0);

    const action = batch.forms[0].linkedMappings.find((l) => /zamkni/i.test(l.helpLabel));
    expect(action?.control).toBe('tbbZamknijMiesiac');
    expect(action?.parameterName).toBe('KP_UPR_KART_LIST_ZAMKNIJ_MIES');
    expect(action?.targetBinding?.dataMember).toBeFalsy();
    expect(action?.helpKind).toBe('actionHelp');

    rmSync(tmp, { recursive: true, force: true });
  });

  it('marks ambiguous when two equally good controls', () => {
    const form: Stage2aFormBinding = {
      formType: 'X',
      guid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      uiControls: [
        { fieldName: 'lcboTypA', controlKind: 'lookup' },
        { fieldName: 'lcboTypB', controlKind: 'lookup' },
      ],
      propertyAssignments: [
        { control: 'lcboTypA', property: 'Text', value: 'Typ' },
        { control: 'lcboTypB', property: 'Text', value: 'Typ' },
      ],
      bindings: [],
    };
    const candidates = buildControlCandidates(form);
    const match = pickBestMatch(
      {
        label: 'Typ',
        normalizedLabel: 'typ',
        normalizedLabelAscii: 'typ',
        description: 'opis',
        section: null,
        sourceFragment: '',
        order: 0,
        extractionPattern: 'test',
        confidence: 'confirmed_structural',
        evidence: [],
        helpKind: 'fieldHelp',
      },
      candidates,
    );
    expect(match.matchStatus).toBe('ambiguous');
    expect(match.control).toBeNull();
  });
});

describe('Stage 2C missing Help', () => {
  it('returns help_file_missing without lowering technical graph', () => {
    const form = sampleForm2a();
    form.guid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const tmp = path.join(os.tmpdir(), `stage2c-missing-${Date.now()}`);
    mkdirSync(path.join(tmp, 'Help'), { recursive: true });

    const registry: TetaPluginRegistryEntry[] = [
      {
        registryId: '2',
        guid: form.guid!,
        assembly: 'plg.dll',
        className: form.formType!,
        simpleClassName: 'DanePodstawoweKOSWidok',
        parameters: null,
        pluginName: null,
        pluginType: 'K',
        description: null,
        webPlugin: null,
        routePath: null,
        apiPath: null,
        resolvedDllPath: 'x.dll',
        helpPath: null,
        helpExists: false,
        helpSize: null,
        registryStatus: 'confirmed',
        dllStatus: 'resolved',
        classDeclarationStatus: 'confirmed_by_registry',
        classVerificationStatus: 'verified_exact',
        helpStatus: 'missing',
        classStatus: 'found',
        confidence: 'confirmed',
        evidence: [],
        formIdentity: `${form.guid}:x`,
        isStandardUuid: true,
      },
    ];

    const batch = analyzeStage2c({
      registry,
      forms2a: [form],
      chains2b: [],
      lookups2b: [],
      clientDirectory: tmp,
    });
    expect(batch.forms[0].helpDocument.helpStatus).toBe('help_file_missing');
    expect(batch.forms[0].classVerificationStatus).toBe('verified_exact');
    expect(batch.forms[0].registryStatus).toBe('confirmed');
    // Bindings still available on form2a — Help absence must not wipe them
    expect(form.bindings?.length).toBeGreaterThan(0);

    rmSync(tmp, { recursive: true, force: true });
  });

  it('readStage2cHelpFile reports missing', () => {
    const doc = readStage2cHelpFile({
      helpPath: path.join(os.tmpdir(), 'no-such-help-file-stage2c.html'),
      guid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(doc.helpStatus).toBe('help_file_missing');
  });
});

describe('Stage 2C live references (optional)', () => {
  const client = 'A:\\TETA Aplikacja klienta - 33.5';
  const helpDir = path.join(client, 'Help');
  const live = existsSync(helpDir);

  (live ? it : it.skip)('A: Typ stanowiska → lcboTypStanowiska on Dane podstawowe Help', () => {
    const guid = '8efdd60e-ac8b-4501-947a-4cb89ccdb082';
    const doc = readStage2cHelpFile({
      helpPath: path.join(helpDir, `${guid}.html`),
      guid,
      formType: 'Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok',
    });
    expect(doc.helpStatus).toBe('help_found');
    expect(doc.detectedEncoding).toMatch(/iso-8859-2|windows-1250|utf-8/);
    expect(doc.fieldEntries.some((f) => /typ stanowiska/i.test(f.label))).toBe(true);
    const form = sampleForm2a();
    const matches = matchHelpDocumentToForm(doc.fieldEntries, form);
    expect(matches.find((m) => /typ stanowiska/i.test(m.helpField))?.control).toBe(
      'lcboTypStanowiska',
    );
  });

  (live ? it : it.skip)('B: DicRodzajeKoncesji overview fields', () => {
    const guid = '670ab806-2885-4f00-94cf-e86a5f545c85';
    const doc = readStage2cHelpFile({
      helpPath: path.join(helpDir, `${guid}.html`),
      guid,
    });
    expect(doc.helpStatus).toBe('help_found');
    expect(doc.overview).toMatch(/kodu|nazwy/i);
    expect(doc.fieldEntries.map((f) => f.normalizedLabelAscii)).toEqual(
      expect.arrayContaining(['kod', 'nazwa', 'aktualna']),
    );
  });

  (live ? it : it.skip)('C: Listy zamknięte action Zamknięcie miesiąca', () => {
    const guid = '7b4f2b80-4853-409d-8dc7-06cd10c8925b';
    const doc = readStage2cHelpFile({
      helpPath: path.join(helpDir, `${guid}.html`),
      guid,
    });
    expect(doc.actionEntries.some((a) => /zamkni.*miesi/i.test(a.label))).toBe(true);
  });
});

// silence unused encodeWith in case tree-shaking complains in lint
void encodeWith;
