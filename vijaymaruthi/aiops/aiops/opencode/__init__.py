"""OpenCode LLM bridge — the ONLY LLM in the platform."""

from .agent import build_lesson_prompt, build_prediction_prompt
from .client import OpenCodeClient, default_client
from .parser import ParseError, parse_llm_json

__all__ = [
    "OpenCodeClient",
    "ParseError",
    "build_lesson_prompt",
    "build_prediction_prompt",
    "default_client",
    "parse_llm_json",
]