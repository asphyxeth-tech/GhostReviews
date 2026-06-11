"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowser } from "@/lib/supabase/client";

type Phase = "idle" | "sending" | "sent" | "error";

/**
 * Magic-link sign-in: customer enters their email, gets a one-time
 * link, clicks it, lands signed in. No passwords to forget or leak.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const supabase = createSupabaseBrowser();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;

    setPhase("sending");
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setPhase("error");
      setErrorMessage(error.message);
    } else {
      setPhase("sent");
    }
  }

  return (
    <div className="ghost-bg flex flex-1 flex-col">
      <header className="px-6 py-6 sm:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 font-mono text-base tracking-tight"
          >
            <span
              aria-hidden
              className="glow-pulse inline-block h-2 w-2 rounded-full bg-[color:var(--accent)]"
            />
            <span>ghost.reviews</span>
          </Link>
        </div>
      </header>

      <section className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="w-full max-w-md">
          <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-3 text-sm leading-relaxed text-[color:var(--muted-strong)]">
            We&apos;ll email you a one-time sign-in link — no password
            needed. Signed-in scans are saved to your dashboard
            automatically.
          </p>

          {!supabase ? (
            <div className="mt-8 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 text-sm text-[color:var(--muted-strong)]">
              Accounts aren&apos;t enabled in this environment yet. The free
              scan on the{" "}
              <Link href="/" className="text-[color:var(--accent)] underline">
                homepage
              </Link>{" "}
              works without one.
            </div>
          ) : phase === "sent" ? (
            <div className="mt-8 rounded-lg border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 px-4 py-4 text-sm text-[color:var(--muted-strong)]">
              <strong className="text-[color:var(--foreground)]">
                Check your email.
              </strong>{" "}
              We sent a sign-in link to{" "}
              <span className="text-[color:var(--foreground)]">{email}</span>.
              It expires in about an hour.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourbusiness.com"
                  required
                  autoComplete="email"
                  className="flex-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 text-base text-[color:var(--foreground)] placeholder:text-[color:var(--muted)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30"
                  aria-label="Email address"
                />
                <button
                  type="submit"
                  disabled={phase === "sending"}
                  className="rounded-lg bg-[color:var(--accent)] px-6 py-3 text-base font-semibold text-black transition hover:bg-[color:var(--accent-glow)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {phase === "sending" ? "Sending…" : "Email me a link"}
                </button>
              </div>
              {phase === "error" && (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 px-4 py-3 text-sm text-[color:var(--muted-strong)]"
                >
                  {errorMessage}
                </div>
              )}
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
