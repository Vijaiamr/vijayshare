"""
Chatbot API routes with AI/LLM integration, web search, and knowledge base.
"""

import os
import json
import hashlib
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import httpx

router = APIRouter(prefix="/api/v1/chatbot", tags=["chatbot"])

# ── Configuration ──
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
SEARCH_API_KEY = os.environ.get("SEARCH_API_KEY", "")  # For web search
SEARCH_API_URL = os.environ.get("SEARCH_API_URL", "https://api.searchapi.io/api/v1/search")

# ── Knowledge Base ──
# On Vercel the bundle is read-only, so the knowledge base must live in the
# writable scratch dir (VM_SHARE_DIR=/tmp). Locally it stays next to the code.
_KB_DIR = os.environ.get(
    "VM_SHARE_DIR",
    os.path.join(os.path.dirname(__file__), "knowledge_base"),
)
os.makedirs(_KB_DIR, exist_ok=True)

# ── Models ──
class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []
    learn_from_web: bool = False
    language: Optional[str] = None

class LearnRequest(BaseModel):
    topic: str
    language: Optional[str] = None
    max_results: int = 5

class KnowledgeEntry(BaseModel):
    id: str
    topic: str
    content: str
    source: str
    created_at: str
    language: Optional[str] = None

# ── Knowledge Base Functions ──
def _kb_path(topic: str) -> str:
    safe_name = hashlib.md5(topic.lower().strip().encode()).hexdigest()
    return os.path.join(_KB_DIR, f"{safe_name}.json")

def save_knowledge(topic: str, content: str, source: str, language: Optional[str] = None) -> KnowledgeEntry:
    entry = KnowledgeEntry(
        id=hashlib.md5(f"{topic}:{source}".encode()).hexdigest(),
        topic=topic,
        content=content,
        source=source,
        created_at=datetime.now().isoformat(),
        language=language,
    )
    path = _kb_path(topic)
    existing = []
    if os.path.exists(path):
        with open(path, "r") as f:
            existing = json.load(f)
    existing.append(entry.model_dump())
    with open(path, "w") as f:
        json.dump(existing, f, indent=2)
    return entry

def get_knowledge(topic: str) -> List[dict]:
    path = _kb_path(topic)
    if not os.path.exists(path):
        return []
    with open(path, "r") as f:
        return json.load(f)

def search_knowledge(query: str) -> List[dict]:
    results = []
    query_lower = query.lower()
    for filename in os.listdir(_KB_DIR):
        if not filename.endswith(".json"):
            continue
        filepath = os.path.join(_KB_DIR, filename)
        try:
            with open(filepath, "r") as f:
                entries = json.load(f)
            for entry in entries:
                if query_lower in entry.get("topic", "").lower() or query_lower in entry.get("content", "").lower():
                    results.append(entry)
        except Exception:
            continue
    return results

# ── Web Search ──
async def web_search(query: str, max_results: int = 5) -> List[dict]:
    if not SEARCH_API_KEY:
        return await _fallback_web_search(query, max_results)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                SEARCH_API_URL,
                params={"api_key": SEARCH_API_KEY, "q": query, "num": max_results}
            )
            data = response.json()
            return [
                {"title": r.get("title", ""), "url": r.get("link", ""), "snippet": r.get("snippet", "")}
                for r in data.get("organic_results", [])[:max_results]
            ]
    except Exception as e:
        return await _fallback_web_search(query, max_results)

async def _fallback_web_search(query: str, max_results: int = 5) -> List[dict]:
    """Fallback using DuckDuckGo or similar free search"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={"User-Agent": "Mozilla/5.0"}
            )
            # Simple HTML parsing for results
            import re
            results = []
            # Extract snippets from HTML
            snippets = re.findall(r'class="result__snippet">(.*?)</a>', response.text, re.DOTALL)
            titles = re.findall(r'class="result__a">(.*?)</a>', response.text, re.DOTALL)
            urls = re.findall(r'class="result__url"[^>]*>(.*?)</a>', response.text, re.DOTALL)
            
            for i in range(min(len(titles), max_results)):
                results.append({
                    "title": re.sub(r'<[^>]+>', '', titles[i]).strip() if i < len(titles) else "",
                    "url": urls[i].strip() if i < len(urls) else "",
                    "snippet": re.sub(r'<[^>]+>', '', snippets[i]).strip() if i < len(snippets) else ""
                })
            return results
    except Exception:
        return []

# ── OpenAI Integration ──
async def call_openai(messages: List[dict], system_prompt: str = None) -> str:
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    
    formatted_messages = []
    if system_prompt:
        formatted_messages.append({"role": "system", "content": system_prompt})
    formatted_messages.extend(messages)
    
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{OPENAI_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": formatted_messages,
                    "temperature": 0.7,
                    "max_tokens": 2000
                }
            )
            data = response.json()
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI API error: {str(e)}")

# ── API Endpoints ──
@router.post("/chat")
async def chat(request: ChatRequest):
    """Main chat endpoint with optional web learning"""
    
    # Build context from knowledge base
    kb_results = search_knowledge(request.message)
    kb_context = ""
    if kb_results:
        kb_context = "\n\nRelevant knowledge from previous learnings:\n"
        for entry in kb_results[:3]:
            kb_context += f"- {entry['topic']}: {entry['content'][:500]}\n"
    
    # If user wants to learn from web, fetch and store
    web_context = ""
    if request.learn_from_web:
        search_results = await web_search(request.message)
        if search_results:
            # Store in knowledge base
            content_parts = []
            for r in search_results:
                content_parts.append(f"Source: {r['title']}\n{r['snippet']}\nURL: {r['url']}")
            combined_content = "\n\n".join(content_parts)
            save_knowledge(
                topic=request.message,
                content=combined_content,
                source="web_search",
                language=request.language
            )
            web_context = "\n\nWeb search results:\n" + combined_content
    
    # Build messages for OpenAI
    system_prompt = """You are a helpful AI assistant with learning capabilities. 
    When asked to learn something from the web, you should:
    1. Search for relevant information
    2. Summarize and explain what you found
    3. Store the knowledge for future reference
    
    Be conversational, helpful, and educational.
    If knowledge base context is provided, use it to enhance your responses."""
    
    messages = [{"role": "system", "content": system_prompt}]
    
    # Add knowledge base context
    if kb_context or web_context:
        messages.append({
            "role": "system", 
            "content": f"Context from knowledge base and web:{kb_context}{web_context}"
        })
    
    # Add conversation history
    for msg in request.history:
        messages.append({"role": msg.role, "content": msg.content})
    
    # Add current message
    messages.append({"role": "user", "content": request.message})
    
    # Get response from OpenAI
    response = await call_openai(messages, system_prompt)
    
    return {
        "response": response,
        "learned_from_web": request.learn_from_web and bool(web_context),
        "knowledge_base_entries": len(kb_results)
    }

@router.post("/learn")
async def learn_from_web(request: LearnRequest):
    """Explicitly learn a topic from the web"""
    search_results = await web_search(request.topic, request.max_results)
    
    if not search_results:
        return {"message": "No results found", "entries": []}
    
    entries = []
    for r in search_results:
        entry = save_knowledge(
            topic=request.topic,
            content=f"{r['title']}\n{r['snippet']}",
            source=r.get('url', 'web'),
            language=request.language
        )
        entries.append(entry)
    
    return {
        "message": f"Learned about '{request.topic}' from {len(entries)} sources",
        "entries": entries
    }

@router.get("/knowledge")
async def list_knowledge():
    """List all knowledge base entries"""
    all_entries = []
    for filename in os.listdir(_KB_DIR):
        if not filename.endswith(".json"):
            continue
        filepath = os.path.join(_KB_DIR, filename)
        try:
            with open(filepath, "r") as f:
                entries = json.load(f)
            all_entries.extend(entries)
        except Exception:
            continue
    return {"entries": all_entries, "count": len(all_entries)}

@router.get("/knowledge/{topic}")
async def get_knowledge_by_topic(topic: str):
    """Get knowledge for a specific topic"""
    entries = get_knowledge(topic)
    return {"topic": topic, "entries": entries, "count": len(entries)}

@router.delete("/knowledge/{topic}")
async def delete_knowledge(topic: str):
    """Delete knowledge for a topic"""
    path = _kb_path(topic)
    if os.path.exists(path):
        os.remove(path)
        return {"message": f"Deleted knowledge for '{topic}'"}
    return {"message": f"No knowledge found for '{topic}'"}
