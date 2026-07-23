# AIA Canonical Knowledge Graph — Stage 2E
Wygenerowano: **2026-07-23T13:12:24.590Z**
identityVersion: `teta-aia-canonical-id-v1`
Oracle enrichment: **ON**
## Zakres
- Etapy **1 / 2A / 2B / 2C / 2D / 2E** bez zmian ekstraktorów — Stage 2E.1 to post-processing.
- Kanoniczny graf: `nodes[]` + `edges[]` + provenance + domeny + semantic integrity.
- **Bez** generatora SQL, Qdrant, embeddingów, zmian agenta czatu.
## Audyt (Stage 2E)
| Metryka | Wartość |
|---------|---------|
| nodes total | **869492** |
| edges total | **992993** |
| forms / controls / help fields | **3561** / **98810** / **26658** |
| target / lookup bindings | **53195** / **834** |
| gateways / datasets / mainSources | **3238** / **8390** / **5684** |
| joins / projected / calculated | **7086** / **48731** / **1280** |
| Oracle confirmed / missing | **19911** / **898** |
| Oracle columns / packages / procs / funcs / args | **138079** / **4790** / **29399** / **16212** / **340715** |
| FK / DEPENDS_ON | **3220** / **11136** |
| conflicts / unresolvedNodes / unresolvedConflicts | **5432** / **0** / **5432** |
| orphan total / expected / unexpected / invalidDomain | **11308** / **11308** / **0** / **0** |
| broken edges / duplicate IDs | **0** / **0** |
## Stage 2E.1 — semantic integrity normalization
| Metryka | Wartość |
|---------|---------|
| invalidOracleCandidates (dotnet / datasetCol / other) | **0** (**0** / **0** / **0**) |
| datasetColumnsCreated / resolvedToOracle / unresolved | **0** / **13171** / **12398** |
| domainEdgeViolations | **0** |
| oracleIdentityCollisions | **0** |
| synonymsResolved / unresolved | **0** / **4640** |
| referenceChainsWithTypedIds / invalidDomain | **6** / **0** |

### Nodes by domain

```json
{
  "application": 167940,
  "dotnet": 12368,
  "oracle": 555612,
  "help": 28429,
  "dataset": 105143
}
```

### Examples — invalidOracleCandidatesDotnet (20)

_brak_

### Examples — invalidOracleCandidatesDatasetColumn (20)

_brak_

### Coverage per stage
```json
{
  "stage1": 3561,
  "stage2a": 2794,
  "stage2b": 50245,
  "stage2c": 3561,
  "stage2d": 8390
}
```
### Nodes by type
```json
{
  "plugin_registry_entry": 3561,
  "application_form": 3561,
  "assembly": 362,
  "business_object": 2430,
  "data_source": 7979,
  "action_control": 5240,
  "ui_control": 93570,
  "target_binding": 53195,
  "data_factory": 1494,
  "dotnet_type": 4844,
  "gateway": 3238,
  "oracle_object": 15281,
  "oracle_package": 4790,
  "lookup_binding": 834,
  "help_document": 1771,
  "help_field": 26658,
  "oracle_column": 138079,
  "dataset": 8390,
  "main_source": 5684,
  "join": 7086,
  "projected_column": 48731,
  "calculated_column": 1280,
  "oracle_function": 16212,
  "oracle_dependency": 11136,
  "oracle_procedure": 29399,
  "oracle_argument": 340715,
  "dataset_column": 33972
}
```
### Edges by type
```json
{
  "REGISTERED_AS": 3561,
  "IMPLEMENTED_BY": 3433,
  "USES_BO": 2800,
  "USES_DATASOURCE": 7979,
  "HAS_CONTROL": 98748,
  "BINDS_TARGET": 53195,
  "USES_DF": 3825,
  "INHERITS_FROM": 7925,
  "RESOLVES_TO_GATEWAY": 7114,
  "MAPS_TO_ORACLE_OBJECT": 23958,
  "USES_PACKAGE": 3196,
  "BINDS_LOOKUP": 834,
  "HAS_HELP": 1771,
  "DESCRIBES": 26658,
  "LABEL_FOR": 8333,
  "DISPLAYS_FROM": 834,
  "MAPS_TO_DATASET_COLUMN": 54994,
  "PRODUCES_DATASET": 8390,
  "READS_FROM": 5684,
  "JOINS_TO": 7086,
  "PROJECTS": 48051,
  "DERIVED_FROM": 2633,
  "CALLS_FUNCTION": 348,
  "VALIDATED_BY_ORACLE": 12347,
  "HAS_COLUMN": 137614,
  "PRIMARY_KEY_OF": 1112,
  "UNIQUE_KEY_OF": 1681,
  "FOREIGN_KEY_TO": 3220,
  "REFERENCES": 2824,
  "DEPENDS_ON": 11136,
  "HAS_PROCEDURE": 29399,
  "HAS_ARGUMENT": 342930,
  "HAS_FUNCTION": 15984,
  "RESOLVES_TO_ORACLE_COLUMN": 26100,
  "HAS_DATASET_COLUMN": 27296
}
```
## Referencje A–F (typed)
```json
{
  "A_TypStanowiska": {
    "ok": true,
    "formNodeId": "form:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok",
    "controlNodeId": "control:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska",
    "helpFieldNodeId": "help-field:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:linked:d36236:typ stanowiska",
    "targetBindingNodeId": "binding-target:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska:KartaOpisuStanowiska:ZSTP_ID",
    "lookupBindingNodeId": "binding-lookup:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska:TypyStanowisk:ID:NAZWA",
    "targetDatasetColumnId": "dataset-column:KartaOpisuStanowiska:ZSTP_ID",
    "lookupValueDatasetColumnId": "dataset-column:TypyStanowisk:ID",
    "lookupDisplayDatasetColumnId": "dataset-column:TypyStanowisk:NAZWA",
    "targetOracleColumnId": "oracle-column:TETA_ADMIN:NT_KP_KOS_KARTA_OPISU_STAN:ZSTP_ID",
    "lookupValueOracleColumnId": "oracle-column:TETA_ADMIN:NT_KP_SLO_TYPY_STANOWISK:ID",
    "lookupDisplayOracleColumnId": "oracle-column:TETA_ADMIN:NT_KP_SLO_TYPY_STANOWISK:NAZWA",
    "nodeIds": [
      "form:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok",
      "help-field:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:linked:d36236:typ stanowiska",
      "control:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska",
      "binding-target:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska:KartaOpisuStanowiska:ZSTP_ID",
      "binding-lookup:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska:TypyStanowisk:ID:NAZWA",
      "dataset-column:KartaOpisuStanowiska:ZSTP_ID",
      "dataset-column:TypyStanowisk:ID",
      "dataset-column:TypyStanowisk:NAZWA",
      "oracle-column:TETA_ADMIN:NT_KP_KOS_KARTA_OPISU_STAN:ZSTP_ID",
      "oracle-column:TETA_ADMIN:NT_KP_SLO_TYPY_STANOWISK:ID",
      "oracle-column:TETA_ADMIN:NT_KP_SLO_TYPY_STANOWISK:NAZWA"
    ],
    "edgeIds": [
      "edge:DESCRIBES:help-field:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:linked:d36236:typ stanowiska:control:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska",
      "edge:BINDS_TARGET:control:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska:binding-target:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska:KartaOpisuStanowiska:ZSTP_ID",
      "edge:BINDS_LOOKUP:control:8efdd60e-ac8b-4501-947a-4cb89ccdb082:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska:binding-lookup:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska:TypyStanowisk:ID:NAZWA",
      "edge:MAPS_TO_DATASET_COLUMN:binding-target:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska:KartaOpisuStanowiska:ZSTP_ID:dataset-column:KartaOpisuStanowiska:ZSTP_ID",
      "edge:RESOLVES_TO_ORACLE_COLUMN:dataset-column:KartaOpisuStanowiska:ZSTP_ID:oracle-column:TETA_ADMIN:NT_KP_KOS_KARTA_OPISU_STAN:ZSTP_ID",
      "edge:MAPS_TO_DATASET_COLUMN:binding-lookup:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska:TypyStanowisk:ID:NAZWA:dataset-column:TypyStanowisk:ID:f32b67c7e263",
      "edge:DISPLAYS_FROM:binding-lookup:Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok:lcboTypStanowiska:TypyStanowisk:ID:NAZWA:oracle-column:UNKNOWN:TYPYSTANOWISK:NAZWA",
      "edge:RESOLVES_TO_ORACLE_COLUMN:dataset-column:TypyStanowisk:ID:oracle-column:TETA_ADMIN:NT_KP_SLO_TYPY_STANOWISK:ID",
      "edge:RESOLVES_TO_ORACLE_COLUMN:dataset-column:TypyStanowisk:NAZWA:oracle-column:TETA_ADMIN:NT_KP_SLO_TYPY_STANOWISK:NAZWA"
    ],
    "validation": []
  },
  "B_DicRodzajeKoncesji": {
    "ok": true,
    "formNodeId": "form:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji",
    "controlNodeIds": [
      "control:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcKod",
      "control:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcNazwa",
      "control:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcAktualna"
    ],
    "oracleObjects": [
      {
        "nodeId": "oracle-object:UNKNOWN:VIEW:NT_LG_SLO_RODZAJE_KONCESJI",
        "owner": "UNKNOWN",
        "objectType": "VIEW",
        "objectName": "NT_LG_SLO_RODZAJE_KONCESJI",
        "validationStatus": "confirmed"
      },
      {
        "nodeId": "oracle-package:UNKNOWN:NT_LG_SLO_RODZAJE_KONCESJI_DAC",
        "owner": "UNKNOWN",
        "objectType": "PACKAGE",
        "objectName": "NT_LG_SLO_RODZAJE_KONCESJI_DAC",
        "validationStatus": "confirmed"
      },
      {
        "nodeId": "oracle-object:UNKNOWN:VIEW:NT_LG_SLO_RODZAJE_KONCESJI_DAC",
        "owner": "UNKNOWN",
        "objectType": "VIEW",
        "objectName": "NT_LG_SLO_RODZAJE_KONCESJI_DAC",
        "validationStatus": "confirmed"
      },
      {
        "nodeId": "oracle-object:TETA_ADMIN:VIEW:NT_LG_SLO_RODZAJE_KONCESJI",
        "owner": "TETA_ADMIN",
        "objectType": "VIEW",
        "objectName": "NT_LG_SLO_RODZAJE_KONCESJI",
        "validationStatus": "confirmed"
      },
      {
        "nodeId": "oracle-object:TETA_ADMIN_P:VIEW:NT_LG_SLO_RODZAJE_KONCESJI",
        "owner": "TETA_ADMIN_P",
        "objectType": "VIEW",
        "objectName": "NT_LG_SLO_RODZAJE_KONCESJI",
        "validationStatus": "confirmed"
      },
      {
        "nodeId": "oracle-package:TETA_ADMIN:NT_LG_SLO_RODZAJE_KONCESJI_DAC",
        "owner": "TETA_ADMIN",
        "objectType": "PACKAGE",
        "objectName": "NT_LG_SLO_RODZAJE_KONCESJI_DAC",
        "validationStatus": "confirmed"
      },
      {
        "nodeId": "oracle-object:TETA_ADMIN_P:SYNONYM:NT_LG_SLO_RODZAJE_KONCESJI_DAC",
        "owner": "TETA_ADMIN_P",
        "objectType": "SYNONYM",
        "objectName": "NT_LG_SLO_RODZAJE_KONCESJI_DAC",
        "validationStatus": "confirmed"
      },
      {
        "nodeId": "oracle-object:TETA_ADMIN:TABLE:LG_KNC_RODZAJE_KONCESJI",
        "owner": "TETA_ADMIN",
        "objectType": "TABLE",
        "objectName": "LG_KNC_RODZAJE_KONCESJI",
        "validationStatus": "confirmed"
      },
      {
        "nodeId": "oracle-object:TETA_ADMIN_P:SYNONYM:LG_KNC_RODZAJE_KONCESJI",
        "owner": "TETA_ADMIN_P",
        "objectType": "SYNONYM",
        "objectName": "LG_KNC_RODZAJE_KONCESJI",
        "validationStatus": "confirmed"
      }
    ],
    "nodeIds": [
      "form:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji",
      "control:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcKod",
      "control:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcNazwa",
      "control:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcAktualna",
      "oracle-object:UNKNOWN:VIEW:NT_LG_SLO_RODZAJE_KONCESJI",
      "oracle-package:UNKNOWN:NT_LG_SLO_RODZAJE_KONCESJI_DAC",
      "oracle-object:UNKNOWN:VIEW:NT_LG_SLO_RODZAJE_KONCESJI_DAC",
      "oracle-object:TETA_ADMIN:VIEW:NT_LG_SLO_RODZAJE_KONCESJI",
      "oracle-object:TETA_ADMIN_P:VIEW:NT_LG_SLO_RODZAJE_KONCESJI",
      "oracle-package:TETA_ADMIN:NT_LG_SLO_RODZAJE_KONCESJI_DAC",
      "oracle-object:TETA_ADMIN_P:SYNONYM:NT_LG_SLO_RODZAJE_KONCESJI_DAC",
      "oracle-object:TETA_ADMIN:TABLE:LG_KNC_RODZAJE_KONCESJI",
      "oracle-object:TETA_ADMIN_P:SYNONYM:LG_KNC_RODZAJE_KONCESJI"
    ],
    "edgeIds": [
      "edge:HAS_CONTROL:form:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:control:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcKod",
      "edge:BINDS_TARGET:control:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcKod:binding-target:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcKod:RodzajeKoncesji:KOD",
      "edge:HAS_CONTROL:form:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:control:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcNazwa",
      "edge:BINDS_TARGET:control:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcNazwa:binding-target:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcNazwa:RodzajeKoncesji:NAZWA",
      "edge:HAS_CONTROL:form:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:control:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcAktualna",
      "edge:BINDS_TARGET:control:670ab806-2885-4f00-94cf-e86a5f545c85:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcAktualna:binding-target:Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji:dgcAktualna:RodzajeKoncesji:UP_TO_DATE"
    ],
    "validation": []
  },
  "C_SkladnikiNarastajacoBO": {
    "ok": true,
    "datasetNodeId": "dataset:bosListaPlac.dll:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SkladnikiNarastajaco",
    "mainSourceNodeId": "main-source:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:NT_KP_PLC_SKLADNIKI_NARAST:LSNA",
    "joinNodeIds": [
      "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SSNA:NT_KP_SLO_SKLADNIKI_NARAST:af217022af30",
      "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SKLP:NT_KP_SLO_SKLADNIKI_PLAC:630f61de7a62",
      "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:LIST:NT_KP_SLO_LISTY_PLAC:4544a9bffecb",
      "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:PIDO:KP_PLC_PIT_CORE_DATA:3120212dade9",
      "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:PITM:KP_SLO_PIT_TEMPLATES:e9b71613ef08",
      "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:JEOR:TETA_JEDN_ORG:c74a61e48593"
    ],
    "jeorJoinNodeId": "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:JEOR:TETA_JEDN_ORG:c74a61e48593",
    "calculatedColumnNodeId": "calculated:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:e80815c1a6e6",
    "packageNodeId": "oracle-package:UNKNOWN:KP_LISP_SQL",
    "functionNodeId": "oracle-function:UNKNOWN:KP_LISP_SQL:GET_STATUS_FOR_PIT11:0",
    "nodeIds": [
      "dataset:bosListaPlac.dll:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SkladnikiNarastajaco",
      "main-source:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:NT_KP_PLC_SKLADNIKI_NARAST:LSNA",
      "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SSNA:NT_KP_SLO_SKLADNIKI_NARAST:af217022af30",
      "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SKLP:NT_KP_SLO_SKLADNIKI_PLAC:630f61de7a62",
      "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:LIST:NT_KP_SLO_LISTY_PLAC:4544a9bffecb",
      "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:PIDO:KP_PLC_PIT_CORE_DATA:3120212dade9",
      "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:PITM:KP_SLO_PIT_TEMPLATES:e9b71613ef08",
      "join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:JEOR:TETA_JEDN_ORG:c74a61e48593",
      "calculated:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:e80815c1a6e6",
      "oracle-package:UNKNOWN:KP_LISP_SQL",
      "oracle-function:UNKNOWN:KP_LISP_SQL:GET_STATUS_FOR_PIT11:0"
    ],
    "edgeIds": [
      "edge:READS_FROM:dataset:bosListaPlac.dll:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SkladnikiNarastajaco:main-source:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:NT_KP_PLC_SKLADNIKI_NARAST:LSNA",
      "edge:JOINS_TO:dataset:bosListaPlac.dll:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SkladnikiNarastajaco:join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SSNA:NT_KP_SLO_SKLADNIKI_NARAST:af217022af30",
      "edge:JOINS_TO:dataset:bosListaPlac.dll:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SkladnikiNarastajaco:join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SKLP:NT_KP_SLO_SKLADNIKI_PLAC:630f61de7a62",
      "edge:JOINS_TO:dataset:bosListaPlac.dll:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SkladnikiNarastajaco:join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:LIST:NT_KP_SLO_LISTY_PLAC:4544a9bffecb",
      "edge:JOINS_TO:dataset:bosListaPlac.dll:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SkladnikiNarastajaco:join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:PIDO:KP_PLC_PIT_CORE_DATA:3120212dade9",
      "edge:JOINS_TO:dataset:bosListaPlac.dll:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SkladnikiNarastajaco:join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:PITM:KP_SLO_PIT_TEMPLATES:e9b71613ef08",
      "edge:JOINS_TO:dataset:bosListaPlac.dll:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:SkladnikiNarastajaco:join:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:JEOR:TETA_JEDN_ORG:c74a61e48593",
      "edge:USES_PACKAGE:calculated:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:e80815c1a6e6:oracle-package:UNKNOWN:KP_LISP_SQL",
      "edge:CALLS_FUNCTION:calculated:Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO:e80815c1a6e6:oracle-function:UNKNOWN:KP_LISP_SQL:GET_STATUS_FOR_PIT11:0"
    ],
    "validation": []
  },
  "D_ListyZamkniete": {
    "ok": true,
    "formNodeId": "form:7b4f2b80-4853-409d-8dc7-06cd10c8925b:Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok",
    "controlNodeId": "action:7b4f2b80-4853-409d-8dc7-06cd10c8925b:Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok:tbbZamknijMiesiac",
    "parameterName": "KP_UPR_KART_LIST_ZAMKNIJ_MIES",
    "falselyBoundAsOracleColumn": false,
    "nodeIds": [
      "form:7b4f2b80-4853-409d-8dc7-06cd10c8925b:Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok",
      "action:7b4f2b80-4853-409d-8dc7-06cd10c8925b:Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok:tbbZamknijMiesiac"
    ],
    "edgeIds": [
      "edge:HAS_CONTROL:form:7b4f2b80-4853-409d-8dc7-06cd10c8925b:Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok:action:7b4f2b80-4853-409d-8dc7-06cd10c8925b:Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok:tbbZamknijMiesiac"
    ],
    "validation": []
  },
  "E_MissingHelp": {
    "ok": true,
    "missingHelpForms": 1662,
    "sampleFormNodeId": "form:02e54042-6570-421e-9212-af1ee889f7e3:Teta.Sumo.Personel.plgPersonelParametryRap.Pity.PrmPit40",
    "sampleControlCount": 21,
    "hasHelpDocument": false,
    "confidenceNotLowered": true,
    "nodeIds": [
      "form:02e54042-6570-421e-9212-af1ee889f7e3:Teta.Sumo.Personel.plgPersonelParametryRap.Pity.PrmPit40"
    ],
    "edgeIds": [],
    "validation": []
  },
  "F_MissingInDb": {
    "ok": true,
    "missingCount": 162,
    "sample": {
      "nodeId": "oracle-object:UNKNOWN:VIEW:DUMMY",
      "owner": "UNKNOWN",
      "objectType": "VIEW",
      "objectName": "DUMMY",
      "oracleValidationStatus": "missing_in_current_db",
      "technicalFactPreserved": true,
      "canonicalOracleIdentity": "UNKNOWN.VIEW.DUMMY"
    },
    "nodeIds": [
      "oracle-object:UNKNOWN:VIEW:DUMMY"
    ],
    "edgeIds": [],
    "validation": []
  }
}
```
JSON: `docs/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.json`
Pełny dump: `.local/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.full.ndjson`
CLI: `pnpm --filter @teta/api run diagnose:stage2e -- --from-existing --strict-semantic`