# AIA Read-Only Query Planner — Stage 3C

Wygenerowano: **2026-07-24T19:53:49.413Z**
contractVersion: `teta-aia-readonly-query-plan-v1`
reportTemplateVersion: `teta-aia-report-query-templates-v1`
safetyPolicyVersion: `teta-aia-query-safety-policy-v1`
graphSourceHash: `2e7f0b7e323f0703cbea3f8f9d2b709590899edfb789f1ee5943496c717f73c3`

## Architektura

- Moduł: `apps/api/src/teta-query-planner/`
- Wejście: Stage 3B `TetaEvidencePlan`
- Wyjście: `TetaReadOnlyQueryPlan` (bez SQL)
- Klient Stage 3A: `CanonicalGraphResolverService` (bez NDJSON, bez LLM/Qdrant/Oracle exec)
- Konfiguracja: `teta-report-query-templates-v1.json`, `teta-query-safety-policy-v1.json`

## Kontrakt wejścia / wyjścia

- Request: `TetaReadOnlyQueryPlanningRequest`
- Plan: `TetaReadOnlyQueryPlan` (`teta-aia-readonly-query-plan-v1`)
- Statusy: ready_for_compilation | needs_graph_resolution | needs_selection | needs_user_clarification | unsupported | invalid

## Modele

- **Source**: logical object vs access object; owner policy (TETA_ADMIN preferowany; HRM/UNKNOWN bez auto-select)
- **Column**: businessRole + oracleColumnNodeId + provenance
- **Join**: typed predicates + evidenceType; zakaz cartesian
- **Filter**: AST (`half_open_date_interval`, `effective_on_date`); clock=`oracle_sysdate`

## Safety

- SELECT only, no SELECT *, maxRows=500, maxColumns=20, timeout=30000
- Authorization deferred / assumedOracleUser=TETA_ADMIN
- `finalSqlGenerated=0`, `sqlExecuted=0`, `oracleConnections=0`

## Reference A (BHP)

```json
{
  "evidencePlanningStatus": "ready",
  "planStatus": "needs_graph_resolution",
  "intent": "build_employee_report",
  "subject": "occupational_health_examinations",
  "rejection": null,
  "sources": [
    {
      "sourceRole": "employee",
      "status": "missing",
      "logical": null,
      "access": null,
      "selectionReason": "no_allowed_oracle_object_with_graph_evidence",
      "candidates": []
    },
    {
      "sourceRole": "health_examination",
      "status": "missing",
      "logical": null,
      "access": null,
      "selectionReason": "no_allowed_oracle_object_with_graph_evidence",
      "candidates": []
    },
    {
      "sourceRole": "examination_type",
      "status": "missing",
      "logical": null,
      "access": null,
      "selectionReason": "no_allowed_oracle_object_with_graph_evidence",
      "candidates": []
    },
    {
      "sourceRole": "current_position",
      "status": "missing",
      "logical": null,
      "access": null,
      "selectionReason": "no_allowed_oracle_object_with_graph_evidence",
      "candidates": []
    },
    {
      "sourceRole": "organizational_unit",
      "status": "missing",
      "logical": null,
      "access": null,
      "selectionReason": "no_allowed_oracle_object_with_graph_evidence",
      "candidates": []
    }
  ],
  "projections": [
    {
      "businessRole": "employee_number",
      "status": "missing",
      "oracleColumnNodeId": null,
      "columnName": null
    },
    {
      "businessRole": "employee_first_name",
      "status": "missing",
      "oracleColumnNodeId": null,
      "columnName": null
    },
    {
      "businessRole": "employee_last_name",
      "status": "missing",
      "oracleColumnNodeId": null,
      "columnName": null
    },
    {
      "businessRole": "examination_type_name",
      "status": "missing",
      "oracleColumnNodeId": null,
      "columnName": null
    },
    {
      "businessRole": "examination_valid_from",
      "status": "missing",
      "oracleColumnNodeId": null,
      "columnName": null
    },
    {
      "businessRole": "examination_valid_to",
      "status": "missing",
      "oracleColumnNodeId": null,
      "columnName": null
    },
    {
      "businessRole": "position_name",
      "status": "missing",
      "oracleColumnNodeId": null,
      "columnName": null
    },
    {
      "businessRole": "organizational_unit_name",
      "status": "missing",
      "oracleColumnNodeId": null,
      "columnName": null
    }
  ],
  "joins": [
    {
      "joinId": "join:employee:current_position",
      "status": "missing",
      "joinType": "left",
      "predicates": 0,
      "evidenceType": null
    },
    {
      "joinId": "join:employee:organizational_unit",
      "status": "missing",
      "joinType": "left",
      "predicates": 0,
      "evidenceType": null
    },
    {
      "joinId": "join:health_examination:employee",
      "status": "missing",
      "joinType": "inner",
      "predicates": 0,
      "evidenceType": null
    },
    {
      "joinId": "join:health_examination:examination_type",
      "status": "missing",
      "joinType": "inner",
      "predicates": 0,
      "evidenceType": null
    }
  ],
  "filters": [
    {
      "filterRole": "examination_valid_to_in_current_month",
      "type": "half_open_date_interval",
      "status": "incomplete",
      "columnOracleNodeId": null,
      "lower": {
        "clock": "oracle_sysdate",
        "transform": "month_start",
        "inclusive": true
      },
      "upper": {
        "clock": "oracle_sysdate",
        "transform": "next_month_start",
        "inclusive": false
      }
    },
    {
      "filterRole": "employee_active_on_oracle_sysdate",
      "type": "effective_on_date",
      "status": "incomplete",
      "clock": "oracle_sysdate",
      "predicates": 0,
      "missingReason": "missing_confirmed_active_employment_semantics_in_graph; do_not_assume_T_PRAC_presence_means_active"
    }
  ],
  "ordering": [
    {
      "orderRole": "examination_valid_to_ascending",
      "status": "missing",
      "oracleColumnNodeId": null,
      "direction": "ascending",
      "businessRole": "examination_valid_to"
    },
    {
      "orderRole": "employee_last_name_ascending",
      "status": "missing",
      "oracleColumnNodeId": null,
      "direction": "ascending",
      "businessRole": "employee_last_name"
    },
    {
      "orderRole": "employee_first_name_ascending",
      "status": "missing",
      "oracleColumnNodeId": null,
      "direction": "ascending",
      "businessRole": "employee_first_name"
    }
  ],
  "limits": {
    "maxRows": 500,
    "maxColumns": 20,
    "statementTimeoutMs": 30000
  },
  "authorization": {
    "status": "deferred",
    "assumedOracleUser": "TETA_ADMIN",
    "filtersApplied": false,
    "reason": "Authorization will be implemented in a later stage. Development environment assumes TETA_ADMIN with full privileges; this is not a production security model."
  },
  "unresolvedSelections": [
    {
      "subject": "report_graph_sources",
      "reason": "multiple_structural_sources_for_report_subject",
      "candidateNodeIds": [
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
      "blocksPlanning": false
    }
  ],
  "warnings": [],
  "executionPolicy": {
    "sqlCompilationAllowed": false,
    "sqlExecutionAllowed": false,
    "oracleConnectionAllowed": false,
    "oracleWriteAllowed": false,
    "fileReadAllowed": false,
    "reason": "Stage 3C creates a typed plan only."
  },
  "hasSqlField": false,
  "durationMs": 893
}
```

### Nierozwiązane dowody BHP (jeśli wystąpiły)

Live Reference A kończy się `needs_graph_resolution`, gdy Stage 3A nie dostarcza
potwierdzonych obiektów/kolumn/joinów pod role biznesowe szablonu (bez hardcodu
nazw Oracle). Jawne luki w planie:

- source roles ze statusem `missing` / `ambiguous`
- projections bez `oracleColumnNodeId`
- joiny `unproven` / `missing` (bez cartesian)
- filtr `employee_active_on_oracle_sysdate` bez confirmed semantics

Fixture unit tests (pełny graf syntetyczny) osiągają `ready_for_compilation` —
to dowód, że kontrakt i reguły działają; live graf wymaga dalszego wzbogacenia
semantyki (poza Stage 3C).

## References B–F

```json
{
  "B": {
    "planStatus": "needs_user_clarification",
    "intent": "build_employee_report",
    "subject": "occupational_health_examinations",
    "rejection": {
      "code": "stage3b_needs_clarification",
      "message": "Stage 3B planningStatus=needs_clarification; query plan not created"
    },
    "sources": [],
    "projections": [],
    "joins": [],
    "filters": [],
    "ordering": [],
    "limits": {
      "maxRows": 500,
      "maxColumns": 20,
      "statementTimeoutMs": 30000
    },
    "authorization": {
      "status": "deferred",
      "assumedOracleUser": "TETA_ADMIN",
      "filtersApplied": false,
      "reason": "Authorization will be implemented in a later stage. Development environment assumes TETA_ADMIN with full privileges; this is not a production security model."
    },
    "unresolvedSelections": [],
    "warnings": [],
    "executionPolicy": {
      "sqlCompilationAllowed": false,
      "sqlExecutionAllowed": false,
      "oracleConnectionAllowed": false,
      "oracleWriteAllowed": false,
      "fileReadAllowed": false,
      "reason": "Stage 3C creates a typed plan only."
    },
    "hasSqlField": false,
    "durationMs": 0
  },
  "C": {
    "planStatus": "unsupported",
    "intent": "explain_payroll_component",
    "subject": "occupational_health_examinations",
    "rejection": {
      "code": "unsupported_for_stage3c",
      "message": "Intent explain_payroll_component is unsupported_for_stage3c"
    },
    "sources": [],
    "projections": [],
    "joins": [],
    "filters": [],
    "ordering": [],
    "limits": {
      "maxRows": 500,
      "maxColumns": 20,
      "statementTimeoutMs": 30000
    },
    "authorization": {
      "status": "deferred",
      "assumedOracleUser": "TETA_ADMIN",
      "filtersApplied": false,
      "reason": "Authorization will be implemented in a later stage. Development environment assumes TETA_ADMIN with full privileges; this is not a production security model."
    },
    "unresolvedSelections": [],
    "warnings": [],
    "executionPolicy": {
      "sqlCompilationAllowed": false,
      "sqlExecutionAllowed": false,
      "oracleConnectionAllowed": false,
      "oracleWriteAllowed": false,
      "fileReadAllowed": false,
      "reason": "Stage 3C creates a typed plan only."
    },
    "hasSqlField": false,
    "durationMs": 0
  },
  "D": {
    "planStatus": "needs_selection",
    "intent": "build_employee_report",
    "subject": "occupational_health_examinations",
    "rejection": {
      "code": "stage3b_blocking_ambiguity",
      "message": "Stage 3B has blocking ambiguity; automatic selection forbidden"
    },
    "sources": [],
    "projections": [],
    "joins": [],
    "filters": [],
    "ordering": [],
    "limits": {
      "maxRows": 500,
      "maxColumns": 20,
      "statementTimeoutMs": 30000
    },
    "authorization": {
      "status": "deferred",
      "assumedOracleUser": "TETA_ADMIN",
      "filtersApplied": false,
      "reason": "Authorization will be implemented in a later stage. Development environment assumes TETA_ADMIN with full privileges; this is not a production security model."
    },
    "unresolvedSelections": [
      {
        "subject": "health_examination_source",
        "reason": "two_equal_candidates",
        "candidateNodeIds": [
          "oracle-object:TETA_ADMIN:VIEW:A",
          "oracle-object:TETA_ADMIN:VIEW:B"
        ],
        "blocksPlanning": true
      }
    ],
    "warnings": [],
    "executionPolicy": {
      "sqlCompilationAllowed": false,
      "sqlExecutionAllowed": false,
      "oracleConnectionAllowed": false,
      "oracleWriteAllowed": false,
      "fileReadAllowed": false,
      "reason": "Stage 3C creates a typed plan only."
    },
    "hasSqlField": false,
    "durationMs": 0
  },
  "E": {
    "planStatus": "ready_for_compilation",
    "intent": "build_employee_report",
    "subject": "occupational_health_examinations",
    "rejection": null,
    "sources": [
      {
        "sourceRole": "employee",
        "status": "resolved",
        "logical": "TETA_ADMIN.NT_KP_PRC_PRACOWNICY",
        "access": "TETA_ADMIN_P.NT_KP_PRC_PRACOWNICY",
        "selectionReason": "confirmed_form_gateway_access_object",
        "candidates": [
          "oracle-object:TETA_ADMIN_P:SYNONYM:NT_KP_PRC_PRACOWNICY",
          "oracle-object:TETA_ADMIN:VIEW:NT_KP_PRC_PRACOWNICY",
          "oracle-object:TETA_ADMIN:TABLE:T_PRAC_BASE"
        ]
      },
      {
        "sourceRole": "health_examination",
        "status": "resolved",
        "logical": "TETA_ADMIN.NT_KP_BHP_BADANIA",
        "access": "TETA_ADMIN.NT_KP_BHP_BADANIA",
        "selectionReason": "confirmed_application_view",
        "candidates": [
          "oracle-object:TETA_ADMIN:VIEW:NT_KP_BHP_BADANIA"
        ]
      },
      {
        "sourceRole": "examination_type",
        "status": "resolved",
        "logical": "TETA_ADMIN.NT_KP_SLO_RODZAJE_BADAN",
        "access": "TETA_ADMIN.NT_KP_SLO_RODZAJE_BADAN",
        "selectionReason": "confirmed_application_view_teta_admin",
        "candidates": [
          "oracle-object:TETA_ADMIN:VIEW:NT_KP_SLO_RODZAJE_BADAN"
        ]
      },
      {
        "sourceRole": "current_position",
        "status": "resolved",
        "logical": "TETA_ADMIN.NT_KP_KDR_STANOWISKA",
        "access": "TETA_ADMIN.NT_KP_KDR_STANOWISKA",
        "selectionReason": "confirmed_application_view_teta_admin",
        "candidates": [
          "oracle-object:TETA_ADMIN:VIEW:NT_KP_KDR_STANOWISKA"
        ]
      },
      {
        "sourceRole": "organizational_unit",
        "status": "resolved",
        "logical": "TETA_ADMIN.NT_KP_ORG_JEDNOSTKI",
        "access": "TETA_ADMIN.NT_KP_ORG_JEDNOSTKI",
        "selectionReason": "confirmed_application_view_teta_admin",
        "candidates": [
          "oracle-object:TETA_ADMIN:VIEW:NT_KP_ORG_JEDNOSTKI"
        ]
      }
    ],
    "projections": [
      {
        "businessRole": "employee_number",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_PRC_PRACOWNICY:NR_EWD",
        "columnName": "NR_EWD"
      },
      {
        "businessRole": "employee_first_name",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_PRC_PRACOWNICY:IMIE",
        "columnName": "IMIE"
      },
      {
        "businessRole": "employee_last_name",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_PRC_PRACOWNICY:NAZWISKO",
        "columnName": "NAZWISKO"
      },
      {
        "businessRole": "examination_type_name",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_SLO_RODZAJE_BADAN:NAZWA",
        "columnName": "NAZWA"
      },
      {
        "businessRole": "examination_valid_from",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_BHP_BADANIA:DATA_OD",
        "columnName": "DATA_OD"
      },
      {
        "businessRole": "examination_valid_to",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_BHP_BADANIA:DATA_DO",
        "columnName": "DATA_DO"
      },
      {
        "businessRole": "position_name",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_KDR_STANOWISKA:NAZWA",
        "columnName": "NAZWA"
      },
      {
        "businessRole": "organizational_unit_name",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_ORG_JEDNOSTKI:NAZWA",
        "columnName": "NAZWA"
      }
    ],
    "joins": [
      {
        "joinId": "join:employee:current_position",
        "status": "resolved",
        "joinType": "left",
        "predicates": 1,
        "evidenceType": "foreign_key"
      },
      {
        "joinId": "join:employee:organizational_unit",
        "status": "resolved",
        "joinType": "left",
        "predicates": 1,
        "evidenceType": "foreign_key"
      },
      {
        "joinId": "join:health_examination:employee",
        "status": "resolved",
        "joinType": "inner",
        "predicates": 1,
        "evidenceType": "foreign_key"
      },
      {
        "joinId": "join:health_examination:examination_type",
        "status": "resolved",
        "joinType": "inner",
        "predicates": 1,
        "evidenceType": "foreign_key"
      }
    ],
    "filters": [
      {
        "filterRole": "examination_valid_to_in_current_month",
        "type": "half_open_date_interval",
        "status": "resolved",
        "columnOracleNodeId": "oracle-column:TETA_ADMIN:NT_KP_BHP_BADANIA:DATA_DO",
        "lower": {
          "clock": "oracle_sysdate",
          "transform": "month_start",
          "inclusive": true
        },
        "upper": {
          "clock": "oracle_sysdate",
          "transform": "next_month_start",
          "inclusive": false
        }
      },
      {
        "filterRole": "employee_active_on_oracle_sysdate",
        "type": "effective_on_date",
        "status": "resolved",
        "clock": "oracle_sysdate",
        "predicates": 1,
        "missingReason": null
      }
    ],
    "ordering": [
      {
        "orderRole": "examination_valid_to_ascending",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_BHP_BADANIA:DATA_DO",
        "direction": "ascending",
        "businessRole": "examination_valid_to"
      },
      {
        "orderRole": "employee_last_name_ascending",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_PRC_PRACOWNICY:NAZWISKO",
        "direction": "ascending",
        "businessRole": "employee_last_name"
      },
      {
        "orderRole": "employee_first_name_ascending",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_PRC_PRACOWNICY:IMIE",
        "direction": "ascending",
        "businessRole": "employee_first_name"
      }
    ],
    "limits": {
      "maxRows": 500,
      "maxColumns": 20,
      "statementTimeoutMs": 30000
    },
    "authorization": {
      "status": "deferred",
      "assumedOracleUser": "TETA_ADMIN",
      "filtersApplied": false,
      "reason": "Authorization will be implemented in a later stage. Development environment assumes TETA_ADMIN with full privileges; this is not a production security model."
    },
    "unresolvedSelections": [],
    "warnings": [],
    "executionPolicy": {
      "sqlCompilationAllowed": false,
      "sqlExecutionAllowed": false,
      "oracleConnectionAllowed": false,
      "oracleWriteAllowed": false,
      "fileReadAllowed": false,
      "reason": "Stage 3C creates a typed plan only."
    },
    "hasSqlField": false,
    "durationMs": 14
  },
  "F": {
    "planStatus": "needs_graph_resolution",
    "intent": "build_employee_report",
    "subject": "occupational_health_examinations",
    "rejection": null,
    "sources": [
      {
        "sourceRole": "employee",
        "status": "resolved",
        "logical": "TETA_ADMIN.NT_KP_PRC_PRACOWNICY",
        "access": "TETA_ADMIN_P.NT_KP_PRC_PRACOWNICY",
        "selectionReason": "confirmed_form_gateway_access_object",
        "candidates": [
          "oracle-object:TETA_ADMIN_P:SYNONYM:NT_KP_PRC_PRACOWNICY",
          "oracle-object:TETA_ADMIN:VIEW:NT_KP_PRC_PRACOWNICY",
          "oracle-object:TETA_ADMIN:TABLE:T_PRAC_BASE"
        ]
      },
      {
        "sourceRole": "health_examination",
        "status": "resolved",
        "logical": "TETA_ADMIN.NT_KP_BHP_BADANIA",
        "access": "TETA_ADMIN.NT_KP_BHP_BADANIA",
        "selectionReason": "confirmed_application_view",
        "candidates": [
          "oracle-object:TETA_ADMIN:VIEW:NT_KP_BHP_BADANIA"
        ]
      },
      {
        "sourceRole": "examination_type",
        "status": "resolved",
        "logical": "TETA_ADMIN.NT_KP_SLO_RODZAJE_BADAN",
        "access": "TETA_ADMIN.NT_KP_SLO_RODZAJE_BADAN",
        "selectionReason": "confirmed_application_view_teta_admin",
        "candidates": [
          "oracle-object:TETA_ADMIN:VIEW:NT_KP_SLO_RODZAJE_BADAN"
        ]
      },
      {
        "sourceRole": "current_position",
        "status": "resolved",
        "logical": "TETA_ADMIN.NT_KP_KDR_STANOWISKA",
        "access": "TETA_ADMIN.NT_KP_KDR_STANOWISKA",
        "selectionReason": "confirmed_application_view_teta_admin",
        "candidates": [
          "oracle-object:TETA_ADMIN:VIEW:NT_KP_KDR_STANOWISKA"
        ]
      },
      {
        "sourceRole": "organizational_unit",
        "status": "resolved",
        "logical": "TETA_ADMIN.NT_KP_ORG_JEDNOSTKI",
        "access": "TETA_ADMIN.NT_KP_ORG_JEDNOSTKI",
        "selectionReason": "confirmed_application_view_teta_admin",
        "candidates": [
          "oracle-object:TETA_ADMIN:VIEW:NT_KP_ORG_JEDNOSTKI"
        ]
      }
    ],
    "projections": [
      {
        "businessRole": "employee_number",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_PRC_PRACOWNICY:NR_EWD",
        "columnName": "NR_EWD"
      },
      {
        "businessRole": "employee_first_name",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_PRC_PRACOWNICY:IMIE",
        "columnName": "IMIE"
      },
      {
        "businessRole": "employee_last_name",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_PRC_PRACOWNICY:NAZWISKO",
        "columnName": "NAZWISKO"
      },
      {
        "businessRole": "examination_type_name",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_SLO_RODZAJE_BADAN:NAZWA",
        "columnName": "NAZWA"
      },
      {
        "businessRole": "examination_valid_from",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_BHP_BADANIA:DATA_OD",
        "columnName": "DATA_OD"
      },
      {
        "businessRole": "examination_valid_to",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_BHP_BADANIA:DATA_DO",
        "columnName": "DATA_DO"
      },
      {
        "businessRole": "position_name",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_KDR_STANOWISKA:NAZWA",
        "columnName": "NAZWA"
      },
      {
        "businessRole": "organizational_unit_name",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_ORG_JEDNOSTKI:NAZWA",
        "columnName": "NAZWA"
      }
    ],
    "joins": [
      {
        "joinId": "join:employee:current_position",
        "status": "unproven",
        "joinType": "left",
        "predicates": 0,
        "evidenceType": null
      },
      {
        "joinId": "join:employee:organizational_unit",
        "status": "unproven",
        "joinType": "left",
        "predicates": 0,
        "evidenceType": null
      },
      {
        "joinId": "join:health_examination:employee",
        "status": "unproven",
        "joinType": "inner",
        "predicates": 0,
        "evidenceType": null
      },
      {
        "joinId": "join:health_examination:examination_type",
        "status": "unproven",
        "joinType": "inner",
        "predicates": 0,
        "evidenceType": null
      }
    ],
    "filters": [
      {
        "filterRole": "examination_valid_to_in_current_month",
        "type": "half_open_date_interval",
        "status": "resolved",
        "columnOracleNodeId": "oracle-column:TETA_ADMIN:NT_KP_BHP_BADANIA:DATA_DO",
        "lower": {
          "clock": "oracle_sysdate",
          "transform": "month_start",
          "inclusive": true
        },
        "upper": {
          "clock": "oracle_sysdate",
          "transform": "next_month_start",
          "inclusive": false
        }
      },
      {
        "filterRole": "employee_active_on_oracle_sysdate",
        "type": "effective_on_date",
        "status": "resolved",
        "clock": "oracle_sysdate",
        "predicates": 1,
        "missingReason": null
      }
    ],
    "ordering": [
      {
        "orderRole": "examination_valid_to_ascending",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_BHP_BADANIA:DATA_DO",
        "direction": "ascending",
        "businessRole": "examination_valid_to"
      },
      {
        "orderRole": "employee_last_name_ascending",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_PRC_PRACOWNICY:NAZWISKO",
        "direction": "ascending",
        "businessRole": "employee_last_name"
      },
      {
        "orderRole": "employee_first_name_ascending",
        "status": "resolved",
        "oracleColumnNodeId": "oracle-column:TETA_ADMIN:NT_KP_PRC_PRACOWNICY:IMIE",
        "direction": "ascending",
        "businessRole": "employee_first_name"
      }
    ],
    "limits": {
      "maxRows": 500,
      "maxColumns": 20,
      "statementTimeoutMs": 30000
    },
    "authorization": {
      "status": "deferred",
      "assumedOracleUser": "TETA_ADMIN",
      "filtersApplied": false,
      "reason": "Authorization will be implemented in a later stage. Development environment assumes TETA_ADMIN with full privileges; this is not a production security model."
    },
    "unresolvedSelections": [],
    "warnings": [],
    "executionPolicy": {
      "sqlCompilationAllowed": false,
      "sqlExecutionAllowed": false,
      "oracleConnectionAllowed": false,
      "oracleWriteAllowed": false,
      "fileReadAllowed": false,
      "reason": "Stage 3C creates a typed plan only."
    },
    "hasSqlField": false,
    "durationMs": 3
  }
}
```

## Audit metrics

| Metryka | Wartość |
|---------|---------|
| plansTested | **6** |
| ready / needs_graph / needs_selection / unsupported / invalid | **1** / **2** / **1** / **1** / **1** |
| sourceRoles resolved/ambiguous/missing | **10** / **0** / **5** |
| projections resolved/ambiguous/missing | **16** / **0** / **8** |
| joins resolved/missing | **4** / **8** |
| unprovenJoinPredicates / cartesianJoins / disconnected | **8** / **0** / **0** |
| filters resolved/missing | **4** / **2** |
| finalSqlGenerated / sqlExecuted / oracleConnections | **0** / **0** / **0** |
| average / max planning ms | **152** / **893** |
| deterministicCheckOk | **true** |

## Strict errors

_none_

## Potwierdzenie

**Nie powstał finalny SQL.** Stage 3C kończy się na typowanym `TetaReadOnlyQueryPlan`.
