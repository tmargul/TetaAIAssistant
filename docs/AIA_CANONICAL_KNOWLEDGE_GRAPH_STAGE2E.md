# AIA Canonical Knowledge Graph — Stage 2E
Wygenerowano: **2026-07-23T10:14:44.465Z**
identityVersion: `teta-aia-canonical-id-v1`
Oracle enrichment: **ON**
## Zakres
- Etapy **1 / 2A / 2B / 2C / 2D** bez zmian logiki i faktów — tylko odczyt artefaktów.
- Kanoniczny graf: `nodes[]` + `edges[]` + provenance + Oracle metadata enrichment.
- **Bez** generatora SQL, Qdrant, embeddingów, zmian agenta czatu.
## Audyt
| Metryka | Wartość |
|---------|---------|
| nodes total | **836241** |
| edges total | **888292** |
| forms / controls / help fields | **3561** / **98810** / **26658** |
| target / lookup bindings | **53195** / **834** |
| gateways / datasets / mainSources | **3238** / **8390** / **5684** |
| joins / projected / calculated | **7086** / **48731** / **1280** |
| Oracle confirmed / missing | **19911** / **898** |
| Oracle columns / packages / procs / funcs / args | **138079** / **4790** / **29399** / **16212** / **340715** |
| FK / DEPENDS_ON | **3220** / **11136** |
| conflicts / unresolved / orphans | **5432** / **0** / **11154** |
| broken edges / duplicate IDs | **0** / **0** |
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
  "dotnet_type": 4827,
  "gateway": 3238,
  "oracle_object": 16019,
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
  "oracle_argument": 340715
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
  "INHERITS_FROM": 7919,
  "RESOLVES_TO_GATEWAY": 7114,
  "MAPS_TO_ORACLE_OBJECT": 28225,
  "USES_PACKAGE": 3196,
  "BINDS_LOOKUP": 834,
  "HAS_HELP": 1771,
  "DESCRIBES": 26658,
  "LABEL_FOR": 8333,
  "DISPLAYS_FROM": 131,
  "MAPS_TO_ORACLE_COLUMN": 131,
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
  "HAS_FUNCTION": 15984
}
```
## Referencje A–F
```json
{
  "A_TypStanowiska": {
    "ok": true,
    "form": "Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok",
    "helpField": "Typ stanowiska",
    "control": "lcboTypStanowiska",
    "targetBindings": [
      "KartaOpisuStanowiska.ZSTP_ID"
    ],
    "lookupBindings": [
      {
        "name": "TypyStanowisk.ID/NAZWA",
        "valueMember": "ID",
        "displayMember": "NAZWA",
        "displaysFrom": [
          "TypyStanowisk.NAZWA"
        ]
      }
    ],
    "oracleObjects": [
      "NT_KP_KOS_KARTA_OPISU_STAN",
      "NT_KP_KOS_KARTA_OPISU_STAN_DAC",
      "TETA.SUMO.PERSONEL.BOSSKOS.MTG.KARTAOPISUSTANOWISKANAGLOWEKMTG",
      "TypyStanowisk.NAZWA",
      "TypyStanowisk.ID"
    ]
  },
  "B_DicRodzajeKoncesji": {
    "ok": true,
    "form": "Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji",
    "controls": [
      {
        "control": "dgcKod",
        "targets": [
          "RodzajeKoncesji.KOD"
        ],
        "present": true
      },
      {
        "control": "dgcNazwa",
        "targets": [
          "RodzajeKoncesji.NAZWA"
        ],
        "present": true
      },
      {
        "control": "dgcAktualna",
        "targets": [
          "RodzajeKoncesji.UP_TO_DATE"
        ],
        "present": true
      }
    ],
    "gateways": [
      "Teta.Sumo.Sales.bosSalesDictionaries.TG.RodzajeKoncesjiTG",
      "Teta.Sumo.Sales.bosSalesDictionaries.MTG.RodzajeKoncesjiMTG"
    ],
    "oracleObjects": [
      {
        "name": "NT_LG_SLO_RODZAJE_KONCESJI",
        "status": "confirmed",
        "type": "VIEW"
      },
      {
        "name": "NT_LG_SLO_RODZAJE_KONCESJI_DAC",
        "status": "confirmed",
        "type": "PACKAGE"
      },
      {
        "name": "NT_LG_SLO_RODZAJE_KONCESJI_DAC",
        "status": "confirmed",
        "type": "VIEW"
      },
      {
        "name": "NT_LG_SLO_RODZAJE_KONCESJI",
        "status": "confirmed",
        "type": "VIEW"
      },
      {
        "name": "NT_LG_SLO_RODZAJE_KONCESJI",
        "status": "confirmed",
        "type": "VIEW"
      },
      {
        "name": "NT_LG_SLO_RODZAJE_KONCESJI_DAC",
        "status": "confirmed",
        "type": "PACKAGE"
      },
      {
        "name": "NT_LG_SLO_RODZAJE_KONCESJI_DAC",
        "status": "confirmed",
        "type": "SYNONYM"
      },
      {
        "name": "LG_KNC_RODZAJE_KONCESJI",
        "status": "confirmed",
        "type": "TABLE"
      },
      {
        "name": "LG_KNC_RODZAJE_KONCESJI",
        "status": "confirmed",
        "type": "SYNONYM"
      }
    ]
  },
  "C_SkladnikiNarastajacoBO": {
    "ok": true,
    "datasetTable": "SkladnikiNarastajaco",
    "mainSource": {
      "objectName": "NT_KP_PLC_SKLADNIKI_NARAST",
      "alias": "LSNA",
      "canonical": "NT_KP_PLC_SKLADNIKI_NARAST AS LSNA"
    },
    "joinAliases": [
      "SSNA",
      "SKLP",
      "LIST",
      "PIDO",
      "PITM",
      "JEOR"
    ],
    "jeorCondition": {
      "leftAlias": "JEOR",
      "leftColumn": "ID",
      "operator": "=",
      "rightAlias": "PIDO",
      "rightColumn": "JEOR_ID",
      "confidence": "confirmed_from_literal"
    },
    "jeorNazwa": "JEOR_NAZWA",
    "calculated": {
      "packages": [
        "KP_LISP_SQL"
      ],
      "functions": [
        "Get_Status_For_Pit11"
      ]
    },
    "form": "Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok"
  },
  "D_ListyZamkniete": {
    "ok": true,
    "form": "Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok",
    "control": "tbbZamknijMiesiac",
    "parameterName": "KP_UPR_KART_LIST_ZAMKNIJ_MIES",
    "falselyBoundAsOracleColumn": false,
    "isAction": true
  },
  "E_MissingHelp": {
    "ok": true,
    "missingHelpForms": 1662,
    "sampleForm": "Teta.Sumo.Personel.plgPersonelParametryRap.Pity.PrmPit40",
    "sampleControlCount": 21,
    "confidenceNotLowered": true
  },
  "F_MissingInDb": {
    "ok": true,
    "missingCount": 898,
    "sample": {
      "id": "oracle-object:UNKNOWN:VIEW:DUMMY",
      "name": "DUMMY",
      "sourceStage": [
        "2B",
        "2D"
      ],
      "oracleValidationStatus": "missing_in_current_db",
      "technicalFactPreserved": true
    }
  }
}
```
JSON: `docs/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.json`
Pełny dump: `.local/AIA_CANONICAL_KNOWLEDGE_GRAPH_STAGE2E.full.ndjson`
CLI: `pnpm --filter @teta/api run diagnose:stage2e`