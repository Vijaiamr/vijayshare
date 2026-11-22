# ══════════════════════════════════════════════════════════════════
#  register_tasks.ps1 — register Windows Task Scheduler jobs
#  Run as Administrator:  powershell -ExecutionPolicy Bypass -File register_tasks.ps1
# ══════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Split-Path -Parent $Root

$Python   = Join-Path $Repo ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) { Write-Host "[FAIL] Run setup_windows.ps1 first." -ForegroundColor Red; exit 1 }

# Common settings: run whether user logged in or not needs a password prompt;
# we use -LogonType Interactive (runs only while you are logged in) + wake flag.
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -WakeToRun -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 20) `
    -MultipleInstances IgnoreNew

function Register-Job($Name, $Desc, $Time, $Bat) {
    $Action = New-ScheduledTaskAction -Execute $Bat -WorkingDirectory $Root
    $Trigger = New-ScheduledTaskTrigger -Daily -At $Time
    Register-ScheduledTask -TaskName $Name -Description $Desc `
        -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
    Write-Host "[OK] $Name -> daily at $Time" -ForegroundColor Green
}

# 1. Cloud OHLCV refresh — 15:30 IST (right after market close)
Register-Job "VijayMaruthi-CloudSync" "Refresh OHLCV candles in Supabase (cloud DB population)" "15:30" (Join-Path $Root "run_cloud_sync.bat")

# 2. Daily NSE analysis + Supabase push — 19:30 IST Mon-Fri
$Action = New-ScheduledTaskAction -Execute (Join-Path $Root "run_daily_analysis.bat") -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "19:30"
Register-ScheduledTask -TaskName "VijayMaruthi-DailyAnalysis" `
    -Description "Run NSE quantamental analysis and push results to Supabase" `
    -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
Write-Host "[OK] VijayMaruthi-DailyAnalysis -> weekdays at 19:30" -ForegroundColor Green

Write-Host ""
Write-Host "Backtest is NOT scheduled — launch it manually when needed:"
Write-Host "    windows\run_backtest.bat            (full universe, resumable)"
Write-Host ""
Write-Host "Verify tasks:  Get-ScheduledTask -TaskName 'VijayMaruthi-*'"
