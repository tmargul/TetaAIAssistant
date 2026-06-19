# Kompilacja instalatorów Inno Setup dla paczek Teta AI.
# Wymaga: Inno Setup 6 (ISCC.exe) — winget install JRSoftware.InnoSetup
#
# Przykład:
#   .\Build-Installer.ps1 -Variant vendor-online -PayloadDir D:\staging\TetaAIAssistant -OutputDir D:\out -AppVersion 0.0.1

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        'vendor-online',
        'vendor-offline',
        'client-online',
        'client-offline',
        'app-update',
        'rag-update',
        'models-update',
        'offline-bundle-vendor',
        'offline-bundle-client'
    )]
    [string]$Variant,

    [Parameter(Mandatory = $true)]
    [string]$PayloadDir,

    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [string]$AppVersion = "0.0.1",
    [string]$RagZipName = "global-rag.zip",
    [string]$OutputBaseFilename = ""
)

$ErrorActionPreference = "Stop"

function Find-Iscc {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        (Get-Command iscc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
    ) | Where-Object { $_ -and (Test-Path $_) }
    return $candidates | Select-Object -First 1
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$innoDir = Join-Path $PSScriptRoot "inno"
$iscc = Find-Iscc

if (-not $iscc) {
    throw @"
Nie znaleziono Inno Setup (ISCC.exe).
Zainstaluj: winget install --id JRSoftware.InnoSetup
Lub pobierz: https://jrsoftware.org/isdl.php
"@
}

$payloadResolved = (Resolve-Path $PayloadDir).Path
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (-not $OutputBaseFilename) {
    $OutputBaseFilename = switch ($Variant) {
        'vendor-online' { 'TetaAI-Vendor-Setup-Online' }
        'vendor-offline' { 'TetaAI-Vendor-Setup-Offline' }
        'client-online' { 'TetaAI-Client-Setup-Online' }
        'client-offline' { 'TetaAI-Client-Setup-Offline' }
        'app-update' { 'TetaAI-Update-App' }
        'rag-update' { "TetaAI-Update-RAG-$AppVersion" }
        'models-update' { 'TetaAI-Update-Models' }
        'offline-bundle-vendor' { 'TetaAI-Offline-Bundle-Setup-Vendor' }
        'offline-bundle-client' { 'TetaAI-Offline-Bundle-Setup-Client' }
        default { 'TetaAI-Setup' }
    }
}

$issFile = switch ($Variant) {
    { $_ -in @('vendor-online', 'vendor-offline', 'client-online', 'client-offline') } { Join-Path $innoDir 'TetaInstaller.iss' }
    'app-update' { Join-Path $innoDir 'TetaUpdateApp.iss' }
    'rag-update' { Join-Path $innoDir 'TetaUpdateRag.iss' }
    'models-update' { Join-Path $innoDir 'TetaUpdateModels.iss' }
    { $_ -in @('offline-bundle-vendor', 'offline-bundle-client') } { Join-Path $innoDir 'TetaOfflineBundle.iss' }
}

$defines = @(
    "/DMyAppVersion=$AppVersion",
    "/DPayloadDir=$payloadResolved",
    "/DOutputBaseFilename=$OutputBaseFilename",
    "/DOutputDir=$OutputDir"
)

switch ($Variant) {
    'vendor-online' {
        $defines += '/DMyAppMode=vendor', '/DMyOffline=0', '/DMyEmbedPayload=1'
    }
    'vendor-offline' {
        $defines += '/DMyAppMode=vendor', '/DMyOffline=1', '/DMyEmbedPayload=0'
    }
    'client-online' {
        $defines += '/DMyAppMode=client', '/DMyOffline=0', '/DMyEmbedPayload=1'
    }
    'client-offline' {
        $defines += '/DMyAppMode=client', '/DMyOffline=1', '/DMyEmbedPayload=0'
    }
    'rag-update' {
        $defines += "/DRagZipName=$RagZipName"
    }
    'offline-bundle-vendor' {
        $defines += '/DMyAppMode=vendor'
    }
    'offline-bundle-client' {
        $defines += '/DMyAppMode=client'
    }
}

Write-Host "Kompilacja instalatora: $Variant -> $OutputBaseFilename.exe" -ForegroundColor Green
Write-Host "  ISCC: $iscc"
Write-Host "  Payload: $payloadResolved"

& $iscc $defines $issFile
if ($LASTEXITCODE -ne 0) {
    throw "ISCC zakonczyl sie kodem $LASTEXITCODE"
}

$exePath = Join-Path $OutputDir "$OutputBaseFilename.exe"
if (-not (Test-Path $exePath)) {
    throw "Oczekiwano pliku: $exePath"
}

Write-Host "Gotowe: $exePath" -ForegroundColor Green
Write-Output $exePath
