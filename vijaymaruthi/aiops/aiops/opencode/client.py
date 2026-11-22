"""OpenCode LLM bridge — the ONLY LLM in the platform.

Direct HTTP client for CLI workflows (``opencode serve`` must be running).
Auth: HTTP Basic with user ``opencode`` when a password is configured; the
``x-opencode-directory`` header is sent on session creation.
"""

from __future__ import annotations

import requests

from .. import config


class OpenCodeClient:
    """Minimal blocking client for the opencode server HTTP API."""

    def __init__(
        self,
        base_url: str,
        password: str = "",
        agent: str = "aiops-llm",
        directory: str | None = None,
        model: str | None = None,
        timeout: int = 120,
    ):
        self.base_url = base_url.rstrip("/")
        self.password = password
        self.agent = agent
        self.directory = directory
        self.model = model
        self.timeout = timeout
        self.session = requests.Session()
        if password:
            self.session.auth = ("opencode", password)

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.directory:
            headers["x-opencode-directory"] = self.directory
        return headers

    def health(self) -> bool:
        """True when the opencode server is reachable and healthy."""
        try:
            r = self.session.get(f"{self.base_url}/global/health", timeout=10)
            return r.status_code == 200
        except requests.RequestException:
            return False

    def new_session(self, agent: str | None = None) -> str:
        """Create a session and return its id."""
        body: dict = {"agent": agent or self.agent}
        if self.directory:
            body["directory"] = self.directory
        r = self.session.post(
            f"{self.base_url}/session",
            json=body,
            headers=self._headers(),
            timeout=self.timeout,
        )
        r.raise_for_status()
        data = r.json()
        sid = data.get("id") or data.get("sessionID") or data.get("session_id")
        if not sid:
            raise RuntimeError(f"opencode: no session id in response: {data}")
        return str(sid)

    def message(self, session_id: str, text: str, agent: str | None = None) -> str:
        """Send a blocking message; return concatenated text from response parts."""
        body = {
            "agent": agent or self.agent,
            "noReply": False,
            "parts": [{"type": "text", "text": text}],
        }
        r = self.session.post(
            f"{self.base_url}/session/{session_id}/message",
            json=body,
            headers=self._headers(),
            timeout=self.timeout,
        )
        r.raise_for_status()
        data = r.json()
        parts = data.get("parts") or []
        texts = [
            p.get("text", "")
            for p in parts
            if isinstance(p, dict) and p.get("type") == "text" and p.get("text")
        ]
        return "\n".join(texts)

    def complete(self, prompt: str, agent: str | None = None) -> str:
        """Fresh session per turn: new session → message → return text.

        The prompt is fully serialized into a single message, making every
        interaction auditable and stateless. ``agent`` overrides the client's
        default agent for this call (e.g. the validator agent).
        """
        sid = self.new_session(agent=agent)
        return self.message(sid, prompt, agent=agent)


def default_client() -> OpenCodeClient:
    """Build a client from configuration (see ``aiops.config``)."""
    return OpenCodeClient(
        base_url=config.OPENCODE_SERVER_URL,
        password=config.OPENCODE_SERVER_PASSWORD,
        agent=config.OPENCODE_AGENT,
        directory=config.OPENCODE_DIRECTORY,
        model=config.OPENCODE_MODEL,
    )