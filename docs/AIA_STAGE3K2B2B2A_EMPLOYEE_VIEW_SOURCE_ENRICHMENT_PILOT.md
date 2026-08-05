# Stage 3K.2B2B2A — Candidate-Scoped Employee View and Application Data Surface Offline Enrichment Pilot

**Status:** `accepted_offline_candidate_scoped_employee_view_enrichment_pilot`  
**previousHumanReviewVerdict:** `PATCH_BEFORE_COMMIT`  
**humanReviewVerdict:** `PASS_WITH_FINALIZATION`  
**humanReviewStatus:** `accepted`  
**acceptedInfrastructure:** `candidate_scoped_employee_view_and_application_surface_offline_enrichment_pilot`  
**realCandidateApprovalStatus:** `no_candidates_approved`  

**Stage 3K.2B2B:** `started_employee_source_gap_closure` (not completed)  
**Stage 3K.2B2B2:** `started_offline_source_evidence_enrichment` (not completed)  
**Stage 3K.2B2B2A:** `accepted_offline_candidate_scoped_employee_view_enrichment_pilot`  
**Stage 3K.2B2B2B:** `not_started`  
**nextStage:** `stage3k2b2b2b_candidate_scoped_view_definition_metadata_export_design`  

**Oracle / SQL / Stage 3C / model / Qdrant:** none  

---

## Human review of infrastructure (not production approval)

| Candidate | Human decision | Why (safe summary) |
|-----------|----------------|--------------------|
| P1 employee | `request_more_evidence` | Candidate-scoped enrichment infrastructure accepted; no real view DDL; key-preservation not evaluable; application data surface partial with zero gateway candidates |

No decision events applied to Stage 3D.  
No reuse-policy mutations.  
`realDecisionEventsApplied=0`, `realApprovedGenericBindingsCreated=0`.

---

## Accepted infrastructure

- exact candidate-scoped enrichment allowlist with configured and observed traversal bounds
- existing-artifact locator (Stage 2A–2E, Stage 3A, Stage 3K.2B2B1 P1 evidence)
- form anchor ≠ application data surface
- partial / ambiguous / no-candidate surface semantics
- optional manifest-based view-definition import (vendor-only raw payload)
- view-definition completeness validation
- parser output separated from not-evaluated state (`not_parsed` ⇒ null / not_evaluated)
- unsupported Oracle constructs fail-closed
- DEPENDS_ON + base PK ≠ key-preservation proof
- technical-metadata sensitivity and containment
- immutable graph-preview contract with content-hash immutability check
- zero-delta preview suppression
- synthetic vs real evidence separation
- staleness and fingerprints
- no approval / activation / planning / execution

---

## Enrichment policy

- Path: `apps/api/config/teta-employee-foundation-source-enrichment-policy-v1.json`
- Version: `teta-aia-employee-foundation-source-enrichment-policy-v1`
- Hash: `69ff562c1be4deba9116e5ab25e3d6dbb7b32ac817bccf787d3fb78d04a5caec`
- Not an approval policy; not a reuse policy

Key rules: `notParsedMeansNotEvaluated`, `zeroCandidatesAreNotUnambiguous`, `activeGraphImmutabilityRequiresContentHash`, `validatedPreviewRequiresNonEmptyDelta`, `allowlistRequiresObservedBounds`, `syntheticAndRealMetricsSeparated`, `requestAvailabilityDoesNotProveSemanticAttribution`.

---

## Allowlist summary (repo-safe)

- Scope: P1 employee only
- Application anchor: known employee form anchor (single GUID)
- Technical source: known employee semantic view reference
- Artifact scope: Stage 2A–2E, Stage 3A index, Stage 3K.2B2B1 P1 pack
- Configured bounds: maxDepth=4, maxNodes=80, maxEdges=160, maxCandidates=20
- Observed bounds (real run): within configured limits
- Prohibited fallbacks: similar view name, global view/column scan, PRAC/EMPLOYEE/KARTA search, unanchored shortest path

---

## Final real P1 result (repo-safe)

**candidateId:** `cand:P1:employee`

### View definition

| Field | Value |
|-------|-------|
| viewDefinitionRequestStatus | `requires_vendor_export` |
| artifactPresentStatus | `missing` |
| definitionCompletenessStatus | `missing` |
| parseStatus | `not_parsed` |
| unsupportedConstructsStatus | `not_evaluated` |
| unsupportedConstructs | `null` |
| parseWarnings | `null` |
| keyPreservationStatus | `not_evaluable` |

No raw DDL in repo. Vendor export required for key-preservation assessment.

### Application data surface

| Field | Value |
|-------|-------|
| evidenceAvailability | `partial` |
| materializationStatus | `requires_bounded_reconstruction` |
| surfaceCandidateCount | `0` |
| surfaceSelectionStatus | `no_candidates` |
| ambiguityStatus | `not_evaluable` |
| selectionRequired | `false` |
| semanticAttributionStatus | `unproven` |
| applicationDataSurfaceStatus | `supported_partial` |

Request-level surface evidence status may be `available_in_existing_artifacts`; this does not prove semantic attribution.

### P1 grain

| Field | Value |
|-------|-------|
| sourceOutcome | `supported_partial` |
| businessGrain | `one_row_per_employee_card_or_master_record` |
| grainStatus | `partial` |
| genericActivationEligible | `false` |
| planningEligible | `false` |
| approvalForbidden | `true` |

---

## Active graph and preview

| Check | Result |
|-------|--------|
| activeGraphPointerUnchanged | `true` |
| baseGraphHash unchanged | verified before/after |
| baseGraphFileSha256 unchanged | verified before/after |
| baseGraphFileSize unchanged | verified before/after |
| runtimeConsumersMayUsePreview | `false` |
| promotionStatus | `not_requested` |
| previewStatus | `not_created_no_new_validated_evidence` |
| previewAddedNodes | `0` |
| previewAddedEdges | `0` |
| previewSupersededEvidence | `0` |
| previewSemanticUpgradeCount | `0` |

No new preview graph created from manifest metadata, timestamps, or run IDs alone.

---

## Production reuse policy (unchanged)

- defaultReuse: `deny`
- reusableRoles: `[]`
- planningEligibleBindings: `0`
- realApprovedGenericBindings: `0`

---

## Next stage (design only — not started)

**Stage 3K.2B2B2B** — Candidate-Scoped View Definition Metadata Export and Import Design

Proposed scope: exact allowlisted metadata export for one P1 view; metadata only; no row data; no DML; no arbitrary schema scan; export manifest; owner/type/edition verification; complete CLOB/fragment handling; artifact fingerprint; vendor-only raw payload; import into existing 3K.2B2B2A pipeline; P1 key-preservation re-assessment; immutable graph preview; still no approval and no active graph promotion.

---

## CLI

```bash
pnpm --filter @teta/api run generic-semantic:stage3k2b2b2a -- validate-policy
pnpm --filter @teta/api run generic-semantic:stage3k2b2b2a -- audit --strict
```

Local review artifacts under `.local/stage3k2b2b2a/` are not committed.
