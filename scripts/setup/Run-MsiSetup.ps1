# Punkt wejscia instalatora MSI — pelna automatyzacja + komunikaty dla uzytkownika.

param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,

    [Parameter(Mandatory = $true)]
    [ValidateSet('client', 'vendor')]
    [string]$Mode,

    [switch]$Offline,

    [string]$BundlePath = '',

    [string]$InstallerPath = ''
)

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
. "$scriptDir\Setup-Common.ps1"

$env:TETA_MSI_INSTALL = '1'
$env:TETA_SETUP_NONINTERACTIVE = '1'

if (-not $InstallerPath -and $env:TETA_INSTALLER_PATH) {
    $InstallerPath = $env:TETA_INSTALLER_PATH
}

function Show-InstallPhaseMessage {
    param(
        [string]$Title,
        [string]$Message
    )
    Show-InstallUserMessage -Title $Title -Message $Message -Icon Information
}

try {
    Show-InstallPhaseMessage `
        -Title 'Teta AI Assistant — instalacja' `
        -Message @(
            'Za chwile rozpocznie sie automatyczna konfiguracja:',
            '• Node.js, Ollama, Qdrant, modele AI',
            '• uslugi Windows i aplikacja',
            '',
            if ($Offline) {
                'Tryb OFFLINE — bez pobierania z internetu.'
            } else {
                'Tryb ONLINE — wymagany internet (ok. 5–8 GB do pobrania).'
            },
            '',
            'To moze potrwac 20–40 minut.',
            'Nie zamykaj okna postepu instalacji ani instalatora Windows.',
            '',
            "Log: $InstallRoot\setup-log.txt"
        ) -join "`r`n"

    $preFlightArgs = @{
        InstallRoot    = $InstallRoot
        Mode           = $Mode
        Offline        = $Offline
        ShowDialog     = $true
    }
    if ($InstallerPath) {
        $preFlightArgs['InstallerPath'] = $InstallerPath
    }

    & "$scriptDir\Install-PreFlight.ps1" @preFlightArgs
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    Start-SetupProgressWindow -InstallRoot $InstallRoot

    $setupArgs = @{
        Mode            = $Mode
        InstallRoot     = $InstallRoot
        RepoRoot        = $InstallRoot
        NonInteractive  = $true
        NoStart         = $true
    }
    if ($Offline) {
        $setupArgs['Offline'] = $true
        $setupArgs['BundlePath'] = if ($BundlePath) { $BundlePath } else { Join-Path $InstallRoot 'offline-bundle.zip' }
    }

    & "$scriptDir\Setup.ps1" @setupArgs

    if (-not (Test-Path (Join-Path $InstallRoot 'apps\api\dist\main.js'))) {
        throw 'Konfiguracja zakonczyla sie bez plikow aplikacji — sprawdz setup-log.txt.'
    }

    Write-Host ''
    Write-Host 'Uruchamianie aplikacji...' -ForegroundColor Green
    Start-Application -InstallRoot $InstallRoot -OpenBrowser:$true

    Show-InstallPhaseMessage `
        -Title 'Instalacja zakonczona' `
        -Message @(
            'Teta AI Assistant jest gotowy.',
            '',
            'Aplikacja: http://localhost:3000',
            '',
            'Skrot na pulpicie i w menu Start: Teta AI Assistant',
            '',
            "Log instalacji: $InstallRoot\setup-log.txt"
        ) -join "`r`n"

    exit 0
} catch {
    $detail = $_.Exception.Message
    if ($_.ScriptStackTrace) {
        $detail += "`r`n`r`n$($_.ScriptStackTrace)"
    }
    Write-SetupFailureMessage `
        -InstallRoot $InstallRoot `
        -Title 'Instalacja nie powiodla sie' `
        -Message $detail

    Show-InstallUserMessage -Title 'Teta AI Assistant — blad instalacji' -Message @(
        'Konfiguracja srodowiska nie powiodla sie.',
        '',
        $_.Exception.Message,
        '',
        'Szczegoly:',
        "  $InstallRoot\setup-error.txt",
        "  $InstallRoot\setup-log.txt",
        '',
        'Przekaz te pliki administratorowi IT lub zespołowi Teta.'
    ) -join "`r`n" -Icon Error

    exit 1
} finally {
    Stop-SetupProgressWindow
}
