#!/usr/bin/env python3
"""
download_uploads.py — pull user-uploaded files from Supabase Storage to the Mac.

The web app stores every successfully uploaded file (e.g. ledger bank
statements) in the private `user-uploads` bucket. This script downloads any
object not already fetched into the local `uploads/` folder, so the owner can
see exactly what users uploaded.

Object path convention (written by frontend/lib/uploads.ts):
    {userId}/{ISO-timestamp}_{source}_{sanitized-filename}

Local layout:
    uploads/
      {ISO-timestamp}_{source}_{filename}     # readable copy
      .manifest.json                          # object → local file map

Usage:
    python3 download_uploads.py               # fetch new files
    python3 download_uploads.py --once        # same (default)
    python3 download_uploads.py --list        # list bucket objects only

Config: reads sync/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import requests

ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(ROOT, "uploads")
MANIFEST = os.path.join(UPLOAD_DIR, ".manifest.json")
BUCKET = "user-uploads"
PAGE_SIZE = 100


def load_dotenv(path: str) -> dict:
    out = {}
    if not os.path.isfile(path):
        return out
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def get_config() -> dict:
    cfg = {**load_dotenv(ENV_FILE), **dict(os.environ)}
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not cfg.get(k)]
    if missing:
        sys.exit(f"Missing required config: {', '.join(missing)} (see sync/.env)")
    return cfg


def api(cfg: dict, method: str, path: str, body=None, raw: bool = False):
    url = cfg["SUPABASE_URL"].rstrip("/") + path
    headers = {
        "apikey": cfg["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {cfg['SUPABASE_SERVICE_ROLE_KEY']}",
    }
    resp = requests.request(method, url, json=body, headers=headers, timeout=60)
    if resp.status_code >= 400:
        raise RuntimeError(f"Storage {method} {path} → HTTP {resp.status_code}: {resp.text[:300]}")
    return resp.content


def list_objects(cfg: dict) -> list:
    """Paginate through every object in the bucket (recursive: folders first,
    then each folder's files)."""
    objects = []

    def fetch(prefix: str) -> list:
        page_objects = []
        offset = 0
        for _ in range(1000):
            body = {
                "prefix": prefix,
                "limit": PAGE_SIZE,
                "offset": offset,
                "sortBy": {"column": "created_at", "order": "desc"},
            }
            raw = api(cfg, "POST", f"/storage/v1/object/list/{BUCKET}", body)
            page = json.loads(raw.decode())
            if not page:
                break
            page_objects.extend(page)
            if len(page) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
        return page_objects

    # Top level: user-id folders (entries with null id/metadata are folders).
    top = fetch("")
    for entry in top:
        name = entry.get("name", "")
        if not name:
            continue
        is_folder = entry.get("id") is None or entry.get("metadata") is None
        if is_folder:
            # Folder → recurse into it, prefixing the folder path back on
            folder = name if name.endswith("/") else name + "/"
            for child in fetch(folder):
                child = dict(child)
                child["name"] = folder + child.get("name", "")
                objects.append(child)
        else:
            objects.append(entry)

    return objects


def download_object(cfg: dict, name: str) -> bytes:
    return api(cfg, "GET", f"/storage/v1/object/{BUCKET}/{name}")


def load_manifest() -> dict:
    if os.path.isfile(MANIFEST):
        try:
            with open(MANIFEST, encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            return {}
    return {}


def save_manifest(manifest: dict) -> None:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=True)


def local_name_for(object_name: str) -> str:
    """{userId}/{ts}_{source}_{filename} → {ts}_{source}_{filename}"""
    parts = object_name.split("/", 1)
    if len(parts) == 2:
        return parts[1]
    return object_name


def main() -> int:
    ap = argparse.ArgumentParser(description="Download user uploads from Supabase Storage")
    ap.add_argument("--list", action="store_true", help="list bucket objects and exit")
    args = ap.parse_args()

    cfg = get_config()
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    print(f"── User uploads → {UPLOAD_DIR} ──")
    objects = list_objects(cfg)
    print(f"Bucket objects: {len(objects)}")

    if args.list:
        for o in objects:
            print(f"  {o.get('name')}  ({o.get('metadata', {}).get('size', '?')} B)")
        return 0

    manifest = load_manifest()
    downloaded = manifest.get("downloaded", {})
    new_count = 0

    for obj in objects:
        name = obj.get("name", "")
        if not name or name.endswith("/"):
            continue
        if name in downloaded:
            continue
        try:
            data = download_object(cfg, name)
        except Exception as exc:
            print(f"  ✗ {name}: {exc}")
            continue
        local = local_name_for(name)
        dest = os.path.join(UPLOAD_DIR, local)
        with open(dest, "wb") as fh:
            fh.write(data)
        downloaded[name] = {
            "local": local,
            "size": len(data),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        new_count += 1
        print(f"  ✓ {local}  ({len(data):,} B)")

    if new_count:
        save_manifest({"downloaded": downloaded})
        print(f"Downloaded {new_count} new file(s).")
    else:
        print("No new files.")

    return 0


if __name__ == "__main__":
    sys.exit(main())