import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { analyzeReviewsWithClaude } from "@/lib/anthropic";
import { MOCK_REVIEWS, MOCK_REPORT } from "@/lib/mock-data";
import {
  AnalyzeResponseSchema,
  type AnalyzeResponse,
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

// Nimble's structured Google-reviews scrape. This is the v1 SERP surface
// (api.webit.live). Nimble's standard auth is Bearer; the endpoint URL
// and payload shape are best-effort against their docs and may need
// adjustment once we exercise against a real key.
const NIMBLE_ENDPOINT = "https://api.webit.live/api/v1/realtime/serp";
const NIMBLE_TIMEOUT_MS = 6000;

/**
 * Pull recent Google reviews for the given business URL via Nimble.
 *
 * Returns null (and never throws) when:
 *   - NIMBLE_API_KEY isn't set
 *   - the request times out
 *   - the response is non-2xx
 *   - the response body isn't parseable
 *   - the response shape doesn't contain a usable review list
 *
 * The route falls back to MOCK_REVIEWS on null so the demo flow is never
 * broken by an upstream hiccup.
 */
async function fetchReviewsViaNimble(url: string): Promise<Review[] | null> {
  const apiKey = process.env.NIMBLE_API_KEY;
  if (!apiKey) return null;

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
        url,
        parser: "google_maps_reviews",
        country: "US",
        locale: "en",
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const payload: unknown = await res.json().catch(() => null);
    if (!payload || typeof payload !== "object") return null;

    // Nimble's structured response wraps results in a few common shapes
    // depending on the parser. We try the most likely locations and bail
    // out silently if none of them contain a review array.
    const candidates: unknown[] = [];
    const root = payload as Record<string, unknown>;
    if (Array.isArray(root.reviews)) candidates.push(root.reviews);
    if (root.parsing && typeof root.parsing === "object") {
      const parsing = root.parsing as Record<string, unknown>;
      if (Array.isArray(parsing.entities)) candidates.push(parsing.entities);
      if (Array.isArray(parsing.reviews)) candidates.push(parsing.reviews);
    }
    if (root.data && typeof root.data === "object") {
      const data = root.data as Record<string, unknown>;
      if (Array.isArray(data.reviews)) candidates.push(data.reviews);
    }

    const rawReviews = candidates.find(
      (c): c is unknown[] => Array.isArray(c) && c.length > 0,
    );
    if (!rawReviews) return null;

    const reviews: Review[] = rawReviews.map((raw, index) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const rating = Number(r.rating ?? r.stars ?? 1);
      // Nimble sometimes returns the reviewer as a string field and
      // sometimes as a nested {name: "..."} object. Cover both shapes.
      const authorObj =
        r.author && typeof r.author === "object"
          ? (r.author as Record<string, unknown>)
          : null;
      const reviewerObj =
        r.reviewer && typeof r.reviewer === "object"
          ? (r.reviewer as Record<string, unknown>)
          : null;
      return {
        id: `nimble-${index}`,
        reviewer_name:
          typeof r.reviewer_name === "string"
            ? r.reviewer_name
            : typeof r.author === "string"
              ? r.author
              : typeof r.name === "string"
                ? r.name
                : authorObj && typeof authorObj.name === "string"
                  ? authorObj.name
                  : reviewerObj && typeof reviewerObj.name === "string"
                    ? reviewerObj.name
                    : "Anonymous",
        reviewer_total_reviews:
          typeof r.reviewer_total_reviews === "number"
            ? r.reviewer_total_reviews
            : typeof r.author_reviews_count === "number"
              ? r.author_reviews_count
              : 0,
        rating: Number.isFinite(rating)
          ? Math.min(5, Math.max(1, Math.round(rating)))
          : 1,
        posted_at:
          typeof r.posted_at === "string"
            ? r.posted_at
            : typeof r.date === "string"
              ? r.date
              : typeof r.published_at === "string"
                ? r.published_at
                : new Date().toISOString(),
        text:
          typeof r.text === "string"
            ? r.text
            : typeof r.snippet === "string"
              ? r.snippet
              : typeof r.review === "string"
                ? r.review
                : "",
      };
    });

    return reviews.length > 0 ? reviews : null;
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
    const liveReviews = hasKey ? await fetchReviewsViaNimble(url) : null;
    const reviews = liveReviews ?? MOCK_REVIEWS;
    const reviewsSource: "nimble" | "mock" = liveReviews ? "nimble" : "mock";

    const report = hasKey
      ? await analyzeReviewsWithClaude(url, reviews)
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
