"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

// The GitHub repo the audit prompt points the reviewing agent at.
const REPO_URL = "https://github.com/asphyxeth-tech/GhostReviews";

type Service = {
  id: string;
  name: string;
  category: string | null;
  website: string | null;
  manage_url: string | null;
  billing_model: string | null;
  monthly_cost: number | null;
  currency: string | null;
  status: string | null;
  wired: boolean;
  notes: string | null;
  updated_at?: string;
};

const CATEGORIES = [
  "hosting",
  "database",
  "ai",
  "scraping",
  "jobs",
  "email",
  "billing",
  "api",
  "domain",
  "other",
];
const BILLING = ["flat", "usage", "annual", "free"];

const EMPTY: Omit<Service, "id"> = {
  name: "",
  category: "other",
  website: "",
  manage_url: "",
  billing_model: "flat",
  monthly_cost: null,
  currency: "USD",
  status: "active",
  wired: true,
  notes: "",
};

// A ready-to-paste prompt for confirming whether a service is still used. Read-
// only by construction — it tells the reviewing agent to touch nothing.
function auditPrompt(s: Service): string {
  return `I'm reviewing whether we still use **${s.name}** in the Ghost Reviews codebase before deciding to keep or cancel its subscription.

Repo: ${REPO_URL}${s.website ? `\nService site: ${s.website}` : ""}

Please do a STRICTLY READ-ONLY review — do not change, edit, create, or delete any files. Exhaustively check every place this service could be wired in: environment variable names, package/SDK imports, API base URLs and hostnames, fetch/HTTP calls, config files, CI workflows, scripts, and docs. Account for fallback paths and dead code.

Then report back:
1. Verdict — currently used / partially used (e.g. fallback only) / appears unused — with exact file:line references for everything you found.
2. If it looks unused, tell me exactly where in the ${s.name} dashboard to look to 100% confirm there have been no recent API calls, logins, or usage (e.g. usage logs, activity/billing page, API-key "last used" date), so I don't cancel something that's actually live.

Do not make any code changes — this is a confirmation pass only.`;
}

function money(n: number | null, currency: string | null): string {
  if (n == null) return "—";
  return `${currency || "USD"} ${n.toFixed(2)}`;
}

export function CostDashboard({ email }: { email: string }) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // id | "new" | null
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/services");
      const data = await res.json();
      if (!res.ok) setError(data.error || "Failed to load.");
      else setServices(data.services || []);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
      setLoading(false);
    }
  }, []);

  // Fetch on mount. Wrapped in an async IIFE so the state writes inside load()
  // are deferred (not synchronously reachable from the effect body).
  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function save(form: Omit<Service, "id">, id: string | null) {
    setError(null);
    const isNew = id === null || id === "new";
    const res = await fetch("/api/admin/services", {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isNew ? form : { ...form, id }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Save failed.");
      return;
    }
    setEditing(null);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this service from the registry?")) return;
    const res = await fetch("/api/admin/services", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) load();
    else setError("Delete failed.");
  }

  async function copyPrompt(s: Service) {
    try {
      await navigator.clipboard.writeText(auditPrompt(s));
      setCopiedId(s.id);
      setTimeout(() => setCopiedId((c) => (c === s.id ? null : c)), 2000);
    } catch {
      setError("Couldn't copy to clipboard.");
    }
  }

  const active = services.filter((s) => s.status === "active");
  const inactive = services.filter((s) => s.status !== "active");
  const fixedMonthly = active
    .filter((s) => s.monthly_cost != null)
    .reduce((sum, s) => sum + (s.monthly_cost || 0), 0);
  const usage = active.filter((s) => s.billing_model === "usage");
  const candidates = active.filter((s) => !s.wired);

  return (
    <div className="ghost-bg min-h-screen px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-6xl">
        {/* Top bar */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-base tracking-tight">
            <span className="text-[color:var(--accent)]">/</span>ghostreviews
            <span className="text-[color:var(--accent)]">/</span>
            <span className="ml-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[color:var(--muted-strong)]">
              costs
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-[color:var(--muted)]">
            <Link href="/admin" className="hover:text-[color:var(--foreground)]">
              ← Prospecting
            </Link>
            <span>{email}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Infrastructure costs
            </h1>
            <p className="mt-1 text-sm text-[color:var(--muted-strong)]">
              Every service we pay for (or could), in one place. Costs are
              entered by hand — there&apos;s no shared billing API across vendors.
            </p>
          </div>
          <button
            onClick={() => setEditing("new")}
            className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)]"
          >
            + Add service
          </button>
        </div>

        {/* Summary */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
            <div className="text-2xl font-semibold tabular-nums">
              USD {fixedMonthly.toFixed(2)}
              <span className="text-sm font-normal text-[color:var(--muted)]">
                /mo
              </span>
            </div>
            <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
              tracked fixed monthly
            </div>
            <p className="mt-1 text-[11px] text-[color:var(--muted)]">
              Flat subscriptions only. Verify currency per row.
            </p>
          </div>
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
            <div className="text-2xl font-semibold tabular-nums">
              {usage.length}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
              usage-based (variable)
            </div>
            <p className="mt-1 text-[11px] text-[color:var(--muted)]">
              {usage.map((s) => s.name).join(", ") || "—"} — watch these as you
              test.
            </p>
          </div>
          <div
            className={`rounded-2xl border p-5 ${
              candidates.length > 0
                ? "border-[color:var(--danger)]/40 bg-[color:var(--danger)]/[0.06]"
                : "border-[color:var(--border)] bg-[color:var(--surface)]"
            }`}
          >
            <div className="text-2xl font-semibold tabular-nums">
              {candidates.length}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
              active but not wired
            </div>
            <p className="mt-1 text-[11px] text-[color:var(--muted)]">
              {candidates.map((s) => s.name).join(", ") ||
                "Nothing to review — all active services are in use."}
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 px-3 py-2 text-sm text-[color:var(--danger)]">
            {error}
          </p>
        )}

        {editing === "new" && (
          <div className="mt-6">
            <ServiceForm
              initial={EMPTY}
              onSave={(f) => save(f, "new")}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}

        {loading ? (
          <p className="mt-8 text-sm text-[color:var(--muted)]">
            Loading… (needs <code>SUPABASE_SERVICE_ROLE_KEY</code>)
          </p>
        ) : (
          <>
            <h2 className="mt-10 text-xs uppercase tracking-widest text-[color:var(--muted)]">
              Active ({active.length})
            </h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {active.map((s) =>
                editing === s.id ? (
                  <ServiceForm
                    key={s.id}
                    initial={s}
                    onSave={(f) => save(f, s.id)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <ServiceCard
                    key={s.id}
                    s={s}
                    copied={copiedId === s.id}
                    onEdit={() => setEditing(s.id)}
                    onDelete={() => remove(s.id)}
                    onCopy={() => copyPrompt(s)}
                  />
                ),
              )}
            </div>

            {inactive.length > 0 && (
              <>
                <h2 className="mt-10 text-xs uppercase tracking-widest text-[color:var(--muted)]">
                  Past / not subscribed ({inactive.length})
                </h2>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  {inactive.map((s) =>
                    editing === s.id ? (
                      <ServiceForm
                        key={s.id}
                        initial={s}
                        onSave={(f) => save(f, s.id)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <ServiceCard
                        key={s.id}
                        s={s}
                        copied={copiedId === s.id}
                        onEdit={() => setEditing(s.id)}
                        onDelete={() => remove(s.id)}
                        onCopy={() => copyPrompt(s)}
                        dimmed
                      />
                    ),
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ServiceCard({
  s,
  copied,
  onEdit,
  onDelete,
  onCopy,
  dimmed,
}: {
  s: Service;
  copied: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  dimmed?: boolean;
}) {
  const candidate = s.status === "active" && !s.wired;
  return (
    <div
      className={`rounded-2xl border p-5 ${
        candidate
          ? "border-[color:var(--danger)]/40 bg-[color:var(--danger)]/[0.05]"
          : "border-[color:var(--border)] bg-[color:var(--surface)]"
      } ${dimmed ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-[color:var(--foreground)]">
            {s.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
            {s.category && (
              <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2 py-0.5 uppercase tracking-widest text-[color:var(--muted)]">
                {s.category}
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 uppercase tracking-widest ${
                s.wired
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-[color:var(--danger)]/15 text-[color:var(--danger)]"
              }`}
            >
              {s.wired ? "wired" : "not wired"}
            </span>
            {s.status !== "active" && (
              <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 uppercase tracking-widest text-[color:var(--muted)]">
                {s.status}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">
            {s.billing_model === "usage"
              ? "usage"
              : s.billing_model === "annual"
                ? "annual"
                : money(s.monthly_cost, s.currency)}
          </div>
          {s.billing_model === "flat" && s.monthly_cost != null && (
            <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
              /mo
            </div>
          )}
        </div>
      </div>

      {s.notes && (
        <p className="mt-3 text-xs text-[color:var(--muted-strong)]">{s.notes}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
        {s.website && (
          <a
            href={s.website}
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--accent)] hover:underline"
          >
            Visit ↗
          </a>
        )}
        {s.manage_url && (
          <a
            href={s.manage_url}
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--accent)] hover:underline"
          >
            Manage billing ↗
          </a>
        )}
        <button
          onClick={onCopy}
          title="Copy a ready-to-paste prompt asking Claude to confirm whether this service is still used"
          className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2 py-1 text-[color:var(--muted-strong)] transition hover:border-[color:var(--accent)]/50 hover:text-[color:var(--accent)]"
        >
          {copied ? "Copied ✓" : "Copy audit prompt"}
        </button>
        <span className="ml-auto flex gap-3">
          <button
            onClick={onEdit}
            className="text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-[color:var(--muted)] hover:text-[color:var(--danger)]"
          >
            Delete
          </button>
        </span>
      </div>
    </div>
  );
}

function ServiceForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Omit<Service, "id">;
  onSave: (form: Omit<Service, "id">) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    ...initial,
    monthly_cost:
      initial.monthly_cost == null ? "" : String(initial.monthly_cost),
  });

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  const input =
    "mt-1 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm text-[color:var(--foreground)]";
  const labelCls = "text-xs text-[color:var(--muted)]";

  return (
    <div className="rounded-2xl border border-[color:var(--accent)]/40 bg-[color:var(--surface)] p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${labelCls} sm:col-span-2`}>
          Name
          <input
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
            className={input}
          />
        </label>
        <label className={labelCls}>
          Category
          <select
            value={f.category ?? "other"}
            onChange={(e) => set("category", e.target.value)}
            className={input}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          Billing model
          <select
            value={f.billing_model ?? "flat"}
            onChange={(e) => set("billing_model", e.target.value)}
            className={input}
          >
            {BILLING.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          Monthly cost (flat)
          <input
            type="number"
            step="0.01"
            value={f.monthly_cost}
            onChange={(e) => set("monthly_cost", e.target.value)}
            className={input}
            placeholder="leave blank for usage/free"
          />
        </label>
        <label className={labelCls}>
          Currency
          <input
            value={f.currency ?? "USD"}
            onChange={(e) => set("currency", e.target.value)}
            className={input}
          />
        </label>
        <label className={labelCls}>
          Website
          <input
            value={f.website ?? ""}
            onChange={(e) => set("website", e.target.value)}
            className={input}
            placeholder="https://"
          />
        </label>
        <label className={labelCls}>
          Manage / billing URL
          <input
            value={f.manage_url ?? ""}
            onChange={(e) => set("manage_url", e.target.value)}
            className={input}
            placeholder="https://"
          />
        </label>
        <label className={labelCls}>
          Status
          <select
            value={f.status ?? "active"}
            onChange={(e) => set("status", e.target.value)}
            className={input}
          >
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-[color:var(--muted)] sm:pt-6">
          <input
            type="checkbox"
            checked={f.wired}
            onChange={(e) => set("wired", e.target.checked)}
          />
          Currently wired into the build
        </label>
        <label className={`${labelCls} sm:col-span-2`}>
          Notes
          <textarea
            value={f.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
            rows={2}
            className={input}
          />
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={() =>
            onSave({
              ...f,
              monthly_cost:
                f.monthly_cost === "" ? null : Number(f.monthly_cost),
            })
          }
          disabled={!f.name.trim()}
          className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)] disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm font-medium text-[color:var(--muted-strong)] transition hover:text-[color:var(--foreground)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
