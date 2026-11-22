"""
Vercel serverless entry point for the VijayMaruthi Wealth backend.

Vercel auto-detects the FastAPI `app` exported from this module (a root-level
`index.py` is a recognized entry point) and serves every incoming request
through it. Paths like /api/v1/health are matched by FastAPI's router inside
the app.

Important: this file intentionally lives at the project ROOT (not api/),
because the real backend package is itself named `api` (backend/api/). A
wrapper folder named api/ would collide with backend/api/ at import time.

What this wrapper does:
  1. Adds the real backend package (`backend/`) to sys.path so the standard
     `api.*` and `engine.*` imports keep working unmodified.
  2. Adds `lib/` (synced copies of the shared analysis modules that live at
     the repository root: technical_analysis_report, analysis_db, etc.) to
     sys.path.
  3. Points the filesystem cache / reports / SQLite DB at /tmp — the only
     writable directory on Vercel. It is ephemeral per invocation, which is
     fine for the cache semantics.
  4. Forces matplotlib to the headless Agg backend (no display on Vercel).

Run locally with:
    python3 -m uvicorn index:app --reload --port 8765   (from vercel-backend/)
Or simply: vercel dev
"""

import os
import sys

# ── Path setup ────────────────────────────────────────────────────────────────
_BASE = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.join(_BASE, "backend")
_LIB_DIR = os.path.join(_BASE, "lib")

for _p in (_BACKEND_DIR, _LIB_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ── Serverless-friendly environment ───────────────────────────────────────────
# Writable scratch space on Vercel (caches, generated reports, SQLite DB).
os.environ.setdefault("VM_SHARE_DIR", "/tmp")
os.environ.setdefault("CACHE_TTL_HOURS", "6")
os.environ.setdefault("DASHBOARD_CACHE_TTL", "30")
os.environ.setdefault("MPLBACKEND", "Agg")

# CORS: allow the deployed frontend (override via CORS_ORIGINS, comma-separated).
# Defaults stay aligned with the backend's localhost dev origins.
os.environ.setdefault(
    "CORS_ORIGINS",
    "https://vijaymaruthi.vercel.app,https://frontend.vercel.app",
)

# ── The app ───────────────────────────────────────────────────────────────────
from api.main import app  # noqa: E402  (the real FastAPI app from backend/api/)
