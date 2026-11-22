"""
Download and prepare the model for AirLLM.
Run once during setup (setup.bat does this automatically).
"""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

MODEL = os.getenv("MODEL", "Qwen/Qwen3-4B-Instruct")
SHARDS_DIR = os.getenv("SHARDS_DIR", str(Path(__file__).parent / "models"))


def main():
    print(f"[download] Model: {MODEL}")
    print("[download] Downloading and splitting into 4-bit layer shards...")
    print("[download] This is the slow step (first run only).")
    from airllm import AutoModel

    model = AutoModel.from_pretrained(
        MODEL,
        compression="4bit",
        delete_original=True,
        layer_shards_saving_path=SHARDS_DIR,
    )
    print("[download] Done. Model is ready.")
    print(f"[download] Shards saved to: {SHARDS_DIR}")


if __name__ == "__main__":
    main()