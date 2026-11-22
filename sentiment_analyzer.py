"""
sentiment_analyzer.py — News / NLP sentiment analysis for the third fusion pillar.

Pulls news articles from yfinance and scores them using:
  1. VADER (primary) — robust rule-based sentiment for financial/social text
  2. Keyword lexicon (fallback) — domain-tuned financial word lists
  3. Aggregation — weighted average across recent articles with time decay

Output: sentiment_score in [-1.0 (bearish), 0.0 (neutral), +1.0 (bullish)]
"""

import logging
import re
import math
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any, Tuple
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

# ── Financial sentiment lexicon (domain-tuned) ──

BULLISH_WORDS = {
    # Earnings / Financial
    'beat', 'exceed', 'surge', 'soar', 'rally', 'boom', 'outperform',
    'upgrade', 'positive', 'growth', 'profit', 'record', 'strong',
    'bullish', 'optimistic', 'confidence', 'momentum', 'expansion',
    'breakout', 'accumulate', 'overweight', 'buy', 'outperform',
    'dividend', 'buyback', 'upgraded', 'raised', 'guidance',
    'robust', 'stellar', 'impressive', 'accelerate', 'turnaround',
    # Deal / M&A
    'merger', 'acquisition', 'partnership', 'alliance', 'approval',
    'clearance', 'greenlight', 'ipo', 'listing',
    # Macro tailwind
    'rate cut', 'stimulus', 'rebound', 'recovery', 'upward',
}

BEARISH_WORDS = {
    # Earnings / Financial
    'miss', 'decline', 'drop', 'fall', 'plunge', 'crash', 'slump',
    'downgrade', 'negative', 'loss', 'debt', 'default', 'bankruptcy',
    'bearish', 'pessimistic', 'uncertainty', 'volatility', 'slowdown',
    'breakdown', 'distribution', 'underweight', 'reduce', 'sell',
    'downgraded', 'cut', 'warning', 'investigation',
    'weak', 'poor', 'disappointing', 'deteriorate', 'shrink',
    # Regulatory / Legal
    'penalty', 'fine', 'lawsuit', 'probe', 'scrutiny', 'regulation',
    'restriction', 'ban', 'sanction',
    # Macro headwind
    'rate hike', 'inflation', 'recession', 'contraction', 'crisis',
    'downturn', 'stagnation', 'layoff', 'firing',
}

# Negation words flip sentiment
NEGATION_WORDS = {'not', 'no', 'never', 'neither', 'nor', 'cannot',
                   "don't", "doesn't", "didn't", "won't", "wouldn't",
                   "shouldn't", "couldn't", "isn't", "aren't", "wasn't",
                   "weren't", "hasn't", "haven't", "hadn't"}

# Intensifiers multiply sentiment
INTENSIFIERS = {'very': 1.5, 'extremely': 2.0, 'highly': 1.8, 'strongly': 1.6,
                'significantly': 1.7, 'dramatically': 1.8, 'remarkably': 1.5,
                'notably': 1.3, 'particularly': 1.2}


@dataclass
class SentimentResult:
    """Aggregated sentiment for a ticker."""
    ticker: str
    score: float                    # -1.0 to +1.0
    label: str                      # Bullish / Neutral / Bearish
    article_count: int
    source: str                     # 'vader' or 'lexicon'
    top_articles: List[Dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0         # 0-100 based on article count & score magnitude


class SentimentAnalyzer:
    """Analyse news sentiment for a given ticker."""

    def __init__(self, ticker: str, max_articles: int = 10,
                 decay_days: float = 7.0, use_vader: bool = True):
        self.ticker = ticker.upper()
        self.max_articles = max_articles
        self.decay_days = decay_days
        self.use_vader = use_vader
        self._vader_available = False

        if use_vader:
            self._vader_available = self._check_vader()

    @staticmethod
    def _check_vader() -> bool:
        """Test if VADER is available."""
        try:
            from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
            return True
        except ImportError:
            try:
                from nltk.sentiment.vader import SentimentIntensityAnalyzer
                return True
            except ImportError:
                try:
                    import nltk
                    nltk.data.find('sentiment/vader_lexicon.zip')
                    from nltk.sentiment.vader import SentimentIntensityAnalyzer
                    return True
                except (ImportError, LookupError):
                    log.info("VADER not available, using lexicon-based sentiment")
                    return False

    # ── Fetch news ──

    def fetch_news(self) -> List[Dict[str, Any]]:
        """Fetch recent news articles via yfinance."""
        import yfinance as yf
        try:
            t = yf.Ticker(self.ticker)
            news = t.news if hasattr(t, 'news') else []
            if not news:
                # Fallback: try fetching from info
                info = t.info
                news = info.get('news', []) if isinstance(info, dict) else []
        except Exception as e:
            log.warning(f"Failed to fetch news for {self.ticker}: {e}")
            return []

        # Normalise news items
        articles = []
        for item in (news or []):
            if isinstance(item, dict):
                title = item.get('title', '') or item.get('headline', '') or ''
                summary = item.get('summary', '') or item.get('description', '') or ''
                link = item.get('link', '') or item.get('url', '') or ''
                published = item.get('providerPublishTime', None) or item.get('pubDate', None)

                # Combine title + summary for analysis
                text = f"{title}. {summary}".strip()

                if text and len(text) > 20:
                    articles.append({
                        'title': title,
                        'text': text,
                        'link': link,
                        'published': published,
                        'age_days': self._age_days(published),
                    })

        # Sort by recency, limit
        articles.sort(key=lambda a: a.get('age_days', 999))
        return articles[:self.max_articles]

    @staticmethod
    def _age_days(published) -> float:
        """Calculate age of article in days."""
        if published is None:
            return 999.0
        try:
            if isinstance(published, (int, float)):
                pub_date = datetime.fromtimestamp(published)
            elif isinstance(published, str):
                pub_date = datetime.fromisoformat(published.replace('Z', '+00:00'))
            else:
                return 999.0
            return (datetime.now() - pub_date).total_seconds() / 86400.0
        except Exception:
            return 999.0

    # ── Sentiment Scoring ──

    def _score_vader(self, text: str) -> float:
        """Score text using VADER."""
        try:
            from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
            sia = SentimentIntensityAnalyzer()
            return sia.polarity_scores(text)['compound']
        except ImportError:
            pass
        try:
            from nltk.sentiment.vader import SentimentIntensityAnalyzer
            sia = SentimentIntensityAnalyzer()
            return sia.polarity_scores(text)['compound']
        except ImportError:
            self._vader_available = False
            return 0.0

    def _score_lexicon(self, text: str) -> float:
        """Score text using financial keyword lexicon."""
        text_lower = text.lower()
        words = re.findall(r'\b[a-z]+\b', text_lower)

        # Look for multi-word phrases first
        bigrams = [f"{words[i]} {words[i+1]}" for i in range(len(words)-1)]
        trigrams = [f"{words[i]} {words[i+1]} {words[i+2]}" for i in range(len(words)-2)]

        score = 0.0
        match_count = 0
        negation_active = False

        for i, word in enumerate(words):
            # Check negation
            if word in NEGATION_WORDS:
                negation_active = True
                continue

            # Check intensifier
            intensifier = INTENSIFIERS.get(word, 1.0)

            # Check bullish
            if word in BULLISH_WORDS:
                val = 0.3 * intensifier
                if negation_active:
                    val = -val
                    negation_active = False
                score += val
                match_count += 1

            # Check bearish
            if word in BEARISH_WORDS:
                val = -0.3 * intensifier
                if negation_active:
                    val = -val
                    negation_active = False
                score += val
                match_count += 1

        # Check bigrams/trigrams for multi-word patterns
        for bg in bigrams:
            if bg in BULLISH_WORDS or bg in BEARISH_WORDS:
                val = 0.5 if bg in BULLISH_WORDS else -0.5
                score += val
                match_count += 1

        for tg in trigrams:
            if tg in BULLISH_WORDS or tg in BEARISH_WORDS:
                val = 0.7 if tg in BULLISH_WORDS else -0.7
                score += val
                match_count += 1

        # Normalise to [-1, 1]
        if match_count > 0:
            score = max(-1.0, min(1.0, score / (match_count ** 0.5)))
        else:
            score = 0.0  # neutral

        return score

    def score_text(self, text: str) -> float:
        """Score a single article's text."""
        if self._vader_available:
            return self._score_vader(text)
        return self._score_lexicon(text)

    # ── Aggregate ──

    def analyze(self, news_articles: Optional[List[Dict]] = None) -> SentimentResult:
        """Full sentiment analysis: fetch, score, aggregate."""
        articles = news_articles if news_articles is not None else self.fetch_news()

        if not articles:
            return SentimentResult(
                ticker=self.ticker, score=0.0, label='Neutral',
                article_count=0, source='vader' if self._vader_available else 'lexicon',
                confidence=0.0,
            )

        scored_articles = []
        total_weight = 0.0
        weighted_score = 0.0

        for article in articles:
            text = article['text']
            article_score = self.score_text(text)
            age = article.get('age_days', 7)

            # Time decay weight: recent articles matter more
            # Weight = 1.0 for today, ~0.5 at decay_days, ~0.1 at 3x decay_days
            weight = math.exp(-age / self.decay_days)
            weight = max(0.05, min(1.0, weight))

            # Magnitude weight: stronger sentiment carries more weight
            magnitude_weight = 1.0 + abs(article_score) * 0.5

            w = weight * magnitude_weight
            weighted_score += article_score * w
            total_weight += w

            scored_articles.append({
                'title': article.get('title', '')[:120],
                'score': round(article_score, 3),
                'weight': round(w, 3),
            })

        final_score = weighted_score / total_weight if total_weight > 0 else 0.0
        final_score = max(-1.0, min(1.0, final_score))

        # Label
        if final_score >= 0.35:
            label = 'Bullish'
        elif final_score <= -0.35:
            label = 'Bearish'
        else:
            label = 'Neutral'

        # Confidence: based on article count and score magnitude
        article_confidence = min(100, len(articles) * 15)
        magnitude_confidence = min(50, abs(final_score) * 100)
        confidence = round((article_confidence + magnitude_confidence) / 2, 1)

        return SentimentResult(
            ticker=self.ticker,
            score=round(final_score, 3),
            label=label,
            article_count=len(articles),
            source='vader' if self._vader_available else 'lexicon',
            top_articles=scored_articles[:5],
            confidence=confidence,
        )


# ── Integration helper for quantamental fusion ──

def sentiment_weight_adjustment(sentiment: SentimentResult,
                                 base_weights: Dict[str, float]) -> Dict[str, float]:
    """Adjust quantamental weights based on sentiment.

    Strong sentiment shifts weight from the weakest pillar to sentiment.
    """
    weights = dict(base_weights)
    score = sentiment.score
    conf = sentiment.confidence / 100.0

    if abs(score) < 0.2 or conf < 0.3:
        return weights  # No adjustment for weak/neutral sentiment

    # Shift 5-15% weight toward sentiment based on confidence
    shift = min(0.15, max(0.05, abs(score) * conf * 0.2))

    if score > 0:
        # Bullish: take from fundamental weight (more stable, less reactive)
        key = 'fundamental'
    else:
        # Bearish: take from technical weight (more reactive)
        key = 'technical'

    if key in weights and weights[key] - shift >= 0.2:
        weights[key] -= shift
        weights['sentiment'] = weights.get('sentiment', 0) + shift

    # Re-normalise
    total = sum(weights.values())
    if total > 0:
        for k in weights:
            weights[k] /= total

    return weights


def sentiment_adjustment_label(adjustments: list, sentiment: SentimentResult) -> list:
    """Add sentiment-based adjustment description."""
    if abs(sentiment.score) >= 0.35 and sentiment.confidence >= 40:
        adj = f"{sentiment.label} sentiment ({sentiment.score:+.2f}) — {sentiment.article_count} articles"
        if sentiment.score > 0:
            adj += " → +5% sentiment weight"
        else:
            adj += " → +5% sentiment weight"
        adjustments.append(adj)
    return adjustments


# ── Quick test ──
if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    sa = SentimentAnalyzer('AAPL')
    result = sa.analyze()
    print(f"Ticker: {result.ticker}")
    print(f"Score:  {result.score:+.3f}")
    print(f"Label:  {result.label}")
    print(f"Articles: {result.article_count} | Confidence: {result.confidence}%")
    print(f"Source: {result.source}")
    for a in result.top_articles[:3]:
        print(f"  - {a['title']} ({a['score']:+.3f})")
