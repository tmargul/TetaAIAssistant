# Stage 3K.2B2B2B3 — P1 Application Access Surface and Semantic Attribution Gap Closure Design

**Status:** `not_started` (design only; corrections after `PASS_WITH_TARGETED_DESIGN_CORRECTIONS_BEFORE_COMMIT`)  
**previousHumanReviewVerdict:** `PASS_WITH_TARGETED_DESIGN_CORRECTIONS_BEFORE_COMMIT`  
**humanReviewVerdict:** `PASS_WITH_TARGETED_DESIGN_CORRECTIONS_BEFORE_COMMIT`  

**stage3k2b2b2b3Readiness:** `ready_for_bounded_p1_application_surface_reconstruction_review`  

**Stage 3K.2B2B2B:** `started_candidate_scoped_metadata_export`  
**Stage 3K.2B2B2B1:** `accepted_offline_candidate_scoped_view_metadata_export_import_infrastructure`  
**Stage 3K.2B2B2B2:** `accepted_real_p1_view_metadata_export_import_and_reassessment_pilot`  
**Stage 3K.2B2B2B3:** `not_started`  

**nextImplementationSlice:**  
`stage3k2b2b2b3a_p1_candidate_scoped_application_surface_reconstruction_pilot`

**Production:** `defaultReuse=deny`; `reusableRoles=[]`; `planningEligibleBindings=0`; `realApprovedGenericBindings=0`

**Oracle / SQL / row reads / DLL rescan / model / RAG / Qdrant / Stage 3A–3D mutation / planner / P2–P7 / training:** none in this design stage

---

## Design correction themes

1. Exact application anchor contract (`TetaExactApplicationAnchorAllowlistEntry`)
2. Surface role classification (root vs lookup/child/supporting)
3. Multi-object access surfaces (`accessObjectRefs[]`)
4. Versioned lineage path grammar (`TetaApplicationSurfaceLineagePattern`)
5. Bounded artifact locator (no full NDJSON scans)
6. Identity/grain inheritance gate for same-object P1 only
7. Current-slice vs future-runtime readiness axes
8. Explicit hashed policy bounds
9. Candidate deduplication without evidence loss
10. Active graph immutability contract

---

## Goal

Answer three separate questions for `cand:P1:employee` without collapsing them:

1. **Application access surface** — exact datasource/gateway/access objects used by the allowlisted form
2. **Semantic attribution** — whether a **root** surface represents business role `employee` with P1-compatible grain
3. **Runtime execution access** — out of scope for B3A (`runtimeAccessReadiness=not_evaluated_out_of_scope`)

No design outcome approves P1, enables reuse, or selects a runtime execution object.

---

## Accepted input state

| Field | Value |
|-------|-------|
| candidateId | `cand:P1:employee` |
| semanticMasterSourceRef | `TETA_ADMIN.NT_KP_PRC_PRACOWNICY` (`VIEW`) |
| technicalSourceIdentityStatus | `verified_exact` |
| technicalViewDefinitionStatus | `validated_complete` |
| technicalKeyPreservationStatus | `proven` |
| candidateGrainEvaluationStatus | `proven` |
| candidateApprovalStatus | `not_approved` |
| genericReuseStatus | `denied_by_current_policy` |
| planningEligibilityStatus | `blocked` |

Historical Stage 3K.2B2B2A surface gap (history only): `surfaceCandidateCount=0`, `requires_bounded_reconstruction`, attribution `unproven`.

---

## Terminology separation

| Term | Meaning | Does **not** prove |
|------|---------|--------------------|
| `semanticMasterSourceRef` | Technical source preserving P1 grain | Application usage; runtime auth |
| `applicationAnchorRefs[]` / exact allowlist entry | Form/control/context identity | Table/view/gateway/column/join/grain |
| `applicationDataSurfaceRefs[]` | Datasource/dataset/BO/DF/gateway used by app | Semantic role; runtime eligibility |
| `applicationAccessSurfaceRefs[]` | Exact Oracle objects / gateway contract | Runtime AIA permission; approval |
| `runtimeExecutionAccessObjectRef` | Future AIA controlled read object | Automatic approval |

---

## 1. Exact application anchor contract

### `TetaExactApplicationAnchorAllowlistEntry`

Minimum:

- `allowlistEntryId`
- `candidateId`
- `applicationAnchorId`
- `applicationAnchorRef`
- `formGuid`
- `formClassIdentity`
- `assemblyIdentity`
- `productFamily`
- `productSurface`
- `businessArea`
- `sourceArtifactRef`
- `sourceArtifactFingerprint`
- `applicationAnchorFingerprint`
- `applicationVersion`
- `applicationBuildFingerprint`
- `assemblyFingerprint`
- `anchorVerificationStatus`: `verified_exact` | `supported_bounded` | `missing` | `stale` | `conflicting` | `not_evaluated`

Repo-safe docs may publish fingerprints; runtime policy/allowlist must point at the exact existing Stage 3A form node for P1.

**B3A must not start from:** form display name, word “pracownik”, class similarity, global GUID search, first Kadry form.

**Strict zeros:**  
`collectorStartedWithoutExactAnchor`, `anchorResolvedByNameSimilarity`, `anchorResolvedByGlobalGuidSearch`, `anchorFingerprintMismatchAccepted`, `staleAnchorUsedForCollection`.

P1 allowlist identity class (repo-safe): exact GUID-bound form node already accepted in Stage 3K.2B2B2A / foundation real-graph constants (`form:{guid}` → Stage 3A `application_form`). Semantic master remains the employee VIEW; form class may belong to a product surface that *uses* employee master data — form label alone never proves surface role.

---

## 2. Surface role classification

Extend `TetaApplicationAccessSurfaceCandidate` with:

- `surfaceRole`: `root_record_surface` | `child_collection_surface` | `lookup_surface` | `supporting_surface` | `filter_only_surface` | `action_surface` | `unknown`
- `surfaceRoleEvidenceStatus`: `proven_direct` | `supported_lineage` | `partial` | `unproven` | `conflicting` | `not_evaluable`
- `surfaceRoleEvidenceRefs[]`
- `surfaceRoleFingerprint`

Gateway/view names are not standalone role proof.

**Counters (separate):**  
`totalSurfaceCandidateCount`, `rootSurfaceCandidateCount`, `childSurfaceCandidateCount`, `lookupSurfaceCandidateCount`, `supportingSurfaceCandidateCount`, `unknownRoleCandidateCount`

| Root count | Semantics |
|-----------:|-----------|
| 0 | `no_root_candidates` |
| 1 | `single_root_candidate` (still no auto-approval) |
| >1 | `multiple_root_candidates` → `ambiguityStatus=ambiguous`, `selectionRequired=true` |

Lookups/child/supporting surfaces are **not** competing P1 roots.

**Strict zeros:**  
`lookupSurfaceCountedAsCompetingP1Root`, `childCollectionCountedAsCompetingP1Root`, `supportingSurfaceAutoSelectedAsRoot`, `unknownRoleAutoPromotedToRoot`.

---

## 3. Multi-object access surface

Replace singular `accessObjectRef` with `accessObjectRefs[]`:

Each element:

- `accessObjectRef`
- `accessObjectKind`
- `accessObjectRole`: `root_row_source` | `joined_required` | `lookup_only` | `filter_only` | `security_scope` | `package_mediated` | `unknown`
- `identityEvidenceStatus`
- `identityEvidenceRefs[]`
- `declaredByArtifactRef`
- `sourceLineageId`
- `fingerprint`

Optional:

- `rowProducingRootRef`
- `rowProducingRootEvidenceStatus`
- `rowProducingRootEvidenceRefs[]`

`rowProducingRootRef` only when explicit evidence exists from: ViewName, BaseTableName, verified gateway main source, verified SqlJoin main source, or other versioned root-source contract.  
First object / first join / most frequent name cannot define root.

`accessSurfaceFingerprint` covers the ordered set of access objects and roles.

**Strict zeros:**  
`multiObjectGatewayFlattenedToSingleObject`, `firstAccessObjectAutoSelectedAsRoot`, `joinedSourceDroppedFromCandidate`, `unknownObjectRoleReportedAsRoot`.

---

## 4. Versioned lineage path grammar

### `TetaApplicationSurfaceLineagePattern`

- `lineagePatternId`
- `lineagePatternVersion`
- `allowedNodeKinds[]`
- `allowedEdgeKinds[]`
- `requiredSteps[]`
- `optionalSteps[]`
- `terminalConditions[]`
- `patternFingerprint`

Registered example patterns:

- `form → datasource → gateway`
- `form → BO → gateway`
- `form → DF → gateway`
- `form → control → dataset → gateway`
- `form → datasource → BO → gateway`
- `form → datasource → DF → gateway`
- `form → datasource → BO/DF → gateway → declared access object`

`lineageCompletenessStatus=complete` means complete **relative to** `selectedLineagePatternId`.  
Do not require datasource+control+dataset+BO+DF simultaneously when the pattern does not use them.

Also: `selectedLineagePatternId`, `patternSelectionEvidenceRefs[]`, `lineagePatternSelectionStatus`.  
Pattern selection is not name-heuristic.

**Strict zeros:**  
`lineageRejectedOnlyBecauseOptionalNodeMissing`, `lineageMarkedCompleteWithoutRequiredPatternSteps`, `lineagePatternSelectedByNameHeuristic`, `unregisteredLineagePatternUsed`.

---

## 5. Bounded artifact locator

### `TetaBoundedArtifactLocator`

- `artifactFamily`
- `artifactManifestRef`
- `artifactFingerprint`
- `lookupMode`: `exact_id_index` | `exact_offset_manifest` | `exact_graph_node_lookup` | `exact_allowlisted_file_read` | `unavailable`
- `requestedIds[]` / `resolvedIds[]` / `missingIds[]`
- `recordsRead` / `bytesRead` / `indexLookups`
- `fullArtifactScanned` / `fallbackScanAttempted`
- `locatorStatus`: `resolved_exact` | `resolved_partial` | `requires_bounded_artifact_index` | `artifact_missing` | `stale` | `conflicting`

**Forbidden:** full Stage 2A–2E NDJSON read+filter; scanning all forms/gateways; building temporary global indexes in B3A; grep/name search.

**Allowed:** exact Stage 3A SQLite lookup; existing ID→offset manifest (if present); exact artifact ref from accepted anchor lineage; exact allowlisted DLL metadata file read.

Missing exact locator ⇒ `gapCode=requires_bounded_artifact_index`.

**Strict zeros:**  
`fullStage2ArtifactScans`, `fullNdjsonScansForExactAnchor`, `temporaryGlobalIndexesBuilt`, `artifactNameSearchFallbacks`, `artifactLocatorMissingButCollectionContinued`.

---

## 6. Identity and grain evidence inheritance

### `TetaApplicationSurfaceIdentityAssessment`

- `accessObjectRef`
- `identityStatus`: `inherited_verified_exact` | `supported_existing_artifact` | `requires_metadata_verification` | `stale` | `conflicting` | `not_evaluable`
- `identityEvidenceRefs[]`
- `identityFingerprint`
- `databaseIdentityFingerprint`
- `objectDefinitionFingerprint`

Inherit accepted Stage 3K.2B2B2B2 evidence **only** when access object is exactly `TETA_ADMIN.NT_KP_PRC_PRACOWNICY` / `VIEW` and fingerprints match (database, owner/name/type, view-definition, accepted evidence, policy, staleness vector).

Then: `masterRelation=same_object`, `grainCompatibilityStatus=inherited_proven`, evidence ref = accepted B2B2 evidence.

Any other object: identity at most `supported_existing_artifact` or `requires_metadata_verification`; grain `not_evaluable` / `requires_view_definition_evidence` / `requires_key_preservation_evidence` / `conflicting`.

**Forbidden inheritance bases:** similar columns, same base table, Stage 2E DEPENDS_ON alone, similar name, shared gateway.

**Strict zeros:**  
`p1GrainInheritedByDifferentObject`, `staleP1EvidenceInherited`, `stage2GraphIdentityReportedCurrentVerifiedExact`, `similarColumnsUsedAsSurfaceEquivalenceProof`, `baseDependencyUsedAsKeyPreservationProof`.

---

## 7. Current-slice vs future-runtime readiness

Three independent axes:

| Axis | Values |
|------|--------|
| `surfaceReconstructionReadiness` | `ready_for_review` \| `partial` \| `blocked_missing_artifact` \| `blocked_ambiguous_roots` \| `conflicting` \| `not_evaluated` |
| `semanticAttributionReadiness` | `ready_for_review` \| `supported_bounded` \| `partial` \| `blocked_missing_evidence` \| `conflicting` \| `not_evaluated` |
| `runtimeAccessReadiness` | `not_evaluated_out_of_scope` \| `blocked_missing_authorization` \| `blocked_semantic_gap` \| `blocked_grain_gap` \| `blocked_scope_gap` \| `ambiguous` \| `supported_bounded` \| `not_evaluated` |

**B3A default:** `runtimeAccessReadiness=not_evaluated_out_of_scope`.  
B3A does not set `runtimeExecutionAccessObjectRef` and does not set runtime suitability to `candidate` / `supported_bounded`.

Gap requests gain:

- `gapPhase`: `surface_reconstruction` | `semantic_attribution` | `runtime_authorization`
- `blockingForCurrentSlice`: boolean

`missing_runtime_authorization_context` in B3A: `gapPhase=runtime_authorization`, `blockingForCurrentSlice=false`.

**Strict zeros:**  
`runtimeAuthorizationGapBlockedSurfaceReconstruction`, `runtimeObjectSelectedInB3A`, `runtimeReadinessReportedSupportedInB3A`, `outOfScopeRuntimeGapReportedAsPilotFailure`.

---

## 8. Explicit bounds

Policy must define its own hashed bounds (not “inherited from enrichment” alone):

| Bound | Proposed start |
|-------|---------------:|
| `maxTraversalDepth` | 8 |
| `maxNodesVisited` | 120 |
| `maxEdgesVisited` | 240 |
| `maxSurfaceCandidates` | 24 |
| `maxRootSurfaceCandidates` | 8 |
| `maxArtifactReads` | 64 |
| `maxBytesReadPerArtifactFamily` | 8_388_608 |

Rationale: slightly above Stage 3K.2B2B2A enrichment caps (4/80/160/20) because B3A may traverse form→datasource→BO/DF→gateway→access-object steps and multi-object gateway members, while remaining fail-closed and exact-anchored. Depth 8 covers registered lineage patterns without free graph search.

Audit reports `configured*` and `observed*`; require `observed ≤ configured`.

**Strict zeros:**  
`implicitBoundsInheritedWithoutPolicy`, `collectorExceededDepthBound`, `collectorExceededNodeBound`, `collectorExceededEdgeBound`, `collectorExceededCandidateBound`, `collectorExceededArtifactReadBound`.

---

## 9. Candidate deduplication without evidence loss

Canonical candidate key:

```
applicationAnchorFingerprint
+ lineagePatternId
+ canonical gateway identity
+ ordered accessObjectRefs and roles
+ surfaceRole
+ applicability fingerprint
```

Stage 2B gateway and its Stage 2E/3A copy = one candidate with multiple `candidateOccurrenceRefs[]`, not two candidates.

Also: `deduplicationStatus`, `deduplicationFingerprint`.  
Never remove occurrence/provenance; never collapse different roles.

**Strict zeros:**  
`derivedGraphCopyCountedAsSeparateCandidate`, `sameGatewayCandidateDuplicatedAcrossStages`, `candidateDeduplicationRemovedEvidenceRefs`, `candidateDeduplicationCollapsedDifferentRoles`.

---

## 10. Active graph immutability contract

B3A uses Stage 3A read-only. Audit before/after:

- `activeGraphPointerBefore/After`
- `baseGraphHashBefore/After`
- `baseGraphFileSha256Before/After`
- `baseGraphFileSizeBefore/After`
- `graphWriteAttempts=0`
- `graphMutationAttempts=0`

Required unchanged pointer/hash/file SHA/size.

**Strict zeros:**  
`activeGraphPointerChanges`, `activeGraphContentHashChanged`, `activeGraphFileShaChanged`, `activeGraphFileSizeChanged`, `stage3aGraphWrites`.

---

## Proposed contracts (complete list)

- `TetaExactApplicationAnchorAllowlistEntry`
- `TetaApplicationAccessSurfaceCandidate` (with surfaceRole + accessObjectRefs[])
- `TetaApplicationSurfaceLineage`
- `TetaApplicationSurfaceLineagePattern`
- `TetaBoundedArtifactLocator`
- `TetaApplicationSurfaceEvidenceAssessment`
- `TetaApplicationSurfaceIdentityAssessment`
- `TetaSemanticAttributionAssessment`
- `TetaRuntimeExecutionAccessAssessment` (B3A: out of scope / not evaluated)
- `TetaApplicationSurfaceGapRequest` (with gapPhase + blockingForCurrentSlice)
- `TetaApplicationSurfaceReviewPack`
- `TetaApplicationSurfaceStalenessVector`

---

## Allowed offline evidence / prohibited acquisition

Unchanged from base design: Stages 2A–2E, 3A (read-only exact), 3K.2B2B2A anchors, 3K.2B2B2B2 accepted source evidence, exact allowlisted DLL metadata file reads.  
No full DLL/Oracle rescan, model, RAG, Qdrant, OCR, free shortest-path.

---

## Semantic attribution / master relations / human role / legal outcomes

Unchanged core rules from base design, with root-role semantics applied: attribution targets **root** surfaces; lookups/child/supporting are inventoryed but not competing roots.  
Legal outcomes A–H remain non-approving.

---

## Policy design (future file created in B3A implementation)

- Path: `apps/api/config/teta-application-access-surface-evidence-policy-v1.json`
- Version: `teta-aia-application-access-surface-evidence-policy-v1`

Must include: exact P1 allowlist + anchor fingerprints, registered lineage patterns, artifact families, explicit bounds, role rules, dedup rules, identity/grain inheritance, readiness separation, gap blocking phases, staleness, strict invariants.

---

## First implementation slice (B3A)

**Identifier:** `stage3k2b2b2b3a_p1_candidate_scoped_application_surface_reconstruction_pilot`

Implements: exact anchor allowlist, bounded locators, registered patterns, lineage collector, candidate inventory + roles + multi-object surfaces, dedup, zero/one/many **root** semantics, same-object inheritance gate, attribution preview, readiness axes, gap requests, review pack, strict audit, active graph immutability.

Does **not** implement: Oracle/SQL, DLL rescan, full artifact scans, model/RAG/Qdrant, P1 approval, reuse mutation, runtime object selection, authorization collector, planner, P2–P7.

---

## Design status

| Field | Value |
|-------|-------|
| Stage 3K.2B2B2B3 | `not_started` |
| stage3k2b2b2b3Readiness | `ready_for_bounded_p1_application_surface_reconstruction_review` |
| nextImplementationSlice | `stage3k2b2b2b3a_p1_candidate_scoped_application_surface_reconstruction_pilot` |
| started / implemented / accepted / approved / planning_ready | **not set** until after design commit + separate B3A review |

---

## Outputs

- `docs/AIA_STAGE3K2B2B2B3_P1_APPLICATION_SURFACE_DESIGN.md`
- `docs/AIA_STAGE3K2B2B2B3_P1_APPLICATION_SURFACE_DESIGN.json`
- `docs/session-context.md`
