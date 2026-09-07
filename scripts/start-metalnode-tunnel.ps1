# Thin wrapper — real tunnel is Node (UTF-8 key path safe).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
node "$PSScriptRoot\metalnode-tunnel.mjs"
