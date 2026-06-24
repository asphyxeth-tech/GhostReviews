"""ghost.reviews — prospect pre-filter.

This is STAGE ONE of the two-stage review-bombing detection funnel:

    Stage 1 (this script): cheap heuristic pre-filter.
        Reads public review metadata via Outscraper.  Scores each business
        against a set of lightweight signals.  Outputs a short candidate list
        (score >= 50) for human review.  NO Claude calls here.

    Stage 2 (web app / task.py): Claude verification.
        For each candidate, a human pastes the business URL into ghost.reviews
        or runs the pipeline directly.  Claude reads the actual review *content*
        and produces the forensic report.

Why the split?  The pre-filter costs pennies across dozens of businesses.
Claude verification costs cents per business.  We NARROW with heuristics,
then VERIFY with intelligence.  Never conflate the two.

IMPORTANT: this script outputs candidate lists to /tmp (or --out), NOT to the
repo.  The engine (this file) belongs in git; the targets (the businesses we
think might be under attack) do NOT.  Committing a named-business list would
effectively publish "we suspect these businesses are being attacked" to the
whole internet — that is harmful and off the table.

Outscraper API notes (mirrors src/lib/outscraper.ts):
  - Auth: X-API-KEY header; single env var OUTSCRAPER_API_KEY.
  - Base URL: https://api.app.outscraper.com
  - Reviews: async trigger-then-poll via /maps/reviews-v3 with async=true.
  - Trigger returns {id, status, results_location}; poll results_location
    (or /requests/{id}) every ~8 s until a place object with reviews_data
    appears, status is Error/Failed, or POLL_BUDGET_S elapses.
  - review_timestamp is a unix epoch in seconds (e.g. 1560692128).
  - reviews_per_score is usually {"1": n, ...} but occasionally a string.

Usage examples — see pipeline/README.md for full docs.
"""

from __future__ import annotations

import argparse
import csv
import concurrent.futures
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

import datastore  # local module (pipeline/datastore.py) — the flywheel store

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BASE_URL = "https://api.app.outscraper.com"
REVIEWS_PATH = "/maps/reviews-v3"
SEARCH_PATH = "/maps/search-v3"   # business discovery (Google Maps search)
REQUEST_TIMEOUT_S = 25         # per HTTP call
POLL_INTERVAL_S = 8            # seconds between poll attempts (~8 s, mirrors outscraper.ts)
POLL_BUDGET_S = 300            # max time (5 min) to wait for a single async request

# Depth levels used by --depth-sweep mode.
SWEEP_DEPTHS = [25, 50, 75, 100, 150]

# Scoring constants — v2 (see CLAUDE.md "Outreach engine" and the spec above).
SCORE_BURST = 40
SCORE_SPIKE = 40
SCORE_THROWAWAY = 20
SCORE_TEXTLESS = 15
SCORE_TIGHT_CLUSTER = 15

# A business must reach this threshold to appear in the candidate list.
CANDIDATE_THRESHOLD = 50

# Burst / spike detection windows.
BURST_WINDOW_DAYS = 14
SPIKE_WINDOW_DAYS = 7

# Velocity normalisation: burst only fires if the observed count is at least
# this many times the business's typical negatives-per-window rate.
BURST_VELOCITY_MULTIPLIER = 3.0

# How many negatives must fall in the burst window.
BURST_MIN_COUNT = 3

# How many 1-star reviews must fall in the spike window.
SPIKE_MIN_COUNT = 3

# Spike only fires when the business's all-time 1-star share is below this.
SPIKE_MAX_ONESTAR_SHARE = 0.20   # 20 %

# THROWAWAY: at least this many recent negatives from low-history accounts.
THROWAWAY_MIN_COUNT = 2
THROWAWAY_MAX_REVIEWS = 2        # "low-history" threshold

# TEXTLESS: empty or at most this many words.
TEXTLESS_MAX_WORDS = 3

# TIGHT_CLUSTER: at least this many negatives within this many minutes.
TIGHT_CLUSTER_MIN_COUNT = 2
TIGHT_CLUSTER_WINDOW_MINUTES = 60


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dig(obj: Any, path: list) -> Any:
    """Safe nested getter — returns None on any miss (mirrors task.py)."""
    cur = obj
    for key in path:
        if cur is None:
            return None
        try:
            cur = cur[key]
        except (KeyError, IndexError, TypeError):
            return None
    return cur


def _to_iso(value: Any, datetime_utc: Any = None) -> str:
    """Convert an Outscraper timestamp to ISO 8601.

    Outscraper's review_timestamp is a unix epoch in SECONDS (e.g. 1560692128).
    Tolerate milliseconds (>1e12) and microseconds (>1e15) by normalising to ms.
    Falls back to the review_datetime_utc string "MM/DD/YYYY HH:MM:SS" (UTC),
    then to 'now' on failure.
    """
    now_iso = datetime.now(timezone.utc).isoformat()

    # Try numeric epoch first (seconds, ms, or us).
    try:
        n = float(value)
        if n > 0:
            # Detect scale: >1e15 = microseconds, >1e12 = milliseconds, else seconds.
            if n > 1e15:
                ms = int(n // 1000)
            elif n > 1e12:
                ms = int(n)
            else:
                ms = int(n * 1000)
            d = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
            return d.isoformat()
    except (TypeError, ValueError, OSError, OverflowError):
        pass

    # Fall back to review_datetime_utc string "MM/DD/YYYY HH:MM:SS".
    if isinstance(datetime_utc, str) and datetime_utc.strip():
        # Convert "06/16/2019 13:35:28" -> "2019-06-16 13:35:28 UTC"
        s = datetime_utc.strip()
        import re as _re
        normalized = _re.sub(r"^(\d{2})/(\d{2})/(\d{4})", r"\3-\1-\2", s)
        try:
            d = datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S")
            d = d.replace(tzinfo=timezone.utc)
            return d.isoformat()
        except ValueError:
            pass

    return now_iso


def _parse_posted_at(iso_str: str) -> float:
    """Convert an ISO 8601 string to a UTC timestamp (seconds).  Returns 0
    on failure so broken timestamps don't crash scoring."""
    try:
        d = datetime.fromisoformat(iso_str)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.timestamp()
    except (ValueError, TypeError):
        return 0.0


def _word_count(text: str) -> int:
    """Count space-separated words; empty string = 0."""
    return len(text.split()) if text and text.strip() else 0


def _derive_search_query(raw: str) -> str:
    """Turn a Google Maps URL or 'Name, City' string into a plain-text
    search query.  Mirrors deriveSearchQuery in outscraper.ts / task.py."""
    import re
    from urllib.parse import parse_qs, unquote, urlparse

    raw = raw.strip()
    if not raw:
        return raw

    # Canonical maps.google.com URL has the name embedded in the path.
    match = re.search(r"/maps/place/([^/@]+)", raw)
    if match:
        name = unquote(match.group(1).replace("+", " ")).strip()
        if name:
            return name

    # Any URL: try ?q= or ?query= params.
    try:
        parsed = urlparse(raw)
        if parsed.scheme and parsed.query:
            qs = parse_qs(parsed.query)
            for key in ("q", "query"):
                if qs.get(key):
                    return qs[key][0].strip()
    except ValueError:
        pass

    # Not a URL at all: treat as a plain "Business Name, City" string.
    return raw


# ---------------------------------------------------------------------------
# Outscraper HTTP layer (stdlib-only, mirrors outscraper.ts)
# ---------------------------------------------------------------------------

def _get_api_key() -> str | None:
    """Read OUTSCRAPER_API_KEY from the environment.  Returns None when
    the key is not configured — callers must check and fail gracefully."""
    key = os.environ.get("OUTSCRAPER_API_KEY", "").strip()
    return key if key else None


def _outscraper_get(url: str, api_key: str, timeout: int = REQUEST_TIMEOUT_S) -> Any:
    """GET any Outscraper URL with X-API-KEY auth; return parsed JSON (list or
    dict) or None on any error.  The response body may be a bare list or a dict,
    so we return the raw parsed value rather than forcing dict."""
    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json",
            "X-API-KEY": api_key,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status < 200 or resp.status >= 300:
                return None
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError):
        return None


def _build_reviews_url(query: str, depth: int) -> str:
    """Build the /maps/reviews-v3 async trigger URL.

    Pulls ONLY the 1-2 star negatives (sort=lowest_rating + cutoffRating=2) —
    the negatives ARE the entire fraud signal, so this bills ~85-90% fewer
    reviews with no detection loss. ignoreEmpty is left off so textless 1-star
    reviews (the strongest tell) still come back; the place-level rating +
    reviews_per_score still arrive, so the velocity baseline is unaffected.
    Mirrors buildReviewsUrl(negativesOnly=true) in outscraper.ts.
    """
    params = urllib.parse.urlencode({
        "query": query,
        "reviewsLimit": depth,
        "sort": "lowest_rating",
        "cutoffRating": 2,
        "language": "en",
        "limit": 1,       # one place per query
        "async": "true",
    })
    return f"{BASE_URL}{REVIEWS_PATH}?{params}"


def _find_place(resp: Any) -> dict | None:
    """BFS-walk the Outscraper response (bare array, {data:[...]},
    {data:[[...]]}, {status,data}, etc.) and return the first dict that
    contains a reviews_data list — the place object.

    Mirrors findPlace in outscraper.ts.
    """
    queue: list[Any] = [resp]
    guard = 0
    while queue and guard < 5000:
        guard += 1
        cur = queue.pop(0)
        if isinstance(cur, list):
            for x in cur:
                queue.append(x)
        elif isinstance(cur, dict):
            if isinstance(cur.get("reviews_data"), list):
                return cur
            for v in cur.values():
                if isinstance(v, (dict, list)):
                    queue.append(v)
    return None


def _build_rating_summary(place: dict) -> dict | None:
    """Build the normalized rating_summary from an Outscraper place object.

    Mirrors buildRatingSummary in outscraper.ts.
    reviews_per_score is usually {"1": n, ...} but occasionally the string
    "1: 6, 2: 0, 3: 4, ..." — handle both.
    """
    try:
        overall = float(place.get("rating", 0) or 0)
    except (TypeError, ValueError):
        overall = 0.0
    try:
        count = int(place.get("reviews", 0) or 0)
    except (TypeError, ValueError):
        count = 0

    counts: dict[str, int] = {}
    rps = place.get("reviews_per_score")
    if isinstance(rps, dict):
        for s in ("1", "2", "3", "4", "5"):
            try:
                v = int(rps.get(s, 0) or 0)
                counts[s] = v
            except (TypeError, ValueError):
                pass
    elif isinstance(rps, str):
        import re as _re
        for part in rps.split(","):
            m = _re.match(r"\s*([1-5])\s*:\s*(\d+)", part.strip())
            if m:
                counts[m.group(1)] = int(m.group(2))

    if not overall and not count and not counts:
        return None

    return {
        "overall_rating": overall,
        "review_count": count,
        "ratings_count": counts,
    }


def _map_reviews(place: dict) -> list[dict]:
    """Map Outscraper reviews_data items to the normalized review shape.

    Fields used downstream by scoring:
        id, rating, posted_at (ISO 8601), reviewer_total_reviews, text

    Mirrors mapReviews in outscraper.ts; preserves the Outscraper field-name
    quirks (autor_name typo, epoch timestamp).
    """
    items = place.get("reviews_data", [])
    if not isinstance(items, list):
        return []

    out = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        try:
            rating = max(1, min(5, round(float(item.get("review_rating", 0) or 0))))
        except (TypeError, ValueError):
            continue   # not a review row

        posted_at = _to_iso(
            item.get("review_timestamp"),
            item.get("review_datetime_utc"),
        )

        review_id = item.get("review_id")
        # Outscraper uses "autor_name" (missing 'h'); also accept "author_name".
        name = item.get("autor_name") or item.get("author_name")
        # author_reviews_count = reviewer's lifetime review count — key fraud signal.
        count_raw = item.get("author_reviews_count")
        try:
            total_reviews = int(count_raw) if count_raw is not None else 0
        except (TypeError, ValueError):
            total_reviews = 0

        text = item.get("review_text")
        # autor_id (Outscraper's typo) = the reviewer's Google account id —
        # logged into the flywheel store for cross-business convergence.
        author_id = item.get("autor_id") or item.get("author_id")

        out.append(
            {
                "id": review_id if isinstance(review_id, str) and review_id else f"outscraper-{i}",
                "author_id": author_id if isinstance(author_id, str) else "",
                "reviewer_name": name if isinstance(name, str) and name.strip() else "Anonymous",
                "reviewer_total_reviews": total_reviews,
                "rating": rating,
                "posted_at": posted_at,
                "text": text if isinstance(text, str) else "",
            }
        )
    return out


# ---------------------------------------------------------------------------
# Per-business data pull (async: trigger then poll)
# ---------------------------------------------------------------------------

def pull_business_data(
    api_key: str,
    query: str,
    depth: int,
) -> dict | None:
    """Resolve a business, pull its rating baseline and recent reviews via
    Outscraper's async /maps/reviews-v3 endpoint.

    Flow:
        1. GET the async trigger URL → {id, status, results_location}.
        2. Poll results_location (or /requests/{id}) every POLL_INTERVAL_S
           until _find_place returns a place, status is Error/Failed, or
           POLL_BUDGET_S elapses.
        3. Map place["reviews_data"] to normalized review dicts.
        4. Build rating_summary from place["rating"], ["reviews"],
           ["reviews_per_score"].

    Returns:
        {
            "query": str,
            "rating_summary": dict | None,   # all-time baseline
            "reviews": list[dict],            # newest-first, up to `depth`
        }
    or None on failure (network error, business not found, timeout).
    """
    # --- Step 1: trigger the async request ---
    trigger_url = _build_reviews_url(query, depth)
    trigger_resp = _outscraper_get(trigger_url, api_key)
    if not trigger_resp:
        return None

    # Extract id and results_location from trigger response.
    req_id = _dig(trigger_resp, ["id"])
    results_loc = _dig(trigger_resp, ["results_location"])

    if isinstance(results_loc, str) and results_loc:
        poll_url = results_loc
    elif isinstance(req_id, str) and req_id:
        poll_url = f"{BASE_URL}/requests/{req_id}"
    else:
        # No id or results_location — maybe the sync response came back immediately.
        place = _find_place(trigger_resp)
        if place is not None:
            return _assemble_result(query, place)
        return None

    # --- Step 2: poll until done ---
    deadline = time.monotonic() + POLL_BUDGET_S
    while time.monotonic() < deadline:
        poll_resp = _outscraper_get(poll_url, api_key)
        if poll_resp is not None:
            place = _find_place(poll_resp)
            if place is not None:
                return _assemble_result(query, place)
            status = _dig(poll_resp, ["status"])
            if status in ("Error", "Failed"):
                return None
        time.sleep(POLL_INTERVAL_S)

    return None   # budget exhausted


def _assemble_result(query: str, place: dict) -> dict:
    """Build the normalized pull_business_data return value from a place dict."""
    reviews = _map_reviews(place)
    # Sort newest-first (Outscraper should already do this with sort=newest,
    # but be safe).
    reviews.sort(key=lambda r: _parse_posted_at(r["posted_at"]), reverse=True)
    return {
        "query": query,
        "rating_summary": _build_rating_summary(place),
        "reviews": reviews,
    }


# ---------------------------------------------------------------------------
# Business discovery (Google Maps search — generates the candidate list)
# ---------------------------------------------------------------------------

def _build_search_url(query: str, limit: int, region: str) -> str:
    """Build the /maps/search-v3 async trigger URL for business discovery.

    `organizationsPerQueryLimit` (NOT `limit`) controls how many places come
    back; `region` is an ISO-3166 alpha-2 bias (e.g. "CA")."""
    params = urllib.parse.urlencode({
        "query": query,
        "organizationsPerQueryLimit": max(1, int(limit)),
        "language": "en",
        "region": region,
        "dropDuplicates": "true",
        "async": "true",
    })
    return f"{BASE_URL}{SEARCH_PATH}?{params}"


def _find_places(resp: Any) -> list[dict]:
    """Extract the place list from a /maps/search-v3 result.  The payload is
    {status, data: [[place, ...]]} (one inner list per input query); we send
    one query, so places live at data[0].  Tolerates {data:[...]} and a bare
    list too."""
    data = _dig(resp, ["data"])
    if isinstance(data, list) and data and isinstance(data[0], list):
        candidates = data[0]
    elif isinstance(data, list):
        candidates = data
    elif isinstance(resp, list):
        candidates = resp
    else:
        candidates = []
    return [
        p for p in candidates
        if isinstance(p, dict) and (p.get("place_id") or p.get("name"))
    ]


def _compact_place(place: dict) -> dict:
    """Pull the human-useful fields out of a discovered place object."""
    try:
        total_reviews = int(place.get("reviews") or 0)
    except (TypeError, ValueError):
        total_reviews = 0
    try:
        rating = float(place.get("rating"))
    except (TypeError, ValueError):
        rating = None
    return {
        "name": place.get("name") or "",
        # place_id is the precise identifier we'll re-resolve reviews against.
        "place_id": place.get("place_id") or place.get("cid") or "",
        "full_address": place.get("full_address") or "",
        "total_reviews": total_reviews,
        "rating": rating,
        "type": place.get("type") or "",
        "phone": place.get("phone") or "",
        "site": place.get("site") or "",   # website; Outscraper field is "site"
    }


def discover_businesses(
    api_key: str, query: str, limit: int, region: str
) -> list[dict]:
    """Search Google Maps via Outscraper for businesses matching `query`
    (e.g. "auto repair, London, Ontario, Canada") and return their raw place
    objects (name, place_id, reviews count, rating, site, address, ...).

    Async trigger + poll, mirroring pull_business_data.  Returns [] on failure.
    """
    trigger_resp = _outscraper_get(_build_search_url(query, limit, region), api_key)
    if not trigger_resp:
        return []

    req_id = _dig(trigger_resp, ["id"])
    results_loc = _dig(trigger_resp, ["results_location"])
    if isinstance(results_loc, str) and results_loc:
        poll_url = results_loc
    elif isinstance(req_id, str) and req_id:
        poll_url = f"{BASE_URL}/requests/{req_id}"
    else:
        # Synchronous response came back immediately.
        return _find_places(trigger_resp)

    deadline = time.monotonic() + POLL_BUDGET_S
    while time.monotonic() < deadline:
        poll_resp = _outscraper_get(poll_url, api_key)
        if poll_resp is not None:
            places = _find_places(poll_resp)
            if places:
                return places
            if _dig(poll_resp, ["status"]) in ("Error", "Failed"):
                return []
        time.sleep(POLL_INTERVAL_S)
    return []


# ---------------------------------------------------------------------------
# Scoring (v2 — see CLAUDE.md for methodology rationale)
# ---------------------------------------------------------------------------

def _seconds_between(ts_a: str, ts_b: str) -> float:
    """Return |ts_a - ts_b| in seconds.  0 on parse failure."""
    a = _parse_posted_at(ts_a)
    b = _parse_posted_at(ts_b)
    return abs(a - b)


def _expected_negatives_per_window(
    rating_summary: dict | None,
    reviews: list[dict],
    window_days: int,
) -> float:
    """Estimate how many negative (≤2★) reviews we'd expect in `window_days`
    based on the business's overall cadence.

    Strategy:
        1. Use the all-time review count from rating_summary if available.
        2. Estimate the time span covered by the pulled reviews.
        3. Derive: expected = (total_reviews * neg_share) / age_days * window_days

    Falls back to 0.0 (conservative — fires the anchor) when we don't have
    enough data to estimate.  A return of 0.0 means "we can't tell, allow it
    through."
    """
    if not reviews:
        return 0.0

    # All-time total review count.
    total_reviews = 0
    if rating_summary:
        try:
            total_reviews = int(rating_summary.get("review_count", 0))
        except (TypeError, ValueError):
            pass

    # All-time negative share (1★ + 2★).
    neg_share = 0.0
    if rating_summary and rating_summary.get("ratings_count"):
        rc = rating_summary["ratings_count"]
        try:
            ones = int(rc.get("1", 0))
            twos = int(rc.get("2", 0))
            total = max(1, total_reviews)
            neg_share = (ones + twos) / total
        except (TypeError, ValueError):
            neg_share = 0.0

    if total_reviews == 0 or neg_share == 0.0:
        # Can't estimate — fall back: return 0 (caller treats as "unknown,
        # don't suppress the anchor on insufficient data").
        return 0.0

    # Estimate business age in days from the oldest review we pulled.
    oldest_ts = min(_parse_posted_at(r["posted_at"]) for r in reviews)
    newest_ts = max(_parse_posted_at(r["posted_at"]) for r in reviews)
    span_days = (newest_ts - oldest_ts) / 86400.0

    # If we only have a tiny span (e.g. all reviews today), use a
    # rough estimate: assume the pulled depth covers ~3 months of activity.
    if span_days < 7:
        span_days = 90.0

    # Expected negatives over the life of the business.
    expected_total_neg = total_reviews * neg_share
    # Pro-rate to the window.
    expected_per_window = expected_total_neg / max(span_days, 1) * window_days
    return expected_per_window


def _find_rolling_window_peak(
    reviews: list[dict],
    window_days: int,
    min_rating: int,
    max_rating: int,
) -> tuple[int, list[dict]]:
    """Find the maximum number of reviews with rating in [min_rating,
    max_rating] that fall within any rolling `window_days` window.

    Returns (peak_count, reviews_in_that_window).
    Uses a sliding two-pointer approach over the sorted review list.
    """
    # Filter to the target rating band, sorted oldest-first for the window sweep.
    targeted = [
        r for r in reviews
        if min_rating <= r["rating"] <= max_rating
    ]
    targeted.sort(key=lambda r: _parse_posted_at(r["posted_at"]))

    if not targeted:
        return 0, []

    window_seconds = window_days * 86400.0
    best_count = 0
    best_window: list[dict] = []
    left = 0

    for right in range(len(targeted)):
        t_right = _parse_posted_at(targeted[right]["posted_at"])
        # Advance left pointer until the window fits.
        while True:
            t_left = _parse_posted_at(targeted[left]["posted_at"])
            if t_right - t_left <= window_seconds:
                break
            left += 1
        window_size = right - left + 1
        if window_size > best_count:
            best_count = window_size
            best_window = targeted[left: right + 1]

    return best_count, best_window


def score_business(data: dict) -> dict:
    """Compute the v2 heuristic score for one business.

    Returns a score dict with:
        score           — total points (0 if no anchor fired)
        rules_fired     — list of rule names that contributed
        breakdown       — {rule_name: points}
        counts          — raw counts that drove the score
        flagged_reviews — list of review dicts that triggered signals
        anchor_fired    — bool (False means score forced to 0)

    Methodology is defined in CLAUDE.md and the module docstring above.
    No Claude calls here — this is the cheap heuristic layer only.
    """
    rating_summary = data.get("rating_summary")
    reviews = data.get("reviews", [])

    result = {
        "score": 0,
        "rules_fired": [],
        "breakdown": {},
        "counts": {
            "total_reviews_pulled": len(reviews),
            "burst_window_negatives": 0,
            "spike_window_ones": 0,
            "throwaway_negatives": 0,
            "textless_onestar_throwaway": 0,
            "tightest_cluster_gap_minutes": None,
        },
        "flagged_reviews": [],
        "anchor_fired": False,
    }

    if not reviews:
        return result

    # ------------------------------------------------------------------
    # ANCHOR 1: BURST
    #   ≥3 negatives (≤2★) in any 14-day window, velocity-normalised.
    #   Only fires when the observed count is ≥3× the expected baseline.
    # ------------------------------------------------------------------
    burst_count, burst_window = _find_rolling_window_peak(
        reviews, BURST_WINDOW_DAYS, min_rating=1, max_rating=2
    )
    result["counts"]["burst_window_negatives"] = burst_count

    burst_fired = False
    if burst_count >= BURST_MIN_COUNT:
        expected = _expected_negatives_per_window(
            rating_summary, reviews, BURST_WINDOW_DAYS
        )
        # If we can't estimate the baseline (expected == 0), allow the
        # anchor through — conservative default favours flagging.
        if expected == 0.0 or burst_count >= BURST_VELOCITY_MULTIPLIER * expected:
            burst_fired = True
            result["anchor_fired"] = True
            result["rules_fired"].append("BURST")
            result["breakdown"]["BURST"] = SCORE_BURST
            result["score"] += SCORE_BURST
            for r in burst_window:
                if r not in result["flagged_reviews"]:
                    result["flagged_reviews"].append(r)

    # ------------------------------------------------------------------
    # ANCHOR 2: SPIKE
    #   ≥3 one-star reviews in any 7-day window, when all-time 1★ share < 20%.
    # ------------------------------------------------------------------
    spike_count, spike_window = _find_rolling_window_peak(
        reviews, SPIKE_WINDOW_DAYS, min_rating=1, max_rating=1
    )
    result["counts"]["spike_window_ones"] = spike_count

    spike_fired = False
    onestar_share = 0.0
    if rating_summary and rating_summary.get("ratings_count"):
        rc = rating_summary["ratings_count"]
        total = max(1, int(rating_summary.get("review_count", 1) or 1))
        try:
            ones = int(rc.get("1", 0))
            onestar_share = ones / total
        except (TypeError, ValueError):
            onestar_share = 0.0

    if spike_count >= SPIKE_MIN_COUNT and onestar_share < SPIKE_MAX_ONESTAR_SHARE:
        spike_fired = True
        result["anchor_fired"] = True
        result["rules_fired"].append("SPIKE")
        result["breakdown"]["SPIKE"] = SCORE_SPIKE
        result["score"] += SCORE_SPIKE
        for r in spike_window:
            if r not in result["flagged_reviews"]:
                result["flagged_reviews"].append(r)

    # If neither anchor fired, force score to 0 and return early.
    # Corroboration signals CANNOT substitute for an anchor (v2 design).
    if not result["anchor_fired"]:
        result["score"] = 0
        return result

    # ------------------------------------------------------------------
    # CORROBORATION 1: THROWAWAY
    #   ≥2 of the recent negatives from accounts with ≤2 lifetime reviews.
    #   Only counted when an anchor already fired (enforced by the block above).
    # ------------------------------------------------------------------
    recent_negatives = [r for r in reviews if r["rating"] <= 2]
    throwaway_negs = [
        r for r in recent_negatives
        if r.get("reviewer_total_reviews", 999) <= THROWAWAY_MAX_REVIEWS
    ]
    result["counts"]["throwaway_negatives"] = len(throwaway_negs)

    if len(throwaway_negs) >= THROWAWAY_MIN_COUNT:
        result["rules_fired"].append("THROWAWAY")
        result["breakdown"]["THROWAWAY"] = SCORE_THROWAWAY
        result["score"] += SCORE_THROWAWAY
        for r in throwaway_negs:
            if r not in result["flagged_reviews"]:
                result["flagged_reviews"].append(r)

    # ------------------------------------------------------------------
    # CORROBORATION 2: TEXTLESS
    #   ≥1 textless/near-textless (≤3 words) 1★ review from a low-history
    #   (≤2 reviews) account.  The single most reliable signal from live
    #   testing (see CLAUDE.md).
    # ------------------------------------------------------------------
    onestar_reviews = [r for r in reviews if r["rating"] == 1]
    textless_throwaway = [
        r for r in onestar_reviews
        if _word_count(r.get("text", "")) <= TEXTLESS_MAX_WORDS
        and r.get("reviewer_total_reviews", 999) <= THROWAWAY_MAX_REVIEWS
    ]
    result["counts"]["textless_onestar_throwaway"] = len(textless_throwaway)

    if textless_throwaway:
        result["rules_fired"].append("TEXTLESS")
        result["breakdown"]["TEXTLESS"] = SCORE_TEXTLESS
        result["score"] += SCORE_TEXTLESS
        for r in textless_throwaway:
            if r not in result["flagged_reviews"]:
                result["flagged_reviews"].append(r)

    # ------------------------------------------------------------------
    # CORROBORATION 3: TIGHT_CLUSTER
    #   ≥2 negatives posted within 60 minutes of each other.
    #   From live testing: Ricky Ratchets had two 1-stars 26 min apart.
    # ------------------------------------------------------------------
    all_neg_sorted = sorted(
        recent_negatives,
        key=lambda r: _parse_posted_at(r["posted_at"]),
    )
    tightest_gap: float | None = None
    tight_pair: list[dict] = []

    for i in range(len(all_neg_sorted) - 1):
        gap_s = _seconds_between(
            all_neg_sorted[i]["posted_at"],
            all_neg_sorted[i + 1]["posted_at"],
        )
        gap_min = gap_s / 60.0
        if tightest_gap is None or gap_min < tightest_gap:
            tightest_gap = gap_min
            tight_pair = [all_neg_sorted[i], all_neg_sorted[i + 1]]

    if tightest_gap is not None:
        result["counts"]["tightest_cluster_gap_minutes"] = round(tightest_gap, 1)

    if tightest_gap is not None and tightest_gap <= TIGHT_CLUSTER_WINDOW_MINUTES:
        # Count how many negatives fall within the tightest 60-min window.
        pair_ts = [
            _parse_posted_at(r["posted_at"])
            for r in tight_pair
        ]
        window_start = min(pair_ts)
        window_end = max(pair_ts)
        cluster_reviews = [
            r for r in all_neg_sorted
            if window_start - 0.1 <= _parse_posted_at(r["posted_at"]) <= window_end + 0.1
        ]
        if len(cluster_reviews) >= TIGHT_CLUSTER_MIN_COUNT:
            result["rules_fired"].append("TIGHT_CLUSTER")
            result["breakdown"]["TIGHT_CLUSTER"] = SCORE_TIGHT_CLUSTER
            result["score"] += SCORE_TIGHT_CLUSTER
            for r in cluster_reviews:
                if r not in result["flagged_reviews"]:
                    result["flagged_reviews"].append(r)

    return result


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------

def _snippet(text: str, max_chars: int = 120) -> str:
    """Return a short excerpt of review text for the output."""
    if not text or not text.strip():
        return "(no text)"
    text = text.strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rsplit(" ", 1)[0] + "…"


def _build_scan_record(
    query: str,
    data: dict,
    score_result: dict,
    depth: int,
    meta: dict[str, dict] | None = None,
) -> dict:
    """Build the flywheel-store row for one scanned business (candidate OR miss).
    Captures the score + the suspicious reviews (with author_id, which powers the
    free cross-business convergence signal).  See docs/METHODOLOGY.md."""
    biz = (meta or {}).get(query) or {}
    rating_summary = data.get("rating_summary") or {}
    total_reviews = biz.get("total_reviews")
    if total_reviews is None:
        total_reviews = rating_summary.get("review_count")

    flagged = []
    for r in score_result.get("flagged_reviews", []):
        txt = r.get("text") or ""
        flagged.append(
            {
                "review_id": r.get("id"),
                "author_id": r.get("author_id") or "",
                "author_name": r.get("reviewer_name"),
                "rating": r.get("rating"),
                "posted_at": r.get("posted_at"),
                "reviewer_total_reviews": r.get("reviewer_total_reviews"),
                "textless": len(txt.strip()) == 0,
                "text_snippet": _snippet(txt),
            }
        )

    return {
        "place_id": biz.get("place_id") or query,
        "business_name": biz.get("name") or query,
        "query": query,
        "total_reviews": total_reviews,
        "scan_depth": depth,
        "prefilter_score": score_result.get("score"),
        "anchor_fired": score_result.get("anchor_fired"),
        "rules_fired": score_result.get("rules_fired"),
        "counts": score_result.get("counts"),
        "flagged_reviews": flagged,
    }


def build_candidate_record(query: str, data: dict, score_result: dict) -> dict:
    """Build the JSON record emitted for each candidate business."""
    flagged = []
    for r in score_result.get("flagged_reviews", []):
        flagged.append(
            {
                "id": r.get("id"),
                "rating": r.get("rating"),
                "posted_at": r.get("posted_at"),
                "reviewer_total_reviews": r.get("reviewer_total_reviews"),
                "text_snippet": _snippet(r.get("text", "")),
            }
        )

    return {
        "query": query,
        "score": score_result["score"],
        "anchor_fired": score_result["anchor_fired"],
        "rules_fired": score_result["rules_fired"],
        "breakdown": score_result["breakdown"],
        "counts": score_result["counts"],
        "rating_summary": data.get("rating_summary"),
        "flagged_reviews": flagged,
    }


def print_summary_table(candidates: list[dict]) -> None:
    """Print a human-readable summary table to stdout."""
    if not candidates:
        print("\nNo candidates found (score < {}).".format(CANDIDATE_THRESHOLD))
        return

    header = f"\n{'#':<4} {'Score':<7} {'Rules fired':<40} {'Query'}"
    print(header)
    print("-" * max(len(header), 90))
    for i, c in enumerate(candidates, 1):
        rules = ", ".join(c["rules_fired"]) if c["rules_fired"] else "-"
        query_display = c["query"][:60] if len(c["query"]) > 60 else c["query"]
        print(f"{i:<4} {c['score']:<7} {rules:<40} {query_display}")
    print(
        f"\n{len(candidates)} candidate(s) above threshold {CANDIDATE_THRESHOLD}. "
        "Run each through ghost.reviews for Claude verification before outreach.\n"
    )


# ---------------------------------------------------------------------------
# Standard (non-sweep) mode
# ---------------------------------------------------------------------------

def run_standard(
    queries: list[str],
    depth: int,
    workers: int,
    api_key: str,
    out_path: str,
    meta: dict[str, dict] | None = None,
    db_path: str | None = None,
) -> None:
    """Pull reviews for all queries in parallel, score each, and write
    candidates (score >= CANDIDATE_THRESHOLD) to --out.

    `meta` optionally maps a query string -> discovered business metadata
    (name, address, total_reviews, site).  When present, each candidate record
    is enriched with it — used by discovery mode, where queries are place_ids.

    `db_path`, when set, records EVERY scanned business (candidates and misses)
    to the local flywheel store for ongoing algorithm refinement (METHODOLOGY.md)."""

    print(
        f"[prospect] standard mode | businesses={len(queries)} "
        f"depth={depth} workers={workers}",
        file=sys.stderr,
    )

    def process_one(query: str) -> dict | None:
        """Pull + score one business.  Returns {"scan": <record>, "candidate":
        <record or None>}, or None when the business couldn't be pulled."""
        print(f"[prospect] pulling: {query}", file=sys.stderr)
        data = pull_business_data(api_key, query, depth)
        if data is None:
            print(f"[prospect] SKIP (no data): {query}", file=sys.stderr)
            return None
        score_result = score_business(data)
        print(
            f"[prospect] scored: {query!r} -> {score_result['score']} "
            f"({', '.join(score_result['rules_fired']) or 'no anchors'})",
            file=sys.stderr,
        )
        scan_rec = _build_scan_record(query, data, score_result, depth, meta)
        candidate = None
        if score_result["score"] >= CANDIDATE_THRESHOLD:
            candidate = build_candidate_record(query, data, score_result)
            if meta and query in meta:
                candidate["business"] = meta[query]
        return {"scan": scan_rec, "candidate": candidate}

    scan_records: list[dict] = []
    candidates: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process_one, q): q for q in queries}
        for future in concurrent.futures.as_completed(futures):
            try:
                res = future.result()
            except Exception as exc:
                q = futures[future]
                print(f"[prospect] ERROR for {q!r}: {exc}", file=sys.stderr)
                res = None
            if res is not None:
                scan_records.append(res["scan"])
                if res["candidate"] is not None:
                    candidates.append(res["candidate"])

    # Record every scanned business to the local flywheel store (best-effort —
    # never breaks a run).  This is the growing labeled dataset (METHODOLOGY.md).
    if db_path:
        n = datastore.record_scans(scan_records, db_path)
        print(f"[prospect] flywheel: recorded {n} scan(s) -> {db_path}", file=sys.stderr)

    # Sort by score descending.
    candidates.sort(key=lambda c: c["score"], reverse=True)

    # Write JSON output.
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(candidates, f, indent=2)
    print(f"[prospect] JSON written: {out_path}", file=sys.stderr)

    # Write CSV alongside (same base path, .csv extension).
    csv_path = out_path.rsplit(".", 1)[0] + ".csv"
    _write_csv(candidates, csv_path)
    print(f"[prospect] CSV written: {csv_path}", file=sys.stderr)

    print_summary_table(candidates)


def _write_csv(candidates: list[dict], csv_path: str) -> None:
    """Write a flat CSV with one row per candidate for quick spreadsheet review."""
    if not candidates:
        return
    fieldnames = [
        "rank", "score", "business_name", "query", "anchor_fired", "rules_fired",
        "burst_window_negatives", "spike_window_ones",
        "throwaway_negatives", "textless_onestar_throwaway",
        "tightest_cluster_gap_minutes", "overall_rating", "review_count",
        "flagged_count",
    ]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for i, c in enumerate(candidates, 1):
            rs = c.get("rating_summary") or {}
            row = {
                "rank": i,
                "score": c["score"],
                "business_name": (c.get("business") or {}).get("name", ""),
                "query": c["query"],
                "anchor_fired": c["anchor_fired"],
                "rules_fired": "|".join(c.get("rules_fired", [])),
                **{k: c["counts"].get(k, "") for k in [
                    "burst_window_negatives", "spike_window_ones",
                    "throwaway_negatives", "textless_onestar_throwaway",
                    "tightest_cluster_gap_minutes",
                ]},
                "overall_rating": rs.get("overall_rating", ""),
                "review_count": rs.get("review_count", ""),
                "flagged_count": len(c.get("flagged_reviews", [])),
            }
            writer.writerow(row)


# ---------------------------------------------------------------------------
# Depth-sweep mode
# ---------------------------------------------------------------------------

def run_depth_sweep(
    queries: list[str],
    workers: int,
    api_key: str,
    out_path: str,
) -> None:
    """For each business, pull reviews at multiple depths and record how the
    score evolves.

    This is a calibration experiment to determine:
        - At what depth do attack signals first appear?
        - Where does the score stabilise?

    Output: JSON with one entry per (business, depth); readable table to stdout.
    The results belong in /tmp or Devon's notes — never committed to the repo.
    """
    print(
        f"[prospect] depth-sweep mode | businesses={len(queries)} "
        f"depths={SWEEP_DEPTHS} workers={workers}",
        file=sys.stderr,
    )

    # We fan out with workers threads across (query × depth) combinations.
    # Queries are independent; sweep depths for the same query run sequentially
    # within each worker to avoid posting many overlapping tasks for the same
    # business at once.

    sweep_results: list[dict] = []

    def sweep_one(query: str) -> list[dict]:
        """Run the full depth sweep for a single business, sequentially."""
        rows = []
        for depth in SWEEP_DEPTHS:
            print(f"[prospect] sweep: {query!r} @ depth={depth}", file=sys.stderr)
            data = pull_business_data(api_key, query, depth)
            if data is None:
                rows.append(
                    {
                        "query": query,
                        "depth": depth,
                        "score": None,
                        "anchor_fired": None,
                        "rules_fired": [],
                        "counts": {},
                        "error": "no data / timeout",
                    }
                )
                continue
            score_result = score_business(data)
            rows.append(
                {
                    "query": query,
                    "depth": depth,
                    "score": score_result["score"],
                    "anchor_fired": score_result["anchor_fired"],
                    "rules_fired": score_result["rules_fired"],
                    "breakdown": score_result["breakdown"],
                    "counts": score_result["counts"],
                }
            )
        return rows

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(sweep_one, q): q for q in queries}
        for future in concurrent.futures.as_completed(futures):
            try:
                rows = future.result()
            except Exception as exc:
                q = futures[future]
                print(f"[prospect] ERROR sweeping {q!r}: {exc}", file=sys.stderr)
                rows = []
            sweep_results.extend(rows)

    # Sort by query, then depth.
    sweep_results.sort(key=lambda r: (r["query"], r.get("depth", 0)))

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(sweep_results, f, indent=2)
    print(f"[prospect] sweep JSON written: {out_path}", file=sys.stderr)

    _print_sweep_table(sweep_results)


def _print_sweep_table(rows: list[dict]) -> None:
    """Print a per-business table showing how score evolves with depth."""
    if not rows:
        return

    # Group by query.
    from collections import OrderedDict
    by_query: dict[str, list[dict]] = OrderedDict()
    for row in rows:
        by_query.setdefault(row["query"], []).append(row)

    for query, biz_rows in by_query.items():
        print(f"\n--- {query} ---")
        header = f"{'Depth':<8} {'Score':<7} {'Anchor':<8} {'Rules fired'}"
        print(header)
        print("-" * 60)
        for r in biz_rows:
            score_str = str(r["score"]) if r["score"] is not None else "ERR"
            anchor_str = str(r.get("anchor_fired", "")) if r.get("anchor_fired") is not None else "ERR"
            rules_str = ", ".join(r.get("rules_fired", [])) or "-"
            print(f"{r['depth']:<8} {score_str:<7} {anchor_str:<8} {rules_str}")


# ---------------------------------------------------------------------------
# Input parsing
# ---------------------------------------------------------------------------

def load_queries(input_path: str) -> list[str]:
    """Read the input file: one business per line (URL or 'Name, City').

    Blank lines and lines starting with '#' are skipped.
    """
    queries: list[str] = []
    with open(input_path, encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            q = _derive_search_query(line)
            if q:
                queries.append(q)
    return queries


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "ghost.reviews prospect pre-filter — heuristic review-signal scorer.\n\n"
            "STAGE 1 of the two-stage detection funnel.  Reads public review metadata "
            "via Outscraper, scores each business against heuristic signals (BURST, SPIKE, "
            "THROWAWAY, TEXTLESS, TIGHT_CLUSTER), and outputs candidates for Claude "
            "verification.  No Claude calls here — use the ghost.reviews web app or "
            "pipeline/task.py for Stage 2.\n\n"
            "INPUT: use --input (a known business list) OR --discover (search Google "
            "Maps for businesses by 'category, city' and score them).\n\n"
            "SECURITY NOTE: output files go to /tmp by default (or --out path).  "
            "Never commit result files to the repo — the engine belongs in git, "
            "the target list does not."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--input",
        help=(
            "Path to a text file with one business per line (Google Maps URL "
            "or 'Business Name, City').  Use this OR --discover."
        ),
    )
    parser.add_argument(
        "--discover",
        metavar="QUERY",
        help=(
            "Discovery mode: instead of --input, search Google Maps for "
            "businesses matching QUERY (e.g. 'auto repair, London, Ontario, "
            "Canada') and score each.  Use this OR --input."
        ),
    )
    parser.add_argument(
        "--discover-limit",
        type=int,
        default=50,
        help="Max businesses to discover per query (default: 50).  "
             "Maps to Outscraper organizationsPerQueryLimit.",
    )
    parser.add_argument(
        "--region",
        default="CA",
        help="ISO-3166 alpha-2 region bias for discovery (default: CA).",
    )
    parser.add_argument(
        "--min-reviews",
        type=int,
        default=0,
        help="Discovery filter: skip businesses with fewer than this many "
             "total reviews (default: 0 = keep all).  Tiny businesses rarely "
             "host a meaningful attack pattern.",
    )
    parser.add_argument(
        "--depth",
        type=int,
        default=75,
        help=(
            "Number of reviews to pull per business (default: 75).  "
            "Attack signals are often invisible at depth<50; use 75-100 for "
            "standard runs.  Ignored in --depth-sweep mode."
        ),
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Thread-pool size for parallel per-business pulls (default: 4).  "
             "Network-bound; more threads = faster for large input lists.",
    )
    parser.add_argument(
        "--out",
        default="/tmp/prospect_results.json",
        help="Output JSON path (default: /tmp/prospect_results.json).  "
             "A .csv is also written alongside it.  Keep outputs in /tmp.",
    )
    parser.add_argument(
        "--depth-sweep",
        action="store_true",
        help=(
            "Calibration mode: scan each business at depths 25/50/75/100/150 "
            "and report how score evolves.  Use this to determine at what depth "
            "attack signals first appear and where the score stabilises."
        ),
    )
    parser.add_argument(
        "--db",
        default=datastore.DEFAULT_DB_PATH,
        help=(
            "Local flywheel store path (SQLite, default: "
            f"{datastore.DEFAULT_DB_PATH}).  Every scanned business is recorded "
            "for ongoing algorithm refinement.  Gitignored — never committed.  "
            "Pass '' to disable recording."
        ),
    )
    parser.add_argument(
        "--db-stats",
        action="store_true",
        help="Print accumulated flywheel-store stats (incl. recurring-author "
             "convergence) and exit.  No scan; no API key needed.",
    )
    args = parser.parse_args()

    # --db-stats: just report the store and exit (no scan, no API key needed).
    if args.db_stats:
        datastore.print_stats(args.db or datastore.DEFAULT_DB_PATH)
        return 0

    # Exactly one input source.
    if bool(args.input) == bool(args.discover):
        print("ERROR: provide exactly one of --input or --discover.", file=sys.stderr)
        return 1
    if args.discover and args.depth_sweep:
        print(
            "ERROR: --depth-sweep is for --input calibration on a known set, "
            "not --discover.",
            file=sys.stderr,
        )
        return 1

    # Validate credentials before doing any work.
    api_key = _get_api_key()
    if api_key is None:
        print(
            "ERROR: OUTSCRAPER_API_KEY must be set.\n"
            "  export OUTSCRAPER_API_KEY=your_api_key\n"
            "Get your key at https://app.outscraper.com/profile",
            file=sys.stderr,
        )
        return 1

    # --- Discovery mode: search Maps, then score the discovered businesses ---
    if args.discover:
        print(
            f"[prospect] discovering: {args.discover!r} "
            f"(limit={args.discover_limit}, region={args.region})",
            file=sys.stderr,
        )
        places = discover_businesses(
            api_key, args.discover, args.discover_limit, args.region
        )
        if not places:
            print("ERROR: discovery returned no businesses.", file=sys.stderr)
            return 1
        compact = [_compact_place(p) for p in places]
        kept = [
            p for p in compact
            if p["place_id"] and p["total_reviews"] >= args.min_reviews
        ]
        print(
            f"[prospect] discovered {len(places)}; "
            f"{len(kept)} kept (>= {args.min_reviews} reviews)",
            file=sys.stderr,
        )
        if not kept:
            print(
                "ERROR: no discovered businesses passed the --min-reviews filter.",
                file=sys.stderr,
            )
            return 1
        # Save the full discovered list to a sidecar (/tmp) — never committed.
        disc_path = args.out.rsplit(".", 1)[0] + "_discovered.json"
        try:
            with open(disc_path, "w", encoding="utf-8") as f:
                json.dump(kept, f, indent=2)
            print(f"[prospect] discovered list: {disc_path}", file=sys.stderr)
        except OSError as exc:
            print(
                f"[prospect] WARN: could not write discovered list: {exc}",
                file=sys.stderr,
            )
        # Resolve reviews by place_id (precise); carry name/metadata for output.
        queries = [p["place_id"] for p in kept]
        meta = {p["place_id"]: p for p in kept}
        run_standard(
            queries=queries,
            depth=args.depth,
            workers=args.workers,
            api_key=api_key,
            out_path=args.out,
            meta=meta,
            db_path=args.db or None,
        )
        return 0

    # --- Input-file mode ---
    try:
        queries = load_queries(args.input)
    except FileNotFoundError:
        print(f"ERROR: input file not found: {args.input}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"ERROR reading input file: {exc}", file=sys.stderr)
        return 1

    if not queries:
        print("ERROR: input file contains no valid business entries.", file=sys.stderr)
        return 1

    print(f"[prospect] loaded {len(queries)} business(es)", file=sys.stderr)

    if args.depth_sweep:
        run_depth_sweep(
            queries=queries,
            workers=args.workers,
            api_key=api_key,
            out_path=args.out,
        )
    else:
        run_standard(
            queries=queries,
            depth=args.depth,
            workers=args.workers,
            api_key=api_key,
            out_path=args.out,
            db_path=args.db or None,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
