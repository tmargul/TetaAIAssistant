# Naprawa środowiska Teta AI — restart usługi Qdrant (używane przez AIA Doctor).
param(
    [string]$InstallRoot = "",
    [switch]$RestartQdrant
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\Setup-Common.ps1"

if (-not $RestartQdrant) {
    $RestartQdrant = $true
}

if (-not $InstallRoot) {
    $InstallRoot = Find-TetaApplicationRoot -HintPath $InstallRoot
}

$actions = @()

if ($RestartQdrant) {
    $service = Get-Service $script:QdrantServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Host "Usługa $script:QdrantServiceName nie jest zainstalowana — pomijam restart." -ForegroundColor Yellow
        $actions += "Brak usługi $script:QdrantServiceName (tryb dev lub usługa niezarejestrowana)."
    } else {
        Write-Host "Restart usługi $script:QdrantServiceName..."
        if ($service.Status -eq "Running") {
            Stop-Service $script:QdrantServiceName -Force
            Start-Sleep -Seconds 2
            $actions += "Stop-Service $script:QdrantServiceName"
        }
        Start-Service $script:QdrantServiceName
        $actions += "Start-Service $script:QdrantServiceName"
        Write-Host "Usługa $script:QdrantServiceName uruchomiona." -ForegroundColor Green
    }
}

if ($InstallRoot) {
    try {
        Wait-QdrantReady -InstallRoot $InstallRoot
        $actions += "Qdrant odpowiada na porcie 6333"
        Write-Host "Qdrant gotowy (HTTP 6333)." -ForegroundColor Green
    } catch {
        Write-Host "Qdrant nie odpowiada po restarcie: $($_.Exception.Message)" -ForegroundColor Yellow
        $actions += "Ostrzeżenie: Qdrant nie odpowiada po restarcie"
    }
}

$actions -join "`n"
