@echo off
REM ══════════════════════════════════════════════════════════
REM  run_cloud_sync.bat — refresh OHLCV candles in Supabase
REM  Scheduled daily 15:30 IST by register_tasks.ps1
REM ══════════════════════════════════════════════════════════
setlocal
set ROOT=%~dp0..
set LOGDIR=%ROOT%\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set LOG=%LOGDIR%\cloud_sync.log

echo [%date% %time%] cloud sync start >> "%LOG%"
"%ROOT%\.venv\Scripts\python.exe" "%ROOT%\cloud\sync_cloud_prices.py" >> "%LOG%" 2>&1
if %errorlevel% neq 0 (
    echo [%date% %time%] cloud sync FAILED exitcode=%errorlevel% >> "%LOG%"
) else (
    echo [%date% %time%] cloud sync OK >> "%LOG%"
)
endlocal
