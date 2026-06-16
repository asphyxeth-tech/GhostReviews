// Nimble-backed Google reviews scraper.
//
// What we learned probing Nimble's API against a live key:
//   - Auth is Bearer (Basic returns 401).
//   - `google_maps_search` returns a structured place entity (place_id,
//     review_summary distribution, a small top_reviews sample).
//   - `google_maps_reviews` returns the real review stream, BUT Nimble's
//     structured parser for it is currently broken ("failed to parse").
//     The raw Google payload is still in `html_content`, and the response
//     includes the underlying Google `listugcposts` URL in `input_url`.
//   - We parse that raw payload ourselves and paginate by injecting
//     Google's "next page" token into the URL's `!2s` slot, fetching each
//     subsequent page through Nimble's web unblocker (/v1/extract).
//   - `sort: "newest"` makes the stream chronological (newest first) —
//     essential for catching fresh review-bombing and for incremental scans.
//
// Net result: real depth (hundreds of reviews), newest-first, with
// reviewer name, rating, text, exact timestamp, and the reviewer's total
// review count — the signals our analysis needs.
import type { RatingSummary, Review } from "./analysis-schema";

const REALTIME_ENDPOINT = "https://api.webit.live/api/v1/realtime/serp";
const EXTRACT_ENDPOINT = "https://sdk.nimbleway.com/v1/extract";
const REQUEST_TIMEOUT_MS = 20000;
const SHORTLINK_TIMEOUT_MS = 8000;

export type NimbleScrape = {
  reviews: Review[];
  rating_summary: RatingSummary | null;
};

/**
 * Turn whatever the owner pasted — a business name, a "name + city"
 * string, a full Google Maps URL, or a maps.app.goo.gl short link — into
 * a plain-text query Nimble's google_maps_search understands.
 */
export async function deriveSearchQuery(input: string): Promise<string> {
  const raw = input.trim();
  let target = raw;

  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl)\//i.test(raw)) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), SHORTLINK_TIMEOUT_MS);
    try {
      const res = await fetch(raw, {
        redirect: "follow",
        signal: controller.signal,
      });
      target = res.url || raw;
    } catch {
      target = raw;
    } finally {
      clearTimeout(t);
    }
  }

  const placeMatch = target.match(/\/maps\/place\/([^/@]+)/);
  if (placeMatch) {
    const name = decodeURIComponent(placeMatch[1].replace(/\+/g, " ")).trim();
    if (name) return name;
  }

  try {
    const u = new URL(target);
    const q = u.searchParams.get("q") || u.searchParams.get("query");
    if (q) return q.trim();
  } catch {
    // Not a URL — it's a typed query like "Joe's Pizza NYC".
  }

  return raw;
}

// ---------- raw-payload parsing helpers ----------

// Safe nested getter — returns undefined instead of throwing on any miss.
function dig(obj: unknown, path: Array<number | string>): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

// Google's review timestamps are epoch microseconds (16 digits). Tolerate
// milliseconds (13) and seconds (10) too. Falls back to "now".
function toIso(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n) && n > 0) {
    const ms = n > 1e15 ? Math.floor(n / 1000) : n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

// Google guards JSON with a `)]}'` prefix line; strip it then parse.
function parseGoogleJson(body: string): unknown {
  const idx = body.indexOf(")]}'");
  if (idx === -1) return null;
  const after = body.slice(idx + 4);
  const nl = after.indexOf("\n");
  const jsonStr = nl === -1 ? after : after.slice(nl + 1);
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

type RawPage = { reviews: Review[]; nextToken: string | null };

// A listugcposts page is [null, "<next_token>", [ ...review entries... ]].
// Each entry's payload is entry[0]; field offsets verified empirically.
function parseReviewsPage(page: unknown, startIndex: number): RawPage {
  const list = dig(page, [2]);
  const nextRaw = dig(page, [1]);
  const nextToken = typeof nextRaw === "string" && nextRaw ? nextRaw : null;
  const reviews: Review[] = [];

  if (Array.isArray(list)) {
    list.forEach((entry, i) => {
      const R = dig(entry, [0]);
      if (R == null) return;

      const rating = Number(dig(R, [2, 0, 0]));
      if (!Number.isFinite(rating)) return; // not a review row

      const id = dig(R, [0]);
      const name = dig(R, [1, 4, 5, 0]);
      const text = dig(R, [2, 15, 0, 0]);

      let count = Number(dig(R, [1, 4, 5, 5]));
      if (!Number.isFinite(count)) {
        // Fallback: parse "Local Guide · 207 reviews".
        const label = dig(R, [1, 4, 5, 10, 0]);
        if (typeof label === "string") {
          const m = label.match(/([\d,]+)\s+reviews?/i);
          if (m) count = Number(m[1].replace(/,/g, ""));
        }
      }

      reviews.push({
        id: typeof id === "string" ? id : `nimble-${startIndex + i}`,
        reviewer_name:
          typeof name === "string" && name.trim() ? name : "Anonymous",
        reviewer_total_reviews: Number.isFinite(count) ? Math.trunc(count) : 0,
        rating: Math.min(5, Math.max(1, Math.round(rating))),
        posted_at: toIso(dig(R, [1, 2])),
        text: typeof text === "string" ? text : "",
      });
    });
  }

  return { reviews, nextToken };
}

// ---------- network ----------

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
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

// Nimble's live-scraping endpoints occasionally return a transient empty
// result; a quick retry reliably gets the page on the next try.
async function withRetry<T>(
  fn: () => Promise<T | null>,
  attempts = 2,
  delayMs = 600,
): Promise<T | null> {
  let result: T | null = null;
  for (let i = 0; i < attempts; i++) {
    result = await fn();
    if (result) return result;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  return result;
}

type Place = {
  placeId: string;
  ratingSummary: RatingSummary | null;
  topReviews: Review[];
};

function buildRatingSummary(rs: unknown, fallbackCount: number): RatingSummary | null {
  if (!rs || typeof rs !== "object") return null;
  const counts: Record<string, number> = {};
  const rc = dig(rs, ["ratings_count"]);
  if (rc && typeof rc === "object") {
    for (const [k, v] of Object.entries(rc as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) counts[k] = Math.trunc(n);
    }
  }
  const overall = Number(dig(rs, ["overall_rating"]));
  const reviewCount = Number(dig(rs, ["review_count"]));
  return {
    overall_rating: Number.isFinite(overall) ? overall : 0,
    review_count: Number.isFinite(reviewCount)
      ? Math.trunc(reviewCount)
      : fallbackCount,
    ratings_count: counts,
  };
}

// The small, always-clean review sample from google_maps_search — used as
// a fallback if the deep reviews stream comes back empty.
function mapTopReviews(place: unknown): Review[] {
  const raw = dig(place, ["top_reviews"]);
  if (!Array.isArray(raw)) return [];
  return raw.map((r, i) => {
    const rec = (r ?? {}) as Record<string, unknown>;
    const rating = Number(rec.rating);
    const total = Number(rec.user_review_count);
    return {
      id: `nimble-top-${i}`,
      reviewer_name:
        typeof rec.username === "string" && rec.username.trim()
          ? rec.username
          : "Anonymous",
      reviewer_total_reviews: Number.isFinite(total) ? Math.trunc(total) : 0,
      rating: Number.isFinite(rating)
        ? Math.min(5, Math.max(1, Math.round(rating)))
        : 1,
      posted_at: toIso(rec.review_timestamp),
      text: typeof rec.description === "string" ? rec.description : "",
    };
  });
}

async function fetchPlace(apiKey: string, query: string): Promise<Place | null> {
  const place = await withRetry(async () => {
    const payload = await postJson(REALTIME_ENDPOINT, apiKey, {
      search_engine: "google_maps_search",
      query,
      domain: "com",
      country: "US",
      locale: "en",
      parse: true,
    });
    const p = dig(payload, ["parsing", "entities", "SearchResult", 0]);
    const pid = dig(p, ["place_id"]);
    return typeof pid === "string" && pid ? p : null;
  });
  if (place == null) return null;
  const placeId = dig(place, ["place_id"]) as string;
  const topReviews = mapTopReviews(place);
  return {
    placeId,
    ratingSummary: buildRatingSummary(dig(place, ["review_summary"]), topReviews.length),
    topReviews,
  };
}

// Fetch an arbitrary URL through Nimble's web unblocker; return raw body.
// Retries since extract is live-scraping and can blip transiently.
async function fetchRawViaExtract(apiKey: string, url: string): Promise<string | null> {
  return withRetry(async () => {
    const payload = await postJson(EXTRACT_ENDPOINT, apiKey, { url, render: false });
    const html = dig(payload, ["data", "html"]);
    if (typeof html === "string") return html;
    const alt = dig(payload, ["html_content"]);
    return typeof alt === "string" ? alt : null;
  });
}

/**
 * Pull reviews newest-first, paginating until `maxReviews` is reached, the
 * stream ends, or (when `sinceMs` is set) we cross into reviews older than
 * the watermark — the mechanism behind incremental "only what's new" scans.
 */
async function fetchReviewsDeep(
  apiKey: string,
  placeId: string,
  maxReviews: number,
  sinceMs?: number,
): Promise<Review[]> {
  const first = await withRetry(async () => {
    const r = await postJson(REALTIME_ENDPOINT, apiKey, {
      search_engine: "google_maps_reviews",
      place_id: placeId,
      domain: "com",
      country: "US",
      locale: "en",
      parse: true,
      sort: "newest",
    });
    const iu = dig(r, ["input_url"]);
    const raw = dig(r, ["html_content"]);
    return typeof iu === "string" && typeof raw === "string" ? r : null;
  });
  const inputUrl = dig(first, ["input_url"]);
  const rawFirst = dig(first, ["html_content"]);
  if (typeof rawFirst !== "string" || typeof inputUrl !== "string") return [];

  const passes = (r: Review) => sinceMs == null || Date.parse(r.posted_at) >= sinceMs;

  const collected: Review[] = [];
  const seen = new Set<string>();
  const absorb = (page: RawPage): boolean => {
    // Returns false when we should stop (crossed the watermark).
    let crossed = false;
    for (const r of page.reviews) {
      if (!passes(r)) {
        crossed = true;
        continue;
      }
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      collected.push(r);
    }
    return !crossed;
  };

  const firstPage = parseReviewsPage(parseGoogleJson(rawFirst), 0);
  const reviews = firstPage.reviews;
  let nextToken = firstPage.nextToken;
  let keepGoing = absorb({ reviews, nextToken });

  const canPaginate = inputUrl.includes("!2s!5m2");
  while (keepGoing && canPaginate && nextToken && collected.length < maxReviews) {
    const pageUrl = inputUrl.replace("!2s!5m2", `!2s${nextToken.replace(/:/g, "%3A")}!5m2`);
    const raw = await fetchRawViaExtract(apiKey, pageUrl);
    if (!raw) break;
    const page = parseReviewsPage(parseGoogleJson(raw), collected.length);
    if (page.reviews.length === 0) break;
    keepGoing = absorb(page);
    if (!page.nextToken || page.nextToken === nextToken) break; // no progress
    nextToken = page.nextToken;
  }

  collected.sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));
  return collected.slice(0, maxReviews);
}

/**
 * Top-level entry point used by the API route. Returns null (never throws)
 * when there's no key, the place can't be found, or no reviews come back.
 */
export async function scrapeBusinessReviews(
  input: string,
  maxReviews: number,
  sinceMs?: number,
): Promise<NimbleScrape | null> {
  const apiKey = process.env.NIMBLE_API_KEY;
  if (!apiKey) return null;

  const query = await deriveSearchQuery(input);
  if (!query) return null;

  const place = await fetchPlace(apiKey, query);
  if (!place) return null;

  let reviews = await fetchReviewsDeep(apiKey, place.placeId, maxReviews, sinceMs);
  if (reviews.length === 0) reviews = place.topReviews; // graceful fallback
  if (reviews.length === 0) return null;

  return { reviews, rating_summary: place.ratingSummary };
}
