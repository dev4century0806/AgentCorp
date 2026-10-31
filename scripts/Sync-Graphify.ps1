<#
.SYNOPSIS
  Synchronizes and updates the Graphify knowledge graph for AgentCorp.
.DESCRIPTION
  Runs AST extraction and updates graphify-out/graph.json, graph.html, and GRAPH_REPORT.md.
#>
param(
    [switch]$FullRebuild,
    [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"
$WorkspaceRoot = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $WorkspaceRoot

Write-Host "==> Updating Graphify Codebase Knowledge Graph..." -ForegroundColor Cyan

if ($FullRebuild) {
    python -m graphify . --code-only
    python -m graphify cluster-only . --no-label
} else {
    python -m graphify update .
}

$GraphJson = Join-Path $WorkspaceRoot "graphify-out\graph.json"
$GraphHtml = Join-Path $WorkspaceRoot "graphify-out\graph.html"

if (Test-Path $GraphJson) {
    $info = Get-Item $GraphJson
    Write-Host "[OK] Graph JSON updated: $($info.FullName) ($([math]::Round($info.Length / 1MB, 2)) MB)" -ForegroundColor Green
}

if ($OpenBrowser -and (Test-Path $GraphHtml)) {
    Start-Process $GraphHtml
}
