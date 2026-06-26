# Smart App Control, Authenticode, podpis instalatora (signtool).
# Uzywane przez Build-Installer.ps1, Test-InstallerSecurity.ps1, Diagnose-TetaApp.ps1.

function Get-TetaSmartAppControlState {
    $result = [ordered]@{
        State             = 'Unknown'
        StateCode         = $null
        BlocksUnsignedExe = $false
        Detail            = ''
    }

    try {
        $policyPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy'
        $policy = Get-ItemProperty -Path $policyPath -ErrorAction Stop
        $code = $policy.VerifiedAndReputablePolicyState
        $result.StateCode = $code

        switch ([int]$code) {
            0 {
                $result.State = 'Off'
                $result.Detail = 'Inteligentna kontrola aplikacji jest wylaczona.'
            }
            1 {
                $result.State = 'Evaluation'
                $result.Detail = 'Tryb ewaluacji - nieznane EXE moga byc blokowane lub tylko logowane.'
                $result.BlocksUnsignedExe = $true
            }
            2 {
                $result.State = 'On'
                $result.Detail = 'Wlaczona - niesygnowane EXE sa blokowane (brak Uruchom mimo to).'
                $result.BlocksUnsignedExe = $true
            }
            default {
                $result.Detail = "Nieznany kod polityki: $code"
            }
        }
    } catch {
        $result.Detail = "Nie udalo sie odczytac rejestru CI Policy: $($_.Exception.Message)"
    }

    try {
        $mp = Get-MpComputerStatus -ErrorAction SilentlyContinue
        if ($mp -and $null -ne $mp.SmartAppControlState) {
            $result.Detail = "$($result.Detail) (Defender: $($mp.SmartAppControlState))"
            if ($mp.SmartAppControlState -eq 'On') {
                $result.State = 'On'
                $result.BlocksUnsignedExe = $true
            }
        }
    } catch {
        # starsze Windows / wylaczony Defender
    }

    return [pscustomobject]$result
}

function Get-TetaAuthenticodeStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Nie znaleziono pliku: $Path"
    }

    $sig = Get-AuthenticodeSignature -LiteralPath $Path
    $trusted = @('Valid', 'Trusted')
    $blocked = @('NotSigned', 'HashMismatch', 'NotTrusted', 'UnknownError')

    return [pscustomobject]@{
        Path           = (Resolve-Path -LiteralPath $Path).Path
        Status         = [string]$sig.Status
        IsTrusted      = $trusted -contains [string]$sig.Status
        IsBlockedBySac = $blocked -contains [string]$sig.Status
        Signer         = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null }
        Thumbprint     = if ($sig.SignerCertificate) { $sig.SignerCertificate.Thumbprint } else { $null }
        TimeStamp      = if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.Subject } else { $null }
    }
}

function Find-SignTool {
    $candidates = @(
        (Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe",
        "$env:ProgramFiles\Windows Kits\10\bin\*\x64\signtool.exe"
    )

    foreach ($item in $candidates) {
        if (-not $item) { continue }
        $resolved = Get-Item -Path $item -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
        if ($resolved) {
            return $resolved.FullName
        }
    }

    return $null
}

function Invoke-TetaSignInstaller {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string]$PfxPath,

        [Parameter(Mandatory = $true)]
        [string]$Password,

        [string]$TimestampUrl = 'http://timestamp.digicert.com',

        [string]$Description = 'Teta AI Assistant Installer'
    )

    if (-not (Test-Path -LiteralPath $FilePath)) {
        throw "Brak pliku do podpisu: $FilePath"
    }
    if (-not (Test-Path -LiteralPath $PfxPath)) {
        throw "Brak certyfikatu PFX: $PfxPath"
    }

    $signtool = Find-SignTool
    if (-not $signtool) {
        throw @"
Nie znaleziono signtool.exe (Windows SDK).
Zainstaluj: winget install Microsoft.WindowsSDK.10.0.22621
Lub dodaj signtool do PATH.
"@
    }

    $signArgs = @(
        'sign',
        '/fd', 'SHA256',
        '/td', 'SHA256',
        '/tr', $TimestampUrl,
        '/f', (Resolve-Path -LiteralPath $PfxPath).Path,
        '/p', $Password,
        '/d', $Description,
        '/du', 'https://teta.pl',
        (Resolve-Path -LiteralPath $FilePath).Path
    )

    Write-Host "Podpisywanie: $FilePath" -ForegroundColor Cyan
    Write-Host "  signtool: $signtool" -ForegroundColor DarkGray

    & $signtool @signArgs
    if ($LASTEXITCODE -ne 0) {
        throw "signtool zakonczyl sie kodem $LASTEXITCODE"
    }

    $status = Get-TetaAuthenticodeStatus -Path $FilePath
    if (-not $status.IsTrusted) {
        throw "Podpis zakonczony, ale status Authenticode = $($status.Status)"
    }

    Write-Host "Podpis OK: $($status.Signer)" -ForegroundColor Green
    return $status
}

function Write-TetaInstallerSecurityReport {
    param(
        [string]$InstallerPath = ''
    )

    Write-Host ""
    Write-Host "=== Windows - Inteligentna kontrola aplikacji ===" -ForegroundColor Cyan
    $sac = Get-TetaSmartAppControlState
    $sacColor = if ($sac.BlocksUnsignedExe) { 'Yellow' } else { 'Green' }
    Write-Host "  Stan: $($sac.State)" -ForegroundColor $sacColor
    Write-Host "  $($sac.Detail)" -ForegroundColor DarkGray

    if ($InstallerPath) {
        Write-Host ""
        Write-Host "=== Podpis instalatora ===" -ForegroundColor Cyan
        $auth = Get-TetaAuthenticodeStatus -Path $InstallerPath
        $authColor = if ($auth.IsTrusted) { 'Green' } elseif ($auth.IsBlockedBySac -and $sac.BlocksUnsignedExe) { 'Red' } else { 'Yellow' }
        Write-Host "  Plik:   $($auth.Path)" -ForegroundColor DarkGray
        Write-Host "  Status: $($auth.Status)" -ForegroundColor $authColor
        if ($auth.Signer) {
            Write-Host "  Podpis: $($auth.Signer)" -ForegroundColor DarkGray
        }

        if ($sac.BlocksUnsignedExe -and $auth.IsBlockedBySac) {
            Write-Host ""
            Write-Host "  Ten EXE zostanie zablokowany przez Smart App Control." -ForegroundColor Red
            Write-Host "  U klienta uzyj Instaluj-*.bat / Setup.bat z paczki ZIP." -ForegroundColor Yellow
            Write-Host "  Docelowo: certyfikat Code Signing + TETA_CODESIGN_PFX przy budowie paczki." -ForegroundColor Yellow
        }
    } elseif ($sac.BlocksUnsignedExe) {
        Write-Host ""
        Write-Host "  Niesygnowane instalatory .exe beda blokowane." -ForegroundColor Yellow
        Write-Host "  Na dev: wylacz SAC lub uzywaj Setup.bat. Na produkcje: podpisz EXE." -ForegroundColor Yellow
    }

    Write-Host ""
}
