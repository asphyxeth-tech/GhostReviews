import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { analyzeReviewsWithClaude } from "@/lib/anthropic";
import { MOCK_REVIEWS, MOCK_REPORT } from "@/lib/mock-data";
import {
  AnalyzeResponseSchema,
  type AnalyzeResponse,
} from "@/lib/analysis-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RequestSchema = z.object({
  url: z.string().url(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = RequestSchema.parse(body);

    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const mode: "stub" | "live" = hasKey ? "live" : "stub";

    const report = hasKey
      ? await analyzeReviewsWithClaude(url, MOCK_REVIEWS)
      : MOCK_REPORT;

    const response: AnalyzeResponse = {
      mode,
      business_url: url,
      generated_at: new Date().toISOString(),
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
