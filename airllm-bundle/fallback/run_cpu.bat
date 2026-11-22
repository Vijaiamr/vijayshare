@echo off
cd /d "%~dp0"

echo ============================================
echo   CPU Fallback - Ollama (Qwen3-4B)
echo ============================================
echo.

where ollama >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Ollama not found.
    echo Install it from https://ollama.com/download
    echo Then run this script again.
    pause
    exit /b 1
)

echo Pulling Qwen3-4B model (first run downloads ~2.5 GB)...
ollama pull qwen3:4b

echo.
echo Starting Ollama server...
echo API: http://localhost:11434/v1/chat/completions
echo Press Ctrl+C to stop.
echo.
ollama serve
pause