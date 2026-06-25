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

# --- ffmpeg (ingest MP4) ---
$ffmpegDir = Join-Path $OutputDir "tools\ffmpeg"
New-Item -ItemType Directory -Force -Path $ffmpegDir | Out-Null
try {
    $ffmpegZipUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    $ffmpegZip = Join-Path $env:TEMP "ffmpeg-essentials-offline.zip"
    Write-Host "  Pobieranie ffmpeg (essentials)..."
    Invoke-WebRequest -Uri $ffmpegZipUrl -OutFile $ffmpegZip
    $ffmpegExtract = Join-Path $env:TEMP "ffmpeg-essentials-extract"
    if (Test-Path $ffmpegExtract) { Remove-Item $ffmpegExtract -Recurse -Force }
    Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegExtract -Force
    $binDir = Get-ChildItem $ffmpegExtract -Recurse -Directory -Filter "bin" | Select-Object -First 1
    if ($binDir) {
        Copy-Item (Join-Path $binDir.FullName "ffmpeg.exe") $ffmpegDir -Force
        Copy-Item (Join-Path $binDir.FullName "ffprobe.exe") $ffmpegDir -Force
        Write-Host "  ffmpeg: pobrany do tools\ffmpeg"
    } else {
        throw "Brak katalogu bin w archiwum ffmpeg."
    }
    Remove-Item $ffmpegZip -Force -ErrorAction SilentlyContinue
    Remove-Item $ffmpegExtract -Recurse -Force -ErrorAction SilentlyContinue
} catch {
    Write-Host "  UWAGA: Nie udalo sie pobrac ffmpeg — dolacz recznie ffmpeg.exe i ffprobe.exe do tools\ffmpeg\" -ForegroundColor Yellow
    $ffmpegReadme = @"
Umiesc w tym katalogu:
  ffmpeg.exe
  ffprobe.exe

Pobierz build Windows (essentials):
  https://www.gyan.dev/ffmpeg/builds/
"@
    Set-Content (Join-Path $ffmpegDir "README.txt") $ffmpegReadme -Encoding UTF8
}

# --- Python installer + pip wheels (vendor / ingest MP4) ---
$installersDir = Join-Path $OutputDir "installers"
New-Item -ItemType Directory -Force -Path $installersDir | Out-Null
$pythonVersion = "3.12.9"
$pythonInstallerName = "python-$pythonVersion-amd64.exe"
$pythonInstallerPath = Join-Path $installersDir $pythonInstallerName
try {
    if (-not (Test-Path $pythonInstallerPath)) {
        $pythonUrl = "https://www.python.org/ftp/python/$pythonVersion/$pythonInstallerName"
        Write-Host "  Pobieranie Python $pythonVersion..."
        Invoke-WebRequest -Uri $pythonUrl -OutFile $pythonInstallerPath
    }
    Write-Host "  Python: $pythonInstallerName"
} catch {
    Write-Host "  UWAGA: Nie udalo sie pobrac Python — dolacz recznie python-3.12.x-amd64.exe do installers\" -ForegroundColor Yellow
}

$wheelsDir = Join-Path $OutputDir "python-wheels"
New-Item -ItemType Directory -Force -Path $wheelsDir | Out-Null
$requirements = Join-Path $script:RepoRoot "scripts\rag\requirements-video.txt"
if ((Test-Path $requirements) -and (Get-PythonExecutable)) {
    Write-Host "  Pobieranie pakietow pip (faster-whisper) do python-wheels..."
    $py = Get-PythonExecutable
    if ($py -eq "py") {
        & py -3 -m pip download -r $requirements -d $wheelsDir
    } else {
        & python -m pip download -r $requirements -d $wheelsDir
    }
    Write-Host "  python-wheels: gotowe"
} else {
    Write-Host "  UWAGA: Brak Pythona na maszynie budujacej paczke — uruchom ponownie po instalacji Pythona, aby uzupelnic python-wheels" -ForegroundColor Yellow
}

# --- Instalatory Node + Ollama (recznie lub juz w katalogu) ---
$installerReadme = @"
Umiesc w tym katalogu instalatory (pobrane wczesniej z internetu):

  1. Node.js LTS (MSI, x64)
     https://nodejs.org/en/download
     Przykladowa nazwa: node-v22.x.x-x64.msi

  2. Ollama for Windows
     https://ollama.com/download
     Przykladowa nazwa: OllamaSetup.exe

  3. Python 3.12 (EXE, x64) — ingest MP4 u vendora
     Przykladowa nazwa: python-3.12.x-amd64.exe
     (Prepare-OfflineBundle.ps1 probuje pobrac automatycznie)

Setup offline uruchomi je automatycznie, jesli pliki tu sa.
Katalog python-wheels\ zawiera faster-whisper do pip install --offline.
"@
Set-Content (Join-Path $installersDir "README.txt") $installerReadme -Encoding UTF8

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
Write-Host "  1. Sprawdz installers\ - node MSI, OllamaSetup.exe, python-3.12.x-amd64.exe"
Write-Host "  2. Sprawdz python-wheels\ - wymagane dla ingest MP4 offline (vendor)"
Write-Host "  3. Sprawdz tools\ffmpeg\ - ffmpeg.exe i ffprobe.exe"
Write-Host "  4. Sprawdz ollama-models\ - wymagane: nomic-embed-text, qwen3; opcjonalnie deepseek-r1"
Write-Host "  5. Skopiuj ZIP (lub katalog) na nosnik / siec klienta"
Write-Host ""
Write-Host "U klienta (bez internetu):"
Write-Host "  Skopiuj ZIP do katalogu projektu (np. offline-bundle.zip) i uruchom:"
Write-Host "  pnpm setup:client:offline"
Write-Host "  lub z dowolnej sciezki:"
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup\Setup.ps1 -Mode client -Offline -BundlePath D:\media\teta-offline-bundle.zip -NonInteractive"
