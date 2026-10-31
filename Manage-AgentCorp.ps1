<#
.SYNOPSIS
    AgentCorp - Windows Process & Service Manager
.DESCRIPTION
    Provides single-command control to start, stop, check status, backup, and launch
    the local AgentCorp server instance on Windows.
#>

[CmdletBinding()]
param(
    [ValidateSet('Start', 'Stop', 'Restart', 'Status', 'Open', 'Backup', 'Help')]
    [string]$Action = 'Status'
)

$PSScriptRootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebPath = Join-Path $PSScriptRootPath 'web'
$DataPath = Join-Path $PSScriptRootPath 'data'
$PidFile = Join-Path $DataPath 'server.pid'
$Port = 4317
$Url = "http://127.0.0.1:$Port/"

function Get-ServerProcess {
    if (Test-Path $PidFile) {
        $savedPid = Get-Content $PidFile -ErrorAction SilentlyContinue
        if ($savedPid) {
            $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
            if ($proc) { return $proc }
        }
    }
    $tcp = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($tcp -and $tcp.OwningProcess) {
        return Get-Process -Id $tcp.OwningProcess -ErrorAction SilentlyContinue
    }
    return $null
}

function Show-Status {
    $proc = Get-ServerProcess
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "                AgentCorp Status                  " -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor Cyan
    if ($proc) {
        Write-Host "  Server:   RUNNING (PID: $($proc.Id), Memory: $([math]::Round($proc.WorkingSet64 / 1MB, 1)) MB)" -ForegroundColor Green
        Write-Host "  Endpoint: $Url" -ForegroundColor Green
    } else {
        Write-Host "  Server:   STOPPED (Port $Port is free)" -ForegroundColor Yellow
    }

    # Ollama status
    $ollama = Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ollama) {
        Write-Host "  Ollama:   ONLINE (Port 11434)" -ForegroundColor Green
    } else {
        Write-Host "  Ollama:   OFFLINE (Start 'ollama serve' for local models)" -ForegroundColor DarkGray
    }

    # Backups
    $backupsDir = Join-Path $DataPath 'backups'
    if (Test-Path $backupsDir) {
        $count = (Get-ChildItem $backupsDir -Filter "office-*.db").Count
        Write-Host "  Backups:  $count snapshot(s) stored in data\backups\" -ForegroundColor Gray
    }
    Write-Host "==================================================" -ForegroundColor Cyan
}

function Start-Server {
    $proc = Get-ServerProcess
    if ($proc) {
        Write-Host "AgentCorp is already running on PID $($proc.Id)!" -ForegroundColor Green
        return
    }

    Write-Host "Starting AgentCorp server in background..." -ForegroundColor Cyan
    $startScript = Join-Path $WebPath 'start.mjs'
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = 'node.exe'
    $processInfo.Arguments = "`"$startScript`""
    $processInfo.WorkingDirectory = $WebPath
    $processInfo.UseShellExecute = $true
    $processInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $newProc = [System.Diagnostics.Process]::Start($processInfo)

    Start-Sleep -Seconds 2
    Show-Status
}

function Stop-Server {
    $proc = Get-ServerProcess
    if (-not $proc) {
        Write-Host "AgentCorp is not running." -ForegroundColor Yellow
        return
    }
    Write-Host "Stopping AgentCorp (PID: $($proc.Id))..." -ForegroundColor Cyan
    Stop-Process -Id $proc.Id -Force
    if (Test-Path $PidFile) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue }
    Write-Host "Server stopped successfully." -ForegroundColor Green
}

function Open-Browser {
    Write-Host "Opening $Url in default browser..." -ForegroundColor Cyan
    Start-Process $Url
}

function Create-Backup {
    $proc = Get-ServerProcess
    if ($proc) {
        try {
            $resp = Invoke-RestMethod -Uri "$Url/api/backup" -Method Post -TimeoutSec 5
            Write-Host "Backup created successfully: $($resp.backupFile)" -ForegroundColor Green
            return
        } catch {}
    }
    # Direct fallback if server is offline
    $dbPath = Join-Path $DataPath 'office\office.db'
    $backupDir = Join-Path $DataPath 'backups'
    if (Test-Path $dbPath) {
        if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
        $dest = Join-Path $backupDir ("office-" + (Get-Date -Format "yyyy-MM-ddTHH-mm-ss") + ".db")
        Copy-Item $dbPath $dest -Force
        Write-Host "Offline backup created: $(Split-Path $dest -Leaf)" -ForegroundColor Green
    }
}

switch ($Action) {
    'Start'   { Start-Server; Open-Browser }
    'Stop'    { Stop-Server }
    'Restart' { Stop-Server; Start-Sleep -Seconds 1; Start-Server }
    'Status'  { Show-Status }
    'Open'    { Open-Browser }
    'Backup'  { Create-Backup }
    'Help'    {
        Write-Host "Usage: .\Manage-AgentCorp.ps1 [-Action] <Start|Stop|Restart|Status|Open|Backup>"
    }
}
