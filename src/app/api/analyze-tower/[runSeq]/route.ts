/**
 * GET /api/analyze-tower/[runSeq] — ADMIN-ONLY (internal), pending Tower
 * retirement.
 *
 * Polls a Tower run's status. If the run is still in flight, returns its
 * current status. If terminal-success (`exited`), fetches the run's logs,
 * extracts the JSON result emitted on the `__GHOST_RESULT__:` sentinel
 * line, and returns the parsed AnalyzeResponse.
 *
 * The caller is expected to poll this (~every 2s) until `terminal: true`.
 * Run sequence numbers are small integers, so without a gate anyone could
 * enumerate them and harvest full paid reports — hence the same admin
 * allowlist gate as the trigger route, until Tower is retired.
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
import { getAdminUser } from "@/lib/admin";

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
  // Admin gate first — run results are the full paid deliverable, and the
  // run IDs are guessable. Internal-only until Tower is retired.
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
      // Fetch logs for server-side diagnostics, but don't leak raw pipeline
      // output to the browser.
      const logs = await getTowerRunLogs(config, runSeq);
      console.error(
        `[tower ${runSeq}] non-clean exit (${run.status}):`,
        logs.slice(-30).map((l) => l.content).join("\n"),
      );
      return NextResponse.json(
        {
          terminal: true,
          status: run.status,
          run_seq: run.number,
          app_name: config.appName,
          error: "The deep audit didn't finish cleanly — please try again.",
        },
        { status: 502 },
      );
    }

    const logs = await getTowerRunLogs(config, runSeq);
    const result = extractResultFromLogs(logs);
    if (!result) {
      console.error(
        `[tower ${runSeq}] exited but no __GHOST_RESULT__ sentinel:`,
        logs.slice(-30).map((l) => l.content).join("\n"),
      );
      return NextResponse.json(
        {
          terminal: true,
          status: run.status,
          run_seq: run.number,
          app_name: config.appName,
          error: "The deep audit finished but produced no result — please try again.",
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
      console.error(
        `[tower ${runSeq}] output failed schema validation:`,
        validation.error.issues,
      );
      return NextResponse.json(
        {
          terminal: true,
          status: run.status,
          run_seq: run.number,
          app_name: config.appName,
          error: "The deep audit produced an unexpected result — please try again.",
        },
        { status: 502 },
      );
    }

    // Deliberately NOT saved to any user's scan history. The old behavior
    // (saveScanIfAuthenticated here) wrote the report into whichever
    // signed-in account happened to poll — i.e. someone else's audit could
    // land in an arbitrary poller's dashboard. Admin runs don't need
    // customer-side persistence, so the save is simply gone.
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof TowerError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status ?? 502 },
      );
    }
    console.error(`[tower ${runSeq}] poll failed:`, err);
    return NextResponse.json(
      { error: "Couldn't check the deep audit status — please try again." },
      { status: 500 },
    );
  }
}
