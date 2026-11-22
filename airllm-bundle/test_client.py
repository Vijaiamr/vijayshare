"""
Smoke test: send a chat message to the local server and print the reply.
Run AFTER run_server.bat is running.
"""

import json
import urllib.request

URL = "http://localhost:8760/v1/chat/completions"


def main():
    body = {
        "messages": [
            {"role": "system", "content": "You are a helpful lab assistant."},
            {"role": "user", "content": "Say hello in one short sentence."},
        ],
        "max_tokens": 64,
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    reply = data["choices"][0]["message"]["content"]
    print("Server reply:", reply)


if __name__ == "__main__":
    main()