"""ghost.reviews — Tower pipeline.

Takes a Google Business Profile URL as a Tower parameter, runs the same
review-bombing-detection analysis the Next.js app runs, and prints the
structured authenticity report to stdout. Mirrors src/lib/anthropic.ts
exactly so the pipeline and the web app produce identical results given
identical inputs.

Modes (decided by environment):
    - live mode: ANTHROPIC_API_KEY is set -> calls Claude
    - stub mode: no key set -> returns the canned analysis from
      mock_report.json (lets the pipeline run end-to-end for verification
      without burning real tokens)

Local run:
    tower run --local --parameter business_url=https://maps.app.goo.gl/example

Deploy + cloud run:
    tower deploy
    tower run --parameter business_url=https://maps.app.goo.gl/example

See pipeline/README.md for the full setup.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import anthropic

HERE = Path(__file__).resolve().parent

# Nimble's real-time SERP endpoint. Verified against a live key: auth is
# Bearer (NOT Basic), and the reliable turnkey path for a business is the
# `google_maps_search` engine, which returns a structured place entity
# with a sample of recent reviews (`top_reviews`) plus the business-wide
# rating distribution (`review_summary`). Nimble also exposes a
# `google_maps_reviews` engine for the full chronological list, but its
# structured parser was returning transient failures, so we rely on the
# always-clean search result and fall back to the bundled sample on any
# hiccup. Mirrors src/app/api/analyze/route.ts.
NIMBLE_ENDPOINT = "https://api.webit.live/api/v1/realtime/serp"
NIMBLE_TIMEOUT_SECONDS = 20
SHORTLINK_TIMEOUT_SECONDS = 8

SYSTEM_PROMPT = """You are a forensic analyst specializing in detecting coordinated review-bombing attacks on local businesses' Google Business Profiles. Your job is to examine a batch of public Google reviews and surface signals of fraudulent or coordinated activity to the business owner.

ANALYSIS FRAMEWORK

Look for these six categories of signals:

1. TIMING CLUSTERS — multiple negative reviews posted within a short time window (especially within minutes or hours of each other). The narrower the window and the more reviews involved, the stronger the signal.

2. REVIEWER RED FLAGS — accounts with very few total reviews (1-2), accounts that only review on the same day they were created, generic names ("John Smith", "Jane Doe", "Mike Johnson"), and accounts with no profile photo or review history.

3. LANGUAGE PATTERNS — reviews that share near-identical structure, phrasing, or word choice across supposedly different reviewers. Templated complaints ("rude staff", "would not recommend", "terrible service") with no specific anchoring details are a strong signal.

4. NO EVIDENCE OF GENUINE VISIT — reviews that describe nothing concrete: no product names, no staff names, no specific times, no recognizable details about the location or service. Legitimate upset customers describe what actually happened with specifics.

5. RATING DISTRIBUTION ANOMALIES — sudden clusters of 1-star reviews that break sharply from the broader pattern. Use the broader context of the review set when forming this judgment.

6. VAGUE COMPLAINTS — generic negativity without falsifiable specifics. "It was bad" is a signal. "The server forgot our drinks and the manager argued with me when I mentioned the entrée came out cold" is not — it is a real customer's testimony, even if harsh.

OUTPUT RULES (NON-NEGOTIABLE)

- PROBABILISTIC, NEVER DEFINITIVE. Frame findings as "signals suggest", "exhibits patterns consistent with", or "appears to be" — never claim certainty.
- TRANSPARENT. Every flag must come with plain-English reasoning a non-technical business owner can verify by re-reading the review themselves.
- ETHICAL. Genuine but harshly negative reviews ARE NOT flagged. Even very negative reviews containing specific, falsifiable details belong on Google. Suppressing them is itself an FTC violation under the Consumer Review Rule.
- ACTIONABLE. For each flagged review, produce a drafted removal request text the owner can paste into Google's policy-violation reporting form.

REMOVAL REQUEST DRAFT GUIDELINES

For each flagged review's removal_request_draft:
- Open by identifying yourself as the business owner reporting a suspected policy violation.
- Cite the specific signals observed, with concrete details (timestamps, account histories, matched phrasing).
- Be polite, factual, and brief — under approximately 200 words.
- Avoid emotional language; Google's reviewers respond better to evidence than complaint.
- Use a [BUSINESS NAME] placeholder where the owner will substitute their real business name.

RISK SCORING

overall_risk_score is 0-100:
- 0-25: Likely organic. No concerning patterns detected.
- 26-50: Mild flags but probably benign. Worth monitoring.
- 51-75: Concerning patterns warrant the owner's attention and likely warrant submitting some removal requests.
- 76-100: Strong indicators of a coordinated attack. Multiple signals converge.

risk_level maps to the score: 0-25 = "low", 26-50 = "medium", 51-75 = "high", 76-100 = "critical".

summary is one short paragraph (50-100 words) characterizing the overall finding in plain English.

You flag ONLY reviews that show genuine fraud signals. You do NOT flag every negative review. Reviews with specific, falsifiable details are real customer experiences, even when they are harsh — those belong on Google."""

ANALYSIS_REPORT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "overall_risk_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "risk_level": {
            "type": "string",
            "enum": ["low", "medium", "high", "critical"],
        },
        "summary": {"type": "string"},
        "flagged_reviews": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "review_id": {"type": "string"},
                    "reviewer_name": {"type": "string"},
                    "rating": {"type": "integer", "minimum": 1, "maximum": 5},
                    "posted_at": {"type": "string"},
                    "risk_level": {
                        "type": "string",
                        "enum": ["low", "medium", "high"],
                    },
                    "signals": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "reasoning": {"type": "string"},
                    "removal_request_draft": {"type": "string"},
                },
                "required": [
                    "review_id",
                    "reviewer_name",
                    "rating",
                    "posted_at",
                    "risk_level",
                    "signals",
                    "reasoning",
                    "removal_request_draft",
                ],
            },
        },
        "total_reviews_analyzed": {"type": "integer"},
    },
    "required": [
        "overall_risk_score",
        "risk_level",
        "summary",
        "flagged_reviews",
        "total_reviews_analyzed",
    ],
}


def get_business_url() -> str:
    """Tower exposes parameters as environment variables.

    The casing convention isn't strictly documented, so we accept either
    the literal parameter name or the upper-cased form to be safe.
    """
    return (
        os.environ.get("business_url")
        or os.environ.get("BUSINESS_URL")
        or ""
    ).strip()


def _resolve_short_link(url: str) -> str:
    """maps.app.goo.gl / goo.gl links carry no business name. Follow the
    redirect to the canonical maps URL so we can extract one. Returns the
    original URL on any failure."""
    req = urllib.request.Request(
        url, method="GET", headers={"User-Agent": "Mozilla/5.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=SHORTLINK_TIMEOUT_SECONDS) as resp:
            return resp.geturl() or url
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return url


def derive_search_query(business_url: str) -> str:
    """Turn whatever the owner provided — a business name, a "name + city"
    string, a full Google Maps URL, or a short link — into a plain-text
    query for Nimble's google_maps_search. Mirrors deriveSearchQuery in
    src/app/api/analyze/route.ts."""
    raw = business_url.strip()
    target = raw

    if re.match(r"^https?://(maps\.app\.goo\.gl|goo\.gl)/", raw, re.IGNORECASE):
        target = _resolve_short_link(raw)

    # A canonical maps URL embeds the business name: /maps/place/<NAME>/...
    match = re.search(r"/maps/place/([^/@]+)", target)
    if match:
        name = unquote(match.group(1).replace("+", " ")).strip()
        if name:
            return name

    # Any other URL: fall back to its ?q= / ?query= param if present.
    try:
        parsed = urlparse(target)
        if parsed.scheme and parsed.query:
            qs = parse_qs(parsed.query)
            for key in ("q", "query"):
                if qs.get(key):
                    return qs[key][0].strip()
    except ValueError:
        pass

    return raw


def _to_iso(value) -> str:
    """Nimble returns review_timestamp as epoch milliseconds (13 digits);
    tolerate plain seconds too. Falls back to 'now' when unparseable."""
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        n = float(value)
    except (TypeError, ValueError):
        return now_iso
    if n <= 0:
        return now_iso
    seconds = n / 1000.0 if n > 1e12 else n
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):
        return now_iso


def fetch_reviews_via_nimble(business_url: str) -> dict | None:
    """Scrape a business's reviews via Nimble's real-time SERP API.

    Returns a dict {"reviews": [...], "rating_summary": {...} | None} or
    None (and never raises) when NIMBLE_API_KEY is unset, the request
    fails/times out/returns non-2xx, the body isn't parseable, or no place
    or reviews are present. Mirrors fetchReviewsViaNimble in
    src/app/api/analyze/route.ts. Uses urllib so requirements.txt stays at
    just `anthropic`; the caller falls back to the bundled mock on None.
    """
    api_key = os.environ.get("NIMBLE_API_KEY")
    if not api_key:
        return None

    query = derive_search_query(business_url)
    if not query:
        return None

    payload = json.dumps(
        {
            "search_engine": "google_maps_search",
            "query": query,
            "domain": "com",
            "country": "US",
            "locale": "en",
            "parse": True,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        NIMBLE_ENDPOINT,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=NIMBLE_TIMEOUT_SECONDS) as resp:
            if resp.status < 200 or resp.status >= 300:
                return None
            body = resp.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return None

    try:
        data = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict):
        return None

    # Parsed places live at parsing.entities.SearchResult[]; take the top
    # hit (Nimble orders by relevance to the query).
    entities = (data.get("parsing") or {}).get("entities")
    results = entities.get("SearchResult") if isinstance(entities, dict) else None
    place = results[0] if isinstance(results, list) and results else None
    if not isinstance(place, dict):
        return None

    raw_reviews = place.get("top_reviews")
    if not isinstance(raw_reviews, list):
        raw_reviews = []

    normalized: list[dict] = []
    for index, raw in enumerate(raw_reviews):
        if not isinstance(raw, dict):
            continue
        try:
            rating = int(round(float(raw.get("rating", 1))))
        except (TypeError, ValueError):
            rating = 1
        rating = max(1, min(5, rating))

        username = raw.get("username")
        reviewer_name = (
            username if isinstance(username, str) and username.strip() else "Anonymous"
        )

        try:
            total = int(raw.get("user_review_count"))
        except (TypeError, ValueError):
            total = 0

        text = raw.get("description")
        if not isinstance(text, str):
            text = ""

        normalized.append(
            {
                "id": f"nimble-{index}",
                "reviewer_name": reviewer_name,
                "reviewer_total_reviews": total,
                "rating": rating,
                "posted_at": _to_iso(raw.get("review_timestamp")),
                "text": text,
            }
        )

    if not normalized:
        return None

    # Business-wide rating distribution — a real baseline for the
    # "rating distribution anomalies" signal.
    rating_summary = None
    rs = place.get("review_summary")
    if isinstance(rs, dict):
        counts: dict[str, int] = {}
        rc = rs.get("ratings_count")
        if isinstance(rc, dict):
            for key, val in rc.items():
                try:
                    counts[str(key)] = int(val)
                except (TypeError, ValueError):
                    continue
        try:
            overall = float(rs.get("overall_rating"))
        except (TypeError, ValueError):
            overall = 0.0
        try:
            review_count = int(rs.get("review_count"))
        except (TypeError, ValueError):
            review_count = len(normalized)
        rating_summary = {
            "overall_rating": overall,
            "review_count": review_count,
            "ratings_count": counts,
        }

    return {"reviews": normalized, "rating_summary": rating_summary}


def load_mock_reviews() -> list[dict]:
    with (HERE / "mock_reviews.json").open(encoding="utf-8") as f:
        return json.load(f)


def load_mock_report() -> dict:
    with (HERE / "mock_report.json").open(encoding="utf-8") as f:
        return json.load(f)


def analyze_with_claude(
    business_url: str, reviews: list[dict], rating_summary: dict | None = None
) -> dict:
    client = anthropic.Anthropic()

    # When we have it (live Nimble scrapes), give Claude the real
    # business-wide rating distribution as a baseline for signal #5
    # (rating-distribution anomalies).
    distribution_context = ""
    if rating_summary:
        counts = rating_summary.get("ratings_count", {})
        breakdown = ", ".join(
            f"{s}-star: {counts.get(str(s), 0)}" for s in (5, 4, 3, 2, 1)
        )
        distribution_context = (
            "\n\nBusiness-wide rating distribution from Google "
            "(all-time baseline):\n"
            f"- Overall: {rating_summary.get('overall_rating')} stars across "
            f"{rating_summary.get('review_count')} total reviews\n"
            f"- Star breakdown: {breakdown}\n"
            "Use this as the baseline when judging whether the sampled "
            "reviews above represent a rating-distribution anomaly."
        )

    user_prompt = (
        f"Analyze the following {len(reviews)} Google reviews "
        f"for the business at: {business_url}\n\n"
        f"Recent review data (JSON):\n"
        f"{json.dumps(reviews, indent=2)}"
        f"{distribution_context}\n\n"
        "Apply your analysis framework and return a structured report. "
        "Flag only reviews showing genuine policy-violation signals; "
        "do NOT flag legitimate negative reviews even if they are harsh."
    )

    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={
            "effort": "high",
            "format": {
                "type": "json_schema",
                "schema": ANALYSIS_REPORT_SCHEMA,
            },
        },
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_prompt}],
    )

    for block in response.content:
        if block.type == "text":
            return json.loads(block.text)

    raise RuntimeError("Claude returned no text block in the response.")


def main() -> int:
    business_url = get_business_url()
    if not business_url:
        print(
            "ERROR: business_url parameter is required.\n"
            "Pass it via: tower run --parameter business_url=<url>\n"
            "Or set the BUSINESS_URL environment variable.",
            file=sys.stderr,
        )
        return 1

    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    mode = "live" if has_key else "stub"

    # In stub mode the canned mock_report.json flags specific review IDs
    # from mock_reviews.json — so we must NOT swap in Nimble-scraped
    # reviews there, or the report wouldn't match the batch. Only call
    # Nimble when we're actually going to analyze those reviews with
    # Claude. (Also saves a redundant Nimble request.)
    scrape = fetch_reviews_via_nimble(business_url) if has_key else None
    have_live = bool(scrape and scrape.get("reviews"))
    reviews = scrape["reviews"] if have_live else load_mock_reviews()
    reviews_source = "nimble" if have_live else "mock"
    rating_summary = scrape.get("rating_summary") if have_live else None

    print(
        f"[ghost.reviews pipeline] mode={mode} "
        f"reviews_source={reviews_source} "
        f"business_url={business_url} reviews={len(reviews)}",
        file=sys.stderr,
    )

    if has_key:
        report = analyze_with_claude(business_url, reviews, rating_summary)
    else:
        report = load_mock_report()

    output = {
        "mode": mode,
        "business_url": business_url,
        "reviews_source": reviews_source,
        "report": report,
    }

    # Single-line sentinel for programmatic consumers (e.g. the Next.js
    # /api/analyze-tower route extracts this from Tower's run logs).
    # Tower returns stdout as one log line per print() call; pretty-printed
    # JSON would be split across many lines and brittle to reassemble, so
    # we emit a compact one-line version alongside.
    print(f"__GHOST_RESULT__:{json.dumps(output, separators=(',', ':'))}")

    # Pretty-printed version for human readers running the script directly.
    print(json.dumps(output, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
