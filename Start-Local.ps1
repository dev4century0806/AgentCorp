$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath (Join-Path $PSScriptRoot 'web')
try {
    & node './start.mjs'
    if ($LASTEXITCODE -ne 0) { throw "AgentCorp exited with code $LASTEXITCODE" }
}
finally {
    Pop-Location
}
