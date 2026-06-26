# Sprawdzenia przed / na poczatku konfiguracji (MSI Teta AI Assistant).
# Zwraca kod 0 = OK, 1 = blad (komunikat w setup-error.txt i okno dialogowe).

param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,

    [Parameter(Mandatory = $true)]
    [ValidateSet('client', 'vendor')]
    [string]$Mode,

    [switch]$Offline,

    [string]$InstallerPath = '',

    [switch]$ShowDialog
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Installer-Security.ps1"
. "$PSScriptRoot\Setup-Common.ps1"

function Write-PreFlightError {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [string]$Hint = ''
    )

    $full = @(
        $Title,
        '',
        $Message
    )
    if ($Hint) {
        $full += ''
        $full += $Hint
    }
    $text = ($full -join "`r`n").Trim()
    Write-SetupFailureMessage -InstallRoot $InstallRoot -Title $Title -Message $text
    if ($ShowDialog) {
        Show-InstallUserMessage -Title $Title -Message $text -Icon Error
    }
    Write-Host "[BLAD] $Title" -ForegroundColor Red
    Write-Host $Message -ForegroundColor Yellow
    if ($Hint) { Write-Host $Hint -ForegroundColor DarkGray }
    exit 1
}

function Get-DriveFreeGb([string]$Path) {
    $root = [System.IO.Path]::GetPathRoot($Path)
    if (-not $root) { return 0 }
    $drive = New-Object System.IO.DriveInfo($root)
    if (-not $drive.IsReady) { return 0 }
    return [math]::Round($drive.AvailableFreeSpace / 1GB, 1)
}

$requiredGb = if ($Offline) { 25 } else { 12 }
$freeGb = Get-DriveFreeGb $InstallRoot
if ($freeGb -lt $requiredGb) {
    Write-PreFlightError `
        -Title 'Za malo miejsca na dysku' `
        -Message "Wymagane ok. $requiredGb GB wolnego miejsca na dysku instalacji ($InstallRoot).`r`nDostepne: $freeGb GB." `
        -Hint 'Zwolnij miejsce na dysku lub wybierz inny katalog w kreatorze instalacji.'
}

if ($InstallerPath -and (Test-Path -LiteralPath $InstallerPath)) {
    $auth = Get-TetaAuthenticodeStatus -Path $InstallerPath
    $sac = Get-TetaSmartAppControlState
    if ($sac.BlocksUnsignedExe -and $auth.IsBlockedBySac) {
        Write-PreFlightError `
            -Title 'Instalator zablokowany przez Windows' `
            -Message 'Ten plik instalacyjny nie ma podpisu cyfrowego (Code Signing). Windows 11 z Inteligentna kontrola aplikacji go blokuje.' `
            -Hint @(
                'Skontaktuj sie z dostawca (Teta) w sprawie podpisanego instalatora MSI.',
                'Administrator IT moze tymczasowo wylaczyc Inteligentna kontrole aplikacji w Zabezpieczeniach Windows.'
            ) -join "`r`n"
    }
}

try {
    Assert-Administrator
} catch {
    Write-PreFlightError `
        -Title 'Brak uprawnien administratora' `
        -Message $_.Exception.Message `
        -Hint 'Uruchom instalator ponownie: prawy przycisk na TetaAI-Setup.msi -> Uruchom jako administrator.'
}

if (-not $Offline) {
    $onlineOk = $false
    foreach ($target in @('https://nodejs.org', 'https://ollama.com')) {
        try {
            $null = Invoke-WebRequest -Uri $target -Method Head -TimeoutSec 8 -UseBasicParsing
            $onlineOk = $true
            break
        } catch {
            # probuj kolejny host
        }
    }
    if (-not $onlineOk) {
        Write-PreFlightError `
            -Title 'Brak polaczenia z internetem' `
            -Message 'Instalacja online wymaga internetu (Node.js, Ollama, modele AI — lacznie ok. 5–8 GB do pobrania).' `
            -Hint 'Sprawdz siec firmowa / proxy albo uzyj paczki OFFLINE od dostawcy.'
    }
}

if ($Offline) {
    $bundle = Join-Path $InstallRoot 'offline-bundle.zip'
    if (-not (Test-Path -LiteralPath $bundle)) {
        Write-PreFlightError `
            -Title 'Brak paczki offline' `
            -Message "Nie znaleziono pliku offline-bundle.zip w katalogu instalacji.`r`nOczekiwano: $bundle" `
            -Hint 'Pobierz pelna paczke OFFLINE od Tety i uruchom instalator ponownie.'
    }
}

$blockingProcess = Get-Process -Name 'msiexec' -ErrorAction SilentlyContinue |
    Where-Object { $_.Id -ne $PID -and $_.MainWindowTitle -match 'Teta' }
if ($blockingProcess) {
    Write-Host 'Uwaga: wykryto inna sesje instalatora Windows.' -ForegroundColor Yellow
}

Write-Host '[OK] Kontrole wstepne zakonczone pomyslnie.' -ForegroundColor Green
exit 0
