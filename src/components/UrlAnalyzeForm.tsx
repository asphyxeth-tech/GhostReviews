"use client";

import { useState } from "react";
import { AnalysisReport } from "./AnalysisReport";
import type { AnalyzeResponse } from "@/lib/analysis-schema";

type DirectPhase = "idle" | "submitting" | "success" | "error";

const URL_RE = /^https?:\/\/.+/i;

export function UrlAnalyzeForm() {
  const [url, setUrl] = useState("");

  const [directPhase, setDirectPhase] = useState<DirectPhase>("idle");

  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  const isBusy = directPhase === "submitting";

  function resetSharedState() {
    setErrorMessage("");
    setResult(null);
    setDirectPhase("idle");
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
              // hangs around while they're typing a new URL to scan. We
              // don't reset during an in-flight submit because that single
              // round-trip can't be canceled from the UI anyway.
              if (showError || showResult) {
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

        {/* The public Tower "Full audit" button used to live here. The deep
            audit is expensive and now runs admin-side only (pending Tower's
            retirement), so the free instant scan is the only public entry. */}
        <p className="mt-3 text-sm text-[color:var(--muted)]">
          Free instant scan. Public review data only. Create a free account to
          unlock the flagged reviews.
        </p>

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
