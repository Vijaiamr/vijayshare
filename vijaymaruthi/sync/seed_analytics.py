#!/usr/bin/env python3
"""
seed_analytics.py — generate realistic demo analytics data.

Posts batches to the real ingest endpoint (POST /api/analytics/collect) so
the seed exercises the exact production path (event insert, session upsert,
identity merge). Generates ~30 days of traffic across channels, pages,
devices, and conversion goals.

Usage:
    python3 sync/seed_analytics.py [--days 30] [--base-url http://localhost:3000]
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

try:
    import requests
    import certifi
except ImportError:
    print("requests + certifi required: pip install requests certifi")
    sys.exit(1)

PAGES = [
    "/login", "/signup", "/market", "/portfolio", "/calculator",
    "/charts", "/ledger", "/settings", "/about", "/backtest",
    "/pilot", "/convolution", "/pattern-backtest",
]

CHANNELS = [
    # (source, medium, campaign, weight)
    ("google", "cpc", "launch_2026", 18),
    ("google", "organic", None, 22),
    ("direct", "none", None, 25),
    ("facebook", "cpc", "brand_q3", 10),
    ("twitter", "social", "fintech_tw", 6),
    ("linkedin", "social", "b2b_wealth", 5),
    ("email", "email", "newsletter_9", 8),
    ("bing", "cpc", "launch_2026", 3),
    ("yahoo", "organic", None, 3),
]

DEVICES = [("desktop", "Chrome", "Windows", "1920x1080", 45),
           ("desktop", "Chrome", "macOS", "1440x900", 20),
           ("mobile", "Chrome", "Android", "390x844", 18),
           ("mobile", "Safari", "iOS", "390x844", 12),
           ("tablet", "Safari", "iPadOS", "768x1024", 5)]

COUNTRIES = ["IN", "US", "GB", "AE", "SG", "AU", "CA", "DE", "SA", "MY"]

# Conversion goals with monetary value (INR)
GOALS = [
    ("signup", 0, 55),
    ("premium_subscription", 999, 8),
    ("consultation_booking", 499, 12),
    ("report_download", 0, 25),
]


def pick_weighted(items):
    total = sum(w for *_, w in items)
    r = random.uniform(0, total)
    upto = 0
    for item in items:
        upto += item[-1]
        if r <= upto:
            return item
    return items[-1]


def gen_batch(day_offset: int, rng: random.Random) -> list[dict]:
    """Generate one batch of events for a single session on a given day."""
    day = datetime.now(timezone.utc) - timedelta(days=day_offset)
    session_id = str(uuid.uuid4())
    anon_id = f"anon-{uuid.uuid4().hex[:16]}"
    source, medium, campaign, _ = pick_weighted(CHANNELS)
    device, browser, os_, screen, _ = pick_weighted(DEVICES)
    country = rng.choice(COUNTRIES)

    # 1–6 page views, walking a plausible path
    n_pages = rng.randint(1, 6)
    path = []
    if rng.random() < 0.7:
        path.append("/login")
    for _ in range(n_pages):
        path.append(rng.choice(PAGES))
    if rng.random() < 0.5:
        path.append("/signup")

    events = []
    t = day.replace(hour=rng.randint(6, 22), minute=rng.randint(0, 59), second=rng.randint(0, 59))
    for i, p in enumerate(path):
        events.append({
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "anonymous_id": anon_id,
            "event_name": "page_view",
            "page_path": p,
            "page_url": f"https://vijaymaruthi.vercel.app{p}",
            "source": source,
            "medium": medium,
            "campaign": campaign,
            "device": device,
            "browser": browser,
            "os": os_,
            "screen": screen,
            "events_at": (t + timedelta(minutes=i * rng.randint(1, 4))).isoformat(),
        })
        # time spent on each page (active seconds)
        events.append({
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "anonymous_id": anon_id,
            "event_name": "time_spent",
            "page_path": p,
            "metadata": {"seconds": rng.randint(5, 120)},
            "events_at": (t + timedelta(minutes=i * rng.randint(1, 4) + 1)).isoformat(),
        })
        # occasional scroll
        if rng.random() < 0.4:
            events.append({
                "id": str(uuid.uuid4()),
                "session_id": session_id,
                "anonymous_id": anon_id,
                "event_name": "scroll",
                "page_path": p,
                "metadata": {"depth": rng.choice([25, 50, 75, 90, 100])},
                "events_at": (t + timedelta(minutes=i * rng.randint(1, 4) + 1)).isoformat(),
            })

    # friction events
    if rng.random() < 0.06:
        events.append({
            "id": str(uuid.uuid4()), "session_id": session_id, "anonymous_id": anon_id,
            "event_name": "error", "page_path": rng.choice(path),
            "metadata": {"message": rng.choice([
                "TypeError: Cannot read properties of undefined",
                "Failed to fetch /api/dashboard",
                "ReferenceError: x is not defined",
            ])},
            "events_at": t.isoformat(),
        })
    if rng.random() < 0.05:
        events.append({
            "id": str(uuid.uuid4()), "session_id": session_id, "anonymous_id": anon_id,
            "event_name": "rage_click", "page_path": rng.choice(path),
            "metadata": {"count": rng.randint(3, 8)},
            "events_at": t.isoformat(),
        })
    if rng.random() < 0.04:
        events.append({
            "id": str(uuid.uuid4()), "session_id": session_id, "anonymous_id": anon_id,
            "event_name": "dead_click", "page_path": rng.choice(path),
            "metadata": {"count": rng.randint(2, 5)},
            "events_at": t.isoformat(),
        })

    # conversion (weighted by goal)
    if rng.random() < 0.12:
        goal, value, _ = pick_weighted([(g, v, w) for g, v, w in GOALS])
        events.append({
            "id": str(uuid.uuid4()), "session_id": session_id, "anonymous_id": anon_id,
            "event_name": "conversion", "page_path": path[-1],
            "metadata": {"goal": goal, "value": value},
            "events_at": (t + timedelta(minutes=len(path) + 1)).isoformat(),
        })

    return events


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--base-url", default="http://localhost:3000")
    ap.add_argument("--sessions-per-day", type=int, default=25)
    args = ap.parse_args()

    rng = random.Random(20260913)
    url = f"{args.base_url}/api/analytics/collect"
    total = 0
    t0 = time.time()

    for day in range(args.days):
        for _ in range(args.sessions_per_day):
            batch = gen_batch(day, rng)
            # chunk into ≤100-event batches (collect caps at 100)
            for i in range(0, len(batch), 80):
                chunk = batch[i:i + 80]
                resp = requests.post(url, json={"events": chunk}, timeout=30, verify=certifi.where())
                if resp.status_code != 200:
                    print(f"ERROR day {day}: HTTP {resp.status_code} {resp.text[:200]}")
                    return 1
                total += len(chunk)
        if day % 5 == 0 or day == args.days - 1:
            print(f"  day {day + 1}/{args.days} … ({total} events so far)")

    print(f"Seeded {total} events in {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())