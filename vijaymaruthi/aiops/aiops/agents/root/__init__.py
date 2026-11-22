"""ADK root agent — discovery shim for the web UI layer (P4).

google-adk is optional. When it is not installed, ``root_agent`` is ``None``
and ``ADK_ERROR`` explains how to install it. The CLI never imports this
module, so the CLI works without ADK.
"""

from __future__ import annotations

import inspect
from typing import Any, Literal, Optional

root_agent: Any = None
ADK_ERROR: str | None = None


def _param_annotation(prop: dict) -> Any:
    """Python annotation for a descriptor property (drives the tool schema).

    ADK's FunctionTool derives the tool schema from the callable signature
    (``inspect.signature`` honors ``__signature__``). Mapping descriptor
    properties to ``Optional[str]`` / ``Optional[Literal[...]]`` keeps the
    schema typed and the enum intact.
    """
    if prop.get("type") != "string":
        return Any
    enum_values = prop.get("enum")
    if enum_values:
        return Optional[Literal[tuple(enum_values)]]  # type: ignore[valid-type]
    return Optional[str]


def _build_root_agent():
    """Build the ADK root agent (imports google.adk lazily)."""
    from google.adk.agents import Agent
    from google.adk.tools import FunctionTool

    from ... import config
    from ...db.engine import connect
    from ...opencode.bridge import get_open_code_llm_class
    from ...tools.descriptors import TOOL_DESCRIPTORS
    from ...tools.functions import (
        get_lessons,
        get_predictions,
        get_status,
        run_evening,
        run_morning,
    )

    _FUNCTIONS = {
        "get_status": get_status,
        "get_predictions": get_predictions,
        "get_lessons": get_lessons,
        "run_morning": run_morning,
        "run_evening": run_evening,
    }

    def _with_conn(fn):
        """Wrap a ``(conn, **kwargs)`` tool function for ADK invocation.

        ADK's FunctionTool calls the underlying function as ``fn(**args)``, so
        the wrapper must accept keyword arguments only. The wrapper carries the
        original function's name, the descriptor's description, and an explicit
        ``__signature__`` so FunctionTool derives the correct tool schema.
        """
        descriptor = next(
            d for d in TOOL_DESCRIPTORS if d["name"] == fn.__name__
        )
        properties = descriptor["parameters"].get("properties") or {}

        def wrapper(**kwargs: Any) -> dict:
            conn = connect()
            try:
                return fn(conn, **kwargs)
            finally:
                conn.close()

        wrapper.__name__ = fn.__name__
        wrapper.__doc__ = descriptor["description"]
        wrapper.__signature__ = inspect.Signature(
            parameters=[
                inspect.Parameter(
                    name=name,
                    kind=inspect.Parameter.KEYWORD_ONLY,
                    default=None,
                    annotation=_param_annotation(prop),
                )
                for name, prop in properties.items()
            ]
        )
        return wrapper

    tools = [
        FunctionTool(func=_with_conn(_FUNCTIONS[d["name"]]))
        for d in TOOL_DESCRIPTORS
    ]

    OpenCodeLlm = get_open_code_llm_class()
    llm = OpenCodeLlm(model=config.OPENCODE_MODEL)

    return Agent(
        name="aiops_root",
        model=llm,
        tools=tools,
        description=(
            "AIOPS root agent — NSE market intelligence, predictions, "
            "validation, and lessons for the VijayMaruthi Auto Pilot platform."
        ),
    )


try:
    root_agent = _build_root_agent()
except ModuleNotFoundError as exc:
    root_agent = None
    ADK_ERROR = (
        "google-adk is not installed; the AIOps root agent is unavailable. "
        f"Install it with: pip install 'vm-aiops[adk]'  ({exc})"
    )
except ImportError as exc:
    root_agent = None
    ADK_ERROR = (
        "google-adk is installed but failed to import; the AIOps root agent "
        f"is unavailable. Check the google-adk version (>=2.9,<3): {exc}"
    )