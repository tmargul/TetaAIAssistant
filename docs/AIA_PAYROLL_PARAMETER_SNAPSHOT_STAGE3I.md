# AIA — Stage 3I Payroll Parameter Snapshot

> Generated 2026-07-28T09:54:10.170Z. Metadata only — no formulas, SQL, or customer names.

## Scope

- Import Teta RTF: **Wydruki → Płace → Wydruk parametrów płacowych**
- Deterministic parse + dependency graph; **no** formula/SQL execution, Oracle, LLM, Qdrant
- Local golden RTF (`SKLADNIKI_DOMAN.rtf`) is `sourceScope=customer_example` only — never git, never default, never fallback
- Stage 3I does **not** explain employee values, run payroll, or design new components (Stage 3J+)

## Architecture

| Layer | Role |
|---|---|
| `TetaPayrollRtfTextExtractor` | Safe RTF → text (CP1250, tables; no Word/LibreOffice) |
| Report detector | Content evidence → `valid_payroll_parameters_report` / reject |
| Section inventory | TOC vs body reconciliation (26/26/26 golden) |
| Formula tokenizer/parser | AST + unknown tokens; never `eval` |
| Dependency extractor | Direct/transitive graph; cycles reported, not rejected |
| SQLite repository | Transactional snapshot; idempotent by `installationScopeId+fileSha256` |
| Chat gate | Client config questions require active snapshot; generic knowledge passes |

## Audit counters

### apiUploadAudit (real `importBuffer` only)

| uploadRequests | 4 |
| uploadsAccepted | 4 |
| uploadsRejected | 0 |
| uploadsAlreadyImported | 2 |
| uploadsActivated | 1 |
| uploadsInactive | 1 |
| invariant accepted+rejected=requests | true |

> `uploadsAccepted` **includes** `already_imported` (subset tracked in `uploadsAlreadyImported`).

### validationReferenceAudit (`validateOnly` — not uploads)

| malformedRtfReferences | 1 |
| wrongReportReferences | 2 |
| invalidSignatureReferences | 1 |
| incompleteReportReferences | 1 |
| limitRejectionReferences | 0 |

### verification (jest runner — not references)

| stage3iTests | 136/136 (failed 0) |
| regression 3B–3H | 645/645 (failed 0) |
| referencesPassed | 23/23 |

## Golden metadata

| detectionStatus | valid_payroll_parameters_report |
| reportGeneratedAt | 2020-05-22 |
| kpVersion / paVersion | 27.61.099494 / 27.61.099393 |
| toc/body/matched | 26/26/26 |
| componentCount | 1037 |
| componentFormulaCount | 776 |
| calculationFormulaCount | 81 |
| sqlFormulaCount | 60 |
| directDependencies | 2136 |
| fileSha256 (prefix) | `434d8ba4e870…` |
| parserVersion | teta-payroll-report-parser-v1 |
| strictErrors | [] |

### Known dependency checks (codes only)

| Component | Direct deps |
|---|---|
| 1350 | 1346, 1348 |
| 1353 | 1350, 1351, 1352 |
| 1355 | 0010, 0300, 1338, 1350 |
| 1353 transitive | includes 1346, 1348 |

### References

- **chat-ref-a-snapshot-required**: OK — snapshot_required
- **chat-ref-d-generic**: OK — generic_payroll_knowledge
- **golden-fixture-present**: OK — present
- **golden-extract**: OK — chars=284602
- **golden-detection**: OK — valid_payroll_parameters_report
- **golden-import**: OK — imported
- **golden-deps-1350**: OK — direct=1346,1348
- **golden-deps-1353**: OK — direct=1350,1351,1352
- **golden-deps-1355**: OK — direct=0010,0300,1338,1350
- **golden-transitive-1353**: OK — transitive_has_1348_1346
- **golden-idempotent**: OK — already_imported
- **chat-ref-b-active**: OK — component_summary
- **chat-ref-c-missing**: OK — component_not_found
- **golden-section-reconciliation**: OK — toc=26 body=26 matched=26
- **golden-calculation-formulas**: OK — calculationFormulaCount=81
- **synthetic-valid-import**: OK — older_report_requires_activation
- **synthetic-idempotent**: OK — already_imported
- **malformed-rejected**: OK — malformed_rtf
- **wrong-report-rejected**: OK — unsupported_rtf_report
- **incomplete-rejected**: OK — incomplete_payroll_parameters_report
- **invalid-extension-rejected**: OK — unsupported_rtf_report
- **stage3i-jest**: OK — 136/136 passed, failed=0
- **regression-jest-3b-h**: OK — 645/645 passed, failed=0

## Side effects (strict)

Oracle / LLM / Qdrant / embeddings / formula execution / SQL execution / raw report logging / DOMAN fallback / legacy agent fallback = **0**.

## CLI

```bash
pnpm --filter @teta/api run payroll-snapshot:stage3i -- validate --file .local/fixtures/payroll/SKLADNIKI_DOMAN.rtf
pnpm --filter @teta/api run payroll-snapshot:stage3i -- import --file .local/fixtures/payroll/SKLADNIKI_DOMAN.rtf
pnpm --filter @teta/api run payroll-snapshot:stage3i -- status
pnpm --filter @teta/api run payroll-snapshot:stage3i -- inspect-component --code 1353
pnpm --filter @teta/api run payroll-snapshot:stage3i -- trace-dependencies --code 1353 --depth 5
pnpm --filter @teta/api run payroll-snapshot:stage3i -- audit --strict
```

## UI

**Ustawienia → Parametryzacja płac** — status snapshotu + upload RTF (admin/vendor).

## Out of scope (Stage 3J+)

Full business explanation of components, analogous component design, payroll calculation, Oracle formula execution.
