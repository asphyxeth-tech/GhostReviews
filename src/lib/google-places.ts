// Google Places API (New) — Text Search business discovery.
//
// The free, official, ToS-compliant replacement for Outscraper's Maps search in
// the DISCOVERY stage: a business's rating + total review count + category come
// back in the search response itself, so we discover + filter for ~free and only
// spend Outscraper review credits on the survivors. Mirrors discoverBusinesses()
// in outscraper-search.ts (same DiscoveredBusiness shape) so the discover route
// can swap providers transparently.
//
// ⚠️ NEVER request the `places.reviews` field. Google caps it at 5 reviews with
// no reviewer history and bills it at the top SKU — useless for fraud detection.
// ALL review text + reviewer lifetime counts (our actual signals) come from the
// paid deep-dive (Outscraper), never here. We deliberately only read
// rating/count/type for the cheap triage.
//
// Cost: requesting rating + userRatingCount bills Text Search at the Pro tier
// (~5,000 free events/month; one request of up to 20 results = 1 event). A full
// city sweep is ~30 requests, so it's effectively free at our volume.

import type { DiscoveredBusiness } from "./outscraper-search";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
// Only the fields we need for triage — adding phone/website/reviews would bump
// the billing SKU, and we get those from the Outscraper deep-dive anyway.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.primaryType",
  "places.formattedAddress",
  "nextPageToken",
].join(",");

const PAGE_SIZE = 20;
const MAX_PAGES = 3; // Google hard-caps Text Search at 60 results (3 pages of 20)
const PAGE_TOKEN_DELAY_MS = 2100; // the New API needs ~2s before a pageToken is valid
const REQUEST_TIMEOUT_MS = 15000;

function getApiKey(): string | null {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type RawPlace = {
  id?: string;
  displayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  primaryType?: string;
  formattedAddress?: string;
};

function toBusiness(p: RawPlace): DiscoveredBusiness {
  const count = Number(p.userRatingCount);
  const rating = Number(p.rating);
  return {
    name: p.displayName?.text ?? "",
    place_id: typeof p.id === "string" ? p.id : "",
    full_address:
      typeof p.formattedAddress === "string" ? p.formattedAddress : "",
    total_reviews: Number.isFinite(count) ? Math.trunc(count) : 0,
    rating: Number.isFinite(rating) ? rating : null,
    // primaryType is the cleanest single category; fall back to the first type.
    type: p.primaryType || (Array.isArray(p.types) && p.types[0]) || "",
    // Not requested at discovery (kept on the cheaper SKU) — the Outscraper
    // deep-dive captures phone/website when a business is actually scanned.
    phone: "",
    site: "",
    // Text Search doesn't return the per-star breakdown, so the 1★-share filter
    // is simply skipped for Google-discovered businesses.
    reviews_per_score: null,
  };
}

// One Text Search request, with exponential-backoff retry on transient errors
// (429/500/502/503), per the handoff brief. Fresh AbortController per attempt.
async function searchPage(
  apiKey: string,
  textQuery: string,
  regionCode: string,
  pageToken?: string,
): Promise<{ places: RawPlace[]; nextPageToken?: string } | null> {
  const body: Record<string, unknown> = {
    textQuery,
    pageSize: PAGE_SIZE,
    regionCode,
  };
  if (pageToken) body.pageToken = pageToken;

  for (let attempt = 0; attempt < 5; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (!json) return null;
        return {
          places: Array.isArray(json.places) ? (json.places as RawPlace[]) : [],
          nextPageToken:
            typeof json.nextPageToken === "string" ? json.nextPageToken : undefined,
        };
      }
      if ([429, 500, 502, 503].includes(res.status)) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return null; // non-transient error — give up (caller can fall back)
    } catch {
      clearTimeout(t);
      await sleep(1000 * 2 ** attempt);
    }
  }
  return null;
}

/**
 * Discover businesses for a "<niche>, <city>" query via Google Places Text
 * Search. Paginates to Google's 60-result cap (stops early once `limit` is hit).
 * `region` is an ISO-3166 alpha-2 bias. Returns [] when unconfigured or on
 * failure, so the caller can fall back to Outscraper discovery.
 */
export async function discoverBusinesses(
  query: string,
  opts: { limit?: number; region?: string } = {},
): Promise<DiscoveredBusiness[]> {
  const apiKey = getApiKey();
  if (!apiKey || !query.trim()) return [];
  const region = opts.region ?? "CA";
  const limit = Math.max(1, opts.limit ?? 20);

  const out: DiscoveredBusiness[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(PAGE_TOKEN_DELAY_MS); // let the pageToken validate
    const result = await searchPage(apiKey, query, region, pageToken);
    if (!result) break;
    for (const p of result.places) {
      const b = toBusiness(p);
      if (b.place_id) out.push(b);
    }
    if (!result.nextPageToken || out.length >= limit) break;
    pageToken = result.nextPageToken;
  }
  return out.slice(0, limit);
}
