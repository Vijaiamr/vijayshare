"""ADK ``FunctionTool``-compatible descriptors (name/description/parameters).

These are plain JSON-schema dicts — no google.adk import at module import
time. The web UI layer (P4) wraps them into ADK ``FunctionTool`` objects.
"""

from __future__ import annotations

TOOL_DESCRIPTORS: list[dict] = [
    {
        "name": "get_status",
        "description": (
            "Get AIOps platform status: recent runs, prediction count, "
            "validation hit-rate, lessons, calibration, and knowledge versions."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_predictions",
        "description": "List predictions, optionally filtered by run_date (YYYY-MM-DD).",
        "parameters": {
            "type": "object",
            "properties": {
                "run_date": {
                    "type": "string",
                    "description": "Trading date YYYY-MM-DD to filter by.",
                }
            },
            "required": [],
        },
    },
    {
        "name": "get_lessons",
        "description": "List lessons, optionally filtered by status.",
        "parameters": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["proposed", "accepted", "rejected"],
                    "description": "Lesson status filter.",
                }
            },
            "required": [],
        },
    },
    {
        "name": "run_morning",
        "description": "Run the morning prediction workflow for today (baseline mode).",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "run_evening",
        "description": "Run the evening validation workflow for today.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
]