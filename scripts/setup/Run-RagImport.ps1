# Import paczki global-rag-X.zip do Qdrant.
param(
    [Parameter(Mandatory = $true)][string]$RagZipPath,
    [string]$AppRoot = ""
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\Setup-Common.ps1"

if (-not (Test-Path $RagZipPath)) {
    throw "Nie znaleziono pliku RAG: $RagZipPath"
}

if (-not $AppRoot) {
    $AppRoot = Find-TetaApplicationRoot
}

if (-not $AppRoot -or -not (Test-Path (Join-Path $AppRoot "apps\api\dist\main.js"))) {
    throw "Nie wykryto instalacji Teta AI. Podaj -AppRoot lub zainstaluj aplikacje (Setup)."
}

Set-Location $AppRoot
Write-Host "Import RAG: $RagZipPath" -ForegroundColor Green
pnpm rag:global:import --file $RagZipPath
if ($LASTEXITCODE -ne 0) {
    throw "Import RAG nie powiodl sie (kod $LASTEXITCODE)."
}
Write-Host "Import RAG zakonczony." -ForegroundColor Green
exit 0
