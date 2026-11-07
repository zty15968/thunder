# itch.io expects index.html at the root of the uploaded zip.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/package.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'public'
$dist = Join-Path $root 'dist'
$zip = Join-Path $dist 'thunder-strike-web.zip'

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }

Compress-Archive -Path (Join-Path $src '*') -DestinationPath $zip -CompressionLevel Optimal
$size = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host "Packaged $zip ($size KB)"
