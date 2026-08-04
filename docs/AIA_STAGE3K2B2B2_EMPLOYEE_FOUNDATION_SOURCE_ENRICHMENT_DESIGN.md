# Stage 3K.2B2B2 — Employee Foundation Offline Source Evidence Enrichment Design

**Status:** `not_started` (design corrected after `PASS_WITH_TARGETED_DESIGN_CORRECTIONS_BEFORE_COMMIT`)  
**previousHumanReviewVerdict:** `PASS_WITH_TARGETED_DESIGN_CORRECTIONS_BEFORE_COMMIT`  

**Stage 3K.2B2B:** `started_employee_source_gap_closure`  
**Stage 3K.2B2B1:** `accepted_offline_employee_foundation_evidence_pilot`  
**Stage 3K.2B2B2:** `not_started`  

**stage3k2b2b2Readiness:** `ready_for_candidate_scoped_offline_extraction`  

**nextImplementationSlice:**  
`stage3k2b2b2a_candidate_scoped_employee_view_and_application_data_surface_offline_enrichment_pilot`

**Supporting readiness:**
- `ready_for_existing_artifact_enrichment` — partial data-surface skeleton (not confirmed)
- `ready_for_vendor_metadata_export_design` — view definition text absent from Stage 3A
- `ready_for_application_context_assisted_pilot` — training anchor selection

**Production:** `defaultReuse=deny`; `reusableRoles=[]`; `planningEligibleBindings=0`; `realApprovedGenericBindings=0`  

**Oracle / SQL execution / Stage 3C / model / Qdrant:** none  

---

## Goal

Design controlled offline acquisition of missing technical evidence for employee-foundation gaps — without approval, runtime query, Stage 3D mutation, reuse activation, or active graph promotion.

---

## Input state (Stage 3K.2B2B1)

| Candidate | Safe summary |
|-----------|--------------|
| P1 | `supported_partial`; grain=`partial`; view definition unavailable; application data surface unconfirmed; runtime access not established |
| P2 | scope=`supported_bounded_confirmed`; grain blocked by P1 |
| P6 | `requires_additional_source`; diagnostics-only |
| P7 | H4 business uniqueness confirmed; same-record unproven; exact-one not supported |

Open gaps: `view_definition_evidence`, `training_application_anchor`, `employee_card_number_semantic_path`.

---

## Source classes

`existing_offline_graph_evidence`, `existing_stage2_artifact`, `dll_metadata`, `gateway_metadata`, `sqljoin_metadata`, `help_document`, `plugin_registry_snapshot`, `view_definition_snapshot`, `oracle_metadata_snapshot`, `vendor_technical_artifact`, `user_application_context_anchor`, `screenshot_application_context_anchor`.

Screenshot/user indication may identify form/tab/control only — never table/view/column/FK/join.

---

## Existing-source audit (corrected statuses)

### `view_definition_evidence`
- available: VIEW identity, DEPENDS_ON, HAS_COLUMN, structural Stage 2E/3A graph  
- missing: definition SQL/DDL text, completeness/parse evidence  
- **evidenceAvailability:** `unavailable`  
- **enrichmentRequestStatus:** `requires_vendor_export`  
- Stage 3A does **not** store view definition SQL  

### `application_data_surface_evidence`
- available: form→BO/dataset/gateway skeleton (partial)  
- missing: confirmed employee-master surface attribution  
- **evidenceAvailability:** `partial`  
- **materializationStatus:** `requires_bounded_reconstruction`  
- **semanticAttributionStatus:** `unproven`  
- **Do not** report as `available_in_existing_artifacts` alone or `confirmed`  

### `training_application_anchor`
- offline candidates exist; foundation anchor unverified  
- **status:** `requires_application_context`  

### `employee_card_number_semantic_path`
- **status:** `requires_new_offline_extraction`  

### `same_record_identity_evidence` / `participant_role_attribution`
- **status:** `blocked` / `requires_application_context` (phase-gated)

---

## Contracts

### `TetaEmployeeFoundationSourceEnrichmentRequest`
`requestId`, `gapKind`, `candidateIds[]`, `requestedEvidenceClasses[]`, `startingAnchors[]`, `allowedSources[]`, `prohibitedSources[]`, `boundedScope`, `acquisitionMode`, `priority`, `status`, `reason`, `expectedEffect`, `dependencyFingerprints[]`, `requestFingerprint`

**gapKind:** view_definition_evidence | application_data_surface_evidence | training_application_anchor | participant_role_attribution | employee_card_number_semantic_path | same_record_identity_evidence  

**status:** planned | available_in_existing_artifacts | requires_new_offline_extraction | requires_vendor_export | requires_application_context | blocked | conflicting  

**acquisitionMode:** existing_artifact_reuse | offline_source_parse | vendor_metadata_export | application_context_assisted | manual_vendor_artifact_import  

### `TetaCandidateScopedEnrichmentAllowlist`
```
allowlistId
candidateIds[]
candidateFingerprints[]
applicationAnchorRefs[]
technicalSourceRefs[]
artifactRefs[]
allowedNodeTypes[]
allowedEdgeTypes[]
allowedArtifactKinds[]
maxDepth
maxNodes
maxEdges
maxCandidates
prohibitedFallbacks[]
baseGraphHash
policyVersion
policyHash
allowlistFingerprint
```

**First-slice allowlist (P1 only):**
- P1 employee candidate  
- known employee form anchor  
- existing employee semantic view reference  
- directly related Stage 2A–2E artifacts  
- local import of **exactly that** view definition  

**Prohibited fallbacks:** similar view name; global VIEW scan; global column scan; PRAC/EMPLOYEE/KARTA search; unanchored shortest path  

**Strict zeros:**  
`enrichmentRunsWithoutAllowlist`, `artifactsReadOutsideAllowlist`, `graphTraversalOutsideAllowedNodeTypes`, `graphTraversalOutsideAllowedEdgeTypes`, `candidateScopedRunFellBackToNameSearch`

### `TetaOfflineTechnicalEvidenceArtifact`
Base fields plus sensitivity:
```
containsClientSpecificMetadata
sensitivityClassification:
  generic_technical_metadata | vendor_confidential |
  client_specific_technical_metadata | restricted
rawPayloadRepoEligible
safeSummaryAvailable
safeSummaryFingerprint
redactionStatus
containsClientRows=false
containsCredentials=false
containsPersonalData=false
vendorOnly
```

For raw DDL:
- `containsClientRows/PersonalData/Credentials=false`  
- `containsClientSpecificMetadata=true|unknown_until_classified`  
- `rawPayloadRepoEligible=false`  
- `vendorOnly=true`  
- raw payload only in `.local` / vendor-only store  
- repo docs: hash, parse status, safe metrics/conclusions only  

**Strict:** `rawViewDefinitionCommittedToRepo`, `clientSpecificTechnicalMetadataExposedInDocs`, `unclassifiedRawMetadataMarkedRepoEligible`

### `TetaViewDefinitionEvidenceArtifact`
```
sourceObjectRef
sourceObjectOwner
sourceObjectType
sourceObjectEdition
definitionSourceKind:
  all_views_text | dbms_metadata_ddl | preserved_source_file |
  gateway_equivalent_select | sqljoin_equivalent_select | manual_vendor_artifact
rawContentFingerprint
canonicalContentFingerprint
definitionCompletenessStatus:
  complete | fragmented_complete | truncated | incomplete | missing | conflicting
sourceLength
expectedLength
fragmentCount
fragmentOrderingVerified
parseStatus:
  parsed | parsed_with_unsupported_constructs | parse_failed | not_parsed
parserVersion
oracleDialectVersion
unsupportedConstructs[]
parseWarnings[]
```

**Insufficient alone:** ALL_DEPENDENCIES, base-table PK, view name, column-name similarity.

### `ViewKeyPreservationEvidence`
Statuses: proven | supported_partial | unproven | conflicting | not_evaluable  

**`proven` only when:**
- `definitionCompletenessStatus ∈ {complete, fragmented_complete}`  
- `parseStatus=parsed`  
- no unresolved constructs affecting grain  

For truncated / incomplete / conflicting / parse_failed / parsed_with_unsupported_constructs: max `supported_partial` or `not_evaluable`.

**Invariant:** DEPENDS_ON + base PK ≠ key-preserving view proof.

**Strict:**  
`keyPreservationProvenFromIncompleteDefinition`, `keyPreservationProvenWithUnsupportedConstructs`, `truncatedViewDefinitionTreatedAsComplete`, `unorderedDefinitionFragmentsAccepted`

### `TetaApplicationDataSurfaceEvidence`
Split statuses:
```
evidenceAvailability: complete | partial | unavailable | conflicting
materializationStatus: materialized | requires_bounded_reconstruction | requires_new_extraction | blocked
semanticAttributionStatus: proven | supported_partial | unproven | conflicting
surfaceSelectionStatus: unique | ambiguous | none
surfaceCandidates[]
selectionRequired
applicationAnchorRefs[]
formRefs[] / controlRefs[] / datasetRefs[] / gatewayRefs[] / sqlJoinRefs[]
oracleAccessSurfaceRefs[]
semanticSourceRefs[]
runtimeAccessEvaluationStatus
```

**Current real P1 expectation:**  
`evidenceAvailability=partial`, `materializationStatus=requires_bounded_reconstruction`, `semanticAttributionStatus=unproven`

Until form→dataset→gateway→employee application source is confirmed, `applicationDataSurfaceStatus` cannot be `confirmed`.

If multiple gateways/data objects: `surfaceSelectionStatus=ambiguous`, `selectionRequired=true`.  
Do **not** auto-pick shortest path / first gateway / most common view.

**Strict:** `partialDataSurfaceReportedAsComplete`, `ambiguousDataSurfaceAutoSelected`, `nearestGatewayUsedAsSemanticProof`, `formAnchorUsedAsDataSurface`

### `TetaSameRecordIdentityEvidence`
(same as prior design; P7 exact-one gated)

### `TetaCanonicalGraphEnrichmentManifest`
```
baseGraphHash
previewGraphHash
graphRevisionStatus: preview | validated_preview | rejected | superseded
activeGraphPointerBefore
activeGraphPointerAfter
activeGraphPointerUnchanged
runtimeConsumersMayUsePreview
promotionStatus: not_requested | blocked | requires_separate_review | approved_for_future_promotion
...
```

**Stage 3K.2B2B2A always:**  
`graphRevisionStatus ∈ {preview, validated_preview}`  
`activeGraphPointerUnchanged=true`  
`runtimeConsumersMayUsePreview=false`  
`promotionStatus=not_requested`  

Do not update production Stage 3A pointer.

**Strict:** `activeGraphPointerChanges`, `runtimeConsumersUsingPreviewGraph`, `previewGraphPromotedWithoutReview`, `productionGraphReplaced`

### `TetaGraphEnrichmentDeltaAssessment`
No provenance deletion; no stable-ID rewrite; no UNKNOWN→confirmed without evidence; no duplicates/broken edges; no scope expansion; no semantic approval; no runtime access activation.

---

## SQL parsing is not SQL execution

Audit counters (separate):
- `viewDefinitionsLocated` / `Imported` / `Parsed` / `ParseFailures`  
- `sqlCompiled=0`, `sqlExecuted=0`, `viewDefinitionsExecuted=0`  

Parser analyzes text as metadata only.  
Never pass definitions to Stage 3E compiler, Oracle executor, query planner, or runtime agent.  
Regex-only may be lexical pre-scan only — not sole basis for final key-preservation verdict.

---

## First-slice legal outcomes (not slice failure)

Without real DDL, a legal real run may end with:
- `viewDefinitionArtifactStatus=requires_vendor_export`  
- `viewKeyPreservationStatus=not_evaluable`  
- application data surface: `partial` / `supported_partial` / `ambiguous`  
- graph preview: only for really available evidence  
- P1 grain remains `partial`  

Separate:
`artifactImportCapabilityStatus` | `artifactPresentStatus` | `artifactValidationStatus` | `artifactSemanticEffect`

Synthetic fixtures may test importer/parser.  
Synthetic view definition must **not** enter real P1 pack, change real P1 grain, or enter real graph preview.

**Strict:** `syntheticViewDefinitionUsedForRealP1`, `missingRealArtifactReportedAsExtractionFailure`, `realP1GrainImprovedWithoutRealViewArtifact`, `syntheticArtifactIncludedInRealGraphPreview`

---

## Acquisition modes & human role

Modes unchanged. Future `vendor_metadata_export`: exact allowlist; metadata only; no rows; no DML; no arbitrary schema scan; fingerprints + scope manifest + object-count audit.

Human may indicate form/tab/field/label meaning.  
Human must not be asked for table/view/column/FK/join/package/view definition.

---

## Phase order

1. P1 view definition + application data surface  
2. P1 key-preservation re-assessment  
3. P6 semantic path  
4. P2/P6 same-record  
5. P7 composite re-assessment  
6. training anchor + participant attribution  

---

## Recommended first slice (from audit)

**Stage 3K.2B2B2A — Candidate-Scoped Employee View and Application Data Surface Offline Enrichment Pilot**

Scope: P1 only; exact allowlist; Stage 2 artifact locator; data-surface reconstruction; view-definition import+completeness+parser; key-preservation; immutable graph **preview**; P1 grain preview.

Out of scope: live Oracle exporter; P6/P7/training; P2 production re-eval; active graph promotion; runtime access; 3D/reuse/approval/planning.

---

## Enrichment policy (versioned design)

**Version:** `teta-aia-employee-foundation-source-enrichment-policy-v1`  
**Future path:** `apps/api/config/teta-employee-foundation-source-enrichment-policy-v1.json`

Additional controlled rules:
- `viewDefinitionCompletenessRequired`  
- `unsupportedConstructsBlockKeyPreservation`  
- `candidateScopedAllowlistRequired`  
- `partialDataSurfaceNotConfirmed`  
- `ambiguousDataSurfaceRequiresSelection`  
- `rawTechnicalMetadataContainment`  
- `previewGraphCannotBecomeActive`  
- `syntheticArtifactsExcludedFromRealAssessment`  
- `missingArtifactIsFailClosedNotFailure`  

Not approval policy. Not reuse policy.

---

## Staleness

Depends on: `baseGraphHash`, `sourceArtifactFingerprint`, `extractorVersion`, `parserVersion`, `enrichmentPolicyVersion`, `enrichmentPolicyHash`, `applicationAnchorFingerprint`, `candidateFingerprints[]`, `dependencyFingerprints[]`, allowlist fingerprint.

Change ⇒ stale ⇒ re-assessment ⇒ no silent carry-forward.  
P7 depends on P1, P2, P6, H4, same-record, graph revision.

---

## Things not to build

Live Oracle extractor; row sampler; schema crawler; approval; Stage 3D/reuse mutation; planner/SQL compiler integration; runtime access binding; Vision/OCR; person identity/PESEL; P3–P5; payroll bindings; active graph promotion.

---

## Design status after corrections

| Field | Value |
|-------|-------|
| Stage 3K.2B2B2 | `not_started` |
| Readiness | `ready_for_candidate_scoped_offline_extraction` |
| Next slice | `stage3k2b2b2a_…` |
| Implemented | no |
| Commit of design | pending this correction pass |
