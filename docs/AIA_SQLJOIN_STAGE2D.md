# AIA SqlJoin reconstruction — Stage 2D

Wygenerowano: **2026-07-23T08:46:11.888Z** (static IL + Stage 2D.1 normalization)

## Zakres

- Etapy 1, 2A, 2B, 2C **bez zmian**.
- Wejście: te same bos DLL / BO / DF / TG / MTG co Stage 2B (seed z Stage 2A).
- Rekonstrukcja IL (Stage 2D): `AddJoin` / `JoinDefinition` / warianty `AddColumn` — **model grafowy**, nie SQL.
- **Stage 2D.1**: normalizacja `datasetTable`, `mainSource`, `conditionStatus`, scalanie dowodów join, dziedziczenie, aliasy, projected columns, zależności calculated.
- Stage 2B NDJSON używany **tylko odczytowo** jako dowód gateway/view/dataset table.
- **Bez** Oracle, Help, Qdrant, LLM, generatora SQL, wykonywania zapytań.

Search roots: A:\TETA Aplikacja klienta - 33.5 | A:\TETA Serwer Aplikacji - 33.5
Seed assemblies: **304**
Stage 2B hints: types=**7930**, gateways=**3238**

## Audyt (Stage 2D)

| Metryka | Wartość |
|---------|---------|
| bos assemblies resolved / missing | **304** / **0** |
| datasets analyzed | **8390** |
| datasets with main source | **5684** |
| datasets with joins | **1480** |
| joins | **7093** |
| joins with parsed condition | **2225** |
| joins with UNKNOWN type | 320 |
| projected columns | **49051** |
| calculated columns | **1284** |
| dataset columns / from join | **48959** / **1343** |
| confidence confirmed / probable / manual | **59686** / 996 / 3741 |

## Stage 2D.1 — dataset and join semantic normalization

| Metryka | Wartość |
|---------|---------|
| datasetTableColumnMisclassificationsFixed | **1577** |
| datasetsWithConfirmedDatasetTable | **5489** |
| datasetsWithUnresolvedDatasetTable | **2901** |
| datasetsWithConfirmedMainSource | **5663** |
| datasetsWithUnresolvedMainSource | **187** |
| joinsExplicitCondition | **1265** |
| joinsInheritedCondition | **557** |
| joinsConditionAddedLater | **0** |
| joinsFrameworkDefault | **0** |
| joinsDynamicUnresolved | **0** |
| joinsNotProvidedInIl | **4671** |
| joinsSuppliedByAddColumn | **600** |
| duplicateJoinEvidenceMerged | **174** |
| conflictingJoinDefinitions | **98** |
| inheritedJoins | **1734** |
| projectedColumnsWithoutExplicitDatasetAlias | **108** |
| calculatedExpressionDependenciesParsed | **1131** |

### datasetTableColumnMisclassificationsFixed (20)

- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: cleared 'SKLP_ID' (column-like)
- Teta.Sumo.Personel.bosListaPlac.BO.KartotekaListLovBO: cleared 'DATA_OBLICZEN' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.PozycjeStatusuRozrachunkowego1BO: cleared 'SYMBOL' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.LataBO: cleared 'ROK' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.OkresyLataDF: cleared 'POCZATEK' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.TypyOperacjiBO: cleared 'SYMBOL' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.TypyDokumentowBO: cleared 'NAZWA_PODTYPU' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.PeriodStatesBO: cleared 'FIRM_KOD' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.YearsStatesBO: cleared 'TETA_FIRMY' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.LataOkresyBO: cleared 'ISTNIEJE_OKRES_KOREKT' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.KursyWalutBO: cleared 'P_WALU_ID' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.BankiKursyWalutBO: cleared 'NAZWA' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.StopyProcentoweBO: cleared 'NAZWA' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.PozycjeStatusowRozrachunkowBO: cleared 'ID' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.StatusyRozrachunkoweBO: cleared 'ID' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.CourtCaseStagesBO: cleared 'TETA_FIRMY_USER_VW' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.ContactsTypesDF: cleared 'SZABLON' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.OkresyDF: cleared 'ROK' (column-like)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.OkresyBO: cleared 'ROOB' (column-like)
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.IncludedInAlgDF: cleared 'ZNACZENIE' (column-like)

### datasetsWithConfirmedDatasetTable (20)

- Teta.Sumo.Personel.bosListaPlac.BO.UsuwanieWynikowObliczenBO: FirmyUzytkownika (il)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: AggregatedComponents (il)
- Teta.Sumo.Personel.bosSPracownikBase.MTG.PracownikBaseMTG: Pracownik (stage2b)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: AggregatedComponents (il)
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: SkladnikiNarastajaco (stage2b; was SKLP_ID)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiNarastajacoTG: SkladnikiNarastajaco (il)
- Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG: ListyPracownika (il)
- Teta.Sumo.Personel.bosListaPlac.TG.PitPayrollLinksTG: PitPayrollLinks (il)
- Teta.Sumo.Personel.bosListaPlac.BO.KartotekaListBO: JednostkiOrganizacyjne (il)
- Teta.Sumo.Personel.bosListaPlac.MTG.KartotekaListMTG: NumeracjaListPlac (il)
- Teta.Sumo.Personel.bosSOrganizacja.TG.FirmyPowiazaniaTG: FirmyPowiazania (stage2b)
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.WalutyDF: Waluty (stage2b type)
- Teta.Sumo.Finances.bosFinanseSlowniki.MTG.WalutyMTG: Waluty (il)
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.TabeleStopProcentowychDF: TabeleStopProcentowych (stage2b)
- Teta.Sumo.Finances.bosFinanseSlowniki.TG.TabeleStopProcentowychTG: TabeleStopProcentowych (il)
- Teta.Sumo.Finances.bosFinanseSlowniki.MTG.TabeleStopProcentowychMTG: TabeleStopProcentowych (il)
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.TypyMonitowDF: TypyMonitow (stage2b)
- Teta.Sumo.Finances.bosFinanseSlowniki.TG.TypyMonitowTG: TypyMonitow (il)
- Teta.Sumo.Finances.bosFinanseSlowniki.MTG.TypyMonitowMTG: TypyMonitow (il)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.PozycjeStatusuRozrachunkowego1BO: PozycjeStatusowRozrachunkowych (stage2b; was SYMBOL)

### datasetsWithUnresolvedDatasetTable (20)

- Teta.Sumo.Personel.bosSOrganizacja.TG.FirmyUzytkownikaTG: unresolved
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracAgrTG: unresolved
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: unresolved
- Teta.Sumo.Personel.bosListaPlac.BO.ObliczanieListyBO: unresolved
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: unresolved
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknAgrTG: unresolved
- Teta.Sumo.Personel.bosSOrganizacja.TG.JednostkiOrganizacyjneTG: unresolved
- Teta.Sumo.Personel.bosListaPlac.BO.KorektaListyBO: unresolved
- Teta.Sumo.Personel.bosListaPlac.BO.RozliczanieNadplatIZaplatBO: unresolved
- Teta.Sumo.Personel.bosListaPlac.BO.KartotekaListLovBO: unresolved (was DATA_OBLICZEN)
- Teta.Sumo.Finances.bosFinanseSlowniki.TG.WalutyTG: unresolved
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.WalutyBO: unresolved
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.RodzajKursuDF: unresolved
- Teta.Sumo.Finances.bosFinanseSlowniki.STG.RodzajKursuTG: unresolved
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.DokumentPowiazaniaDF: unresolved
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.StatusZpDF: unresolved
- Teta.Sumo.Finances.bosFinanseSlowniki.STG.StatusZpTG: unresolved
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.CashDocumentValuationMethodsDF: unresolved
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.StatusRaportuKasowegoDF: unresolved
- Teta.Sumo.Finances.bosFinanseSlowniki.STG.StatusRaportuKasowegoTG: unresolved

### datasetsWithConfirmedMainSource (20)

- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: NT_KP_PLC_SKL_LISTY_AGR AS LSKO (confirmed_from_stage2b)
- Teta.Sumo.Personel.bosSPracownikBase.MTG.PracownikBaseMTG: NT_PA_SLO_FIRMY AS NT_PA_SLO_FIRMY (confirmed_from_stage2b)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracAgrTG: NT_KP_PLC_SKL_LISTY_AGR AS LSKO (confirmed_from_stage2b)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: NT_KP_PLC_SKLADNIKI_OBL AS LSKO (confirmed_from_stage2b)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: NT_KP_PLC_MIESIACE AS TBL1 (confirmed_from_stage2b)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: NT_KP_PLC_MIESIACE AS TBL1 (confirmed_from_stage2b)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknAgrTG: NT_KP_PLC_MIESIACE_AGR AS LMIE (confirmed_from_stage2b)
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: NT_KP_PLC_SKLADNIKI_NARAST AS LSNA (confirmed_from_join_condition_and_stage2b)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiNarastajacoTG: NT_KP_PLC_SKLADNIKI_NARAST AS LSNA (confirmed_from_stage2b)
- Teta.Sumo.Personel.bosListaPlac.TG.ListyPracownikaTG: NT_KP_PLC_LIST_PRAC AS LISP (confirmed_from_stage2b)
- Teta.Sumo.Personel.bosListaPlac.TG.PitPayrollLinksTG: KP_PIT_PAYROLL_LINKS AS PIPL (confirmed_from_stage2b)
- Teta.Sumo.Personel.bosSOrganizacja.TG.JednostkiOrganizacyjneTG: NT_PA_SLO_JEDNOSTKI_ORG AS JEOR (confirmed_from_stage2b)
- Teta.Sumo.Personel.bosSOrganizacja.TG.FirmyPowiazaniaTG: NT_PA_STO_FIRM_FIPO AS FIPO (confirmed_from_stage2b)
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.WalutyDF: NT_PA_SLO_WALUTY AS WALU (confirmed_from_stage2b)
- Teta.Sumo.Finances.bosFinanseSlowniki.TG.WalutyTG: NT_PA_SLO_WALUTY AS WALU (confirmed_from_stage2b)
- Teta.Sumo.Finances.bosFinanseSlowniki.MTG.WalutyMTG: NT_PA_SLO_WALUTY AS WALU (confirmed_from_stage2b)
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.WalutyBO: NT_PA_SLO_WALUTY AS WALU (confirmed_from_stage2b)
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.TabeleStopProcentowychDF: NT_RK_SLO_TABELE_STOP_PROC AS TASP (confirmed_from_stage2b)
- Teta.Sumo.Finances.bosFinanseSlowniki.TG.TabeleStopProcentowychTG: NT_RK_SLO_TABELE_STOP_PROC AS TASP (confirmed_from_stage2b)
- Teta.Sumo.Finances.bosFinanseSlowniki.MTG.TabeleStopProcentowychMTG: NT_RK_SLO_TABELE_STOP_PROC AS TASP (confirmed_from_stage2b)

### datasetsWithUnresolvedMainSource (20)

- Teta.Sumo.Personel.bosListaPlac.BO.KartotekaListBO: unresolved (1 joins)
- Teta.Sumo.Personel.bosListaPlac.MTG.KartotekaListMTG: unresolved (6 joins)
- Teta.Sumo.Sales.bosLoyaltyPrograms.BO.PunktyKontrahentaBO: unresolved (2 joins)
- Teta.Sumo.Sales.bosLoyaltyPrograms.BO.LoyaltyProgramsCardNumberBO: unresolved (1 joins)
- Teta.Sumo.Sales.bosLoyaltyPrograms.BO.LoyaltyProgramsSalesDocumentsBO: unresolved (1 joins)
- Teta.Sumo.Personel.bosKOS.BO.PowiazaniaKOSBO: unresolved (8 joins)
- Teta.Sumo.Personel.bosKOS.BO.ProfilKOSBO: unresolved (4 joins)
- Teta.Sumo.Personel.bosKOS.BO.KryteriaOcenKOSBO: unresolved (5 joins)
- Teta.Sumo.Personel.bosKOS.BO.GrupowePrzypisywanieKompKOSBO: unresolved (2 joins)
- Teta.Sumo.Personel.bosKOS.BO.InformacjeDodatkoweKOSBO: unresolved (3 joins)
- Teta.Sumo.Personel.bosKOS.BO.PositionValuationBO: unresolved (2 joins)
- Teta.Sumo.Personel.bosKOS.BO.PositionsStructureRegisterBO: unresolved (10 joins)
- Teta.Sumo.Personel.bosKOS.BO.KartaOpisuStanowiskaRapBO: unresolved (1 joins)
- Teta.Sumo.Personel.bosKOS.BO.KryteriaOcenArkuszaBO: unresolved (2 joins)
- Teta.Sumo.Personel.bosStanowiska.MTG.PracownikZawodMTG: unresolved (1 joins)
- Teta.Sumo.Personel.bosStanowiska.BO.AddEditPositionBO: unresolved (13 joins)
- Teta.Sumo.Logistics.bosLogistykaSlowniki.BO.WarehousesBO: unresolved (1 joins)
- Teta.Sumo.Logistics.bosKontrahenci.BO.OsobyKontaktoweBO: unresolved (1 joins)
- Teta.Sumo.Logistics.bosKontrahenci.BO.ItemProducersBO: unresolved (1 joins)
- Teta.Sumo.Logistics.bosKontrahenci.BO.ClientDetailsBO: unresolved (1 joins)

### joinsExplicitCondition (20)

- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: LUMO1 → NT_KP_KDR_UMOWY_O_PRACE [explicit_literal] LKAP.LUMO_ID = LUMO1.ID
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: LUMO1 → NT_KP_KDR_UMOWY_O_PRACE [explicit_literal] LKAP.LUMO_ID = LUMO1.ID
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: SKLP → NT_KP_SLO_SKLADNIKI_PLAC [explicit_literal] SKLP.id = TBL1.sklp_id
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: SSNA → NT_KP_SLO_SKLADNIKI_NARAST [explicit_literal] SSNA.ID = NT_KP_PLC_SKLADNIKI_NARAST.SSNA_ID 
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: SKLP → NT_KP_SLO_SKLADNIKI_PLAC [explicit_literal] SKLP.ID = SSNA.SKLP_ID
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: PIDO → KP_PLC_PIT_CORE_DATA [explicit_literal] PIPL.PIDO_ID = PIDO.ID
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: PITM → Kp_Slo_Pit_Templates [explicit_literal] PITM.ID = PIDO.PITM_ID
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: JEOR → TETA_JEDN_ORG [explicit_literal] JEOR.ID = PIDO.JEOR_ID
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.TypyDokumentowBO: TYOP → NT_RK_SLO_TYPY_OPERACJI [explicit_literal] ZWTT.TYOP_SYMBOL = TYOP.SYMBOL
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.OkresyBO: ROOB → NT_RK_SLO_LATA [explicit_literal] ROOB.ID = OKSP.ROOB_ID
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.RodzinyStanowiskBO: FIRM → TETA_FIRMY [explicit_literal] FIRM.ID = SSTN.FIRM_ID
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.GrupyCzasuPracyBO: FIRM → NT_PA_SLO_FIRMY [explicit_literal] SGRC.FIRM_ID = FIRM.ID
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.SkladnikiZUSBO: SKLP → NT_KP_SLO_SKLADNIKI_PLAC [explicit_literal] SKLP.ID = ZUSD.SKLPL_ID
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.DokumentyPitBO: ROWP → NT_KP_SLO_RODZ_WYDR_PODATK [explicit_literal] PITT.typ = ROWP.KOD_WYDRUKU
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.UprawnieniaBO: FIRM → TETA_FIRMY [explicit_literal] FIRM.ID = SUPR.FIRM_ID
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.KartotekaZestawowSkladnikowBO: FIRM → NT_PA_SLO_FIRMY [explicit_literal] TZES.FIRM_ID = FIRM.ID
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.ZestawyStatystyczneAbsencjiBO: FIRM → NT_PA_SLO_FIRMY [explicit_literal] SNIE.FIRM_ID = FIRM.ID
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.WorkTimeSystemsBO: WORU → KP_RCP_WOTS_RULES [explicit_literal] WORU.ID = WRVA.WORU_ID
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.WorkTimeSystemsBO: WORU2 → KP_RCP_WOTS_RULES [explicit_literal] WORU2.ID = WRVA2.WORU_ID
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.WorkTimeSystemsBO: WORU3 → KP_RCP_WOTS_RULES [explicit_literal] WORU3.ID = WRVA3.WORU_ID

### joinsInheritedCondition (20)

- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO: FIRM → NT_PA_SLO_FIRMY [inherited_from_base] FIRM.ID = PRAC.FIRM_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO: PIDO → KP_PLC_PIT_CORE_DATA [inherited_from_base] PIDO.ID = PIEM.PIDO_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO: KONR → NT_LG_KNR_KONTRAHENCI [inherited_from_base] PRAC.KONR_ID = KONR.ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO: FIRM → NT_PA_SLO_FIRMY [inherited_from_base] FIRM.ID = PIDO.FIRM_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO: JEOR → NT_PA_SLO_JEDNOSTKI_ORG [inherited_from_base] JEOR.ID = PIDO.JEOR_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO: PIPR → KP_PLC_PIT_PROCESSING_DETAILS [inherited_from_base] PIPR.ID = PIDO.PIPR_ID AND PIPR.SESSIONID IS NULL
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO: SPGT → KP_SLO_PIT_GATEWAYS [inherited_from_base] SPGT.ID = PIPR.SPGT_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO: PITM → KP_SLO_PIT_TEMPLATES [inherited_from_base] PIDO.PITM_ID = PITM.ID
- Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: JEOR → NT_PA_SLO_JEDNOSTKI_ORG [inherited_from_base] JEOR.ID = PIDO.JEOR_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: PIPR → KP_PLC_PIT_PROCESSING_DETAILS [inherited_from_base] PIPR.ID = PIDO.PIPR_ID AND PIPR.SESSIONID IS NULL
- Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: SPGT → KP_SLO_PIT_GATEWAYS [inherited_from_base] SPGT.ID = PIPR.SPGT_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: PITM → KP_SLO_PIT_TEMPLATES [inherited_from_base] PIDO.PITM_ID = PITM.ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO: FIRM → NT_PA_SLO_FIRMY [inherited_from_base] FIRM.ID = PRAC.FIRM_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO: PIDO → KP_PLC_PIT_CORE_DATA [inherited_from_base] PIDO.ID = PIEM.PIDO_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO: PRAC → NT_KP_PRC_PRACOWNICY [inherited_from_base] PIDO.PRAC_ID = PRAC.ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO: KONR → NT_LG_KNR_KONTRAHENCI [inherited_from_base] PRAC.KONR_ID = KONR.ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO: FIRM → NT_PA_SLO_FIRMY [inherited_from_base] FIRM.ID = PIDO.FIRM_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO: JEOR → NT_PA_SLO_JEDNOSTKI_ORG [inherited_from_base] JEOR.ID = PIDO.JEOR_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO: PIPR → KP_PLC_PIT_PROCESSING_DETAILS [inherited_from_base] PIPR.ID = PIDO.PIPR_ID AND PIPR.SESSIONID IS NULL
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO: SPGT → KP_SLO_PIT_GATEWAYS [inherited_from_base] SPGT.ID = PIPR.SPGT_ID

### joinsConditionAddedLater (20)

_brak_

### joinsFrameworkDefault (20)

_brak_

### joinsDynamicUnresolved (20)

_brak_

### joinsNotProvidedInIl (20)

- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: LIST → NT_KP_SLO_LISTY_PLAC [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: LKAP → NT_KP_PLC_KARTY_PRACY [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: LU2R → NT_KP_UCP_RACHUNKI [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: LUMO → NT_KP_KDR_UMOWY_O_PRACE [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracAgrTG: SKLP → NT_KP_SLO_SKLADNIKI_PLAC [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: SKLP → NT_KP_SLO_SKLADNIKI_PLAC [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: LIPL → NT_KP_SLO_LISTY_PLAC [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: MPK → NT_PA_SLO_MPK [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: LIST → NT_KP_SLO_LISTY_PLAC [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: LKAP → NT_KP_PLC_KARTY_PRACY [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: LU2R → NT_KP_UCP_RACHUNKI [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: LUMO → NT_KP_KDR_UMOWY_O_PRACE [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: MPK → NT_PA_SLO_MPK [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknAgrTG: SKLP → NT_KP_SLO_SKLADNIKI_PLAC [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.BO.KartotekaListBO: STDO → PA_STATUSY_DOKUMENTOW [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.MTG.KartotekaListMTG: JEOR → NT_PA_SLO_JEDNOSTKI_ORG [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.MTG.KartotekaListMTG: FIRM → NT_PA_SLO_FIRMY [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.MTG.KartotekaListMTG: LITE → NT_KP_SLO_TERMINY_WYPLAT [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.MTG.KartotekaListMTG: TAKU → NT_RK_SLO_TAKU [not_provided_in_il] (null)
- Teta.Sumo.Personel.bosListaPlac.MTG.KartotekaListMTG: SKRA → NT_KP_SLO_KRAJE [not_provided_in_il] (null)

### joinsSuppliedByAddColumn (20)

- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: LIST → NT_KP_SLO_LISTY_PLAC [supplied_by_addcolumn_overload] LISP.LIST_ID = LIST.ID
- Teta.Sumo.Personel.bosListaPlac.MTG.KartotekaListMTG: BANK → NT_PA_SLO_BANKI [supplied_by_addcolumn_overload] TAKU.BANK_ID = BANK.ID
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.ContactsTypesDF: CINU → NT_LG_SLO_CIAGI_NUMERACJI [supplied_by_addcolumn_overload] CINU.ID = BCTY.CINU_ID
- Teta.Sumo.Finances.bosFinanseSlowniki.DF.OkresyDF: ROOB → NT_RK_SLO_LATA [supplied_by_addcolumn_overload] OKSP.ROOB_ID = ROOB.ID
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.SetsOfTrainingsBO: TYSZ → KP_ZP_TYPY_SZKOLEN [supplied_by_addcolumn_overload] SZKO.TYSZ_ID = TYSZ.ID
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.SetsOfTrainingsBO: KASZ → KP_ZP_KATEGORIE_SZKOLEN [supplied_by_addcolumn_overload] SZKO.KASZ_ID = KASZ.ID
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.ScheduleDaysDF: TYDH_V → NT_KP_SLO_SCHEDULE_DAYS [supplied_by_addcolumn_overload] TYDH_V.KOD = TYDH.VALIDATION_REF_DAYS_CODE
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.ScheduleDaysDF: TYDH_VL → NT_KP_SLO_SCHEDULE_DAYS [supplied_by_addcolumn_overload] TYDH_VL.KOD = TYDH_LOV.VALIDATION_REF_DAYS_CODE
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.WorkTimeEventTypesBO: WTET3 → KP_RCP_WORK_TIME_EVENT_TYPES [supplied_by_addcolumn_overload] WTET3.ID=WTET.VALIDATE_BY_WTET_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocumentsBO: FIRM → NT_PA_SLO_FIRMY [supplied_by_addcolumn_overload] FIRM.ID = PI11.FIRM_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocumentsBO: JEOR → NT_PA_SLO_JEDNOSTKI_ORG [supplied_by_addcolumn_overload] JEOR.ID = PI11.JEOR_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocumentsBO: PITE → NT_PA_ADM_PIT_TEMPLATES [supplied_by_addcolumn_overload] PITE.ID = PI11.PITE_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocumentsBO: PIDO → KP_PLC_PIT_DOCUMENTS [supplied_by_addcolumn_overload] PIDO.ID = PI11.PIDO_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocumentsBO: PIPR → KP_PLC_PIT_PROCESSING_DETAILS [supplied_by_addcolumn_overload] PIPR.ID = PIDO.PIPR_ID AND PIPR.SESSIONID IS NULL
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit40DocumentsBO: FIRM → NT_PA_SLO_FIRMY [supplied_by_addcolumn_overload] FIRM.ID = PI40.FIRM_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit40DocumentsBO: JEOR → NT_PA_SLO_JEDNOSTKI_ORG [supplied_by_addcolumn_overload] JEOR.ID = PI40.JEOR_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit40DocumentsBO: PITE → NT_PA_ADM_PIT_TEMPLATES [supplied_by_addcolumn_overload] PITE.ID = PI40.PITE_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit40DocumentsBO: PIDO → KP_PLC_PIT_DOCUMENTS [supplied_by_addcolumn_overload] PIDO.ID = PI40.PIDO_ID
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit40DocumentsBO: PIPR → KP_PLC_PIT_PROCESSING_DETAILS [supplied_by_addcolumn_overload] PIPR.ID = PIDO.PIPR_ID AND PIPR.SESSIONID IS NULL
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8CDocumentsBO: FIRM → NT_PA_SLO_FIRMY [supplied_by_addcolumn_overload] FIRM.ID = PI8C.FIRM_ID

### duplicateJoinEvidenceMerged (20)

- Teta.Sumo.Personel.bosPersonelSlowniki.BO.ZestawSkladnikowBO: SKLP / NT_KP_SLO_SKLADNIKI_PLAC ×2 [AddJoin+AddColumn]
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.ZestawSkladnikowBO: SFOP / NT_KP_SLO_FORMULY_PODSTAW ×2 [AddJoin+AddColumn]
- Teta.Sumo.Personel.bosPersonelSlowniki.TG.ZawieszeniaTG: SSPR / NT_KP_SLO_SWIADCZENIA_PRZERWY ×2 [AddJoin+AddColumn]
- Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: PRAC / NT_KP_PRC_PRACOWNICY ×2 [JoinDefinition+JoinDefinition]
- Teta.Sumo.Sales.bosSalesDictionaries.BO.PunktySprzedazyBO: JEOR / NT_PA_SLO_JEDNOSTKI_ORG_D ×2 [JoinDefinition+JoinDefinition]
- Teta.Sumo.Sales.bosSalesDictionaries.BO.PunktySprzedazyBO: FIRM / NT_PA_SLO_FIRMY_D ×2 [JoinDefinition+JoinDefinition]
- Teta.Sumo.Personel.bosKOS.BO.ArkuszeOcenBO: KROP / NT_KP_SLO_KRYTERIA_OCEN ×2 [AddJoin+AddColumn]
- Teta.Sumo.Personel.bosKOS.BO.ArkuszeOcenBO: GKOP / NT_KP_SLO_GR_KRYTERIOW_OC ×2 [AddJoin+AddColumn]
- Teta.Sumo.Personel.bosKOS.BO.PowiazaniaKOSBO: FIRM / NT_PA_SLO_FIRMY ×2 [AddColumn+AddColumn]
- Teta.Sumo.Personel.bosKOS.BO.PowiazaniaKOSBO: JEOR / NT_PA_SLO_JEDNOSTKI_ORG ×2 [AddColumn+AddColumn]
- Teta.Sumo.Personel.bosKOS.BO.PowiazaniaKOSBO: SSTN / NT_KP_SLO_STANOWISKA ×2 [AddColumn+AddColumn]
- Teta.Sumo.Personel.bosKOS.BO.ProfilKOSBO: GRKO / NT_KP_SLO_GR_KOMPETENCJI ×2 [AddColumn+AddColumn]
- Teta.Sumo.Personel.bosKOS.BO.KryteriaOcenKOSBO: KROP / NT_KP_SLO_KRYTERIA_OCEN ×2 [AddJoin+AddColumn]
- Teta.Sumo.Personel.bosKOS.BO.KryteriaOcenKOSBO: GKOP / NT_KP_SLO_GR_KRYTERIOW_OC ×2 [AddJoin+AddColumn]
- Teta.Sumo.Personel.bosKOS.BO.PositionValuationBO: GRKR / NT_KP_SLO_GRUPY_KRYTERIOW ×2 [AddColumn+AddColumn]
- Teta.Sumo.Personel.bosStanowiska.BO.StanowiskaBO: SLKZ / NT_KP_SLO_KODY_ZAWODOW ×2 [AddColumn+JoinDefinition]
- Teta.Sumo.Personel.bosOcenaPracownika.BO.OcenaWProjekcieBO: GRKO / NT_KP_SLO_GR_KOMPETENCJI ×2 [AddJoin+AddColumn]
- Teta.Sumo.Personel.bosOcenaPracownika.BO.KompetencjePracownikaBO: GRKO / NT_KP_SLO_GR_KOMPETENCJI ×2 [AddColumn+AddColumn]
- Teta.Sumo.Personel.bosOcenaPracownika.BO.KompetencjePracownikaBO: RKOM / NT_KP_SLO_RODZ_KOMPETENCJI ×2 [AddColumn+AddColumn]
- Teta.Sumo.Personel.bosOcenaPracownika.BO.EvaluationFormsBO: WORO / KP_OPR_WORKFLOW_ROLES ×2 [AddColumn+AddColumn]

### conflictingJoinDefinitions (20)

- Teta.Sumo.Personel.bosPersonelSlowniki.BO.ZestawSkladnikowBO: SKLP / NT_KP_SLO_SKLADNIKI_PLAC
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.ZestawSkladnikowBO: SFOP / NT_KP_SLO_FORMULY_PODSTAW
- Teta.Sumo.Personel.bosPersonelSlowniki.TG.ZawieszeniaTG: SSPR / NT_KP_SLO_SWIADCZENIA_PRZERWY
- Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: PRAC / NT_KP_PRC_PRACOWNICY
- Teta.Sumo.Sales.bosSalesDictionaries.BO.PunktySprzedazyBO: JEOR / NT_PA_SLO_JEDNOSTKI_ORG_D
- Teta.Sumo.Personel.bosKOS.BO.ArkuszeOcenBO: KROP / NT_KP_SLO_KRYTERIA_OCEN
- Teta.Sumo.Personel.bosKOS.BO.ArkuszeOcenBO: GKOP / NT_KP_SLO_GR_KRYTERIOW_OC
- Teta.Sumo.Personel.bosKOS.BO.KryteriaOcenKOSBO: KROP / NT_KP_SLO_KRYTERIA_OCEN
- Teta.Sumo.Personel.bosKOS.BO.KryteriaOcenKOSBO: GKOP / NT_KP_SLO_GR_KRYTERIOW_OC
- Teta.Sumo.Personel.bosOcenaPracownika.BO.EvaluationFormsBO: WORO / KP_OPR_WORKFLOW_ROLES
- Teta.Sumo.Personel.bosOcenaPracownika.BO.EvaluationFormsBO: SKOP / KP_ZP_SKALE_OCEN_PR
- Teta.Sumo.Personel.bosOcenaPracownika.BO.MonitoringOfEvaluationsBO: WORO / KP_OPR_WORKFLOW_ROLES
- Teta.Sumo.Personel.bosOcenaPracownika.BO.MonitoringOfEvaluationsBO: PRAC / NT_KP_PRC_PRACOWNICY
- Teta.Sumo.Personel.bosRekrutacja.BO.ProjektyRekrutacjiBO: REPS / KP_SLO_REK_PROJECT_STAGES
- Teta.Sumo.Personel.bosRekrutacja.BO.ProjektyRekrutacjiBO: FIRM / NT_PA_SLO_FIRMY
- Teta.Sumo.Personel.bosRekrutacja.BO.ProjektyRekrutacjiBO: JEOR / NT_PA_SLO_JEDNOSTKI_ORG
- Teta.Sumo.Personel.bosRekrutacja.BO.ProjektyRekrutacjiBO: SSTN / NT_KP_SLO_STANOWISKA
- Teta.Sumo.Personel.bosRekrutacja.BO.ProjektyRekrutacjiBO: LABE / KP_REK_LABELS
- Teta.Sumo.Personel.bosRekrutacja.BO.RecruitmentProposalsDetailsBO: GRKO / NT_KP_SLO_GR_KOMPETENCJI
- Teta.Sumo.Personel.bosPracownik.BO.QuestionnairesRegisterBO: S_SLWO / NT_KP_SLO_WOJEWODZTWA

### inheritedJoins (20)

- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: FIRM → NT_PA_SLO_FIRMY
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: PIDO → KP_PLC_PIT_CORE_DATA
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: KONR → NT_LG_KNR_KONTRAHENCI
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: FIRM → NT_PA_SLO_FIRMY
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: JEOR → NT_PA_SLO_JEDNOSTKI_ORG
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: PIPR → KP_PLC_PIT_PROCESSING_DETAILS
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: SPGT → KP_SLO_PIT_GATEWAYS
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit11DocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: PITM → KP_SLO_PIT_TEMPLATES
- Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: JEOR → NT_PA_SLO_JEDNOSTKI_ORG
- Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: PIPR → KP_PLC_PIT_PROCESSING_DETAILS
- Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: SPGT → KP_SLO_PIT_GATEWAYS
- Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: PITM → KP_SLO_PIT_TEMPLATES
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: FIRM → NT_PA_SLO_FIRMY
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: PIDO → KP_PLC_PIT_CORE_DATA
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: PRAC → NT_KP_PRC_PRACOWNICY
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitEmplDocsBaseBO: KONR → NT_LG_KNR_KONTRAHENCI
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: FIRM → NT_PA_SLO_FIRMY
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: JEOR → NT_PA_SLO_JEDNOSTKI_ORG
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: PIPR → KP_PLC_PIT_PROCESSING_DETAILS
- Teta.Sumo.Personel.bosPitDocuments.BO.Pit8cDocsBO ← Teta.Sumo.Personel.bosPitDocuments.BO.PitDocsBaseBO: SPGT → KP_SLO_PIT_GATEWAYS

### projectedColumnsWithoutExplicitDatasetAlias (20)

- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: LIPL.TYTUL → effective=TYTUL
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: LIPL.NUMER → effective=NUMER
- Teta.Sumo.Personel.bosKOS.BO.StanowiskoWStrukturzeOrgBO: SMPK.KOD KOD_MPK → effective=KOD KOD_MPK
- Teta.Sumo.Personel.bosKOS.BO.StanowiskoWStrukturzeOrgBO: SMPK.NAZWA NAZWA_MPK → effective=NAZWA NAZWA_MPK
- Teta.Sumo.Logistics.bosLogistykaSlowniki.MTG.RodzajeSrodkowTransportuMTG: ROST.ID → effective=ID
- Teta.Sumo.Personel.bosUrlopy.BO.PlanyUrlopowBO: P_Wymiary_Urlopow.Wymiar (PRAC_ID, :PARAMETRY.DATA_DO, CECHA_NIEOBECNOSCI) WYMIAR_DNI_INFO → effective=DATA_DO, CECHA_NIEOBECNOSCI) WYMIAR_DNI_INFO
- Teta.Sumo.Personel.bosUrlopy.BO.PlanyUrlopowBO: P_Wymiary_Urlopow.Wymiar_zalegly (PRAC_ID, :PARAMETRY.DATA_DO, CECHA_NIEOBECNOSCI) WYMIAR_ZALEGLY_INFO → effective=DATA_DO, CECHA_NIEOBECNOSCI) WYMIAR_ZALEGLY_INFO
- Teta.Sumo.Personel.bosUrlopy.BO.PlanyUrlopowBO: (P_Wymiary_Urlopow.Pozostalo (PRAC_ID, LAST_DAY (:PARAMETRY.DATA_DO), CECHA_NIEOBECNOSCI) - Kp_Plud_Sql.Dlugosc_Planowana (NULL, PRAC_ID, SNIE_ID, TRUNC (:PARAMETRY.DATA_DO, 'YEAR'))) ZOST_WYPOCZ_INFO → effective=DATA_DO, 'YEAR'))) ZOST_WYPOCZ_INFO
- Teta.Sumo.Personel.bosUrlopy.BO.PlanyUrlopowBO: GREATEST (P_Wymiary_Urlopow.Pozostalo_Dod_Zal (PRAC_ID, LAST_DAY (:PARAMETRY.DATA_DO), CECHA_NIEOBECNOSCI) - Kp_Plud_Sql.Dlugosc_Planowana (NULL, PRAC_ID, SNIE_ID, TRUNC (:PARAMETRY.DATA_DO, 'YEAR')),0) ZOST_ZALEGLEGO_INFO → effective=DATA_DO, 'YEAR')),0) ZOST_ZALEGLEGO_INFO
- Teta.Sumo.Administration.bosAdministrationDictionaries.BO.PropertiesAdditionTypesBO: (SELECT COUNT (*) FROM lg_ceo_przypiecia_cech prce WHERE prce.ceob_id = ceob.id) IstniejaPodpieteWartosci → effective=id) IstniejaPodpieteWartosci
- Teta.Sumo.Personel.bosRekrutacja.BO.KartotekaWakatowBO: WMPK.WAKA_ID → effective=WAKA_ID
- Teta.Sumo.AccountAssignment.bosObiektyEwidencyjne.BO.OpisPozycjiBO: POGR.KOLUMNA1 → effective=KOLUMNA1
- Teta.Sumo.AccountAssignment.bosObiektyEwidencyjne.BO.OpisPozycjiBO: POGR.KOLUMNA2 → effective=KOLUMNA2
- Teta.Sumo.AccountAssignment.bosObiektyEwidencyjne.BO.OpisPozycjiBO: POGR.KOLUMNA3 → effective=KOLUMNA3
- Teta.Sumo.AccountAssignment.bosObiektyEwidencyjne.BO.OpisPozycjiBO: POGR.KOLUMNA4 → effective=KOLUMNA4
- Teta.Sumo.AccountAssignment.bosObiektyEwidencyjne.BO.OpisPozycjiBO: POGR.KOLUMNA5 → effective=KOLUMNA5
- Teta.Sumo.AccountAssignment.bosObiektyEwidencyjne.BO.OpisPozycjiBO: POGR.KOLUMNA6 → effective=KOLUMNA6
- Teta.Sumo.AccountAssignment.bosObiektyEwidencyjne.BO.OpisPozycjiBO: POGR.KOLUMNA7 → effective=KOLUMNA7
- Teta.Sumo.AccountAssignment.bosObiektyEwidencyjne.BO.OpisPozycjiBO: POGR.KOLUMNA8 → effective=KOLUMNA8
- Teta.Sumo.AccountAssignment.bosObiektyEwidencyjne.BO.OpisPozycjiBO: POGR.KOLUMNA9 → effective=KOLUMNA9

### calculatedExpressionDependenciesParsed (20)

- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: DECODE(SKLP.TYP,'C',LUMO.NUMER_TYMC,'H',LUMO.NUMER_TYMC,NULL) → pkgs=
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: DECODE (LKAP.NUMER, NULL, TO_CHAR (LKAP.ID), LKAP.NUMER ) → pkgs=
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: DECODE(SKLP.TYP,'C',LUMO.NUMER_TYMC,'H',LUMO.NUMER_TYMC,NULL) → pkgs=
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: KP_LISP_SQL.Get_Status_For_Pit11(p_lisp_id => LISP.ID) → pkgs=KP_LISP_SQL
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: (SELECT piad.value_n FROM Kp_Plc_Pit_Additional_Data piad WHERE piad.pido_id = p → pkgs=
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: (SELECT piad.value FROM Kp_Plc_Pit_Additional_Data piad WHERE piad.pido_id = pid → pkgs=
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: DECODE (PIDO.STATUS, 'R', 'Z', 'A', 'Z', PIDO.STATUS) → pkgs=
- Teta.Sumo.Personel.bosListaPlac.BO.KartotekaListBO: KP_list_sql.liczba_prac(LIST.ID) → pkgs=
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.TerminyWyplatDF: KP_LITE_SQL.Pinned_Company_ID(LITE.ID) → pkgs=KP_LITE_SQL
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.StaleDodatkiDF: KP_SDOD_SQL.FIRM_ID_SDOD(SDOD.ID) → pkgs=KP_SDOD_SQL
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.TypDniaDF: CASE WARTOSC_OD  WHEN 'SO' THEN DECODE (Api_Pa_Param.Wartosc_Parametru (p_kod_pa → pkgs=
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.RodzajeSzkolenBHPDF: KP_SLSZ_SQL.Pinned_Company_ID(SLSZ.ID) → pkgs=KP_SLSZ_SQL
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.RodzajeUmowDF: KP_SUMO_SQL.Is_Used_For_Employees_TN(ID) → pkgs=KP_SUMO_SQL
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.StalePotraceniaDF: KP_SPST_SQL.FIRM_ID_SPST(SPST.ID) → pkgs=KP_SPST_SQL
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.StalePotraceniaDF: KP_SPST_SQL.IS_ANY_SETTLED(SPST.ID) → pkgs=KP_SPST_SQL
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.BenefitsInKindsBO: NT_KP_DSO_SWIADCZ_RZECZOWE_DAE.Istnieje (SSWR.ID) → pkgs=NT_KP_DSO_SWIADCZ_RZECZOWE_DAE
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.ZapomogiLosoweDF: NT_KP_DSO_ZAPOMOGI_DAC.Istnieje(ID) → pkgs=NT_KP_DSO_ZAPOMOGI_DAC
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.BailoutTypesBO: NT_KP_DSO_WCZASY_KOLONIE_DAE.Istnieje (DSSW.ID) → pkgs=NT_KP_DSO_WCZASY_KOLONIE_DAE
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.ZawieszeniaDF: KP_SZPR_SQL.Can_change_company(SZPR.ID) → pkgs=KP_SZPR_SQL
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.UprawnieniaDF: KP_SUPR_SQL.can_change_company(SUPR.ID) → pkgs=KP_SUPR_SQL

## Przykłady joinów (20)

- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: LIST → NT_KP_SLO_LISTY_PLAC [LEFT] (no condition) status=not_provided_in_il via AddColumn (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: LKAP → NT_KP_PLC_KARTY_PRACY [LEFT] (no condition) status=not_provided_in_il via JoinDefinition (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: LU2R → NT_KP_UCP_RACHUNKI [LEFT] (no condition) status=not_provided_in_il via JoinDefinition (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: LUMO → NT_KP_KDR_UMOWY_O_PRACE [LEFT] (no condition) status=not_provided_in_il via JoinDefinition (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: LUMO1 → NT_KP_KDR_UMOWY_O_PRACE [LEFT] LKAP.LUMO_ID = LUMO1.ID status=explicit_literal via JoinDefinition (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracAgrTG: SKLP → NT_KP_SLO_SKLADNIKI_PLAC [UNKNOWN] (no condition) status=not_provided_in_il via AddJoin (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: SKLP → NT_KP_SLO_SKLADNIKI_PLAC [INNER] (no condition) status=not_provided_in_il via AddJoin (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: LIPL → NT_KP_SLO_LISTY_PLAC [INNER] (no condition) status=not_provided_in_il via AddJoin (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: MPK → NT_PA_SLO_MPK [LEFT] (no condition) status=not_provided_in_il via AddJoin (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: LIST → NT_KP_SLO_LISTY_PLAC [LEFT] (no condition) status=not_provided_in_il via AddColumn (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: LKAP → NT_KP_PLC_KARTY_PRACY [LEFT] (no condition) status=not_provided_in_il via JoinDefinition (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: LU2R → NT_KP_UCP_RACHUNKI [LEFT] (no condition) status=not_provided_in_il via JoinDefinition (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: LUMO → NT_KP_KDR_UMOWY_O_PRACE [LEFT] (no condition) status=not_provided_in_il via JoinDefinition (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: LUMO1 → NT_KP_KDR_UMOWY_O_PRACE [LEFT] LKAP.LUMO_ID = LUMO1.ID status=explicit_literal via JoinDefinition (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: SKLP → NT_KP_SLO_SKLADNIKI_PLAC [INNER] SKLP.id = TBL1.sklp_id status=explicit_literal via AddJoin (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: MPK → NT_PA_SLO_MPK [LEFT] (no condition) status=not_provided_in_il via AddJoin (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknAgrTG: SKLP → NT_KP_SLO_SKLADNIKI_PLAC [UNKNOWN] (no condition) status=not_provided_in_il via AddJoin (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: SSNA → NT_KP_SLO_SKLADNIKI_NARAST [INNER] SSNA.ID = NT_KP_PLC_SKLADNIKI_NARAST.SSNA_ID status=explicit_literal via AddJoin (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: SKLP → NT_KP_SLO_SKLADNIKI_PLAC [INNER] SKLP.ID = SSNA.SKLP_ID status=explicit_literal via AddJoin (confirmed_from_il)
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: LIST → NT_KP_SLO_LISTY_PLAC [INNER] LISP.LIST_ID = LIST.ID status=supplied_by_addcolumn_overload via AddColumn (confirmed_from_il)

## Przykłady kolumn z joina (20)

- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracAgrTG: SKLP.PRESENTATION_TYPE → explicit=SKLP_PRESENTATION_TYPE (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracAgrTG: SKLP.ORDER_OF_COMPONENTS → explicit=SKLP_ORDER_OF_COMPONENTS (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: SKLP.KOD → explicit=SKLP_KOD (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: SKLP.TYTUL → explicit=SKLP_TYTUL (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: SKLP.TYP → explicit=SKLP_TYP (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: SKLP.ROZBIJANY_WG_MPK → explicit=SKLP_ROZBIJANY_WG_MPK (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: SKLP.UC → explicit=SKLP_UC (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: SKLP.PODLEGA_DEKRETACJI → explicit=SKLP_PODLEGA_DEKRETACJI (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: SKLP.PRESENTATION_TYPE → explicit=SKLP_PRESENTATION_TYPE (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: SKLP.ORDER_OF_COMPONENTS → explicit=SKLP_ORDER_OF_COMPONENTS (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: LIPL.TYTUL → effective=TYTUL (framework_derived) (alias=LIPL)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: LIPL.NUMER → effective=NUMER (framework_derived) (alias=LIPL)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: MPK.KOD → explicit=MPK_KOD (alias=MPK)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG: MPK.NAZWA → explicit=MPK_NAZWA (alias=MPK)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: SKLP.ROZBIJANY_WG_MPK → explicit=SKLP_ROZBIJANY_WG_MPK (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: SKLP.UC → explicit=SKLP_UC (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: SKLP.PODLEGA_DEKRETACJI → explicit=SKLP_PODLEGA_DEKRETACJI (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: SKLP.PRESENTATION_TYPE → explicit=SKLP_PRESENTATION_TYPE (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: SKLP.ORDER_OF_COMPONENTS → explicit=SKLP_ORDER_OF_COMPONENTS (alias=SKLP)
- Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiMiesiaceZamknUnionTG: MPK.KOD → explicit=MPK_KOD (alias=MPK)

## Przykłady calculated (20)

- Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO: DECODE(SKLP.TYP,'C',LUMO.NUMER_TYMC,'H',LUMO.NUMER_TYMC,NULL) → NUMER_TYMC pkgs=[] fn=[] cols=[SKLP.TYP,LUMO.NUMER_TYMC]
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: DECODE (LKAP.NUMER, NULL, TO_CHAR (LKAP.ID), LKAP.NUMER ) → LKAP_NUMER pkgs=[] fn=[] cols=[LKAP.NUMER,LKAP.ID]
- Teta.Sumo.Personel.bosListaPlac.BO.ListyZamkMiesBO: DECODE(SKLP.TYP,'C',LUMO.NUMER_TYMC,'H',LUMO.NUMER_TYMC,NULL) → NUMER_TYMC pkgs=[] fn=[] cols=[SKLP.TYP,LUMO.NUMER_TYMC]
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: KP_LISP_SQL.Get_Status_For_Pit11(p_lisp_id => LISP.ID) → PIT11_ISSUING_STATUS pkgs=[KP_LISP_SQL] fn=[Get_Status_For_Pit11] cols=[LISP.ID]
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: (SELECT piad.value_n FROM Kp_Plc_Pit_Additional_Data piad WHERE piad.pido_id = pido.id AND piad.code = '11_INF_NUMBER') → PI11_INFORMATION_NUMBER pkgs=[] fn=[] cols=[piad.value_n,piad.pido_id,pido.id,piad.code]
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: (SELECT piad.value FROM Kp_Plc_Pit_Additional_Data piad WHERE piad.pido_id = pido.id AND piad.code = '11_PREPARING_MODE') → PI11_PREPARING_MODE pkgs=[] fn=[] cols=[piad.value,piad.pido_id,pido.id,piad.code]
- Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO: DECODE (PIDO.STATUS, 'R', 'Z', 'A', 'Z', PIDO.STATUS) → PI11_STATUS pkgs=[] fn=[] cols=[PIDO.STATUS]
- Teta.Sumo.Personel.bosListaPlac.BO.KartotekaListBO: KP_list_sql.liczba_prac(LIST.ID) → LICZBA_OSOB pkgs=[] fn=[] cols=[KP_list_sql.liczba_prac,LIST.ID]
- Teta.Sumo.Finances.bosFinanseSlowniki.BO.TypyOperacjiBO: CAST (-100 AS NUMBER (10, 0)) → TYOP_ID pkgs=[] fn=[] cols=[]
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.TerminyWyplatDF: KP_LITE_SQL.Pinned_Company_ID(LITE.ID) → Pinned_FIRM_ID pkgs=[KP_LITE_SQL] fn=[Pinned_Company_ID] cols=[LITE.ID]
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.StaleDodatkiDF: KP_SDOD_SQL.FIRM_ID_SDOD(SDOD.ID) → FIRM_ID_SDOD pkgs=[KP_SDOD_SQL] fn=[FIRM_ID_SDOD] cols=[SDOD.ID]
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.TypDniaDF: CASE WARTOSC_OD  WHEN 'SO' THEN DECODE (Api_Pa_Param.Wartosc_Parametru (p_kod_para => 'TG_KP_RCP_DAY_TYPE_WNS'), 'N', 'T', 'N')  WHEN 'WN' THEN Api_Pa_Param.Wartosc_Parametru (p_kod_para => 'TG_KP_RCP_DAY_TYPE_WNS')  WHEN 'WS' THEN Api_Pa_Param.Wartosc_Parametru (p_kod_para => 'TG_KP_RCP_DAY_TYPE_WNS')  ELSE 'T'END → UP_TO_DATE pkgs=[] fn=[] cols=[Api_Pa_Param.Wartosc_Parametru]
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.RodzajeSzkolenBHPDF: KP_SLSZ_SQL.Pinned_Company_ID(SLSZ.ID) → Pinned_FIRM_ID pkgs=[KP_SLSZ_SQL] fn=[Pinned_Company_ID] cols=[SLSZ.ID]
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.RodzajeUmowDF: KP_SUMO_SQL.Is_Used_For_Employees_TN(ID) → ALREADY_USED pkgs=[KP_SUMO_SQL] fn=[Is_Used_For_Employees_TN] cols=[]
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.StalePotraceniaDF: KP_SPST_SQL.FIRM_ID_SPST(SPST.ID) → FIRM_ID_SPST pkgs=[KP_SPST_SQL] fn=[FIRM_ID_SPST] cols=[SPST.ID]
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.StalePotraceniaDF: KP_SPST_SQL.IS_ANY_SETTLED(SPST.ID) → IS_ANY_SETTLED pkgs=[KP_SPST_SQL] fn=[IS_ANY_SETTLED] cols=[SPST.ID]
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.BenefitsInKindsBO: NT_KP_DSO_SWIADCZ_RZECZOWE_DAE.Istnieje (SSWR.ID) → UNMODIFIABLE pkgs=[NT_KP_DSO_SWIADCZ_RZECZOWE_DAE] fn=[Istnieje] cols=[SSWR.ID]
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.ZapomogiLosoweDF: NT_KP_DSO_ZAPOMOGI_DAC.Istnieje(ID) → ZABLOKOWAC pkgs=[NT_KP_DSO_ZAPOMOGI_DAC] fn=[Istnieje] cols=[]
- Teta.Sumo.Personel.bosPersonelSlowniki.BO.BailoutTypesBO: NT_KP_DSO_WCZASY_KOLONIE_DAE.Istnieje (DSSW.ID) → UNMODIFIABLE pkgs=[NT_KP_DSO_WCZASY_KOLONIE_DAE] fn=[Istnieje] cols=[DSSW.ID]
- Teta.Sumo.Personel.bosPersonelSlowniki.DF.ZawieszeniaDF: KP_SZPR_SQL.Can_change_company(SZPR.ID) → CAN_CHANGE_COMPANY pkgs=[KP_SZPR_SQL] fn=[Can_change_company] cols=[SZPR.ID]

## Referencje

```json
{
  "SkladnikiObliczZamknPracTG": {
    "declaringType": "Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG",
    "datasetTable": null,
    "datasetTableStatus": "unresolved",
    "mainSource": {
      "objectName": "NT_KP_PLC_SKLADNIKI_OBL",
      "alias": "LSKO",
      "objectKind": "view",
      "source": "confirmed_from_stage2b",
      "confidence": "confirmed_from_stage2b"
    },
    "joins": [
      {
        "joinedObject": "NT_KP_SLO_SKLADNIKI_PLAC",
        "alias": "SKLP",
        "rawAlias": "SKLP",
        "normalizedAlias": "SKLP",
        "joinType": "INNER",
        "conditionStatus": "not_provided_in_il",
        "sourceApi": "AddJoin",
        "sourceApis": [
          "AddJoin"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "NT_KP_SLO_LISTY_PLAC",
        "alias": "LIPL",
        "rawAlias": "LIPL",
        "normalizedAlias": "LIPL",
        "joinType": "INNER",
        "conditionStatus": "not_provided_in_il",
        "sourceApi": "AddJoin",
        "sourceApis": [
          "AddJoin"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "NT_PA_SLO_MPK",
        "alias": "MPK",
        "rawAlias": "MPK",
        "normalizedAlias": "MPK",
        "joinType": "LEFT",
        "conditionStatus": "not_provided_in_il",
        "sourceApi": "AddJoin",
        "sourceApis": [
          "AddJoin"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.TG.SkladnikiObliczZamknPracTG",
        "confidence": "confirmed_from_il"
      }
    ],
    "declaredJoinsCount": 3,
    "inheritedJoinsCount": 0,
    "projectedColumns": [
      {
        "sourceAlias": "SKLP",
        "sourceColumn": "KOD",
        "expression": "SKLP.KOD",
        "datasetColumn": "SKLP_KOD",
        "datasetColumnExplicit": "SKLP_KOD",
        "effectiveDatasetColumn": "SKLP_KOD",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "SKLP",
        "sourceColumn": "TYTUL",
        "expression": "SKLP.TYTUL",
        "datasetColumn": "SKLP_TYTUL",
        "datasetColumnExplicit": "SKLP_TYTUL",
        "effectiveDatasetColumn": "SKLP_TYTUL",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "SKLP",
        "sourceColumn": "TYP",
        "expression": "SKLP.TYP",
        "datasetColumn": "SKLP_TYP",
        "datasetColumnExplicit": "SKLP_TYP",
        "effectiveDatasetColumn": "SKLP_TYP",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "SKLP",
        "sourceColumn": "ROZBIJANY_WG_MPK",
        "expression": "SKLP.ROZBIJANY_WG_MPK",
        "datasetColumn": "SKLP_ROZBIJANY_WG_MPK",
        "datasetColumnExplicit": "SKLP_ROZBIJANY_WG_MPK",
        "effectiveDatasetColumn": "SKLP_ROZBIJANY_WG_MPK",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "SKLP",
        "sourceColumn": "UC",
        "expression": "SKLP.UC",
        "datasetColumn": "SKLP_UC",
        "datasetColumnExplicit": "SKLP_UC",
        "effectiveDatasetColumn": "SKLP_UC",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "SKLP",
        "sourceColumn": "PODLEGA_DEKRETACJI",
        "expression": "SKLP.PODLEGA_DEKRETACJI",
        "datasetColumn": "SKLP_PODLEGA_DEKRETACJI",
        "datasetColumnExplicit": "SKLP_PODLEGA_DEKRETACJI",
        "effectiveDatasetColumn": "SKLP_PODLEGA_DEKRETACJI",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "SKLP",
        "sourceColumn": "PRESENTATION_TYPE",
        "expression": "SKLP.PRESENTATION_TYPE",
        "datasetColumn": "SKLP_PRESENTATION_TYPE",
        "datasetColumnExplicit": "SKLP_PRESENTATION_TYPE",
        "effectiveDatasetColumn": "SKLP_PRESENTATION_TYPE",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "SKLP",
        "sourceColumn": "ORDER_OF_COMPONENTS",
        "expression": "SKLP.ORDER_OF_COMPONENTS",
        "datasetColumn": "SKLP_ORDER_OF_COMPONENTS",
        "datasetColumnExplicit": "SKLP_ORDER_OF_COMPONENTS",
        "effectiveDatasetColumn": "SKLP_ORDER_OF_COMPONENTS",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIPL",
        "sourceColumn": "TYTUL",
        "expression": "LIPL.TYTUL",
        "datasetColumn": "TYTUL",
        "datasetColumnExplicit": null,
        "effectiveDatasetColumn": "TYTUL",
        "effectiveDatasetColumnStatus": "framework_derived",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIPL",
        "sourceColumn": "NUMER",
        "expression": "LIPL.NUMER",
        "datasetColumn": "NUMER",
        "datasetColumnExplicit": null,
        "effectiveDatasetColumn": "NUMER",
        "effectiveDatasetColumnStatus": "framework_derived",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "MPK",
        "sourceColumn": "KOD",
        "expression": "MPK.KOD",
        "datasetColumn": "MPK_KOD",
        "datasetColumnExplicit": "MPK_KOD",
        "effectiveDatasetColumn": "MPK_KOD",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "MPK",
        "sourceColumn": "NAZWA",
        "expression": "MPK.NAZWA",
        "datasetColumn": "MPK_NAZWA",
        "datasetColumnExplicit": "MPK_NAZWA",
        "effectiveDatasetColumn": "MPK_NAZWA",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      }
    ]
  },
  "SkladnikiNarastajacoBO": {
    "declaringType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
    "datasetTable": "SkladnikiNarastajaco",
    "datasetTableStatus": "confirmed_from_stage2b",
    "mainSource": {
      "objectName": "NT_KP_PLC_SKLADNIKI_NARAST",
      "alias": "LSNA",
      "objectKind": "view",
      "source": "confirmed_from_join_condition_and_stage2b",
      "confidence": "confirmed_from_stage2b"
    },
    "joins": [
      {
        "joinedObject": "NT_KP_SLO_SKLADNIKI_NARAST",
        "alias": "SSNA",
        "rawAlias": "SSNA",
        "normalizedAlias": "SSNA",
        "joinType": "INNER",
        "condition": {
          "leftAlias": "SSNA",
          "leftColumn": "ID",
          "operator": "=",
          "rightAlias": "NT_KP_PLC_SKLADNIKI_NARAST",
          "rightColumn": "SSNA_ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "SSNA.ID = NT_KP_PLC_SKLADNIKI_NARAST.SSNA_ID ",
        "conditionStatus": "explicit_literal",
        "sourceApi": "AddJoin",
        "sourceApis": [
          "AddJoin"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "NT_KP_SLO_SKLADNIKI_PLAC",
        "alias": "SKLP",
        "rawAlias": "SKLP",
        "normalizedAlias": "SKLP",
        "joinType": "INNER",
        "condition": {
          "leftAlias": "SKLP",
          "leftColumn": "ID",
          "operator": "=",
          "rightAlias": "SSNA",
          "rightColumn": "SKLP_ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "SKLP.ID = SSNA.SKLP_ID",
        "conditionStatus": "explicit_literal",
        "sourceApi": "AddJoin",
        "sourceApis": [
          "AddJoin"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "NT_KP_SLO_LISTY_PLAC",
        "alias": "LIST",
        "rawAlias": "LIST",
        "normalizedAlias": "LIST",
        "joinType": "INNER",
        "condition": {
          "leftAlias": "LISP",
          "leftColumn": "LIST_ID",
          "operator": "=",
          "rightAlias": "LIST",
          "rightColumn": "ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "LISP.LIST_ID = LIST.ID",
        "conditionStatus": "supplied_by_addcolumn_overload",
        "sourceApi": "AddColumn",
        "sourceApis": [
          "AddColumn"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "KP_PLC_PIT_CORE_DATA",
        "alias": "PIDO",
        "rawAlias": "PIDO",
        "normalizedAlias": "PIDO",
        "joinType": "LEFT",
        "condition": {
          "leftAlias": "PIPL",
          "leftColumn": "PIDO_ID",
          "operator": "=",
          "rightAlias": "PIDO",
          "rightColumn": "ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "PIPL.PIDO_ID = PIDO.ID",
        "conditionStatus": "explicit_literal",
        "sourceApi": "AddJoin",
        "sourceApis": [
          "AddJoin"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "Kp_Slo_Pit_Templates",
        "alias": "PITM",
        "rawAlias": "PITM",
        "normalizedAlias": "PITM",
        "joinType": "LEFT",
        "condition": {
          "leftAlias": "PITM",
          "leftColumn": "ID",
          "operator": "=",
          "rightAlias": "PIDO",
          "rightColumn": "PITM_ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "PITM.ID = PIDO.PITM_ID",
        "conditionStatus": "explicit_literal",
        "sourceApi": "JoinDefinition",
        "sourceApis": [
          "JoinDefinition"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "TETA_JEDN_ORG",
        "alias": "JEOR",
        "rawAlias": "JEOR",
        "normalizedAlias": "JEOR",
        "joinType": "LEFT",
        "condition": {
          "leftAlias": "JEOR",
          "leftColumn": "ID",
          "operator": "=",
          "rightAlias": "PIDO",
          "rightColumn": "JEOR_ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "JEOR.ID = PIDO.JEOR_ID",
        "conditionStatus": "explicit_literal",
        "sourceApi": "JoinDefinition",
        "sourceApis": [
          "JoinDefinition"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
        "confidence": "confirmed_from_il"
      }
    ],
    "declaredJoinsCount": 6,
    "inheritedJoinsCount": 0,
    "projectedColumns": [
      {
        "sourceAlias": "SSNA",
        "sourceColumn": "SKLP_ID",
        "expression": "SSNA.SKLP_ID",
        "datasetColumn": "SKLP_ID",
        "datasetColumnExplicit": "SKLP_ID",
        "effectiveDatasetColumn": "SKLP_ID",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "SKLP",
        "sourceColumn": "TYTUL",
        "expression": "SKLP.TYTUL",
        "datasetColumn": "SKLP_TYTUL",
        "datasetColumnExplicit": "SKLP_TYTUL",
        "effectiveDatasetColumn": "SKLP_TYTUL",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "SKLP",
        "sourceColumn": "KOD",
        "expression": "SKLP.KOD",
        "datasetColumn": "SKLP_KOD",
        "datasetColumnExplicit": "SKLP_KOD",
        "effectiveDatasetColumn": "SKLP_KOD",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "TYTUL",
        "expression": "LIST.TYTUL",
        "datasetColumn": "LIST_TYTUL",
        "datasetColumnExplicit": "LIST_TYTUL",
        "effectiveDatasetColumn": "LIST_TYTUL",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "NUMER",
        "expression": "LIST.NUMER",
        "datasetColumn": "LIST_NUMER",
        "datasetColumnExplicit": "LIST_NUMER",
        "effectiveDatasetColumn": "LIST_NUMER",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "TYP",
        "expression": "LIST.TYP",
        "datasetColumn": "LIST_TYP",
        "datasetColumnExplicit": "LIST_TYP",
        "effectiveDatasetColumn": "LIST_TYP",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "DATA_WYPLATY",
        "expression": "LIST.DATA_WYPLATY",
        "datasetColumn": "LIST_DATA_WYPLATY",
        "datasetColumnExplicit": "LIST_DATA_WYPLATY",
        "effectiveDatasetColumn": "LIST_DATA_WYPLATY",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "TAX_DATE",
        "expression": "LIST.TAX_DATE",
        "datasetColumn": "TAX_DATE",
        "datasetColumnExplicit": "TAX_DATE",
        "effectiveDatasetColumn": "TAX_DATE",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "INCLUDED_IN_ALGORITHM",
        "expression": "LIST.INCLUDED_IN_ALGORITHM",
        "datasetColumn": "INCLUDED_IN_ALGORITHM",
        "datasetColumnExplicit": "INCLUDED_IN_ALGORITHM",
        "effectiveDatasetColumn": "INCLUDED_IN_ALGORITHM",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "DATA_ROZL_ZUS",
        "expression": "LIST.DATA_ROZL_ZUS",
        "datasetColumn": "DATA_ROZL_ZUS",
        "datasetColumnExplicit": "DATA_ROZL_ZUS",
        "effectiveDatasetColumn": "DATA_ROZL_ZUS",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "MIESIAC_KOREKTY",
        "expression": "LIST.MIESIAC_KOREKTY",
        "datasetColumn": "MIESIAC_KOREKTY",
        "datasetColumnExplicit": "MIESIAC_KOREKTY",
        "effectiveDatasetColumn": "MIESIAC_KOREKTY",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": null,
        "sourceColumn": "KP_LISP_SQL.Get_Status_For_Pit11(p_lisp_id => LISP.ID)",
        "expression": "KP_LISP_SQL.Get_Status_For_Pit11(p_lisp_id => LISP.ID)",
        "datasetColumn": "PIT11_ISSUING_STATUS",
        "datasetColumnExplicit": "PIT11_ISSUING_STATUS",
        "effectiveDatasetColumn": "PIT11_ISSUING_STATUS",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": true,
        "calculatedDependencies": {
          "referencedAliases": [
            "LISP"
          ],
          "referencedColumns": [
            "LISP.ID"
          ],
          "referencedPackages": [
            "KP_LISP_SQL"
          ],
          "referencedFunctions": [
            "Get_Status_For_Pit11"
          ],
          "referencedSubqueryObjects": []
        }
      },
      {
        "sourceAlias": "JEOR",
        "sourceColumn": "NAZWA",
        "expression": "JEOR.NAZWA",
        "datasetColumn": "JEOR_NAZWA",
        "datasetColumnExplicit": "JEOR_NAZWA",
        "effectiveDatasetColumn": "JEOR_NAZWA",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": null,
        "sourceColumn": "(SELECT piad.value_n FROM Kp_Plc_Pit_Additional_Data piad WHERE piad.pido_id = pido.id AND piad.code = '11_INF_NUMBER')",
        "expression": "(SELECT piad.value_n FROM Kp_Plc_Pit_Additional_Data piad WHERE piad.pido_id = pido.id AND piad.code = '11_INF_NUMBER')",
        "datasetColumn": "PI11_INFORMATION_NUMBER",
        "datasetColumnExplicit": "PI11_INFORMATION_NUMBER",
        "effectiveDatasetColumn": "PI11_INFORMATION_NUMBER",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": true,
        "calculatedDependencies": {
          "referencedAliases": [
            "piad",
            "pido"
          ],
          "referencedColumns": [
            "piad.value_n",
            "piad.pido_id",
            "pido.id",
            "piad.code"
          ],
          "referencedPackages": [],
          "referencedFunctions": [],
          "referencedSubqueryObjects": [
            "Kp_Plc_Pit_Additional_Data"
          ]
        }
      },
      {
        "sourceAlias": "PIDO",
        "sourceColumn": "ISSUE_DATE",
        "expression": "PIDO.ISSUE_DATE",
        "datasetColumn": "PI11_ISSUE_DATE",
        "datasetColumnExplicit": "PI11_ISSUE_DATE",
        "effectiveDatasetColumn": "PI11_ISSUE_DATE",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "pitm",
        "sourceColumn": "version",
        "expression": "pitm.version",
        "datasetColumn": "PI11_DOCUMENT_VERSION",
        "datasetColumnExplicit": "PI11_DOCUMENT_VERSION",
        "effectiveDatasetColumn": "PI11_DOCUMENT_VERSION",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "PIDO",
        "sourceColumn": "PURPOSE",
        "expression": "PIDO.PURPOSE",
        "datasetColumn": "PI11_SUBMISSION_PURPOSE",
        "datasetColumnExplicit": "PI11_SUBMISSION_PURPOSE",
        "effectiveDatasetColumn": "PI11_SUBMISSION_PURPOSE",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": null,
        "sourceColumn": "(SELECT piad.value FROM Kp_Plc_Pit_Additional_Data piad WHERE piad.pido_id = pido.id AND piad.code = '11_PREPARING_MODE')",
        "expression": "(SELECT piad.value FROM Kp_Plc_Pit_Additional_Data piad WHERE piad.pido_id = pido.id AND piad.code = '11_PREPARING_MODE')",
        "datasetColumn": "PI11_PREPARING_MODE",
        "datasetColumnExplicit": "PI11_PREPARING_MODE",
        "effectiveDatasetColumn": "PI11_PREPARING_MODE",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": true,
        "calculatedDependencies": {
          "referencedAliases": [
            "piad",
            "pido"
          ],
          "referencedColumns": [
            "piad.value",
            "piad.pido_id",
            "pido.id",
            "piad.code"
          ],
          "referencedPackages": [],
          "referencedFunctions": [],
          "referencedSubqueryObjects": [
            "Kp_Plc_Pit_Additional_Data"
          ]
        }
      },
      {
        "sourceAlias": null,
        "sourceColumn": "DECODE (PIDO.STATUS, 'R', 'Z', 'A', 'Z', PIDO.STATUS)",
        "expression": "DECODE (PIDO.STATUS, 'R', 'Z', 'A', 'Z', PIDO.STATUS)",
        "datasetColumn": "PI11_STATUS",
        "datasetColumnExplicit": "PI11_STATUS",
        "effectiveDatasetColumn": "PI11_STATUS",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": true,
        "calculatedDependencies": {
          "referencedAliases": [
            "PIDO"
          ],
          "referencedColumns": [
            "PIDO.STATUS"
          ],
          "referencedPackages": [],
          "referencedFunctions": [],
          "referencedSubqueryObjects": []
        }
      }
    ]
  },
  "ListyBaseBO": {
    "declaringType": "Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO",
    "datasetTable": "AggregatedComponents",
    "datasetTableStatus": "confirmed_from_il",
    "mainSource": {
      "objectName": "NT_KP_PLC_SKL_LISTY_AGR",
      "alias": "LSKO",
      "objectKind": "view",
      "source": "confirmed_from_stage2b",
      "confidence": "confirmed_from_stage2b"
    },
    "joins": [
      {
        "joinedObject": "NT_KP_SLO_LISTY_PLAC",
        "alias": "LIST",
        "rawAlias": "LIST",
        "normalizedAlias": "LIST",
        "joinType": "LEFT",
        "conditionStatus": "not_provided_in_il",
        "sourceApi": "AddColumn",
        "sourceApis": [
          "AddColumn"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "NT_KP_PLC_KARTY_PRACY",
        "alias": "LKAP",
        "rawAlias": "LKAP",
        "normalizedAlias": "LKAP",
        "joinType": "LEFT",
        "conditionStatus": "not_provided_in_il",
        "sourceApi": "JoinDefinition",
        "sourceApis": [
          "JoinDefinition"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "NT_KP_UCP_RACHUNKI",
        "alias": "LU2R",
        "rawAlias": "LU2R",
        "normalizedAlias": "LU2R",
        "joinType": "LEFT",
        "conditionStatus": "not_provided_in_il",
        "sourceApi": "JoinDefinition",
        "sourceApis": [
          "JoinDefinition"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "NT_KP_KDR_UMOWY_O_PRACE",
        "alias": "LUMO",
        "rawAlias": "LUMO",
        "normalizedAlias": "LUMO",
        "joinType": "LEFT",
        "conditionStatus": "not_provided_in_il",
        "sourceApi": "JoinDefinition",
        "sourceApis": [
          "JoinDefinition"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "NT_KP_KDR_UMOWY_O_PRACE",
        "alias": "LUMO1",
        "rawAlias": "LUMO1",
        "normalizedAlias": "LUMO1",
        "joinType": "LEFT",
        "condition": {
          "leftAlias": "LKAP",
          "leftColumn": "LUMO_ID",
          "operator": "=",
          "rightAlias": "LUMO1",
          "rightColumn": "ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "LKAP.LUMO_ID = LUMO1.ID",
        "conditionStatus": "explicit_literal",
        "sourceApi": "JoinDefinition",
        "sourceApis": [
          "JoinDefinition"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.ListyBaseBO",
        "confidence": "confirmed_from_il"
      }
    ],
    "declaredJoinsCount": 5,
    "inheritedJoinsCount": 0,
    "projectedColumns": [
      {
        "sourceAlias": null,
        "sourceColumn": "DECODE(SKLP.TYP,'C',LUMO.NUMER_TYMC,'H',LUMO.NUMER_TYMC,NULL)",
        "expression": "DECODE(SKLP.TYP,'C',LUMO.NUMER_TYMC,'H',LUMO.NUMER_TYMC,NULL)",
        "datasetColumn": "NUMER_TYMC",
        "datasetColumnExplicit": "NUMER_TYMC",
        "effectiveDatasetColumn": "NUMER_TYMC",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": true,
        "calculatedDependencies": {
          "referencedAliases": [
            "SKLP",
            "LUMO"
          ],
          "referencedColumns": [
            "SKLP.TYP",
            "LUMO.NUMER_TYMC"
          ],
          "referencedPackages": [],
          "referencedFunctions": [],
          "referencedSubqueryObjects": []
        }
      }
    ]
  },
  "exampleWithJeorJoin": {
    "declaringType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
    "datasetTable": "SkladnikiNarastajaco",
    "datasetTableStatus": "confirmed_from_stage2b",
    "mainSource": {
      "objectName": "NT_KP_PLC_SKLADNIKI_NARAST",
      "alias": "LSNA",
      "objectKind": "view",
      "source": "confirmed_from_join_condition_and_stage2b",
      "confidence": "confirmed_from_stage2b"
    },
    "joins": [
      {
        "joinedObject": "NT_KP_SLO_SKLADNIKI_NARAST",
        "alias": "SSNA",
        "rawAlias": "SSNA",
        "normalizedAlias": "SSNA",
        "joinType": "INNER",
        "condition": {
          "leftAlias": "SSNA",
          "leftColumn": "ID",
          "operator": "=",
          "rightAlias": "NT_KP_PLC_SKLADNIKI_NARAST",
          "rightColumn": "SSNA_ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "SSNA.ID = NT_KP_PLC_SKLADNIKI_NARAST.SSNA_ID ",
        "conditionStatus": "explicit_literal",
        "sourceApi": "AddJoin",
        "sourceApis": [
          "AddJoin"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "NT_KP_SLO_SKLADNIKI_PLAC",
        "alias": "SKLP",
        "rawAlias": "SKLP",
        "normalizedAlias": "SKLP",
        "joinType": "INNER",
        "condition": {
          "leftAlias": "SKLP",
          "leftColumn": "ID",
          "operator": "=",
          "rightAlias": "SSNA",
          "rightColumn": "SKLP_ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "SKLP.ID = SSNA.SKLP_ID",
        "conditionStatus": "explicit_literal",
        "sourceApi": "AddJoin",
        "sourceApis": [
          "AddJoin"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "NT_KP_SLO_LISTY_PLAC",
        "alias": "LIST",
        "rawAlias": "LIST",
        "normalizedAlias": "LIST",
        "joinType": "INNER",
        "condition": {
          "leftAlias": "LISP",
          "leftColumn": "LIST_ID",
          "operator": "=",
          "rightAlias": "LIST",
          "rightColumn": "ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "LISP.LIST_ID = LIST.ID",
        "conditionStatus": "supplied_by_addcolumn_overload",
        "sourceApi": "AddColumn",
        "sourceApis": [
          "AddColumn"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "KP_PLC_PIT_CORE_DATA",
        "alias": "PIDO",
        "rawAlias": "PIDO",
        "normalizedAlias": "PIDO",
        "joinType": "LEFT",
        "condition": {
          "leftAlias": "PIPL",
          "leftColumn": "PIDO_ID",
          "operator": "=",
          "rightAlias": "PIDO",
          "rightColumn": "ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "PIPL.PIDO_ID = PIDO.ID",
        "conditionStatus": "explicit_literal",
        "sourceApi": "AddJoin",
        "sourceApis": [
          "AddJoin"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "Kp_Slo_Pit_Templates",
        "alias": "PITM",
        "rawAlias": "PITM",
        "normalizedAlias": "PITM",
        "joinType": "LEFT",
        "condition": {
          "leftAlias": "PITM",
          "leftColumn": "ID",
          "operator": "=",
          "rightAlias": "PIDO",
          "rightColumn": "PITM_ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "PITM.ID = PIDO.PITM_ID",
        "conditionStatus": "explicit_literal",
        "sourceApi": "JoinDefinition",
        "sourceApis": [
          "JoinDefinition"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
        "confidence": "confirmed_from_il"
      },
      {
        "joinedObject": "TETA_JEDN_ORG",
        "alias": "JEOR",
        "rawAlias": "JEOR",
        "normalizedAlias": "JEOR",
        "joinType": "LEFT",
        "condition": {
          "leftAlias": "JEOR",
          "leftColumn": "ID",
          "operator": "=",
          "rightAlias": "PIDO",
          "rightColumn": "JEOR_ID",
          "confidence": "confirmed_from_literal"
        },
        "rawCondition": "JEOR.ID = PIDO.JEOR_ID",
        "conditionStatus": "explicit_literal",
        "sourceApi": "JoinDefinition",
        "sourceApis": [
          "JoinDefinition"
        ],
        "inheritanceKind": "declared",
        "declaredOnType": "Teta.Sumo.Personel.bosListaPlac.BO.SkladnikiNarastajacoBO",
        "confidence": "confirmed_from_il"
      }
    ],
    "declaredJoinsCount": 6,
    "inheritedJoinsCount": 0,
    "projectedColumns": [
      {
        "sourceAlias": "SSNA",
        "sourceColumn": "SKLP_ID",
        "expression": "SSNA.SKLP_ID",
        "datasetColumn": "SKLP_ID",
        "datasetColumnExplicit": "SKLP_ID",
        "effectiveDatasetColumn": "SKLP_ID",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "SKLP",
        "sourceColumn": "TYTUL",
        "expression": "SKLP.TYTUL",
        "datasetColumn": "SKLP_TYTUL",
        "datasetColumnExplicit": "SKLP_TYTUL",
        "effectiveDatasetColumn": "SKLP_TYTUL",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "SKLP",
        "sourceColumn": "KOD",
        "expression": "SKLP.KOD",
        "datasetColumn": "SKLP_KOD",
        "datasetColumnExplicit": "SKLP_KOD",
        "effectiveDatasetColumn": "SKLP_KOD",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "TYTUL",
        "expression": "LIST.TYTUL",
        "datasetColumn": "LIST_TYTUL",
        "datasetColumnExplicit": "LIST_TYTUL",
        "effectiveDatasetColumn": "LIST_TYTUL",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "NUMER",
        "expression": "LIST.NUMER",
        "datasetColumn": "LIST_NUMER",
        "datasetColumnExplicit": "LIST_NUMER",
        "effectiveDatasetColumn": "LIST_NUMER",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "TYP",
        "expression": "LIST.TYP",
        "datasetColumn": "LIST_TYP",
        "datasetColumnExplicit": "LIST_TYP",
        "effectiveDatasetColumn": "LIST_TYP",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "DATA_WYPLATY",
        "expression": "LIST.DATA_WYPLATY",
        "datasetColumn": "LIST_DATA_WYPLATY",
        "datasetColumnExplicit": "LIST_DATA_WYPLATY",
        "effectiveDatasetColumn": "LIST_DATA_WYPLATY",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "TAX_DATE",
        "expression": "LIST.TAX_DATE",
        "datasetColumn": "TAX_DATE",
        "datasetColumnExplicit": "TAX_DATE",
        "effectiveDatasetColumn": "TAX_DATE",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "INCLUDED_IN_ALGORITHM",
        "expression": "LIST.INCLUDED_IN_ALGORITHM",
        "datasetColumn": "INCLUDED_IN_ALGORITHM",
        "datasetColumnExplicit": "INCLUDED_IN_ALGORITHM",
        "effectiveDatasetColumn": "INCLUDED_IN_ALGORITHM",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "DATA_ROZL_ZUS",
        "expression": "LIST.DATA_ROZL_ZUS",
        "datasetColumn": "DATA_ROZL_ZUS",
        "datasetColumnExplicit": "DATA_ROZL_ZUS",
        "effectiveDatasetColumn": "DATA_ROZL_ZUS",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "LIST",
        "sourceColumn": "MIESIAC_KOREKTY",
        "expression": "LIST.MIESIAC_KOREKTY",
        "datasetColumn": "MIESIAC_KOREKTY",
        "datasetColumnExplicit": "MIESIAC_KOREKTY",
        "effectiveDatasetColumn": "MIESIAC_KOREKTY",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": null,
        "sourceColumn": "KP_LISP_SQL.Get_Status_For_Pit11(p_lisp_id => LISP.ID)",
        "expression": "KP_LISP_SQL.Get_Status_For_Pit11(p_lisp_id => LISP.ID)",
        "datasetColumn": "PIT11_ISSUING_STATUS",
        "datasetColumnExplicit": "PIT11_ISSUING_STATUS",
        "effectiveDatasetColumn": "PIT11_ISSUING_STATUS",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": true,
        "calculatedDependencies": {
          "referencedAliases": [
            "LISP"
          ],
          "referencedColumns": [
            "LISP.ID"
          ],
          "referencedPackages": [
            "KP_LISP_SQL"
          ],
          "referencedFunctions": [
            "Get_Status_For_Pit11"
          ],
          "referencedSubqueryObjects": []
        }
      },
      {
        "sourceAlias": "JEOR",
        "sourceColumn": "NAZWA",
        "expression": "JEOR.NAZWA",
        "datasetColumn": "JEOR_NAZWA",
        "datasetColumnExplicit": "JEOR_NAZWA",
        "effectiveDatasetColumn": "JEOR_NAZWA",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": null,
        "sourceColumn": "(SELECT piad.value_n FROM Kp_Plc_Pit_Additional_Data piad WHERE piad.pido_id = pido.id AND piad.code = '11_INF_NUMBER')",
        "expression": "(SELECT piad.value_n FROM Kp_Plc_Pit_Additional_Data piad WHERE piad.pido_id = pido.id AND piad.code = '11_INF_NUMBER')",
        "datasetColumn": "PI11_INFORMATION_NUMBER",
        "datasetColumnExplicit": "PI11_INFORMATION_NUMBER",
        "effectiveDatasetColumn": "PI11_INFORMATION_NUMBER",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": true,
        "calculatedDependencies": {
          "referencedAliases": [
            "piad",
            "pido"
          ],
          "referencedColumns": [
            "piad.value_n",
            "piad.pido_id",
            "pido.id",
            "piad.code"
          ],
          "referencedPackages": [],
          "referencedFunctions": [],
          "referencedSubqueryObjects": [
            "Kp_Plc_Pit_Additional_Data"
          ]
        }
      },
      {
        "sourceAlias": "PIDO",
        "sourceColumn": "ISSUE_DATE",
        "expression": "PIDO.ISSUE_DATE",
        "datasetColumn": "PI11_ISSUE_DATE",
        "datasetColumnExplicit": "PI11_ISSUE_DATE",
        "effectiveDatasetColumn": "PI11_ISSUE_DATE",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "pitm",
        "sourceColumn": "version",
        "expression": "pitm.version",
        "datasetColumn": "PI11_DOCUMENT_VERSION",
        "datasetColumnExplicit": "PI11_DOCUMENT_VERSION",
        "effectiveDatasetColumn": "PI11_DOCUMENT_VERSION",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": "PIDO",
        "sourceColumn": "PURPOSE",
        "expression": "PIDO.PURPOSE",
        "datasetColumn": "PI11_SUBMISSION_PURPOSE",
        "datasetColumnExplicit": "PI11_SUBMISSION_PURPOSE",
        "effectiveDatasetColumn": "PI11_SUBMISSION_PURPOSE",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": false,
        "calculatedDependencies": null
      },
      {
        "sourceAlias": null,
        "sourceColumn": "(SELECT piad.value FROM Kp_Plc_Pit_Additional_Data piad WHERE piad.pido_id = pido.id AND piad.code = '11_PREPARING_MODE')",
        "expression": "(SELECT piad.value FROM Kp_Plc_Pit_Additional_Data piad WHERE piad.pido_id = pido.id AND piad.code = '11_PREPARING_MODE')",
        "datasetColumn": "PI11_PREPARING_MODE",
        "datasetColumnExplicit": "PI11_PREPARING_MODE",
        "effectiveDatasetColumn": "PI11_PREPARING_MODE",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": true,
        "calculatedDependencies": {
          "referencedAliases": [
            "piad",
            "pido"
          ],
          "referencedColumns": [
            "piad.value",
            "piad.pido_id",
            "pido.id",
            "piad.code"
          ],
          "referencedPackages": [],
          "referencedFunctions": [],
          "referencedSubqueryObjects": [
            "Kp_Plc_Pit_Additional_Data"
          ]
        }
      },
      {
        "sourceAlias": null,
        "sourceColumn": "DECODE (PIDO.STATUS, 'R', 'Z', 'A', 'Z', PIDO.STATUS)",
        "expression": "DECODE (PIDO.STATUS, 'R', 'Z', 'A', 'Z', PIDO.STATUS)",
        "datasetColumn": "PI11_STATUS",
        "datasetColumnExplicit": "PI11_STATUS",
        "effectiveDatasetColumn": "PI11_STATUS",
        "effectiveDatasetColumnStatus": "explicit",
        "calculated": true,
        "calculatedDependencies": {
          "referencedAliases": [
            "PIDO"
          ],
          "referencedColumns": [
            "PIDO.STATUS"
          ],
          "referencedPackages": [],
          "referencedFunctions": [],
          "referencedSubqueryObjects": []
        }
      }
    ]
  }
}
```

JSON: `docs/AIA_SQLJOIN_STAGE2D.json`
Pełny dump: `.local/AIA_SQLJOIN_STAGE2D.full.ndjson`
CLI: `pnpm --filter @teta/api run diagnose:stage2d`
