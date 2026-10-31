param(
    [string]$Title = "AgentCorp",
    [string]$Message = "Worker needs attention."
)

try {
    Add-Type -AssemblyName System.Windows.Forms
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.Visible = $true
    $notify.ShowBalloonTip(3000, $Title, $Message, [System.Windows.Forms.ToolTipIcon]::Info)
    Start-Sleep -Milliseconds 300
    $notify.Dispose()
} catch {
    # Fail silently without breaking
}
