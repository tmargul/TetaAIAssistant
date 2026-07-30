# Stage 3J.2E — Review, Approval & Evidence Governance

Status: **ready_for_human_pilot_decision** (mechanism complete; real decisions not yet applied)

Patch: **human decisionability** (registry evidence, pack narrowing, decisionabilityStatus).

Stage 3J.2D input: acceptance overlap correlation manifest (aggregates only in repo docs).

## Scope

Stage 3J.2E turns Stage 3J.2D proposed records, relation decisions, clusters, review tasks, evidence refs, and golden question coverage into a controlled human review workflow:

1. Deterministic review queue with priority scoring
2. Immutable review packs with stale guards + decisionability
3. Explicit human decision events (append-only ledger)
4. Approved knowledge records (separate from proposed records)
5. Supersession / revocation
6. Approved question coverage (separate from candidate coverage)

## Non-goals (this iteration)

- No real human decisions applied (`realDecisionEventsApplied = 0`)
- No real approved records created (`realApprovedRecordsCreated = 0`)
- No auto-approval
- No Stage 3K / RAG / Qdrant / embeddings / models / OCR / Oracle / SQL
- No modification of Stage 3J.2C batches or Stage 3J.2D correlation runs

## Decisionability

Each real pack carries:

- `decisionabilityStatus`: `ready_for_decision` | `ready_for_scoped_decision` | `requires_pack_narrowing` | `requires_more_evidence` | `invalid_for_decision`
- proposed / unsupported claims
- single human decision question
- system recommendation (not a decision event; does not fill templates)

Aggregates (local): ready_for_decision=1; ready_for_scoped_decision=3; requires_more_evidence=3; invalid=0; packsWithoutSingleHumanDecision=0.

## Registry evidence

Authoritative registry anchors are first-class evidence (`evidenceKind=authoritative_registry_anchor`). Registry approvals without registry evidence = 0. Registry claims beyond evidence scope = 0.

## Contracts

- `teta-review-task-v1`
- `teta-review-pack-v1`
- `teta-approval-decision-event-v1`
- `teta-approval-decision-template-v1` (template ≠ event)
- `teta-approved-knowledge-record-v1`
- `teta-approved-question-coverage-v1`
- `teta-decision-ledger-manifest-v1`
- `teta-approval-stage-manifest-v1`

## Decision kinds

`approve` | `approve_with_scope` | `approve_merged_record` | `approve_as_variants` | `approve_supported_subset` | `reject` | `defer` | `request_more_evidence` | `supersede` | `revoke` | `close_gap_as_no_evidence`

## Real pilot packs (aggregates)

| Case | Kind | Decisionability (agg.) |
|------|------|-------------------------|
| RP01 | scope_review | ready_for_scoped_decision (registry evidence) |
| RP02 | record_approval | ready_for_scoped_decision (narrowed employment subset) |
| RP03 | variant_review | requires_more_evidence when single-product only |
| RP04 | merge_review | ready_for_decision (exact; same-source ≠ independent corroboration) |
| RP05 | merge_review | ready_for_scoped_decision (semantic merge needs scope) |
| RP06 | variant_review | requires_more_evidence (single decision question) |
| RP07 | evidence_gap | requires_more_evidence (no approve) |

Counts (local store only):

- review tasks queued: 100 (from Stage 3J.2D acceptance)
- real review packs: 7
- real decision templates: 7
- real decision events applied: **0**
- real approved records: **0**

## Synthetic fixtures

Fixtures A–T cover approval, scope, variants, ME registry, client/historical/regulatory safeguards, reject/defer/evidence request, conflict, stale pack, ledger chain/tamper/idempotency, supersede/revoke, unsupported gap, supported subset, and missing confirmation.

## CLI

```bash
pnpm --filter @teta/api run knowledge-approval:stage3j2e -- validate-config
pnpm --filter @teta/api run knowledge-approval:stage3j2e -- build-review-queue --input "<3j2d-acceptance-manifest>" --output ".local/teta-knowledge/stage3j2e"
pnpm --filter @teta/api run knowledge-approval:stage3j2e -- build-pilot-review-packs --input "<3j2d-acceptance-manifest>" --output ".local/teta-knowledge/stage3j2e"
pnpm --filter @teta/api run knowledge-approval:stage3j2e -- audit --strict
```

`apply-decision` requires `--decision-file --reviewer-id --reviewer-role --confirm-human-decision`. Flag `--yes` is forbidden. Git config identity is not used. This iteration blocks apply on real pilot packs.

## Safeguards (must stay 0)

- Teta Edu approved as Teta HR
- Teta ME approved as standalone domain
- client-specific → global
- historical → current
- unresolved conflict auto-resolve
- merge with unresolved semantic scope applied without scopeDecision
- approve_as_variants without both product sides
- approval on evidence-gap packs

## Verification (aggregates)

- Stage 3J.2E tests: **923/923**
- Fixtures A–T: **20/20**
- `strictErrors`: `[]`
- Stage 3K: **not_ready** (`no_real_approved_records_yet`)
