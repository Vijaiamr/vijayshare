"""ADK ``BaseLlm`` bridge to the opencode server (web UI layer, P4).

google-adk is an OPTIONAL dependency. This module never imports it at module
import time — the class is built lazily by ``get_open_code_llm_class()`` so the
CLI and all workflows work without ADK installed.

ADK contract (google-adk >= 2.9):
- ``LlmResponse`` is a pydantic model with ``content: Optional[types.Content]``
  (there is no ``parts`` field). Responses are built as
  ``LlmResponse(content=types.Content(role="model", parts=[...]), partial=False)``.
- Request parts are ``google.genai.types.Part`` objects exposing ``text``,
  ``function_call``, and ``function_response`` attributes.
- ``BaseLlm`` is a pydantic model: subclasses declare fields and build the
  HTTP client in ``model_post_init``.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

from pydantic import PrivateAttr

from .. import config

ADK_INSTALL_HINT = (
    "google-adk is not installed. Install it with: "
    "pip install 'vm-aiops[adk]'  (or: pip install 'google-adk>=2.9,<3')"
)

_OpenCodeLlmClass: Any = None


def _adk():
    """Import ADK types lazily. Raises ImportError with install instructions."""
    try:
        from google.adk.models.base_llm import BaseLlm
        from google.adk.models.llm_request import LlmRequest
        from google.adk.models.llm_response import LlmResponse
        from google.genai import types
    except ModuleNotFoundError as exc:
        # Only a missing google-adk/google-genai module is an install problem.
        # A missing transitive dependency means ADK is installed but broken.
        if exc.name and (
            exc.name == "google"
            or exc.name.startswith("google.adk")
            or exc.name.startswith("google.genai")
        ):
            raise ImportError(ADK_INSTALL_HINT) from exc
        raise ImportError(
            "google-adk is installed but failed to import (broken "
            f"dependency: {exc.name or exc})"
        ) from exc
    except ImportError as exc:
        raise ImportError(
            "google-adk is installed but failed to import (incompatible "
            f"version or broken dependency): {exc}"
        ) from exc
    return BaseLlm, LlmRequest, LlmResponse, types


def _build_class():
    """Build the OpenCodeLlm class (subclass of ADK BaseLlm)."""
    BaseLlm, LlmRequest, LlmResponse, types = _adk()

    class OpenCodeLlm(BaseLlm):
        """ADK LLM backed by the opencode server."""

        # Pydantic fields (BaseLlm is a pydantic model in ADK 2.x).
        model: str | None = None
        base_url: str = config.OPENCODE_SERVER_URL
        password: str = config.OPENCODE_SERVER_PASSWORD
        agent: str = config.OPENCODE_AGENT
        directory: str | None = config.OPENCODE_DIRECTORY
        timeout: int = 120

        _client: Any = PrivateAttr(default=None)

        def model_post_init(self, __context: Any) -> None:
            super().model_post_init(__context)
            from .client import OpenCodeClient

            # BaseLlm.model is a required str; resolve the opencode model name
            # (config may be unset) before building the client.
            self.model = self.model or config.OPENCODE_MODEL or "opencode"
            self._client = OpenCodeClient(
                base_url=self.base_url,
                password=self.password,
                agent=self.agent,
                directory=self.directory,
                model=self.model,
                timeout=self.timeout,
            )

        async def generate_content_async(
            self, llm_request: LlmRequest, stream: bool = False
        ) -> AsyncIterator[LlmResponse]:
            """Map an ADK request to a blocking opencode message and back.

            The opencode client only accepts text, so the full request history
            (text, tool calls, tool responses) is serialized into a single
            auditable message with role markers. When the returned text is a
            JSON tool-call object (``{"tool": ..., "args": ...}``), a
            ``types.FunctionCall`` part is emitted instead of text.

            ``stream`` is accepted for ADK compatibility; opencode's blocking
            ``message()`` returns the complete turn, so a single
            ``partial=False`` response is yielded either way (valid per the
            BaseLlm contract).
            """
            text = self._client.message(
                self._client.new_session(),
                _serialize_history(llm_request),
            )

            response_parts: list[types.Part] = []
            parsed = _try_parse_tool_call(text)
            if parsed is not None:
                response_parts.append(
                    types.Part(
                        function_call=types.FunctionCall(
                            name=parsed["name"], args=parsed["args"]
                        )
                    )
                )
            else:
                response_parts.append(types.Part(text=text))

            yield LlmResponse(
                content=types.Content(role="model", parts=response_parts),
                partial=False,
            )

    return OpenCodeLlm


def _serialize_history(llm_request: LlmRequest) -> str:
    """Serialize the full ADK request history into one auditable text message.

    The opencode client only accepts text parts, so tool calls and tool
    responses are rendered as compact JSON lines with role markers. This
    preserves multi-turn tool context that the old bridge dropped.
    """
    lines: list[str] = []
    for content in getattr(llm_request, "contents", []) or []:
        role = getattr(content, "role", None) or "user"
        for part in getattr(content, "parts", []) or []:
            if part.text is not None:
                lines.append(f"[{role}] {part.text}")
            elif part.function_call is not None:
                fc = part.function_call
                lines.append(
                    f"[{role}] tool_call {fc.name} "
                    + json.dumps(fc.args or {}, sort_keys=True)
                )
            elif part.function_response is not None:
                fr = part.function_response
                lines.append(
                    f"[{role}] tool_response {fr.name} "
                    + json.dumps(fr.response or {}, sort_keys=True)
                )
    if not lines:
        lines.append("[user] ")
    return "\n".join(lines)


def _try_parse_tool_call(text: str) -> dict[str, Any] | None:
    """Return ``{name, args}`` when ``text`` is a JSON tool-call object."""
    from .parser import ParseError, parse_llm_json

    try:
        obj = parse_llm_json(text)
    except ParseError:
        return None
    if not isinstance(obj, dict):
        return None
    if "tool" in obj and isinstance(obj.get("args"), dict):
        return {"name": str(obj["tool"]), "args": obj["args"]}
    if "name" in obj and "args" in obj:
        return {"name": str(obj["name"]), "args": obj["args"]}
    return None


def get_open_code_llm_class():
    """Return the ``OpenCodeLlm`` class, building it lazily on first use."""
    global _OpenCodeLlmClass
    if _OpenCodeLlmClass is None:
        _OpenCodeLlmClass = _build_class()
    return _OpenCodeLlmClass