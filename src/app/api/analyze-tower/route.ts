/**
 * POST /api/analyze-tower — ADMIN-ONLY (internal), pending Tower retirement.
 *
 * Triggers a Tower run of the ghost-reviews app for the given
 * business URL. Returns the run's sequence number immediately. The caller
 * is expected to poll GET /api/analyze-tower/{runSeq} until the run reaches
 * a terminal status and the parsed AnalyzeResponse is returned.
 *
 * Each run is expensive (cloud run + 200-review scrape + a big Claude call,
 * ~$0.55+), so this is no longer a public surface: only the operator
 * (ADMIN_EMAILS allowlist) can trigger it. Tower is on the retirement path —
 * the paid deep audit will move to the Outscraper/TypeScript path — so this
 * gate is the holding position, not a customer feature.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  TowerError,
  getTowerConfig,
  triggerTowerRun,
} from "@/lib/tower";
import { getAdminUser } from "@/lib/admin";

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
  // Admin gate first — the deep audit is the most expensive path in the app,
  // and it's internal-only until Tower is retired. No rate limiting needed on
  // top: an allowlist of one is the strictest throttle there is.
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    console.error("[/api/analyze-tower] failed:", err);
    return NextResponse.json(
      { error: "Could not start the deep audit — please try again." },
      { status: 500 },
    );
  }
}
