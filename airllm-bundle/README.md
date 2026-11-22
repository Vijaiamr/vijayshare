# AirLLM Lab Bundle

A free, offline, local AI assistant for your lab laptop — powered by **AirLLM**
(runs big models on small GPUs by streaming one layer at a time) and
**Qwen3-4B-Instruct** (Apache-2.0 licensed, so free to use even commercially).

- **Cost:** ₹0 forever. No API keys, no subscriptions, no internet needed after setup.
- **Model:** `Qwen/Qwen3-4B-Instruct` (~2.5 GB at 4-bit) — chosen to fit your
  8 GB RAM laptop.
- **API:** OpenAI-compatible (`/v1/chat/completions`), so any tool that speaks
  OpenAI can use it — Python, curl, your own scripts, student projects.

---

## Quick start (3 steps)

1. **Copy this whole `airllm-bundle` folder** to your Windows laptop
   (e.g. `C:\airllm-bundle`).
2. **Double-click `setup.bat`** — it checks your hardware, installs everything,
   and downloads the model. (~6 GB download once; takes 10–30 min.)
3. **Double-click `run_server.bat`** — starts the AI server.
   Then double-click `test_client.py` (or run it) to confirm it works.

Your AI endpoint is now live at: **`http://localhost:8760/v1/chat/completions`**

---

## Requirements

- Windows 10/11 (64-bit)
- Python 3.11 or 3.12 — install from <https://www.python.org/downloads/>
  **Important:** during install, tick **"Add python.exe to PATH"**.
- An NVIDIA GPU (any model, even 2 GB VRAM works — that's AirLLM's whole point).
  If your laptop has no NVIDIA GPU, use the CPU fallback (see below).
- ~10 GB free disk space (model + Python packages).

---

## What the setup does

`setup.bat` runs these steps automatically:

1. Checks Python and `nvidia-smi` (prints your GPU so you can see what it found).
2. Creates a virtual environment (`.venv`) so nothing pollutes your system.
3. Installs **PyTorch with CUDA 12.6** (the exact wheel that matches
   bitsandbytes on Windows).
4. Installs **AirLLM**, **bitsandbytes**, **FastAPI** and friends.
5. Downloads **Qwen3-4B-Instruct** and pre-splits it into 4-bit layer shards
   (this is the slow part — first run only).

If your GPU is too old (compute capability < 6.0) or missing, setup prints a
clear message and points you to the CPU fallback.

---

## Using the API

### From Python

```python
import urllib.request, json

body = {
    "messages": [
        {"role": "system", "content": "You are a helpful lab assistant."},
        {"role": "user", "content": "Explain what a moving average is."},
    ],
    "max_tokens": 200,
}
req = urllib.request.Request(
    "http://localhost:8760/v1/chat/completions",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json"},
)
reply = json.loads(urllib.request.urlopen(req).read())
print(reply["choices"][0]["message"]["content"])
```

### From curl

```bash
curl http://localhost:8760/v1/chat/completions ^
  -H "Content-Type: application/json" ^
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"Hello!\"}],\"max_tokens\":100}"
```

### Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /v1/chat/completions` | Chat (OpenAI-compatible) |
| `GET /v1/models` | List the loaded model |
| `GET /healthz` | Health check |

---

## Configuration (`.env`)

Edit `.env` before running setup to change the model or server settings:

| Key | Default | Meaning |
|---|---|---|
| `MODEL` | `Qwen/Qwen3-4B-Instruct` | Hugging Face model ID |
| `PORT` | `8760` | Server port |
| `MAX_TOKENS` | `512` | Max reply length |
| `TEMPERATURE` | `0.7` | Creativity (0 = strict, 1 = creative) |
| `TOP_P` | `0.9` | Nucleus sampling |
| `TOP_K` | `40` | Top-k sampling |
| `MAX_LENGTH` | `2048` | Max prompt length |

### Switching models

Your 8 GB RAM is the hard limit. Safe choices:

| Model | 4-bit size | Good for |
|---|---|---|
| `Qwen/Qwen3-4B-Instruct` (default) | ~2.5 GB | General chat, reasoning |
| `Qwen/Qwen3-Coder-4B` | ~2.5 GB | Coding, data/ML analysis |
| `Qwen/Qwen3-8B` | ~5 GB | Better quality, **borderline on 8 GB RAM** |

Bigger models (14B+) will not fit in 8 GB RAM — skip them until you upgrade RAM.

---

## CPU fallback (no NVIDIA GPU)

If `setup.bat` reports no usable NVIDIA GPU, use the CPU path instead:

1. Install **Ollama** from <https://ollama.com/download> (free).
2. Double-click `fallback\run_cpu.bat` — it pulls Qwen3-4B and starts a server
   on port **11434**.
3. Your endpoint is `http://localhost:11434/v1/chat/completions`
   (same OpenAI format).

CPU is slower than GPU, but still works fine for a lab assistant.

---

## Troubleshooting

**"CUDA Setup failed despite GPU being available" (bitsandbytes)**
The classic Windows issue. Fix: make sure PyTorch was installed from the CUDA
wheel index (setup.bat does this automatically). Verify with:

```bash
python -c "import torch; print(torch.cuda.is_available())"
```

Must print `True`. If it prints `False`, re-run `setup.bat`.

**Model download is slow / interrupted**
Re-run `setup.bat` — downloads resume from where they stopped.

**Server starts but replies are slow**
AirLLM streams layers from disk, so speed depends on your disk (NVMe SSD is
best). First reply after startup is always slow (model warm-up); later ones are
faster. Reduce `MAX_TOKENS` for snappier replies.

**Out of memory / laptop freezes**
Close other heavy apps. If it still struggles, switch to the smaller
`Qwen/Qwen3-4B-Instruct` (default) or use the CPU fallback.

**Port 8760 already in use**
Change `PORT` in `.env` and restart.

---

## About the "3 trillion params on 6 GB RAM" claim

AirLLM's headline claim is **technically true**: it streams one layer at a time,
so VRAM needs stay tiny even for huge models. But there's a catch — **speed is
disk-bound**: every token reads the whole model from disk. A 2.8-trillion-param
model needs ~1.5 TB of disk and runs at **minutes per token** — technically
"running", practically unusable. That's why this bundle uses a 4B model: it's
the largest size that gives you *usable* speed on an 8 GB RAM laptop.

---

## License notes

- **AirLLM** — Apache-2.0
- **Qwen3-4B-Instruct** — Apache-2.0 (free for commercial use)
- **bitsandbytes** — MIT
- This bundle is provided as-is for your lab use.