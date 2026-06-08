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
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import anthropic

HERE = Path(__file__).resolve().parent

# Nimble endpoints. Verified against a live key:
#   - Auth is Bearer (Basic returns 401).
#   - `google_maps_search` (realtime SERP) returns a structured place with
#     the rating distribution and a small review sample.
#   - `google_maps_reviews` returns the real review stream; Nimble's
#     structured parser for it is broken, but the raw Google payload is in
#     `html_content` and the underlying listugcposts URL is in `input_url`.
#     We parse the raw payload ourselves and paginate by injecting Google's
#     "next page" token into the URL, fetched via Nimble's web unblocker
#     (/v1/extract). `sort: "newest"` gives a chronological stream.
# Mirrors src/lib/nimble.ts.
NIMBLE_ENDPOINT = "https://api.webit.live/api/v1/realtime/serp"
NIMBLE_EXTRACT_ENDPOINT = "https://sdk.nimbleway.com/v1/extract"
NIMBLE_TIMEOUT_SECONDS = 20
SHORTLINK_TIMEOUT_SECONDS = 8
# Default depth for the pipeline's initial "assess hundreds" scan.
DEFAULT_MAX_REVIEWS = 200

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


def get_max_reviews() -> int:
    """How deep to scan. The initial onboarding scan wants hundreds; an
    ongoing incremental scan can pass a smaller number."""
    raw = (os.environ.get("max_reviews") or os.environ.get("MAX_REVIEWS") or "").strip()
    if not raw:
        return DEFAULT_MAX_REVIEWS
    try:
        return max(1, int(raw))
    except ValueError:
        return DEFAULT_MAX_REVIEWS


def get_since_ms() -> float | None:
    """Optional `since` parameter (ISO date/datetime). When set, only
    reviews newer than this are scraped and analyzed — the mechanism behind
    cheap, ongoing incremental scans that look only at what's new."""
    raw = (os.environ.get("since") or os.environ.get("SINCE") or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp() * 1000


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
    """Convert a Google/Nimble timestamp to ISO 8601. Google review
    timestamps are epoch microseconds (16 digits); tolerate milliseconds
    (13) and seconds (10) too. Falls back to 'now' when unparseable."""
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        n = float(value)
    except (TypeError, ValueError):
        return now_iso
    if n <= 0:
        return now_iso
    if n > 1e15:
        seconds = n / 1_000_000.0
    elif n > 1e12:
        seconds = n / 1000.0
    else:
        seconds = n
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):
        return now_iso


def _with_retry(fn, attempts: int = 2, delay: float = 0.6):
    """Call fn() until it returns a truthy value, up to `attempts` times.
    Nimble's live-scraping endpoints occasionally return a transient empty
    result; a quick retry reliably gets the page on the next try."""
    result = None
    for i in range(attempts):
        result = fn()
        if result:
            return result
        if i < attempts - 1:
            time.sleep(delay * (i + 1))
    return result


def _post_json(url: str, api_key: str, payload: dict, timeout: int = NIMBLE_TIMEOUT_SECONDS) -> dict | None:
    """POST JSON to a Nimble endpoint; return a parsed dict or None."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status < 200 or resp.status >= 300:
                return None
            body = resp.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return None
    try:
        out = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    return out if isinstance(out, dict) else None


def _dig(obj, path):
    """Safe nested getter: returns None on any miss instead of raising."""
    cur = obj
    for key in path:
        if cur is None:
            return None
        try:
            cur = cur[key]
        except (KeyError, IndexError, TypeError):
            return None
    return cur


def _parse_google_json(body):
    """Strip Google's )]}' anti-hijack prefix and json-parse the rest."""
    if not isinstance(body, str):
        return None
    idx = body.find(")]}'")
    if idx == -1:
        return None
    after = body[idx + 4:]
    nl = after.find("\n")
    payload = after if nl == -1 else after[nl + 1:]
    try:
        return json.loads(payload)
    except (ValueError, TypeError):
        return None


def _parse_reviews_page(page, start_index: int):
    """Parse one listugcposts page into (reviews, next_token). Field offsets
    verified empirically; defensive against missing or non-review rows."""
    reviews: list[dict] = []
    next_raw = _dig(page, [1])
    next_token = next_raw if isinstance(next_raw, str) and next_raw else None
    entries = _dig(page, [2])
    if isinstance(entries, list):
        for i, entry in enumerate(entries):
            R = _dig(entry, [0])
            if R is None:
                continue
            try:
                rating = int(round(float(_dig(R, [2, 0, 0]))))
            except (TypeError, ValueError):
                continue  # not a review row
            rating = max(1, min(5, rating))

            rid = _dig(R, [0])
            name = _dig(R, [1, 4, 5, 0])
            reviewer_name = name if isinstance(name, str) and name.strip() else "Anonymous"

            count = _dig(R, [1, 4, 5, 5])
            if not isinstance(count, int):
                label = _dig(R, [1, 4, 5, 10, 0])
                if isinstance(label, str):
                    m = re.search(r"([\d,]+)\s+reviews?", label, re.IGNORECASE)
                    count = int(m.group(1).replace(",", "")) if m else 0
                else:
                    count = 0

            text = _dig(R, [2, 15, 0, 0])
            if not isinstance(text, str):
                text = ""

            reviews.append(
                {
                    "id": rid if isinstance(rid, str) else f"nimble-{start_index + i}",
                    "reviewer_name": reviewer_name,
                    "reviewer_total_reviews": int(count) if isinstance(count, int) else 0,
                    "rating": rating,
                    "posted_at": _to_iso(_dig(R, [1, 2])),
                    "text": text,
                }
            )
    return reviews, next_token


def _fetch_place(api_key: str, query: str) -> dict | None:
    """google_maps_search -> {place_id, rating_summary, top_reviews}."""
    def get_place():
        payload = _post_json(
            NIMBLE_ENDPOINT,
            api_key,
            {
                "search_engine": "google_maps_search",
                "query": query,
                "domain": "com",
                "country": "US",
                "locale": "en",
                "parse": True,
            },
        )
        p = _dig(payload, ["parsing", "entities", "SearchResult", 0])
        pid = _dig(p, ["place_id"])
        return p if isinstance(pid, str) and pid else None

    place = _with_retry(get_place)
    if not place:
        return None
    place_id = place["place_id"]

    # The small, always-clean sample — fallback if the deep stream is empty.
    top_reviews: list[dict] = []
    raw_top = _dig(place, ["top_reviews"])
    if isinstance(raw_top, list):
        for i, raw in enumerate(raw_top):
            if not isinstance(raw, dict):
                continue
            try:
                rating = max(1, min(5, int(round(float(raw.get("rating", 1))))))
            except (TypeError, ValueError):
                rating = 1
            username = raw.get("username")
            try:
                total = int(raw.get("user_review_count"))
            except (TypeError, ValueError):
                total = 0
            text = raw.get("description")
            top_reviews.append(
                {
                    "id": f"nimble-top-{i}",
                    "reviewer_name": username
                    if isinstance(username, str) and username.strip()
                    else "Anonymous",
                    "reviewer_total_reviews": total,
                    "rating": rating,
                    "posted_at": _to_iso(raw.get("review_timestamp")),
                    "text": text if isinstance(text, str) else "",
                }
            )

    rating_summary = None
    rs = _dig(place, ["review_summary"])
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
            review_count = len(top_reviews)
        rating_summary = {
            "overall_rating": overall,
            "review_count": review_count,
            "ratings_count": counts,
        }

    return {
        "place_id": place_id,
        "rating_summary": rating_summary,
        "top_reviews": top_reviews,
    }


def _fetch_raw_via_extract(api_key: str, url: str) -> str | None:
    """Fetch an arbitrary URL through Nimble's web unblocker; return body.
    Retries a couple of times since extract is live-scraping and can blip."""
    def attempt():
        payload = _post_json(NIMBLE_EXTRACT_ENDPOINT, api_key, {"url": url, "render": False})
        html = _dig(payload, ["data", "html"])
        if isinstance(html, str):
            return html
        alt = _dig(payload, ["html_content"])
        return alt if isinstance(alt, str) else None

    return _with_retry(attempt)


def _fetch_reviews_deep(
    api_key: str, place_id: str, max_reviews: int, since_ms
) -> list[dict]:
    """Pull reviews newest-first, paginating until max_reviews, the stream
    ends, or we cross the `since_ms` watermark (incremental scans)."""
    def get_first():
        r = _post_json(
            NIMBLE_ENDPOINT,
            api_key,
            {
                "search_engine": "google_maps_reviews",
                "place_id": place_id,
                "domain": "com",
                "country": "US",
                "locale": "en",
                "parse": True,
                "sort": "newest",
            },
        )
        if isinstance(_dig(r, ["input_url"]), str) and isinstance(_dig(r, ["html_content"]), str):
            return r
        return None

    first = _with_retry(get_first)
    if not first:
        return []
    input_url = first["input_url"]
    raw_first = first["html_content"]

    collected: list[dict] = []
    seen: set[str] = set()

    def passes(r: dict) -> bool:
        if since_ms is None:
            return True
        try:
            return datetime.fromisoformat(r["posted_at"]).timestamp() * 1000 >= since_ms
        except (ValueError, KeyError):
            return True

    def absorb(revs: list[dict]) -> bool:
        crossed = False
        for r in revs:
            if not passes(r):
                crossed = True
                continue
            if r["id"] in seen:
                continue
            seen.add(r["id"])
            collected.append(r)
        return not crossed

    reviews, next_token = _parse_reviews_page(_parse_google_json(raw_first), 0)
    keep_going = absorb(reviews)

    can_paginate = "!2s!5m2" in input_url
    while keep_going and can_paginate and next_token and len(collected) < max_reviews:
        page_url = input_url.replace(
            "!2s!5m2", f"!2s{next_token.replace(':', '%3A')}!5m2", 1
        )
        raw = _fetch_raw_via_extract(api_key, page_url)
        if not raw:
            break
        page_reviews, page_token = _parse_reviews_page(
            _parse_google_json(raw), len(collected)
        )
        if not page_reviews:
            break
        keep_going = absorb(page_reviews)
        if not page_token or page_token == next_token:
            break
        next_token = page_token

    collected.sort(key=lambda r: r["posted_at"], reverse=True)
    return collected[:max_reviews]


def scrape_business_reviews(
    business_url: str, max_reviews: int, since_ms=None
) -> dict | None:
    """Scrape a business's reviews via Nimble (deep, newest-first).

    Returns {"reviews": [...], "rating_summary": {...} | None} or None
    (never raises) when NIMBLE_API_KEY is unset, the place can't be found,
    or no reviews come back. Mirrors scrapeBusinessReviews in
    src/lib/nimble.ts. Uses urllib so requirements.txt stays at just
    `anthropic`; the caller falls back to the bundled mock on None.
    """
    api_key = os.environ.get("NIMBLE_API_KEY")
    if not api_key:
        return None
    query = derive_search_query(business_url)
    if not query:
        return None
    place = _fetch_place(api_key, query)
    if not place:
        return None
    reviews = _fetch_reviews_deep(api_key, place["place_id"], max_reviews, since_ms)
    if not reviews:
        reviews = place["top_reviews"]
    if not reviews:
        return None
    return {"reviews": reviews, "rating_summary": place["rating_summary"]}


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
    max_reviews = get_max_reviews()
    since_ms = get_since_ms()
    scrape = (
        scrape_business_reviews(business_url, max_reviews, since_ms)
        if has_key
        else None
    )
    have_live = bool(scrape and scrape.get("reviews"))
    reviews = scrape["reviews"] if have_live else load_mock_reviews()
    reviews_source = "nimble" if have_live else "mock"
    rating_summary = scrape.get("rating_summary") if have_live else None

    print(
        f"[ghost.reviews pipeline] mode={mode} "
        f"reviews_source={reviews_source} "
        f"business_url={business_url} reviews={len(reviews)} "
        f"max_reviews={max_reviews} since={since_ms}",
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
        "reviews_total": rating_summary.get("review_count") if rating_summary else None,
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
