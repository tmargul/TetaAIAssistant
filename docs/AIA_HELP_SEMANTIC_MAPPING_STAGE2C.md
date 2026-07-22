# AIA Help semantic mapping — Stage 2C

Wygenerowano: **2026-07-22T21:35:11.373Z**

## Zakres

- Etapy 1, 2A, 2B **bez zmian**.
- Źródło Help: `{clientDirectory}/Help/{GUID}.html` (GUID wyłącznie z PA_WTYCZKI).
- Help jest opcjonalny — brak pliku **nie obniża** registry / class / binding / Oracle confidence.
- Parser strukturalny HTML + deterministyczne dopasowanie etykiet (bez LLM).
- Po matchu: dołączane fakty 2A/2B (target vs lookup zachowane).
- **Bez** SqlJoin, generatora SQL, Qdrant, zmian agenta czatu.

Client: `A:\TETA Aplikacja klienta - 33.5`

## Audyt

| Metryka | Wartość |
|---------|---------|
| registry entries checked | **3561** |
| help files found | **1773** |
| help missing | **1788** |
| help unreadable | 0 |
| encoding failures | 0 |
| parsed documents | **1773** |
| sections | 3856 |
| extracted field entries | **18329** |
| action entries | **1516** |
| field entries matched to controls | **8900** |
| confirmed matches | **6652** |
| probable matches | **2248** |
| ambiguous | 1692 |
| unmatched Help fields | 9253 |
| controls without Help | 66148 |
| Help mappings with Oracle chain | **5441** |
| lookup fields correctly split | **144** |
| duplicate Help documents | 8 |
| parse warnings | 218 |

## Przykłady pełnego łańcucha Help→control→Oracle (20)

- [matched_by_caption] Kod → dgcKod → RodzajeKoncesji.KOD lookup=- oracle=NT_LG_SLO_RODZAJE_KONCESJI,NT_LG_SLO_RODZAJE_KONCESJI_DAC kind=fieldHelp
- [matched_by_caption] Nazwa → dgcNazwa → RodzajeKoncesji.NAZWA lookup=- oracle=NT_LG_SLO_RODZAJE_KONCESJI,NT_LG_SLO_RODZAJE_KONCESJI_DAC kind=fieldHelp
- [matched_by_control_name] Aktualna → dgcAktualna → RodzajeKoncesji.UP_TO_DATE lookup=- oracle=NT_LG_SLO_RODZAJE_KONCESJI,NT_LG_SLO_RODZAJE_KONCESJI_DAC kind=fieldHelp
- [matched_by_control_name] Stanowisko → ltxtStanowisko → KartaOpisuStanowiska.SSTN_NAZWA lookup=- oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [probable_same_container] Jednostka organizacyjna → ltxtJednostka → KartaOpisuStanowiska.JEOR_NAZWA lookup=- oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [matched_by_control_name] Firma → ltxtFirma → KartaOpisuStanowiska.FIRM_NAZWA lookup=- oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [matched_by_control_name] Typ stanowiska → lcboTypStanowiska → KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk:ID/NAZWA oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [matched_by_control_name] Kierownicze → chkKierownicze → KartaOpisuStanowiska.LIDER lookup=- oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [matched_by_control_name] Akademickie → chkAkademickie → KartaOpisuStanowiska.STANOWISKO_AKADEMICKIE lookup=- oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [probable_same_container] Rodzina → lcboRodzinaStanowiska → KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk:ID/NAZWA oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [matched_by_control_name] Data od → ldtpDataOd → JednostkiOrganizacyjne.DATA_OD lookup=- oracle=NT_PA_SLO_JEDNOSTKI_ORG,NT_PA_SLO_JEDNOSTKI_ORG_DAC,Teta.Sumo.Personel.bosSOrganizacja.MTG.JednostkiOrganizacyjneMTG kind=fieldHelp
- [matched_by_control_name] Data do → ldtpDataDo → JednostkiOrganizacyjne.DATA_DO lookup=- oracle=NT_PA_SLO_JEDNOSTKI_ORG,NT_PA_SLO_JEDNOSTKI_ORG_DAC,Teta.Sumo.Personel.bosSOrganizacja.MTG.JednostkiOrganizacyjneMTG kind=fieldHelp
- [matched_by_control_name] Kod MPK → ltxtKodMPK → JednostkiOrganizacyjne.KOD_MPK lookup=- oracle=NT_PA_SLO_JEDNOSTKI_ORG,NT_PA_SLO_JEDNOSTKI_ORG_DAC,Teta.Sumo.Personel.bosSOrganizacja.MTG.JednostkiOrganizacyjneMTG kind=fieldHelp
- [matched_by_control_name] Nazwa MPK → ltxtNazwaMPK → JednostkiOrganizacyjne.NAZWA_MPK lookup=- oracle=NT_PA_SLO_JEDNOSTKI_ORG,NT_PA_SLO_JEDNOSTKI_ORG_DAC,Teta.Sumo.Personel.bosSOrganizacja.MTG.JednostkiOrganizacyjneMTG kind=fieldHelp
- [matched_by_caption] Kod → dgcKod → ZrodlaOcen.KOD lookup=- oracle=NT_KP_SLO_ZRODLA_OCEN,NT_KP_SLO_ZRODLA_OCEN_DAC kind=fieldHelp
- [matched_by_caption] Nazwa → dgcNazwa → ZrodlaOcen.NAZWA lookup=- oracle=NT_KP_SLO_ZRODLA_OCEN,NT_KP_SLO_ZRODLA_OCEN_DAC kind=fieldHelp
- [matched_by_caption] Typ → dgcTyp → ZrodlaOcen.TYP lookup=- oracle=NT_KP_SLO_ZRODLA_OCEN,NT_KP_SLO_ZRODLA_OCEN_DAC kind=fieldHelp
- [matched_by_caption] Końcowa → dgcKoncowa → ZrodlaOcen.KONCOWA lookup=- oracle=NT_KP_SLO_ZRODLA_OCEN,NT_KP_SLO_ZRODLA_OCEN_DAC kind=fieldHelp
- [matched_by_caption] Nazwa → dgcNazwa → ZadaniaStanowiska.NAZWA lookup=- oracle=NT_KP_SLO_ZADANIA_STAN,NT_KP_SLO_ZADANIA_STAN_DAC kind=fieldHelp
- [matched_by_caption] Nazwa → dgcNazwa → InformacjeDodatkowe.NAZWA lookup=- oracle=NT_KP_SLO_INFO_DODATKOWE,NT_KP_SLO_INFO_DODATKOWE_DAC kind=fieldHelp

## Przykłady pól lookup (20)

- [matched_by_control_name] Typ stanowiska → lcboTypStanowiska → KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk:ID/NAZWA oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [probable_same_container] Rodzina → lcboRodzinaStanowiska → KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk:ID/NAZWA oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [matched_by_control_name] Typ zleceniobiorcy → lcboTypZleceniobiorcy → Pracownik.TYP_ZLECENIOBIORCY lookup=TypyZleceniobiorcy:WARTOSC_OD/ZNACZENIE oracle=NT_PA_SLO_FIRMY,Teta.Sumo.Personel.bosSPracownikBase.MTG.PracownikBaseMTG kind=fieldHelp
- [matched_by_control_name] Płeć → lcboPlec → Pracownik.PLEC lookup=Plec:WARTOSC_ZWRACANA/WARTOSC_WYSWIETLANA oracle=NT_PA_SLO_FIRMY,Teta.Sumo.Personel.bosSPracownikBase.MTG.PracownikBaseMTG kind=actionHelp
- [matched_by_control_name] Stan cywilny → lcboStanCywilny → Pracownik.SSTC_ID lookup=StanCywilny:ID/NAZWA oracle=NT_PA_SLO_FIRMY,Teta.Sumo.Personel.bosSPracownikBase.MTG.PracownikBaseMTG kind=fieldHelp
- [matched_by_control_name] Kod zatrudnienia (GUS) → lcboKodZatrudnienia → Pracownik.KOD_ZATRUDNIENIA lookup=KodyZatrudnienia:ID/NAZWA oracle=NT_PA_SLO_FIRMY,Teta.Sumo.Personel.bosSPracownikBase.MTG.PracownikBaseMTG kind=fieldHelp
- [probable_same_container] Język obcy → lcboJezyk → RaportParametry.JEZY_ID lookup=Jezyki:ID/JEZYK oracle=- kind=fieldHelp
- [probable_same_container] Język obcy → lcboJezyk → RaportParametry.JEZY_ID lookup=Jezyki:ID/JEZYK oracle=- kind=fieldHelp
- [matched_by_control_name] Typ → lcboTyp → Kalendarze.TYP lookup=TypyKalendarza:WARTOSC_OD/ZNACZENIE oracle=NT_PR_SLO_KALENDARZE,NT_PR_SLO_KALENDARZE_DAC,Teta.Sumo.Production.bosProdukcjaSlowniki.MTG.KalendarzeMTG kind=fieldHelp
- [probable_same_container] Dopełnienie → lcboDopelnianie → PolaFunkcji.DOPELNIENIE lookup=DopelnieniePola:WARTOSC_OD/WARTOSC_DO oracle=NT_PA_SOP_POLA_FUNK_BANK,NT_PA_SOP_POLA_FUNK_BANK_DAC,Teta.Sumo.SOP.bosFunkcjeBankowe.TG.PolaFunkcjiTG kind=fieldHelp
- [probable_same_container] Czas przepracowany ogółem wg → lcboCzasPrzepracowany → Parametry.CzasWg lookup=CzasPrzepracowanyEwcp:WARTOSC_OD/ZNACZENIE oracle=- kind=fieldHelp
- [matched_by_control_name] Typ dokumentu FK → lcboTypDokFk → TypyDokumentow.TYP_DOKUMENTU_FK lookup=TypDokumentuFk:-/WARTOSC_OD oracle=NT_RK_SLO_TYPY_DOKUMENTOW,Teta.Sumo.Finances.bosFinanseSlowniki.TG.TypyDokumentowTG kind=fieldHelp
- [matched_by_control_name] Organ wydający emeryturę → lcboOrganWydajacyEmeryture → Pracownik.ORWE_ID lookup=OrganWydajacyEmeryture:ID/NAZWA oracle=NT_PA_SLO_FIRMY,Teta.Sumo.Personel.bosSPracownikBase.MTG.PracownikBaseMTG kind=fieldHelp
- [probable_same_container] Rodzina → lcboRodzinaStanowiska → KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk:ID/NAZWA oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [matched_by_control_name] Typ stanowiska → lcboTypStanowiska → KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk:ID/NAZWA oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [probable_same_container] Rodzina → lcboRodzinaStanowiska → KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk:ID/NAZWA oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [matched_by_control_name] Typ stanowiska → lcboTypStanowiska → KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk:ID/NAZWA oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [probable_same_container] Typ → lcboTypStanowiska → KartaOpisuStanowiska.ZSTP_ID lookup=TypyStanowisk:ID/NAZWA oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [probable_same_container] Rodzina → lcboRodzinaStanowiska → KartaOpisuStanowiska.RODS_ID lookup=RodzinyStanowisk:ID/NAZWA oracle=NT_KP_KOS_KARTA_OPISU_STAN,NT_KP_KOS_KARTA_OPISU_STAN_DAC,Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG kind=fieldHelp
- [matched_by_control_name] Waluta → lcboWaluta → Zmienne.WALUTA lookup=WalutyJednostki:ID/KOD oracle= kind=fieldHelp

## Przykłady akcji/buttons (20)

- [matched_by_control_name] Zamknięcie miesiąca → tbbZamknijMiesiac → - lookup=- oracle=- kind=actionHelp
- [matched_by_control_name] Zamkniętych miesięcy → tbbZamknijMiesiac → - lookup=- oracle=- kind=actionHelp
- [matched_by_control_name] Zamknięte miesiące → tbbZamknijMiesiac → - lookup=- oracle=- kind=actionHelp
- [unmatched] Liczba pracowników objętych operacją → ∅ → - lookup=- oracle=- kind=actionHelp
- [unmatched] Usuń listy zadekretowane → ∅ → - lookup=- oracle=- kind=actionHelp
- [unmatched] Usuń listy zadekretowane – → ∅ → - lookup=- oracle=- kind=actionHelp
- [unmatched] Usuń → ∅ → - lookup=- oracle=- kind=actionHelp
- [matched_by_control_name] Szablon operacji → tbbSzablonOperacji → - lookup=- oracle=- kind=actionHelp
- [matched_by_caption] Zatwierdzony → dgcWbwoZatwierdzony → WyciagiOperacje.ZATWIERDZONY lookup=- oracle=NT_PA_WB_WBWO,NT_PA_WB_WBWO_DAC,Teta.Sumo.SOP.bosWyciagiBankowe.TG.WyciagiOperacjeTG kind=actionHelp
- [matched_by_control_name] Zatwierdzona → tbbZatwierdz → - lookup=- oracle=- kind=actionHelp
- [ambiguous] Przejdź do następnej operacji WB → ∅ → - lookup=- oracle=- kind=actionHelp
- [ambiguous] Zatwierdź uzgodnioną → ∅ → - lookup=- oracle=- kind=actionHelp
- [unmatched] Anuluj filtr korekt → ∅ → - lookup=- oracle=- kind=actionHelp
- [unmatched] Edytuj dokument księgowy → ∅ → - lookup=- oracle=- kind=actionHelp
- [unmatched] Importuj wyciąg bankowy → ∅ → - lookup=- oracle=- kind=actionHelp
- [matched_by_control_name] Zatwierdzone → dgcZatwierdzone → Zapotrzebowania.ZATWIERDZONY lookup=- oracle=NT_LG_DZK_DOKUMENTY_ZAK_PDMN,Teta.Sumo.Logistics.bosZapotrzebowaniaZakupu.MTG.ZapotrzebowaniaZakupuMTG kind=actionHelp
- [matched_by_caption] Zatwierdził → dgcZatwierdzil → Zapotrzebowania.KTO_ZATWIERDZIL lookup=- oracle=NT_LG_DZK_DOKUMENTY_ZAK_PDMN,Teta.Sumo.Logistics.bosZapotrzebowaniaZakupu.MTG.ZapotrzebowaniaZakupuMTG kind=actionHelp
- [unmatched] Cofnij anulowanie realizacji wszystkich niezrealizowanych pozycji na wybranych dokumentach → ∅ → - lookup=- oracle=- kind=actionHelp
- [unmatched] Obliczanie karty pracy dla wybranych pracowników → ∅ → - lookup=- oracle=- kind=actionHelp
- [unmatched] Oblicz → ∅ → - lookup=- oracle=- kind=actionHelp

## Ambiguous (20)

- [ambiguous] Tytuł → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Wartość → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Numer listy płac → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Nazwa właściciela → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Rodzaj kursu → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Status dekretacji → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Data KG → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Odsetki → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Przejdź do następnej operacji WB → ∅ → - lookup=- oracle=- kind=actionHelp
- [ambiguous] Zatwierdź uzgodnioną → ∅ → - lookup=- oracle=- kind=actionHelp
- [ambiguous] Nazwa → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Zwiększone koszty uzyskania → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Kod → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Tytuł → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Tytuł → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Kod → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Nazwa → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Nazwa stażu-stanowisko → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Nazwa stażu-firma, Kod stażu-firma → ∅ → - lookup=- oracle=- kind=fieldHelp
- [ambiguous] Nazwa stażu-ogółem, Kod stażu-ogółem → ∅ → - lookup=- oracle=- kind=fieldHelp

## Unmatched Help fields (20)

- [unmatched] Stanowisko → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Karta pracy → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Rachunek UC → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Sędzia → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Prokurator → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Załączniki → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Pokazuj w HRM → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Firma → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Pracownicy → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Liczba pracowników objętych operacją → ∅ → - lookup=- oracle=- kind=actionHelp
- [unmatched] Usuń listy zadekretowane → ∅ → - lookup=- oracle=- kind=actionHelp
- [unmatched] Usuń listy zadekretowane – → ∅ → - lookup=- oracle=- kind=actionHelp
- [unmatched] Usuń → ∅ → - lookup=- oracle=- kind=actionHelp
- [unmatched] Aktualna → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Aktualna → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Rola → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Stanowisko → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Dział → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] E-mail → ∅ → - lookup=- oracle=- kind=fieldHelp
- [unmatched] Telefon → ∅ → - lookup=- oracle=- kind=fieldHelp

## Missing Help (20)

- 02e54042-6570-421e-9212-af1ee889f7e3 Teta.Sumo.Personel.plgPersonelParametryRap.Pity.PrmPit40
- f8e02923-0f7d-4e19-b858-f4c94384f97d Teta.Sumo.Personel.plgKredyty.ZmianaStopyProcentowej.ActZmianaStopyProcentowej
- 815114ef-f75a-48ff-9327-5ce26eb8a0f0 Teta.Sumo.Personel.plgPersonelParametryRap.Pity.PrmPit8b
- 7f20d697-43b7-4ff5-b277-ab7732c8f5ac Teta.Sumo.Finances.plgFinanseParametryRap.ZestawieniaObrotow.PrmZestawieniaObrotow
- 1b2f7f81-68c6-4773-a617-439e59ff93de Teta.Sumo.Finances.plgKartotekaKont.DodanieKonta.ActDodanieKonta
- 4bdc5979-2035-4f21-9228-13aacd048a2b Teta.Sumo.FixedAssets.plgMajatekParametryRap.InwentaryzacjaUproszczona.PrmInwentaryzacjaUproszczona
- ec62a9ea-975e-4a03-945a-dc7d9e573716 Teta.Sumo.FixedAssets.plgMajatekParametryRap.Inwentaryzacja.PrmSpisZNatury
- 86ce4a7a-19c9-4df0-b8d4-db449201eaf6 Teta.Sumo.FixedAssets.plgMajatekParametryRap.KodyKreskowe.PrmKodyKreskoweCzesciSkladowe
- ffa1d1e7-58ed-d8df-e030-2f64070a60af Teta.Sumo.Personel.plgPersonelParametryRap.DokumentyZus.PrmKartaZasilkowa
- 96589786-3b8b-436b-99e0-44e48bc8c225 Teta.Sumo.Production.plgProdukcjaParametryRap.DmnIndex.PrmIndex
- c1fff154-e22c-4ec1-881e-596d7f193145 Teta.Sumo.Production.plgProdukcjaParametryRap.Index.PrmIndexOperationCard
- 313be962-085d-47cb-98f2-7600e0a97ec8 Teta.Sumo.Production.plgProdukcjaParametryRap.Index.PrmIndexComponents
- 2ea03c9b-677c-4c67-a16d-ddf1f2a8cb4b Teta.Sumo.Personel.plgRCP.ObliczanieKart.ActObliczanieKart
- fd590e0d-96cb-63e3-e030-2f64070a4448 Teta.Sumo.Personel.plgOrganizacja.DicTypyJednostek
- dc8d88ac-846f-48f8-9c1c-82b7ed977829 Teta.Sumo.Personel.plgPersonelParametryRap.DokumentyZus.PrmZastepczaAsygnataZasilkowa
- f62a84fc-e89f-4cb6-b719-59e49404a29c Teta.Sumo.FixedAssets.plgMajatekParametryRap.Dokumenty.PrmDokument
- 9be7c7be-91e1-4337-b9b0-2599be9dadfe Teta.Sumo.Finances.plgFinanseParametryRap.RaportyKasowe.PrmDokumentyKasowe
- 3683a5b6-7f60-4fa9-be36-4b3fb08b805f Teta.Sumo.Finances.plgFinanseParametryRap.RaportyKasowe.PrmDokumentyKasowe
- 8aa37b41-605e-415a-b410-97a519501e05 Teta.Sumo.Personel.plgPersonelSlowniki.DicKodyZatrudnienia
- eb73ecf9-b897-4d94-a2ff-9e7dba523f51 Teta.Sumo.Personel.plgBHP.BadaniePotrzeb.ActBadaniePotrzeb

## Encoding problems (20)

_brak_

## Duplikaty Help

- same_content_multiple_guids: guids=255a4780-3639-4c5f-b0eb-e2f776154349,e7ce7432-4302-40bd-92e8-30452ab4342c — Identical Help content hash across GUIDs (not auto-merged)
- same_content_multiple_guids: guids=eefbb127-a395-4053-b417-01d885a85a34,5d6f07c9-d167-4c0e-ab2b-99171abab0ec,063509fa-08a3-4925-937b-a3d9d3a64cde,0ed63b05-3aa4-4b0c-8b49-144b68b61120,11ce7e6b-a6ca-46ba-93d2-cc249174a3b3,f988ca3e-7543-4bc8-a65a-19ea6bc08acf — Identical Help content hash across GUIDs (not auto-merged)
- same_content_multiple_guids: guids=131f7cbb-2acc-4449-a947-0e9e3f801db5,fcec93c2-9ca2-4271-a316-af21674b879e,0d60c05f-0d0e-44b8-bc7b-fbf8bd518815,a3a21e4d-88bc-4554-b786-26cb5c176e2a,27e8a8a9-3d10-4623-9a5d-f73db6888ff5,54c4ad8d-4f35-4560-906e-9e93a10cdc26,3a3baf46-f59a-4e83-8cdd-31e92f71fb00,f371d2b6-66be-4990-b7de-0643482cf07f,fef746dd-90d0-47d5-be70-376380954a38,fafc006c-db60-43d8-bac4-966372929918,3bdad641-1a19-425b-a793-a6028ce39d5c,d025d67c-f2e5-45aa-9bfe-7e0106eec762,7c8ed738-3cbf-4f24-8717-49fcd4eadbba,e638b6ed-9b1d-4639-bab8-609ddfd69e2a,d3c1f5e5-1ad5-4da4-bacf-fe2f8743ef28,36e4e411-3f5a-409f-bc29-af56d283c8f9,890fda0d-dc12-4260-a3b9-9575048aaed2,cc68160b-bf83-4124-9859-45f59b2a300a,dc85b53f-c316-44b6-86a8-2ff9e9197afb,79289afe-126e-4d58-9b94-164f5e063d76,0b7b3240-4480-45a3-8c5c-e93c50b4ea5f,8748ff37-5a81-4af8-80f1-ae2bb261b0f2,194e3385-5ed7-41b8-97ec-3880a9f0775d,34021c89-c75b-4596-bb3b-07f95c4d308e,0f215fa5-01e8-4587-8108-8e1b2ce08a3a,60649a65-78b8-43de-9370-464143cea978,22c07415-e3bc-4d50-b159-bb5bde3681d5,a454980c-75f4-453f-a2af-86298084b02d,4a1e461a-9f11-4186-a09e-06fff027dbc0,3485a47d-5a9d-4e15-9834-61d841222598,dd7d1ba4-d7fc-4a85-a610-7dad0cc9efca,6cf5bc1f-1a3c-4193-9ec4-d672546fd690,a524baf9-4289-46ab-bcc0-0aa1e99bc998,6e479f68-78cf-4e21-a649-c506cabb1bdf,b50ee1fb-fe43-4ffb-8959-62438f4eb359,30b47130-072b-41cf-9e47-0b76425db6f5,05f07201-0c7f-4825-be08-35c4597822fa,b379a4d6-b0f9-4a71-a6bc-c9082493cc08,4ff9cdd9-6479-4df9-93e1-edfbfdca362a,626313f1-94b0-4f0a-9df3-20a36ef9221c,3cfd1337-a0d6-40fe-90f7-92ad827b2402,554371c5-2259-44f0-8dcb-0a3f4c5dba32 — Identical Help content hash across GUIDs (not auto-merged)
- same_content_multiple_guids: guids=cfcbfef6-4f77-4edc-9fe2-0ff44283dad9,4d55f9fc-2b4d-46db-9762-19abf0baff40 — Identical Help content hash across GUIDs (not auto-merged)
- same_content_multiple_guids: guids=8efe6f9e-d77f-4546-b0be-87afaf7c80fe,785a4fd4-a61c-404c-86b2-6c3cff903dd3 — Identical Help content hash across GUIDs (not auto-merged)
- same_content_multiple_guids: guids=189e4fd4-e821-48a3-88ec-d1a97c2ba4be,9d2f1612-c9cc-4603-8f6d-a7b3c9875c38 — Identical Help content hash across GUIDs (not auto-merged)
- same_content_multiple_guids: guids=fbd0a3b9-b566-4953-abb8-767571e1f92c,e018b69f-2460-44f3-9cb4-fe0bcaf68ea3 — Identical Help content hash across GUIDs (not auto-merged)
- same_content_multiple_guids: guids=d3fdff40-da99-42bb-a741-45d037458839,d3751d12-1a5e-4efc-bfc3-e5f3a30036c3,867a1ea8-732f-40a7-9056-b81f2b1fb427,23e31e71-d50d-4d1e-b6aa-761dc8d70df5,3c6465a0-e61e-4753-aa79-a4c1b2f4b402 — Identical Help content hash across GUIDs (not auto-merged)

## Referencje

### A. lcboTypStanowiska / Typ stanowiska

```json
{
  "formType": "Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok",
  "guid": "8efdd60e-ac8b-4501-947a-4cb89ccdb082",
  "helpStatus": "help_found",
  "helpField": {
    "label": "Typ stanowiska",
    "control": "lcboTypStanowiska",
    "targetBinding": {
      "datasetTable": "KartaOpisuStanowiska",
      "dataMember": "ZSTP_ID"
    },
    "lookupBinding": {
      "datasetTable": "TypyStanowisk",
      "valueMember": "ID",
      "displayMember": "NAZWA"
    },
    "oracleMapping": {
      "targetObjects": [
        "NT_KP_KOS_KARTA_OPISU_STAN",
        "NT_KP_KOS_KARTA_OPISU_STAN_DAC",
        "Teta.Sumo.Personel.bosSKOS.MTG.KartaOpisuStanowiskaNaglowekMTG"
      ],
      "lookupObjects": [
        "NT_KP_SLO_TYPY_STANOWISK",
        "NT_KP_SLO_TYPY_STANOWISK_DAC"
      ]
    },
    "matchStatus": "matched_by_control_name"
  },
  "stage2bLookup": {
    "kind": "lookupSplit",
    "control": "lcboTypStanowiska",
    "formType": "Teta.Sumo.Personel.plgKOS.CrdDanePodstawoweKOS.DanePodstawoweKOSWidok",
    "targetBinding": {
      "datasetTable": "KartaOpisuStanowiska",
      "dataMember": "ZSTP_ID"
    },
    "lookupBinding": {
      "datasetTable": "TypyStanowisk",
      "valueMember": "ID",
      "displayMember": "NAZWA",
      "lookupClass": null,
      "pluginAssembly": null
    },
    "confidence": "confirmed_from_il",
    "evidence": [
      "lcboTypStanowiska.Column = new Teta.Sumo.Common.LateBinding.DesignModeColumn(...)",
      "lcboTypStanowiska.Table = new Teta.Sumo.Common.LateBinding.DesignModeTable(...)",
      "lcboTypStanowiska.DictionaryColumnForDisplay = new Teta.Sumo.Common.LateBinding.DesignModeColumn(...)",
      "lcboTypStanowiska.DictionaryColumnID = new Teta.Sumo.Common.LateBinding.DesignModeColumn(...)",
      "lcboTypStanowiska.DictionaryTable = new Teta.Sumo.Common.LateBinding.DesignModeTable(...)",
      "alternatives=ZSTP_ID,NAZWA,KartaOpisuStanowiska,TypyStanowisk,ID"
    ]
  }
}
```

### B. DicRodzajeKoncesji

```json
{
  "formType": "Teta.Sumo.Sales.plgSalesDictionaries.DicRodzajeKoncesji",
  "guid": "670ab806-2885-4f00-94cf-e86a5f545c85",
  "helpStatus": "help_found",
  "overview": "W słowniku Logistyka | Sprzedaż | Rodzaje koncesji definiujemy \r\n rodzaje koncesji wykorzystywane w systemie. Definicja składa się z kodu \r\n i nazwy koncesji oraz oznaczenia, czy jest ona obecnie wykorzystywana. Z \r\n tego słownika korzysta ",
  "fields": [
    {
      "helpLabel": "Kod",
      "control": "dgcKod",
      "targetBinding": {
        "datasetTable": "RodzajeKoncesji",
        "dataMember": "KOD"
      },
      "matchStatus": "matched_by_caption"
    },
    {
      "helpLabel": "Nazwa",
      "control": "dgcNazwa",
      "targetBinding": {
        "datasetTable": "RodzajeKoncesji",
        "dataMember": "NAZWA"
      },
      "matchStatus": "matched_by_caption"
    },
    {
      "helpLabel": "Aktualna",
      "control": "dgcAktualna",
      "targetBinding": {
        "datasetTable": "RodzajeKoncesji",
        "dataMember": "UP_TO_DATE"
      },
      "matchStatus": "matched_by_control_name"
    }
  ],
  "oracleChains": []
}
```

### C. ListyZamknieteWidok / Zamknij miesiąc

```json
{
  "formType": "Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok",
  "guid": "7b4f2b80-4853-409d-8dc7-06cd10c8925b",
  "helpStatus": "help_found",
  "zamknijMiesiac": {
    "helpLabel": "Zamknięcie miesiąca",
    "control": "tbbZamknijMiesiac",
    "parameterName": "KP_UPR_KART_LIST_ZAMKNIJ_MIES",
    "targetBinding": null,
    "helpKind": "actionHelp",
    "matchStatus": "matched_by_control_name"
  },
  "dataFieldsSample": [
    {
      "guid": "7b4f2b80-4853-409d-8dc7-06cd10c8925b",
      "formType": "Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok",
      "helpLabel": "Kod",
      "helpDescription": "kod składnika płacowego.",
      "helpKind": "fieldHelp",
      "section": "Zakładka Składniki listy",
      "control": "dgcSklpKod",
      "controlKind": "grid_column",
      "matchStatus": "probable_same_container",
      "score": 0.55,
      "targetBinding": {
        "datasetTable": "SkladnikiObliczZamknPrac",
        "dataMember": "SKLP_KOD"
      },
      "lookupBinding": null,
      "parameterName": null,
      "oracleMapping": null,
      "evidence": [
        "pattern=bold_dash_inside",
        "section=Zakładka Składniki listy",
        "weak_name_token_overlap=0.50",
        "extraction=bold_dash_inside",
        "confidence=confirmed_structural"
      ]
    },
    {
      "guid": "7b4f2b80-4853-409d-8dc7-06cd10c8925b",
      "formType": "Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok",
      "helpLabel": "Typ",
      "helpDescription": "typ składnika płacowego.",
      "helpKind": "fieldHelp",
      "section": "Zakładka Składniki listy",
      "control": "dgcTypListy",
      "controlKind": "grid_column",
      "matchStatus": "probable_same_container",
      "score": 0.55,
      "targetBinding": {
        "datasetTable": "SkladnikiObliczZamknPrac",
        "dataMember": "TYP_LISTY"
      },
      "lookupBinding": null,
      "parameterName": null,
      "oracleMapping": null,
      "evidence": [
        "pattern=bold_dash_inside",
        "section=Zakładka Składniki listy",
        "weak_name_token_overlap=0.50",
        "extraction=bold_dash_inside",
        "confidence=confirmed_structural"
      ]
    },
    {
      "guid": "7b4f2b80-4853-409d-8dc7-06cd10c8925b",
      "formType": "Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok",
      "helpLabel": "Wartość waluty",
      "helpDescription": "wartość \r\n składnika w walucie, jeżeli został wdrożony komponent",
      "helpKind": "fieldHelp",
      "section": "Zakładka Składniki listy",
      "control": "dgcWartoscWaluty",
      "controlKind": "grid_column",
      "matchStatus": "matched_by_control_name",
      "score": 0.95,
      "targetBinding": {
        "datasetTable": "SkladnikiObliczZamknPrac",
        "dataMember": "WARTOSC_WALUTA"
      },
      "lookupBinding": null,
      "parameterName": null,
      "oracleMapping": null,
      "evidence": [
        "pattern=bold_dash_inside",
        "section=Zakładka Składniki listy",
        "exact_name_tokens=wartosc,waluty",
        "extraction=bold_dash_inside",
        "confidence=confirmed_structural"
      ]
    },
    {
      "guid": "7b4f2b80-4853-409d-8dc7-06cd10c8925b",
      "formType": "Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok",
      "helpLabel": "Dotyczy miesiąca",
      "helpDescription": "określa miesiąc, którego \r\n dotyczy dany składnik. Domyślnie w procesie \r\n obliczania listy płac system przyjmuje datę obliczania \r\n listy.",
      "helpKind": "fieldHelp",
      "section": "Zakładka Składniki listy",
      "control": "dgcDotyczyMiesiaca",
      "controlKind": "grid_column",
      "matchStatus": "matched_by_control_name",
      "score": 0.95,
      "targetBinding": {
        "datasetTable": "SkladnikiObliczZamknPrac",
        "dataMember": "DOTYCZY_MIESIACA"
      },
      "lookupBinding": null,
      "parameterName": null,
      "oracleMapping": null,
      "evidence": [
        "pattern=bold_dash_inside",
        "section=Zakładka Składniki listy",
        "exact_name_tokens=dotyczy,miesiaca",
        "extraction=bold_dash_inside",
        "confidence=confirmed_structural"
      ]
    },
    {
      "guid": "7b4f2b80-4853-409d-8dc7-06cd10c8925b",
      "formType": "Teta.Sumo.Personel.plgListaPlac.CrdListyZamkniete.ListyZamknieteWidok",
      "helpLabel": "Typ listy",
      "helpDescription": "typ listy, która została obliczona:",
      "helpKind": "fieldHelp",
      "section": "Zakładka Składniki listy",
      "control": "dgcTypListy",
      "controlKind": "grid_column",
      "matchStatus": "matched_by_control_name",
      "score": 0.95,
      "targetBinding": {
        "datasetTable": "SkladnikiObliczZamknPrac",
        "dataMember": "TYP_LISTY"
      },
      "lookupBinding": null,
      "parameterName": null,
      "oracleMapping": null,
      "evidence": [
        "pattern=bold_dash_inside",
        "section=Zakładka Składniki listy",
        "exact_name_tokens=typ,listy",
        "extraction=bold_dash_inside",
        "confidence=confirmed_structural"
      ]
    }
  ]
}
```

### D. Formularz bez Help

```json
{
  "formType": "Teta.Sumo.Personel.plgPersonelParametryRap.Pity.PrmPit40",
  "guid": "02e54042-6570-421e-9212-af1ee889f7e3",
  "helpStatus": "help_file_missing",
  "classVerificationStatus": "verified_exact",
  "note": "Technical graph preserved; help does not lower confidence"
}
```

JSON: `docs/AIA_HELP_SEMANTIC_MAPPING_STAGE2C.json`
Pełny dump: `.local/AIA_HELP_SEMANTIC_MAPPING_STAGE2C.full.ndjson`
