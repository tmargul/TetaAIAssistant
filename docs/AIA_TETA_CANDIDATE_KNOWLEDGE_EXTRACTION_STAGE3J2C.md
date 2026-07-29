# AIA — Canonical Topic Segmentation & Candidate Knowledge Extraction (Stage 3J.2C)

Deterministic topic sectioning + candidate-only knowledge extraction from Stage 3J.2B portable store. **No approved knowledge, no semantic merge, no RAG.**

## Cel i granice

Stage 3J.2C czyta wyłącznie wynik Stage 3J.2B (portable manifest). Nie parsuje ponownie surowych źródeł.

**Wykonuje:** deterministic sectioning, quality-gated deterministic candidates, fixture precision+recall, stratified local model pilot, proposal lifecycle accounting, noise cue recall, Stage 3J.2D readiness gate.

**Nie wykonuje:** approval lexiconu, semantic dedup/merge, RAG/Qdrant/embeddings, OCR, image analysis, Oracle/SQL, client knowledge pack.

## Proposal lifecycle

```
created
  → rejectedByQualityGate | downgraded | acceptedBeforeExactCollapse
acceptedBeforeExactCollapse (+ downgraded)
  → exactCollapseWithinSection only
  → expectedForPersistence = persisted
```

Exact collapse keys by `sectionId|signature`. Shared signatures across sections or sources remain separate occurrences (`occurrencesLostBecauseOfSharedSignature=0`).

## Verification

| Metryka | Wartość |
|---------|---------|
| stage3j2cTests | 382/382 |
| fixtureExpectations | 12/12 |
| fixture recall / precision | passed (missing=0, forbidden=0) |
| regresja 3J.2B | 235/235 |
| regresja 3J.2A | 180/180 |
| regresja 3J.1 | 271/271 |
| regresja 3J | 161/161 |
| API/web build | EXIT 0 |
| auditContractCompletenessOk | true (18 sections) |
| strictErrors | [] |
| stage3j2dReadiness | ready_with_review |

## Real deterministic pilot (aggregated)

| Metryka | Wartość |
|---------|---------|
| sources / sections | 8 / 98 |
| proposalsCreated | 85 |
| rejectedByQualityGate | 0 |
| downgraded | 0 |
| acceptedBeforeExactCollapse | 85 |
| exactCollapsedWithinSection | 3 |
| expectedForPersistence | 82 |
| persisted | 82 |
| missingFromStore / unexpected | 0 / 0 |
| occurrencesLostBecauseOfSharedSignature | 0 |
| occurrenceIdCollisions | 0 |
| proposalLifecycleReconciliationOk | true |
| blocked skipped | 1 |
| transcriptSegmentsTotal | 2421 |
| assignedToNoise | 2 |
| noiseRecallStatus | **accepted** |
| realPilotRecallStatus | requires_review |

### Persisted candidates by kind

| Kind | Count |
|------|-------|
| status | 31 |
| scenario | 8 |
| parameter | 7 |
| action | 7 |
| validation_rule | 7 |
| business_concept | 5 |
| process_step | 3 |
| state_transition | 3 |
| temporal_rule | 3 |
| document_type | 1 |
| calculation_rule | 1 |
| test_case | 1 |
| **sum** | **82** |

## Local model pilot (aggregated, not re-run)

| Metryka | Wartość |
|---------|---------|
| modelPilotStatus | completed_with_timeouts |
| attempted / succeeded / timedOut | 10 / 1 / 9 |
| acceptedBySchema | 0 |
| selectedByFilesystemOrder / firstN | 0 / 0 |
| modelUsefulnessStatus | insufficient_signal |

Model is **not** claimed as an effective extractor.

## Stage 3J.2D readiness

`ready_with_review` — reasons:

- `real_pilot_requires_review`
- `model_usefulness_insufficient_signal_documented`

Noise is **accepted** (not a review reason).

## Stage boundaries

All approval / merge / RAG / Qdrant / embeddings / OCR / image / Oracle / SQL counters = **0**.
