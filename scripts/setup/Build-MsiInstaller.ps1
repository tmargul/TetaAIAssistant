# Kompilacja instalatorow MSI (WiX Toolset 4/5) dla paczek Teta AI.
# Bez .NET Framework 3.5 (w przeciwienstwie do WiX 3.x).
#
# Wymaga (Windows):
#   dotnet tool install --global wix
#   wix extension add -g WixToolset.UI.wixext
#   wix extension add -g WixToolset.Util.wixext
#
# Na Linuxie budowa MSI nie jest wspierana — uzyj Windows lub CI (GitHub Actions windows-latest).
#
# Przyklad:
#   .\Build-MsiInstaller.ps1 -Variant client-online -PayloadDir D:\staging\TetaAIAssistant -OutputDir D:\out

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        'vendor-online',
        'vendor-offline',
        'client-online',
        'client-offline'
    )]
    [string]$Variant,

    [Parameter(Mandatory = $true)]
    [string]$PayloadDir,

    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [string]$AppVersion = "0.0.1",
    [string]$OutputBaseFilename = "",

    [string]$SignPfx = $env:TETA_CODESIGN_PFX,
    [string]$SignPassword = $env:TETA_CODESIGN_PASSWORD,
    [string]$SignTimestampUrl = $env:TETA_CODESIGN_TIMESTAMP_URL,
    [switch]$Sign
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Installer-Security.ps1")

function Test-WindowsMsiBuildHost {
    if ($IsLinux -or $IsMacOS) {
        return $false
    }
    if ($env:OS -notmatch 'Windows') {
        return $false
    }
    return $true
}

function Find-WixExe {
    $cmd = Get-Command wix -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }
    $dotnetTools = Join-Path $env:USERPROFILE ".dotnet\tools\wix.exe"
    if (Test-Path $dotnetTools) {
        return $dotnetTools
    }
    return $null
}

function Ensure-WixExtensions {
    param([string]$WixExe)
    $required = @(
        'WixToolset.UI.wixext',
        'WixToolset.Util.wixext'
    )
    $installed = @()
    try {
        $list = & $WixExe extension list -g 2>&1
        $installed = @($list | ForEach-Object { ($_ -split '\s+')[0] })
    } catch {
        # pierwsza instalacja — pusta lista
    }
    foreach ($ext in $required) {
        if ($installed -notcontains $ext) {
            Write-Host "Instalacja rozszerzenia WiX: $ext" -ForegroundColor Cyan
            & $WixExe extension add -g $ext
            if ($LASTEXITCODE -ne 0) {
                throw "Nie udalo sie dodac rozszerzenia WiX: $ext"
            }
        }
    }
}

if (-not (Test-WindowsMsiBuildHost)) {
    throw @"
Budowa MSI wymaga systemu Windows (WiX tworzy instalator Windows Installer).
Na serwerze Linux uruchom aplikacje przez pnpm dev / Docker — paczke MSI buduj na Windows lub w CI (windows-latest).
Zobacz: scripts/setup/LINUX-DEPLOY.md
"@
}

$wixExe = Find-WixExe
if (-not $wixExe) {
    throw @"
Nie znaleziono WiX Toolset 4/5 (polecenie wix).
Zainstaluj: dotnet tool install --global wix
Potem: wix extension add -g WixToolset.UI.wixext
      wix extension add -g WixToolset.Util.wixext
"@
}

$payloadResolved = (Resolve-Path $PayloadDir).Path
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (-not $OutputBaseFilename) {
    $OutputBaseFilename = 'TetaAI-Setup'
}

$mode = if ($Variant -like 'vendor-*') { 'vendor' } else { 'client' }
$offline = if ($Variant -like '*-offline') { '1' } else { '0' }
$productTitle = switch ($Variant) {
    'vendor-online' { 'Teta AI Assistant - Vendor (online)' }
    'vendor-offline' { 'Teta AI Assistant - Vendor (offline)' }
    'client-online' { 'Teta AI Assistant - Klient (online)' }
    'client-offline' { 'Teta AI Assistant - Klient (offline)' }
}
$upgradeCode = if ($mode -eq 'vendor') {
    'C2D3E4F5-A6B7-4890-C123-456789ABCDEF'
} else {
    'B1C2D3E4-F5A6-4789-B012-3456789ABCDE'
}

Ensure-WixExtensions -WixExe $wixExe

$wixProj = Join-Path $PSScriptRoot "wix\TetaInstaller.wixproj"
$workDir = Join-Path $OutputDir "_wix5-$OutputBaseFilename"
if (Test-Path $workDir) {
    Remove-Item -Recurse -Force $workDir
}
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

Write-Host "Kompilacja MSI (WiX 5): $Variant -> $OutputBaseFilename.msi" -ForegroundColor Green
Write-Host "  wix: $wixExe" -ForegroundColor DarkGray
Write-Host "  Payload: $payloadResolved" -ForegroundColor DarkGray

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    throw "Brak dotnet SDK — wymagany do budowy MSI (WiX SDK projekt)."
}

& dotnet build $wixProj `
    -c Release `
    -p:PayloadDir=$payloadResolved `
    -p:AppVersion=$AppVersion `
    -p:MyAppMode=$mode `
    -p:MyOffline=$offline `
    -p:ProductTitle="$productTitle" `
    -p:UpgradeCode=$upgradeCode `
    -p:OutputPath=$workDir `
    -p:OutputName=$OutputBaseFilename `
    -v:q
if ($LASTEXITCODE -ne 0) {
    throw "dotnet build TetaInstaller.wixproj zakonczyl sie kodem $LASTEXITCODE"
}

$msiPath = Join-Path $workDir "$OutputBaseFilename.msi"
if (-not (Test-Path $msiPath)) {
  $msiPath = Get-ChildItem -Path $workDir -Filter "$OutputBaseFilename.msi" -Recurse | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $msiPath -or -not (Test-Path $msiPath)) {
    throw "Nie znaleziono wyjsciowego pliku MSI po kompilacji WiX 5."
}

$finalMsi = Join-Path $OutputDir "$OutputBaseFilename.msi"
Copy-Item -LiteralPath $msiPath -Destination $finalMsi -Force
$msiPath = $finalMsi

$shouldSign = $Sign.IsPresent -or ($SignPfx -and $SignPassword)
if ($shouldSign) {
    if (-not $SignPfx -or -not $SignPassword) {
        throw "Podpis wymaga TETA_CODESIGN_PFX i TETA_CODESIGN_PASSWORD."
    }
    $timestamp = if ($SignTimestampUrl) { $SignTimestampUrl } else { 'http://timestamp.digicert.com' }
    Invoke-TetaSignInstaller `
        -FilePath $msiPath `
        -PfxPath $SignPfx `
        -Password $SignPassword `
        -TimestampUrl $timestamp `
        -Description "Teta AI Assistant $OutputBaseFilename"
} elseif ($SignPfx -and -not $SignPassword) {
    Write-Host "UWAGA: TETA_CODESIGN_PFX bez hasla - pomijam podpis MSI." -ForegroundColor Yellow
}

$auth = Get-TetaAuthenticodeStatus -Path $msiPath
Write-TetaInstallerSecurityReport -InstallerPath $msiPath

Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue

Write-Host "Gotowe: $msiPath" -ForegroundColor Green
Write-Output "SIGN:$($auth.Status)"
Write-Output $msiPath
