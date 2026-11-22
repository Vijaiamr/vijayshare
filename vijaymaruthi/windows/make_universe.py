#!/usr/bin/env python3
"""
make_universe.py — build nse_universe.txt from the Supabase portfolio_snapshot table.

Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from ../sync/.env and writes one
ticker per line to windows/nse_universe.txt (used by run_backtest.bat).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import requests


def load_env(path: Path) -> dict:
    env = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, _, v = line.partition('=')
                env[k.strip()] = v.strip()
    return env


def main() -> int:
    root = Path(__file__).resolve().parent.parent      # vijaymaruthi/
    env = load_env(root / 'sync' / '.env')
    url = env.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL', '')
    key = env.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not url or not key:
        print('ERROR: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (sync/.env)', file=sys.stderr)
        return 2

    headers = {'apikey': key, 'Authorization': f'Bearer {key}'}
    tickers: list[str] = []
    start = 0
    while True:
        r = requests.get(f'{url}/rest/v1/portfolio_snapshot',
                         params={'select': 'ticker', 'order': 'ticker'},
                         headers={**headers, 'Range-Unit': 'items',
                                  'Range': f'{start}-{start + 999}'},
                         timeout=30)
        if r.status_code not in (200, 206):
            print(f'ERROR: fetch failed HTTP {r.status_code}: {r.text[:200]}', file=sys.stderr)
            return 1
        page = r.json()
        tickers += [row['ticker'] for row in page]
        if len(page) < 1000:
            break
        start += 1000

    out = Path(__file__).resolve().parent / 'nse_universe.txt'
    out.write_text('\n'.join(tickers) + '\n')
    print(f'OK: wrote {len(tickers)} tickers -> {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
