# Sprawdza Smart App Control i podpis Authenticode instalatora Inno Setup.
#
# Przyklad:
#   .\Test-InstallerSecurity.ps1 -InstallerPath D:\out\TetaAI-Client-Setup-Online.exe

param(
    [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\Installer-Security.ps1"

Write-TetaInstallerSecurityReport -InstallerPath $InstallerPath

if ($InstallerPath) {
    $sac = Get-TetaSmartAppControlState
    $auth = Get-TetaAuthenticodeStatus -Path $InstallerPath
    if ($sac.BlocksUnsignedExe -and $auth.IsBlockedBySac) {
        exit 2
    }
    if (-not $auth.IsTrusted) {
        exit 1
    }
}

exit 0
