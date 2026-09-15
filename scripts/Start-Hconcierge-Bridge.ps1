# HConcierge WhatsApp bridge — keeps the two local pieces alive.
#
#   1. the OpenWA gateway  (D:\OPENWA, Baileys engine, listens on 2785)
#   2. the outbox drainer  (db\outbox.mjs, sends what production queued)
#
# Idempotent on purpose: it starts only what is not already running, so the
# scheduled task can simply run it every few minutes and that doubles as crash
# recovery. No service wrapper, nothing to install.
#
# Run it by hand any time to bring the bridge back up:
#
#   powershell -ExecutionPolicy Bypass -File scripts\Start-Hconcierge-Bridge.ps1
#
# Add -Supervise and it keeps checking every 5 minutes instead of exiting, which
# is how it survives a crash. That mode is what the Startup shortcut runs.
#
# Register-Bridge-Task.ps1 does the same job through Task Scheduler and is
# tidier, but registering a task needs an elevated shell — hence the Startup
# folder as the no-admin path.
#
# Why this exists: Tailscale Funnel does not serve this tailnet, so Vercel cannot
# call the gateway. Production writes messages to Postgres instead and this
# drainer sends them. See WHATSAPP-TESTING-PLAN.md §2 and §2a.

param([switch]$Supervise)

$ErrorActionPreference = 'Continue'

$repo    = 'D:\concierge-wa'
$gateway = 'D:\OPENWA'
$logs    = Join-Path $repo '.logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Write-Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path (Join-Path $logs 'bridge.log') -Value $line -Encoding utf8
  Write-Output $line
}

function Start-Bridge {
# --- 1. the gateway ---------------------------------------------------------
# Checked by listening port rather than by process name: several node.exe run on
# this machine and killing the wrong one is worse than starting nothing.
if (Get-NetTCPConnection -LocalPort 2785 -State Listen -ErrorAction SilentlyContinue) {
  Write-Log 'gateway already listening on 2785'
} else {
  $node = Join-Path $gateway 'runtime\node-v22.23.2-win-x64\node.exe'
  if (-not (Test-Path -LiteralPath $node)) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $node = $cmd.Source } else { Write-Log 'ERROR node not found'; exit 1 }
  }
  Start-Process -FilePath $node `
    -ArgumentList @('--enable-source-maps', 'dist/main') `
    -WorkingDirectory $gateway -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $gateway 'openwa-api.log') `
    -RedirectStandardError  (Join-Path $gateway 'openwa-api-error.log')
  Write-Log 'gateway started'
  Start-Sleep -Seconds 12
}

# --- 2. the drainer ---------------------------------------------------------
# Matched on the script path in the command line, because it is a plain node
# process with nothing else to identify it by.
$running = @(Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains('outbox.mjs') })

if ($running.Count -gt 0) {
  Write-Log "drainer already running (pid $($running[0].ProcessId))"
} else {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { Write-Log 'ERROR node not on PATH for drainer'; exit 1 }
  # --env-file reads .env.local, which is gitignored and holds DATABASE_URL and
  # the gateway key. The drainer refuses to start without them.
  Start-Process -FilePath $node `
    -ArgumentList @('--env-file=.env.local', 'db\outbox.mjs') `
    -WorkingDirectory $repo -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs 'outbox.log') `
    -RedirectStandardError  (Join-Path $logs 'outbox-error.log')
  Write-Log 'drainer started'
}

# --- 3. say where things stand ---------------------------------------------
Start-Sleep -Seconds 2
$port = if (Get-NetTCPConnection -LocalPort 2785 -State Listen -ErrorAction SilentlyContinue) { 'up' } else { 'DOWN' }
$drain = @(Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains('outbox.mjs') }).Count
Write-Log "check: gateway=$port drainer=$drain"
}

if ($Supervise) {
  Write-Log 'supervising - checking every 5 minutes'
  while ($true) {
    try { Start-Bridge } catch { Write-Log ("supervisor caught: " + $_.Exception.Message) }
    Start-Sleep -Seconds 300
  }
} else {
  Start-Bridge
}
