"""Pure-Python BM25 retrieval (no external dependencies).

Standard Okapi BM25 with k1=1.5, b=0.75. Tokenization is deliberately simple:
lowercase, strip punctuation, keep alphanumeric word tokens.
"""

from __future__ import annotations

import math
import re
from collections import Counter

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    """Lowercase, strip punctuation, return simple word tokens."""
    return _TOKEN_RE.findall(str(text).lower())


class BM25Index:
    """BM25 index over a list of documents."""

    def __init__(self, docs: list[str], k1: float = 1.5, b: float = 0.75):
        self.docs = [tokenize(d) for d in docs]
        self.k1 = k1
        self.b = b
        self.n_docs = len(self.docs)
        self.avgdl = (
            sum(len(d) for d in self.docs) / self.n_docs if self.n_docs else 0.0
        )
        self.df: Counter[str] = Counter()
        for d in self.docs:
            for t in set(d):
                self.df[t] += 1
        self.idf: dict[str, float] = {}
        for t, df in self.df.items():
            self.idf[t] = math.log(1.0 + (self.n_docs - df + 0.5) / (df + 0.5))

    def score(self, query: str) -> list[float]:
        """BM25 score of ``query`` against every document (same order as docs)."""
        q = tokenize(query)
        scores: list[float] = []
        for doc in self.docs:
            dl = len(doc)
            tf = Counter(doc)
            s = 0.0
            for t in q:
                if t in self.idf and t in tf:
                    f = tf[t]
                    if self.avgdl:
                        denom = f + self.k1 * (
                            1.0 - self.b + self.b * dl / self.avgdl
                        )
                    else:
                        denom = f + self.k1
                    s += self.idf[t] * (f * (self.k1 + 1.0)) / denom
            scores.append(s)
        return scores

    def top(self, query: str, k: int = 5) -> list[tuple[int, float]]:
        """Return the top-k ``(doc_index, score)`` pairs, best first."""
        if not self.docs:
            return []
        scores = self.score(query)
        ranked = sorted(range(len(self.docs)), key=lambda i: scores[i], reverse=True)
        return [(i, scores[i]) for i in ranked[:k]]