"""BM25 tests — tokenisation and retrieval sanity."""

from __future__ import annotations

from aiops.learning.bm25 import BM25Index, tokenize


def test_tokenize():
    """Lowercase, strip punctuation, keep alphanumeric tokens."""
    assert tokenize("Hello, World! 123") == ["hello", "world", "123"]
    assert tokenize("") == []


def test_retrieval_sanity():
    """A document that matches the query ranks above irrelevant documents."""
    docs = [
        "Nifty broke above resistance with high volume and strong momentum",
        "Banking stocks rallied on strong quarterly earnings report",
        "The weather in Mumbai is rainy and humid today",
    ]
    idx = BM25Index(docs)
    top = idx.top("Nifty resistance breakout momentum", k=3)
    # Doc 0 contains the most query terms; doc 2 should rank last.
    assert top[0][0] == 0, "doc 0 (Nifty/resistance/momentum) must rank first"
    assert top[-1][0] == 2, "doc 2 (weather) must rank last"


def test_empty_docs():
    """An empty index returns an empty result."""
    idx = BM25Index([])
    assert idx.top("anything", k=5) == []
    assert idx.score("anything") == []


def test_single_doc():
    """Single document always ranks first."""
    idx = BM25Index(["alpha beta gamma"])
    top = idx.top("alpha", k=1)
    assert top == [(0, top[0][1])]
    assert top[0][1] > 0