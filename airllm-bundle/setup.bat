@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   AirLLM Lab Bundle - Setup
echo ============================================
echo.

REM ---------- 1. Find Python ----------
set "PYTHON="
where py >nul 2>nul
if %errorlevel%==0 (
    set "PYTHON=py -3"
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        set "PYTHON=python"
    )
)
if not defined PYTHON (
    echo [ERROR] Python not found.
    echo Install Python 3.11 or 3.12 from https://www.python.org/downloads/
    echo IMPORTANT: tick "Add python.exe to PATH" during install.
    echo Then run this script again.
    pause
    exit /b 1
)

echo [1/5] Python found:
%PYTHON% --version
echo.

REM ---------- 2. Check NVIDIA GPU ----------
where nvidia-smi >nul 2>nul
if %errorlevel%==0 (
    echo [2/5] NVIDIA GPU detected:
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
    echo.
) else (
    echo [WARN] nvidia-smi not found - no NVIDIA GPU detected.
    echo AirLLM needs an NVIDIA GPU. Use the CPU fallback instead:
    echo   1. Install Ollama from https://ollama.com/download
    echo   2. Run fallback\run_cpu.bat
    echo.
    pause
    exit /b 1
)

REM ---------- 3. Create virtual environment ----------
echo [3/5] Creating virtual environment...
if not exist ".venv\Scripts\activate.bat" (
    %PYTHON% -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
)
call .venv\Scripts\activate.bat
echo.

REM ---------- 4. Install PyTorch (CUDA 12.6) + requirements ----------
echo [4/5] Installing PyTorch with CUDA 12.6 (this downloads ~2.8 GB)...
python -m pip install --upgrade pip
python -m pip install torch --index-url https://download.pytorch.org/whl/cu126
if errorlevel 1 (
    echo [ERROR] PyTorch install failed. Check your internet connection.
    pause
    exit /b 1
)

echo.
echo Installing AirLLM and dependencies...
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Package install failed.
    pause
    exit /b 1
)

REM ---------- 5. Download + prepare model ----------
echo.
echo [5/5] Downloading and preparing the model (first run only, ~2.5 GB)...
python model_download.py
if errorlevel 1 (
    echo [ERROR] Model download failed. Re-run setup.bat to resume.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Setup complete!
echo   Next: double-click run_server.bat
echo ============================================
pause