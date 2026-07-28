# AIA — Teta Knowledge Source Inventory (Stage 3J.2A)

Deterministic local bulk inventory for Teta knowledge sources (registry + pairing + validation). **No content extraction.**

## Cel i granice

Stage 3J.2A wykrywa, sparowuje, waliduje format, klasyfikuje osie produktu i haszuje źródła.

**Nie wykonuje:** ekstrakcji pojęć/procesów/reguł, chunkowania RAG, Qdrant, embeddingów, LLM, OCR, analizy obrazu, approval lexicon, Stage 3K / 3J.2B.

## Integrity patch (przed commitem)

Naprawiono: changed-transcript fingerprint, unclassified `logicalSourceId`, fixture expectation semantics, frame naming/manifest counters, document asset inventory, sourceRevision contract.

## Osie klasyfikacji (nie jeden domainId)

- **platform** — `teta_platform`
- **product family** — `teta_hr`, `teta_edu`, `unclassified`
- **product surface** — `teta_desktop`, `teta_me`, `unclassified`
- **business domain hints** — domain IDs Stage 3J.1 (nie approved concepts)
- **business area / knowledge area / audience / scope**

### Teta ME

`productFamilyIds=["teta_hr"]`, `productSurfaceIds=["teta_me"]` — web surface na wspólnej BD HR. **Nie** business domain.

### Teta Edu

`productFamilyIds=["teta_edu"]`, `businessAreaIds=["university_administration"]` — osobna rodzina. **Nie** dziedziczy HR.

## Series registry

- **DS** — families=[teta_hr] surfaces=[] risk=medium
- **EDU** — families=[teta_edu] surfaces=[] risk=medium
- **KADRY** — families=[teta_hr] surfaces=[] risk=low
- **ME** — families=[teta_hr] surfaces=[teta_me] risk=medium
- **OBD** — families=[] surfaces=[] risk=high
- **PIT** — families=[teta_hr] surfaces=[] risk=low
- **PLACE** — families=[teta_hr] surfaces=[] risk=low
- **PPK** — families=[teta_hr] surfaces=[] risk=low
- **PROJ** — families=[] surfaces=[] risk=medium
- **RAP** — families=[] surfaces=[] risk=medium
- **RCP** — families=[teta_hr] surfaces=[] risk=low
- **WCAG** — families=[] surfaces=[] risk=low
- **WORKFLOW** — families=[] surfaces=[] risk=high
- **WSTEP** — families=[] surfaces=[] risk=low
- **ZU** — families=[] surfaces=[] risk=low

## Pairing (transcript JSON ↔ frames dir)

- Exact / case-insensitive basename match
- Fuzzy = `requires_confirmation` only; **auto-accept = 0**
- Fixture: exact=`zu2.json`, CI=`ds.json`, fuzzy=`workflow2.json`→`WORFLOW2`

## Verification

```json
{
  "stage3j2aTestsExecuted": 180,
  "stage3j2aTestsPassed": 180,
  "stage3j2aTestsFailed": 0,
  "fixtureSourcesExamined": 29,
  "fixtureSourcesPassed": 29,
  "apiBuildExitCode": 0,
  "webBuildExitCode": 0,
  "stage3j1RegressionExecuted": 271,
  "stage3j1RegressionPassed": 271,
  "stage3jRegressionExecuted": 161,
  "stage3jRegressionPassed": 161
}
```

## Fixture expectations

Celowo invalid = zaliczony przypadek, jeśli wynik = invalid. Nie raportować „24/25 passed” jako ogólnego wyniku, gdy wszystkie oczekiwania przeszły.

| Oczekiwanie | Liczba |
|-------------|--------|
| celowo valid (`ready`) | 0 |
| celowo invalid | 2 |
| celowo warning / requires_review | 27 |
| expectations passed | 29/29 |
| unexpected failures | 0 |

```json
{
  "fixtureCasesEvaluated": 29,
  "fixtureExpectationsPassed": 29,
  "fixtureExpectationsFailed": 0,
  "expectedValidSources": 0,
  "expectedInvalidSources": 2,
  "expectedWarningSources": 27,
  "actualValidSources": 0,
  "actualInvalidSources": 2,
  "actualWarningSources": 27,
  "unexpectedFixtureFailures": 0
}
```

## Determinism / fingerprint

Zmiana tekstu segmentu → inny `transcriptSha256` / `sourceRevisionId` / inventory fingerprint. Absolute root / generatedAt / mtime / kolejność FS nie wpływają.

```json
{
  "identicalInventoryFingerprintMatches": 1,
  "changedTranscriptFingerprintDiffers": 1,
  "changedTranscriptSha256Differs": 1,
  "changedTranscriptSourceRevisionDiffers": 1,
  "unchangedTranscriptSourceRevisionMatches": 1,
  "deterministicFingerprintCheckOk": true
}
```

## Identity / duplicates

- Znane serie: `training-video:KADRY:1`, `training-video:EDU:base`
- Nieznane: `training-video:unclassified:<normalized-basename>` (nie `:base`)
- Expected duplicate: tylko `training-video:KADRY:1` (kadry1 + kadry01)
- `unexpectedLogicalSourceCollisions=0`, `unclassifiedLogicalSourceCollisions=0`

## Frame naming schemes

Suma kategorii = `pairedFrameDirectories` (27).

```json
{
  "timestamp_seconds": 21,
  "timestamp_milliseconds": 1,
  "hh_mm_ss": 1,
  "sequential_index": 1,
  "existing_manifest": 1,
  "unknown": 2
}
```

Jednostki hashów:

- `contentHashedFrameFiles` / `metadataHashedFrameFiles` — **pliki**
- `contentHashedFrameDirectories` / `metadataHashedFrameDirectories` — **katalogi**

Existing manifest: kontrakt `teta-video-frames-manifest-v1`; `framesWithExistingManifest=2` (1 valid + 1 invalid fixture). Sequential bez interwału/manifestu → `requires_interval_or_manifest`.

## Documents (inventory only)

Rozdzielone od whisper transcript assets. Sygnatura/rozszerzenie/size/SHA-256 — bez parsera treści.

```json
{
  "documentsByType": {
    "pdf": 1,
    "docx": 1,
    "rtf": 1,
    "txt": 1,
    "html": 1,
    "json": 1,
    "jsonl": 1,
    "mp4": 1
  },
  "supportedDocumentFiles": 8,
  "unsupportedFiles": 1
}
```

## Discovery counters

```json
{
  "filesExamined": 38,
  "transcriptJsonFiles": 29,
  "frameDirectories": 29,
  "transcriptAssets": 29,
  "documentSources": 8,
  "videoAssets": 1,
  "frameAssets": 51,
  "existingChunkFiles": 0,
  "fuzzyPairsAutomaticallyAccepted": 0
}
```

## Stage boundaries (all 0)

```json
{
  "conceptsExtracted": 0,
  "processesExtracted": 0,
  "rulesExtracted": 0,
  "lexiconEntriesApproved": 0,
  "sourceDomainHintsPromotedToApprovedLexicon": 0,
  "ragChunksGenerated": 0,
  "qdrantCalls": 0,
  "embeddingCalls": 0,
  "llmCalls": 0,
  "ocrCalls": 0,
  "imageAnalysisCalls": 0,
  "oracleConnectionsOpened": 0,
  "oracleStatementsExecuted": 0,
  "sqlCompiled": 0,
  "sqlExecuted": 0
}
```

## Strict

`strictErrors=[]`

Local artifacts (untracked): `.local/AIA_TETA_KNOWLEDGE_SOURCE_*STAGE3J2A*.json`
