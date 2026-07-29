#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { writeFileSync, mkdirSync } = require('fs');
const path = require('path');
const { createHash } = require('crypto');

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}
function stable(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
function cu(id, kind, order, text, extra = {}) {
  return {
    contentUnitId: id,
    unitKind: kind,
    order,
    headingPath: extra.headingPath ?? [],
    text,
    normalizedTextSha256: sha256(text.toLowerCase()),
    location: {
      pageNumber: extra.pageNumber ?? null,
      paragraphIndex: extra.paragraphIndex ?? order,
      tableIndex: extra.tableIndex ?? null,
      rowIndex: extra.rowIndex ?? null,
      segmentIndex: extra.segmentIndex ?? null,
      startSeconds: extra.startSeconds ?? null,
      endSeconds: extra.endSeconds ?? null,
    },
    assetRefs: extra.assetRefs ?? [],
    sourceOccurrenceId: sha256(`occ|${id}`).slice(0, 32),
    classificationStatus: 'unclassified',
    frameRefs: extra.frameRefs,
  };
}

function source(partial) {
  const contentUnits = partial.contentUnits ?? [];
  const rev = sha256(stable({ id: partial.logicalSourceId, units: contentUnits.map((u) => u.normalizedTextSha256) }));
  return {
    contractVersion: 'teta-canonical-source-v1',
    logicalSourceId: partial.logicalSourceId,
    sourceRevisionId: `sha256:${rev}`,
    sourceType: partial.sourceType ?? 'document',
    format: partial.format ?? 'docx',
    sourceLabel: partial.sourceLabel ?? partial.logicalSourceId,
    originalRelativePath: partial.originalRelativePath,
    normalizedRelativePath: partial.normalizedRelativePath ?? partial.originalRelativePath,
    relativeDirectorySegments: partial.relativeDirectorySegments ?? [],
    fileName: partial.fileName ?? 'fixture.docx',
    extension: partial.extension ?? '.docx',
    folderHints: partial.folderHints ?? [],
    platformId: 'teta_platform',
    productFamilyHints: partial.productFamilyHints ?? [],
    productSurfaceHints: partial.productSurfaceHints ?? [],
    domainHints: partial.domainHints ?? [],
    businessAreaHints: partial.businessAreaHints ?? [],
    knowledgeAreaHints: partial.knowledgeAreaHints ?? [],
    scopeClassificationStatus: 'requires_review',
    sectionLevelClassificationRequired: partial.sectionLevelClassificationRequired ?? false,
    applicabilityReviewRequired: true,
    contentUnits,
    assets: partial.assets ?? [],
    warnings: partial.warnings ?? [],
    extractionStatus: partial.extractionStatus ?? 'succeeded',
    blockReason: partial.blockReason ?? null,
    metadataOnly: partial.metadataOnly ?? false,
    requiresReview: partial.requiresReview ?? false,
    sourcePurposeHints: partial.sourcePurposeHints ?? [],
    productVersionHints: partial.productVersionHints ?? [],
    documentDateHints: partial.documentDateHints ?? [],
    sourcePolicy: {
      rawSourceRetention: 'vendor_only',
      portableExtractedContent: true,
      clientDistributionStatus: 'candidate_not_selected',
    },
    provenance: {
      inventorySourceRevisionId: null,
      extractorVersion: 'stage3j2b-v1',
      registryVersions: ['teta-source-selection-policy-v1'],
      conversion: null,
    },
  };
}

const sources = [
  source({
    logicalSourceId: 'document:fixture-a-payroll',
    originalRelativePath: 'SCENARIUSZE/fixture-a-payroll.docx',
    relativeDirectorySegments: ['SCENARIUSZE'],
    sourcePurposeHints: ['scenario_or_test_case'],
    domainHints: ['payroll'],
    contentUnits: [
      cu('a-h1', 'heading', 1, 'Scenariusz: składnik okresowy', { headingPath: ['Scenariusz: składnik okresowy'] }),
      cu('a-def', 'paragraph', 2, 'Składnik okresowy oznacza składnik naliczany w zadanym okresie rozliczeniowym'),
      cu('a-pre', 'paragraph', 3, 'Warunki wstępne: składnik 00123 aktywny'),
      cu('a-cfg', 'paragraph', 4, 'Konfiguracja parametru LIMIT_GODZ'),
      cu('a-proc', 'heading', 5, 'Procedura', { headingPath: ['Scenariusz: składnik okresowy', 'Procedura'] }),
      cu('a-step1', 'list_item', 6, '1. Otwórz formularz składników'),
      cu('a-step2', 'list_item', 7, '2. Ustaw wartość 160'),
      cu('a-step3', 'list_item', 8, '3. Zatwierdź konfigurację'),
      cu('a-out', 'paragraph', 9, 'Oczekiwany wynik: naliczenie SKL_OKRES'),
      cu('a-form', 'paragraph', 10, 'Formuła: SKL_OKRES = SUM(A, B)'),
      cu('a-temp', 'paragraph', 11, 'Obowiązuje od 2025-01-01 do końca miesiąca'),
      cu('a-test', 'paragraph', 12, 'Przypadek testowy: dane wejściowe LIMIT_GODZ=160; kroki jak w procedurze; oczekiwany wynik SKL_OKRES'),
      cu('a-fix', 'paragraph', 13, 'Korekta: zmień kod 00123 na 00124'),
    ],
  }),
  source({
    logicalSourceId: 'document:fixture-b-edu',
    originalRelativePath: 'EDU/fixture-b-edu.docx',
    relativeDirectorySegments: ['EDU'],
    productFamilyHints: ['teta_edu'],
    contentUnits: [
      cu('b-h', 'heading', 1, 'Proces przyjęcia pracownika Edu', { headingPath: ['Proces przyjęcia pracownika Edu'] }),
      cu('b-in', 'paragraph', 2, 'Wejście: kandydat z kompletem dokumentów; warunek: status rekrutacji Otwarty'),
      cu('b-s1', 'list_item', 3, '1. Utwórz kartotekę kandydata'),
      cu('b-s2', 'list_item', 4, '2. Status: Oczekujący'),
      cu('b-s3', 'paragraph', 5, 'Po zatwierdzeniu status zmienia się na Zatrudniony'),
      cu('b-out', 'paragraph', 6, 'Wynik procesu: pracownik aktywny w Teta Edu'),
    ],
  }),
  source({
    logicalSourceId: 'document:fixture-c-year',
    originalRelativePath: 'PRZELOM ROKU/fixture-c-year.docx',
    relativeDirectorySegments: ['PRZELOM ROKU'],
    sectionLevelClassificationRequired: true,
    domainHints: ['payroll', 'hr'],
    contentUnits: [
      cu('c-h', 'heading', 1, 'Procedura przełomu roku', { headingPath: ['Procedura przełomu roku'] }),
      cu('c-s1', 'list_item', 2, '1. Zamknij okres rozliczeniowy'),
      cu('c-s2', 'list_item', 3, '2. Przekaż nadgodziny na listę płac'),
      cu('c-t', 'paragraph', 4, 'Przekazanie nadgodzin na listę płac wymaga RCP i płac'),
      cu('c-d', 'paragraph', 5, 'Obowiązuje od 2025-01-01'),
      cu('c-v', 'paragraph', 6, 'Nie można otworzyć nowego roku przed zamknięciem poprzedniego okresu'),
    ],
  }),
  source({
    logicalSourceId: 'document:fixture-d-ksef',
    originalRelativePath: 'FINANSE/KSEF/fixture-d-ksef.docx',
    relativeDirectorySegments: ['FINANSE', 'KSEF'],
    domainHints: ['invoicing', 'accounting'],
    contentUnits: [
      cu('d-h', 'heading', 1, 'Integracja KSeF', { headingPath: ['Integracja KSeF'] }),
      cu('d-doc', 'paragraph', 2, 'Dokument faktury KSeF wymaga weryfikacji aktualności przepisów'),
      cu('d-i', 'paragraph', 3, 'Integracja z systemem e-faktur'),
      cu('d-p', 'heading', 4, 'Procedura', { headingPath: ['Integracja KSeF', 'Procedura'] }),
      cu('d-s1', 'list_item', 5, '1. Wygeneruj plik e-faktury'),
      cu('d-s2', 'list_item', 6, '2. Zarejestruj wysyłkę do KSeF'),
      cu('d-w', 'paragraph', 7, 'Uwaga: wartość nie może przekraczać limitu ustawowego bez weryfikacji'),
    ],
  }),
  source({
    logicalSourceId: 'training-video:ALL_MOVIES:fixture-e-zu',
    sourceType: 'video_training',
    format: 'whisper_segments_json',
    originalRelativePath: 'ALL_MOVIES/fixture-e-zu.json',
    relativeDirectorySegments: ['ALL_MOVIES'],
    knowledgeAreaHints: ['developer_training'],
    contentUnits: [
      cu('e-s1', 'transcript_segment', 1, 'DatasetPlugin jest obiektem biznesowym w warstwie danych', { segmentIndex: 0, startSeconds: 0, endSeconds: 55 }),
      cu('e-s2', 'transcript_segment', 2, 'Formularz korzysta z obiektu DatasetPlugin; pole jest mapowane na kolumnę datasetu', { segmentIndex: 1, startSeconds: 56, endSeconds: 110, frameRefs: { precedingFrameRef: { assetId: 'sha256:frame1', relativePortablePath: 'assets/sha256/ab/ab.jpg', timestampSeconds: 1, frameIndex: 1 }, nearestFrameRef: null, followingFrameRef: null } }),
      cu('e-s3', 'transcript_segment', 3, 'Procedura: 1. Otwórz edytor wtyczek 2. Dodaj DatasetPlugin 3. Zatwierdź publikację', { segmentIndex: 2, startSeconds: 111, endSeconds: 170 }),
    ],
    assets: [{ assetId: 'sha256:frame1', relativePortablePath: 'assets/sha256/ab/ab.jpg', mimeType: 'image/jpeg', sourceOccurrences: [] }],
  }),
  source({
    logicalSourceId: 'training-video:ALL_MOVIES:fixture-f-noise',
    sourceType: 'video_training',
    format: 'whisper_segments_json',
    originalRelativePath: 'ALL_MOVIES/fixture-f-noise.json',
    relativeDirectorySegments: ['ALL_MOVIES'],
    contentUnits: [
      cu('f-s1', 'transcript_segment', 1, 'Czy widać ekran?', { segmentIndex: 0, startSeconds: 0, endSeconds: 5 }),
      cu('f-s2', 'transcript_segment', 2, 'Sprawdźcie mikrofon, czy mnie słychać', { segmentIndex: 1, startSeconds: 6, endSeconds: 12 }),
      cu('f-s3', 'transcript_segment', 3, 'Robimy przerwę na kawę', { segmentIndex: 2, startSeconds: 13, endSeconds: 25 }),
      cu('f-s4', 'transcript_segment', 4, 'Dziękuję za obecność, zaraz wracamy', { segmentIndex: 3, startSeconds: 26, endSeconds: 35 }),
      cu('f-s5', 'transcript_segment', 5, 'Wracamy do konfiguracji list płac', { segmentIndex: 4, startSeconds: 36, endSeconds: 90 }),
      cu('f-s6', 'transcript_segment', 6, 'Na ekranie formularza ustaw parametr LIMIT_GODZ', { segmentIndex: 5, startSeconds: 91, endSeconds: 140 }),
      cu('f-s7', 'transcript_segment', 7, 'Przerwa w rozumieniu RCP to okres nieobecności', { segmentIndex: 6, startSeconds: 141, endSeconds: 190 }),
    ],
  }),
  source({
    logicalSourceId: 'document:fixture-g-dup',
    originalRelativePath: 'SCENARIUSZE/fixture-g-dup.docx',
    relativeDirectorySegments: ['SCENARIUSZE'],
    sourcePurposeHints: ['scenario_or_test_case'],
    contentUnits: [
      cu('g-h', 'heading', 1, 'Duplikat', { headingPath: ['Duplikat'] }),
      cu('g-p1', 'paragraph', 2, 'Warunki wstępne: aktywny składnik'),
      cu('g-p2', 'paragraph', 3, 'Warunki wstępne: aktywny składnik'),
    ],
  }),
  source({
    logicalSourceId: 'document:fixture-h-samesig',
    originalRelativePath: 'SCENARIUSZE/fixture-h-samesig.docx',
    relativeDirectorySegments: ['SCENARIUSZE'],
    sourcePurposeHints: ['scenario_or_test_case'],
    domainHints: ['payroll'],
    contentUnits: [
      cu('h-h', 'heading', 1, 'Inny dokument', { headingPath: ['Inny dokument'] }),
      cu('h-pre', 'paragraph', 2, 'Warunki wstępne: składnik 00123 aktywny'),
    ],
  }),
  source({
    logicalSourceId: 'document:fixture-i-workflow',
    originalRelativePath: 'WORKFLOW/fixture-i-workflow.docx',
    relativeDirectorySegments: ['WORKFLOW'],
    domainHints: ['document_workflow'],
    contentUnits: [
      cu('i-h', 'heading', 1, 'Workflow klienta OBD', { headingPath: ['Workflow klienta OBD'] }),
      cu('i-proc', 'heading', 2, 'Procedura', { headingPath: ['Workflow klienta OBD', 'Procedura'] }),
      cu('i-s1', 'list_item', 3, '1. Otwórz dokument klienta X'),
      cu('i-s2', 'list_item', 4, '2. Zatwierdź akceptację workflow'),
      cu('i-t', 'paragraph', 5, 'Procedura akceptacji dokumentu klienta X nie jest promocją globalną'),
    ],
  }),
  source({
    logicalSourceId: 'document:fixture-j-legal',
    originalRelativePath: 'FINANSE/fixture-j-legal.docx',
    relativeDirectorySegments: ['FINANSE'],
    productVersionHints: ['Teta HR 33.5'],
    documentDateHints: ['2024-06-01'],
    domainHints: ['invoicing'],
    contentUnits: [
      cu('j-h', 'heading', 1, 'Instrukcja prawna', { headingPath: ['Instrukcja prawna'] }),
      cu('j-t', 'paragraph', 2, 'Przepisy obowiązują od 2024-06-01 dla wersji 33.5'),
      cu('j-p', 'paragraph', 3, 'Procedura: 1. Sprawdź wersję produktu 2. Zweryfikuj datę obowiązywania'),
    ],
  }),
  source({
    logicalSourceId: 'document:fixture-blocked-legacy',
    format: 'legacy_doc',
    originalRelativePath: 'reference-c/doc/legacy-sample.doc',
    relativeDirectorySegments: ['reference-c', 'doc'],
    contentUnits: [],
    extractionStatus: 'blocked',
    blockReason: 'requires_conversion_tool',
    metadataOnly: true,
    requiresReview: true,
  }),
  source({
    logicalSourceId: 'document:fixture-table',
    originalRelativePath: 'KADRY/fixture-table.docx',
    relativeDirectorySegments: ['KADRY'],
    domainHints: ['hr'],
    contentUnits: [
      cu('t-h', 'heading', 1, 'Parametry', { headingPath: ['Parametry'] }),
      cu('t-r1', 'table_row', 2, 'Kod | Nazwa | Wartość', { tableIndex: 0, rowIndex: 0 }),
      cu('t-r2', 'table_row', 3, '00123 | LIMIT | 160', { tableIndex: 0, rowIndex: 1 }),
      cu('t-def', 'table_row', 4, 'Termin | Definicja', { tableIndex: 1, rowIndex: 0 }),
      cu('t-def2', 'table_row', 5, 'Składnik | przez Składnik rozumie się jednostkę naliczenia', { tableIndex: 1, rowIndex: 1 }),
    ],
  }),
];

const manifest = {
  contractVersion: 'teta-canonical-source-v1',
  extractionVersion: 'stage3j2b-v1',
  rootLabel: 'synthetic-fixtures',
  fingerprintSha256: sha256(stable(sources.map((s) => s.logicalSourceId))),
  sources,
  exactDuplicates: [],
  policies: {
    rawDocumentClientDistributionDefault: 'exclude',
    rawVideoClientDistributionDefault: 'exclude',
    extractedTextClientDistributionStatus: 'candidate',
    extractedImageClientDistributionStatus: 'candidate',
    videoFrameClientDistributionStatus: 'candidate',
    clientAssetsSelected: 0,
  },
};

const outDir = path.join(__dirname, '../../test-fixtures/teta-knowledge-candidates/stage3j2c');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'stage3j2b-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ sources: sources.length, out: path.join(outDir, 'stage3j2b-manifest.json') }, null, 2));
