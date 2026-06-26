# Test podpisu dev certyfikatem (self-signed).

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$infoPath = Join-Path $repoRoot '.local\certs\cert-info.json'

if (-not (Test-Path $infoPath)) {
    throw "Brak cert-info.json - uruchom New-DevCodeSignCert.ps1"
}

$info = Get-Content $infoPath -Raw | ConvertFrom-Json
. (Join-Path $PSScriptRoot 'Installer-Security.ps1')

$testDir = Join-Path $repoRoot '.local'
New-Item -ItemType Directory -Force -Path $testDir | Out-Null
$testFile = Join-Path $testDir 'sign-test.exe'
Copy-Item -Path $env:ComSpec -Destination $testFile -Force

Write-Host "Test podpisu na: $testFile" -ForegroundColor Cyan
$status = Invoke-TetaSignInstaller `
    -FilePath $testFile `
    -PfxPath $info.PfxPath `
    -Password $info.Password `
    -Description 'Teta AI Dev Sign Test'

$status | Format-List
Write-Host "Test OK - status: $($status.Status)" -ForegroundColor Green
