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
import sys
import urllib.error
import urllib.request
from pathlib import Path

import anthropic

HERE = Path(__file__).resolve().parent

# Nimble's structured Google-reviews scrape (v1 SERP surface). We send a
# small JSON body asking for the `google_maps_reviews` parser and trust
# Nimble to deliver a structured payload. Nimble's standard auth is
# Bearer; the endpoint URL and payload shape are best-effort against
# their docs and may need adjustment once we exercise against a real key.
NIMBLE_ENDPOINT = "https://api.webit.live/api/v1/realtime/serp"
NIMBLE_TIMEOUT_SECONDS = 6

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


def fetch_reviews_via_nimble(business_url: str) -> list[dict] | None:
    """Pull recent Google reviews for the given business URL via Nimble.

    Mirrors the gating semantics of `fetchReviewsViaNimble` in
    src/app/api/analyze/route.ts. Returns None (and never raises) when:
        - NIMBLE_API_KEY is unset
        - the HTTP request times out
        - the upstream returns non-2xx
        - the response body cannot be parsed as JSON
        - the response shape doesn't contain a usable review list

    Uses urllib so we don't take on a new dependency (requirements.txt
    stays at just `anthropic`). The caller falls back to the bundled
    mock reviews on None.
    """
    api_key = os.environ.get("NIMBLE_API_KEY")
    if not api_key:
        return None

    payload = json.dumps(
        {
            "url": business_url,
            "parser": "google_maps_reviews",
            "country": "US",
            "locale": "en",
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        NIMBLE_ENDPOINT,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            # Nimble's standard auth is Bearer; may be refined when we
            # exercise it against a real key.
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

    # Same hierarchy of likely locations as the TS side.
    candidates: list[list] = []
    if isinstance(data.get("reviews"), list):
        candidates.append(data["reviews"])
    parsing = data.get("parsing")
    if isinstance(parsing, dict):
        if isinstance(parsing.get("entities"), list):
            candidates.append(parsing["entities"])
        if isinstance(parsing.get("reviews"), list):
            candidates.append(parsing["reviews"])
    inner = data.get("data")
    if isinstance(inner, dict) and isinstance(inner.get("reviews"), list):
        candidates.append(inner["reviews"])

    raw_reviews = next((c for c in candidates if c), None)
    if not raw_reviews:
        return None

    from datetime import datetime, timezone

    now_iso = datetime.now(timezone.utc).isoformat()
    normalized: list[dict] = []
    for index, raw in enumerate(raw_reviews):
        if not isinstance(raw, dict):
            raw = {}
        rating_raw = raw.get("rating", raw.get("stars", 1))
        try:
            rating = int(round(float(rating_raw)))
        except (TypeError, ValueError):
            rating = 1
        rating = max(1, min(5, rating))

        # Nimble sometimes returns the reviewer as a string field and
        # sometimes as a nested {"name": "..."} object. Cover both shapes.
        author_obj = raw.get("author") if isinstance(raw.get("author"), dict) else {}
        reviewer_obj = raw.get("reviewer") if isinstance(raw.get("reviewer"), dict) else {}
        reviewer_name = (
            raw.get("reviewer_name")
            or (raw.get("author") if isinstance(raw.get("author"), str) else None)
            or raw.get("name")
            or (author_obj or {}).get("name")
            or (reviewer_obj or {}).get("name")
            or "Anonymous"
        )
        if not isinstance(reviewer_name, str):
            reviewer_name = "Anonymous"

        total = raw.get("reviewer_total_reviews")
        if not isinstance(total, int):
            total = raw.get("author_reviews_count")
        if not isinstance(total, int):
            total = 0

        posted_at = (
            raw.get("posted_at")
            or raw.get("date")
            or raw.get("published_at")
            or now_iso
        )
        if not isinstance(posted_at, str):
            posted_at = now_iso

        text = raw.get("text") or raw.get("snippet") or raw.get("review") or ""
        if not isinstance(text, str):
            text = ""

        normalized.append(
            {
                "id": f"nimble-{index}",
                "reviewer_name": reviewer_name,
                "reviewer_total_reviews": total,
                "rating": rating,
                "posted_at": posted_at,
                "text": text,
            }
        )

    return normalized if normalized else None


def load_mock_reviews() -> list[dict]:
    with (HERE / "mock_reviews.json").open(encoding="utf-8") as f:
        return json.load(f)


def load_mock_report() -> dict:
    with (HERE / "mock_report.json").open(encoding="utf-8") as f:
        return json.load(f)


def analyze_with_claude(business_url: str, reviews: list[dict]) -> dict:
    client = anthropic.Anthropic()

    user_prompt = (
        f"Analyze the following {len(reviews)} Google reviews "
        f"for the business at: {business_url}\n\n"
        f"Recent review data (JSON):\n"
        f"{json.dumps(reviews, indent=2)}\n\n"
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
    live_reviews = fetch_reviews_via_nimble(business_url) if has_key else None
    reviews = live_reviews if live_reviews is not None else load_mock_reviews()
    reviews_source = "nimble" if live_reviews is not None else "mock"

    print(
        f"[ghost.reviews pipeline] mode={mode} "
        f"reviews_source={reviews_source} "
        f"business_url={business_url} reviews={len(reviews)}",
        file=sys.stderr,
    )

    if has_key:
        report = analyze_with_claude(business_url, reviews)
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
