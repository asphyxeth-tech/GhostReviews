// Outscraper Google Maps SEARCH — business discovery (/maps/search-v3).
//
// The TS counterpart of discover_businesses() in pipeline/prospect.py: search
// Google Maps for businesses by "category, city" and get back a list with each
// business's name, place_id, total review count, rating, and rating
// distribution. Async trigger + poll, same pattern as the reviews client.
//
// Used only by the protected admin prospecting routes (server-side).

const BASE_URL = "https://api.app.outscraper.com";
const SEARCH_PATH = "/maps/search-v3";
const TRIGGER_TIMEOUT_MS = 20000;
const POLL_BUDGET_MS = 120000;
const POLL_INTERVAL_MS = 4000;

export type DiscoveredBusiness = {
  name: string;
  place_id: string;
  full_address: string;
  total_reviews: number;
  rating: number | null;
  type: string;
  phone: string;
  site: string;
  reviews_per_score: Record<string, number> | null;
};

function getApiKey(): string | null {
  const k = process.env.OUTSCRAPER_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function dig(obj: unknown, path: Array<number | string>): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

async function getJson(url: string, apiKey: string, timeoutMs: number): Promise<unknown> {
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

// /maps/search-v3 returns {status, data: [[place, ...]]} — one inner list per
// query. We send one query, so places live at data[0]. Tolerate {data:[...]}
// and a bare list too.
function findPlaces(resp: unknown): Record<string, unknown>[] {
  const data = dig(resp, ["data"]);
  let candidates: unknown;
  if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
    candidates = data[0];
  } else if (Array.isArray(data)) {
    candidates = data;
  } else if (Array.isArray(resp)) {
    candidates = resp;
  } else {
    candidates = [];
  }
  return (candidates as unknown[]).filter(
    (p): p is Record<string, unknown> =>
      Boolean(p) &&
      typeof p === "object" &&
      Boolean((p as Record<string, unknown>).place_id || (p as Record<string, unknown>).name),
  );
}

function toBusiness(p: Record<string, unknown>): DiscoveredBusiness {
  const totalRaw = Number(p.reviews);
  const ratingRaw = Number(p.rating);
  const rps = p.reviews_per_score;
  let reviews_per_score: Record<string, number> | null = null;
  if (rps && typeof rps === "object" && !Array.isArray(rps)) {
    reviews_per_score = {};
    for (const s of ["1", "2", "3", "4", "5"]) {
      const v = Number((rps as Record<string, unknown>)[s]);
      if (Number.isFinite(v)) reviews_per_score[s] = Math.trunc(v);
    }
  }
  return {
    name: typeof p.name === "string" ? p.name : "",
    place_id:
      (typeof p.place_id === "string" && p.place_id) ||
      (typeof p.cid === "string" && p.cid) ||
      "",
    full_address: typeof p.full_address === "string" ? p.full_address : "",
    total_reviews: Number.isFinite(totalRaw) ? Math.trunc(totalRaw) : 0,
    rating: Number.isFinite(ratingRaw) ? ratingRaw : null,
    type: typeof p.type === "string" ? p.type : "",
    phone: typeof p.phone === "string" ? p.phone : "",
    site: typeof p.site === "string" ? p.site : "", // Outscraper field is "site"
    reviews_per_score,
  };
}

/**
 * Discover businesses for a "category, city" query (e.g. "auto repair, London,
 * Ontario, Canada"). Returns [] on failure. `limit` maps to Outscraper's
 * organizationsPerQueryLimit; `region` is an ISO-3166 alpha-2 bias.
 */
export async function discoverBusinesses(
  query: string,
  opts: { limit?: number; region?: string } = {},
): Promise<DiscoveredBusiness[]> {
  const apiKey = getApiKey();
  if (!apiKey || !query.trim()) return [];

  const params = new URLSearchParams({
    query,
    organizationsPerQueryLimit: String(Math.max(1, opts.limit ?? 50)),
    language: "en",
    region: opts.region ?? "CA",
    dropDuplicates: "true",
    async: "true",
  });
  const trigger = await getJson(
    `${BASE_URL}${SEARCH_PATH}?${params.toString()}`,
    apiKey,
    TRIGGER_TIMEOUT_MS,
  );

  const id = dig(trigger, ["id"]);
  const loc = dig(trigger, ["results_location"]);
  const pollUrl =
    typeof loc === "string" && loc
      ? loc
      : typeof id === "string" && id
        ? `${BASE_URL}/requests/${id}`
        : null;

  // Some responses come back synchronously.
  if (!pollUrl) {
    return findPlaces(trigger).map(toBusiness);
  }

  const deadline = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    const r = await getJson(pollUrl, apiKey, TRIGGER_TIMEOUT_MS);
    const places = findPlaces(r);
    if (places.length > 0) return places.map(toBusiness);
    if (dig(r, ["status"]) === "Error" || dig(r, ["status"]) === "Failed") return [];
    await sleep(POLL_INTERVAL_MS);
  }
  return [];
}
