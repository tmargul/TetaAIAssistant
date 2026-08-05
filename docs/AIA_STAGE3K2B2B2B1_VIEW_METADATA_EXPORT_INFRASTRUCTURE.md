# Stage 3K.2B2B2B1 — Candidate-Scoped View Metadata Export/Import Infrastructure

**Status:** `accepted_offline_candidate_scoped_view_metadata_export_import_infrastructure`  
**humanReviewVerdict:** `PASS_WITH_FINALIZATION`  
**humanReviewStatus:** `accepted`  
**acceptedInfrastructure:** `offline_candidate_scoped_view_metadata_export_import_infrastructure`  
**realMetadataExportStatus:** `not_executed`  
**realCandidateApprovalStatus:** `no_candidates_approved`  

**Stage 3K.2B2B2B:** `started_candidate_scoped_metadata_export`  
**Stage 3K.2B2B2B1:** `accepted_offline_candidate_scoped_view_metadata_export_import_infrastructure`  
**Stage 3K.2B2B2B2:** `not_started`  
**nextStage:** `stage3k2b2b2b2_real_p1_view_metadata_export_import_and_reassessment_pilot`  
**nextStageTitle:** Stage 3K.2B2B2B2 — Real P1 View Metadata Export, Import and Reassessment Pilot  

This acceptance covers **offline infrastructure only**. It is **not** `completed_real_export_pilot` and **not** `accepted_real_metadata_export`.

---

## Human review of infrastructure (not production approval)

| Candidate | Human decision | Why (safe summary) |
|-----------|----------------|--------------------|
| P1 employee | `request_more_evidence` | Offline export/import infrastructure accepted; real Oracle metadata export not executed; grain remains partial |

No decision events created. No Stage 3A/3D/reuse mutations. No approval. No P3–P5/P6/P7.

---

## Accepted offline infrastructure

- versioned metadata export policy (load / validate / hash / audit)
- exact P1 candidate allowlist consumption (`cand:P1:employee`, VIEW only)
- closed metadata statement templates with equality binds
- deterministic transform profile (`oracle-view-ddl-canonical-v1`)
- raw-hash authority (canonical for compare/dedup only)
- vendor-only atomic storage with path containment
- CREATE VIEW envelope assessment → existing 3K.2B2B2A SELECT parser handoff
- existing key-preservation assessor handoff
- dual execution flags required for any real Oracle metadata export
- dual flags **do not** bypass identity / edition / database preflight
- legal fail-closed outcomes without global scan fallback

---

## Policy

| Field | Value |
|-------|-------|
| path | `apps/api/config/teta-candidate-scoped-view-metadata-export-policy-v1.json` |
| version | `teta-aia-candidate-scoped-view-metadata-export-policy-v1` |
| hash | `ef861bf587a97fde7e3483373cfa6d1e974edcc38f6bad7e5a7f277745cf3499` |

### Transform profile

| Field | Value |
|-------|-------|
| id | `oracle-view-ddl-canonical-v1` |
| version | `v1` |
| hash | `1298763b33ba952abc1081b1db6041c4e156c536209cb5ccf9b943d8f82112c7` |
| rules | strip UTF-8 BOM; CRLF→LF; optional single trailing newline |
| forbidden | per-line trailing whitespace strip; comment/literal normalization |

### Exact P1 allowlist

- candidateId: `cand:P1:employee`
- allowlistId: `allowlist:P1:employee:v1`
- objectType: `VIEW`
- boundedObjectCount: `1`
- owner / name: exact allowlist-bound technical reference (not free-form user text)

---

## Status contract split (request ≠ outcome)

Default offline / flags-off run:

| Field | Value |
|-------|-------|
| requestStatus | `ready_for_explicit_vendor_execution` |
| identityPreflightStatus | `not_run` |
| oracleExecutionConsentStatus | `not_provided` |
| getDdlEligibility | `blocked_flags_missing` |
| exportAttemptStatus | `not_attempted` |
| exportOutcome | `not_attempted` |

Unchanged identity snapshot:

| Field | Value |
|-------|-------|
| identityVerificationStatus | `not_verified` |
| objectStatus | `UNKNOWN` |
| applicationEditionEvidenceStatus | `unavailable` |
| databaseIdentityConfidence | `unverified` |
| getDdlAllowed | `false` |

Oracle flags: both **false**. Real metadata export: **not executed**.

### Future real-run order (flags never bypass preflight)

1. dual flags present  
2. exact allowlist validation  
3. database identity preflight  
4. exact owner / name / type preflight  
5. application edition resolution  
6. object status assessment  
7. `getDdlEligibility` evaluation  
8. only then metadata DDL export  

Dual flags alone never set `getDdlEligibility=eligible`.

---

## Synthetic end-to-end coverage (repo-safe)

Synthetic fixtures covered:

**A. Successful synthetic path:** verified exact identity; confirmed edition / `confirmed_not_editioned`; eligible GET_DDL; complete synthetic CLOB; atomic vendor-only storage; export + import manifests; raw hash revalidation; CREATE VIEW envelope; query body extraction; existing parser; existing key-preservation assessor; no active graph promotion; no approval.

**B. Fail-closed synthetic paths:** wrong owner; wrong object type; wrong edition; ambiguous edition; unverified database identity; INVALID object; missing privilege; truncated CLOB; raw hash mismatch; path containment failure; payload changed before parsing; malformed CREATE VIEW envelope; unsupported wrapper.

Synthetic artifacts **do not** enter the real P1 pack.

Real counters remain zero: `realOracleMetadataExports`, `realViewDefinitionsImported`, `realParserRunsOnDdl`.

---

## P1 unchanged

- humanDecision: `request_more_evidence`
- grainStatus: `partial`
- genericActivationEligible: `false`
- planningEligible: `false`
- approvalForbidden: `true`
- active graph unchanged
- no Stage 3D / reuse / planning mutations

---

## Next stage (not started)

**Stage 3K.2B2B2B2 — Real P1 View Metadata Export, Import and Reassessment Pilot**

Future scope: explicit dual flags; exact database/object/edition preflight; metadata-only export of one P1 VIEW; zero business row reads; complete CLOB; vendor-only raw payload; import validation; CREATE VIEW envelope; existing parser; existing key-preservation assessor; immutable graph preview; P1 reassessment preview; separate human review.

Legal real outcomes include privilege / package / edition / visibility / truncation / policy-blocked results without fallback scan.

**Do not start Stage 3K.2B2B2B2 in this slice.**
