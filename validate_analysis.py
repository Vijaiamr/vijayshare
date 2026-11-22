#!/usr/bin/env python3
"""
validate_analysis.py — Run technical_analysis_report.py on 300 symbols
and validate outputs.

Usage:
    python3 validate_analysis.py
"""

import subprocess
import json
import os
import sys
import time
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

REPORT_SCRIPT = "technical_analysis_report.py"
OUT_DIR = "reports"
VALIDATION_DIR = "validation_results"
MAX_WORKERS = 6

# ── 200 NSE symbols (first 200 from nse_symbols.txt) ──
NSE_SYMBOLS = [
    "20MICRONS", "21STCENMGM", "360ONE", "3BBLACKBIO", "3IINFOLTD",
    "3MINDIA", "3PLAND", "5PAISA", "63MOONS", "A2ZINFRA",
    "AAATECH", "AADHARHFC", "AAKASH", "AAREYDRUGS", "AARNAV",
    "AARON", "AARTECH", "AARTIDRUGS", "AARTIIND", "AARTIPHARM",
    "AARTISURF", "AARVI", "AAVAS", "ABAN", "ABANSENT",
    "ABB", "ABBOTINDIA", "ABCAPITAL", "ABCOTS", "ABDL",
    "ABFRL", "ABINFRA", "ABMINTLLTD", "ABMKNO", "ABREL",
    "ABSLAMC", "ACC", "ACCELYA", "ACCURACY", "ACE",
    "ACEINTEG", "ACI", "ACL", "ACMESOLAR", "ACSTECH",
    "ACUTAAS", "ADANIENSOL", "ADANIENT", "ADANIGREEN", "ADANIPORTS",
    "ADANIPOWER", "ADFFOODS", "ADL", "ADOR", "ADROITINFO",
    "ADSL", "ADVAIT", "ADVANIHOTR", "ADVENZYMES", "AEGISLOG",
    "AEROFLEX", "AETHER", "AFCONS", "AFFLE", "AGARIND",
    "AGI", "AGIIL", "AGRITECH", "AGROPHOS", "AHCL",
    "AHLADA", "AHLEAST", "AHLUCONT", "AIAENG", "AIIL",
    "AIRAN", "AIROLAM", "AJANTPHARM", "AJMERA", "AJOONI",
    "AKASH", "AKG", "AKI", "AKSHAR", "AKSHARCHEM",
    "AKUMS", "ALANKIT", "ALEMBICLTD", "ALICON", "ALKEM",
    "ALKYLAMINE", "ALLCARGO", "ALOKINDS", "ALPA", "AMBER",
    "AMBUJACEM", "AMDIND", "AMJLAND", "AMNPLST", "ANANDRATHI",
    "ANANTRAJ", "ANDHRAPAP", "ANDHRSUGAR", "ANGELONE", "ANKITMETAL",
    "ANMOL", "ANSALAPI", "ANTGRAPHIC", "ANUHPHR", "ANUP",
    "ANURAS", "APARINDS", "APCL", "APCOTEXIND", "APEX",
    "APLAPOLLO", "APLLTD", "APOLLO", "APOLLOHOSP", "APOLLOPIPE",
    "APOLLOTYRE", "APTECHT", "APTUS", "ARCHIDPLY", "ARCHIES",
    "ARE&M", "ARIES", "ARIHANT", "ARIHANTCAP", "ARIHANTSUP",
    "ARMANFIN", "AROGRANITE", "ARROWGREEN", "ARSSBL", "ARTEMISMED",
    "ARVEE", "ARVIND", "ARVINDFASN", "ARVSMART", "ASAHIINDIA",
    "ASAHISONG", "ASAL", "ASALCBR", "ASHAPURMIN", "ASHIANA",
    "ASHIKA", "ASHIMASYN", "ASHOKA", "ASHOKLEY", "ASIANPAINT",
    "ASIANTILES", "ASKAUTOLTD", "ASMS", "ASTEC", "ASTERDM",
    "ASTRAL", "ASTRAMICRO", "ASTRAZEN", "ASTRON", "ATGL",
    "ATHERENERG", "ATL", "ATLANTAA", "ATUL", "ATULAUTO",
    "AUBANK", "AURIONPRO", "AUROPHARMA", "AURUM", "AUTOAXLES",
    "AUTOIND", "AVADHSUGAR", "AVALON", "AVANTEL", "AVANTIFEED",
    "AVG", "AVL", "AVONMORE", "AVROIND", "AVTNPL",
    "AWFIS", "AWHCL", "AWL", "AXISBANK", "AXISCADES",
    "AXITA", "AZAD", "BAFNAPH", "BAGFILMS", "BAIDFIN",
    "BAJAJ-AUTO", "BAJAJCON", "BAJAJELEC", "BAJAJFINSV", "BAJAJHCARE",
]

# ── 100 US large-cap symbols ──
US_SYMBOLS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA",
    "META", "TSLA", "BRK-B", "JPM", "V",
    "JNJ", "WMT", "MA", "PG", "UNH",
    "HD", "DIS", "BAC", "NFLX", "ADBE",
    "CRM", "KO", "PEP", "CSCO", "ABT",
    "TMO", "CMCSA", "NKE", "MRK", "PFE",
    "TXN", "AVGO", "QCOM", "COST", "ABBV",
    "CVX", "WFC", "MDT", "DHR", "HON",
    "PM", "LIN", "NEE", "IBM", "GE",
    "MCD", "INTU", "LMT", "AXP", "CAT",
    "GS", "BLK", "C", "MS", "BA",
    "MMM", "XOM", "UNP", "RTX", "LOW",
    "AMAT", "SBUX", "GILD", "ISRG", "VRTX",
    "AMD", "MU", "INTC", "UBER", "SYK",
    "DE", "SPGI", "PLD", "ELV", "LRCX",
    "ADI", "ANET", "NOW", "PANW", "SHW",
    "ZTS", "EOG", "BSX", "FI", "SO",
    "DUK", "CL", "T", "TMUS", "VZ",
    "BMY", "BDX", "APD", "ICE", "MO",
    "WM", "NSC", "ITW", "REGN", "ILMN",
]

ALL_SYMBOLS = [s + ".NS" for s in NSE_SYMBOLS] + US_SYMBOLS
# Only take first 300
ALL_SYMBOLS = ALL_SYMBOLS[:300]


def check_dependencies():
    """Check that required files exist."""
    if not os.path.exists(REPORT_SCRIPT):
        print(f"ERROR: {REPORT_SCRIPT} not found")
        return False
    return True


def run_single(symbol: str) -> dict:
    """Run the analysis script on a single symbol and validate."""
    start = time.time()
    result = {
        'symbol': symbol,
        'status': 'FAIL',
        'runtime_s': 0,
        'errors': [],
        'price': None,
        'signal': None,
        'confidence': None,
        'rsi': None,
        'adx': None,
        'structure': None,
        'wyckoff_phase': None,
        'has_report': False,
        'has_chart': False,
        'has_json': False,
        'report_line_count': 0,
        'critical_fields_present': [],
        'checks_passed': 0,
        'checks_total': 0,
    }

    safe_sym = symbol.replace('.', '_')

    try:
        # Run the script
        proc = subprocess.run(
            ["python3", REPORT_SCRIPT, symbol, "--save-json"],
            capture_output=True, text=True, timeout=120
        )
        elapsed = time.time() - start
        result['runtime_s'] = round(elapsed, 1)

        # Check exit code
        if proc.returncode != 0:
            result['errors'].append(f"Exit code {proc.returncode}")
            result['errors'].append(proc.stderr[-500:] if proc.stderr else "")
            return result

        # Check output files exist
        report_file = os.path.join(OUT_DIR, f"{safe_sym}_report.txt")
        chart_file = os.path.join(OUT_DIR, f"{safe_sym}_analysis.png")
        json_file = os.path.join(OUT_DIR, f"{safe_sym}_data.json")

        result['has_report'] = os.path.exists(report_file) and os.path.getsize(report_file) > 100
        result['has_chart'] = os.path.exists(chart_file) and os.path.getsize(chart_file) > 10000
        result['has_json'] = os.path.exists(json_file) and os.path.getsize(json_file) > 50

        # Parse report for critical fields
        if result['has_report']:
            with open(report_file) as f:
                report_text = f.read()
            result['report_line_count'] = len(report_text.splitlines())

            # Check for critical sections
            checks = [
                ('Market Structure', '1. MARKET STRUCTURE' in report_text),
                ('Trend Analysis', 'TREND ANALYSIS' in report_text),
                ('Key Levels', 'KEY LEVELS' in report_text),
                ('Indicators', 'INDICATOR CONFLUENCE' in report_text),
                ('Candlestick', 'CANDLESTICK ANALYSIS' in report_text),
                ('Multi-Timeframe', 'MULTI-TIMEFRAME' in report_text),
                ('Wyckoff', 'WYCKOFF / ICT' in report_text),
                ('Gann', 'GANN / CYCLE' in report_text),
                ('Fundamentals', 'FUNDAMENTALS' in report_text),
                ('Divergence', 'DIVERGENCE' in report_text),
                ('Signal', 'SIGNAL' in report_text),
                ('Confidence', 'CONFIDENCE' in report_text),
            ]
            for name, present in checks:
                if present:
                    result['critical_fields_present'].append(name)
                    result['checks_passed'] += 1
                result['checks_total'] += 1

            # Parse values
            m = re.search(r'Price:\s*[₹$]?([0-9,.]+)', report_text)
            if m: result['price'] = float(m.group(1).replace(',', ''))

            m = re.search(r'ACTION:\s*(\w+)', report_text)
            if m: result['signal'] = m.group(1)

            m = re.search(r'Confidence:\s*(\d+)', report_text)
            if m: result['confidence'] = int(m.group(1))

            m = re.search(r'RSI\(14\):\s*([0-9.]+)', report_text)
            if m: result['rsi'] = float(m.group(1))

            m = re.search(r'ADX\(14\):\s*([0-9.]+)', report_text)
            if m: result['adx'] = float(m.group(1))

            m = re.search(r'Structure:\s*(\S.*?)(?:\n|$)', report_text)
            if m: result['structure'] = m.group(1).strip()

            m = re.search(r'Wyckoff Phase:\s*(\S.*?)(?:\n|$)', report_text)
            if m: result['wyckoff_phase'] = m.group(1).strip()

        # Parse JSON for validation
        if result['has_json']:
            with open(json_file) as f:
                jd = json.load(f)
            # Validate signal consistency
            if 'signal' in jd and result['signal']:
                if jd['signal'] == result['signal']:
                    result['checks_passed'] += 1
                result['checks_total'] += 1

        # Determine overall status
        min_checks = 8  # at least 8 of 12 sections
        if (result['has_report'] and result['has_chart'] and result['has_json']
            and result['checks_passed'] >= min_checks
            and result['signal'] is not None):
            result['status'] = 'PASS'
        elif result['has_report'] and result['has_chart']:
            if result['checks_passed'] >= 6:
                result['status'] = 'PARTIAL'
            else:
                result['status'] = 'WEAK'
        else:
            result['status'] = 'FAIL'

    except subprocess.TimeoutExpired:
        result['errors'].append("Timeout (120s)")
    except Exception as e:
        result['errors'].append(str(e))

    return result


def print_summary(results):
    """Print a structured summary of all validation results."""
    passed = [r for r in results if r['status'] == 'PASS']
    partial = [r for r in results if r['status'] == 'PARTIAL']
    weak = [r for r in results if r['status'] == 'WEAK']
    failed = [r for r in results if r['status'] == 'FAIL']

    print("=" * 80)
    print(f"VALIDATION SUMMARY — {len(results)} symbols")
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)

    print(f"\n{'PASS':>10s}: {len(passed):3d} ({len(passed)/len(results)*100:.1f}%)")
    print(f"{'PARTIAL':>10s}: {len(partial):3d} ({len(partial)/len(results)*100:.1f}%)")
    print(f"{'WEAK':>10s}: {len(weak):3d} ({len(weak)/len(results)*100:.1f}%)")
    print(f"{'FAIL':>10s}: {len(failed):3d} ({len(failed)/len(results)*100:.1f}%)")
    print(f"{'Pass+Partial':>10s}: {len(passed)+len(partial):3d} ({(len(passed)+len(partial))/len(results)*100:.1f}%)")

    # Aggregate stats
    signals = [r['signal'] for r in results if r['signal']]
    signal_dist = {}
    for s in signals: signal_dist[s] = signal_dist.get(s, 0) + 1

    print(f"\n--- Signal Distribution ---")
    for s, c in sorted(signal_dist.items(), key=lambda x: -x[1]):
        print(f"  {s:<15s}: {c:3d} ({c/len(signals)*100:.1f}%)")

    avg_conf = sum(r['confidence'] or 0 for r in results if r['confidence']) / max(len([r for r in results if r['confidence']]), 1)
    avg_rsi = sum(r['rsi'] or 50 for r in results if r['rsi']) / max(len([r for r in results if r['rsi']]), 1)
    avg_adx = sum(r['adx'] or 0 for r in results if r['adx']) / max(len([r for r in results if r['adx']]), 1)
    avg_runtime = sum(r['runtime_s'] for r in results) / max(len(results), 1)
    avg_report_lines = sum(r['report_line_count'] for r in results) / max(len(results), 1)

    print(f"\n--- Average Metrics ---")
    print(f"  Confidence:       {avg_conf:.1f}%")
    print(f"  RSI(14):          {avg_rsi:.1f}")
    print(f"  ADX(14):          {avg_adx:.1f}")
    print(f"  Runtime:          {avg_runtime:.1f}s")
    print(f"  Report lines:     {avg_report_lines:.0f}")
    print(f"  Sections present: {sum(r['checks_passed'] for r in results)/max(len(results), 1):.1f}/{max(r['checks_total'] for r in results) if results else 12}")

    # Section coverage
    section_counts = {}
    for r in results:
        for f in r['critical_fields_present']:
            section_counts[f] = section_counts.get(f, 0) + 1

    print(f"\n--- Section Coverage ({len(results)} symbols) ---")
    for s, c in sorted(section_counts.items(), key=lambda x: -x[1]):
        print(f"  {s:<25s}: {c:3d} ({c/len(results)*100:.1f}%)")

    # Fails
    if failed:
        print(f"\n--- Failed Symbols ---")
        for r in failed[:10]:
            errs = '; '.join(r['errors'][:3])
            print(f"  {r['symbol']:<20s}: {errs}")
        if len(failed) > 10:
            print(f"  ... and {len(failed)-10} more")

    # Comparison with manual analysis
    hdfcbank = [r for r in results if 'HDFCBANK' in r['symbol']]
    if hdfcbank:
        r = hdfcbank[0]
        print(f"\n--- HDFCBANK.NS Cross-Check (Manual vs Script) ---")
        print(f"  Metric          Manual     Script    Match?")
        print(f"  {'─'*50}")
        manual = {
            'signal': 'BUY', 'confidence': 62, 'rsi': 79.0, 'adx': 64.5,
            'structure': 'CHOCH', 'wyckoff': 'Accumulation'
        }
        for k, mv in manual.items():
            sv = getattr(r, k, None)
            match = '✅' if sv == mv else '⚠'
            print(f"  {k:<16s}: {str(mv):<10s} {str(sv):<10s} {match}")

    print("\n" + "=" * 80)


def main():
    if not check_dependencies():
        sys.exit(1)

    os.makedirs(VALIDATION_DIR, exist_ok=True)

    print(f"Starting validation on {len(ALL_SYMBOLS)} symbols ({MAX_WORKERS} workers)")
    print(f"Symbols: {ALL_SYMBOLS[0]} ... {ALL_SYMBOLS[-1]}")
    print()

    results = []
    completed = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(run_single, sym): sym for sym in ALL_SYMBOLS}

        for future in as_completed(futures):
            sym = futures[future]
            try:
                res = future.result()
                results.append(res)
                completed += 1
                status_icon = '✅' if res['status'] == 'PASS' else '⚠' if res['status'] in ('PARTIAL', 'WEAK') else '❌'
                print(f"  [{completed:3d}/{len(ALL_SYMBOLS):3d}] {status_icon} {sym:<20s} [{res['status']:<7s}] "
                      f"signal={res['signal'] or 'N/A':>6s} conf={res['confidence'] or 0:2d}% "
                      f"sections={res['checks_passed']}/{res['checks_total']} "
                      f"{res['runtime_s']:5.1f}s")
            except Exception as e:
                results.append({
                    'symbol': sym, 'status': 'FAIL', 'runtime_s': 0, 'errors': [str(e)],
                    'signal': None, 'confidence': None, 'rsi': None, 'adx': None,
                    'structure': None, 'wyckoff_phase': None,
                    'has_report': False, 'has_chart': False, 'has_json': False,
                    'report_line_count': 0, 'critical_fields_present': [],
                    'checks_passed': 0, 'checks_total': 0,
                })
                completed += 1
                print(f"  [{completed:3d}/{len(ALL_SYMBOLS):3d}] ❌ {sym:<20s} [CRASH]  {str(e)[:60]}")

    # Save results to file
    results_file = os.path.join(VALIDATION_DIR, "validation_results.json")
    # Convert to serializable
    serializable = []
    for r in results:
        s = dict(r)
        s['errors'] = s['errors'][:5]
        serializable.append(s)
    with open(results_file, 'w') as f:
        json.dump(serializable, f, indent=2, default=str)
    print(f"\nResults saved to {results_file}")

    print_summary(results)


if __name__ == '__main__':
    main()
