# Skrypty sieci Teta (Hyper-V Default Switch)

Default Switch okresowo zmienia zakres `172.x.y.0/20`. Statyczny IP w VM wtedy
„działa lokalnie”, ale host nie widzi Oracle ani share `\\…\teta`.

## Kolejność

### 1. Na VM (konsola Hyper-V → PowerShell **jako Administrator**)

Skopiuj na VM plik `Set-TetaVmNetwork.ps1`, potem:

```powershell
cd C:\Temp   # lub gdzie skopiujesz
Set-ExecutionPolicy -Scope Process Bypass
.\Set-TetaVmNetwork.ps1
```

Skrypt:
- włącza DHCP (poznaje aktualny zakres),
- ustawia stały IP **`.145`** w tej podsieci,
- otwiera firewall TCP **1521** z podsieci hosta,
- wypisuje `VM_IP=…` do skopiowania.

### 2. Na Twoim PC (ten repo)

```powershell
cd Z:\Projekty\TetaAIAssistant\scripts\teta-vm-network
Set-ExecutionPolicy -Scope Process Bypass
.\Connect-TetaHost.ps1 -VmIp 172.27.16.145
```

(podaj IP z wyjścia skryptu VM; hasło = Administrator VM)

Opcjonalnie od razu zaktualizuj host w SQLite:

```powershell
.\Connect-TetaHost.ps1 -VmIp 172.27.16.145 -UpdateSqlite
```

## Uwagi

- Share na VM musi nazywać się **`teta`** (jak dotychczas).
- Jeśli DHCP na VM nie wstaje: w Hyper-V sprawdź, że karta VM = **Default Switch**.
- Po udanym `net use` w UI: **Ustawienia → Aplikacja Teta** (ścieżki `A:\…`) oraz **Połączenie Oracle** (host = nowy IP).
