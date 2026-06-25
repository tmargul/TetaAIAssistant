# Import modeli Ollama z paczki models-update (katalog ollama-models + manifest).
param(
    [Parameter(Mandatory = $true)][string]$ModelsDir,
    [string]$InstallRoot = ""
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\Setup-Common.ps1"

$manifestPath = Join-Path $ModelsDir "manifest.json"
if (-not (Test-Path $manifestPath)) {
    throw "Brak manifest.json w paczce modeli: $ModelsDir"
}

$modelsSource = Join-Path $ModelsDir "ollama-models"
if (-not (Test-Path $modelsSource)) {
    throw "Brak katalogu ollama-models w paczce."
}

$appRoot = Find-TetaApplicationRoot -HintPath $InstallRoot
if (-not $appRoot) {
    throw "Nie wykryto instalacji Teta AI. Podaj -InstallRoot lub uruchom setup aplikacji."
}
$InstallRoot = Resolve-InstallRoot -InstallRoot $InstallRoot -RepoRoot $appRoot

Write-Host "Import modeli Ollama z: $ModelsDir" -ForegroundColor Green
Ensure-Ollama -InstallRoot $InstallRoot
Wait-OllamaReady

$ollamaModels = Get-OllamaModelsDir $InstallRoot
New-Item -ItemType Directory -Force -Path $ollamaModels | Out-Null

Get-ChildItem $modelsSource -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($modelsSource.Length).TrimStart('\')
    $target = Join-Path $ollamaModels $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Copy-Item $_.FullName $target -Force
}

Write-Host "Modele skopiowane do $ollamaModels" -ForegroundColor Green
Write-Host "Import modeli zakonczony. Uruchom ponownie Ollama jesli modele nie sa widoczne." -ForegroundColor Yellow
exit 0
