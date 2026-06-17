// Outscraper-backed Google reviews source.
//
// Why Outscraper: clean, structured review JSON (named fields — no guessing at
// Google's internal array offsets like the Nimble path), pure pay-as-you-go
// (500 free reviews/month, then ~$3/1k), and — crucially — it has BOTH a
// synchronous and an asynchronous mode:
//
//   - sync  (async=false): one HTTP call, returns in seconds for small pulls.
//     This is what the fast "instant scan" uses.
//   - async (async=true): returns a request id; poll results until done
//     (minutes OK). This is for the deep audit, where there's no time ceiling.
//
// Either way, if Outscraper isn't configured / errors / is too slow, this
// returns null and the caller (src/lib/reviews.ts) falls back to Nimble.
import type { RatingSummary, Review } from "./analysis-schema";
import { deriveSearchQuery } from "./nimble";

const BASE_URL = "https://api.app.outscraper.com";
const REVIEWS_PATH = "/maps/reviews-v3";

// Sync mode: bounded so a slow response fails over to Nimble instead of
// hanging the instant scan. Most 40-review sync pulls return well inside this.
const SYNC_TIMEOUT_MS = 25000;
// Async mode (deep audit): polling budget + interval. Minutes are fine here.
const ASYNC_TRIGGER_TIMEOUT_MS = 20000;
const ASYNC_POLL_BUDGET_MS = 240000;
const ASYNC_POLL_INTERVAL_MS = 8000;

export type OutscraperScrape = {
  reviews: Review[];
  rating_summary: RatingSummary | null;
};

export type ScrapeOptions = {
  sinceMs?: number;
  // deep=true uses the async path (deep audit); default false = fast sync path.
  deep?: boolean;
};

// ---------- helpers ----------

function dig(obj: unknown, path: Array<number | string>): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getApiKey(): string | null {
  const k = process.env.OUTSCRAPER_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

// review_timestamp is unix EPOCH SECONDS (e.g. 1560692128). Tolerate ms/us too,
// and fall back to the "MM/DD/YYYY HH:MM:SS" review_datetime_utc string.
function toIso(ts: unknown, datetimeUtc?: unknown): string {
  const n = typeof ts === "number" ? ts : Number(ts);
  if (Number.isFinite(n) && n > 0) {
    const ms = n > 1e15 ? Math.floor(n / 1000) : n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof datetimeUtc === "string" && datetimeUtc.trim()) {
    // "06/16/2019 13:35:28" -> "2019-06-16 13:35:28"
    const normalized = datetimeUtc.replace(
      /(\d{2})\/(\d{2})\/(\d{4})/,
      "$3-$1-$2",
    );
    const d = new Date(`${normalized} UTC`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

// Outscraper's response wrapping varies (bare array, {data:[...]}, {data:[[...]]},
// {status,data}). Rather than guess, walk the structure and return the first
// object that actually carries a `reviews_data` array — the place object.
function findPlace(resp: unknown): Record<string, unknown> | null {
  const queue: unknown[] = [resp];
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const cur = queue.shift();
    if (Array.isArray(cur)) {
      for (const x of cur) queue.push(x);
    } else if (cur && typeof cur === "object") {
      const o = cur as Record<string, unknown>;
      if (Array.isArray(o.reviews_data)) return o;
      for (const v of Object.values(o)) {
        if (v && typeof v === "object") queue.push(v);
      }
    }
  }
  return null;
}

function mapReviews(place: Record<string, unknown>, sinceMs?: number): Review[] {
  const arr = place.reviews_data;
  if (!Array.isArray(arr)) return [];
  const out: Review[] = [];
  arr.forEach((item, i) => {
    const rating = Number(dig(item, ["review_rating"]));
    if (!Number.isFinite(rating)) return; // not a review row

    const postedAt = toIso(
      dig(item, ["review_timestamp"]),
      dig(item, ["review_datetime_utc"]),
    );
    if (sinceMs != null && Date.parse(postedAt) < sinceMs) return;

    const id = dig(item, ["review_id"]);
    // Reviewer name uses Outscraper's "autor" typo; accept "author" too.
    const name = dig(item, ["autor_name"]) ?? dig(item, ["author_name"]);
    // Reviewer's lifetime review count — the key fraud signal. Null-safe.
    const count = Number(dig(item, ["author_reviews_count"]));
    const text = dig(item, ["review_text"]);

    out.push({
      id: typeof id === "string" && id ? id : `outscraper-${i}`,
      reviewer_name: typeof name === "string" && name.trim() ? name : "Anonymous",
      reviewer_total_reviews: Number.isFinite(count) ? Math.trunc(count) : 0,
      rating: Math.min(5, Math.max(1, Math.round(rating))),
      posted_at: postedAt,
      text: typeof text === "string" ? text : "",
    });
  });
  return out;
}

function buildRatingSummary(place: Record<string, unknown>): RatingSummary | null {
  const overall = Number(place.rating);
  const count = Number(place.reviews);
  const rps = place.reviews_per_score;
  const counts: Record<string, number> = {};
  if (rps && typeof rps === "object" && !Array.isArray(rps)) {
    for (const s of ["1", "2", "3", "4", "5"]) {
      const v = Number((rps as Record<string, unknown>)[s]);
      if (Number.isFinite(v)) counts[s] = Math.trunc(v);
    }
  } else if (typeof rps === "string") {
    // Occasionally delivered as "1: 6, 2: 0, 3: 4, ..." — parse defensively.
    for (const part of rps.split(",")) {
      const m = part.trim().match(/^([1-5])\s*:\s*(\d+)/);
      if (m) counts[m[1]] = Number(m[2]);
    }
  }
  if (
    !Number.isFinite(overall) &&
    !Number.isFinite(count) &&
    Object.keys(counts).length === 0
  ) {
    return null;
  }
  return {
    overall_rating: Number.isFinite(overall) ? overall : 0,
    review_count: Number.isFinite(count) ? Math.trunc(count) : 0,
    ratings_count: counts,
  };
}

// ---------- network ----------

async function getJson(
  url: string,
  apiKey: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-API-KEY": apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function buildReviewsUrl(
  query: string,
  maxReviews: number,
  isAsync: boolean,
  sinceMs?: number,
): string {
  const url = new URL(BASE_URL + REVIEWS_PATH);
  url.searchParams.set("query", query);
  url.searchParams.set("reviewsLimit", String(maxReviews));
  url.searchParams.set("sort", "newest"); // chronological — fresh-attack + incremental
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", "1"); // one place per query
  url.searchParams.set("async", isAsync ? "true" : "false");
  if (sinceMs != null) {
    url.searchParams.set("cutoff", String(Math.floor(sinceMs / 1000)));
  }
  return url.toString();
}

// Async path: trigger the job, then poll its results URL until it's done or we
// run out of budget.
async function fetchAsync(
  apiKey: string,
  query: string,
  maxReviews: number,
  sinceMs?: number,
): Promise<unknown> {
  const trigger = await getJson(
    buildReviewsUrl(query, maxReviews, true, sinceMs),
    apiKey,
    ASYNC_TRIGGER_TIMEOUT_MS,
  );
  const id = dig(trigger, ["id"]);
  const loc = dig(trigger, ["results_location"]);
  const pollUrl =
    typeof loc === "string" && loc
      ? loc
      : typeof id === "string" && id
        ? `${BASE_URL}/requests/${id}`
        : null;
  if (!pollUrl) return null;

  const deadline = Date.now() + ASYNC_POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    const r = await getJson(pollUrl, apiKey, ASYNC_TRIGGER_TIMEOUT_MS);
    const status = dig(r, ["status"]);
    if (findPlace(r)) return r;
    if (status === "Error" || status === "Failed") return null;
    await sleep(ASYNC_POLL_INTERVAL_MS);
  }
  return null;
}

/**
 * Top-level entry point. Returns null (never throws) when Outscraper is
 * unconfigured, the business can't be resolved, or no reviews come back in
 * time — the caller falls back to Nimble on null.
 */
export async function scrapeBusinessReviews(
  input: string,
  maxReviews: number,
  opts: ScrapeOptions = {},
): Promise<OutscraperScrape | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const query = await deriveSearchQuery(input);
  if (!query) return null;

  const limit = Math.max(1, Math.trunc(maxReviews));
  const resp = opts.deep
    ? await fetchAsync(apiKey, query, limit, opts.sinceMs)
    : await getJson(
        buildReviewsUrl(query, limit, false, opts.sinceMs),
        apiKey,
        SYNC_TIMEOUT_MS,
      );

  const place = findPlace(resp);
  if (!place) return null;

  let reviews = mapReviews(place, opts.sinceMs);
  reviews.sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));
  reviews = reviews.slice(0, limit);
  if (reviews.length === 0) return null;

  return { reviews, rating_summary: buildRatingSummary(place) };
}
