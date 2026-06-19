// Plain-language definitions for the v2 pre-filter signals.
//
// Shared by the admin results table (hover tooltips) and the per-business
// detail page, so the wording lives in exactly one place. The keys mirror the
// rule names emitted by prospect-scoring.ts / pipeline/prospect.py — keep them
// in sync if a rule is ever renamed. "anchor" rules can fire on their own;
// "corroboration" rules only count once an anchor has already fired.

export type SignalTone = "anchor" | "corroboration";

export type SignalDef = {
  label: string; // short human label for the pill
  tone: SignalTone;
  desc: string; // the hover/tooltip explanation, in plain English
};

export const SIGNAL_DEFS: Record<string, SignalDef> = {
  BURST: {
    label: "Burst",
    tone: "anchor",
    desc: "3+ negative (1–2★) reviews inside a 14-day window, normalized for how fast this business normally gets reviews. The strongest single attack signal.",
  },
  SPIKE: {
    label: "Spike",
    tone: "anchor",
    desc: "3+ one-star reviews in a 7-day window at a business where 1★ reviews are normally rare — a sudden break from a healthy baseline.",
  },
  THROWAWAY: {
    label: "Throwaway",
    tone: "corroboration",
    desc: "2+ recent negatives from accounts with ≤2 lifetime reviews. Only counts as backup once a burst or spike has already fired.",
  },
  TEXTLESS: {
    label: "Textless",
    tone: "corroboration",
    desc: "One-star reviews with little or no written text, from low-history accounts — the most reliable real-attack tell in our live testing. Backup signal only.",
  },
  TIGHT_CLUSTER: {
    label: "Tight cluster",
    tone: "corroboration",
    desc: "2+ negative reviews posted within 60 minutes of each other — coordinated timing. Backup signal only.",
  },
};

/** Definition for a rule key, with a safe fallback for unknown keys. */
export function signalDef(key: string): SignalDef {
  return (
    SIGNAL_DEFS[key] ?? { label: key, tone: "corroboration", desc: "" }
  );
}
