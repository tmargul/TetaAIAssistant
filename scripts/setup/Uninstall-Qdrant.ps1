# Deinstalacja Qdrant: zatrzymanie i usunięcie usługi TetaAI-Qdrant + katalogi danych.
param(
    [string]$InstallRoot = ""
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\Setup-Common.ps1"

Assert-Administrator
Uninstall-TetaQdrant -InstallRoot $InstallRoot
