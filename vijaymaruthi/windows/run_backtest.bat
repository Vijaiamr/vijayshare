@echo off
REM ══════════════════════════════════════════════════════════
REM  run_backtest.bat — full-universe quantamental backtest
REM  Run manually (takes 8-12h). RESUMABLE: if interrupted,
REM  just run this again — completed tickers are skipped.
REM ══════════════════════════════════════════════════════════
setlocal
set ROOT=%~dp0..
set LOGDIR=%ROOT%\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set LOG=%LOGDIR%\backtest.log
set OUT=%ROOT%\..\validation_results\quantamental_bt

if not exist "%OUT%" mkdir "%OUT%"

REM Universe file: one NSE ticker per line. Generated on first run
REM from the Supabase portfolio_snapshot table.
set UNIVERSE=%ROOT%\nse_universe.txt

echo [%date% %time%] backtest start >> "%LOG%"

if exist "%UNIVERSE%" (
    "%ROOT%\.venv\Scripts\python.exe" "%ROOT%\engine\quantamental_backtester.py" ^
        --universe-file "%UNIVERSE%" --workers 8 --resume ^
        --out "%OUT%" --tail -10 >> "%LOG%" 2>&1
) else (
    echo Universe file missing - generating from Supabase... >> "%LOG%"
    "%ROOT%\.venv\Scripts\python.exe" "%ROOT%\windows\make_universe.py" >> "%LOG%" 2>&1
    "%ROOT%\.venv\Scripts\python.exe" "%ROOT%\engine\quantamental_backtester.py" ^
        --universe-file "%UNIVERSE%" --workers 8 --resume ^
        --out "%OUT%" --tail -10 >> "%LOG%" 2>&1
)

echo [%date% %time%] backtest finished, exitcode=%errorlevel% >> "%LOG%"
echo.
echo Done. Report: %OUT%\REPORT.md
endlocal
