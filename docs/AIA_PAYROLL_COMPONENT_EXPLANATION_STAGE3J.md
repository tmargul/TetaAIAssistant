# AIA — Stage 3J Payroll Component Explanation

> Generated 2026-07-28T17:49:39.040Z. Metadata only — no formulas, SQL, or customer names.

## Scope

- Static explanation of payroll **components** from Stage 3I snapshot (RTF import)
- Deterministic selector, formula plain-language steps, dependency/impact graph
- **No** formula/SQL execution, Oracle, LLM, Qdrant, employee payroll values
- Local golden RTF (`SKLADNIKI_DOMAN.rtf`) is `customer_example` only — never git

## Audit semantics

- **runtimeAudit** — instrumented service counters from real audit execution
- **referenceAudit** — audit scenario pass/fail counts (A–J + jest)
- Reference execution may also increment runtimeAudit when invoking real services

## Runtime audit (selected)

| impactTraceRequests | 4 |
| directDependentsReturned | 19 |
| snapshotRequiredResponses | 1 |
| componentNotFoundResponses | 1 |
| ambiguousSelections | 1 |
| ambiguousComponentResponses | 1 |
| customerConfigurationCodesExposedInRepoArtifacts | 0 |
| cyclesDetected | 1 |
| unknownFunctionsPreserved | 2 |
| calculationFormulaUsesReturned | 5 |
| guaranteedImpactClaimsMade | 0 |
| deterministicFingerprintCheckOk | 1 |

## Privacy counters (must be 0)

| rawComponentFormulasPersisted | 0 |
| calculationFormulasPersisted | 0 |
| sqlFormulasPersisted | 0 |
| rawFormulasLogged | 0 |

### verification (jest runner)

| stage3jTests | 161/161 (failed 0) |
| regression 3B–3I | 781/781 (failed 0) |
| referenceAudit passed | 13/13 |

## Golden metadata

| reportGeneratedAt | 2020-05-22 |
| kpVersion / paVersion | 27.61.099494 / 27.61.099393 |
| componentCount | 1037 |
| fileSha256 (prefix) | `434d8ba4e870…` |
| semanticsCatalogVersion | teta-payroll-component-semantics-v1 |
| strictErrors | [] |

### Required references A–J

- **stage3j-snapshot-required**: OK — snapshot_required
- **golden-full-explanation-1353**: OK — status=completed_with_warnings;deps=1350,1351,1352;fp=02295edee307
- **golden-impact-1350**: OK — containsRequiredDependents=1353,1355;directDependentCount=14;impactTraceRequests=2
- **golden-leading-zero-code-0010**: OK — 0010=0010;10=null;suggested=0010
- **stage3j-component-not-found**: OK — component_not_found
- **stage3j-calculation-formula-use**: OK — uses=5;refHash=76a50887d8f1
- **stage3j-unsupported-capability**: OK — capability_not_available
- **stage3j-ambiguous-component-title**: OK — status=ambiguous_component;candidates=2
- **stage3j-dependency-cycle**: OK — cycles=1;truncated=false
- **stage3j-unknown-function**: OK — unknownCalls=1;diag=true
- **stage3j-jest**: OK — 161/161 passed, failed=0

## Side effects (strict)

Oracle / LLM / Qdrant / embeddings / formula execution / SQL execution / raw formula logging / DOMAN fallback / legacy agent fallback = **0**.

## CLI

```bash
pnpm --filter @teta/api run payroll-explanation:stage3j -- explain --code 1353
pnpm --filter @teta/api run payroll-explanation:stage3j -- dependencies --code 1353 --depth 5
pnpm --filter @teta/api run payroll-explanation:stage3j -- impact --code 1350
pnpm --filter @teta/api run payroll-explanation:stage3j -- search --query premia
pnpm --filter @teta/api run payroll-explanation:stage3j -- audit --strict
```

## Out of scope

Employee payroll values, component design, comparison, payroll calculation, Oracle formula execution.
