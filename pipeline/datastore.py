"""Local-first flywheel store for prospect.py (stdlib SQLite, zero infra).

Every business prospect.py scans is recorded here — score, signals, and the
suspicious reviews that drove it (incl. each reviewer's author_id). Over time
this becomes the proprietary, outcome-labeled dataset we use to refine the
scoring algorithm (see docs/METHODOLOGY.md).

Two purposes:
  1. Cache / dataset: one row per scanned business.
  2. Reviewer convergence (FREE, Phase 1): logging author_id lets us spot the
     same account flagged across multiple businesses we've scanned — pure local
     SQL, no extra API calls.

The DB file is local and NEVER committed (gitignored) — it contains target
business data. Graduate to Supabase when volume warrants.

This module has no third-party deps and makes no network calls, so it is fully
unit-testable offline.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

DEFAULT_DB_PATH = "pipeline/prospect_store.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scans (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id          TEXT,
    business_name     TEXT,
    query             TEXT,
    total_reviews     INTEGER,
    scan_depth        INTEGER,
    prefilter_score   INTEGER,
    anchor_fired      INTEGER,          -- 0/1
    rules_fired       TEXT,             -- json array
    counts            TEXT,             -- json object
    scanned_at        TEXT,
    -- labels we backfill as outcomes resolve (the training signal):
    outcome_label     TEXT,             -- real_attack | clean | unknown
    claude_verified   INTEGER,          -- 0/1/NULL
    outreach_status   TEXT              -- none | emailed | replied | converted
);

CREATE TABLE IF NOT EXISTS flagged_reviews (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id                INTEGER,
    place_id               TEXT,
    business_name          TEXT,
    review_id              TEXT,
    author_id              TEXT,        -- enables cross-business convergence
    author_name            TEXT,
    rating                 INTEGER,
    posted_at              TEXT,
    reviewer_total_reviews INTEGER,
    textless               INTEGER,     -- 0/1
    text_snippet           TEXT,
    FOREIGN KEY (scan_id) REFERENCES scans (id)
);

CREATE INDEX IF NOT EXISTS idx_flagged_author ON flagged_reviews (author_id);
CREATE INDEX IF NOT EXISTS idx_scans_place    ON scans (place_id);
"""


def _connect(db_path: str) -> sqlite3.Connection:
    parent = os.path.dirname(os.path.abspath(db_path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: str = DEFAULT_DB_PATH) -> None:
    """Create the tables if they don't exist (idempotent)."""
    conn = _connect(db_path)
    try:
        conn.executescript(_SCHEMA)
        conn.commit()
    finally:
        conn.close()


def record_scans(scan_records: list[dict], db_path: str = DEFAULT_DB_PATH) -> int:
    """Persist a batch of scan records.  Best-effort: returns the number of
    scans written, or 0 on any failure (never raises — must not break a run).

    Each record:
        {
          "place_id", "business_name", "query", "total_reviews", "scan_depth",
          "prefilter_score", "anchor_fired" (bool), "rules_fired" (list),
          "counts" (dict), "scanned_at" (iso str | omitted -> now),
          "flagged_reviews": [
             {"review_id", "author_id", "author_name", "rating", "posted_at",
              "reviewer_total_reviews", "textless" (bool), "text_snippet"}, ...
          ],
        }
    """
    if not scan_records:
        return 0
    try:
        conn = _connect(db_path)
    except (sqlite3.Error, OSError):
        return 0
    written = 0
    try:
        conn.executescript(_SCHEMA)
        for rec in scan_records:
            now = rec.get("scanned_at") or datetime.now(timezone.utc).isoformat()
            cur = conn.execute(
                """INSERT INTO scans
                   (place_id, business_name, query, total_reviews, scan_depth,
                    prefilter_score, anchor_fired, rules_fired, counts, scanned_at,
                    outcome_label, claude_verified, outreach_status)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    rec.get("place_id"),
                    rec.get("business_name"),
                    rec.get("query"),
                    _as_int(rec.get("total_reviews")),
                    _as_int(rec.get("scan_depth")),
                    _as_int(rec.get("prefilter_score")),
                    1 if rec.get("anchor_fired") else 0,
                    json.dumps(rec.get("rules_fired") or []),
                    json.dumps(rec.get("counts") or {}),
                    now,
                    rec.get("outcome_label"),
                    rec.get("claude_verified"),
                    rec.get("outreach_status"),
                ),
            )
            scan_id = cur.lastrowid
            for fr in rec.get("flagged_reviews") or []:
                conn.execute(
                    """INSERT INTO flagged_reviews
                       (scan_id, place_id, business_name, review_id, author_id,
                        author_name, rating, posted_at, reviewer_total_reviews,
                        textless, text_snippet)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        scan_id,
                        rec.get("place_id"),
                        rec.get("business_name"),
                        fr.get("review_id"),
                        fr.get("author_id"),
                        fr.get("author_name"),
                        _as_int(fr.get("rating")),
                        fr.get("posted_at"),
                        _as_int(fr.get("reviewer_total_reviews")),
                        1 if fr.get("textless") else 0,
                        (fr.get("text_snippet") or "")[:200],
                    ),
                )
            written += 1
        conn.commit()
    except sqlite3.Error:
        return 0
    finally:
        conn.close()
    return written


def recurring_authors(db_path: str = DEFAULT_DB_PATH, min_businesses: int = 2) -> list[dict]:
    """Accounts flagged across >= min_businesses distinct businesses — the
    free, Phase-1 cross-business convergence signal (likely serial bombers)."""
    try:
        conn = _connect(db_path)
    except (sqlite3.Error, OSError):
        return []
    try:
        conn.executescript(_SCHEMA)
        rows = conn.execute(
            """SELECT author_id,
                      MAX(author_name)        AS author_name,
                      COUNT(DISTINCT place_id) AS business_count,
                      GROUP_CONCAT(DISTINCT business_name) AS businesses
               FROM flagged_reviews
               WHERE author_id IS NOT NULL AND author_id != ''
               GROUP BY author_id
               HAVING business_count >= ?
               ORDER BY business_count DESC""",
            (min_businesses,),
        ).fetchall()
        return [dict(r) for r in rows]
    except sqlite3.Error:
        return []
    finally:
        conn.close()


def stats(db_path: str = DEFAULT_DB_PATH) -> dict:
    """Summary stats for the store (for --db-stats)."""
    try:
        conn = _connect(db_path)
    except (sqlite3.Error, OSError):
        return {}
    try:
        conn.executescript(_SCHEMA)
        total = conn.execute("SELECT COUNT(*) FROM scans").fetchone()[0]
        anchored = conn.execute(
            "SELECT COUNT(*) FROM scans WHERE anchor_fired = 1"
        ).fetchone()[0]
        candidates = conn.execute(
            "SELECT COUNT(*) FROM scans WHERE prefilter_score >= 50"
        ).fetchone()[0]
        distinct_authors = conn.execute(
            "SELECT COUNT(DISTINCT author_id) FROM flagged_reviews "
            "WHERE author_id IS NOT NULL AND author_id != ''"
        ).fetchone()[0]
        return {
            "total_scans": total,
            "anchored": anchored,
            "candidates_ge_50": candidates,
            "distinct_flagged_authors": distinct_authors,
            "recurring_authors": len(recurring_authors(db_path)),
        }
    except sqlite3.Error:
        return {}
    finally:
        conn.close()


def print_stats(db_path: str = DEFAULT_DB_PATH) -> None:
    """Human-readable store summary + the recurring-author convergence list."""
    s = stats(db_path)
    if not s:
        print(f"[datastore] no store at {db_path} (or it's empty).")
        return
    print(f"=== flywheel store: {db_path} ===")
    print(f"  total scans recorded : {s['total_scans']}")
    print(f"  with an anchor fired : {s['anchored']}")
    print(f"  candidates (>= 50)   : {s['candidates_ge_50']}")
    print(f"  distinct flagged authors : {s['distinct_flagged_authors']}")
    recurring = recurring_authors(db_path)
    print(f"\n  recurring authors (flagged across >= 2 businesses): {len(recurring)}")
    for r in recurring[:25]:
        print(
            f"    {r['author_name'] or r['author_id']}: "
            f"{r['business_count']} businesses -> {r['businesses']}"
        )


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
