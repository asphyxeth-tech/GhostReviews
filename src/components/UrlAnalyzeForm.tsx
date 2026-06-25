"use client";

import { useEffect, useRef, useState } from "react";
import { AnalysisReport } from "./AnalysisReport";
import type { AnalyzeResponse } from "@/lib/analysis-schema";

type DirectPhase = "idle" | "submitting" | "success" | "error";

type TowerPhase =
  | "idle"
  | "triggering" // POST /api/analyze-tower
  | "polling" // GET /api/analyze-tower/[seq] until terminal
  | "success"
  | "error";

type TowerProgress = {
  runSeq: number;
  appName: string;
  status: string;
  startedAt: number;
  elapsedMs: number;
};

const POLL_INTERVAL_MS = 2500;
// The full audit analyzes ~200 reviews at high effort with no server-side
// time limit — runs can legitimately take several minutes. Each poll is its
// own cheap request, so a generous client-side window costs nothing.
const MAX_POLL_MS = 300_000;

const URL_RE = /^https?:\/\/.+/i;

export function UrlAnalyzeForm() {
  const [url, setUrl] = useState("");

  const [directPhase, setDirectPhase] = useState<DirectPhase>("idle");
  const [towerPhase, setTowerPhase] = useState<TowerPhase>("idle");

  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  const [tower, setTower] = useState<TowerProgress | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const isBusy = directPhase === "submitting" || towerPhase === "triggering" || towerPhase === "polling";

  function resetSharedState() {
    setErrorMessage("");
    setResult(null);
    setDirectPhase("idle");
    setTowerPhase("idle");
    setTower(null);
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function validateUrl(): string | null {
    const trimmed = url.trim();
    if (!trimmed || !URL_RE.test(trimmed)) {
      return "That doesn't look like a URL. Paste a full link starting with https://";
    }
    return null;
  }

  async function handleDirectSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validateUrl();
    if (validationError) {
      resetSharedState();
      setDirectPhase("error");
      setErrorMessage(validationError);
      return;
    }
    resetSharedState();
    setDirectPhase("submitting");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(
          (body as { error?: string }).error || `Request failed (${res.status})`,
        );
      }
      const data = (await res.json()) as AnalyzeResponse;
      setResult(data);
      setDirectPhase("success");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setDirectPhase("error");
      setErrorMessage(message);
    }
  }

  async function handleTowerSubmit() {
    const validationError = validateUrl();
    if (validationError) {
      resetSharedState();
      setTowerPhase("error");
      setErrorMessage(validationError);
      return;
    }
    resetSharedState();
    setTowerPhase("triggering");

    try {
      const trig = await fetch("/api/analyze-tower", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!trig.ok) {
        const body = await trig.json().catch(() => ({}) as { error?: string });
        throw new Error(
          (body as { error?: string }).error ||
            `Tower trigger failed (${trig.status})`,
        );
      }
      const triggerData = (await trig.json()) as {
        run_seq: number;
        app_name: string;
        status: string;
      };
      const startedAt = Date.now();
      setTower({
        runSeq: triggerData.run_seq,
        appName: triggerData.app_name,
        status: triggerData.status,
        startedAt,
        elapsedMs: 0,
      });
      setTowerPhase("polling");

      pollTimer.current = setInterval(async () => {
        try {
          const elapsedMs = Date.now() - startedAt;
          if (elapsedMs > MAX_POLL_MS) {
            if (pollTimer.current) clearInterval(pollTimer.current);
            setTowerPhase("error");
            setErrorMessage(
              `The full audit is taking longer than ${Math.round(MAX_POLL_MS / 1000 / 60)} minutes. ` +
                `It may still complete in the background — try the scan again in a few minutes.`,
            );
            return;
          }

          const poll = await fetch(
            `/api/analyze-tower/${triggerData.run_seq}`,
            { method: "GET" },
          );
          const pollData = await poll.json().catch(() => ({}));

          if (!poll.ok) {
            if (pollTimer.current) clearInterval(pollTimer.current);
            setTowerPhase("error");
            setErrorMessage(
              (pollData as { error?: string }).error ||
                `Tower poll failed (${poll.status})`,
            );
            return;
          }

          setTower((prev) =>
            prev
              ? {
                  ...prev,
                  status: (pollData as { status?: string }).status ?? prev.status,
                  elapsedMs,
                }
              : prev,
          );

          if ((pollData as { terminal?: boolean }).terminal) {
            if (pollTimer.current) clearInterval(pollTimer.current);
            const data = pollData as AnalyzeResponse & { terminal: true };
            setResult(data);
            setTowerPhase("success");
          }
        } catch (e) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setTowerPhase("error");
          setErrorMessage(e instanceof Error ? e.message : "Polling failed");
        }
      }, POLL_INTERVAL_MS);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setTowerPhase("error");
      setErrorMessage(message);
    }
  }

  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    },
    [],
  );

  const showResult = result !== null;
  const showError = !showResult && errorMessage !== "";

  return (
    <div className="w-full">
      <form
        onSubmit={handleDirectSubmit}
        className="mx-auto w-full max-w-2xl"
        noValidate
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              // Reset state when the user edits the URL after either an
              // error OR a successful result — otherwise the stale report
              // hangs around while they're typing a new URL to scan.
              // Also abandon an in-flight Tower trigger/poll cleanly so a
              // late callback can't overwrite state with stale data; we
              // don't reset during a direct Claude submit because that
              // single round-trip can't be canceled from the UI anyway.
              if (
                showError ||
                showResult ||
                towerPhase === "polling" ||
                towerPhase === "triggering"
              ) {
                resetSharedState();
              }
            }}
            placeholder="Paste your Google Business Profile URL"
            className="flex-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 text-base text-[color:var(--foreground)] placeholder:text-[color:var(--muted)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30"
            aria-label="Google Business Profile URL"
            autoComplete="off"
            required
          />
          <button
            type="submit"
            disabled={isBusy}
            className="rounded-lg bg-[color:var(--accent)] px-6 py-3 text-base font-semibold text-black transition hover:bg-[color:var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {directPhase === "submitting" ? (
              <span className="animate-accent-pulse">Scanning…</span>
            ) : (
              "Scan for fraud signals"
            )}
          </button>
        </div>

        <div className="mt-3 flex flex-col items-start gap-2 text-sm text-[color:var(--muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            Free instant scan. Public review data only. Create a free account to
            unlock the flagged reviews.
          </p>
          <button
            type="button"
            onClick={handleTowerSubmit}
            disabled={isBusy}
            className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1.5 text-xs font-medium text-[color:var(--muted-strong)] transition hover:border-[color:var(--accent)]/50 hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
            title="A deeper scan that audits hundreds of your most recent reviews. Takes a few minutes."
          >
            {towerPhase === "triggering" ? (
              <span className="animate-accent-pulse">Starting full audit…</span>
            ) : towerPhase === "polling" ? (
              <span className="animate-accent-pulse">Audit: {tower?.status ?? "running"}…</span>
            ) : (
              "Full audit — hundreds of reviews"
            )}
          </button>
        </div>

        {towerPhase === "polling" && tower && (
          <div
            role="status"
            className="mt-5 rounded-lg border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 px-4 py-3 text-sm text-[color:var(--muted-strong)]"
          >
            <strong className="text-[color:var(--foreground)]">
              Full audit in progress
            </strong>{" "}
            · status: <code className="font-mono">{tower.status}</code> ·{" "}
            {(tower.elapsedMs / 1000).toFixed(0)}s elapsed. Deep scans analyze
            hundreds of reviews and can take a few minutes.
          </div>
        )}

        {showError && (
          <div
            role="alert"
            className="mt-5 rounded-lg border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 px-4 py-3 text-sm text-[color:var(--muted-strong)]"
          >
            {errorMessage}
          </div>
        )}
      </form>

      {result && (
        <div className="mx-auto mt-12 w-full max-w-3xl">
          <AnalysisReport data={result} />
        </div>
      )}
    </div>
  );
}
