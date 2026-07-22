# AIA Form technical bindings — Stage 2A

Wygenerowano: **2026-07-22T18:56:58.628Z** (read-only IL reconstruction + Stage 2A.1 semantic normalization)

## Zakres

- Etap 1 (PA_WTYCZKI / TypeDef statusy) **bez zmian**.
- Analiza: matched TypeDef → IL (`InitializeComponent`, `.ctor`, `OnLoad`/`Create*`/`Bind*`/`Add*`…) → property setters, ctor args, DesignModeColumn/Table.
- **Stage 2A.1:** rozdział pól bindingu, ParameterName ≠ dataMember, kategorie pól (uiControls…), brak syntetycznego `Item`, zaostrzone DF.
- **Bez** Help HTML, mapowania Oracle, SqlJoin, SQL, Qdrant, analizy wnętrza bos DLL.
- Luźny `ldstr` ≠ confirmed; wymagane przypisanie / argument / call z evidence.

Oracle / clientDirectory: OK

## Audyt

| Metryka | Wartość |
|---------|---------|
| Formularze przeanalizowane | **2794** |
| Z InitializeComponent | **2458** |
| Z ≥1 control binding | **2416** |
| uiControls (controlCount deprecated) | **98379** |
| dataObjects | **81** |
| technicalFields | **3826** |
| constants | **13802** |
| syntheticTargets | **125** |
| Bindings confirmed | **72716** |
| Bindings probable | **0** |
| Bindings candidate-only | 0 |
| Unikalne BO | **2234** |
| Unikalne DF | **1472** |
| Unikalne bos DLL | **303** |
| Logical datasource/table | **3316** |
| Lookupi | **4224** |
| Filtry | **1694** |
| Konflikty | 5020 |
| Bez wiedzy tech. poza TypeDef | **69** |

## Stage 2A.1 — semantic normalization

Rozdzielone właściwości bindingu: `dataMember` / `datasetTable` / `format` / `valueMember` / `displayMember` / `parameterName` / `filterExpression`.
Format (`d`, `F0`, `N0`, …) nie trafia do `dataMember`. `ParameterName` → `propertyBindings.parameterName` + relacja `control_parameter` / `control_permission_parameter`.
Pola TypeDef w kategoriach: `uiControls`, `dataObjects`, `businessObjectFields`, `constants`, `technicalFields`, `syntheticTargets`.
`set_Item` → `dataOperations.indexer_assignment` (bez kontrolki `Item`). DF: `form_DF` / `control_DF` / `column_DF` / `datasource_DF` tylko z dowodem IL.

### Audyt anomalii

| Anomalia | Wartość |
|----------|---------|
| bindingsWithMultipleDataMembers | 0 |
| formatValuesPreviouslyMisclassified | 4616 |
| parameterNamesPreviouslyMisclassified | 1474 |
| syntheticItemTargetsRemoved | 2256 |
| nonUiFieldsRemovedFromControls | 17913 |
| formDfCount | 3825 |
| controlDfCount | 0 |
| columnDfCount | 0 |
| datasourceDfCount | 17 |
| uncertainDfRelations | 967 |

#### Przykłady (≤20 / kategoria)

**bindingsWithMultipleDataMembers**

_brak_

**formatValuesPreviouslyMisclassified**

- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok.dgcDotyczyMiesiacaAgr: format=d dataMember="LSKO_DOTYCZY_MIESIACA"
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok.dgcPayDateAgr: format=d dataMember="DATA_WYPLATY"
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok.dgcDotyczyMiesiaca: format=d dataMember="DOTYCZY_MIESIACA"
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok.dgcRelatedMonth: format=d dataMember="DOTYCZY_MIESIACA"
- Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok.dgcDotyczyMiesiacaAgr: format=d dataMember="LSKO_DOTYCZY_MIESIACA"
- Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok.dgcPayDateAgr: format=d dataMember="DATA_WYPLATY"
- Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok.dgcDotyczyMiesiaca: format=d dataMember="DOTYCZY_MIESIACA"
- Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok.dgcRelatedMonth: format=d dataMember="DOTYCZY_MIESIACA"
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkMies.ListyZamkMiesWidok.dgcDotyczyMiesiacaAgr: format=d dataMember="LSKO_DOTYCZY_MIESIACA"
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkMies.ListyZamkMiesWidok.dgcPayDateAgr: format=d dataMember="DATA_WYPLATY"
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkMies.ListyZamkMiesWidok.dgcDotyczyMiesiaca: format=d dataMember="LMIE_DOTYCZY_MIESIACA"
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkMies.ListyZamkMiesWidok.dgcMonthRelated: format=d dataMember="LMIE_DOTYCZY_MIESIACA"
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcRok: format=F0 dataMember="ROK_NUMER"
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListDataObliczen: format=d dataMember="DATA_OBLICZEN"
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListDataWyplaty: format=d dataMember="LIST_DATA_WYPLATY"
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListDataZamkListy: format=d dataMember="DATA_ZAMK_LISTY"
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcListDataZamkMiesiac: format=d dataMember="DATA_ZAMK_MIESIAC"
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok.dgcTaxDate: format=d dataMember="TAX_DATE"
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok.dgcDataObliczen: format=d dataMember="DATA_OBLICZEN"
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok.dgcDataWyplaty: format=d dataMember="DATA_WYPLATY"

**parameterNamesPreviouslyMisclassified**

- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok.tbbZamknijMiesiac: parameterName=KP_UPR_KART_LIST_ZAMKNIJ_MIES
- Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok.tbbZamknijListe: parameterName=KP_UPR_KART_LIST_ZAMKNIJ_LISTE
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok.gtiKoryguj: parameterName=KP_UPR_KART_LIST_KOREKTA
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok.gtiZamknij: parameterName=KP_UPR_KART_LIST_ZAMKNIJ_LISTE
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok.gtiWyslijDoDekretacji: parameterName=KP_UPR_KART_LIST_WYSLIJ_DO_DEK
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok.gtiZatwierdzListy: parameterName=KP_UPR_KART_LIST_ZATWIERDZ
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok.gtiOdtwierdzListy: parameterName=KP_UPR_KART_LIST_ODTWIERDZ
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok.gtiSetTaxDate: parameterName=KP_UPR_KART_LIST_SET_TAX_DATE
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok.gtiSetTaxDateCorrection: parameterName=KP_UPR_KART_LIST_TAX_DATE_C
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok.gtiSetAlg: parameterName=KP_LIST_INCL_IN_ALG_PER
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok.tbbZamknijMiesiac: parameterName=KP_UPR_KART_LIST_ZAMKNIJ_MIES
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok.tbbGroupCalculationPayrollsLists: parameterName=KP_UPR_GRP_CALC_PAYROLL_LISTS
- Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeCenZbytu.dgcNetto: parameterName=LG_INM_STVA_CHANGE
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdSkladnikiPlacowe.SkladnikiPlacoweWidok.gtiChangeComponentParameters: parameterName=KP_UPR_SKLP_CHANGE_SAL_COMP
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdZestawSkladnikow.ZestawSkladnikowWidok.chkPayList: parameterName=KP_UPR_SKLP_PRZEZNA_ZESTAWU
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdZestawSkladnikow.ZestawSkladnikowWidok.chkListaUC: parameterName=KP_UPR_SKLP_PRZEZNA_ZESTAWU
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdZestawSkladnikow.ZestawSkladnikowWidok.chkKopertyUt: parameterName=KP_UPR_SKLP_PRZEZNA_ZESTAWU
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdZestawSkladnikow.ZestawSkladnikowWidok.chkListaKorekta: parameterName=KP_UPR_SKLP_PRZEZNA_ZESTAWU
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdZestawSkladnikow.ZestawSkladnikowWidok.chkListaDodatkowa: parameterName=KP_UPR_SKLP_PRZEZNA_ZESTAWU
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdZestawSkladnikow.ZestawSkladnikowWidok.chkListaGlowna: parameterName=KP_UPR_SKLP_PRZEZNA_ZESTAWU

**syntheticItemTargetsRemoved**

- Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen.ActUsuwanieWynikowObliczen: key=TylkoListyUc method=DodajDodatkoweKolumny @ 0x0164
- Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen.ActUsuwanieWynikowObliczen: key=UsunListyDoIFS method=DodajDodatkoweKolumny @ 0x0193
- Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen.ActUsuwanieWynikowObliczen: key=UsunZaksiegowaneRob method=DodajDodatkoweKolumny @ 0x01C2
- Teta.Sumo.Personel.plgListaPlac.ObliczanieListy.ActObliczanieListy: key=ID method=InitializeTslpParameters @ 0x0181
- Teta.Sumo.Personel.plgListaPlac.ObliczanieListy.ActObliczanieListy: key=DOT_MIES method=InitializeTslpParameters @ 0x01B7
- Teta.Sumo.Personel.plgListaPlac.ObliczanieListy.ActObliczanieListy: key=USUN_LISTY method=InitializeTslpParameters @ 0x01D7
- Teta.Sumo.Personel.plgListaPlac.ObliczanieListy.ActObliczanieListy: key=USUN_LISTY_BEZ method=InitializeTslpParameters @ 0x01F7
- Teta.Sumo.Personel.plgListaPlac.DodanieListy.ActDodanieListy: key=TYP method=.ctor @ 0x002C
- Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeCenZbytu: key=WSPOLCZYNNIK method=DataSourceTable_ColumnChanged @ 0x0049
- Teta.Sumo.Personel.plgKOS.AssignClassificationCategory.ActAssignClassificationCategory: key=FIRM_ID method=.ctor @ 0x0031
- Teta.Sumo.Personel.plgKOS.AssignClassificationCategory.ActAssignClassificationCategory: key=FIRM_NAME method=.ctor @ 0x005C
- Teta.Sumo.Personel.plgKOS.AssignClassificationCategory.ActAssignClassificationCategory: key=JEOR_ID method=.ctor @ 0x008C
- Teta.Sumo.Personel.plgKOS.AssignClassificationCategory.ActAssignClassificationCategory: key=JEOR_NAME method=.ctor @ 0x00B8
- Teta.Sumo.Personel.plgKOS.AssignClassificationCategory.ActAssignClassificationCategory: key=SSTN_ID method=.ctor @ 0x00E9
- Teta.Sumo.Personel.plgKOS.AssignClassificationCategory.ActAssignClassificationCategory: key=SSTN_NAME method=.ctor @ 0x0115
- Teta.Sumo.Personel.plgPersonelSlowniki.DicRodzajeOdpraw: key=EMPLOYMENT_CERTIFICATE method=DicRodzajeOdpraw_ColumnChanged @ 0x0115
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdRodzajeNieobecnosci.RodzajeNieobecnosciWidok: key=7 method=RodzajeNieobecnosciWidok_ColumnChanged @ 0x029F
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdRodzajeNieobecnosci.RodzajeNieobecnosciWidok: key=POM_WYM_URLOPU method=RodzajeNieobecnosciWidok_ColumnChanged @ 0x02F6
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdRodzajeNieobecnosci.RodzajeNieobecnosciWidok: key=TYMC_STAZ method=RodzajeNieobecnosciWidok_ColumnChanged @ 0x0394
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdRodzajeNieobecnosci.RodzajeNieobecnosciWidok: key=TRAINING method=RodzajeNieobecnosciWidok_ColumnChanged @ 0x03D5

**nonUiFieldsRemovedFromControls**

- Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen.ActUsuwanieWynikowObliczen: nonUi=4 ui=0
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok: nonUi=2 ui=51
- Teta.Sumo.Personel.plgListaPlac.ObliczanieListy.ActObliczanieListy: nonUi=18 ui=1
- Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok: nonUi=2 ui=52
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkMies.ListyZamkMiesWidok: nonUi=1 ui=52
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok: nonUi=2 ui=38
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok: nonUi=1 ui=85
- Teta.Sumo.Personel.plgListaPlac.DodanieListy.ActDodanieListy: nonUi=13 ui=0
- Teta.Sumo.Personel.plgListaPlac.KorektaListy.ActKorektaListy: nonUi=7 ui=0
- Teta.Sumo.Personel.plgListaPlac.RozliczanieNadplatIZaplat.ActRozliczanieNadplatIZaplat: nonUi=1 ui=0
- Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji: nonUi=1 ui=6
- Teta.Sumo.Sales.plgSalesDictionaries.DicRoleOsobKontaktowych: nonUi=1 ui=8
- Teta.Sumo.Sales.plgSalesDictionaries.DicKanaly: nonUi=1 ui=47
- Teta.Sumo.Sales.plgSalesDictionaries.DicFunkcjeOsob: nonUi=2 ui=6
- Teta.Sumo.Sales.plgSalesDictionaries.CrdGrupyKontrahentow.GrupyKontrahentowWidok: nonUi=1 ui=63
- Teta.Sumo.Sales.plgSalesDictionaries.DicFormyZaplaty: nonUi=16 ui=65
- Teta.Sumo.Sales.plgSalesDictionaries.DicTytulyOpustow: nonUi=1 ui=7
- Teta.Sumo.Sales.plgSalesDictionaries.DicOkregi: nonUi=1 ui=7
- Teta.Sumo.Sales.plgSalesDictionaries.CrdPunktySprzedazy.PunktySprzedazyWidok: nonUi=1 ui=22
- Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeCenZbytu: nonUi=8 ui=59

**formDf**

- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok → Teta.Sumo.Finances.bosFinanseSlowniki.DF.WalutyDF
- Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok → Teta.Sumo.Finances.bosFinanseSlowniki.DF.WalutyDF
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkMies.ListyZamkMiesWidok → Teta.Sumo.Finances.bosFinanseSlowniki.DF.WalutyDF
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok → Teta.Sumo.Personel.bosPersonelSlowniki.DF.TypListyDF
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok → Teta.Sumo.Personel.bosPersonelSlowniki.DF.IncludedInAlgDF
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok → Teta.Sumo.Personel.bosPersonelSlowniki.DF.WystawionePityDF
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok → Teta.Sumo.Personel.bosPersonelSlowniki.DF.StatusyListyDF
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok → Teta.Sumo.Personel.bosPersonelSlowniki.DF.StatusyDokDF
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok → Teta.Sumo.Personel.bosPitDocuments.DF.Pit11SubmissionPurposesDF
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok → Teta.Sumo.Personel.bosPersonelSlowniki.DF.Pit11ModesDF
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok → Teta.Sumo.Personel.bosPitDocuments.DF.DocsStatusDF
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok → Teta.Sumo.Personel.bosPersonelSlowniki.DF.TypListyDF
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok → Teta.Sumo.Personel.bosSOrganizacja.DF.FirmyPowiazaniaDF
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok → Teta.Sumo.Personel.bosPersonelSlowniki.DF.TerminyWyplatDF
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok → Teta.Sumo.Personel.bosPersonelSlowniki.DF.IncludedInAlgDF
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok → Teta.Sumo.Personel.bosPersonelSlowniki.DF.StatusObliczenDF
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok → Teta.Sumo.Personel.bosPersonelSlowniki.DF.StatusDekretacjiDF
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok → Teta.Sumo.Finances.bosFinanseSlowniki.DF.RodzajKursuDF
- Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji → Teta.Sumo.Sales.bosSalesDictionaries.DF.RodzajeKoncesjiDF
- Teta.Sumo.Sales.plgSalesDictionaries.DicRoleOsobKontaktowych → Teta.Sumo.Sales.bosSalesDictionaries.DF.RoleOsobKontaktowychDF

**controlDf**

_brak_

**columnDf**

_brak_

**datasourceDf**

- &Typy dokumentów rozliczeniowych → Teta.Sumo.Finances.bosKasa.DF.TypyDokumentowRozliczeniowychDF
- &Typy dokumentów druków ścisłej kontroli → Teta.Sumo.Finances.bosKasa.DF.TypyDokumentowDrskDF
- &Typy płatności → Teta.Sumo.WRD.bosWRDDokumenty.DF.TypyPlatnosciDF
- &Typy RMK → Teta.Sumo.Finances.bosFinanseRMK.DF.RMKTypesDF
- &Typy not odsetkowych → Teta.Sumo.Finances.bosOdsetki.DF.TypyNotOdsetkowychDF
- &Typy kompensat → Teta.Sumo.Finances.bosKompensaty.DF.TypyKompensatDF
- &Typy dokumentów RK → Teta.Sumo.Finances.bosRozniceKursowe.DF.TypyDokumentowRkDF
- &Dokumenty różnic kursowych rozrachunków na dzień bilansowy → Teta.Sumo.Finances.bosRozniceKursowe.DF.TypyDokumentowRkrrbDF
- &Dokumenty różnic kursowych rachunku bankowego → Teta.Sumo.Finances.bosRozniceKursowe.DF.TypyDokumentowRKWBDF
- &Typy dokumentów potwierdzenia salda → Teta.Sumo.Finances.bosPotwierdzeniaSald.DF.TypyDokumentowPotwierdzeniaSaldaDF
- &Typy porozumień → Teta.Sumo.Finances.bosPorozumienia.DF.TypyPorozumienDF
- &Typy cesji → Teta.Sumo.Finances.bosPorozumienia.DF.TypyCesjiDF
- &Typy dokumentów sądowych → Teta.Sumo.Finances.bosSprawySadowe.DF.TypyDokumentowSadowychDF
- &Typy dokumentów kosztów sądowych → Teta.Sumo.Finances.bosSprawySadowe.DF.CourtCostsDocumentsTypesDF
- &Typy dokumentów odpisów aktualizujących należności → Teta.Sumo.Finances.bosAllowanceForBadDebts.DF.AllowanceForBadDebtsDocumentsTypesDF
- &Typy not korygujących → Teta.Sumo.Finances.bosAdjustmentNotes.DF.AdjustmentNotesTypesDF
- &Dokumenty obsługi umów → Teta.Sumo.Finances.bosContracts.DF.ContractsTypesDF

**uncertainDf**

- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok: 1 DF, 2 DS, no datasource_DF
- Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok: 1 DF, 2 DS, no datasource_DF
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkMies.ListyZamkMiesWidok: 1 DF, 2 DS, no datasource_DF
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok: 8 DF, 3 DS, no datasource_DF
- Teta.Sumo.Sales.plgSalesDictionaries.CrdGrupyKontrahentow.GrupyKontrahentowWidok: 1 DF, 6 DS, no datasource_DF
- Teta.Sumo.Sales.plgSalesDictionaries.DicTytulyOpustow: 1 DF, 2 DS, no datasource_DF
- Teta.Sumo.Sales.plgSalesDictionaries.DicRoleOsobNaDokSprzedazy: 1 DF, 4 DS, no datasource_DF
- Teta.Sumo.Sales.plgSalesDictionaries.DicGrupyOdbiorcow: 1 DF, 2 DS, no datasource_DF
- Teta.Sumo.Sales.plgSalesDictionaries.CrdKryteriaOpustow.KryteriaOpustowWidok: 1 DF, 3 DS, no datasource_DF
- Teta.Sumo.Sales.plgSalesDictionaries.DicKategorieKontrahentow: 1 DF, 2 DS, no datasource_DF
- Teta.Sumo.Sales.plgSalesDictionaries.DicSalesDocumentsCommissions: 1 DF, 4 DS, no datasource_DF
- Teta.Sumo.Sales.plgSalesDictionaries.DicLoyaltyProgramCardTypes: 1 DF, 7 DS, no datasource_DF
- Teta.Sumo.Sales.plgSalesDictionaries.CrdRoundings.RoundingsView: 1 DF, 2 DS, no datasource_DF
- Teta.Sumo.Sales.plgSalesDictionaries.DicCriterionFunctions: 3 DF, 2 DS, no datasource_DF
- Teta.Sumo.Sales.plgSalesDictionaries.CrdPaymentMethodsTranslations.PaymentMethodsTranslationsView: 1 DF, 4 DS, no datasource_DF
- Teta.Sumo.Sales.plgSalesDictionaries.DicVatExemptionReasons: 1 DF, 2 DS, no datasource_DF
- Teta.Sumo.Personel.plgKOS.CrdArkuszeOcen.ArkuszeOcenWidok: 1 DF, 8 DS, no datasource_DF
- Teta.Sumo.Personel.plgKOS.CrdZachowania.ZachowaniaWidok: 1 DF, 3 DS, no datasource_DF
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok: 2 DF, 7 DS, no datasource_DF
- Teta.Sumo.Personel.plgKOS.CrdPowiazaniaKOS.PowiazaniaKOSWidok: 2 DF, 11 DS, no datasource_DF

## Przykłady bindingów (20)

- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok (ID=425)
  - tbbZamknijMiesiac: {"parameterName":"KP_UPR_KART_LIST_ZAMKNIJ_MIES"} [confirmed_from_il] tbbZamknijMiesiac.ParameterName = "KP_UPR_KART_LIST_ZAMKNIJ_MIES" @ 0x0084
  - grdSkladnikiPlacowe: {"datasetTable":"SkladnikiAgregacja"} [confirmed_from_il] grdSkladnikiPlacowe.DataSourceTableName = "SkladnikiAgregacja" @ 0x0431
  - dgcSklpKodAgr: {"dataMember":"SKLP_KOD","datasetTable":"SkladnikiAgregacja","format":"0000"} [confirmed_from_il] dgcSklpKodAgr.ColumnName = "SKLP_KOD" @ 0x0478
- Teta.Sumo.Personel.plgListaPlac.ObliczanieListy.ActObliczanieListy (ID=664)
  - m_CalculatePayroll: {"datasetTable":"ListaPlacOblicz"} [confirmed_from_il] m_CalculatePayroll.TableName = "ListaPlacOblicz" @ 0x00CF
- Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok (ID=682)
  - tbbZamknijListe: {"parameterName":"KP_UPR_KART_LIST_ZAMKNIJ_LISTE"} [confirmed_from_il] tbbZamknijListe.ParameterName = "KP_UPR_KART_LIST_ZAMKNIJ_LISTE" @ 0x008F
  - grdSkladnikiPlacowe: {"datasetTable":"SkladnikiAgregacja"} [confirmed_from_il] grdSkladnikiPlacowe.DataSourceTableName = "SkladnikiAgregacja" @ 0x0431
  - dgcSklpKodAgr: {"dataMember":"SKLP_KOD","datasetTable":"SkladnikiAgregacja","format":"0000"} [confirmed_from_il] dgcSklpKodAgr.ColumnName = "SKLP_KOD" @ 0x0478
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkMies.ListyZamkMiesWidok (ID=683)
  - grdSkladnikiPlacowe: {"datasetTable":"SkladnikiAgregacja"} [confirmed_from_il] grdSkladnikiPlacowe.DataSourceTableName = "SkladnikiAgregacja" @ 0x0452
  - dgcSklpKodAgr: {"dataMember":"SKLP_KOD","datasetTable":"SkladnikiAgregacja","format":"0000"} [confirmed_from_il] dgcSklpKodAgr.ColumnName = "SKLP_KOD" @ 0x0499
  - dgcSklpTytulAgr: {"dataMember":"SKLP_TYTUL","datasetTable":"SkladnikiAgregacja"} [confirmed_from_il] dgcSklpTytulAgr.ColumnName = "SKLP_TYTUL" @ 0x0539
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok (ID=684)
  - grdSkladnikiNarastajaco: {"datasetTable":"SkladnikiNarastajaco"} [confirmed_from_il] grdSkladnikiNarastajaco.DataSourceTableName = "SkladnikiNarastajaco" @ 0x039F
  - dgcRok: {"dataMember":"ROK_NUMER","datasetTable":"SkladnikiNarastajaco","format":"F0"} [confirmed_from_il] dgcRok.ColumnName = "ROK_NUMER" @ 0x03E6
  - dgcTytul: {"dataMember":"SKLP_TYTUL","datasetTable":"SkladnikiNarastajaco"} [confirmed_from_il] dgcTytul.ColumnName = "SKLP_TYTUL" @ 0x0485
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok (ID=685)
  - dgcDataObliczen: {"dataMember":"DATA_OBLICZEN","datasetTable":"NumeracjaListPlac","format":"d"} [confirmed_from_il] dgcDataObliczen.ColumnName = "DATA_OBLICZEN" @ 0x045D
  - dgcDataWyplaty: {"dataMember":"DATA_WYPLATY","datasetTable":"NumeracjaListPlac","format":"d"} [confirmed_from_il] dgcDataWyplaty.ColumnName = "DATA_WYPLATY" @ 0x04CC
  - grdListyPlac: {"datasetTable":"NumeracjaListPlac"} [confirmed_from_il] grdListyPlac.DataSourceTableName = "NumeracjaListPlac" @ 0x0E1D
- Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji (ID=1009)
  - dgcKod: {"dataMember":"KOD"} [confirmed_from_il] dgcKod.ColumnName = "KOD" @ 0x0063
  - dgcNazwa: {"dataMember":"NAZWA"} [confirmed_from_il] dgcNazwa.ColumnName = "NAZWA" @ 0x00D7
  - dgcAktualna: {"dataMember":"UP_TO_DATE"} [confirmed_from_il] dgcAktualna.ColumnName = "UP_TO_DATE" @ 0x0132
- Teta.Sumo.Sales.plgSalesDictionaries.DicRoleOsobKontaktowych (ID=1002)
  - dgcKod: {"dataMember":"Kod"} [confirmed_from_il] dgcKod.ColumnName = "Kod" @ 0x0079
  - dgcNazwa: {"dataMember":"Nazwa"} [confirmed_from_il] dgcNazwa.ColumnName = "Nazwa" @ 0x00F0
  - dgcOpis: {"dataMember":"Opis"} [confirmed_from_il] dgcOpis.ColumnName = "Opis" @ 0x014B
- Teta.Sumo.Sales.plgSalesDictionaries.DicKanaly (ID=716)
  - dgcKod: {"dataMember":"KOD"} [confirmed_from_il] dgcKod.ColumnName = "KOD" @ 0x0226
  - dgcSprzedaz: {"dataMember":"SPRZEDAZ"} [confirmed_from_il] dgcSprzedaz.ColumnName = "SPRZEDAZ" @ 0x0291
  - dgcZakup: {"dataMember":"ZAKUP"} [confirmed_from_il] dgcZakup.ColumnName = "ZAKUP" @ 0x02E0
- Teta.Sumo.Sales.plgSalesDictionaries.DicFunkcjeOsob (ID=725)
  - dgcKod: {"dataMember":"KOD","datasetTable":"FunkcjeOsob"} [confirmed_from_il] dgcKod.ColumnName = "KOD" @ 0x0063
  - dgcOpis: {"dataMember":"OPIS","datasetTable":"FunkcjeOsob"} [confirmed_from_il] dgcOpis.ColumnName = "OPIS" @ 0x00EA
  - dgcPredefiniowana: {"dataMember":"PREDEFINIOWANE","datasetTable":"FunkcjeOsob"} [confirmed_from_il] dgcPredefiniowana.ColumnName = "PREDEFINIOWANE" @ 0x0165
- Teta.Sumo.Sales.plgSalesDictionaries.CrdGrupyKontrahentow.GrupyKontrahentowWidok (ID=1226)
  - grdGroupContractors: {"datasetTable":"GroupContractors"} [confirmed_from_il] grdGroupContractors.DataSourceTableName = "GroupContractors" @ 0x042C
  - dgcKonrSymbol: {"dataMember":"KONR_SYMBOL"} [confirmed_from_il] dgcKonrSymbol.ColumnName = "KONR_SYMBOL" @ 0x04DC
  - dgcSkrot: {"dataMember":"KONR_SKROT"} [confirmed_from_il] dgcSkrot.ColumnName = "KONR_SKROT" @ 0x053E
- Teta.Sumo.Sales.plgSalesDictionaries.DicFormyZaplaty (ID=555)
  - dgcKod: {"dataMember":"KOD","datasetTable":"FormyZaplaty"} [confirmed_from_il] dgcKod.ColumnName = "KOD" @ 0x02EC
  - dgcOpis: {"dataMember":"OPIS","datasetTable":"FormyZaplaty"} [confirmed_from_il] dgcOpis.ColumnName = "OPIS" @ 0x036F
  - dgcOdroczeniePlatnosci: {"dataMember":"ODROCZENIE_PLATNOSCI","datasetTable":"FormyZaplaty","format":"N0"} [confirmed_from_il] dgcOdroczeniePlatnosci.ColumnName = "ODROCZENIE_PLATNOSCI" @ 0x03F6
- Teta.Sumo.Sales.plgSalesDictionaries.DicTytulyOpustow (ID=559)
  - dgcKod: {"dataMember":"KOD","datasetTable":"TytulyUpustow"} [confirmed_from_il] dgcKod.ColumnName = "KOD" @ 0x006E
  - dgcNazwa: {"dataMember":"NAZWA","datasetTable":"TytulyUpustow"} [confirmed_from_il] dgcNazwa.ColumnName = "NAZWA" @ 0x00E9
  - dgcDomyslny: {"dataMember":"DOMYSLNY","datasetTable":"TytulyUpustow"} [confirmed_from_il] dgcDomyslny.ColumnName = "DOMYSLNY" @ 0x015B
- Teta.Sumo.Sales.plgSalesDictionaries.DicOkregi (ID=568)
  - dgcSymbol: {"dataMember":"SYMBOL","datasetTable":"Okregi"} [confirmed_from_il] dgcSymbol.ColumnName = "SYMBOL" @ 0x007A
  - dgcSprzedaz: {"dataMember":"SPRZEDAZ","datasetTable":"Okregi"} [confirmed_from_il] dgcSprzedaz.ColumnName = "SPRZEDAZ" @ 0x0102
  - dgcZakup: {"dataMember":"ZAKUP","datasetTable":"Okregi"} [confirmed_from_il] dgcZakup.ColumnName = "ZAKUP" @ 0x0161
- Teta.Sumo.Sales.plgSalesDictionaries.CrdPunktySprzedazy.PunktySprzedazyWidok (ID=569)
  - grdPunktySprzedazy: {"datasetTable":"PunktySprzedazy"} [confirmed_from_il] grdPunktySprzedazy.DataSourceTableName = "PunktySprzedazy" @ 0x01FB
  - dgcKod: {"dataMember":"KOD"} [confirmed_from_il] dgcKod.ColumnName = "KOD" @ 0x02C6
  - dgcNazwa: {"dataMember":"NAZWA"} [confirmed_from_il] dgcNazwa.ColumnName = "NAZWA" @ 0x033A
- Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeCenZbytu (ID=570)
  - dgcKod: {"dataMember":"KOD","datasetTable":"RodzajeCenZbytu"} [confirmed_from_il] dgcKod.ColumnName = "KOD" @ 0x029F
  - dgcRodzaj: {"dataMember":"RODZAJ","datasetTable":"RodzajeCenZbytu"} [confirmed_from_il] dgcRodzaj.ColumnName = "RODZAJ" @ 0x0323
  - dgcProdukcja: {"dataMember":"PRODUKCJA","datasetTable":"RodzajeCenZbytu"} [confirmed_from_il] dgcProdukcja.ColumnName = "PRODUKCJA" @ 0x03A8
- Teta.Sumo.Sales.plgSalesDictionaries.DicRoleOsobNaDokSprzedazy (ID=1303)
  - dgcKod: {"dataMember":"KOD"} [confirmed_from_il] dgcKod.ColumnName = "KOD" @ 0x00C6
  - dgcNazwa: {"dataMember":"NAZWA"} [confirmed_from_il] dgcNazwa.ColumnName = "NAZWA" @ 0x0131
  - dgcOpis: {"dataMember":"OPIS"} [confirmed_from_il] dgcOpis.ColumnName = "OPIS" @ 0x01A0
- Teta.Sumo.Sales.plgSalesDictionaries.DicBranze (ID=1272)
  - dgcKod: {"dataMember":"KOD"} [confirmed_from_il] dgcKod.ColumnName = "KOD" @ 0x0063
  - dgcNazwa: {"dataMember":"NAZWA"} [confirmed_from_il] dgcNazwa.ColumnName = "NAZWA" @ 0x00DA
  - dgcAktualna: {"dataMember":"UP_TO_DATE"} [confirmed_from_il] dgcAktualna.ColumnName = "UP_TO_DATE" @ 0x012C
- Teta.Sumo.Sales.plgSalesDictionaries.DicGrupyOdbiorcow (ID=1000)
  - dgcKod: {"dataMember":"KOD","datasetTable":"GrupyOdbiorcow"} [confirmed_from_il] dgcKod.ColumnName = "KOD" @ 0x009A
  - dgcNazwa: {"dataMember":"NAZWA","datasetTable":"GrupyOdbiorcow"} [confirmed_from_il] dgcNazwa.ColumnName = "NAZWA" @ 0x011E
  - dgcRodzajCeny: {"dataMember":"KOD","datasetTable":"RodzajeCenZbytu"} [confirmed_from_il] dgcRodzajCeny.ColumnName = "KOD" @ 0x01A2
- Teta.Sumo.Sales.plgSalesDictionaries.DicStatusyReklamacji (ID=1390)
  - dgcSymbol: {"dataMember":"SYMBOL"} [confirmed_from_il] dgcSymbol.ColumnName = "SYMBOL" @ 0x0063
  - dgcOpis: {"dataMember":"OPIS"} [confirmed_from_il] dgcOpis.ColumnName = "OPIS" @ 0x00CA
  - dgcAktualna: {"dataMember":"UP_TO_DATE"} [confirmed_from_il] dgcAktualna.ColumnName = "UP_TO_DATE" @ 0x0131

## Przykłady BO / DF (20)

- Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen.ActUsuwanieWynikowObliczen: bos=bosListaPlac.dll BO=Teta.Sumo.Personel.bosListaPlac.BO.UsuwanieWynikowObliczenBO DF=
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok: bos=bosFinanseSlowniki.dll,bosListaPlac.dll BO=Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO DF=Teta.Sumo.Finances.bosFinanseSlowniki.DF.WalutyDF
- Teta.Sumo.Personel.plgListaPlac.ObliczanieListy.ActObliczanieListy: bos=bosListaPlac.dll BO=Teta.Sumo.Personel.bosListaPlac.BO.ObliczanieListyBO DF=
- Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok: bos=bosFinanseSlowniki.dll,bosListaPlac.dll BO=Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO DF=Teta.Sumo.Finances.bosFinanseSlowniki.DF.WalutyDF
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkMies.ListyZamkMiesWidok: bos=bosFinanseSlowniki.dll,bosListaPlac.dll BO=Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO DF=Teta.Sumo.Finances.bosFinanseSlowniki.DF.WalutyDF
- Teta.Sumo.Personel.plgListaPlac.CrdSkladnikiNarastajaco.SkladnikiNarastajacoWidok: bos=bosPersonelSlowniki.dll,bosPitDocuments.dll,bosListaPlac.dll BO=Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO DF=Teta.Sumo.Personel.bosPersonelSlowniki.DF.TypListyDF,Teta.Sumo.Personel.bosPersonelSlowniki.DF.IncludedInAlgDF,Teta.Sumo.Personel.bosPersonelSlowniki.DF.WystawionePityDF,Teta.Sumo.Personel.bosPersonelSlowniki.DF.StatusyListyDF,Teta.Sumo.Personel.bosPersonelSlowniki.DF.StatusyDokDF,Teta.Sumo.Personel.bosPitDocuments.DF.Pit11SubmissionPurposesDF,Teta.Sumo.Personel.bosPersonelSlowniki.DF.Pit11ModesDF,Teta.Sumo.Personel.bosPitDocuments.DF.DocsStatusDF
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok: bos=bosPersonelSlowniki.dll,bosSOrganizacja.dll,bosFinanseSlowniki.dll,bosListaPlac.dll BO=Teta.Sumo.Personel.bosListaPlac.BO.KartotekaListBO DF=Teta.Sumo.Personel.bosPersonelSlowniki.DF.TypListyDF,Teta.Sumo.Personel.bosSOrganizacja.DF.FirmyPowiazaniaDF,Teta.Sumo.Personel.bosPersonelSlowniki.DF.TerminyWyplatDF,Teta.Sumo.Personel.bosPersonelSlowniki.DF.IncludedInAlgDF,Teta.Sumo.Personel.bosPersonelSlowniki.DF.StatusObliczenDF,Teta.Sumo.Personel.bosPersonelSlowniki.DF.StatusDekretacjiDF,Teta.Sumo.Finances.bosFinanseSlowniki.DF.RodzajKursuDF
- Teta.Sumo.Personel.plgListaPlac.DodanieListy.ActDodanieListy: bos=bosListaPlac.dll BO=Teta.Sumo.Personel.bosListaPlac.BO.KartotekaListBO DF=
- Teta.Sumo.Personel.plgListaPlac.KorektaListy.ActKorektaListy: bos=bosListaPlac.dll BO=Teta.Sumo.Personel.bosListaPlac.BO.KorektaListyBO DF=
- Teta.Sumo.Personel.plgListaPlac.RozliczanieNadplatIZaplat.ActRozliczanieNadplatIZaplat: bos=bosListaPlac.dll BO=Teta.Sumo.Personel.bosListaPlac.BO.RozliczanieNadplatIZaplatBO DF=
- Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji: bos=bosSalesDictionaries.dll BO= DF=Teta.Sumo.Sales.bosSalesDictionaries.DF.RodzajeKoncesjiDF
- Teta.Sumo.Sales.plgSalesDictionaries.DicRoleOsobKontaktowych: bos=bosSalesDictionaries.dll BO= DF=Teta.Sumo.Sales.bosSalesDictionaries.DF.RoleOsobKontaktowychDF
- Teta.Sumo.Sales.plgSalesDictionaries.DicKanaly: bos=bosSalesDictionaries.dll BO= DF=Teta.Sumo.Sales.bosSalesDictionaries.DF.KanalyDF
- Teta.Sumo.Sales.plgSalesDictionaries.DicFunkcjeOsob: bos=bosSalesDictionaries.dll BO= DF=Teta.Sumo.Sales.bosSalesDictionaries.DF.FunkcjeOsobDF
- Teta.Sumo.Sales.plgSalesDictionaries.CrdGrupyKontrahentow.GrupyKontrahentowWidok: bos=bosSalesDictionaries.dll BO=Teta.Sumo.Sales.bosSalesDictionaries.BO.GroupContractorsBO,Teta.Sumo.Sales.bosSalesDictionaries.BO.GrupyKontrahentowBO DF=Teta.Sumo.Sales.bosSalesDictionaries.DF.TypyKontrahentowDF
- Teta.Sumo.Sales.plgSalesDictionaries.DicFormyZaplaty: bos=bosSalesDictionaries.dll BO= DF=Teta.Sumo.Sales.bosSalesDictionaries.DF.TypFormyZaplatyDF,Teta.Sumo.Sales.bosSalesDictionaries.DF.TypPlatnosciDF,Teta.Sumo.Sales.bosSalesDictionaries.DF.WydrukiFiskalneFormaZaplatyDF,Teta.Sumo.Sales.bosSalesDictionaries.DF.PaymentDateTypesDF,Teta.Sumo.Sales.bosSalesDictionaries.DF.DateForDayToPayTypesDF,Teta.Sumo.Sales.bosSalesDictionaries.DF.FormyZaplatyDF
- Teta.Sumo.Sales.plgSalesDictionaries.DicTytulyOpustow: bos=bosSalesDictionaries.dll BO= DF=Teta.Sumo.Sales.bosSalesDictionaries.DF.TytulyUpustowDF
- Teta.Sumo.Sales.plgSalesDictionaries.DicOkregi: bos=bosSalesDictionaries.dll BO= DF=Teta.Sumo.Sales.bosSalesDictionaries.DF.OkregiDF
- Teta.Sumo.Sales.plgSalesDictionaries.CrdPunktySprzedazy.PunktySprzedazyWidok: bos=bosSalesDictionaries.dll BO=Teta.Sumo.Sales.bosSalesDictionaries.BO.PunktySprzedazyBO DF=
- Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeCenZbytu: bos=bosProdukcjaSlowniki.dll,bosSalesDictionaries.dll BO= DF=Teta.Sumo.Production.bosProdukcjaSlowniki.DF.PriceCalcAlgorithmsDF,Teta.Sumo.Production.bosProdukcjaSlowniki.DF.PriceCalcCustomAlgorithmsDF,Teta.Sumo.Sales.bosSalesDictionaries.DF.RodzajeCenZbytuDF

## Przykłady lookupów (20)

- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok: plgPersonelLov.dll / Teta.Sumo.Personel.plgPersonelLov.LvdZestawySkladnikow [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok: plgPersonelLov.dll / Teta.Sumo.Personel.plgPersonelLov.LvdZestawySkladnikow [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkMies.ListyZamkMiesWidok: plgPersonelLov.dll / Teta.Sumo.Personel.plgPersonelLov.LvdZestawySkladnikow [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.CrdGrupyKontrahentow.GrupyKontrahentowWidok: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdOsoby [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.CrdPunktySprzedazy.PunktySprzedazyWidok: plgPersonelLov.dll / Teta.Sumo.Personel.plgPersonelLov.LtdStrukturaJednostekUzytkownika [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.DicRoleOsobNaDokSprzedazy: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdFunkcjeOsob [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.DicRoleOsobNaDokSprzedazy: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdFunkcjeWyznaczajaceOsoby [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.DicGrupyOdbiorcow: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdRodzajeCenZbytu [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.CrdKryteriaOpustow.KryteriaOpustowWidok: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdFunkcjeKryterialne [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.DicKategorieKontrahentow: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdFormyZaplaty [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.DicSalesDocumentsCommissions: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdOsoby [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.DicSalesDocumentsCommissions: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdRoleOsobNaDokSprzedazy [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.DicSalesDocumentsCommissions: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdWskazniki [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.CrdSalesDocumentsCommissions.SalesDocumentsCommissionsView: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LtdGrupyKontrahentow [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.CrdSalesDocumentsCommissions.SalesDocumentsCommissionsView: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LtdGrupyAsortymentowe [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.CrdSalesDocumentsCommissions.SalesDocumentsCommissionsView: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdWskazniki [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.CrdSalesDocumentsCommissions.SalesDocumentsCommissionsView: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdRoleOsobNaDokSprzedazy [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.CrdSalesDocumentsCommissions.SalesDocumentsCommissionsView: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdOsoby [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.DicLoyaltyProgramCardTypes: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdCiagiNumeracji [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.DicLoyaltyProgramCardTypes: plgLogistykaLov.dll / Teta.Sumo.Logistics.plgLogistykaLov.LvdWskazniki [confirmed_from_il]

## Przykłady filtrów (20)

- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok: PRZEGLAD = 'T' (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdListyObliczone.ListyObliczoneWidok: PRZEGLAD = 'T' (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdListyZamkMies.ListyZamkMiesWidok: PRZEGLAD = 'T' (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgListaPlac.CrdKartotekaList.KartotekaListWidok: TYP = 'K' (control=gamCorrect) [confirmed_from_il]
- Teta.Sumo.Sales.plgSalesDictionaries.DicGrupyOdbiorcow: PRODUKCJA != 'T' (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdStanowiskoWStrukturzeOrg.StanowiskoWStrukturzeOrgWidok: SSTN.UP_TO_DATE = 'T' (control=gtfUpToDate) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdStanowiskoWStrukturzeOrg.StanowiskoWStrukturzeOrgWidok: LISC = 'T' (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdArkuszeOcen.ArkuszeOcenWidok: LISC = 'T' (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok: LISC = 'T' (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdPowiazaniaKOS.PowiazaniaKOSWidok: ZSWS_RODZAJ = 'W' (control=grdWspolpracaWew) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdPowiazaniaKOS.PowiazaniaKOSWidok: ZSWS_RODZAJ = 'Z' (control=grdWspolpracaZew) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdPowiazaniaKOS.PowiazaniaKOSWidok: STATUS_KADRY = 'T' (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdPowiazaniaKOS.PowiazaniaKOSWidok: LISC = 'T' (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdProfilKOS.ProfilKOSWidok: KOME_PROFIL = 'M' (control=grdKompetencjeMiekkie) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdProfilKOS.ProfilKOSWidok: PROFIL = 'M' AND KOME.KOME_ID IS NULL (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdProfilKOS.ProfilKOSWidok: KOME_PROFIL = 'T' (control=grdKompetencjeTwarde) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdProfilKOS.ProfilKOSWidok: PROFIL = 'T' AND KOME.KOME_ID IS NULL (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdProfilKOS.ProfilKOSWidok: LISC = 'T' (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdKryteriaOcenKOS.KryteriaOcenKOSWidok: LISC = 'T' (control=GridLayout) [confirmed_from_il]
- Teta.Sumo.Personel.plgKOS.CrdKompetencje.KompetencjeWidok: LISC ='T' (control=GridLayout) [confirmed_from_il]

## Konflikty (20)

- Teta.Sumo.Sales.plgSalesDictionaries.CrdPaymentMethodsTranslations.PaymentMethodsTranslationsView: lcboTyp.dataMember — Multiple dataMember values: TYP vs ZNACZENIE
- Teta.Sumo.Sales.plgSalesDictionaries.CrdPaymentMethodsTranslations.PaymentMethodsTranslationsView: lcboTyp.datasetTable — Multiple datasetTable values: FormyZaplaty vs TypFormyZaplaty
- Teta.Sumo.Sales.plgSalesDictionaries.CrdPaymentMethodsTranslations.PaymentMethodsTranslationsView: lcboTyp.dataMember — Multiple dataMember values: TYP vs WARTOSC_OD
- Teta.Sumo.Sales.plgSalesDictionaries.CrdPaymentMethodsTranslations.PaymentMethodsTranslationsView: lcboTyp.datasetTable — Multiple datasetTable values: FormyZaplaty vs TypFormyZaplaty
- Teta.Sumo.Sales.plgSalesDictionaries.CrdPaymentMethodsTranslations.PaymentMethodsTranslationsView: lcboTyp.datasetTable — Multiple datasetTable values: FormyZaplaty vs TypFormyZaplaty
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok: lcboTypStanowiska.dataMember — Multiple dataMember values: ZSTP_ID vs NAZWA
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok: lcboTypStanowiska.datasetTable — Multiple datasetTable values: KartaOpisuStanowiska vs TypyStanowisk
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok: lcboTypStanowiska.dataMember — Multiple dataMember values: ZSTP_ID vs ID
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok: lcboTypStanowiska.datasetTable — Multiple datasetTable values: KartaOpisuStanowiska vs TypyStanowisk
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok: lcboTypStanowiska.datasetTable — Multiple datasetTable values: KartaOpisuStanowiska vs TypyStanowisk
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok: lcboRodzinaStanowiska.dataMember — Multiple dataMember values: RODS_ID vs NAZWA
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok: lcboRodzinaStanowiska.datasetTable — Multiple datasetTable values: KartaOpisuStanowiska vs RodzinyStanowisk
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok: lcboRodzinaStanowiska.dataMember — Multiple dataMember values: RODS_ID vs ID
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok: lcboRodzinaStanowiska.datasetTable — Multiple datasetTable values: KartaOpisuStanowiska vs RodzinyStanowisk
- Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok: lcboRodzinaStanowiska.datasetTable — Multiple datasetTable values: KartaOpisuStanowiska vs RodzinyStanowisk
- Teta.Sumo.Personel.plgKOS.CrdPowiazaniaKOS.PowiazaniaKOSWidok: lcboTypStanowiska.dataMember — Multiple dataMember values: ZSTP_ID vs NAZWA
- Teta.Sumo.Personel.plgKOS.CrdPowiazaniaKOS.PowiazaniaKOSWidok: lcboTypStanowiska.datasetTable — Multiple datasetTable values: KartaOpisuStanowiska vs TypyStanowisk
- Teta.Sumo.Personel.plgKOS.CrdPowiazaniaKOS.PowiazaniaKOSWidok: lcboTypStanowiska.dataMember — Multiple dataMember values: ZSTP_ID vs ID
- Teta.Sumo.Personel.plgKOS.CrdPowiazaniaKOS.PowiazaniaKOSWidok: lcboTypStanowiska.datasetTable — Multiple datasetTable values: KartaOpisuStanowiska vs TypyStanowisk
- Teta.Sumo.Personel.plgKOS.CrdPowiazaniaKOS.PowiazaniaKOSWidok: lcboTypStanowiska.datasetTable — Multiple datasetTable values: KartaOpisuStanowiska vs TypyStanowisk

## Formularze bez bindingów tech. (20)

- Teta.Sumo.Personel.plgPersonelSlowniki.GenerowanieKalendarza.ActGenerowanieKalendarza (ID=523)
- Teta.Sumo.Personel.plgUrlopy.UzupelnianiePodstaw.ActUzupelnianiePodstaw (ID=473)
- Teta.Sumo.Personel.plgUrlopy.NaliczanieUrlopowWTle.ActNaliczanieUrlopuWTle (ID=1490)
- Teta.Sumo.Personel.plgUrlopy.NaliczanieUrlopow.ActNaliczanieUrlopu (ID=476)
- Teta.Sumo.Personel.plgPersonelParametryRap.Pity.PrmEPit8CShort (ID=2866)
- Teta.Sumo.Personel.plgPersonelParametryRap.Pity.PrmEPit8ARShort (ID=2796)
- Teta.Sumo.Personel.plgPersonelParametryRap.Pity.PrmEPitIFT1Short (ID=2814)
- Teta.Sumo.Personel.plgPersonelParametryRap.Pity.PrmUpo (ID=3068)
- Teta.Sumo.Personel.plgPersonelParametryRap.Pity.PrmPit11RCorrections (ID=4273)
- Teta.Sumo.Personel.plgKredyty.ZmianaStopyProcentowej.ActZmianaStopyProcentowej (ID=983)
- Teta.Sumo.Personel.plgPersonelZUS.GeneracjaDokZgloszeniowych.ActGeneracjaDokZgloszeniowych (ID=999)
- Teta.Sumo.Personel.plgPersonelSOP.WyslanieDoSOP.ActWyslanieDoSOP (ID=484)
- Teta.Sumo.Personel.plgPersonelSOP.PrzygotowanieWyplaty.ActPrzygotowanieWyplaty (ID=483)
- Teta.Sumo.Personel.plgPersonelSOP.PrzygotowaniePrzelewu.ActPrzygotowaniePrzelewu (ID=1312)
- Teta.Sumo.Finances.plgFinanseParametryRap.NotyOdsetkoweKontrahenta.PrmNotaOdsetkowa (ID=1279)
- Teta.Sumo.Finances.plgFinanseParametryRap.Kompensata.PrmKompensata (ID=1449)
- Teta.Sumo.Finances.plgFinanseParametryRap.DekretyDokumentow.PrmDekretyDokumentow (ID=1922)
- Teta.Sumo.Finances.plgFinanseParametryRap.PotwierdzeniaSald.PrmPotwierdzeniaSald (ID=2036)
- Teta.Sumo.Finances.plgFinanseParametryRap.InvertibleRIPositions.PrmInvertibleRIPositions (ID=2299)
- Teta.Sumo.Finances.plgFinanseParametryRap.CurrencyTranslationDiff.PrmCurrencyTranslationDiff (ID=2897)

## Referencje (oczekiwane / zmierzone)

### ListyZamknieteWidok
- dgcDotyczyMiesiacaAgr: dataMember="LSKO_DOTYCZY_MIESIACA" format="d" datasetTable="SkladnikiAgregacja" parameterName=null
- dgcPayDateAgr: dataMember="DATA_WYPLATY" format="d" datasetTable="SkladnikiAgregacja" parameterName=null
- tbbZamknijMiesiac: dataMember=null format=null datasetTable=null parameterName="KP_UPR_KART_LIST_ZAMKNIJ_MIES"
- WalutyDF form_DF: true
- SkladnikiAgregacja↔WalutyDF datasource_DF: false

### SkladnikiNarastajacoWidok
- dgcRok: dataMember="ROK_NUMER" format="F0" datasetTable="SkladnikiNarastajaco" parameterName=null

### ActUsuwanieWynikowObliczen
- uiControl Item: false
- dataOps keys: TylkoListyUc, UsunListyDoIFS, UsunZaksiegowaneRob
- m_DataSet dataObject: true
- m_BO businessObjectField: true
- FIRMY_UZYTKOWNIKA constant/tech: true

- DicRodzajeKoncesji: dgcKod→KOD, dgcNazwa→NAZWA, dgcAktualna→UP_TO_DATE, RodzajeKoncesjiDF, bosSalesDictionaries.dll
- StanowiskoWStrukturzeOrgWidok: 3 DS, 2 BO, lovFirmy, filtry SSTN/LISC, tree JEOR_*

**Etap 2A zamknięty** (w tym domknięcie jakościowe 2A.1). Nie rozpoczynać 2B / Help / Oracle / SqlJoin / Qdrant bez osobnej decyzji.

JSON (summary + examples): `docs/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.json`
Pełny dump (NDJSON, gitignored): `.local/AIA_FORM_TECHNICAL_BINDINGS_STAGE2A.full.ndjson`
