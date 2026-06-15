// DataForSEO-backed Google reviews source.
//
// Why this exists: it replaces the brittle, hand-parsed Nimble path with a
// clean, structured API. DataForSEO returns named JSON fields (no guessing at
// Google's internal array offsets), at ~$0.000075 per review.
//
// One important shape difference from Nimble: DataForSEO has NO synchronous
// endpoint for reviews. Reviews are TASK-BASED — you POST a job, then poll for
// the result ("within minutes"). Only `my_business_info` is live/synchronous.
// So this module:
//   1. calls `my_business_info/live` (sync) to resolve the business and grab
//      the all-time rating distribution baseline, then
//   2. POSTs a reviews task (priority queue, for the user-facing web path) and
//      polls it for a bounded budget.
// If the task doesn't finish inside the poll budget, we return null and the
// caller (src/lib/reviews.ts) falls back to Nimble — so the synchronous
// "instant scan" still returns something rather than hanging.
import type { RatingSummary, Review } from "./analysis-schema";
import { deriveSearchQuery } from "./nimble";

const BASE_URL = "https://api.dataforseo.com/v3";
const REQUEST_TIMEOUT_MS = 20000;

// Reviews are task-based; this is how long the synchronous web path will wait
// for a task to finish before giving up and letting the caller fall back to
// Nimble. Most tasks finish well inside this; the ceiling just bounds the wait.
const REVIEWS_POLL_BUDGET_MS = 60000;
const REVIEWS_POLL_INTERVAL_MS = 3000;

// DataForSEO requires a location on every call. With a resolved cid/place_id
// the business is already pinned globally, so this mostly sets Google's
// locale/proxy. Defaults to the US; override per-market via env if a keyword
// lookup resolves the wrong region (e.g. 2124 = Canada, 2826 = UK).
const DEFAULT_LOCATION_CODE = 2840;

export type DataForSeoScrape = {
  reviews: Review[];
  rating_summary: RatingSummary | null;
};

// ---------- helpers ----------

// Safe nested getter — returns undefined instead of throwing on any miss.
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

// HTTP Basic auth from the login+password pair. Returns null (not an error)
// when unconfigured, so the caller can fall back gracefully.
function getAuthHeader(): string | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  const token = Buffer.from(`${login}:${password}`).toString("base64");
  return `Basic ${token}`;
}

function getLocationCode(): number {
  const raw = process.env.DATAFORSEO_LOCATION_CODE;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : DEFAULT_LOCATION_CODE;
}

// DataForSEO review timestamps look like "2024-05-05 14:09:32 +00:00".
// Normalize to ISO 8601; fall back to "now" if it can't be parsed.
function toIso(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    // "2024-05-05 14:09:32 +00:00" -> "2024-05-05T14:09:32+00:00"
    const normalized = value.trim().replace(" ", "T").replace(" ", "");
    const d = new Date(normalized);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    const fallback = new Date(value);
    if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();
  }
  return new Date().toISOString();
}

async function dfsPost(
  path: string,
  auth: string,
  body: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: auth,
      },
      body: JSON.stringify(body),
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

async function dfsGet(
  path: string,
  auth: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: auth },
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

// ---------- business info (live / synchronous) ----------

type BusinessInfo = {
  cid?: string;
  placeId?: string;
  ratingSummary: RatingSummary | null;
};

function buildRatingSummary(item: unknown): RatingSummary | null {
  const overall = Number(dig(item, ["rating", "value"]));
  const votes = Number(dig(item, ["rating", "votes_count"]));
  const dist = dig(item, ["rating_distribution"]);
  const counts: Record<string, number> = {};
  if (dist && typeof dist === "object") {
    for (const s of ["1", "2", "3", "4", "5"]) {
      const v = Number((dist as Record<string, unknown>)[s]);
      if (Number.isFinite(v)) counts[s] = Math.trunc(v);
    }
  }
  if (
    !Number.isFinite(overall) &&
    !Number.isFinite(votes) &&
    Object.keys(counts).length === 0
  ) {
    return null;
  }
  return {
    overall_rating: Number.isFinite(overall) ? overall : 0,
    review_count: Number.isFinite(votes) ? Math.trunc(votes) : 0,
    ratings_count: counts,
  };
}

// Resolve the business (cid/place_id) and grab its all-time rating
// distribution in one synchronous call. Returns null on any miss.
async function fetchBusinessInfo(
  auth: string,
  query: string,
  locationCode: number,
): Promise<BusinessInfo | null> {
  const resp = await dfsPost("/business_data/google/my_business_info/live", auth, [
    {
      keyword: query,
      location_code: locationCode,
      language_code: "en",
      tag: "ghost-reviews",
    },
  ]);
  const item = dig(resp, ["tasks", 0, "result", 0, "items", 0]);
  if (item == null) return null;
  const cid = dig(item, ["cid"]);
  const placeId = dig(item, ["place_id"]);
  return {
    cid: typeof cid === "string" && cid ? cid : undefined,
    placeId: typeof placeId === "string" && placeId ? placeId : undefined,
    ratingSummary: buildRatingSummary(item),
  };
}

// ---------- reviews (task-based / asynchronous) ----------

// POST a reviews task; return the task UUID we'll poll, or null.
async function postReviewsTask(
  auth: string,
  identifier: Record<string, string>,
  locationCode: number,
  depth: number,
): Promise<string | null> {
  const resp = await dfsPost("/business_data/google/reviews/task_post", auth, [
    {
      ...identifier,
      location_code: locationCode,
      language_code: "en",
      depth,
      sort_by: "newest", // chronological — essential for fresh-attack + incremental scans
      priority: 2, // priority queue: faster turnaround for the user-facing path
      tag: "ghost-reviews",
    },
  ]);
  const id = dig(resp, ["tasks", 0, "id"]);
  return typeof id === "string" && id ? id : null;
}

// Poll task_get until the result has items, the task reports done-with-no-data,
// or we exhaust the budget. task_get is free, so polling has no per-call cost.
async function pollReviewsTask(auth: string, taskId: string): Promise<unknown[] | null> {
  const deadline = Date.now() + REVIEWS_POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    const resp = await dfsGet(
      `/business_data/google/reviews/task_get/${taskId}`,
      auth,
    );
    const items = dig(resp, ["tasks", 0, "result", 0, "items"]);
    if (Array.isArray(items) && items.length > 0) return items;

    // Task finished but produced no reviews — stop early instead of waiting out
    // the full budget for data that will never arrive.
    const statusCode = Number(dig(resp, ["tasks", 0, "status_code"]));
    const resultCount = Number(dig(resp, ["tasks", 0, "result_count"]));
    if (statusCode === 20000 && resultCount === 0) return [];

    await sleep(REVIEWS_POLL_INTERVAL_MS);
  }
  return null;
}

// Map DataForSEO review items onto our Review schema, applying the optional
// `sinceMs` watermark (for incremental "only what's new" scans).
function mapReviewItems(items: unknown, sinceMs?: number): Review[] {
  if (!Array.isArray(items)) return [];
  const out: Review[] = [];
  items.forEach((item, i) => {
    const ratingVal = Number(dig(item, ["rating", "value"]));
    if (!Number.isFinite(ratingVal)) return; // not a review row

    const postedAt = toIso(dig(item, ["timestamp"]));
    if (sinceMs != null && Date.parse(postedAt) < sinceMs) return;

    const id = dig(item, ["review_id"]);
    const name = dig(item, ["profile_name"]);
    const count = Number(dig(item, ["reviews_count"]));
    const text = dig(item, ["review_text"]); // null for textless reviews -> ""

    out.push({
      id: typeof id === "string" && id ? id : `dataforseo-${i}`,
      reviewer_name: typeof name === "string" && name.trim() ? name : "Anonymous",
      reviewer_total_reviews: Number.isFinite(count) ? Math.trunc(count) : 0,
      rating: Math.min(5, Math.max(1, Math.round(ratingVal))),
      posted_at: postedAt,
      text: typeof text === "string" ? text : "",
    });
  });
  return out;
}

/**
 * Top-level entry point. Returns null (never throws) when DataForSEO is
 * unconfigured, the business can't be resolved, or no reviews come back in
 * time — the caller falls back to Nimble on null.
 */
export async function scrapeBusinessReviews(
  input: string,
  maxReviews: number,
  sinceMs?: number,
): Promise<DataForSeoScrape | null> {
  const auth = getAuthHeader();
  if (!auth) return null;

  const query = await deriveSearchQuery(input);
  if (!query) return null;

  const locationCode = getLocationCode();
  const info = await fetchBusinessInfo(auth, query, locationCode);

  // Identify the business for the reviews task: cid > place_id > raw keyword.
  // cid/place_id are exact; keyword is a last resort that can mis-resolve.
  const identifier: Record<string, string> = info?.cid
    ? { cid: info.cid }
    : info?.placeId
      ? { place_id: info.placeId }
      : { keyword: query };

  // DataForSEO bills/operates `depth` in multiples of 10; round up.
  const depth = Math.max(10, Math.ceil(maxReviews / 10) * 10);

  const taskId = await postReviewsTask(auth, identifier, locationCode, depth);
  if (!taskId) return null;

  const items = await pollReviewsTask(auth, taskId);
  let reviews = mapReviewItems(items, sinceMs);
  reviews.sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));
  reviews = reviews.slice(0, maxReviews);
  if (reviews.length === 0) return null;

  return { reviews, rating_summary: info?.ratingSummary ?? null };
}
