/**
 * GET /api/analyze-tower/[runSeq]
 *
 * Polls a Tower run's status. If the run is still in flight, returns its
 * current status. If terminal-success (`exited`), fetches the run's logs,
 * extracts the JSON result emitted on the `__GHOST_RESULT__:` sentinel
 * line, and returns the parsed AnalyzeResponse.
 *
 * The browser is expected to call this repeatedly (~every 2s) until
 * `terminal: true` in the response, then render the report.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  TowerError,
  extractResultFromLogs,
  getTowerConfig,
  getTowerRun,
  getTowerRunLogs,
  isTerminalStatus,
} from "@/lib/tower";
import { AnalyzeResponseSchema } from "@/lib/analysis-schema";

// Vercel Hobby caps Node functions at 10s by default. The poll itself
// is fast, but fetching Tower logs once the run is terminal can take a
// few seconds. Bump to the Hobby max (60s) for headroom.
export const maxDuration = 60;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runSeq: string }> },
) {
  const { runSeq: runSeqStr } = await params;
  const runSeq = Number(runSeqStr);

  if (!Number.isInteger(runSeq) || runSeq <= 0) {
    return NextResponse.json(
      { error: "runSeq must be a positive integer" },
      { status: 400 },
    );
  }

  try {
    const config = getTowerConfig();
    const run = await getTowerRun(config, runSeq);
    const terminal = isTerminalStatus(run.status);

    if (!terminal) {
      return NextResponse.json({
        terminal: false,
        status: run.status,
        run_seq: run.number,
        app_name: config.appName,
      });
    }

    if (run.status !== "exited") {
      const logs = await getTowerRunLogs(config, runSeq);
      return NextResponse.json(
        {
          terminal: true,
          status: run.status,
          run_seq: run.number,
          app_name: config.appName,
          error: `Tower run did not exit cleanly (status=${run.status}).`,
          tail: logs.slice(-30).map((l) => l.content),
        },
        { status: 502 },
      );
    }

    const logs = await getTowerRunLogs(config, runSeq);
    const result = extractResultFromLogs(logs);
    if (!result) {
      return NextResponse.json(
        {
          terminal: true,
          status: run.status,
          run_seq: run.number,
          app_name: config.appName,
          error:
            "Tower run exited but no __GHOST_RESULT__ sentinel line was found in the logs.",
          tail: logs.slice(-30).map((l) => l.content),
        },
        { status: 502 },
      );
    }

    // Older Tower deploys may not emit a `reviews_source` field yet —
    // fall back to "mock" for back-compat so the schema validation below
    // doesn't reject an otherwise-good run.
    const reviewsSource = result.reviews_source ?? "mock";

    const payload = {
      terminal: true as const,
      status: run.status,
      run_seq: run.number,
      app_name: config.appName,
      engine: "tower" as const,
      mode: result.mode,
      business_url: result.business_url,
      generated_at: new Date().toISOString(),
      reviews_source: reviewsSource,
      report: result.report,
    };

    // Validate the AnalyzeResponse-shaped subset of the payload before
    // returning. Malformed pipeline output should fail loudly here,
    // not silently render a broken report in the UI.
    const validation = AnalyzeResponseSchema.safeParse({
      mode: payload.mode,
      business_url: payload.business_url,
      generated_at: payload.generated_at,
      reviews_source: payload.reviews_source,
      report: payload.report,
    });
    if (!validation.success) {
      return NextResponse.json(
        {
          terminal: true,
          status: run.status,
          run_seq: run.number,
          app_name: config.appName,
          error:
            "Tower run produced output that does not match the AnalyzeResponse schema.",
          issues: validation.error.issues,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof TowerError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status ?? 502 },
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Tower poll failed: ${message}` },
      { status: 500 },
    );
  }
}
