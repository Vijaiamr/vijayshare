@echo off
cd /d "%~dp0"

if not exist ".venv\Scripts\activate.bat" (
    echo [ERROR] Setup not done yet. Run setup.bat first.
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat

echo ============================================
echo   Starting AirLLM Local Server
echo   API: http://localhost:8760/v1/chat/completions
echo   Press Ctrl+C to stop.
echo ============================================
echo.

python server.py
pause