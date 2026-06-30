#!/usr/bin/env pwsh
# sync.ps1 — capture this machine's Claude config into the repo.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
& node profile.mjs sync @args
exit $LASTEXITCODE
