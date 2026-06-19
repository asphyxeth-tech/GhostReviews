import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminUser, createSupabaseAdmin } from "@/lib/admin";
import { signalDef } from "@/lib/signal-defs";

// Per-business "file" — the on-demand deep view for one prospect. Built lazily:
// it just reads whatever scans we've already saved for this place_id from the
// prospect_scans flywheel, so we never pre-build a page for a business we never
// look at. Admin-gated (404 for everyone else, same as the rest of /admin).
export const dynamic = "force-dynamic";

// ---- shapes (the flywheel rows are loosely typed jsonb) ----
type FlaggedReview = {
  review_id?: string;
  author_id?: string;
  author_name?: string;
  rating?: number;
  posted_at?: string;
  reviewer_total_reviews?: number;
  textless?: boolean;
  text_snippet?: string;
  review_link?: string;
};

type ScanRow = {
  id: string;
  place_id: string | null;
  business_name: string | null;
  scanned_at: string;
  scan_depth: number | null;
  prefilter_score: number | null;
  anchor_fired: boolean | null;
  rules_fired: string[] | null;
  total_reviews: number | null;
  overall_rating: number | null;
  flagged_reviews: FlaggedReview[] | null;
  business_address: string | null;
  business_phone: string | null;
  business_website: string | null;
  business_maps_url: string | null;
  reviews_url: string | null;
  latitude: number | null;
  longitude: number | null;
};

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString();
}

// Keyless Google Maps embed (fine for an internal admin tool). Prefers exact
// coordinates, falls back to the address, returns null when we have neither.
function mapEmbedUrl(row: ScanRow): string | null {
  if (row.latitude != null && row.longitude != null) {
    return `https://www.google.com/maps?q=${row.latitude},${row.longitude}&z=15&output=embed`;
  }
  if (row.business_address) {
    return `https://www.google.com/maps?q=${encodeURIComponent(row.business_address)}&output=embed`;
  }
  return null;
}

export default async function BusinessFilePage({
  params,
}: {
  params: Promise<{ placeId: string }>;
}) {
  const { placeId } = await params;
  const decodedPlaceId = decodeURIComponent(placeId);

  const admin = await getAdminUser();
  if (!admin) notFound();

  const sb = createSupabaseAdmin();
  if (!sb) notFound();

  const { data } = await sb
    .from("prospect_scans")
    .select("*")
    .eq("place_id", decodedPlaceId)
    .order("scanned_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as ScanRow[];
  if (rows.length === 0) notFound();

  const latest = rows[0];
  const flagged = Array.isArray(latest.flagged_reviews)
    ? latest.flagged_reviews
    : [];
  const rules = Array.isArray(latest.rules_fired) ? latest.rules_fired : [];
  const isLead = (latest.prefilter_score ?? 0) >= 50;
  const reviewsUrl = latest.reviews_url || latest.business_maps_url || null;
  const mapsUrl = latest.business_maps_url || reviewsUrl;
  const embed = mapEmbedUrl(latest);

  return (
    <div className="ghost-bg min-h-screen px-6 py-8 sm:px-10">
      <div className="mx-auto max-w-6xl">
        {/* Top bar */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-base tracking-tight">
            <span className="text-[color:var(--accent)]">/</span>ghostreviews
            <span className="text-[color:var(--accent)]">/</span>
            <span className="ml-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[color:var(--muted-strong)]">
              file
            </span>
          </div>
          <Link
            href="/admin"
            className="text-sm text-[color:var(--muted)] transition hover:text-[color:var(--foreground)]"
          >
            ← Back to prospecting
          </Link>
        </div>

        {/* Business header */}
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
                  {latest.business_name || "Unknown business"}
                </h1>
                {isLead && (
                  <span className="rounded-full bg-[color:var(--accent)]/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--accent)]">
                    lead
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[color:var(--muted-strong)]">
                {latest.overall_rating != null && (
                  <span className="tabular-nums">
                    ★ {latest.overall_rating.toFixed(1)}
                  </span>
                )}
                {latest.total_reviews != null && (
                  <span className="tabular-nums">
                    {latest.total_reviews.toLocaleString()} reviews
                  </span>
                )}
                <span className="font-mono text-xs text-[color:var(--muted)]">
                  {decodedPlaceId}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-4xl font-semibold tabular-nums text-[color:var(--accent)]">
                {latest.prefilter_score ?? 0}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
                pre-filter score
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-5 flex flex-wrap gap-2">
            {reviewsUrl && (
              <a
                href={reviewsUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[color:var(--accent-glow)]"
              >
                Google reviews ↗
              </a>
            )}
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-2 text-sm font-medium text-[color:var(--muted-strong)] transition hover:border-[color:var(--accent)]/50 hover:text-[color:var(--foreground)]"
              >
                Google Maps ↗
              </a>
            )}
            {latest.business_website && (
              <a
                href={latest.business_website}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-2 text-sm font-medium text-[color:var(--muted-strong)] transition hover:border-[color:var(--accent)]/50 hover:text-[color:var(--foreground)]"
              >
                Website ↗
              </a>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          {/* Left: map + contact */}
          <div className="space-y-6">
            <div className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]">
              {embed ? (
                <iframe
                  title="Location map"
                  src={embed}
                  loading="lazy"
                  className="h-56 w-full border-0"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="flex h-56 items-center justify-center text-sm text-[color:var(--muted)]">
                  No location captured
                </div>
              )}
              <div className="space-y-2 p-5 text-sm">
                <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
                  Contact
                </h2>
                <p className="text-[color:var(--muted-strong)]">
                  {latest.business_address || "No address on file"}
                </p>
                {latest.business_phone && (
                  <p>
                    <a
                      href={`tel:${latest.business_phone.replace(/[^\d+]/g, "")}`}
                      className="text-[color:var(--accent)] hover:underline"
                    >
                      {latest.business_phone}
                    </a>
                  </p>
                )}
                {latest.business_website && (
                  <p className="truncate">
                    <a
                      href={latest.business_website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[color:var(--accent)] hover:underline"
                    >
                      {latest.business_website.replace(/^https?:\/\//, "")}
                    </a>
                  </p>
                )}
              </div>
            </div>

            {/* Signals fired (latest scan) */}
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
              <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
                Signals fired
              </h2>
              {rules.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {rules.map((r) => {
                    const d = signalDef(r);
                    return (
                      <li key={r} className="text-sm">
                        <span
                          className={`mr-2 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                            d.tone === "anchor"
                              ? "border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 text-[color:var(--accent)]"
                              : "border-[color:var(--border)] bg-[color:var(--surface-2)] text-[color:var(--muted-strong)]"
                          }`}
                        >
                          {d.label}
                        </span>
                        <span className="text-[color:var(--muted)]">{d.desc}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-[color:var(--muted)]">
                  No anchors fired on the latest scan.
                </p>
              )}
            </div>
          </div>

          {/* Right: flagged reviews */}
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
                Flagged reviews
              </h2>
              <span className="text-xs text-[color:var(--muted)]">
                {flagged.length} flagged · {latest.scan_depth ?? "?"} scanned
              </span>
            </div>
            <p className="mt-2 text-xs text-[color:var(--muted)]">
              Pre-filter hits from the most recent scan ({fmtDate(latest.scanned_at)}).
              Verify in the public scanner with Claude before any outreach.
            </p>

            {flagged.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {flagged.map((fr, i) => (
                  <li
                    key={fr.review_id || i}
                    className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4"
                  >
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums text-[color:var(--danger)]">
                          {fr.rating ?? "?"}★
                        </span>
                        <span className="font-medium text-[color:var(--foreground)]">
                          {fr.author_name || "Anonymous"}
                        </span>
                        <span className="text-[color:var(--muted)]">
                          · {fr.reviewer_total_reviews ?? 0} lifetime reviews
                        </span>
                        {fr.textless && (
                          <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[10px] text-[color:var(--muted-strong)]">
                            textless
                          </span>
                        )}
                      </div>
                      <span className="text-[color:var(--muted)]">
                        {fmtDate(fr.posted_at)}
                      </span>
                    </div>
                    {fr.text_snippet ? (
                      <p className="mt-2 text-sm text-[color:var(--muted-strong)]">
                        “{fr.text_snippet}”
                      </p>
                    ) : (
                      <p className="mt-2 text-sm italic text-[color:var(--muted)]">
                        (no review text)
                      </p>
                    )}
                    {fr.review_link && (
                      <a
                        href={fr.review_link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-xs text-[color:var(--accent)] hover:underline"
                      >
                        View on Google ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-[color:var(--muted)]">
                No reviews were flagged on the latest scan.
              </p>
            )}
          </div>
        </div>

        {/* Scan history — historical comparison across re-scans */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)]">
          <div className="flex items-baseline justify-between px-6 py-4">
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
              Scan history
            </h2>
            <span className="text-xs text-[color:var(--muted)]">
              {rows.length} scan{rows.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--surface-2)] text-xs uppercase tracking-widest text-[color:var(--muted)]">
                <tr>
                  <th className="px-6 py-3">When</th>
                  <th className="px-4 py-3 text-right">Score</th>
                  <th className="px-4 py-3 text-right">Rating</th>
                  <th className="px-4 py-3 text-right">Total reviews</th>
                  <th className="px-4 py-3 text-right">Flagged</th>
                  <th className="px-4 py-3 text-right">Depth</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-[color:var(--border)]"
                  >
                    <td className="px-6 py-3 text-[color:var(--muted-strong)]">
                      {fmtDateTime(row.scanned_at)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {row.prefilter_score ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[color:var(--muted-strong)]">
                      {row.overall_rating != null
                        ? row.overall_rating.toFixed(1)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[color:var(--muted-strong)]">
                      {row.total_reviews != null
                        ? row.total_reviews.toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[color:var(--muted-strong)]">
                      {Array.isArray(row.flagged_reviews)
                        ? row.flagged_reviews.length
                        : 0}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[color:var(--muted)]">
                      {row.scan_depth ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-[color:var(--border)] px-6 py-3 text-xs text-[color:var(--muted)]">
            Re-scan this business monthly to track movement. Filing tracker +
            removal-impact (rating before/after) land in the next phase.
          </p>
        </div>
      </div>
    </div>
  );
}
