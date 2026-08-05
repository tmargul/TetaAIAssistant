# Stage 3K.2B2B2B — Candidate-Scoped View Definition Metadata Export and Import Design

**Status:** `not_started` (design corrected after `PASS_WITH_TARGETED_DESIGN_CORRECTIONS_BEFORE_COMMIT`)  
**previousHumanReviewVerdict:** `PASS_WITH_TARGETED_DESIGN_CORRECTIONS_BEFORE_COMMIT`  
**humanReviewVerdict:** `PASS_WITH_TARGETED_DESIGN_CORRECTIONS_BEFORE_COMMIT`  

**stage3k2b2b2bReadiness:** `ready_for_candidate_scoped_metadata_export_contract`  

**Stage 3K.2B2B:** `started_employee_source_gap_closure`  
**Stage 3K.2B2B2:** `started_offline_source_evidence_enrichment` (not completed)  
**Stage 3K.2B2B2A:** `accepted_offline_candidate_scoped_employee_view_enrichment_pilot`  
**Stage 3K.2B2B2B:** `not_started`  

**nextImplementationSlice:**  
`stage3k2b2b2b1_candidate_scoped_p1_view_definition_metadata_export_and_import_pilot`

**Production:** `defaultReuse=deny`; `reusableRoles=[]`; `planningEligibleBindings=0`; `realApprovedGenericBindings=0`  

**Oracle / SQL / PL/SQL / DBMS_METADATA / parser-on-real-DDL / graph preview:** none in this design stage  

---

## Goal

Design a **safe, exact, candidate-scoped metadata export** for the single known P1 employee VIEW, followed by vendor-only raw storage, export/import manifests, completeness validation, and handoff into the existing Stage 3K.2B2B2A import → parser → key-preservation → preview pipeline.

This stage answers how to obtain complete view definition text **without** row data, without global schema scans, without executing DDL/SQL as a query, and without mutating Stage 3A/3D or reuse policy.

---

## Design correction themes (PASS_WITH_TARGETED_DESIGN_CORRECTIONS_BEFORE_COMMIT)

1. Deterministic metadata export profile (transform profile + session/NLS fingerprints)
2. Raw hash authority (raw integrity vs canonical compare/dedup)
3. CREATE VIEW envelope handoff before SELECT-oriented parser
4. Atomic storage and path containment
5. Object and application edition identity (session ≠ application edition)
6. Closed metadata statement templates
7. Legal fail-closed pilot outcomes (no fallback scan)

---

## Input state (from Stage 3K.2B2B2A)

| Field | Value |
|-------|-------|
| candidateId | `cand:P1:employee` |
| viewDefinitionRequestStatus | `requires_vendor_export` |
| artifactPresentStatus | `missing` |
| definitionCompletenessStatus | `missing` |
| parseStatus | `not_parsed` |
| unsupportedConstructsStatus | `not_evaluated` |
| keyPreservationStatus | `not_evaluable` |
| grainStatus | `partial` |
| sourceOutcome | `supported_partial` |
| genericActivationEligible | `false` |
| planningEligible | `false` |
| approvalForbidden | `true` |
| P1 human decision | `request_more_evidence` |

Enrichment policy (consumed, not replaced):  
`apps/api/config/teta-employee-foundation-source-enrichment-policy-v1.json`  
version `teta-aia-employee-foundation-source-enrichment-policy-v1`  
hash `69ff562c1be4deba9116e5ab25e3d6dbb7b32ac817bccf787d3fb78d04a5caec`

Existing importer contract: `TetaViewDefinitionImportManifest` in Stage 3K.2B2B2A (to be extended, not duplicated).

---

## Exact candidate scope

**In scope (exactly one object):**

- candidate: `cand:P1:employee`
- target: the known P1 Oracle VIEW identity already bound as the employee semantic source reference
- allowlist: existing Stage 3K.2B2B2A candidate-scoped enrichment allowlist (`allowlist:P1:employee:v1` class)

**Out of scope:**

- other employee views; base tables; synonyms; packages; functions; other schemas
- name-similar objects; view dependencies; P6/P7/training/P3–P5

**Prohibited acquisition patterns:**

- wildcards; `LIKE`; global `ALL_VIEWS` scan
- fragment-name search; similar-name fallback
- unanchored shortest path; auto-pick of another owner/edition/schema

Export request **must** carry `allowlistId` + `allowlistFingerprint` from the existing P1 allowlist.

---

## Design questions → answers

### 1. Exact object identity before export

Contract: **`TetaCandidateScopedViewIdentity`**

| Field | Role |
|-------|------|
| candidateId / candidateFingerprint | Bind to P1 only |
| owner / objectName / objectType=`VIEW` | Exact identity |
| objectEdition / editionableStatus | Edition context |
| objectId / lastDdlTime | Oracle object stamps (metadata only) |
| objectStatus | `VALID` \| `INVALID` \| `UNKNOWN` |
| applicationEditionEvidenceRef | Link to application edition evidence |
| applicationEditionEvidenceStatus | Application edition resolution |
| databaseIdentityConfidence | Environment identity confidence |
| applicationBuildFingerprint | Application build stamp (opaque) |
| applicationVersionEvidenceRef | Application version evidence |
| applicationSemanticSourceRef / canonicalGraphObjectRef | Links to graph/semantic refs |
| expectedOwner / expectedObjectName / expectedObjectType / expectedEdition | Policy expectations |
| identityVerificationStatus | Gate |
| identityFingerprint | Staleness input |

`identityVerificationStatus` values:  
`verified_exact` | `object_missing` | `owner_mismatch` | `type_mismatch` | `edition_mismatch` | `multiple_editions` | `conflicting` | `not_verified`

`applicationEditionEvidenceStatus`:  
`confirmed_exact` | `confirmed_not_editioned` | `unavailable` | `ambiguous` | `conflicting`

`databaseIdentityConfidence`:  
`verified` | `supported` | `unverified` | `conflicting`

**Export must not start unless status = `verified_exact`.**  
`verified_exact` requires: exact owner; exact object name; exact VIEW type; exact database environment; exact edition **or** `confirmed_not_editioned`; and an explicit `objectStatus`.

No auto-selection of another owner, synonym, edition, or same-name object in another schema.

**INVALID** may still allow DDL metadata export, but **must** block runtime readiness claims and remain visible in the review pack.

**Do not equate** `sessionEdition` with application edition.

### 2. How to obtain a complete Oracle view definition

Preferred source order:

| Priority | Source kind | Authoritative? |
|----------|-------------|----------------|
| A | `dbms_metadata_get_ddl` (complete DBMS metadata DDL) | Yes — preferred |
| B | `preserved_source_file` / `manual_vendor_artifact` | Yes — if vendor-certified |
| C | `all_views_text` / `all_views_text_fragments` | Conditional — only with proven length + ordered fragments |
| D | `gateway_equivalent_select` / `sqljoin_equivalent_select` | **Non-authoritative** — equivalence evidence only; must not masquerade as raw VIEW DDL |

Design fields:

- `preferredSourceKind` = `dbms_metadata_get_ddl`
- `fallbackSourceKinds[]` = preserved / manual vendor / proven fragmented all_views_text
- `nonAuthoritativeSourceKinds[]` = gateway/sqljoin equivalent SELECT

Manual vendor artifact fallback requires an **explicit acquisition mode** and full export/import manifests — never an implicit privilege-failure fallback.

### 3. CLOB, fragments, editioned views, encoding

See **CLOB completeness** and **edition safety** sections.  
Raw payload stores exact bytes; encoding is explicit on the export manifest; fragments require sequence coverage proofs.

### 4. Truncation / incompleteness detection

Contract: **`TetaMetadataPayloadCompletenessAssessment`**

Must compare declared vs received length, fragment counts/sequences, coverage gaps, duplicates, truncation markers, encoding validation.

`completenessStatus`:  
`complete` | `fragmented_complete` | `truncated` | `incomplete` | `conflicting` | `not_evaluable`

**Forbidden:** marking `complete` solely because payload ends with a valid character or contains `SELECT`.

### 5. Raw DDL vs repo-safe metadata

| Layer | Content |
|-------|---------|
| Vendor-only store | Raw DDL bytes, full CLOB |
| Repo / docs / audit | hashes, lengths, source kind, completeness, parse/key-preservation summaries — **never** raw SQL |

### 6. No row data

Metadata-only. Forbidden: `SELECT` from target view, `COUNT(*)`, sampling, `FETCH FIRST`, executing view definition, `EXPLAIN PLAN` on the view, DML/DDL, commit, unrelated session mutation.

Audit counters (design) — split metadata vs business SQL:

| Metadata audit | Business / forbidden (required zero) |
|----------------|--------------------------------------|
| `oracleMetadataConnections` | `businessSqlStatementsExecuted` |
| `metadataStatementsPrepared` | `targetViewBusinessSelects` |
| `metadataStatementsExecuted` | `targetViewRowsRead` |
| `metadataRowsReturned` | `dmlStatements` |
| `viewDefinitionsExported` | `ddlStatementsExecuted` |
| | `viewDefinitionsExecuted` |
| | `commits` |

### 7. Deterministic, repeatable import

Same identity + candidate fingerprint + policy hash + payload bytes + manifest ⇒ same raw hash, canonical hash, import validation result, parser input fingerprint.  
Run ID, timestamp, and local path must not affect content fingerprints.

### 8. Invalidate old evidence when definition changes

Staleness vector includes `lastDdlTime`, identity fingerprint, raw/canonical payload hashes, policy hashes, transform profile hash, base graph hash. Any change ⇒ `stale` ⇒ re-export/re-import; no silent reuse of prior key-preservation proof.

### 9. Handoff to existing parser without executing DDL

Validated import artifact (complete / fragmented_complete only) → **envelope assessment** → identity compare → query-body extraction → existing Stage 3K.2B2B2A SELECT/FROM parser as **text/metadata** → completeness + unsupported-construct gates → key-preservation assessment → optional immutable graph preview → P1 grain reassessment preview.  
No Stage 3E compiler, no Oracle executor, no query planner.

### 10. Keep active graph unchanged

Even after successful import:  
`activeGraphPointerUnchanged=true`, `runtimeConsumersMayUsePreview=false`, `promotionStatus=not_requested`.  
Preview requires separate audit + human review.

---

## Contracts

### `TetaCandidateScopedViewMetadataExportRequest`

Minimum fields:

- `requestId`, `requestVersion`
- `candidateId`, `candidateFingerprint`
- `allowlistId`, `allowlistFingerprint`
- `targetIdentity` (`TetaCandidateScopedViewIdentity`)
- `requestedArtifactKind` = `view_definition`
- `metadataSourceStrategy`, `allowedMetadataSources[]`, `prohibitedMetadataSources[]`
- `metadataOnly=true`, `rowDataAllowed=false`, `dmlAllowed=false`, `ddlExecutionAllowed=false`
- `boundedObjectCount=1`
- **Deterministic transform profile:**  
  `metadataTransformProfileId`, `metadataTransformProfileVersion`, `metadataTransformParameters`, `metadataTransformProfileHash`
- **Session / source context:**  
  `sessionEdition`, `sessionNlsSettingsFingerprint`, `sourceDatabaseProductVersion`, `metadataApiVersion`
- `exportPolicyVersion`, `exportPolicyHash`
- `requestedBy`, `requestedAt`, `requestFingerprint`
- `status`: `planned` | `ready_for_explicit_vendor_execution` | `identity_not_verified` | `privilege_check_required` | `blocked` | `conflicting`

Transform profile must be: versioned; allowlisted; deterministic; included in `exportPolicyHash`; part of the staleness vector.  
Do not rely on incidental session settings. Profile change ⇒ artifact stale ⇒ new export ⇒ no silent reuse.

**Design stage does not execute the request.**

### `TetaViewDefinitionExportManifest`

Minimum fields:

- `manifestVersion`, `exportRequestId`
- `candidateId`, `candidateFingerprint`
- `targetIdentity`, `identityFingerprint`
- `sourceDatabaseIdentityFingerprint` (opaque, no host/login/password)
- `sourceDatabaseProductVersion`, `sourceProductVersion`, `sourceEditionContext`
- `metadataApiVersion`
- `metadataTransformProfileId`, `metadataTransformProfileVersion`, `metadataTransformParameters`, `metadataTransformProfileHash`
- `sessionEdition`, `sessionNlsSettingsFingerprint`
- `metadataSourceKind`, `exporterVersion`, `exportPolicyVersion`, `exportPolicyHash`
- `vendorArtifactRootId`, `vendorArtifactRootFingerprint`
- `payloadFileName`, `payloadRelativePath`, `payloadResolvedPathFingerprint`
- `payloadByteLength`, `rawPayloadSha256`, `canonicalPayloadSha256`
- `payloadEncoding`, `payloadContentType`
- `declaredCompletenessStatus`, `fragmentCount`, `fragmentOrderingVerified`
- `containsClientRows=false`, `containsPersonalData=false`, `containsCredentials=false`
- `containsClientSpecificMetadata`, `sensitivityClassification`
- `vendorOnly=true`, `rawPayloadRepoEligible=false`
- `exportedAt`, `manifestFingerprint`

**Never** store password, connection string, host, or Oracle login in the manifest.

### `TetaMetadataPayloadCompletenessAssessment`

- `declaredLength`, `receivedLength`, `byteLength`
- `fragmentCount`, `receivedFragmentCount`, `fragmentSequence[]`
- `fragmentOrderingVerified`, `fragmentCoverageVerified`
- `duplicateFragments[]`, `missingFragments[]`
- `truncationDetected`, `encodingValidationStatus`
- `completenessStatus` (see above)

### Raw hash authority

| Fingerprint | Authority |
|-------------|-----------|
| `rawPayloadSha256` | **Sole** integrity hash authorizing import |
| `canonicalPayloadSha256` | Compare / dedup only — **cannot** replace raw; **cannot** admit a changed payload |

Canonicalization v1 may normalize **only**:

- BOM
- CRLF / LF
- optional single trailing newline

**Must not** strip trailing whitespace per line unless a literal- and comment-aware parser proves safety.

Also: `canonicalizerVersion`, `canonicalizationRules[]`, `canonicalizationFingerprint`,  
`rawHashVerificationStatus`, `canonicalHashComparisonStatus`,  
`rawHashRevalidatedBeforeImport`, `rawHashRevalidatedBeforeParse`.

Canonicalization **must not**: alter identifiers, quoted identifiers, joins, WHERE, comments before raw hashing, aliases, or rewrite Oracle syntax.

### Editioned view safety

Fields: `sessionEdition`, `objectEdition`, `expectedEdition`, `editionableStatus`, `editionResolutionStatus`,  
`applicationEditionEvidenceRef`, `applicationEditionEvidenceStatus`, `applicationBuildFingerprint`

`editionResolutionStatus`:  
`exact` | `not_editioned` | `edition_missing` | `edition_mismatch` | `ambiguous` | `unsupported`

Block export when multiple editions are possible and exact edition is unconfirmed.  
Do **not** assume session edition equals the edition used by the Teta application.

### Privilege / availability outcomes (legal fail-closed)

`ready_for_export` | `requires_metadata_privilege` | `metadata_package_unavailable` | `requires_edition_resolution` | `object_not_visible` | `object_missing` | `edition_ambiguous` | `source_returns_truncated_text` | `export_blocked_by_policy` | `export_failed` | `export_completed`

Legal first-pilot fail-closed outcomes (not implementation failure):

- `requires_metadata_privilege`
- `metadata_package_unavailable`
- `requires_edition_resolution`
- `object_not_visible`
- `object_missing`
- `source_returns_truncated_text`
- `export_blocked_by_policy`

These outcomes **must not**: trigger fallback scan; change P1; create a real DDL artifact; create graph preview; run the parser.

Privilege failure **must not** trigger: global scan, other owner, similar view, unverified source.  
No automatic GRANT. No GRANT design that executes privileges.

Manual vendor artifact requires explicit acquisition mode + full manifests.  
Gateway/sqljoin equivalent SELECT remains non-authoritative and does not replace raw Oracle DDL.

### `TetaViewDefinitionImportManifest` (extends / supersedes pilot fields)

Minimum:

- `manifestVersion`
- `sourceExportManifestFingerprint`
- `candidateId`, `candidateFingerprint`
- `targetViewIdentity`, `targetIdentityFingerprint`
- `vendorArtifactRootId`, `vendorArtifactRootFingerprint`
- `payloadFile`, `payloadRelativePath`, `payloadResolvedPathFingerprint`
- `rawPayloadSha256`, `canonicalPayloadSha256`, `payloadByteLength`, `payloadEncoding`
- `rawHashVerificationStatus`, `canonicalHashComparisonStatus`
- `rawHashRevalidatedBeforeImport`, `payloadRevalidatedBeforeImport`
- `storageContainmentStatus`, `atomicWriteStatus`
- `declaredCompletenessStatus`, `metadataSourceKind`
- `metadataTransformProfileId`, `metadataTransformProfileVersion`, `metadataTransformProfileHash`
- `exporterVersion`, `exportPolicyVersion`, `exportPolicyHash`
- `expectedImportPolicyVersion`, `expectedImportPolicyHash`
- `vendorOnly=true`, `rawPayloadRepoEligible=false`
- `importRequestedAt`, `importManifestFingerprint`

Importer **must reject**: missing manifest; fingerprint mismatch; target/candidate/owner/type/edition mismatch; payload outside vendor store; path containment not verified; hash changed after manifest; interrupted atomic write; symlink/reparse escape; unknown source kind; incomplete fragment set; artifact outside allowlist; raw marked repo-eligible; canonical used instead of raw for integrity.

### Import validation outcomes

`not_imported` | `validated_complete` | `validated_fragmented_complete` | `rejected_fingerprint_mismatch` | `rejected_target_mismatch` | `rejected_candidate_mismatch` | `rejected_incomplete` | `rejected_truncated` | `rejected_edition_mismatch` | `rejected_policy_mismatch` | `rejected_sensitive_storage` | `rejected_path_containment` | `rejected_atomic_write_interrupted` | `rejected_raw_hash_mismatch` | `conflicting`

**Only** `validated_complete` and `validated_fragmented_complete` may enter the Stage 3K.2B2B2A parser path (after envelope extraction).

Import ≠ key-preservation proven ≠ P1 grain proven ≠ graph promotion ≠ semantic approval.

### `TetaOracleViewDdlEnvelopeAssessment`

Minimum:

- `rawDdlFingerprint`
- `ddlEnvelopeParseStatus`: `parsed` | `parsed_with_unsupported_wrapper` | `malformed` | `conflicting` | `not_parsed`
- `createKind`: `create_view` | `create_or_replace_view` | `unsupported`
- `forceStatus`, `editionableStatus`
- `declaredOwner`, `declaredViewName`, `declaredColumnList[]`
- `viewHeaderIdentityStatus`
- `queryBodyExtractionStatus`: `extracted` | `ambiguous` | `missing` | `unsupported` | `not_evaluated`
- `queryBodyStartOffset`, `queryBodyEndOffset`
- `queryBodyRawFingerprint`, `queryBodyCanonicalFingerprint`
- `wrapperWarnings[]`, `wrapperUnsupportedConstructs[]`

**Flow:**

```
complete raw DDL
  → envelope assessment
  → exact identity comparison
  → query body extraction
  → existing 3K.2B2B2A SELECT parser (parseOracleViewDefinition)
```

Existing Stage 3K.2B2B2A parser is **SELECT/FROM-oriented** (`parseOracleViewDefinition`). Envelope extraction is **required**; do **not** send full `CREATE VIEW` DDL directly to the select-only parser.

Do **not** invent a second key-preservation evaluator.  
Do **not** use regex-only as the sole authoritative mechanism for locating top-level `AS`.  
If a future parser revision already handles full `CREATE VIEW`, document that with tests and do not duplicate it.

### Atomic storage and path containment

Extend artifact contract with:

- `vendorArtifactRootId`, `vendorArtifactRootFingerprint`
- `payloadRelativePath`, `payloadResolvedPathFingerprint`
- `storageContainmentStatus`: `contained` | `outside_vendor_root` | `symlink_or_reparse_escape` | `path_invalid` | `not_verified`
- `atomicWriteStatus`: `completed` | `interrupted` | `failed` | `not_attempted`
- `temporaryPayloadFingerprint`, `finalPayloadFingerprint`
- `payloadImmutableAfterExport`
- `payloadRevalidatedBeforeImport`, `payloadRevalidatedBeforeParse`
- `rawHashRevalidatedBeforeParse`

Requirements:

- realpath containment
- no `..` escape
- no symlink / junction / reparse-point escape
- write to temporary file → complete write + hash → atomic rename
- manifest only after payload completion
- rehash before import; rehash before parser handoff

### `TetaAllowedMetadataStatement` (future closed templates)

Minimum:

- `metadataStatementTemplateId`, `metadataStatementTemplateVersion`, `metadataStatementTemplateHash`
- `metadataStatementClass`: `exact_object_identity_lookup` | `exact_view_ddl_export` | `exact_fragment_completeness_lookup`
- `allowedObjectCount`, `bindNames[]`, `bindValueFingerprints[]`
- `targetCandidateId`, `targetAllowlistId`, `policyVersion`, `policyHash`

Owner, view name, type, and edition: come from the exact allowlist; never from free-form user text; are validated; are bound where possible; never form arbitrary SQL.

---

## Raw artifact containment

Raw DDL:

- `.local` or vendor-only artifact store only
- never repo, docs, model prompts, Qdrant, application-facing logs, client-visible responses

Repo-safe may include: hash, length, source kind, completeness, parser status, unsupported-construct summary, safe key-preservation result — **without** raw SQL text.

Fields: `rawPayloadAccessStatus`, `rawPayloadStorageClass`, `rawPayloadRetentionPolicy`, `safeSummaryFingerprint`, `redactionStatus`, plus atomic/path fields above.

---

## Export / import policy (design)

**Version:** `teta-aia-candidate-scoped-view-metadata-export-policy-v1`  

**Future path:**  
`apps/api/config/teta-candidate-scoped-view-metadata-export-policy-v1.json`

Controls: exact candidate identity; single-object scope; allowed metadata sources; edition verification; application vs session edition; transform profile; metadata-only access; closed statement templates; no row-data reads; CLOB completeness; fragment ordering; raw-hash integrity; canonical compare/dedup; atomic path containment; sensitivity containment; export/import manifests; importer rejection rules; privilege fail-closed outcomes; staleness; no graph promotion; no approval effect.

**Not** an approval, reuse, or query-execution policy.

---

## Staleness

Minimum dependency set:

`candidateFingerprint`, `allowlistFingerprint`, `objectIdentityFingerprint`, `lastDdlTime`, `objectEdition`, `objectStatus`, `applicationEditionEvidenceStatus`, `sourceDatabaseIdentityFingerprint`, `metadataTransformProfileHash`, `sessionNlsSettingsFingerprint`, `extractorVersion`, `exportPolicyHash`, `importPolicyHash`, `rawPayloadSha256`, `canonicalPayloadSha256`, `baseGraphHash`

Any change ⇒ stale ⇒ re-export/import. Same view name ≠ same definition. Transform profile change alone invalidates prior artifacts.

---

## Replay / idempotence

Identical: target identity, candidate fingerprint, policy hash, transform profile hash, payload bytes, manifest  
⇒ identical raw hash, canonical hash, import validation, parser input fingerprint.

Run ID / timestamp / local path excluded from content fingerprints.

---

## Handoff to Stage 3K.2B2B2A

```
validated import artifact
  → TetaOracleViewDdlEnvelopeAssessment
  → exact header identity comparison
  → query body extraction
  → existing view-definition parser (SELECT/FROM text only)
  → completeness gate
  → unsupported-construct gate
  → key-preservation assessment
  → immutable graph preview (if positive evidence delta)
  → P1 grain reassessment preview
```

Do **not** invent a second parser or second key-preservation evaluator if the 3K.2B2B2A modules are sufficient.  
Imported artifacts cannot bypass 3K.2B2B2A policy, gates, preview rules, or human review.

---

## Active graph safeguards

| Invariant | Value |
|-----------|-------|
| activeGraphPointerUnchanged | `true` |
| runtimeConsumersMayUsePreview | `false` |
| promotionStatus | `not_requested` |
| Stage 3A SQLite writes | forbidden |
| Zero-delta preview | `not_created_no_new_validated_evidence` |

---

## Human role

**May:**

- approve running an exact candidate-scoped metadata export
- designate correct environment/version among multiple installations
- confirm edition when the system detects real ambiguity
- authorize explicit manual vendor artifact acquisition mode

**Must not:**

- invent table/owner names; invent FKs/joins; hand-rewrite DDL
- decide whether the view is key-preserving
- equate session edition with application edition by assertion alone

---

## Readiness

**Selected:** `ready_for_candidate_scoped_metadata_export_contract`

Also available (not claimed as current):  
`ready_for_explicit_vendor_metadata_export_pilot`,  
`ready_for_manual_vendor_artifact_import_pilot`,  
`requires_privilege_resolution_design`,  
`requires_edition_resolution`,  
`not_ready`

Do not use generic `ready`.

---

## First implementation slice (not started)

**Stage 3K.2B2B2B1 — Candidate-Scoped P1 View Definition Metadata Export and Import Pilot**

Scope: export/import contracts; exact P1 allowlist; identity preflight; deterministic transform profile; closed metadata statements; explicit vendor-only metadata export; complete CLOB handling; raw-hash authority; envelope handoff; atomic path containment; manifests; fingerprinting; vendor-only containment; import validation; handoff to existing parser; P1 reassessment preview.

**Without:** global metadata export; other views; P6/P7; training; P3–P5; active graph promotion; approval; runtime query integration.

Implementation is **not** started in this design correction step.

---

## Things not to build

Arbitrary Oracle metadata crawler; schema dump; full `ALL_VIEWS` export; package/table DDL export; row sampler; query executor; runtime Oracle feature; client UI; model summarization; Qdrant ingest; auto-approval; Stage 3D binding; reuse activation; graph promotion; P6/P7/training/P3–P5; second key-preservation evaluator; regex-only authoritative envelope AS locator.

---

## Required future zero counters

```
metadataExportRunsWithoutExactAllowlist
metadataObjectsExportedOutsideAllowlist
metadataExportWildcardQueries
metadataExportNameSimilarityFallbacks
viewIdentityNotVerifiedBeforeExport
wrongOwnerViewDefinitionsExported
wrongEditionViewDefinitionsExported
ambiguousEditionAutoSelected
targetViewBusinessSelects
targetViewRowsRead
dmlStatements
ddlStatementsExecuted
viewDefinitionsExecuted
businessSqlStatementsExecuted
incompleteClobMarkedComplete
unorderedFragmentsAccepted
truncatedMetadataImported
payloadFingerprintMismatchAccepted
rawDdlCommittedToRepo
rawDdlExposedInDocs
rawDdlSentToModel
rawDdlSentToQdrant
rawDdlShownToClient
importedArtifactUsedWithoutManifest
importedArtifactCandidateMismatch
importedArtifactTargetMismatch
importedArtifactEditionMismatch
activeGraphPointerChanges
productionGraphReplaced
previewGraphPromotedWithoutReview
realDecisionEventsApplied
realApprovedGenericBindingsCreated
stage3dProductionBindingsAdded
reusePolicyEntriesAdded
planningEligibleBindingsAdded
metadataExportWithoutTransformProfile
metadataTransformProfileNotHashed
metadataSessionSettingsMissing
unversionedMetadataTransformUsed
canonicalHashUsedInsteadOfRawIntegrityHash
payloadAcceptedWithRawHashMismatch
lineWhitespaceNormalizationChangedLiteralContent
lineWhitespaceNormalizationChangedCommentContent
fullCreateViewSentDirectlyToSelectOnlyParser
queryBodyExtractedFromAmbiguousEnvelope
ddlHeaderIdentityMismatchAccepted
regexOnlyEnvelopeAcceptedAsAuthoritative
payloadWrittenOutsideVendorRoot
payloadPathTraversalAccepted
payloadSymlinkEscapeAccepted
manifestWrittenBeforePayloadFinalization
payloadChangedBetweenValidationAndParse
partialPayloadImported
sessionEditionAssumedAsApplicationEdition
verifiedExactWithoutEditionEvidence
verifiedExactWithoutDatabaseIdentity
invalidObjectReportedRuntimeReady
unregisteredMetadataStatementExecuted
metadataStatementTemplateHashMismatch
freeFormIdentifierUsedInMetadataExport
metadataStatementOutsideCandidateAllowlist
businessSqlMisclassifiedAsMetadataSql
privilegeFailureTriggeredGlobalScan
privilegeFailureTriggeredOwnerFallback
editionAmbiguityAutoResolved
nonAuthoritativeSourceUsedAsRawDdl
missingDdlReportedAsKeyPreservationFailure
```

---

## Design status summary

| Item | Value |
|------|-------|
| Stage 3K.2B2B2B | `not_started` |
| Readiness | `ready_for_candidate_scoped_metadata_export_contract` |
| previousHumanReviewVerdict | `PASS_WITH_TARGETED_DESIGN_CORRECTIONS_BEFORE_COMMIT` |
| Implementation | **not** started |
| Commit | **not** performed by this correction write |
| Oracle / SQL / real DDL | **none** |
