/**
 * POST /api/analyze-tower
 *
 * Triggers a Tower run of the ghost-reviews app for the given
 * business URL. Returns the run's sequence number immediately. The browser
 * is expected to poll GET /api/analyze-tower/{runSeq} until the run reaches
 * a terminal status and the parsed AnalyzeResponse is returned.
 *
 * This is the async / pipeline-mode counterpart to /api/analyze (which
 * calls Claude directly and returns the result in one round-trip). Both
 * routes coexist; this one demonstrates Tower as the analysis runtime.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  TowerError,
  getTowerConfig,
  triggerTowerRun,
} from "@/lib/tower";

// Vercel Hobby caps Node functions at 10s by default. Triggering a
// Tower run is normally fast, but the upstream control-plane call can
// occasionally take a few seconds. Bump to the Hobby max for headroom.
export const maxDuration = 60;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  url: z.string().url(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = RequestSchema.parse(body);

    const config = getTowerConfig();
    const run = await triggerTowerRun(config, { business_url: url });

    return NextResponse.json({
      app_name: config.appName,
      run_seq: run.number,
      status: run.status,
      business_url: url,
      triggered_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Please paste a valid URL." },
        { status: 400 },
      );
    }
    if (err instanceof TowerError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status ?? 502 },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Tower trigger failed: ${message}` },
      { status: 500 },
    );
  }
}
