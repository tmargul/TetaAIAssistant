# AIA PA_WTYCZKI registry — Etap 1

Wygenerowano: **2026-07-22T15:00:43.162Z** (read-only CLI `diagnose:pa-wtyczki`)

## Przed / po (TypeDef)

| Metryka | Przed (string FQN w DLL) | Po (TypeDef metadata) |
|---------|--------------------------|------------------------|
| Rekordy PA_WTYCZKI | 3561 | 3561 |
| registryStatus=confirmed | (brak / mylone z confidence) | **3561** |
| DLL resolved | 3035 | 3035 |
| Help found | 1773 | 1773 |
| classVerification verified_exact | **0** | **3030** |
| assembly_unreadable | — | 0 |
| Typy TypeDef (suma unikalnych DLL) | — | **11800** |
| PluginAttribute / PluginGroup na matched | — | 2928 / 970 |
| Interesting members / IL candidates | — | 533 / 3889 |

## Błędne wcześniejsze podejście

Szukanie pełnego FQN (`Namespace.Type`) jako **jednego** UTF-16/ASCII stringa w pliku DLL.
W metadanych .NET namespace i nazwa typu są w **osobnych** polach TypeDef — FQN zwykle nie występuje jako jeden ciąg.

Przykład: `Teta.Sumo.Personel.plgListaPlac.UsuwanieWynikowObliczen` + `ActUsuwanieWynikowObliczen`
→ po złożeniu dokładnie `…UsuwanieWynikowObliczen.ActUsuwanieWynikowObliczen` → `verified_exact`.

## Bezpieczny odczyt TypeDef

Narzędzie: `tools/TetaDllMetadataReader` (C# / **System.Reflection.Metadata** + PEReader).

- **Nie** ładuje assembly do wykonania (brak static ctor / `Assembly.Load` / reflection runtime).
- Czyta tabele CLI: TypeDef, Field, Property, CustomAttribute, ManifestResource, IL (`ldstr`).
- Opcjonalnie XML documentation obok DLL (`plgX.xml`).

## Statusy (rozdzielone)

| Pole | Znaczenie |
|------|-----------|
| `registryStatus=confirmed` | rekord z PA_WTYCZKI (kanoniczny) |
| `classDeclarationStatus=confirmed_by_registry` | NAZWA_KLASY zadeklarowana w PA |
| `dllStatus` | resolved / missing / conflicting |
| `classVerificationStatus` | wynik TypeDef (exact / normalized / …) |
| `helpStatus` | found / missing — **nie obniża** registryStatus |
| `confidence` | **deprecated** (stare pole zbiorcze) |

## Co jest twardym dowodem vs candidate

| Dane | Ranga |
|------|--------|
| PA_WTYCZKI (GUID, ASSEMBLY, NAZWA_KLASY) | **twardy rejestr** |
| TypeDef match (`verified_*`) | **twarda weryfikacja deklaracji typu w DLL** |
| Custom attributes Plugin / PluginGroup | **twardy fakt metadanych** |
| baseType / interfaces (nawet unresolved_ref) | fakt referencji |
| Help/{GUID}.html istnieje | fakt pliku |
| pola/właściwości o nazwach Perspektywa/PakietDAC/… | **candidate** do dalszych etapów |
| `ldstr` IL (NT_*, *_DAC, …) | **candidate evidence**, nie binding |
| XML documentation | wzbogacenie, jeśli plik istnieje |

## Odczyt atrybutów / dziedziczenia / members / resources / IL

- **Attributes:** wszystkie custom attributes typu; szczególnie Plugin / PluginGroup (constructor + named args).
- **Dziedziczenie:** bezpośredni `baseType` + `baseTypeResolution` (`resolved` \| `unresolved_ref`).
- **Members:** fields (z literalami), properties (get/set); flag `isInterestingName`.
- **Resources:** ManifestResource (`.resources`, `.ico`, nazwy Widok/Form).
- **IL:** `ldstr` z metod dopasowanego typu (limit 200/typ); `isInteresting` dla wzorców Oracle/DataSet/…

Nie rozpoczęto: parsowanie treści Help, binding kontrolka→Oracle, SqlJoin, SQL, Qdrant.

---

| Pole | Wartość |
|------|---------|
| clientDirectory | `A:\TETA Aplikacja klienta - 33.5` |
| clientDirectory istnieje | **true** |
| pluginsRoot | `A:\TETA Aplikacja klienta - 33.5\Plugins` |
| plugins.xml wymagany | **nie** |
| Źródło kanoniczne | Oracle `PA_WTYCZKI` |
| Metadata reader | `tools/TetaDllMetadataReader` (System.Reflection.Metadata, bez wykonywania kodu) |
| Oracle / odczyt | OK |

## Podsumowanie (po TypeDef)

| Metryka | Wartość |
|---------|---------|
| Rekordy PA_WTYCZKI / registryStatus=confirmed | **3561** / **3561** |
| DLL resolved / missing / conflicting | **3035** / 526 / 0 |
| classDeclarationStatus=confirmed_by_registry | **3433** |
| verified_exact | **3030** |
| verified_normalized | **0** |
| verified_case_insensitive | **0** |
| matched_unique_simple_name | 1 |
| ambiguous_simple_name | 0 |
| not_found | 132 |
| assembly_unreadable | 0 |
| not_checked | 398 |
| Help found / missing | **1773** / 1788 |
| Typy TypeDef łącznie (unikalne DLL) | **11800** (avg ~37.3/DLL) |
| Matched z PluginAttribute / PluginGroup | 2928 / 970 |
| Matched z baseType / XML doc | 3031 / 0 |
| Interesting members / IL strings | 533 / 3889 |
| Zeskanowane DLL w Plugins | 425 |
| confidence(deprecated)=confirmed | 1767 |

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
- ID=2489 CLASS=Teta.Sumo.Logistics.plgKontrahenciSprzedaz.CrdHistoriaPrzedstawicieli.HistoriaPrzedstawicieliWidok DLL=plgKontrahenciSprzedazKln.dll ns=Teta.Sumo.Logistics.plgKontrahenciSprzedazKln.CrdHistoriaPrzedstawicieli name=HistoriaPrzedstawicieliWidok

### ambiguous_simple_name
_brak_

### not_found
- ID=798 CLASS=null DLL= ns=- name=-
- ID=1773 CLASS=null DLL= ns=- name=-
- ID=1832 CLASS=null DLL= ns=- name=-
- ID=1836 CLASS=null DLL= ns=- name=-
- ID=1656 CLASS=Teta.Sumo.Sales.plgSalesReports.Lists.PrmZestawienieVATOperacjiSprzedaży DLL=plgSalesReports.dll ns=- name=-
- ID=2010 CLASS=null DLL= ns=- name=-
- ID=2011 CLASS=null DLL= ns=- name=-
- ID=2067 CLASS=null DLL= ns=- name=-
- ID=2073 CLASS=null DLL= ns=- name=-
- ID=2176 CLASS=null DLL= ns=- name=-
- ID=2178 CLASS=null DLL= ns=- name=-
- ID=1997 CLASS=null DLL= ns=- name=-
- ID=2001 CLASS=Teta.Sumo.Logistics.plgLogistykaParametryRap.Zestawienia.PrmZestawienieMarzySprzedazy DLL=plgLogistykaParametryRap.dll ns=- name=-
- ID=2006 CLASS=null DLL= ns=- name=-
- ID=1923 CLASS=null DLL= ns=- name=-
- ID=2267 CLASS=null DLL= ns=- name=-
- ID=2266 CLASS=null DLL= ns=- name=-
- ID=2080 CLASS=null DLL= ns=- name=-
- ID=1835 CLASS=null DLL= ns=- name=-
- ID=2039 CLASS=null DLL= ns=- name=-

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
- Help nie obniża statusu rejestru PA_WTYCZKI
- `confidence` jest deprecated (pole zbiorcze)

JSON (summary + przykłady): `docs/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.json`  
Pełny dump (gitignored, ~160 MB): `.local/AIA_PA_WTYCZKI_REGISTRY_IMPLEMENTATION.full.json`
