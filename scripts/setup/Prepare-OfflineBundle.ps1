# Przygotowanie paczki offline do wdrozenia u klienta BEZ internetu.
# Uruchom u Tety (z internetem), potem skopiuj caly katalog offline-bundle na serwer klienta.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup\Prepare-OfflineBundle.ps1
#
# Opcjonalnie:
#   -OutputDir D:\media\teta-offline-bundle

param(
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\Setup-Common.ps1"

if (-not $OutputDir) {
    $OutputDir = Join-Path $script:RepoRoot "offline-bundle"
}

$OutputDir = (Resolve-Path (New-Item -ItemType Directory -Force -Path $OutputDir)).Path

Write-Host "Teta AI - przygotowanie paczki offline" -ForegroundColor Green
Write-Host "Katalog wyjsciowy: $OutputDir"

# --- Qdrant ---
$qdrantBundleDir = Join-Path $OutputDir "tools\qdrant"
New-Item -ItemType Directory -Force -Path $qdrantBundleDir | Out-Null
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/qdrant/qdrant/releases/latest"
$asset = $release.assets | Where-Object { $_.name -match "x86_64-pc-windows-msvc\.zip$" } | Select-Object -First 1
if (-not $asset) { throw "Brak paczki Qdrant Windows w GitHub releases." }
$zipPath = Join-Path $env:TEMP "qdrant-offline-$($release.tag_name).zip"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
Expand-Archive -Path $zipPath -DestinationPath $qdrantBundleDir -Force
Remove-Item $zipPath -Force
Write-Host "  Qdrant: $($release.tag_name)"

# --- NSSM ---
$toolsDir = Join-Path $OutputDir "tools"
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$nssmZip = Join-Path $env:TEMP "nssm-offline.zip"
Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $nssmZip
Expand-Archive -Path $nssmZip -DestinationPath (Join-Path $env:TEMP "nssm-offline") -Force
Copy-Item (Join-Path $env:TEMP "nssm-offline\nssm-2.24\win64\nssm.exe") (Join-Path $toolsDir "nssm.exe") -Force
Remove-Item $nssmZip -Force
Write-Host "  NSSM: skopiowany"

# --- Modele Ollama (jesli sa lokalnie) ---
$ollamaSource = Join-Path $env:USERPROFILE ".ollama\models"
$ollamaTarget = Join-Path $OutputDir "ollama-models"
if (Test-Path $ollamaSource) {
    Write-Host "  Kopiowanie modeli Ollama z $ollamaSource ..."
    Copy-Item $ollamaSource $ollamaTarget -Recurse -Force
} else {
    Write-Host "  UWAGA: Brak lokalnych modeli Ollama. Najpierw uruchom: ollama pull nomic-embed-text" -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $ollamaTarget | Out-Null
}

# --- Instalatory Node + Ollama (recznie lub juz w katalogu) ---
$installersDir = Join-Path $OutputDir "installers"
New-Item -ItemType Directory -Force -Path $installersDir | Out-Null
$installerReadme = @"
Umiesc w tym katalogu instalatory (pobrane wczesniej z internetu):

  1. Node.js LTS (MSI, x64)
     https://nodejs.org/en/download
     Przykladowa nazwa: node-v22.x.x-x64.msi

  2. Ollama for Windows
     https://ollama.com/download
     Przykladowa nazwa: OllamaSetup.exe

Setup offline uruchomi je automatycznie, jesli pliki tu sa.
"@
Set-Content (Join-Path $installersDir "README.txt") $installerReadme -Encoding UTF8

# --- pnpm store (dla pnpm install --offline) ---
Write-Step "Przygotowanie pnpm store (pnpm fetch)"
Set-Location $script:RepoRoot
if (Test-Command pnpm) {
    pnpm fetch 2>$null
    $storePath = (pnpm store path 2>$null).Trim()
    if ($storePath -and (Test-Path $storePath)) {
        $bundleStore = Join-Path $OutputDir "pnpm-store"
        if (Test-Path $bundleStore) { Remove-Item $bundleStore -Recurse -Force }
        Write-Host "  Kopiowanie pnpm store (moze potrwac)..."
        Copy-Item $storePath $bundleStore -Recurse -Force
    }
} else {
    Write-Host "  UWAGA: Brak pnpm - pominieto kopiowanie store." -ForegroundColor Yellow
}

# --- Opcjonalna paczka RAG ---
$ragDir = Join-Path $OutputDir "rag"
New-Item -ItemType Directory -Force -Path $ragDir | Out-Null
$distDir = Join-Path $script:RepoRoot "dist"
if (Test-Path $distDir) {
    Get-ChildItem $distDir -Filter "global-rag-*.zip" | ForEach-Object {
        Copy-Item $_.FullName $ragDir -Force
        Write-Host "  RAG: $($_.Name)"
    }
}

# --- Manifest ---
$models = @()
if (Test-Path $ollamaTarget) {
    $manifestFiles = Get-ChildItem $ollamaTarget -Recurse -Filter "*.json" -ErrorAction SilentlyContinue
    foreach ($mf in $manifestFiles) {
        try {
            $json = Get-Content $mf.FullName -Raw | ConvertFrom-Json
            if ($json.name) { $models += $json.name }
        } catch { }
    }
    $models = $models | Select-Object -Unique
}

$manifest = [ordered]@{
    format      = "teta-offline-bundle"
    version     = "1.0.0"
    createdAt   = (Get-Date).ToString("o")
    qdrantTag   = $release.tag_name
    models      = $models
    nodeRequired = ">=20"
    notes       = "Paczka do instalacji offline u klienta (setup:client -Offline)"
}
$manifestPath = Join-Path $OutputDir "manifest.json"
$manifest | ConvertTo-Json -Depth 4 | Set-Content $manifestPath -Encoding UTF8

Write-Host ""
Write-Host "Paczka offline gotowa: $OutputDir" -ForegroundColor Green
Write-Host ""
Write-Host "Przed kopiowaniem na klienta:"
Write-Host "  1. Sprawdz installers\ - dodaj node MSI i OllamaSetup.exe jesli brak"
Write-Host "  2. Sprawdz ollama-models\ - powinny byc modele (nomic-embed-text, qwen3, deepseek-r1)"
Write-Host "  3. Skopiuj caly katalog offline-bundle na nosnik / siec klienta"
Write-Host ""
Write-Host "U klienta (bez internetu):"
Write-Host "  pnpm setup:client:offline"
Write-Host "  lub:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\setup\Setup.ps1 -Mode client -Offline -BundlePath D:\sciezka\offline-bundle"
