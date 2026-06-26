// Server-only transactional email via Resend's HTTP API (no SDK dependency —
// we just POST to https://api.resend.com/emails). Reads RESEND_API_KEY and an
// optional RESEND_FROM. Like the Stripe/Supabase clients, this degrades
// gracefully: if it isn't configured, sendEmail() returns { sent: false,
// reason: "not_configured" } instead of throwing, so callers can fall back to
// the operator sending the message by hand.
//
// NEVER import this into a client component — the API key must never reach the
// browser.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// The default From. Use a verified sender on the ghostreviews.app domain. Keep
// transactional mail (receipts, auth) on this address; cold OUTREACH should go
// from a separate subdomain so a reputation hit can't take down customer mail
// (see docs/OUTREACH.md).
const DEFAULT_FROM = "Ghost Reviews <devon@ghostreviews.app>";
const DEFAULT_REPLY_TO = "devon@ghostreviews.app";

function getKey(): string | null {
  const k = process.env.RESEND_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

function getFrom(): string {
  const f = process.env.RESEND_FROM;
  return f && f.trim() ? f.trim() : DEFAULT_FROM;
}

/** Whether transactional email is configured (a Resend key is present). */
export function isEmailConfigured(): boolean {
  return getKey() !== null;
}

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export type SendEmailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: "not_configured" | "invalid" | "error"; error?: string };

/**
 * Send one transactional email. Never throws — returns a structured result so
 * the caller can decide what to do (e.g. fall back to manual sending). No-ops
 * with reason "not_configured" when RESEND_API_KEY is unset.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const key = getKey();
  if (!key) return { sent: false, reason: "not_configured" };

  const to = input.to?.trim();
  if (!to || !to.includes("@")) {
    return { sent: false, reason: "invalid", error: "Missing or invalid recipient." };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: getFrom(),
        to: [to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        reply_to: input.replyTo?.trim() || DEFAULT_REPLY_TO,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: "error", error: `Resend ${res.status}: ${detail.slice(0, 300)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: data.id ?? null };
  } catch (err) {
    return {
      sent: false,
      reason: "error",
      error: err instanceof Error ? err.message : "Unknown email error.",
    };
  }
}
