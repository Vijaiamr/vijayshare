"""Strict JSON extraction from LLM output.

The LLM output contract is a single JSON object. This parser strips markdown
code fences and extracts the first balanced ``{...}`` object.
"""

from __future__ import annotations

import json


class ParseError(Exception):
    """Raised when no valid JSON object can be extracted."""


def parse_llm_json(text: str) -> dict:
    """Extract the first JSON object from ``text``.

    Handles ```json ... ``` fences and leading prose. Raises ``ParseError``
    when no balanced, valid JSON object is found.
    """
    if not text or not isinstance(text, str):
        raise ParseError("empty LLM output")

    t = text.strip()
    # Strip markdown code fences.
    if t.startswith("```"):
        lines = t.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        t = "\n".join(lines).strip()

    start = t.find("{")
    if start == -1:
        raise ParseError("no JSON object found")

    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(t)):
        ch = t[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                candidate = t[start : i + 1]
                try:
                    obj = json.loads(candidate)
                except json.JSONDecodeError as exc:
                    raise ParseError(f"invalid JSON object: {exc}") from exc
                if not isinstance(obj, dict):
                    raise ParseError("JSON object is not a dict")
                return obj

    raise ParseError("unbalanced JSON object")