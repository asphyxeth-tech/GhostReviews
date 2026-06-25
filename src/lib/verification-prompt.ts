// Builds the "Claude verification packet" — a ready-to-paste prompt that lets
// the operator verify a lead in a flat-rate Claude chat (Max subscription /
// Claude Code) instead of spending metered Anthropic API tokens.
//
// It reuses the data already saved from the prospect scan (no new scrape, no
// API call) and mirrors the methodology of the app's API path — the forensic
// framework + ethical guardrails in src/lib/anthropic.ts (SYSTEM_PROMPT). Keep
// the six signals and the "harsh-but-specific reviews are real" rule aligned if
// that system prompt changes.

export type VerificationFlaggedReview = {
  author_name?: string | null;
  rating?: number | null;
  posted_at?: string | null;
  reviewer_total_reviews?: number | null;
  textless?: boolean;
  text_snippet?: string | null;
  review_link?: string | null;
};

export type VerificationInput = {
  businessName: string | null;
  placeId: string;
  overallRating: number | null;
  totalReviews: number | null;
  prefilterScore: number | null;
  rulesFired: string[];
  scanDepth: number | null;
  counts?: Record<string, unknown> | null;
  flaggedReviews: VerificationFlaggedReview[];
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildVerificationPacket(input: VerificationInput): string {
  const {
    businessName,
    placeId,
    overallRating,
    totalReviews,
    prefilterScore,
    rulesFired,
    scanDepth,
    counts,
    flaggedReviews,
  } = input;

  const c = counts ?? {};
  const countLines: string[] = [];
  const burst = num(c.burst_window_negatives);
  const spike = num(c.spike_window_ones);
  const throwaway = num(c.throwaway_negatives);
  const textless = num(c.textless_onestar_throwaway);
  const gap = num(c.tightest_cluster_gap_minutes);
  if (burst != null) countLines.push(`  - Worst 14-day window: ${burst} negative reviews`);
  if (spike != null) countLines.push(`  - Worst 7-day window: ${spike} one-star reviews`);
  if (throwaway != null)
    countLines.push(`  - Negatives from low-history accounts (≤2 lifetime reviews): ${throwaway}`);
  if (textless != null)
    countLines.push(`  - Near-textless 1-star from low-history accounts: ${textless}`);
  if (gap != null)
    countLines.push(`  - Tightest gap between two negatives: ${gap} minutes`);

  const reviewBlocks = flaggedReviews.map((r, i) => {
    const rating = r.rating != null ? `${r.rating}★` : "?★";
    const author = r.author_name || "Anonymous";
    const lifetime =
      r.reviewer_total_reviews != null
        ? `${r.reviewer_total_reviews} lifetime reviews`
        : "lifetime reviews unknown";
    const tag = r.textless ? " [textless]" : "";
    const when = r.posted_at ? ` — ${r.posted_at}` : "";
    const text = r.text_snippet ? `"${r.text_snippet}"` : "(no review text)";
    const link = r.review_link ? `\n   Link: ${r.review_link}` : "";
    return `${i + 1}. ${rating} — ${author} (${lifetime})${tag}${when}\n   ${text}${link}`;
  });

  return `You are verifying a potential review-bombing LEAD for ghost.reviews before we decide whether to do any outreach. Apply the forensic framework below and give me an HONEST verdict. If this is organic negativity (a bad week, an event, an industry that just collects angry reviews), say so plainly — do NOT manufacture an attack narrative from a clean set of reviews. Refusing weak leads is the guardrail that keeps us inside the FTC §465.7 carve-out, so be skeptical.

BUSINESS
- Name: ${businessName || "Unknown"}
- Google place id: ${placeId}
- All-time baseline: ${overallRating != null ? `${overallRating}★` : "rating unknown"} across ${
    totalReviews != null ? totalReviews.toLocaleString() : "?"
  } total reviews
- Pre-filter score: ${prefilterScore ?? 0} (signals fired: ${
    rulesFired.length ? rulesFired.join(", ") : "none"
  })
- Reviews scanned: ${scanDepth ?? "?"}
${countLines.length ? `\nPRE-FILTER COUNTS\n${countLines.join("\n")}\n` : ""}
FLAGGED REVIEWS (from our scan — text is truncated to ~200 chars; pull full text from the links if a call is close)
${reviewBlocks.length ? reviewBlocks.join("\n\n") : "(none flagged)"}

FRAMEWORK — weigh: (1) timing clusters (negatives minutes/hours apart), (2) low-history / throwaway reviewers, (3) templated or near-identical language across reviewers, (4) no evidence of a genuine visit (no product/staff names, no specifics), (5) rating-distribution anomaly vs the all-time baseline above, (6) vague complaints with no falsifiable detail. CRITICAL: a harsh review that contains specific, falsifiable details is a REAL customer experience and must NOT be treated as an attack — flagging it would itself be an FTC violation.

GIVE ME
1. Verdict — organic / monitor / likely coordinated attack — with a 0–100 risk score and a one-paragraph plain-English summary.
2. Which specific reviews show genuine attack signals, and why (cite each).
3. Which flagged reviews are probably legitimate and should be left alone.
4. Go / no-go on outreach. If go, the single strongest evidence point to lead with in the email.
${EMAIL_DRAFT_INSTRUCTIONS}`;
}

// ---------------------------------------------------------------------------
// Email-draft step (folded into the verification packet for efficiency).
//
// Why this lives here: verification and email-drafting are the two Claude steps
// in the outreach funnel. Doing them in one pass saves a round trip — BUT only
// the GO path should ever produce a pitch. This block is appended to the packet
// above as item 5. It is deliberately additive: the verdict/no-manufacturing
// guardrail at the top of the prompt is unchanged and still governs.
//
// The hard rule (mirrors docs/OUTREACH.md §0 and §9): if the verdict is NOT a
// real attack, output ONLY the verdict and explicitly DO NOT draft any pitch.
// We never manufacture an attack narrative — or an email — from a clean report.
//
// On the GO path, the model fills Template A from docs/OUTREACH.md using the
// data already in this packet, and ends with the LITERAL compliant footer
// (Devon, Ghost Reviews / devon@ghostreviews.app / the real mailing address /
// reply-"STOP"). Only the genuine per-recipient fields get substituted.
// Keep this footer byte-for-byte in sync with the canonical footer in
// docs/OUTREACH.md §7 if either changes.
const EMAIL_DRAFT_INSTRUCTIONS = `
5. Email draft — CONDITIONAL, and the guardrail is the point of this step:
   - IF AND ONLY IF your verdict in (1) is a GO (a genuine coordinated attack
     carrying the documented signals — textless/throwaway 1-star clusters, tight
     time clusters, vague no-specifics complaints from low-history accounts),
     ALSO write a complete, ready-to-send cold email using Template A from
     docs/OUTREACH.md. Fill the per-recipient fields from THIS packet's data:
     [Business] = the business name above; [N] = how many reviews are in the
     suspicious cluster; [window]/[date] = the time window the cluster falls in;
     [name] = the owner's first name if known, otherwise "there". Lead with the
     single strongest evidence point. Do NOT use any guarantee or special-access
     language (say Google's policies *allow* removal, never that Google *will*
     remove). End the email with this EXACT footer, verbatim, on its own lines:

       — Devon, Ghost Reviews
       devon@ghostreviews.app · Suite 1022, 1737 Richmond Street Unit #9, London, ON N5X 3Y2 · Not relevant? Reply "STOP" and we won't contact you again.

   - IF your verdict is NO-GO / organic / monitor / clean, output ONLY the
     verdict (items 1–4) and explicitly do NOT draft any email or pitch. Say
     "No email — verdict is not a GO." Refusing to manufacture a pitch from a
     clean report is the guardrail that keeps us inside the FTC §465.7 carve-out;
     do not stretch a weak set of reviews into an attack just to justify a draft.`;
