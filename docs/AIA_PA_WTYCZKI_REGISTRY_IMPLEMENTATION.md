# AIA PA_WTYCZKI registry — Etap 1

## Domknięcie diagnostyczne (2026-07-22)

Rozbito dawne `not_found` (132) i `not_checked` (398) bez zmiany ekstrakcji TypeDef / verified_exact.

| Status | Przed (zbiorczo) | Po |
|--------|------------------|-----|
| verified_exact | 3030 | **3030** |
| matched_unique_simple_name | 1 | **1** (namespaceMismatch=true) |
| type_not_found | (w not_found) | **4** |
| class_name_missing | (w not_found) | **128** |
| dll_unavailable | (w not_checked) | **398** |
| not_checked | 398 | **0** |
| assembly_unreadable | 0 | **0** |

DLL missing 526 → `assembly_null` 128 / `physical_file_missing` 21 / `unsupported_assembly_reference` 377 (WebConstellation).

---

Wygenerowano: **2026-07-22T15:52:16.150Z** (read-only)

## Konfiguracja

| Pole | Wartość |
|------|---------|
| clientDirectory | `A:\TETA Aplikacja klienta - 33.5` |
| clientDirectory istnieje | **true** |
| pluginsRoot | `A:\TETA Aplikacja klienta - 33.5\Plugins` |
| plugins.xml wymagany | **nie** |
| Źródło kanoniczne | Oracle `PA_WTYCZKI` |
| Metadata reader | `tools/TetaDllMetadataReader` (System.Reflection.Metadata, bez wykonywania kodu) |
| Oracle / odczyt | OK |

## Podsumowanie (Etap 1 — statusy rozdzielone)

| Metryka | Wartość |
|---------|---------|
| Rekordy PA_WTYCZKI / registryStatus=confirmed | **3561** / **3561** |
| DLL resolved / missing / conflicting | **3035** / 526 / 0 |
| DLL missing: assembly_null | 128 |
| DLL missing: assembly_empty | 0 |
| DLL missing: physical_file_missing | 21 |
| DLL missing: unsupported_assembly_reference | 377 |
| DLL missing: unresolved_name | 0 |
| DLL missing: other | 0 |
| classDeclarationStatus=confirmed_by_registry | **3433** |
| verified_exact | **3030** |
| verified_normalized | **0** |
| verified_case_insensitive | **0** |
| matched_unique_simple_name (namespaceMismatch) | 1 (**1**) |
| ambiguous_simple_name | 0 |
| type_not_found | **4** |
| class_name_missing | **128** |
| dll_unavailable | **398** |
| assembly_unreadable | 0 |
| not_checked | 0 |
| Help found / missing | **1773** / 1788 |
| Typy TypeDef łącznie (unikalne DLL) | **11800** (avg ~37.3/DLL) |
| Matched z PluginAttribute / PluginGroup | 2928 / 970 |
| Matched z baseType / XML doc | 3031 / 0 |
| Interesting members / IL strings | 533 / 3889 |
| Zeskanowane DLL w Plugins | 425 |
| confidence(deprecated)=confirmed | 1767 |

## Domknięcie diagnostyczne statusów

- `class_name_missing` — puste `NAZWA_KLASY` (nie jest błędem wyszukiwania typu)
- `dll_unavailable` — klasy nie sprawdzono, bo DLL nie resolved
- `type_not_found` — DLL OK, metadata OK, typ nie dopasowany
- `matched_unique_simple_name` + `namespaceMismatch` — nie podnosić do verified_exact

## Przykładowe łańcuchy (5)

- ID=452
  GUID=3b253949-d7f8-4094-acfd-713027eacbfb
  ASSEMBLY=plgListaPlac.dll
  DLL=A:\TETA Aplikacja klienta - 33.5\Plugins\Personnel\plgListaPlac.dll [resolved]
  CLASS=Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen.ActUsuwanieWynikowObliczen
  registryStatus=confirmed
  classDeclarationStatus=confirmed_by_registry
  classVerificationStatus=verified_exact
  matched=Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen / ActUsuwanieWynikowObliczen
  HELP=A:\TETA Aplikacja klienta - 33.5\Help\3b253949-d7f8-4094-acfd-713027eacbfb.html exists=true [found]
  formIdentity=3b253949-d7f8-4094-acfd-713027eacbfb:teta.sumo.personel.plglistaplac.usuwaniewynikowobliczen.actusuwaniewynikowobliczen
- ID=1009
  GUID=670ab806-2885-4f00-94cf-e86a5f545c85
  ASSEMBLY=plgSalesDictionaries.dll
  DLL=A:\TETA Aplikacja klienta - 33.5\Plugins\Sales\plgSalesDictionaries.dll [resolved]
  CLASS=Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji
  registryStatus=confirmed
  classDeclarationStatus=confirmed_by_registry
  classVerificationStatus=verified_exact
  matched=Teta.Sumo.Sales.plgSalesDictionaries / DicRodzajeKoncesji
  HELP=A:\TETA Aplikacja klienta - 33.5\Help\670ab806-2885-4f00-94cf-e86a5f545c85.html exists=true [found]
  formIdentity=670ab806-2885-4f00-94cf-e86a5f545c85:teta.sumo.sales.plgsalesdictionaries.dicrodzajekoncesji
- ID=732
  GUID=469e7730-e558-4631-a897-dfba526dda36
  ASSEMBLY=plgKOS.dll
  DLL=A:\TETA Aplikacja klienta - 33.5\Plugins\Personnel\plgKOS.dll [resolved]
  CLASS=Teta.Sumo.Personel.plgKOS.CrdStanowiskoWStrukturzeOrg.StanowiskoWStrukturzeOrgWidok
  registryStatus=confirmed
  classDeclarationStatus=confirmed_by_registry
  classVerificationStatus=verified_exact
  matched=Teta.Sumo.Personel.plgKOS.CrdStanowiskoWStrukturzeOrg / StanowiskoWStrukturzeOrgWidok
  HELP=A:\TETA Aplikacja klienta - 33.5\Help\469e7730-e558-4631-a897-dfba526dda36.html exists=true [found]
  formIdentity=469e7730-e558-4631-a897-dfba526dda36:teta.sumo.personel.plgkos.crdstanowiskowstrukturzeorg.stanowiskowstrukturzeorgwidok
- ID=735
  GUID=c660b15e-8865-4a65-8692-d8e7df503ff0
  ASSEMBLY=plgPersonelSlowniki.dll
  DLL=A:\TETA Aplikacja klienta - 33.5\Plugins\Personnel\plgPersonelSlowniki.dll [resolved]
  CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.DicZrodlaOcen
  registryStatus=confirmed
  classDeclarationStatus=confirmed_by_registry
  classVerificationStatus=verified_exact
  matched=Teta.Sumo.Personel.plgPersonelSlowniki / DicZrodlaOcen
  HELP=A:\TETA Aplikacja klienta - 33.5\Help\c660b15e-8865-4a65-8692-d8e7df503ff0.html exists=true [found]
  formIdentity=c660b15e-8865-4a65-8692-d8e7df503ff0:teta.sumo.personel.plgpersonelslowniki.diczrodlaocen
- ID=737
  GUID=18afa59e-c034-4831-9198-cf919653354a
  ASSEMBLY=plgPersonelSlowniki.dll
  DLL=A:\TETA Aplikacja klienta - 33.5\Plugins\Personnel\plgPersonelSlowniki.dll [resolved]
  CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.DicZadaniaStanowiska
  registryStatus=confirmed
  classDeclarationStatus=confirmed_by_registry
  classVerificationStatus=verified_exact
  matched=Teta.Sumo.Personel.plgPersonelSlowniki / DicZadaniaStanowiska
  HELP=A:\TETA Aplikacja klienta - 33.5\Help\18afa59e-c034-4831-9198-cf919653354a.html exists=true [found]
  formIdentity=18afa59e-c034-4831-9198-cf919653354a:teta.sumo.personel.plgpersonelslowniki.diczadaniastanowiska

## Przykłady weryfikacji klas (max 20)

### verified_exact
- ID=452 CLASS=Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen.ActUsuwanieWynikowObliczen DLL=plgListaPlac.dll ns=Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen name=ActUsuwanieWynikowObliczen
- ID=1009 CLASS=Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji DLL=plgSalesDictionaries.dll ns=Teta.Sumo.Sales.plgSalesDictionaries name=DicRodzajeKoncesji
- ID=732 CLASS=Teta.Sumo.Personel.plgKOS.CrdStanowiskoWStrukturzeOrg.StanowiskoWStrukturzeOrgWidok DLL=plgKOS.dll ns=Teta.Sumo.Personel.plgKOS.CrdStanowiskoWStrukturzeOrg name=StanowiskoWStrukturzeOrgWidok
- ID=735 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.DicZrodlaOcen DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki name=DicZrodlaOcen
- ID=737 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.DicZadaniaStanowiska DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki name=DicZadaniaStanowiska
- ID=738 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.DicInformacjeDodatkowe DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki name=DicInformacjeDodatkowe
- ID=739 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.DicWspolpraca DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki name=DicWspolpraca
- ID=740 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.DicWyposazenie DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki name=DicWyposazenie
- ID=1010 CLASS=Teta.Sumo.Logistics.plgKontrahenci.CrdOsobyKontaktowe.OsobyKontaktoweWidok DLL=plgKontrahenci.dll ns=Teta.Sumo.Logistics.plgKontrahenci.CrdOsobyKontaktowe name=OsobyKontaktoweWidok
- ID=827 CLASS=Teta.Sumo.SOP.plgWyciagiBankowe.CrdWyciagiBankoweSzczegoly.WyciagiBankoweSzczegolyWidok DLL=plgWyciagiBankowe.dll ns=Teta.Sumo.SOP.plgWyciagiBankowe.CrdWyciagiBankoweSzczegoly name=WyciagiBankoweSzczegolyWidok
- ID=459 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.DicOkresyWypowiedzen DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki name=DicOkresyWypowiedzen
- ID=460 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.DicRodzajeOdpraw DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki name=DicRodzajeOdpraw
- ID=1041 CLASS=Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok DLL=plgZapotrzebowaniaZakupu.dll ns=Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan name=KartotekaZapotrzebowanWidok
- ID=462 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.CrdTaxConstants.TaxConstantsView DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki.CrdTaxConstants name=TaxConstantsView
- ID=463 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.CrdKartyPracy.KartyPracyWidok DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki.CrdKartyPracy name=KartyPracyWidok
- ID=464 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.CrdRodzajeNieobecnosci.RodzajeNieobecnosciWidok DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki.CrdRodzajeNieobecnosci name=RodzajeNieobecnosciWidok
- ID=465 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.DicZawody DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki name=DicZawody
- ID=466 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.DicOdpowiedzialnoscRzeczowa DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki name=DicOdpowiedzialnoscRzeczowa
- ID=467 CLASS=Teta.Sumo.Personel.plgPersonelSlowniki.CrdSkladnikiPlacowe.SkladnikiPlacoweWidok DLL=plgPersonelSlowniki.dll ns=Teta.Sumo.Personel.plgPersonelSlowniki.CrdSkladnikiPlacowe name=SkladnikiPlacoweWidok
- ID=478 CLASS=Teta.Sumo.Personel.plgUrlopy.PrzeliczaniePodstaw.ActPrzeliczaniePodstaw DLL=plgUrlopy.dll ns=Teta.Sumo.Personel.plgUrlopy.PrzeliczaniePodstaw name=ActPrzeliczaniePodstaw

### verified_normalized
_brak_

### matched_unique_simple_name
- ID=2489 CLASS=Teta.Sumo.Logistics.plgKontrahenciSprzedaz.CrdHistoriaPrzedstawicieli.HistoriaPrzedstawicieliWidok matched=Teta.Sumo.Logistics.plgKontrahenciSprzedazKln.CrdHistoriaPrzedstawicieli.HistoriaPrzedstawicieliWidok namespaceMismatch=true requestedNs=Teta.Sumo.Logistics.plgKontrahenciSprzedaz.CrdHistoriaPrzedstawicieli matchedNs=Teta.Sumo.Logistics.plgKontrahenciSprzedazKln.CrdHistoriaPrzedstawicieli

### ambiguous_simple_name
_brak_

### type_not_found
- ID=1656 CLASS=Teta.Sumo.Sales.plgSalesReports.Lists.PrmZestawienieVATOperacjiSprzedaży DLL=plgSalesReports.dll reason=type_not_found_namespace simpleHits=1 diff=namespace nearest=Teta.Sumo.Sales.plgSalesReports.Lists.PrmZestawienieVATOperacjiSprzedaży | Teta.Sumo.Sales.plgSalesReports.Lists.PrmZestawienieFakturSprzedazy | Teta.Sumo.Sales.plgSalesReports.Lists.PrmZestawienieMarzySprzedazy
- ID=2001 CLASS=Teta.Sumo.Logistics.plgLogistykaParametryRap.Zestawienia.PrmZestawienieMarzySprzedazy DLL=plgLogistykaParametryRap.dll reason=type_not_found simpleHits=0 diff=- nearest=Teta.Sumo.Logistics.plgLogistykaParametryRap.Zestawienia.PrmZestawienieDokPZbezFZ | Teta.Sumo.Logistics.plgLogistykaParametryRap.Zestawienia.PrmZestawienieRoznicFZiPZ | Teta.Sumo.Logistics.plgLogistykaParametryRap.Zestawienia.PrmZestawienieFakturZakupu
- ID=2333 CLASS=Teta.Sumo.Production.plgProductionDocuments.CrdProductionDocumentDefects.ProductionDocumentDefectsView DLL=plgProductionDocuments.dll reason=type_not_found simpleHits=0 diff=- nearest=Teta.Sumo.Production.plgProductionDocuments.CrdProductionDocumentTimes.ProductionDocumentTimesView | Teta.Sumo.Production.plgProductionDocuments.CrdProductionDocumentProducts.ProductionDocumentProductsView | Teta.Sumo.Production.plgProductionDocuments.CrdProductionDocuments.ProductionDocumentsView
- ID=3140 CLASS=Teta.Sumo.Personel.plgPersonelParametryRap.Zestawienia.PrmTabelarycznaListaPlacMod DLL=plgPersonelParametryRap.dll reason=type_not_found_typo simpleHits=0 diff=typo nearest=Teta.Sumo.Personel.plgPersonelParametryRap.Zestawienia.PrmTabelarycznaListaPlac | Teta.Sumo.Personel.plgPersonelParametryRap.Zestawienia.PrmUniwersalnaListaPlac | Teta.Sumo.Personel.plgPersonelParametryRap.PrmUniwersalnaListaPlacEnum

### class_name_missing
- ID=798 CLASS=null DLL= ns=- name=-
- ID=1773 CLASS=null DLL= ns=- name=-
- ID=1832 CLASS=null DLL= ns=- name=-
- ID=1836 CLASS=null DLL= ns=- name=-
- ID=2010 CLASS=null DLL= ns=- name=-
- ID=2011 CLASS=null DLL= ns=- name=-
- ID=2067 CLASS=null DLL= ns=- name=-
- ID=2073 CLASS=null DLL= ns=- name=-
- ID=2176 CLASS=null DLL= ns=- name=-
- ID=2178 CLASS=null DLL= ns=- name=-
- ID=1997 CLASS=null DLL= ns=- name=-
- ID=2006 CLASS=null DLL= ns=- name=-
- ID=1923 CLASS=null DLL= ns=- name=-
- ID=2267 CLASS=null DLL= ns=- name=-
- ID=2266 CLASS=null DLL= ns=- name=-
- ID=2080 CLASS=null DLL= ns=- name=-
- ID=1835 CLASS=null DLL= ns=- name=-
- ID=2039 CLASS=null DLL= ns=- name=-
- ID=2040 CLASS=null DLL= ns=- name=-
- ID=2072 CLASS=null DLL= ns=- name=-

### dll_unavailable
- ID=2086 CLASS=Teta.Sumo.Common.Designer.FrmDesignerableForms DLL= ns=- name=-
- ID=2598 CLASS=Teta.Sumo.Common.Designer.BusinessObjects.FrmBusinessObjects DLL= ns=- name=-
- ID=2645 CLASS=Teta.Sumo.Common.Designer.ActDesignerModeUsageReport DLL= ns=- name=-
- ID=2825 CLASS=Teta.Sumo.Common.Reports.TestReports.ActCleanReportDatabase DLL= ns=- name=-
- ID=3166 CLASS=Teta.Sumo.Common.PlugIns.CustomMultiMasterForm DLL= ns=- name=-
- ID=3172 CLASS=Teta.Sumo.Common.SMS.ActSMSSending DLL= ns=- name=-
- ID=3261 CLASS=Teta.WebConstellation.Personnel.plgRCP.EmployeeBalance.EmployeeBalanceDetailsView DLL= ns=- name=-
- ID=3262 CLASS=Teta.WebConstellation.Personnel.plgRCP.EmployeeEntryExitHistory.EmployeeEntryExitHistoryDetailsView DLL= ns=- name=-
- ID=3263 CLASS=Teta.WebConstellation.Personnel.plgRCP.TimeOffInLieuRequests.TimeOffInLieuRequestsDetailsView DLL= ns=- name=-
- ID=3264 CLASS=Teta.WebConstellation.Personnel.plgRCP.TimeOffInLieuRequestsList.TimeOffInLieuRequestsListListView DLL= ns=- name=-
- ID=3265 CLASS=Teta.WebConstellation.Personnel.plgRCP.OvertimeRequests.OvertimeRequestsDetailsView DLL= ns=- name=-
- ID=3266 CLASS=Teta.WebConstellation.Personnel.plgRCP.OvertimeRequestsList.OvertimeRequestsListListView DLL= ns=- name=-
- ID=3267 CLASS=Teta.WebConstellation.Personnel.plgRCP.LeaveRequests.LeaveRequestsDetailsView DLL= ns=- name=-
- ID=3268 CLASS=Teta.WebConstellation.Personnel.plgRCP.EmployeeBalance.EmployeeBalanceDetailsView DLL= ns=- name=-
- ID=3269 CLASS=Teta.WebConstellation.Personnel.plgRCP.LeaveRequestsList.LeaveRequestsListListView DLL= ns=- name=-
- ID=3270 CLASS=Teta.WebConstellation.Personnel.plgRCP.OvertimeRequestsList.OvertimeRequestsListListView DLL= ns=- name=-
- ID=3271 CLASS=Teta.WebConstellation.Personnel.plgRCP.TimeOffInLieuRequestsList.TimeOffInLieuRequestsListListView DLL= ns=- name=-
- ID=3272 CLASS=Teta.WebConstellation.Personnel.plgRCP.EmployeeEntryExitHistory.EmployeeEntryExitHistoryDetailsView DLL= ns=- name=-
- ID=3273 CLASS=Teta.WebConstellation.Personnel.plgRCP.PlanningModels.PlanningModelsDetailsView DLL= ns=- name=-
- ID=3274 CLASS=Teta.WebConstellation.Personnel.plgRCP.EmployeeWorkPreferences.EmployeeWorkPreferencesDetailsView DLL= ns=- name=-

### PluginAttribute
- Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen.ActUsuwanieWynikowObliczen args=["Workers.ico"]
- Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji args=["Dictionaries.ico"]
- Teta.Sumo.Personel.plgKOS.CrdStanowiskoWStrukturzeOrg.StanowiskoWStrukturzeOrgWidok args=["TreeForm.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.DicZrodlaOcen args=["Dictionaries.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.DicZadaniaStanowiska args=["Dictionaries.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.DicInformacjeDodatkowe args=["Dictionaries.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.DicWspolpraca args=["Dictionaries.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.DicWyposazenie args=["Dictionaries.ico"]
- Teta.Sumo.Logistics.plgKontrahenci.CrdOsobyKontaktowe.OsobyKontaktoweWidok args=["Contractors.ico"]
- Teta.Sumo.SOP.plgWyciagiBankowe.CrdWyciagiBankoweSzczegoly.WyciagiBankoweSzczegolyWidok args=["BankStatements.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.DicOkresyWypowiedzen args=["Dictionaries.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.DicRodzajeOdpraw args=["Dictionaries.ico"]
- Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok args=["DemandsRegister.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdTaxConstants.TaxConstantsView args=["Dictionaries.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdKartyPracy.KartyPracyWidok args=["DefineWorkCards.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdRodzajeNieobecnosci.RodzajeNieobecnosciWidok args=["AbsencesTypes.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.DicZawody args=["Dictionaries.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.DicOdpowiedzialnoscRzeczowa args=["Dictionaries.ico"]
- Teta.Sumo.Personel.plgPersonelSlowniki.CrdSkladnikiPlacowe.SkladnikiPlacoweWidok args=["DefinePayItems.ico"]
- Teta.Sumo.Personel.plgUrlopy.PrzeliczaniePodstaw.ActPrzeliczaniePodstaw args=["Workers.ico"]

### PluginGroupAttribute
- Teta.Sumo.Personel.plgKOS.CrdStanowiskoWStrukturzeOrg.StanowiskoWStrukturzeOrgWidok args=["UnitsStructure"]
- Teta.Sumo.Logistics.plgKontrahenci.CrdOsobyKontaktowe.OsobyKontaktoweWidok args=["Clients","EdycjaKontrahenta","Contacts"]
- Teta.Sumo.SOP.plgWyciagiBankowe.CrdWyciagiBankoweSzczegoly.WyciagiBankoweSzczegolyWidok args=["RozniceKursowe"]
- Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok args=["GeneracjaZZP","ZapotrzebowaniaZakupu"]
- Teta.Sumo.Personel.plgKOSP.CrdDanePodstawoweKOSP.DanePodstawoweKOSPWidok args=["KOSP","Attachments"]
- Teta.Sumo.Personel.plgKOSP.CrdInformacjeDodatkoweKOSP.InformacjeDodatkoweKOSPWidok args=["KOSP","Attachments"]
- Teta.Sumo.Personel.plgKOSP.CrdPowiazaniaKOSP.PowiazaniaKOSPWidok args=["KOSP","Attachments"]
- Teta.Sumo.Personel.plgKOSP.CrdProfilKOSP.ProfilKOSPWidok args=["KOSP","Attachments"]
- Teta.Sumo.Personel.plgPracownik.CrdPracownicy.PracownicyWidok args=["DodaniePracownikaUPOdswiez","ImportPracownikowDoSystemu","Positions","Workers","AddPersonalContract","KopiowanieDanychPracownika","WypEmployees","ZwolnieniePrac"]
- Teta.Sumo.Logistics.plgLogistykaSlowniki.CrdOdmianyZastosowanie.OdmianyZastosowanieWidok args=["OdmianyWMagazynach"]
- Teta.Sumo.Personel.plgUmowy.CrdUmowy.UmowyWidok args=["GrupaCzasuPracy","EmployeeContractAdding","Attachments","EmployeeContracts","WorkingTimeSystems","UsuwanieOstatnichObliczen","ObliczanieListyPlacOdswiez","ZamykanieListyPlacOdswiez","KorektaListyPlac","ZatwierdzanieListy"]
- Teta.Sumo.Personel.plgStanowiska.CrdStanowiska.StanowiskaWidok args=["CostCentre","Position","Attachments","EmployeePerformedDuties","Positions","ZusZswaDocument","AssignClassificationCategory"]
- Teta.Sumo.Personel.plgPersonelZUS.CrdDokumentyRozliczeniowePrac.DokumentyRozliczeniowePracWidok args=["Attachments"]
- Teta.Sumo.Logistics.plgZamowieniaZakupu.CrdKartotekaZamowienZakupu.KartotekaZamowienZakupuWidok args=["GeneracjaZZP","ZamowieniaZakupu"]
- Teta.Sumo.Logistics.plgPurchaseContracts.CrdKartotekaUmowZakupu.KartotekaUmowZakupuWidok args=["PurchaseContracts"]
- Teta.Sumo.SOP.plgPrzegladPlatnosci.CrdZarzadzaniePlatnosciami.ZarzadzaniePlatnosciamiWidok args=["WyslanieDoSOPOdswiez","CreatePayments","DeletePayments","BailiffsSeizures"]
- Teta.Sumo.Sales.plgZamowieniaSprzedazy.CrdKartotekaZamowienSprzedazy.KartotekaZamowienSprzedazyWidok args=["ZamowieniaSprzedazy"]
- Teta.Sumo.Sales.plgFakturySprzedazy.CrdKartorekaFakturSprzedazy.KartotekaFakturSprzedazyWidok args=["FakturySprzedazy","KorektySprzedazy","RachunkiFiskalne","KorektyRachunkowFiskalnych","KartotekaFakturSprzedazy"]
- Teta.Sumo.Logistics.plgZamowieniaZakupuPozycje.CrdPozycjeZamowieniaZakupu.PozycjeZamowieniaZakupuWidok args=["GeneracjaZZP","PozycjeZZ","ZamowieniaZakupu"]
- Teta.Sumo.Personel.plgDaneOsobowe.CrdDaneOsobowe.DaneOsoboweWidok args=["ImportPracownikowDoSystemu","Attachments"]

### Interesting members
- 827 field gtiObjectDescriptionView type=Teta.Sumo.Common.Controls.Grid.SumoDataGridCommandItem value=-
- 827 field tbbGoToSettlementsReview type=Teta.Sumo.Common.Controls.ToolBar.SumoToolBarButton value=-
- 791 field EMPLOYEES_TABLE_NAME type=String value=Prac
- 796 field dgcColorPreview type=Teta.Sumo.Common.Controls.Grid.SumoTextColumnStyle value=-
- 386 field tabContractsView type=Teta.Sumo.Common.Controls.Simple.SumoTabControl value=-
- 491 field gtiRemoveTransferFromPackage type=Teta.Sumo.Common.Controls.Grid.SumoDataGridCommandItem value=-
- 491 field mniGoToSettlementReview type=Teta.Sumo.Common.Controls.Menus.SumoToolbarToolStripMenuItem value=-
- 491 field gtiAmountVerificationPackage type=Teta.Sumo.Common.Controls.Grid.SumoDataGridCommandItem value=-
- 491 field gtiSendPackage type=Teta.Sumo.Common.Controls.Grid.SumoDataGridCommandItem value=-
- 1231 field PA_KSEF_DISPLAY_PDF_PREVIEW type=String value=PA_KSEF_DISPL
- 429 field dgcGrantableInstitutions type=Teta.Sumo.Common.Controls.Grid.SumoTextColumnStyle value=-
- 429 field dglGrantableInstitutions type=Teta.Sumo.Common.Controls.Grid.SumoDataGridLookup value=-
- 802 field m_TmpTablesService type=Teta.Sumo.Shared.cmnShared.ObslugaTabelTmp.IObslugaTabelTmp value=-
- 803 field m_TmpTablesService type=Teta.Sumo.Shared.cmnShared.ObslugaTabelTmp.IObslugaTabelTmp value=-
- 1217 field MAIN_TABLE_NAME type=String value=Zapyta
- 937 field dgcPerspektywa type=Teta.Sumo.Common.Controls.Grid.SumoTextColumnStyle value=-
- 940 field tbpTableTypes type=Teta.Sumo.Common.Controls.Simple.SumoTabPage value=-
- 963 property ViewData type=- value=-
- 1064 property ViewData type=- value=-
- 1109 property StatusyRozrachunkoweTable type=- value=-

### Interesting IL strings (candidates)
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_101"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_102"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_103"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_104"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_105"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_106"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_107"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_108"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_109"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_110"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_111"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_112"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_113"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_114"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_115"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_116"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_117"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_118"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_119"
- 1041 Teta.Sumo.Logistics.plgZapotrzebowaniaZakupu.CrdKartotekaZapotrzebowan.KartotekaZapotrzebowanWidok.AddElasticColumns: "T_120"

## Implementacja

- Błędne podejście v1: szukanie pełnego FQN jako jednego stringa w DLL
- Poprawne: TypeDef (`namespace` + `name`) przez System.Reflection.Metadata — bez wykonywania kodu
- Statusy rozdzielone: `registryStatus`, `dllStatus`, `classDeclarationStatus`, `classVerificationStatus`, `helpStatus`
- Domknięcie diagnostyczne: `type_not_found` / `class_name_missing` / `dll_unavailable` + `dllMissingReason`
- Help nie obniża statusu rejestru PA_WTYCZKI
- `confidence` jest deprecated (pole zbiorcze)

JSON (summary + przykłady): `docs/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json`
Pełny dump wszystkich wpisów (gitignored): `.local/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.full.json`
