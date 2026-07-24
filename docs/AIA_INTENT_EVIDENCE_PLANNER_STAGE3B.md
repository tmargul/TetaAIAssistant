# AIA Intent & Evidence Planner — Stage 3B

Wygenerowano: **2026-07-24T18:11:37.095Z**
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
  ]
}

### Zachowanie po patchu

1. Formularz: GUID → albo `plugin_registry_entry` (polska nazwa PA) → GUID/className → `resolveForm`.
2. Pole: tylko z `formNodeId` (`scopedFieldQueries`); bez formularza — `field_scope_missing` + pytanie, **bez** globalnego multi-type search.
3. `action_parameter=not_applicable` dla zwykłego pola danych.
4. Import: `businessTarget` + `canonicalCandidates` + `selectionRequiredBeforeExecution` (bez auto-owner).
5. Raport BHP: `graphSearchTerms` z konfiguracji → zapytania Stage 3A; runtime nadal `deferred`.

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
| graphQueries / graphResolved / graphAmbiguous | **19** / **8** / **3** |
| graphResolvedEvidence / ambiguousEvidence | **9** / **3** |
| scopedFieldQueries / unscopedFieldQueries | **1** / **0** |
| resolvedForms / resolvedFormScopedFields | **1** / **1** |
| irrelevantGlobalAmbiguities | **0** |
| evidenceNotApplicable | **2** |
| clarificationQuestionsForAmbiguities | **1** |
| deferredEvidence | **50** |
| guessedEntities / autoResolvedAmbiguities | **0** / **0** |
| SQL gen/exec / filesRead / oracleWrites | **0** / **0** / **0** / **0** |
| avg / max planning ms | **30** / **138** |
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
        "selectedNodeId": null
      },
      {
        "evidenceType": "payroll_identity",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "payroll_period",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "calculated_component_result",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "payroll_component_definition",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "effective_component_definition",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "formula_or_algorithm",
        "status": "unavailable",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "component_dependencies",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "called_packages_and_functions",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "runtime_input_values",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "employee_insurance_context",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "effective_dates",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "calculation_trace_availability",
        "status": "unavailable",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
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
    "durationMs": 9
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
        "selectedNodeId": null
      },
      {
        "evidenceType": "payroll_identity",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "payroll_period",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "calculated_component_result",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "payroll_component_definition",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "effective_component_definition",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "formula_or_algorithm",
        "status": "unavailable",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "component_dependencies",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "called_packages_and_functions",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "runtime_input_values",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "employee_insurance_context",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "effective_dates",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "calculation_trace_availability",
        "status": "unavailable",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
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
    "durationMs": 1
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
        "selectedNodeId": null
      },
      {
        "evidenceType": "file_columns",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "target_tables",
        "status": "ambiguous",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "target_columns",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "datatype_rules",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "length_and_precision_rules",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "not_null_rules",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "primary_keys",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "unique_constraints",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "foreign_keys",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "check_constraints",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "required_dictionary_values",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "triggers",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "validation_packages",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "business_rules",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "temporal_overlap_rules",
        "status": "deferred",
        "runtimeSourceRequired": true,
        "selectedNodeId": null
      },
      {
        "evidenceType": "import_order",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "rollback_validation_capability",
        "status": "unavailable",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
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
      "resolveNodeMs": 25,
      "otherMs": 0
    },
    "durationMs": 26
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
        "selectedNodeId": null
      },
      {
        "evidenceType": "employee_source",
        "status": "ambiguous",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "business_event_source",
        "status": "ambiguous",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "requested_columns",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "filter_columns",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "date_semantics",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "joins",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "dictionary_display_columns",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "employee_scope",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "authorization_scope",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "output_format",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
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
      "resolveFormMs": 30,
      "resolveFieldMs": 0,
      "resolveNodeMs": 3,
      "otherMs": 0
    },
    "durationMs": 34
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
        "selectedNodeId": "form:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok"
      },
      {
        "evidenceType": "help_document",
        "status": "resolved",
        "runtimeSourceRequired": false,
        "selectedNodeId": "form:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok"
      },
      {
        "evidenceType": "help_field",
        "status": "resolved",
        "runtimeSourceRequired": false,
        "selectedNodeId": "help-field:03c5e06f-fad6-414e-8053-47d944b0b19e:Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok:Zakładka Składniki listy:4:wartość"
      },
      {
        "evidenceType": "control",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "target_binding",
        "status": "resolved",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "lookup_binding",
        "status": "resolved",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "dataset_columns",
        "status": "resolved",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "oracle_columns",
        "status": "resolved",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "action_parameter",
        "status": "not_applicable",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "provenance",
        "status": "resolved",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
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
    "graphEdges": 27,
    "graphConflicts": 0,
    "scopedFieldQueries": 1,
    "unscopedFieldQueries": 0,
    "queryTimingMs": {
      "resolveFormMs": 0,
      "resolveFieldMs": 70,
      "resolveNodeMs": 0,
      "otherMs": 65
    },
    "durationMs": 138
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
        "selectedNodeId": null
      },
      {
        "evidenceType": "help_document",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "help_field",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "control",
        "status": "missing",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "target_binding",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "lookup_binding",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "dataset_columns",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "oracle_columns",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "action_parameter",
        "status": "not_applicable",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
      },
      {
        "evidenceType": "provenance",
        "status": "deferred",
        "runtimeSourceRequired": false,
        "selectedNodeId": null
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
