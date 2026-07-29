# AIA — Canonical Source Extraction & Portable Offline Asset Store (Stage 3J.2B)

Deterministic extraction pipeline: documents, legacy DOC, PDF, Whisper transcripts, frames → canonical contract + content-addressed portable store. **No semantic knowledge / RAG.**

## Cel i granice

Stage 3J.2B odczytuje wybrane źródła lokalnie, wydobywa strukturę/tekst/obrazy, zachowuje provenance i zapisuje wynik poza repo (portable store).

**Wykonuje:** selection policy, folder hints (nie approved domain), DOCX/PDF/legacy DOC/Whisper+frames extraction, frame timeline z configu, MP4 ffprobe validation (bez retranskrypcji), exact dedup, content-addressed assets.

**Nie wykonuje:** approval pojęć/procesów/reguł, semantic duplicate, chunków RAG, Qdrant, embeddingów, LLM, OCR, image analysis, Oracle/SQL.

## Registry configs (wersjonowane)

| Config | Opis |
|--------|------|
| `teta-source-selection-policy-v1.json` | DOC/DOCX/PDF rekursywnie; ALL_MOVIES JSON+frames+MP4; ignore temp/unsupported |
| `teta-document-folder-hints-v1.json` | 30+ folderów jako hints (EDU, KADRY, FINANSE, KSEF, SCENARIUSZE, …) |
| `teta-video-archive-defaults-v1.json` | frame_00001=1s, interval=10s, formula z configu |

## Frame timeline (user-confirmed recipe)

- `frame_00001.jpg` → **1 s**
- `frame_00002.jpg` → **11 s**
- `frame_00003.jpg` → **21 s**
- `frame_00360.jpg` → **3591 s**
- Brak frame 0; luki/duplikaty indeksów raportowane

## Offline policy

| Warstwa | Zawartość | Dystrybucja klient |
|---------|-----------|-------------------|
| Vendor raw archive | Oryginały DOC/DOCX/PDF/JSON/frames/MP4 | exclude |
| Portable extracted store | Tekst, struktura, provenance, wydobyte obrazy/frames | candidate (nie selected) |
| Client knowledge pack | Później (Stage 3K+) | — |

`clientAssetsSelected=0` — selekcja dowodów nastąpi później.

## CLI

```bash
pnpm --filter @teta/api run source-extraction:stage3j2b -- validate-config
pnpm --filter @teta/api run source-extraction:stage3j2b -- discover --root "<local-training-root>"
pnpm --filter @teta/api run source-extraction:stage3j2b -- extract --root "<local-training-root>" --output ".local/teta-knowledge/stage3j2b"
pnpm --filter @teta/api run source-extraction:stage3j2b -- validate --input ".local/teta-knowledge/stage3j2b/manifest.json"
pnpm --filter @teta/api run source-extraction:stage3j2b -- audit --strict
```

## Synthetic fixtures (repo)

References A–G w `apps/api/test-fixtures/teta-source-extraction/stage3j2b/`:

| Ref | Typ | Oczekiwanie |
|-----|-----|-------------|
| A | SCENARIUSZE DOCX | headings, table, list, embedded image |
| B | EDU DOCX | productFamilyHint=teta_edu, brak HR inheritance |
| C | legacy DOC | mock converter + provenance |
| D | PRZELOM ROKU DOCX | sectionLevelClassificationRequired |
| E | FINANSE/KSEF DOCX | nested folder hints |
| F | scanned PDF stub | ocrRequired, ocrCalls=0 |
| G | duplicate paragraph | exact dedup, 2 occurrences preserved |
| Video | ALL_MOVIES/zu1 | segments + frame refs + optional MP4 |

## Verification (synthetic + regression)

```json
{
  "stage3j2bTestsExecuted": 235,
  "stage3j2bTestsPassed": 235,
  "stage3j2bTestsFailed": 0,
  "fixtureExpectationsExecuted": 12,
  "fixtureExpectationsPassed": 12,
  "stage3j2aRegressionExecuted": 180,
  "stage3j2aRegressionPassed": 180,
  "stage3j1RegressionExecuted": 271,
  "stage3j1RegressionPassed": 271,
  "stage3jRegressionExecuted": 161,
  "stage3jRegressionPassed": 161,
  "apiBuildExitCode": 0,
  "webBuildExitCode": 0
}
```

Fixture extraction fingerprint: `7d1ee09c924653b07477df805eb51d669cedc84062bf4c9a111876448d61ea2e`

## Real catalog discovery (aggregated, read-only)

| Metryka | Wartość |
|---------|---------|
| filesExamined | 34237 |
| documentFilesSelected | 217 |
| transcriptJsonFilesSelected | 51 |
| mp4FilesSelected | 0 |
| frameImageFilesSelected | 33910 |
| temporaryFilesIgnored | 0 |
| unsupportedFilesIgnored | 8 |
| otherFilesIgnored | 51 |
| fileCategoryReconciliationOk | true |
| uniqueMovieBasenames | 51 |
| movieBundleRecordsCreated | 51 |
| frameDirectoriesSelected | 51 |
| completeCoreMovieBundles | 51 |
| partialCoreMovieBundles | 0 |
| bundlesWithTranscriptAndFrames | 51 |
| bundlesWithOptionalMp4 | 0 |
| bundlesWithoutOptionalMp4 | 51 |
| bundlesWithAllThreeAssets | 0 |
| completeMovieBundles (deprecated, = core) | 51 |
| partialMovieBundles (deprecated, = core partial) | 0 |
| frameFilesIncorrectlyCountedAsMovieBundles | 0 |

**Core movie bundle** = transcript JSON + frames directory (case-insensitive basename pairing). **MP4** is optional validation-only; absence does not make a core bundle partial.

Wyjaśnienie wartości **1492** z poprzedniej iteracji:
- poprzednia metryka `realCatalogMovieBundles` była zawyżona przez techniczne naliczanie katalogów/plików frame jako osobnych bundle records;
- po patchu bundle liczone są wyłącznie jako unikalne case-insensitive basenames (`JSON ∪ frame-directory ∪ MP4`);
- poprawna wartość bundle dla real catalog to **51**.

## Real pilot (aggregated)

| Metryka | Wartość |
|---------|---------|
| requested | 8 |
| found (unique) | 8 |
| sourceRecordsCreated | 8 |
| contentExtractionSucceeded | 7 |
| contentExtractionWithWarnings | 0 |
| contentExtractionBlocked | 1 |
| metadataOnlySources | 1 |
| sourcesRequiringReview | 1 |

Invariant: `sourceRecordsCreated = contentExtractionSucceeded + contentExtractionWithWarnings + contentExtractionBlocked`. Blocked legacy DOC is **not** counted as content success. Deprecated metric `realPilotSourcesExtracted` removed — use explicit counters above.
| formats | docx×5, pdf×1, legacy_doc×1, whisper×1 |
| contentUnits (total) | 2734 |
| portable assets (total refs) | 813 |
| legacy DOC conversion | requires_conversion_tool (LibreOffice unavailable on host) |
| MP4 transcriptExtractionStatus | succeeded |
| MP4 frameIndexingStatus | succeeded |
| MP4 mp4AssetStatus | missing_vendor_only |
| MP4 mp4DurationValidationStatus | unavailable (ffprobe not confirmed) |

Pilot resolution + pełne ścieżki: `.local/AIA_TETA_CANONICAL_SOURCE_EXTRACTION_STAGE3J2B.pilot.json` (gitignored).

## Stage boundaries (must be 0)

concepts/processes/rules/RAG/Qdrant/embeddings/LLM/OCR/image analysis/Oracle/SQL — enforced in validator + audit.

## Strict invariants (skrót)

- folder hints ≠ approved domain/concept
- exact dedup preserves all source occurrences
- semanticMergeDecisionsMade=0
- portable manifest bez absolute paths
- source tree read-only
- repo docs bez raw treści źródeł

## Moduł

`apps/api/src/teta-source-extraction/` + script `source-extraction:stage3j2b`

## Następne etapy (nierozpoczęte)

- **Stage 3J.2C** — semantic knowledge extraction
- **Stage 3J.2D** — correlation / dedup semantyczna
- **Stage 3K** — client knowledge pack
