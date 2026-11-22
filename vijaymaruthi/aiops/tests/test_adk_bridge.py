"""ADK bridge tests — skip cleanly when google-adk is not installed.

These tests verify the ADK 2.x contract wiring:
- the root agent builds with the correct name, model, and tools;
- FunctionTool derives the correct tool schemas from the wrapped functions;
- the ``_with_conn`` wrapper invokes tools with keyword arguments and closes
  the connection;
- the bridge maps ADK requests/responses (content-based ``LlmResponse``).
"""

from __future__ import annotations

import asyncio
import json

import pytest

adk = pytest.importorskip("google.adk")

from google.adk.models.llm_request import LlmRequest  # noqa: E402
from google.adk.models.llm_response import LlmResponse  # noqa: E402
from google.genai import types  # noqa: E402

from aiops.agents import ADK_ERROR, root_agent  # noqa: E402
from aiops.opencode.bridge import (  # noqa: E402
    _serialize_history,
    get_open_code_llm_class,
)
from aiops.tools.descriptors import TOOL_DESCRIPTORS  # noqa: E402


def _tool(name: str):
    tool = next((t for t in root_agent.tools if t.name == name), None)
    assert tool is not None, f"tool {name!r} missing from root agent"
    return tool


def _declaration(name: str):
    return _tool(name)._get_declaration()


# ── Root agent ────────────────────────────────────────────────────────────


def test_root_agent_built():
    assert root_agent is not None
    assert ADK_ERROR is None
    assert root_agent.name == "aiops_root"
    assert root_agent.description


def test_root_agent_tools_match_descriptors():
    names = {t.name for t in root_agent.tools}
    assert names == {d["name"] for d in TOOL_DESCRIPTORS}
    assert len(root_agent.tools) == len(TOOL_DESCRIPTORS)


def test_root_agent_model_is_base_llm():
    from google.adk.models.base_llm import BaseLlm

    assert isinstance(root_agent.model, BaseLlm)


# ── Tool schemas (FunctionTool derives them from the wrapper signature) ────


def test_tool_declaration_names_and_descriptions():
    for d in TOOL_DESCRIPTORS:
        decl = _declaration(d["name"])
        assert decl.name == d["name"]
        assert decl.description == d["description"]


def test_tool_declaration_no_params():
    for name in ("get_status", "run_morning", "run_evening"):
        decl = _declaration(name)
        assert decl.parameters is None or not decl.parameters.properties


def test_tool_declaration_run_date_optional_string():
    decl = _declaration("get_predictions")
    schema = decl.parameters_json_schema
    assert schema is not None
    props = schema["properties"]
    assert "run_date" in props
    assert props["run_date"]["anyOf"][0]["type"] == "string"
    assert "run_date" not in schema.get("required", [])


def test_tool_declaration_status_enum_preserved():
    decl = _declaration("get_lessons")
    schema = decl.parameters_json_schema
    assert schema is not None
    props = schema["properties"]
    assert "status" in props
    assert props["status"]["anyOf"][0]["enum"] == [
        "proposed",
        "accepted",
        "rejected",
    ]
    assert "status" not in schema.get("required", [])


# ── Wrapper invocation (kwargs + connection lifecycle) ────────────────────


def test_wrapper_invocation_get_status(db, tmp_path, monkeypatch):
    monkeypatch.setattr("aiops.config.DB_PATH", tmp_path / "test.db")
    result = _tool("get_status").func()
    assert isinstance(result, dict)
    assert {"runs", "predictions", "validation", "lessons", "calibration"} <= set(
        result
    )


def test_wrapper_invocation_get_predictions(db, tmp_path, monkeypatch):
    monkeypatch.setattr("aiops.config.DB_PATH", tmp_path / "test.db")
    result = _tool("get_predictions").func(run_date="2025-01-01")
    assert result == {"predictions": []}


def test_wrapper_invocation_get_lessons(db, tmp_path, monkeypatch):
    monkeypatch.setattr("aiops.config.DB_PATH", tmp_path / "test.db")
    result = _tool("get_lessons").func(status="proposed")
    assert result == {"lessons": []}


# ── Bridge: LlmResponse construction (content-based, ADK 2.x) ─────────────


def test_llm_response_content_based():
    resp = LlmResponse(
        content=types.Content(
            role="model",
            parts=[types.Part(text="hello")],
        ),
        partial=False,
    )
    assert resp.partial is False
    assert resp.content is not None
    assert resp.content.parts[0].text == "hello"
    assert resp.get_function_calls() == []


def test_llm_response_function_call_part():
    resp = LlmResponse(
        content=types.Content(
            role="model",
            parts=[
                types.Part(
                    function_call=types.FunctionCall(
                        name="get_status", args={}
                    )
                )
            ],
        ),
        partial=False,
    )
    calls = resp.get_function_calls()
    assert len(calls) == 1
    assert calls[0].name == "get_status"
    assert calls[0].args == {}


# ── Bridge: history serialization (multi-turn tool context preserved) ─────


def test_serialize_history_full():
    request = LlmRequest(
        model="opencode",
        contents=[
            types.Content(
                role="user",
                parts=[types.Part(text="what is the status?")],
            ),
            types.Content(
                role="model",
                parts=[
                    types.Part(
                        function_call=types.FunctionCall(
                            name="get_status", args={}
                        )
                    )
                ],
            ),
            types.Content(
                role="user",
                parts=[
                    types.Part(
                        function_response=types.FunctionResponse(
                            name="get_status", response={"runs": []}
                        )
                    )
                ],
            ),
        ],
    )
    text = _serialize_history(request)
    assert "[user] what is the status?" in text
    assert "[model] tool_call get_status {}" in text
    assert '[user] tool_response get_status {"runs": []}' in text


def test_serialize_history_empty():
    text = _serialize_history(LlmRequest(model="opencode"))
    assert text == "[user] "


# ── Bridge: model resolution and generate_content_async ───────────────────


def test_bridge_model_resolution():
    OpenCodeLlm = get_open_code_llm_class()
    llm = OpenCodeLlm(model=None)
    assert llm.model == "opencode"
    assert llm._client is not None
    assert llm._client.model == "opencode"


def test_generate_content_async_text(monkeypatch):
    OpenCodeLlm = get_open_code_llm_class()
    llm = OpenCodeLlm(model="test-model")

    def fake_message(session_id: str, text: str) -> str:
        assert session_id == "sess-1"
        assert "[user] hi" in text
        return "Hello from opencode"

    monkeypatch.setattr(llm._client, "new_session", lambda: "sess-1")
    monkeypatch.setattr(llm._client, "message", fake_message)

    request = LlmRequest(
        model="test-model",
        contents=[types.Content(role="user", parts=[types.Part(text="hi")])],
    )

    async def run():
        return [r async for r in llm.generate_content_async(request)]

    responses = asyncio.run(run())
    assert len(responses) == 1
    resp = responses[0]
    assert resp.partial is False
    assert resp.content is not None
    assert resp.content.parts[0].text == "Hello from opencode"
    assert resp.get_function_calls() == []


def test_generate_content_async_tool_call(monkeypatch):
    OpenCodeLlm = get_open_code_llm_class()
    llm = OpenCodeLlm(model="test-model")

    def fake_message(session_id: str, text: str) -> str:
        return '{"tool": "get_status", "args": {}}'

    monkeypatch.setattr(llm._client, "new_session", lambda: "sess-1")
    monkeypatch.setattr(llm._client, "message", fake_message)

    request = LlmRequest(
        model="test-model",
        contents=[types.Content(role="user", parts=[types.Part(text="hi")])],
    )

    async def run():
        return [r async for r in llm.generate_content_async(request)]

    responses = asyncio.run(run())
    assert len(responses) == 1
    calls = responses[0].get_function_calls()
    assert len(calls) == 1
    assert calls[0].name == "get_status"
    assert calls[0].args == {}


def test_try_parse_tool_call():
    from aiops.opencode.bridge import _try_parse_tool_call

    assert _try_parse_tool_call('{"tool": "get_status", "args": {}}') == {
        "name": "get_status",
        "args": {},
    }
    assert _try_parse_tool_call('{"name": "x", "args": {"a": 1}}') == {
        "name": "x",
        "args": {"a": 1},
    }
    assert _try_parse_tool_call("just some text") is None
    assert _try_parse_tool_call('{"tool": "x"}') is None