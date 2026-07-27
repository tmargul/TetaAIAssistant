# AIA — Stage 3G Canonical Chat Report Delivery

> Generated 2026-07-27T14:32:57.277Z. Metadata only — no employee rows, tokens, or SQL.

## Scope

- First supported chat route: occupational health examinations ending this month
- Pipeline: Stage 3B → 3D → 3C → 3E → 3F
- Stage 3G v1 is an **admin/vendor** route; full data authorization is a later stage
- Download: in-memory hashed token, TTL 15 minutes, max 3 downloads
- No raw SQL endpoints; no compiledSelect from browser; no legacy Oracle agent fallback for matched BHP route

## offlineAudit

| Metric | Value |
|---|---|
| referencesTested | 6 |
| referencesPassed | 6 |
| canonicalRoutesRejectedByAuth (Reference B) | 1 |
| oracleConnectionsOpened | 0 |
| businessStatementsExecuted | 0 |
| chatReportRowsPersisted | 0 |
| chatReportTokensPersisted | 0 |

### References

- **registry-version**: OK — teta-aia-chat-report-routes-v1
- **route-bhp-admin**: OK — occupational_health_examinations_current_month
- **route-bhp-user-denied**: OK — canonical_report_not_authorized
- **trusted-approval**: OK — Trusted Stage 3G chat report route approved a single read-only SELECT: no write, no commit, no DDL, no PL/SQL.
- **download-registry**: OK — hash-only
- **persistence-redaction**: OK — dataExpired

## livePipelineAudit

| Metric | Value |
|---|---|
| chatRequestsReceived | 1 |
| canonicalRoutesMatched | 1 |
| canonicalPipelineExecutions | 1 |
| stage3bCalls / stage3bReady | 1 / 1 |
| stage3dResolutions | 1 |
| stage3cCalls / stage3cPlansReady | 1 / 1 |
| stage3eCalls / stage3eStatementsCompiled | 1 / 1 |
| stage3fCalls / stage3fExecutions | 1 / 1 |
| reportsCompletedEmpty | 1 |
| authorizationAccepted | 1 |
| canonicalRoutesRejectedByAuth | 0 |
| oracleConnectionsOpened / Closed | 1 / 1 |
| businessStatementsExecuted | 1 |
| downloadTokensIssued | 1 |

### Pipeline trace

```json
{
  "traceId": "685ece81-26bb-4551-9314-3a20e6b515b2",
  "requestReceived": true,
  "routeResolution": {
    "stage3bCalled": true,
    "stage3bStatus": "ready",
    "intent": "build_employee_report",
    "subject": "occupational_health_examinations",
    "routeMatched": true,
    "routeId": "occupational_health_examinations_current_month",
    "authorized": true
  },
  "pipeline": {
    "stage3dResolved": true,
    "stage3cCalled": true,
    "stage3cStatus": "ready_for_compilation",
    "stage3eCalled": true,
    "stage3eStatus": "compiled",
    "stage3fCalled": true,
    "stage3fStatus": "completed_empty"
  },
  "delivery": {
    "responseMapped": true,
    "xlsxGenerated": true,
    "downloadRegistered": true
  },
  "integrity": {
    "directCanonicalRouteBypassDetected": false,
    "prebuiltPlanUsedByStage3g": false,
    "precompiledSqlUsedByStage3g": false
  }
}
```

- **live-reference-a**: OK — completed_empty 0x8 oracle 1/1

## liveDownloadAudit

| Metric | Value |
|---|---|
| downloadRequests | 1 |
| downloadsSuccessful | 1 |
| downloadsExpired | 0 |
| downloadOwnerMismatches | 0 |
| downloadsTriggeringOracle | 0 |
| downloadsRegeneratingXlsx | 0 |
| downloadShaMatches | true |
| responseBytesSha256 | 4c67a880647961eb89a7d82b41d232bd119460ef57e88fdcef2e1e05552b850e |

### Registry lifecycle

| Stage | activeEntries |
|---|---|
| afterRegistration | 1 |
| afterFirstDownload | 1 |
| successfulDownloadsForEntry | 1 |
| afterAuditCleanup | 0 |
| buffersRemovedDuringAuditCleanup | 1 |

- **live-download-endpoint**: OK — endpoint 1/1 sha ok

## uiAudit

| Metric | Value |
|---|---|
| source | not_measured |
| uiLiveSmoke | not_measured |
| reportCardsRendered | not_measured |
| downloadButtonsRendered | not_measured |
| helperTestsPassed | not_measured |

## testResults

| Metric | Value |
|---|---|
| source | jest_json |
| stage3gTestsExecuted | 139 |
| stage3gTestsPassed | 139 |
| stage3gTestsFailed | 0 |

## consistencyInvariants

- **chatRequestsReceivedConsistent**: true
- **matchedRoutesNotExceedRequests**: true
- **pipelineExecutionsNotExceedMatchedRoutes**: true
- **stageCallChainComplete**: true
- **stage3fExecutionsNotExceedStage3eCompiled**: true
- **businessStatementsNotExceedStage3fExecutions**: true
- **downloadSuccessNotExceedRequests**: true
- **liveReferencesNotMixedWithOfflineReferences**: true
- **runtimeTestCountersNotConfusedWithReferences**: true
- **uiMetricsSourceValid**: true
- **noDirectCanonicalRouteBypass**: true
- **noPrebuiltPlanUsedByStage3g**: true
- **noPrecompiledSqlUsedByStage3g**: true

## strictErrors

[]
