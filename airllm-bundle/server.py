"""
AirLLM Local Server — OpenAI-compatible API for a local LLM.

Run:  python server.py   (or double-click run_server.bat)
API:  POST http://localhost:8760/v1/chat/completions
      GET  http://localhost:8760/v1/models
      GET  http://localhost:8760/healthz
"""

import json
import os
import threading
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

load_dotenv()

MODEL = os.getenv("MODEL", "Qwen/Qwen3-4B-Instruct")
PORT = int(os.getenv("PORT", "8760"))
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "512"))
TEMPERATURE = float(os.getenv("TEMPERATURE", "0.7"))
TOP_P = float(os.getenv("TOP_P", "0.9"))
TOP_K = int(os.getenv("TOP_K", "40"))
MAX_LENGTH = int(os.getenv("MAX_LENGTH", "2048"))
SHARDS_DIR = os.getenv("SHARDS_DIR", str(Path(__file__).parent / "models"))

app = FastAPI(title="AirLLM Local Server")

_model = None
_model_lock = threading.Lock()


def get_model():
    """Load the AirLLM model once and reuse it."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                print(f"[server] Loading {MODEL} (4-bit)...")
                print("[server] First load may take a few minutes (splitting layers).")
                from airllm import AutoModel
                _model = AutoModel.from_pretrained(
                    MODEL,
                    compression="4bit",
                    delete_original=True,
                    layer_shards_saving_path=SHARDS_DIR,
                )
                print("[server] Model ready.")
    return _model


class ChatRequest(BaseModel):
    model: str | None = None
    messages: list[dict]
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    stream: bool = False


def build_prompt(messages: list[dict]) -> str:
    """Convert OpenAI-style messages into a chat prompt."""
    model = get_model()
    try:
        return model.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
    except Exception:
        # Fallback: simple role-prefixed prompt
        parts = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            parts.append(f"{role}: {content}")
        parts.append("assistant:")
        return "\n".join(parts)


def generate(prompt: str, temperature: float, top_p: float, max_tokens: int) -> str:
    model = get_model()
    input_tokens = model.tokenizer(
        [prompt],
        return_tensors="pt",
        return_attention_mask=False,
        truncation=True,
        max_length=MAX_LENGTH,
        padding=False,
    )
    generation_output = model.generate(
        input_tokens["input_ids"].cuda(),
        max_new_tokens=max_tokens,
        use_cache=True,
        return_dict_in_generate=True,
        temperature=temperature,
        top_p=top_p,
        top_k=TOP_K,
        do_sample=True,
    )
    full = model.tokenizer.decode(
        generation_output.sequences[0], skip_special_tokens=True
    )
    # Strip the prompt portion if it is included in the decoded output
    if full.startswith(prompt):
        return full[len(prompt):].lstrip()
    return full


@app.get("/healthz")
def healthz():
    return {"status": "ok", "model": MODEL}


@app.get("/v1/models")
def list_models():
    return {
        "object": "list",
        "data": [{"id": MODEL, "object": "model", "owned_by": "local"}],
    }


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatRequest):
    temperature = req.temperature if req.temperature is not None else TEMPERATURE
    top_p = req.top_p if req.top_p is not None else TOP_P
    max_tokens = req.max_tokens if req.max_tokens is not None else MAX_TOKENS

    prompt = build_prompt(req.messages)
    content = generate(prompt, temperature, top_p, max_tokens)

    if req.stream:
        # Single SSE chunk with the full response (compatible with OpenAI clients).
        payload = {
            "id": "chatcmpl-local",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": MODEL,
            "choices": [
                {"index": 0, "delta": {"content": content}, "finish_reason": "stop"}
            ],
        }

        def sse():
            yield f"data: {json.dumps(payload)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(sse(), media_type="text/event-stream")

    return {
        "id": "chatcmpl-local",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


if __name__ == "__main__":
    import uvicorn

    print(f"[server] AirLLM Local Server starting on http://localhost:{PORT}")
    print(f"[server] Model: {MODEL}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)