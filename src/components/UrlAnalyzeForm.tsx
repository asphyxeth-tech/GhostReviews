"use client";

import { useState } from "react";
import { AnalysisReport } from "./AnalysisReport";
import type { AnalyzeResponse } from "@/lib/analysis-schema";

type Status = "idle" | "submitting" | "success" | "error";

export function UrlAnalyzeForm() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || !/^https?:\/\/.+/i.test(trimmed)) {
      setStatus("error");
      setErrorMessage(
        "That doesn't look like a URL. Paste a full link starting with https://",
      );
      return;
    }
    setStatus("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(
          (body as { error?: string }).error ||
            `Request failed (${res.status})`,
        );
      }

      const data = (await res.json()) as AnalyzeResponse;
      setResult(data);
      setStatus("success");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setStatus("error");
      setErrorMessage(message);
    }
  }

  return (
    <div className="w-full">
      <form
        onSubmit={handleSubmit}
        className="mx-auto w-full max-w-2xl"
        noValidate
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            placeholder="Paste your Google Business Profile URL"
            className="flex-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 text-base text-[color:var(--foreground)] placeholder:text-[color:var(--muted)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30"
            aria-label="Google Business Profile URL"
            autoComplete="off"
            required
          />
          <button
            type="submit"
            disabled={status === "submitting"}
            className="rounded-lg bg-[color:var(--accent)] px-6 py-3 text-base font-semibold text-black transition hover:bg-[color:var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "submitting" ? (
              <span className="animate-accent-pulse">Scanning…</span>
            ) : (
              "Scan for fraud signals"
            )}
          </button>
        </div>
        <p className="mt-3 text-sm text-[color:var(--muted)]">
          Free analysis. No login. Public review data only.
        </p>
        {status === "error" && errorMessage && (
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
