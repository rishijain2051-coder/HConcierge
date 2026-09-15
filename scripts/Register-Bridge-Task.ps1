# Registers the WhatsApp bridge as a Windows scheduled task.
#
#   powershell -ExecutionPolicy Bypass -File scripts\Register-Bridge-Task.ps1
#
# At logon, then every 5 minutes. The 5-minute repeat is the whole crash-recovery
# story: Start-Hconcierge-Bridge.ps1 only starts what is not running, so a tick
# that finds everything healthy costs a few milliseconds and a log line, and a
# tick that finds the gateway dead brings it back.
#
# Deliberately NOT a Windows service. A service needs a wrapper (nssm, winsw) —
# an install, which is ruled out — and stored credentials to run while logged
# out. A logon task needs neither.
#
# The trade: it runs only while this user is logged on. Log out and the bridge
# stops; messages then queue in Postgres rather than being lost, and go out on
# the next tick after logon. Unregister with:
#   Unregister-ScheduledTask -TaskName 'HConcierge WhatsApp bridge' -Confirm:$false

$ErrorActionPreference = 'Stop'

$name   = 'HConcierge WhatsApp bridge'
$script = Join-Path $PSScriptRoot 'Start-Hconcierge-Bridge.ps1'
if (-not (Test-Path -LiteralPath $script)) { throw "not found: $script" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $script)

# Two triggers: once at logon, then a repeating one. Ten years rather than
# [TimeSpan]::MaxValue — the scheduler serialises MaxValue as
# P99999999DT23H59M59S and rejects its own output as out of range.
$atLogon = New-ScheduledTaskTrigger -AtLogOn
$repeat  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false
  Write-Output "removed the previous task"
}

Register-ScheduledTask -TaskName $name -Action $action `
  -Trigger @($atLogon, $repeat) -Settings $settings `
  -Description 'Keeps the OpenWA gateway and the HConcierge outbox drainer running.' | Out-Null

Write-Output "registered: $name"
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State | Format-List
