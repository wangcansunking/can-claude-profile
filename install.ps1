#!/usr/bin/env pwsh
# install.ps1 — apply the repo profile onto this machine.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
& node profile.mjs install @args
exit $LASTEXITCODE
