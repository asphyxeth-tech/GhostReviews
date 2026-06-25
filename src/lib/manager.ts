// Single source of truth for the Google Business Profile MANAGER identity —
// the one Google account a client invites so we can file removal requests on
// their behalf. Centralized here so the onboarding walkthrough, the admin
// panel, and any future automation always reference the SAME address (a typo
// or a personal-vs-role-address mismatch sends Google's invite into the void).
//
// IMPORTANT (ops): this address must be a real, SIGN-IN-CAPABLE Google identity
// — a Google Workspace seat, or an email registered as a Google Account — or it
// cannot accept the manager invite. An email merely existing on the domain is
// NOT automatically a usable Google account. Verify it can sign in at
// accounts.google.com and accept a test invite on your own profile first.
//
// Configure via the GBP_MANAGER_EMAIL env var (server + Vercel). Falls back to
// the support address so the walkthrough is never blank, but set it explicitly.

const DEFAULT_MANAGER_EMAIL = "devon@ghostreviews.app";

export function getManagerEmail(): string {
  const v = process.env.GBP_MANAGER_EMAIL?.trim();
  return v && v.length > 0 ? v : DEFAULT_MANAGER_EMAIL;
}
