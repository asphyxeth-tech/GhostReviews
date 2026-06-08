import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { analyzeReviewsWithClaude } from "@/lib/anthropic";
import { MOCK_REVIEWS, MOCK_REPORT } from "@/lib/mock-data";
import {
  AnalyzeResponseSchema,
  type AnalyzeResponse,
  type RatingSummary,
  type Review,
} from "@/lib/analysis-schema";

// Vercel Hobby tier caps Node functions at 10 seconds by default.
// Nimble + Claude in series can easily exceed that, so bump the cap
// for this route. (Vercel max for Hobby is 60s.)
export const maxDuration = 60;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RequestSchema = z.object({
  url: z.string().url(),
});

// Nimble's real-time SERP endpoint. Verified against a live key:
//   - Auth is Bearer (NOT Basic — Basic returns 401).
//   - The reliable turnkey path for a business is the `google_maps_search`
//     engine, which returns a structured place entity that includes a
//     sample of recent reviews (`top_reviews`) AND the business-wide
//     rating distribution (`review_summary`).
//   - Nimble also exposes a `google_maps_reviews` engine for the full
//     chronological list, but its structured parser was returning
//     transient "failed to parse" errors, so we rely on the always-clean
//     search result and degrade to the bundled sample on any hiccup.
const NIMBLE_ENDPOINT = "https://api.webit.live/api/v1/realtime/serp";
const NIMBLE_TIMEOUT_MS = 20000;
const SHORTLINK_TIMEOUT_MS = 8000;

type NimbleScrape = {
  reviews: Review[];
  rating_summary: RatingSummary | null;
};

/**
 * Turn whatever the owner pasted — a business name, a "name + city"
 * string, a full Google Maps URL, or a maps.app.goo.gl short link — into
 * a plain-text query Nimble's google_maps_search understands.
 */
async function deriveSearchQuery(input: string): Promise<string> {
  const raw = input.trim();
  let target = raw;

  // Short links carry no business name; resolve the redirect first.
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

  // A canonical maps URL embeds the business name: /maps/place/<NAME>/...
  const placeMatch = target.match(/\/maps\/place\/([^/@]+)/);
  if (placeMatch) {
    const name = decodeURIComponent(placeMatch[1].replace(/\+/g, " ")).trim();
    if (name) return name;
  }

  // Any other URL: fall back to its ?q= / ?query= search param if present.
  try {
    const u = new URL(target);
    const q = u.searchParams.get("q") || u.searchParams.get("query");
    if (q) return q.trim();
  } catch {
    // Not a URL — that's fine, it's a typed query like "Joe's Pizza NYC".
  }

  return raw;
}

// Nimble returns review_timestamp as epoch milliseconds (13 digits).
// Be tolerant of plain seconds (10 digits) too. Falls back to "now".
function toIsoTimestamp(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n) && n > 0) {
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Scrape a business's reviews via Nimble.
 *
 * Returns null (and never throws) when:
 *   - NIMBLE_API_KEY isn't set
 *   - the request times out / is non-2xx / unparseable
 *   - the response contains no usable place or reviews
 *
 * The route falls back to MOCK_REVIEWS on null so the demo flow is never
 * broken by an upstream hiccup.
 */
async function fetchReviewsViaNimble(url: string): Promise<NimbleScrape | null> {
  const apiKey = process.env.NIMBLE_API_KEY;
  if (!apiKey) return null;

  const query = await deriveSearchQuery(url);
  if (!query) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NIMBLE_TIMEOUT_MS);

  try {
    const res = await fetch(NIMBLE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        search_engine: "google_maps_search",
        query,
        domain: "com",
        country: "US",
        locale: "en",
        parse: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const payload: unknown = await res.json().catch(() => null);
    if (!payload || typeof payload !== "object") return null;

    // Parsed places live at parsing.entities.SearchResult[]; take the
    // top hit (Nimble orders by relevance to the query).
    const root = payload as Record<string, unknown>;
    const parsing = root.parsing as Record<string, unknown> | undefined;
    const entities = parsing?.entities as Record<string, unknown> | undefined;
    const results = entities?.SearchResult;
    const place =
      Array.isArray(results) && results.length > 0
        ? (results[0] as Record<string, unknown>)
        : null;
    if (!place) return null;

    const rawReviews = Array.isArray(place.top_reviews)
      ? (place.top_reviews as unknown[])
      : [];

    const reviews: Review[] = rawReviews.map((raw, index) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const ratingNum = Number(r.rating);
      const totalNum = Number(r.user_review_count);
      return {
        id: `nimble-${index}`,
        reviewer_name:
          typeof r.username === "string" && r.username.trim()
            ? r.username
            : "Anonymous",
        reviewer_total_reviews: Number.isFinite(totalNum)
          ? Math.trunc(totalNum)
          : 0,
        rating: Number.isFinite(ratingNum)
          ? Math.min(5, Math.max(1, Math.round(ratingNum)))
          : 1,
        posted_at: toIsoTimestamp(r.review_timestamp),
        text: typeof r.description === "string" ? r.description : "",
      };
    });

    if (reviews.length === 0) return null;

    // Business-wide rating distribution — a real baseline for the
    // "rating distribution anomalies" signal.
    let rating_summary: RatingSummary | null = null;
    const rs = place.review_summary as Record<string, unknown> | undefined;
    if (rs && typeof rs === "object") {
      const counts: Record<string, number> = {};
      const rc = rs.ratings_count as Record<string, unknown> | undefined;
      if (rc && typeof rc === "object") {
        for (const [k, v] of Object.entries(rc)) {
          const n = Number(v);
          if (Number.isFinite(n)) counts[k] = Math.trunc(n);
        }
      }
      const overall = Number(rs.overall_rating);
      const reviewCount = Number(rs.review_count);
      rating_summary = {
        overall_rating: Number.isFinite(overall) ? overall : 0,
        review_count: Number.isFinite(reviewCount)
          ? Math.trunc(reviewCount)
          : reviews.length,
        ratings_count: counts,
      };
    }

    return { reviews, rating_summary };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = RequestSchema.parse(body);

    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const mode: "stub" | "live" = hasKey ? "live" : "stub";

    // In stub mode the canned MOCK_REPORT flags specific review IDs from
    // MOCK_REVIEWS — so we must NOT swap in Nimble-scraped reviews there,
    // or the UI would label a Nimble batch with a report that doesn't
    // match it. Only call Nimble when we're actually going to analyze
    // those reviews with Claude. (Also saves a redundant Nimble request.)
    const scrape = hasKey ? await fetchReviewsViaNimble(url) : null;
    const haveLive = Boolean(scrape && scrape.reviews.length > 0);
    const reviews = haveLive ? scrape!.reviews : MOCK_REVIEWS;
    const reviewsSource: "nimble" | "mock" = haveLive ? "nimble" : "mock";

    const report = hasKey
      ? await analyzeReviewsWithClaude(
          url,
          reviews,
          haveLive ? scrape!.rating_summary : null,
        )
      : MOCK_REPORT;

    const response: AnalyzeResponse = {
      mode,
      business_url: url,
      generated_at: new Date().toISOString(),
      reviews_source: reviewsSource,
      report,
    };

    return NextResponse.json(AnalyzeResponseSchema.parse(response));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Please paste a valid URL." },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Analysis failed: ${message}` },
      { status: 500 },
    );
  }
}
