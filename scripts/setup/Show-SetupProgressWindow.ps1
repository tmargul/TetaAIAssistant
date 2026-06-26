# Okno postepu instalacji (WinForms) — czyta setup-progress.txt na biezaco.
# Uruchamiane jako osobny proces z Run-MsiSetup.ps1 (wymaga -STA).

param(
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot,

    [Parameter(Mandatory = $true)]
    [int]$ParentProcessId
)

$ErrorActionPreference = 'SilentlyContinue'
[void][System.Threading.Thread]::CurrentThread.SetApartmentState([System.Threading.ApartmentState]::STA)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$progressPath = Join-Path $InstallRoot 'setup-progress.txt'
$errorPath = Join-Path $InstallRoot 'setup-error.txt'

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Teta AI Assistant — instalacja'
$form.Size = New-Object System.Drawing.Size(560, 240)
$form.MinimumSize = New-Object System.Drawing.Size(480, 220)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$headlineLabel = New-Object System.Windows.Forms.Label
$headlineLabel.Location = New-Object System.Drawing.Point(16, 16)
$headlineLabel.Size = New-Object System.Drawing.Size(520, 48)
$headlineLabel.Text = 'Przygotowanie instalacji...'
$headlineLabel.AutoSize = $false

$detailLabel = New-Object System.Windows.Forms.Label
$detailLabel.Location = New-Object System.Drawing.Point(16, 68)
$detailLabel.Size = New-Object System.Drawing.Size(520, 40)
$detailLabel.Text = 'To moze potrwac 20–40 minut. Nie zamykaj tego okna.'
$detailLabel.ForeColor = [System.Drawing.Color]::DimGray
$detailLabel.AutoSize = $false

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Location = New-Object System.Drawing.Point(16, 118)
$progressBar.Size = New-Object System.Drawing.Size(520, 24)
$progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
$progressBar.Minimum = 0
$progressBar.Maximum = 100
$progressBar.Value = 0

$elapsedLabel = New-Object System.Windows.Forms.Label
$elapsedLabel.Location = New-Object System.Drawing.Point(16, 154)
$elapsedLabel.Size = New-Object System.Drawing.Size(520, 24)
$elapsedLabel.Text = 'Czas od startu: 00:00:00'
$elapsedLabel.ForeColor = [System.Drawing.Color]::DimGray

$logLabel = New-Object System.Windows.Forms.Label
$logLabel.Location = New-Object System.Drawing.Point(16, 178)
$logLabel.Size = New-Object System.Drawing.Size(520, 20)
$logLabel.Text = "Log: $InstallRoot\setup-log.txt"
$logLabel.ForeColor = [System.Drawing.Color]::Gray
$logLabel.Font = New-Object System.Drawing.Font('Segoe UI', 8.5)

$form.Controls.AddRange(@($headlineLabel, $detailLabel, $progressBar, $elapsedLabel, $logLabel))

function Read-SetupProgressSnapshot {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    try {
        $lines = Get-Content -LiteralPath $Path -Encoding UTF8 -ErrorAction Stop
    } catch {
        return $null
    }

    $headline = ''
    $detail = ''
    $elapsed = ''
    $percent = 0
    $isDone = $false

    foreach ($line in $lines) {
        if ($line -match '^Czas od startu:\s*(.+)$') {
            $elapsed = $Matches[1].Trim()
            continue
        }
        if ($line -match '^Szczegoly:\s*(.+)$') {
            $detail = $Matches[1].Trim()
            continue
        }
        if ($line -match '^\[GOTOWE\]') {
            $headline = $line.Trim()
            $percent = 100
            $isDone = $true
            continue
        }
        if ($line -match '^\[\d+/\d+\]\s*\((\d+)%\)') {
            $headline = $line.Trim()
            $percent = [int]$Matches[1]
            continue
        }
        if ($line -match '^Rozpoczeto instalacje') {
            $headline = $line.Trim()
            $percent = 0
        }
    }

    return [pscustomobject]@{
        Headline = $headline
        Detail   = $detail
        Elapsed  = $elapsed
        Percent  = $percent
        IsDone   = $isDone
    }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 400
$timer.Add_Tick({
    try {
        $parent = Get-Process -Id $ParentProcessId -ErrorAction Stop
    } catch {
        $timer.Stop()
        $form.Close()
        return
    }

    if (Test-Path -LiteralPath $errorPath) {
        $headlineLabel.Text = 'Wystapil blad instalacji'
        $headlineLabel.ForeColor = [System.Drawing.Color]::DarkRed
        $detailLabel.Text = 'Szczegoly w setup-error.txt i setup-log.txt'
        $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
        $progressBar.Value = 0
        return
    }

    $snap = Read-SetupProgressSnapshot -Path $progressPath
    if (-not $snap) {
        return
    }

    if ($snap.Headline) {
        $headlineLabel.Text = $snap.Headline
        $headlineLabel.ForeColor = [System.Drawing.Color]::Black
    }
    if ($snap.Detail) {
        $detailLabel.Text = $snap.Detail
    }
    if ($snap.Elapsed) {
        $elapsedLabel.Text = "Czas od startu: $($snap.Elapsed)"
    }
    if ($snap.Percent -ge 0 -and $snap.Percent -le 100) {
        $progressBar.Value = $snap.Percent
    }
    if ($snap.IsDone) {
        $progressBar.Value = 100
        $detailLabel.Text = 'Konfiguracja zakonczona — zamykanie okna...'
    }
})
$timer.Start()

[void]$form.ShowDialog()
$timer.Stop()
$form.Dispose()
