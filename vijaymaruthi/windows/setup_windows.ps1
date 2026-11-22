# ══════════════════════════════════════════════════════════════════
#  setup_windows.ps1 — one-time setup for the VijayMaruthi runner
#  Run in PowerShell:  powershell -ExecutionPolicy Bypass -File setup_windows.ps1
# ══════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path   # windows/
$Repo = Split-Path -Parent $Root                          # vijaymaruthi/

Write-Host "=== VijayMaruthi Windows setup ===" -ForegroundColor Cyan

# 1. Python check
try {
    $pyVersion = python --version 2>&1
    Write-Host "[OK] Python found: $pyVersion"
} catch {
    Write-Host "[FAIL] Python not on PATH. Install from https://www.python.org/downloads/" -ForegroundColor Red
    Write-Host "       IMPORTANT: tick 'Add python.exe to PATH' during install." -ForegroundColor Yellow
    exit 1
}

# 2. Virtual environment
$Venv = Join-Path $Repo ".venv"
if (-not (Test-Path $Venv)) {
    Write-Host "Creating virtual environment..."
    python -m venv $Venv
}
$Pip = Join-Path $Venv "Scripts\pip.exe"
$Python = Join-Path $Venv "Scripts\python.exe"

# 3. Dependencies
Write-Host "Installing dependencies (this takes a few minutes)..."
& $Pip install --upgrade pip --quiet
& $Pip install yfinance pandas numpy scipy matplotlib requests --quiet
Write-Host "[OK] Dependencies installed"

# 4. Verify imports
& $Python -c "import yfinance, pandas, numpy, scipy, matplotlib, requests; print('[OK] all imports verified')"

# 5. Credentials check (sync/.env)
$EnvFile = Join-Path $Repo "sync\.env"
if (Test-Path $EnvFile) {
    Write-Host "[OK] sync\.env found — Supabase credentials present"
} else {
    Write-Host "[WARN] sync\.env NOT found." -ForegroundColor Yellow
    Write-Host "       Copy it from the Mac (vijaymaruthi/sync/.env) into:"
    Write-Host "       $EnvFile"
    Write-Host "       It must contain SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
}

# 6. Smoke test: 2-ticker dry-run of cloud sync
Write-Host ""
Write-Host "Smoke test: cloud sync dry-run (RELIANCE + TCS, no writes)..."
Push-Location (Join-Path $Repo "cloud")
Get-Content (Join-Path $Repo "sync\.env") | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+)\s*$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] }
}
& $Python sync_cloud_prices.py --only RELIANCE.NS,TCS.NS --dry-run
Pop-Location

Write-Host ""
Write-Host "=== Setup complete ===" -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "  1. Register scheduled tasks:  powershell -ExecutionPolicy Bypass -File register_tasks.ps1"
Write-Host "  2. Read README_WINDOWS.md (power settings are critical!)"
