# AIA bos / Oracle mapping — Stage 2B

Wygenerowano: **2026-07-22T19:40:34.430Z** (static IL + Oracle validation)

## Zakres

- Etap 1 i Etap 2A **bez zmian**.
- Wejście: BO/DF + bos DLL z artefaktów Stage 2A (nie pełny skan wszystkich DLL).
- Analiza: System.Reflection.Metadata + IL (gettery, ctory, settery TG/MTG) — **bez** wykonywania kodu.
- Oracle: read-only `ALL_OBJECTS` (VIEW/TABLE/PACKAGE). Fakt DLL nie jest usuwany przy braku obiektu w bazie.
- **Bez** Help HTML, SqlJoin, generatora SQL, Qdrant.

Oracle: OK
Search roots: A:\TETA Aplikacja klienta - 33.5 | A:\TETA Serwer Aplikacji - 33.5

## Audyt

| Metryka | Wartość |
|---------|---------|
| bos DLL referenced | **304** |
| bos DLL resolved | **304** |
| bos DLL missing | **0** |
| bos DLL duplicate_different_hash | 0 |
| bos DLL unreadable | 0 |
| BO requested / found | **2800** / **2424** |
| DF requested / found | **3825** / **1493** |
| Gateway types | **3238** |
| Dataset tables | **13519** |
| Views / base tables / packages | **2065** / **415** / **2211** |
| Package operations (descriptors) | 2859 |
| Oracle confirmed / missing-in-db | **5572** / **502** |
| formDatasource→gatewayDataset | **37825** |
| formColumn→oracleColumn | **15394** |
| Lookup conflicts resolved semantically | **948** |
| Unresolved lookup conflicts | 179 |
| Inheritance chains resolved | 7926 |

## Przykłady gateway (20)

- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracAgrTG: ds=undefined view=NT_KP_PLC_SKL_LISTY_AGR alias=LSKO pkg=undefined [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=undefined)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: ds=undefined view=NT_KP_PLC_SKLADNIKI_OBL alias=LSKO pkg=NT_KP_PLC_SKLADNIKI_OBL_DAC [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=confirmed_in_oracle)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: ds=undefined view=NT_KP_PLC_MIESIACE alias=TBL1 pkg=undefined [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=undefined)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknAgrTG: ds=undefined view=NT_KP_PLC_MIESIACE_AGR alias=LMIE pkg=undefined [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=undefined)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiNarastajacoTG: ds=SkladnikiNarastajaco view=NT_KP_PLC_SKLADNIKI_NARAST alias=LSNA pkg=NT_KP_PLC_SKLADNIKI_NARAST_DAC [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=confirmed_in_oracle)
- Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG: ds=ListyPracownika view=NT_KP_PLC_LIST_PRAC alias=LISP pkg=NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=confirmed_in_oracle)
- Teta.Sumo.Personel.bosListaPlac.TG.PitPayrollLinksTG: ds=PitPayrollLinks view=undefined alias=PIPL pkg=KP_PIPL_AGL [confirmed_from_il] oracle(view=undefined,pkg=confirmed_in_oracle)
- Teta.Sumo.Personel.bosListaPlac.MTG.KartotekaListMTG: ds=NumeracjaListPlac view=undefined alias=undefined pkg=NT_KP_SLO_LISTY_PLAC_DAC [confirmed_from_il] oracle(view=undefined,pkg=confirmed_in_oracle)
- Teta.Sumo.Finances.bosFinanseSlowniki.TG.WalutyTG: ds=undefined view=NT_PA_SLO_WALUTY alias=WALU pkg=NT_PA_SLO_WALUTY_DAC [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=confirmed_in_oracle)
- Teta.Sumo.Finances.bosFinanseSlowniki.MTG.WalutyMTG: ds=Waluty view=NT_PA_SLO_WALUTY alias=WALU pkg=NT_PA_SLO_WALUTY_DAC [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=confirmed_in_oracle)
- Teta.Sumo.Finances.bosFinanseSlowniki.TG.TabeleStopProcentowychTG: ds=TabeleStopProcentowych view=NT_RK_SLO_TABELE_STOP_PROC alias=TASP pkg=undefined [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=undefined)
- Teta.Sumo.Finances.bosFinanseSlowniki.MTG.TabeleStopProcentowychMTG: ds=TabeleStopProcentowych view=NT_RK_SLO_TABELE_STOP_PROC alias=TASP pkg=NT_RK_SLO_TABELE_STOP_PROC_DAC [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=confirmed_in_oracle)
- Teta.Sumo.Finances.bosFinanseSlowniki.TG.TypyMonitowTG: ds=TypyMonitow view=NT_RK_TYPY_MONITOW alias=TYMO pkg=undefined [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=undefined)
- Teta.Sumo.Finances.bosFinanseSlowniki.MTG.TypyMonitowMTG: ds=TypyMonitow view=NT_RK_TYPY_MONITOW alias=TYMO pkg=NT_RK_TYPY_MONITOW_DAC [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=confirmed_in_oracle)
- Teta.Sumo.Finances.bosFinanseSlowniki.MTG.PozycjeStatusowRozrachunkowychMTG: ds=PozycjeStatusowRozrachunkowych view=NT_RK_ROZR_STATUSY alias=RRST pkg=NT_RK_ROZR_STATUSY_DAC [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=confirmed_in_oracle)
- Teta.Sumo.Finances.bosFinanseSlowniki.MTG.PodtypyDokumentowMTG: ds=PodtypyDokumentow view=NT_RK_SLO_PODTYPY_DOKU alias=PODO pkg=NT_RK_SLO_PODTYPY_DOKU_DAC [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=confirmed_in_oracle)
- Teta.Sumo.Finances.bosFinanseSlowniki.TG.PodtypyDokumentowTG: ds=PodtypyDokumentow view=NT_RK_SLO_PODTYPY_DOKU alias=PODO pkg=NT_RK_SLO_PODTYPY_DOKU_DAC [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=confirmed_in_oracle)
- Teta.Sumo.Finances.bosFinanseSlowniki.MTG.TypyRejestrowMTG: ds=TypyRejestrow view=NT_RK_SLO_TYPY_REJESTROW alias=TYPD pkg=NT_RK_SLO_TYPY_REJESTROW_DAC [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=confirmed_in_oracle)
- Teta.Sumo.Finances.bosFinanseSlowniki.TG.TypyRejestrowTG: ds=undefined view=NT_RK_SLO_TYPY_REJESTROW alias=TYPD pkg=NT_RK_SLO_TYPY_REJESTROW_DAC [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=confirmed_in_oracle)
- Teta.Sumo.Finances.bosFinanseSlowniki.MTG.RodzajeDokumentowVatMTG: ds=RodzajeDokumentowVat view=NT_RK_SLO_RODZAJ_DOK_VAT alias=RODV pkg=undefined [confirmed_from_il] oracle(view=confirmed_in_oracle,pkg=undefined)

## Przykłady łańcuchów form→Oracle (20)

- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcRok: SkladnikiNarastajaco.ROK_NUMER → Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiNarastajacoTG → NT_KP_PLC_SKLADNIKI_NARAST / NT_KP_PLC_SKLADNIKI_NARAST_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcTytul: SkladnikiNarastajaco.SKLP_TYTUL → Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiNarastajacoTG → NT_KP_PLC_SKLADNIKI_NARAST / NT_KP_PLC_SKLADNIKI_NARAST_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcKod: SkladnikiNarastajaco.SKLP_KOD → Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiNarastajacoTG → NT_KP_PLC_SKLADNIKI_NARAST / NT_KP_PLC_SKLADNIKI_NARAST_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcWartoscWgDatyZamkniecia: SkladnikiNarastajaco.WARTOSC_DATA_ZAMK → Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiNarastajacoTG → NT_KP_PLC_SKLADNIKI_NARAST / NT_KP_PLC_SKLADNIKI_NARAST_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcWartoscWgDatyWplaty: SkladnikiNarastajaco.WARTOSC_DATA_WYPL → Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiNarastajacoTG → NT_KP_PLC_SKLADNIKI_NARAST / NT_KP_PLC_SKLADNIKI_NARAST_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListTytul: ListyPracownika.LIST_TYTUL → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListNumer: ListyPracownika.LIST_NUMER → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListTyp: ListyPracownika.LIST_TYP → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListDataObliczen: ListyPracownika.DATA_OBLICZEN → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListDataWyplaty: ListyPracownika.LIST_DATA_WYPLATY → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListDataZamkListy: ListyPracownika.DATA_ZAMK_LISTY → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListDataZamkMiesiac: ListyPracownika.DATA_ZAMK_MIESIAC → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcTaxDate: ListyPracownika.TAX_DATE → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcMiesiackorekty: ListyPracownika.MIESIAC_KOREKTY → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcDataRozliczen: ListyPracownika.DATA_ROZL_ZUS → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcInclInAlg: ListyPracownika.INCLUDED_IN_ALGORITHM → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListWystawionoPit: ListyPracownika.WYSTAWIONO_PIT → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListDataWystawienia: ListyPracownika.DATA_WYSTAWIENIA → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcPit11IssuingStatus: ListyPracownika.PIT11_ISSUING_STATUS → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListStatus: ListyPracownika.STATUS → Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG → NT_KP_PLC_LIST_PRAC / NT_KP_PLC_LIST_PRAC_DAC [confirmed_from_il]

## Przykłady lookup split (20)

- Teta.Sumo.Sales.plgSalesDictionaries.CrdPaymentMethodsTranslations.PaymentMethodsTranslationsView.lcboTyp: target=FormyZaplaty.TYP lookup=TypFormyZaplaty value=WARTOSC_OD display=ZNACZENIE
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok.lcboTypStanowiska: target=KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok.lcboRodzinaStanowiska: target=KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdPowiazaniaKOS.PowiazaniaKOSWidok.lcboTypStanowiska: target=KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdPowiazaniaKOS.PowiazaniaKOSWidok.lcboRodzinaStanowiska: target=KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdProfilKOS.ProfilKOSWidok.lcboTypStanowiska: target=KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdProfilKOS.ProfilKOSWidok.lcboRodzinaStanowiska: target=KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdKryteriaOcenKOS.KryteriaOcenKOSWidok.lcboTypStanowiska: target=KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdKryteriaOcenKOS.KryteriaOcenKOSWidok.lcboRodzinaStanowiska: target=KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdKompetencje.KompetencjeWidok.imrCompetencyGroupPhotos: target=CompetencyGroupPhotos.PHOTO_FILE lookup=GrupyKompetencji value=ID display=null
- Teta.Sumo.Personel.plgKOS.CrdInformacjeDodatkoweKOS.InformacjeDodatkoweKOSWidok.lcboTypStanowiska: target=KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdInformacjeDodatkoweKOS.InformacjeDodatkoweKOSWidok.lcboRodzinaStanowiska: target=KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdPositionValuation.PositionValuationView.lcboKind: target=KartaOpisuStanowiska.RODZAJ_STAN lookup=RodzajeStanowiskaCzas value=WARTOSC_OD display=ZNACZENIE
- Teta.Sumo.Personel.plgKOS.CrdPositionValuation.PositionValuationView.lcboTypStanowiska: target=KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdPositionValuation.PositionValuationView.lcboRodzinaStanowiska: target=KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdDevelopmentTrainings.DevelopmentTrainingsView.lcboTypStanowiska: target=KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdDevelopmentTrainings.DevelopmentTrainingsView.lcboRodzinaStanowiska: target=KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdCareerPaths.CareerPathsView.lcboTypStanowiska: target=KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdCareerPaths.CareerPathsView.lcboRodzinaStanowiska: target=KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk value=ID display=NAZWA
- Teta.Sumo.Personel.plgKOS.CrdKosAdditionalInfo.KosAdditionalInfoView.lcboTypStanowiska: target=KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk value=ID display=NAZWA

## bos DLL missing (20)

_brak_

## Referencje

### DicRodzajeKoncesji / RodzajeKoncesjiDF
- DF found: true
- Gateway: ds=RodzajeKoncesji view=NT_LG_SLO_RODZAJE_KONCESJI alias=RKNC pkg=NT_LG_SLO_RODZAJE_KONCESJI_DAC
- Oracle view: confirmed_in_oracle package: confirmed_in_oracle
- Columns on MTG: ["ID","KOD","NAZWA","UP_TO_DATE"]

### StanowiskoWStrukturzeOrg BO
- Teta.Sumo.Personel.bosSKOS.BO.PositionsDescriptionCardsBO: datasets=NAZWA,STANOWISKO,SSTN,INNER,KAST_ISTNIEJE,TETA_FIRMY,FIRM,LEFT,FIRM_NAZWA,KartaOpisuStanowiska gateways=Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG
- Teta.Sumo.Personel.bosKOS.BO.StanowiskoWStrukturzeOrgBO: datasets=TETA_FIRMY,FIRM,LEFT,NAZWA,FIRM_NAZWA,NAZWA_GALEZI,SMPK,JednostkiStrukt gateways=

### ActUsuwanieWynikowObliczen BO
- Teta.Sumo.Personel.bosListaPlac.BO.UsuwanieWynikowObliczenBO: status=found datasets=FirmyUzytkownika gateways=0

### lcboTypStanowiska lookup split
- target KartaOpisuStanowiska.ZSTP_ID / lookup ID/NAZWA

JSON: `docs/AIA_BOS_ORACLE_MAPPING_STAGE2B.json`
Pełny dump: `.local/AIA_BOS_ORACLE_MAPPING_STAGE2B.full.ndjson`
