@echo off
REM ══════════════════════════════════════════════════════════
REM  run_daily_analysis.bat — NSE analysis -> SQLite -> Supabase
REM  Scheduled weekdays 19:30 IST by register_tasks.ps1
REM  Resumable: re-running skips tickers already analysed today.
REM ══════════════════════════════════════════════════════════
setlocal
set ROOT=%~dp0..
set LOGDIR=%ROOT%\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set LOG=%LOGDIR%\daily_analysis.log

echo [%date% %time%] daily analysis start >> "%LOG%"

REM Step 1: run the analysis engine (limit 0 = all ~2400 tickers; change to 100 for a shorter run)
"%ROOT%\.venv\Scripts\python.exe" "%ROOT%\engine\run_latest_analysis.py" --limit 100 >> "%LOG%" 2>&1

REM Step 2: push results + OHLCV to Supabase (loads credentials from sync\.env)
pushd "%ROOT%\sync"
for /f "usebackq tokens=1,* delims=" %%A in (`findstr /b "SUPABASE_" .env`) do set %%A
popd
"%ROOT%\.venv\Scripts\python.exe" "%ROOT%\sync\sync_to_supabase.py" >> "%LOG%" 2>&1

if %errorlevel% neq 0 (
    echo [%date% %time%] daily analysis FAILED exitcode=%errorlevel% >> "%LOG%"
) else (
    echo [%date% %time%] daily analysis OK >> "%LOG%"
)
endlocal
