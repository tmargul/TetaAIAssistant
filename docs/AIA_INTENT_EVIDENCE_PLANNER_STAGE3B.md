# AIA Intent & Evidence Planner — Stage 3B

Wygenerowano: **2026-07-24T18:51:00.435Z**
contractVersion: `teta-aia-evidence-plan-v1`
plannerConfigVersion: `teta-aia-planner-config-v1`

## Architektura

- Moduł: `apps/api/src/teta-planner/`
- Konfiguracje: `apps/api/config/teta-*-v1.json`
- Klient Stage 3A: `CanonicalGraphResolverService` (bez NDJSON, bez własnego rankingu)
- **Bez** SQL gen / SQL exec / XLSX / Qdrant / embeddingów / LLM / agenta / Oracle write

## Kontrakt

- Request: `TetaPlanningRequest`
- Plan: `TetaEvidencePlan` (`teta-aia-evidence-plan-v1`)
- Statusy: ready | needs_clarification | ambiguous | unsupported | invalid

### Semantyka `planningStatus`

- **ready** — komplet encji użytkownika; plan może przejść do kolejnego etapu zbierania dowodów. **Nie** oznacza zgody na generowanie/wykonanie SQL.
- **needs_clarification** — użytkownik musi podać brakującą informację (np. formularz dla pola).
- **ambiguous** — równorzędni kandydaci wymagają wyboru (z `candidateIds`).
- **unsupported** / **invalid**

## Stage 3B.1 — Graph-scoped evidence resolution

### Diagnoza `graphResolved=0` (przed patchem)

{
  "rootCause": "Stage 3B previously called resolveForm(nameFragment) on Polish display titles that live on plugin_registry_entry, not application_form; then resolveField without formNodeId searched help_field+ui_control+action_control globally and applied the same ambiguous result to every evidence type including action_parameter.",
  "stage3b1Fix": [
    "resolve form via GUID or plugin_registry_entry → GUID/className → resolveForm",
    "resolveField only with formNodeId when form known",
    "skip global field search when form missing; emit field_scope_missing + clarification",
    "mark action_parameter not_applicable for ordinary data fields",
    "import tables: businessTarget + canonicalCandidates + selectionRequiredBeforeExecution",
    "report subjects: config graphSearchTerms queried through Stage 3A"
  ],
  "evidenceContractPatch": [
    "selectedNodeId must match evidenceType node type (help_document ≠ form)",
    "resolved requires selectedNodeId | selectedNodeIds | path",
    "field bindings/columns only from help_field/control path, not whole form subgraph",
    "lookup only when BINDS_LOOKUP; honest missing/not_applicable over fake resolved"
  ]
}

### Zachowanie po patchu

1. Formularz: GUID → albo `plugin_registry_entry` (polska nazwa PA) → GUID/className → `resolveForm`.
2. Pole: tylko z `formNodeId` (`scopedFieldQueries`); bez formularza — `field_scope_missing` + pytanie, **bez** globalnego multi-type search.
3. `action_parameter=not_applicable` dla zwykłego pola danych.
4. Import: `businessTarget` + `canonicalCandidates` + `selectionRequiredBeforeExecution` (bez auto-owner).
5. Raport BHP: `graphSearchTerms` z konfiguracji → zapytania Stage 3A; runtime nadal `deferred`.
6. Patch spójności evidence: typowanie `selectedNodeId`, resolved wymaga identity, ścieżka pola (nie cały formularz), lookup tylko z `BINDS_LOOKUP`.

## Katalog intencji

- explain_payroll_component
- validate_import_file
- build_employee_report
- explain_application_field
- trace_application_to_oracle
- unsupported / unknown

## Audit metrics

| Metryka | Wartość |
|---------|---------|
| questionsTested | **7** |
| intentsResolved / unknown / unsupported | **6** / **0** / **1** |
| ready / needs_clarification / ambiguous / invalid | **4** / **2** / **0** / **0** |
| entitiesExtracted | **16** |
| graphQueries / graphResolved / graphAmbiguous | **21** / **5** / **3** |
| graphResolvedEvidence / ambiguousEvidence | **5** / **3** |
| scopedFieldQueries / unscopedFieldQueries | **1** / **0** |
| resolvedForms / resolvedFormScopedFields | **1** / **1** |
| resolvedEvidenceWithoutNodeOrPath | **0** |
| evidenceSelectedNodeTypeMismatch | **0** |
| fieldEvidenceOutsideResolvedPath | **0** |
| bindingResolvedWithoutResolvedControl | **0** |
| lookupResolvedWithoutLookupEdge | **0** |
| helpDocumentPointingToForm | **0** |
| irrelevantGlobalAmbiguities | **0** |
| evidenceNotApplicable | **4** |
| clarificationQuestionsForAmbiguities | **1** |
| deferredEvidence | **44** |
| guessedEntities / autoResolvedAmbiguities | **0** / **0** |
| SQL gen/exec / filesRead / oracleWrites | **0** / **0** / **0** / **0** |
| avg / max planning ms | **26** / **122** |
| graphSourceHash | `2e7f0b7e323f0703cbea3f8f9d2b709590899edfb789f1ee5943496c717f73c3` |
| strictErrors | **0** |

## Referencje A–G

```json
{
  "A": {
    "planningStatus": "ready",
    "intent": "explain_payroll_component",
    "confidence": "exact",
    "entities": [
      {
        "type": "componentCode",
        "rawValue": "4300",
        "normalizedValue": "4300",
        "source": "question"
      },
      {
        "type": "componentValue",
        "rawValue": "5200",
        "normalizedValue": "5200",
        "source": "question"
      },
      {
        "type": "payrollType",
        "rawValue": "UC",
        "normalizedValue": "UC",
        "source": "question"
      },
      {
        "type": "employeeNumber",
        "rawValue": "00034",
        "normalizedValue": "00034",
        "source": "question"
      },
      {
        "type": "payrollPeriod",
        "rawValue": "luty 2026",
        "normalizedValue": "2026-02",
        "source": "question"
      }
    ],
    "missingEntities": [],
    "ambiguities": [],
    "clarificationQuestions": [],
    "selectionRequiredBeforeExecution": false,
    "evidenceStatuses": [
      {
        "evidenceType": "employee_identity",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "payroll_identity",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "payroll_period",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "calculated_component_result",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "payroll_component_definition",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "effective_component_definition",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "formula_or_algorithm",
        "status": "unavailable",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "component_dependencies",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "called_packages_and_functions",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "runtime_input_values",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "employee_insurance_context",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "effective_dates",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "calculation_trace_availability",
        "status": "unavailable",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      }
    ],
    "executionPolicy": {
      "sqlGenerationAllowed": false,
      "sqlExecutionAllowed": false,
      "fileReadAllowed": false,
      "oracleWriteAllowed": false,
      "reason": "Stage 3B planning only — ready ≠ SQL execution"
    },
    "graphNodes": 0,
    "graphEdges": 0,
    "graphConflicts": 0,
    "scopedFieldQueries": 0,
    "unscopedFieldQueries": 0,
    "queryTimingMs": {
      "resolveFormMs": 0,
      "resolveFieldMs": 0,
      "resolveNodeMs": 0,
      "otherMs": 0
    },
    "durationMs": 8
  },
  "B": {
    "planningStatus": "needs_clarification",
    "intent": "explain_payroll_component",
    "confidence": "exact",
    "entities": [
      {
        "type": "componentCode",
        "rawValue": "4300",
        "normalizedValue": "4300",
        "source": "question"
      }
    ],
    "missingEntities": [
      {
        "type": "employee",
        "reason": "employee_identity_not_provided",
        "requiredForIntent": true
      },
      {
        "type": "payroll_context",
        "reason": "payroll_period_or_list_not_provided",
        "requiredForIntent": true
      }
    ],
    "ambiguities": [],
    "clarificationQuestions": [
      {
        "entityType": "employeeNumber",
        "question": "Którego pracownika dotyczy pytanie?"
      },
      {
        "entityType": "payrollPeriod",
        "question": "Której listy płac lub którego okresu dotyczy naliczenie?"
      }
    ],
    "selectionRequiredBeforeExecution": false,
    "evidenceStatuses": [
      {
        "evidenceType": "employee_identity",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "payroll_identity",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "payroll_period",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "calculated_component_result",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "payroll_component_definition",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "effective_component_definition",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "formula_or_algorithm",
        "status": "unavailable",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "component_dependencies",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "called_packages_and_functions",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "runtime_input_values",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "employee_insurance_context",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "effective_dates",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "calculation_trace_availability",
        "status": "unavailable",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      }
    ],
    "executionPolicy": {
      "sqlGenerationAllowed": false,
      "sqlExecutionAllowed": false,
      "fileReadAllowed": false,
      "oracleWriteAllowed": false,
      "reason": "Stage 3B planning only — ready ≠ SQL execution"
    },
    "graphNodes": 0,
    "graphEdges": 0,
    "graphConflicts": 0,
    "scopedFieldQueries": 0,
    "unscopedFieldQueries": 0,
    "queryTimingMs": {
      "resolveFormMs": 0,
      "resolveFieldMs": 0,
      "resolveNodeMs": 0,
      "otherMs": 0
    },
    "durationMs": 0
  },
  "C": {
    "planningStatus": "ready",
    "intent": "validate_import_file",
    "confidence": "exact",
    "entities": [
      {
        "type": "fileName",
        "rawValue": "import.xlsx",
        "normalizedValue": "import.xlsx",
        "source": "question"
      },
      {
        "type": "fileType",
        "rawValue": "xlsx",
        "normalizedValue": "xlsx",
        "source": "question"
      },
      {
        "type": "targetTable",
        "rawValue": "T_PRAC",
        "normalizedValue": "T_PRAC",
        "source": "question"
      },
      {
        "type": "targetTable",
        "rawValue": "L_STANOWISKA",
        "normalizedValue": "L_STANOWISKA",
        "source": "question"
      },
      {
        "type": "targetTable",
        "rawValue": "L_STAWKI",
        "normalizedValue": "L_STAWKI",
        "source": "question"
      }
    ],
    "missingEntities": [],
    "ambiguities": [
      {
        "kind": "ambiguous",
        "subject": "targetTable:L_STANOWISKA",
        "blocksPlanning": false,
        "selectionRequiredBeforeExecution": true,
        "candidateIds": [
          "oracle-object:TETA_ADMIN_P:SYNONYM:L_STANOWISKA",
          "oracle-object:TETA_ADMIN:TABLE:L_STANOWISKA",
          "oracle-object:UNKNOWN:VIEW:L_STANOWISKA"
        ]
      },
      {
        "kind": "ambiguous",
        "subject": "targetTable:L_STAWKI",
        "blocksPlanning": false,
        "selectionRequiredBeforeExecution": true,
        "candidateIds": [
          "oracle-object:TETA_ADMIN_P:VIEW:L_STAWKI",
          "oracle-object:TETA_ADMIN:TABLE:L_STAWKI"
        ]
      },
      {
        "kind": "ambiguous",
        "subject": "targetTable:T_PRAC",
        "blocksPlanning": false,
        "selectionRequiredBeforeExecution": true,
        "candidateIds": [
          "oracle-object:HRM:VIEW:T_PRAC",
          "oracle-object:TETA_ADMIN_P:VIEW:T_PRAC",
          "oracle-object:TETA_ADMIN:TABLE:T_PRAC"
        ]
      }
    ],
    "clarificationQuestions": [],
    "selectionRequiredBeforeExecution": true,
    "evidenceStatuses": [
      {
        "evidenceType": "file_metadata",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "file_columns",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "target_tables",
        "status": "ambiguous",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": [
          "oracle-object:HRM:VIEW:T_PRAC",
          "oracle-object:TETA_ADMIN:TABLE:L_STANOWISKA",
          "oracle-object:TETA_ADMIN:TABLE:L_STAWKI",
          "oracle-object:TETA_ADMIN:TABLE:T_PRAC",
          "oracle-object:TETA_ADMIN_P:SYNONYM:L_STANOWISKA",
          "oracle-object:TETA_ADMIN_P:VIEW:L_STAWKI",
          "oracle-object:TETA_ADMIN_P:VIEW:T_PRAC",
          "oracle-object:UNKNOWN:VIEW:L_STANOWISKA"
        ],
        "pathNodeIds": null
      },
      {
        "evidenceType": "target_columns",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "datatype_rules",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "length_and_precision_rules",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "not_null_rules",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "primary_keys",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "unique_constraints",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "foreign_keys",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "check_constraints",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "required_dictionary_values",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "triggers",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "validation_packages",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "business_rules",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "temporal_overlap_rules",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "import_order",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "rollback_validation_capability",
        "status": "unavailable",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      }
    ],
    "executionPolicy": {
      "sqlGenerationAllowed": false,
      "sqlExecutionAllowed": false,
      "fileReadAllowed": false,
      "oracleWriteAllowed": false,
      "reason": "Stage 3B planning only — ready ≠ SQL execution"
    },
    "graphNodes": 8,
    "graphEdges": 0,
    "graphConflicts": 0,
    "scopedFieldQueries": 0,
    "unscopedFieldQueries": 0,
    "queryTimingMs": {
      "resolveFormMs": 0,
      "resolveFieldMs": 0,
      "resolveNodeMs": 23,
      "otherMs": 0
    },
    "durationMs": 24
  },
  "D": {
    "planningStatus": "ready",
    "intent": "build_employee_report",
    "confidence": "exact",
    "entities": [
      {
        "type": "reportSubject",
        "rawValue": "badania BHP",
        "normalizedValue": "occupational_health_examinations",
        "source": "question"
      },
      {
        "type": "relativeDateRange",
        "rawValue": "w tym miesiącu",
        "normalizedValue": "current_month",
        "source": "question"
      }
    ],
    "missingEntities": [],
    "ambiguities": [
      {
        "kind": "ambiguous",
        "subject": "report_graph_sources",
        "blocksPlanning": false,
        "selectionRequiredBeforeExecution": true,
        "candidateIds": [
          "form:13c03944-be28-4fc3-811e-13461b75f318:Teta.Sumo.Personel.plgPersonelSlowniki.CrdBhpResourceGroups.BhpResourceGroupsView",
          "form:1425b4e5-e820-4350-bc4d-2a6c1d887244:Teta.Sumo.Personel.plgBHP.CrdRejestrWypadkow.RejestrWypadkowWidok",
          "form:19a5dac6-733f-4801-8a66-f9ee707bb404:Teta.Sumo.Personel.plgBadaniaBHP.CrdKartotekaBadanBHP.KartotekaBadanBHPWidok",
          "form:20866b0b-6e81-4748-b21b-a4eadc077282:Teta.Sumo.Personel.plgBadaniaBHP.GroupOshTrainingsAdding.ActGroupOshTrainingsAdding",
          "form:3b8c28a4-61ae-4c18-a6dc-9d30aad4066c:Teta.Sumo.Personel.plgPracownikImp.CrdSzkoleniaBHPImp.SzkoleniaBHPImpWidok",
          "form:54dd8c92-1709-47c5-ac60-8a24d131e2a4:Teta.Sumo.Personel.plgBHP.CrdSrodkiWydane.SrodkiWydaneWidok",
          "form:5b233dd2-5d93-49a8-b2af-07e0d3464f17:Teta.Sumo.Personel.plgBadaniaBHP.CrdKartotekaSzkolenBHP.KartotekaSzkolenBHPWidok",
          "form:65d5bc4e-376b-44cd-9c91-e14841342df1:Teta.Sumo.Personel.plgPersonelParametryRap.BHP.PrmStatystycznaKartaWypadkowa"
        ]
      }
    ],
    "clarificationQuestions": [],
    "selectionRequiredBeforeExecution": true,
    "evidenceStatuses": [
      {
        "evidenceType": "report_subject",
        "status": "resolved",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": [
          "form:13c03944-be28-4fc3-811e-13461b75f318:Teta.Sumo.Personel.plgPersonelSlowniki.CrdBhpResourceGroups.BhpResourceGroupsView",
          "form:1425b4e5-e820-4350-bc4d-2a6c1d887244:Teta.Sumo.Personel.plgBHP.CrdRejestrWypadkow.RejestrWypadkowWidok",
          "form:19a5dac6-733f-4801-8a66-f9ee707bb404:Teta.Sumo.Personel.plgBadaniaBHP.CrdKartotekaBadanBHP.KartotekaBadanBHPWidok",
          "form:20866b0b-6e81-4748-b21b-a4eadc077282:Teta.Sumo.Personel.plgBadaniaBHP.GroupOshTrainingsAdding.ActGroupOshTrainingsAdding",
          "form:3b8c28a4-61ae-4c18-a6dc-9d30aad4066c:Teta.Sumo.Personel.plgPracownikImp.CrdSzkoleniaBHPImp.SzkoleniaBHPImpWidok",
          "form:54dd8c92-1709-47c5-ac60-8a24d131e2a4:Teta.Sumo.Personel.plgBHP.CrdSrodkiWydane.SrodkiWydaneWidok",
          "form:5b233dd2-5d93-49a8-b2af-07e0d3464f17:Teta.Sumo.Personel.plgBadaniaBHP.CrdKartotekaSzkolenBHP.KartotekaSzkolenBHPWidok",
          "form:65d5bc4e-376b-44cd-9c91-e14841342df1:Teta.Sumo.Personel.plgPersonelParametryRap.BHP.PrmStatystycznaKartaWypadkowa",
          "form:6ee1ad28-5ad6-4ae3-9bd2-566ae2d82c59:Teta.Sumo.Personel.plgBHP.UsuwaniePotrzeb.ActUsuwaniePotrzeb",
          "form:8fbf5391-643c-4fef-9776-157c533ff415:Teta.Sumo.Personel.plgBHP.CrdZapotrzebowaniaNaSrodki.ZapotrzebowanieNaSrodkiWidok",
          "form:925ce275-e7dd-4bfa-b6db-0e720e5e2013:Teta.Sumo.Personel.plgBHP.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok",
          "form:ab949fc0-8825-4b29-a7a0-85f2f6e87e8f:Teta.Sumo.Personel.plgBHP.AktualizacjaDatyDo.ActAktualizacjaDatyDo",
          "form:ac6093fe-6396-448e-aecd-63c73b22b4c3:Teta.Sumo.Personel.plgBHP.CrdKartaBHP.KartaBHPWidok",
          "form:acb75227-c774-4fb2-8598-9f476d2046c1:Teta.Sumo.Personel.plgBHP.CrdSrodkiDostepne.SrodkiDostepneWidok",
          "form:bbb9529f-edd3-4396-ae27-07b244ac5cb2:Teta.Sumo.Personel.plgPersonelSlowniki.DicRodzajeSzkolenBHP",
          "form:bc2882b3-4f6e-4836-8cdc-3bf62a3fcf2a:Teta.Sumo.Personel.plgPersonelSlowniki.CrdAsortymentSrodkowBHP.AsortymentSrodkowBHPWidok",
          "form:eb73ecf9-b897-4d94-a2ff-9e7dba523f51:Teta.Sumo.Personel.plgBHP.BadaniePotrzeb.ActBadaniePotrzeb",
          "form:ec5b60b5-7fe2-4e40-8bfc-45f02642661d:Teta.Sumo.Personel.plgBHP.CrdKartotekaWydan.KartotekaWydanWidok",
          "form:f231b353-9f6d-4a57-aa37-42b3337213db:Teta.Sumo.Personel.plgPersonelSlowniki.DicRodzajeBadanBHP",
          "form:f2bcc3b9-6508-4b22-95a0-cdbc2d26c782:Teta.Sumo.Personel.plgBHP.CrdRozmiaryPracownika.RozmiaryPracownikaWidok",
          "form:feaeaeb2-2500-1cab-e030-2f64070ae40e:Teta.Sumo.Personel.plgBadaniaBHP.CrdBadaniaBHP.BadaniaBHPWidok",
          "help-field:77ededc5-b019-498a-94ab-3d9115e2fc3e:Teta.Sumo.Personel.plgPersonelSlowniki.DicZawieszenia:Zawieszenia pracy:8:bhp",
          "help-field:77ededc5-b019-498a-94ab-3d9115e2fc3e:Teta.Sumo.Personel.plgPersonelSlowniki.DicZawieszenia:linked:8edd42:bhp",
          "plugin:24ec37ef-95a7-434f-bb89-f3eafe51ca87"
        ],
        "pathNodeIds": null
      },
      {
        "evidenceType": "employee_source",
        "status": "ambiguous",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": [
          "form:13c03944-be28-4fc3-811e-13461b75f318:Teta.Sumo.Personel.plgPersonelSlowniki.CrdBhpResourceGroups.BhpResourceGroupsView",
          "form:1425b4e5-e820-4350-bc4d-2a6c1d887244:Teta.Sumo.Personel.plgBHP.CrdRejestrWypadkow.RejestrWypadkowWidok",
          "form:19a5dac6-733f-4801-8a66-f9ee707bb404:Teta.Sumo.Personel.plgBadaniaBHP.CrdKartotekaBadanBHP.KartotekaBadanBHPWidok",
          "form:20866b0b-6e81-4748-b21b-a4eadc077282:Teta.Sumo.Personel.plgBadaniaBHP.GroupOshTrainingsAdding.ActGroupOshTrainingsAdding",
          "form:3b8c28a4-61ae-4c18-a6dc-9d30aad4066c:Teta.Sumo.Personel.plgPracownikImp.CrdSzkoleniaBHPImp.SzkoleniaBHPImpWidok",
          "form:54dd8c92-1709-47c5-ac60-8a24d131e2a4:Teta.Sumo.Personel.plgBHP.CrdSrodkiWydane.SrodkiWydaneWidok",
          "form:5b233dd2-5d93-49a8-b2af-07e0d3464f17:Teta.Sumo.Personel.plgBadaniaBHP.CrdKartotekaSzkolenBHP.KartotekaSzkolenBHPWidok",
          "form:65d5bc4e-376b-44cd-9c91-e14841342df1:Teta.Sumo.Personel.plgPersonelParametryRap.BHP.PrmStatystycznaKartaWypadkowa",
          "form:6ee1ad28-5ad6-4ae3-9bd2-566ae2d82c59:Teta.Sumo.Personel.plgBHP.UsuwaniePotrzeb.ActUsuwaniePotrzeb",
          "form:8fbf5391-643c-4fef-9776-157c533ff415:Teta.Sumo.Personel.plgBHP.CrdZapotrzebowaniaNaSrodki.ZapotrzebowanieNaSrodkiWidok",
          "form:925ce275-e7dd-4bfa-b6db-0e720e5e2013:Teta.Sumo.Personel.plgBHP.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok",
          "form:ab949fc0-8825-4b29-a7a0-85f2f6e87e8f:Teta.Sumo.Personel.plgBHP.AktualizacjaDatyDo.ActAktualizacjaDatyDo",
          "form:ac6093fe-6396-448e-aecd-63c73b22b4c3:Teta.Sumo.Personel.plgBHP.CrdKartaBHP.KartaBHPWidok",
          "form:acb75227-c774-4fb2-8598-9f476d2046c1:Teta.Sumo.Personel.plgBHP.CrdSrodkiDostepne.SrodkiDostepneWidok",
          "form:bbb9529f-edd3-4396-ae27-07b244ac5cb2:Teta.Sumo.Personel.plgPersonelSlowniki.DicRodzajeSzkolenBHP",
          "form:bc2882b3-4f6e-4836-8cdc-3bf62a3fcf2a:Teta.Sumo.Personel.plgPersonelSlowniki.CrdAsortymentSrodkowBHP.AsortymentSrodkowBHPWidok",
          "form:eb73ecf9-b897-4d94-a2ff-9e7dba523f51:Teta.Sumo.Personel.plgBHP.BadaniePotrzeb.ActBadaniePotrzeb",
          "form:ec5b60b5-7fe2-4e40-8bfc-45f02642661d:Teta.Sumo.Personel.plgBHP.CrdKartotekaWydan.KartotekaWydanWidok",
          "form:f231b353-9f6d-4a57-aa37-42b3337213db:Teta.Sumo.Personel.plgPersonelSlowniki.DicRodzajeBadanBHP",
          "form:f2bcc3b9-6508-4b22-95a0-cdbc2d26c782:Teta.Sumo.Personel.plgBHP.CrdRozmiaryPracownika.RozmiaryPracownikaWidok",
          "form:feaeaeb2-2500-1cab-e030-2f64070ae40e:Teta.Sumo.Personel.plgBadaniaBHP.CrdBadaniaBHP.BadaniaBHPWidok",
          "help-field:77ededc5-b019-498a-94ab-3d9115e2fc3e:Teta.Sumo.Personel.plgPersonelSlowniki.DicZawieszenia:Zawieszenia pracy:8:bhp",
          "help-field:77ededc5-b019-498a-94ab-3d9115e2fc3e:Teta.Sumo.Personel.plgPersonelSlowniki.DicZawieszenia:linked:8edd42:bhp",
          "plugin:24ec37ef-95a7-434f-bb89-f3eafe51ca87"
        ],
        "pathNodeIds": null
      },
      {
        "evidenceType": "business_event_source",
        "status": "ambiguous",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": [
          "form:13c03944-be28-4fc3-811e-13461b75f318:Teta.Sumo.Personel.plgPersonelSlowniki.CrdBhpResourceGroups.BhpResourceGroupsView",
          "form:1425b4e5-e820-4350-bc4d-2a6c1d887244:Teta.Sumo.Personel.plgBHP.CrdRejestrWypadkow.RejestrWypadkowWidok",
          "form:19a5dac6-733f-4801-8a66-f9ee707bb404:Teta.Sumo.Personel.plgBadaniaBHP.CrdKartotekaBadanBHP.KartotekaBadanBHPWidok",
          "form:20866b0b-6e81-4748-b21b-a4eadc077282:Teta.Sumo.Personel.plgBadaniaBHP.GroupOshTrainingsAdding.ActGroupOshTrainingsAdding",
          "form:3b8c28a4-61ae-4c18-a6dc-9d30aad4066c:Teta.Sumo.Personel.plgPracownikImp.CrdSzkoleniaBHPImp.SzkoleniaBHPImpWidok",
          "form:54dd8c92-1709-47c5-ac60-8a24d131e2a4:Teta.Sumo.Personel.plgBHP.CrdSrodkiWydane.SrodkiWydaneWidok",
          "form:5b233dd2-5d93-49a8-b2af-07e0d3464f17:Teta.Sumo.Personel.plgBadaniaBHP.CrdKartotekaSzkolenBHP.KartotekaSzkolenBHPWidok",
          "form:65d5bc4e-376b-44cd-9c91-e14841342df1:Teta.Sumo.Personel.plgPersonelParametryRap.BHP.PrmStatystycznaKartaWypadkowa",
          "form:6ee1ad28-5ad6-4ae3-9bd2-566ae2d82c59:Teta.Sumo.Personel.plgBHP.UsuwaniePotrzeb.ActUsuwaniePotrzeb",
          "form:8fbf5391-643c-4fef-9776-157c533ff415:Teta.Sumo.Personel.plgBHP.CrdZapotrzebowaniaNaSrodki.ZapotrzebowanieNaSrodkiWidok",
          "form:925ce275-e7dd-4bfa-b6db-0e720e5e2013:Teta.Sumo.Personel.plgBHP.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok",
          "form:ab949fc0-8825-4b29-a7a0-85f2f6e87e8f:Teta.Sumo.Personel.plgBHP.AktualizacjaDatyDo.ActAktualizacjaDatyDo",
          "form:ac6093fe-6396-448e-aecd-63c73b22b4c3:Teta.Sumo.Personel.plgBHP.CrdKartaBHP.KartaBHPWidok",
          "form:acb75227-c774-4fb2-8598-9f476d2046c1:Teta.Sumo.Personel.plgBHP.CrdSrodkiDostepne.SrodkiDostepneWidok",
          "form:bbb9529f-edd3-4396-ae27-07b244ac5cb2:Teta.Sumo.Personel.plgPersonelSlowniki.DicRodzajeSzkolenBHP",
          "form:bc2882b3-4f6e-4836-8cdc-3bf62a3fcf2a:Teta.Sumo.Personel.plgPersonelSlowniki.CrdAsortymentSrodkowBHP.AsortymentSrodkowBHPWidok",
          "form:eb73ecf9-b897-4d94-a2ff-9e7dba523f51:Teta.Sumo.Personel.plgBHP.BadaniePotrzeb.ActBadaniePotrzeb",
          "form:ec5b60b5-7fe2-4e40-8bfc-45f02642661d:Teta.Sumo.Personel.plgBHP.CrdKartotekaWydan.KartotekaWydanWidok",
          "form:f231b353-9f6d-4a57-aa37-42b3337213db:Teta.Sumo.Personel.plgPersonelSlowniki.DicRodzajeBadanBHP",
          "form:f2bcc3b9-6508-4b22-95a0-cdbc2d26c782:Teta.Sumo.Personel.plgBHP.CrdRozmiaryPracownika.RozmiaryPracownikaWidok",
          "form:feaeaeb2-2500-1cab-e030-2f64070ae40e:Teta.Sumo.Personel.plgBadaniaBHP.CrdBadaniaBHP.BadaniaBHPWidok",
          "help-field:77ededc5-b019-498a-94ab-3d9115e2fc3e:Teta.Sumo.Personel.plgPersonelSlowniki.DicZawieszenia:Zawieszenia pracy:8:bhp",
          "help-field:77ededc5-b019-498a-94ab-3d9115e2fc3e:Teta.Sumo.Personel.plgPersonelSlowniki.DicZawieszenia:linked:8edd42:bhp",
          "plugin:24ec37ef-95a7-434f-bb89-f3eafe51ca87"
        ],
        "pathNodeIds": null
      },
      {
        "evidenceType": "requested_columns",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "filter_columns",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "date_semantics",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "joins",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "dictionary_display_columns",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "employee_scope",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "authorization_scope",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "output_format",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      }
    ],
    "executionPolicy": {
      "sqlGenerationAllowed": false,
      "sqlExecutionAllowed": false,
      "fileReadAllowed": false,
      "oracleWriteAllowed": false,
      "reason": "Stage 3B planning only — ready ≠ SQL execution"
    },
    "graphNodes": 25,
    "graphEdges": 0,
    "graphConflicts": 0,
    "scopedFieldQueries": 0,
    "unscopedFieldQueries": 0,
    "queryTimingMs": {
      "resolveFormMs": 27,
      "resolveFieldMs": 0,
      "resolveNodeMs": 4,
      "otherMs": 0
    },
    "durationMs": 31
  },
  "E": {
    "planningStatus": "ready",
    "intent": "explain_application_field",
    "confidence": "contextual",
    "entities": [
      {
        "type": "fieldLabel",
        "rawValue": "Wartość",
        "normalizedValue": "wartosc",
        "source": "question"
      },
      {
        "type": "formName",
        "rawValue": "Lista obliczona",
        "normalizedValue": "lista obliczona",
        "source": "question"
      }
    ],
    "missingEntities": [],
    "ambiguities": [],
    "clarificationQuestions": [],
    "selectionRequiredBeforeExecution": false,
    "evidenceStatuses": [
      {
        "evidenceType": "form",
        "status": "resolved",
        "runtimeSourceRequired": false,
        "selectedNodeId": "form:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok",
        "selectedNodeIds": null,
        "pathNodeIds": [
          "form:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok",
          "help-doc:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok",
          "help-field:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok:Zakładka Składniki listy:4:wartość"
        ]
      },
      {
        "evidenceType": "help_document",
        "status": "resolved",
        "runtimeSourceRequired": false,
        "selectedNodeId": "help-doc:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok",
        "selectedNodeIds": null,
        "pathNodeIds": [
          "form:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok",
          "help-doc:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok",
          "help-field:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok:Zakładka Składniki listy:4:wartość"
        ]
      },
      {
        "evidenceType": "help_field",
        "status": "resolved",
        "runtimeSourceRequired": false,
        "selectedNodeId": "help-field:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok:Zakładka Składniki listy:4:wartość",
        "selectedNodeIds": null,
        "pathNodeIds": [
          "form:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok",
          "help-doc:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok",
          "help-field:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok:Zakładka Składniki listy:4:wartość"
        ]
      },
      {
        "evidenceType": "control",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "target_binding",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "lookup_binding",
        "status": "not_applicable",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "dataset_columns",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "oracle_columns",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "action_parameter",
        "status": "not_applicable",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "provenance",
        "status": "resolved",
        "runtimeSourceRequired": false,
        "selectedNodeId": "help-field:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok:Zakładka Składniki listy:4:wartość",
        "selectedNodeIds": [
          "form:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok",
          "help-doc:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok",
          "help-field:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok:Zakładka Składniki listy:4:wartość"
        ],
        "pathNodeIds": [
          "form:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok",
          "help-doc:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok",
          "help-field:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok:Zakładka Składniki listy:4:wartość"
        ]
      }
    ],
    "executionPolicy": {
      "sqlGenerationAllowed": false,
      "sqlExecutionAllowed": false,
      "fileReadAllowed": false,
      "oracleWriteAllowed": false,
      "reason": "Stage 3B planning only — ready ≠ SQL execution"
    },
    "graphNodes": 34,
    "graphEdges": 28,
    "graphConflicts": 0,
    "scopedFieldQueries": 1,
    "unscopedFieldQueries": 0,
    "queryTimingMs": {
      "resolveFormMs": 1,
      "resolveFieldMs": 67,
      "resolveNodeMs": 0,
      "otherMs": 50
    },
    "durationMs": 122
  },
  "F": {
    "planningStatus": "needs_clarification",
    "intent": "explain_application_field",
    "confidence": "contextual",
    "entities": [
      {
        "type": "fieldLabel",
        "rawValue": "Nazwa",
        "normalizedValue": "nazwa",
        "source": "question"
      }
    ],
    "missingEntities": [],
    "ambiguities": [
      {
        "kind": "ambiguous",
        "subject": "field_scope_missing",
        "blocksPlanning": true,
        "selectionRequiredBeforeExecution": false
      }
    ],
    "clarificationQuestions": [
      {
        "entityType": "field_scope_missing",
        "question": "Na którym formularzu znajduje się pole „Nazwa”?"
      }
    ],
    "selectionRequiredBeforeExecution": false,
    "evidenceStatuses": [
      {
        "evidenceType": "form",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "help_document",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "help_field",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "control",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "target_binding",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "lookup_binding",
        "status": "not_applicable",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "dataset_columns",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "oracle_columns",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "action_parameter",
        "status": "not_applicable",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      },
      {
        "evidenceType": "provenance",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null,
        "selectedNodeIds": null,
        "pathNodeIds": null
      }
    ],
    "executionPolicy": {
      "sqlGenerationAllowed": false,
      "sqlExecutionAllowed": false,
      "fileReadAllowed": false,
      "oracleWriteAllowed": false,
      "reason": "Stage 3B planning only — ready ≠ SQL execution"
    },
    "graphNodes": 0,
    "graphEdges": 0,
    "graphConflicts": 0,
    "scopedFieldQueries": 0,
    "unscopedFieldQueries": 0,
    "queryTimingMs": {
      "resolveFormMs": 0,
      "resolveFieldMs": 0,
      "resolveNodeMs": 0,
      "otherMs": 0
    },
    "durationMs": 0
  },
  "G": {
    "planningStatus": "unsupported",
    "intent": "unsupported",
    "confidence": "contextual",
    "entities": [],
    "missingEntities": [],
    "ambiguities": [],
    "clarificationQuestions": [],
    "selectionRequiredBeforeExecution": false,
    "evidenceStatuses": [],
    "executionPolicy": {
      "sqlGenerationAllowed": false,
      "sqlExecutionAllowed": false,
      "fileReadAllowed": false,
      "oracleWriteAllowed": false,
      "reason": "Stage 3B planning only — ready ≠ SQL execution"
    },
    "graphNodes": 0,
    "graphEdges": 0,
    "graphConflicts": 0,
    "scopedFieldQueries": 0,
    "unscopedFieldQueries": 0,
    "queryTimingMs": {
      "resolveFormMs": 0,
      "resolveFieldMs": 0,
      "resolveNodeMs": 0,
      "otherMs": 0
    },
    "durationMs": 0
  }
}
```

## Przykłady statusów

- **ready** — kompletne encje + plan dowodów (ref A; ref E gdy form+pole jednoznaczne). Nie pozwala na SQL.
- **needs_clarification** — brak pracownika/okresu (ref B) lub pole bez formularza (ref F).
- **ambiguous** — równorzędni kandydaci formularza/pola; import może mieć `selectionRequiredBeforeExecution` bez blokady planu.
- **unsupported** — zapis/przelew (ref G)

## CLI

```bash
pnpm --filter @teta/api run planner:stage3b -- plan --question "..."
pnpm --filter @teta/api run planner:stage3b -- catalog
pnpm --filter @teta/api run planner:stage3b -- audit --strict
```
