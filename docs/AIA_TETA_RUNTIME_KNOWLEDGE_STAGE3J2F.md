# Stage 3J.2F — Runtime Knowledge Retrieval, Source Visibility & Answer Grounding

Status: **ready_for_runtime_model_smoke** (committed; awaiting real runtime model smoke)

`nextStage`: **3J.2F_runtime_model_smoke**

## Summary

Stage 3J.2F enables AIA runtime use of:

1. approved canonical knowledge (Stage 3J.2E);
2. source-backed direct/partial evidence (not promoted to approved);
3. authorized client materials;
4. public authority sources;

with a hard Vendor-hidden citation policy and claim-level grounded answers.

## Carry-forward

| Stage | Status |
|-------|--------|
| 3J.2E | completed — feature `5db7a9a`, human pilot docs `613f929`; decisions=7; approved registry=1; approved content=0; `human_pilot_completed_with_limited_approval` |
| 3J.2F | **ready_for_runtime_model_smoke**; core committed; `realLocalModelCalls=0`; Vendor sources hidden; client/public citations controlled; approved + source-backed runtime |
| 3K | **not_started** / readiness **not_ready** (`stage3j2f_runtime_model_smoke_not_completed`) |

## Accepted aggregates

| Metric | Value |
|--------|------:|
| approved canonical units | 1 |
| source-backed evaluated | 800 |
| source-backed direct | 261 |
| source-backed partial | 69 |
| source-backed blocked | 470 |
| vendor / client / public units | 331 / 5 / 3 |
| hidden / cite_exact / cite_when_relevant | 331 / 6 / 2 |
| vendor runtime + audit packs | 1 + 1 |
| index documents | 339 |

Blocked reasons: source_policy 221, unknown_scope 158, fragment 81, heading_only 10.

Pack leak counters and cross-product/tenant/stale retrieval leaks: **0**.

## Knowledge modes

- `approved_canonical`
- `source_backed_direct`
- `source_backed_partial`
- plus blocked/insufficient runtime statuses (`blocked_by_scope`, `blocked_by_conflict`, `blocked_by_currentness`, `blocked_by_access_policy`, `insufficient_knowledge`)

## Source policy dimensions

- `sourceOwnership`: vendor | client | public_authority | unknown
- `sourceVisibility`: hidden | cite_exact | cite_when_relevant
- `citationPolicy` / `quotePolicy` / `distributionClass`

### Vendor (always)

`hidden` + `citation=forbidden` + `quote=forbidden`. Natural answers. No Vendor source cards, titles, paths, evidence IDs, or self-referential source phrases in client payloads or model context.

### Client

Normative: `cite_exact` + required citation when authorized. Analysis: `cite_when_relevant`. Unauthorized client knowledge is not retrieved and not used (including hidden prompt context). Tenant isolation is mandatory.

### Public authority

`cite_exact` + required citation; currentness must be verified for “current law” claims. Vendor knowledge does not confirm current law.

## Pack separation

- **Vendor runtime pack** — sanitized claims only (client-safe)
- **Vendor audit pack** — full provenance, `.local` only, CLI `--confirm-vendor-audit`

## Module / CLI

- Module: `apps/api/src/teta-runtime-knowledge/`
- CLI: `pnpm --filter @teta/api run knowledge-runtime:stage3j2f -- <cmd>`
- Commands: `validate-config`, `build-runtime-packs`, `build-index`, `retrieve`, `build-answer-plan`, `render-fixture-answer`, `explain-internal-trace`, `run-pilot`, `audit --strict`
- Optional `smoke-local-model` is gated and **not executed** in core (`realLocalModelCalls=0`)

## Real pilot RF01–RF05

| Case | Result |
|------|--------|
| RF01 Q21 Teta ME | `approved_canonical`, answerable, `visibleSources=[]` |
| RF02 Q07 Edu auth | `insufficient_knowledge`, no full Edu auth procedure, `visibleSources=[]` |
| RF03 Q08 HR vs Edu | `blocked_by_scope` (missing HR evidence ≠ difference), `visibleSources=[]` |
| RF04 Q14 KSeF | `blocked_by_currentness`, `visibleSources=[]` |
| RF05 | `source_backed_direct`, answerable, natural answer, complete internal trace, `visibleSources=[]` |

## Fixtures

A–R: **18/18** (Vendor leak, self-reference, client/public citations, tenant isolation, injection, config/legal safety).

## Verification

- Stage 3J.2F tests: **302/302**
- Regressions: 3J.2E 923, 3J.2D 812, 3J.2C 382, 3J.2B 235, 3J.2A 180, 3J.1 271, 3J 161
- API/web build: EXIT 0
- `audit --strict`: `strictErrors=[]`

## Boundaries (strict = 0)

No raw DOC/PDF/MP4 reads, no ledger mutations, no Qdrant/embeddings/OCR/Oracle/SQL/formula/auto-approval, no Stage 3K, no real local model calls in core.

## Repo privacy

Repo docs contain aggregates/contracts only — no real Vendor titles/paths/excerpts, no reviewer IDs, no absolute paths.
