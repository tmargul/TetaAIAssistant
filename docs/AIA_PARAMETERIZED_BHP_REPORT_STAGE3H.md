# AIA — Stage 3H Parameterized BHP Report Periods

> Generated 2026-07-27T16:46:49.103Z. Metadata only — no employee rows, tokens, or SQL with user dates.

## Scope

- Parameterized BHP routes: current_month, next_month, next_n_days, explicit_date_range
- Trusted Oracle binds (:P001/:P002) — user dates never inlined into sqlText
- Pipeline: Stage 3B → 3D → 3C → 3E → 3F → 3G delivery
- Period missing/ambiguous/invalid clarifies without Oracle

## offlineAudit

| Metric | Value |
|---|---|
| referencesTested | 21 |
| referencesPassed | 21 |
| currentMonthZeroBinds | 1 |
| nextMonthCompiled | 1 |
| nextNDaysSingleBind | 1 |
| explicitRangeDualBind | 1 |
| userDatesEmbeddedInSqlText | 0 |
| bindValuesInterpolatedIntoSql | 0 |
| fingerprintDiffersForDifferentDays | 1 |
| periodRejectedWithoutOracle | 5 |
| llmCalls / qdrantCalls / legacyAgentCalls | 0 / 0 / 0 |

### sqlSha256ByPeriodKind

- **current_month**: `dda844dc9e3d0ef2d63591ff4f9d44a827d3d53034c0babbde6bafdf696de4b4`
- **next_month**: `55199105edd7c3ef0c3675620689f001aaa0c329e0c7e5e80ad586fc36f69b28`
- **next_n_days**: `af8bc13ae917ecfb754d382a35677176a7178193c25c9b981d1ee0666c6c2360`
- **explicit_date_range**: `4ddf419d5f6b60ad014e3f7754a6319753cb22b3821afd547befdeb0fe0506f9`

### References

- **registry-four-period-routes**: OK — teta-aia-chat-report-routes-v1
- **period-current-month**: OK — current_month
- **compile-current-month-zero-binds**: OK — binds=0
- **period-next-month**: OK — next_month
- **compile-next-month**: OK — ADD_MONTHS offsets
- **period-next-n-days**: OK — next_n_days
- **compile-next-n-days-p001**: OK — :P001
- **period-explicit-range**: OK — explicit_date_range
- **compile-explicit-range-binds**: OK — P001/P002 no literals
- **sqlSha256-differs-by-period-kind**: OK — current vs rolling
- **sqlSha256-stable-for-same-kind**: OK — rolling template stable
- **fingerprint-differs-for-different-days**: OK — P001 10 vs 11
- **bind-tampering-rejected**: OK — invalid_execution_bind
- **reject-zero-days**: OK — invalid
- **reject-reversed-range**: OK — invalid
- **reject-too-many-days**: OK — invalid
- **reject-ambiguous**: OK — ambiguous
- **reject-missing**: OK — missing
- **parameterized-exec-offline-fake**: OK — completed_empty
- **route-current-month-admin**: OK — occupational_health_examinations_current_month
- **persistence-redaction**: OK — rows/token null

## liveAudit

### live-current-month

| Metric | Value |
|---|---|
| periodKind | current_month |
| status | completed_empty |
| rowCount / columnCount | 0 / 8 |
| sqlSha256 | 7b86576c4228e4858d4edfbac0d98c59c4d5f8f1d2aa3e7ed678cbb98c1bc691 |
| executionFingerprintSha256 | c3c2bdb1a7be4e61c5a07983340dd945dad157854bd4df885cc554c0641240eb |
| bindDefinitionsRequired | 0 |
| bindValuesValidated | 0 |
| parameterizedStatementsExecuted | 0 |
| oracle opened/closed | 1 / 1 |
| downloadShaMatches | true |
| reference | OK — completed_empty 0x8 oracle 1/1 |

### live-date-range

| Metric | Value |
|---|---|
| periodKind | explicit_date_range |
| status | completed_empty |
| rowCount / columnCount | 0 / 8 |
| sqlSha256 | b62ab1e52c5a0b1954be034d7f055653f020f817562f218145757487a00672ab |
| executionFingerprintSha256 | 67a4edb33b07e0a3a5a43efc67e64735f048f00f5d391bb387a5e54159b35933 |
| bindDefinitionsRequired | 2 |
| bindValuesValidated | 2 |
| parameterizedStatementsExecuted | 1 |
| oracle opened/closed | 1 / 1 |
| downloadShaMatches | true |
| reference | OK — completed_empty 0x8 oracle 1/1 |

## strictErrors

[]
