# Ghost Reviews — Outreach Playbook (`docs/OUTREACH.md`)

The operating manual for finding, verifying, and contacting businesses that
appear to be under a coordinated fake-review attack. This is the *engine*; the
*targets* (named-business lists) NEVER live in this repo — they go in `/tmp` or
Devon's private notes. (See "Operational discipline.")

> Status: living document. Sections marked _(calibrating)_ are being tuned and
> will change as we learn. The percentage-of-total-reviews depth idea in §8 is
> a planned refinement, not yet shipped.

---

## 0. The one rule (read this every time)

**We only ever contact a business where Claude has VERIFIED a genuine
policy-violation signal in the actual review content.**

- We do **not** pitch off the cheap pre-filter alone.
- We do **not** manufacture a problem from a clean report. If the verification
  comes back clean, the business is **not** a lead — full stop.
- We protect *honest* reviews, including harshly negative ones with specifics.
  Suppressing those is itself an FTC violation (Consumer Review Rule § 465.7).
  Our entire targeting framework lives inside that carve-out. Stay there.

If you ever feel like you're stretching to call something an attack, you've
already left the carve-out. Don't send.

---

## 1. The funnel (end to end)

```
  DISCOVER            PRE-FILTER           VERIFY              DRAFT            SEND          TRACK
  (Outscraper    →    (prospect.py    →    (Claude on     →    (evidence   →   (CASL-     →  (who/when/
   Maps search)        v2 scoring)          live site)          email)          compliant)    outcome)
   dozens              ~6 candidates        2 real leads        personalized    low volume    /tmp sheet
```

- **Pre-filter precision of ~33% is fine** (2 leads of 6 candidates in testing).
  Its job is to NARROW cheaply, not to be right. Improve VERIFICATION throughput,
  not pre-filter "smartness" — relaxing the pre-filter just re-introduces noise.
- The funnel exists to **protect Devon's time**: he only ever looks at
  Claude-verified leads.

---

## 2. Discovery — finding businesses to scan

_(calibrating — discovery mode being added to `prospect.py`)_

Use Outscraper's Google Maps **search** endpoint to pull a list of businesses by
**category + city**, then feed that list into the pre-filter. Each result gives
us the business name, place id, **total review count**, rating, and contact info.

- **Market:** start where we have ground truth — **London, Ontario**.
- **Verticals worth scanning** (competition- or dispute-heavy, where coordinated
  attacks actually happen): auto repair/dealers, hair/nail/lash salons & med-spas,
  restaurants, contractors/trades, moving companies, dentists.
- **Verticals to be careful with:** law firms and similar structurally collect
  angry reviews from opposing parties/losing clients — that's a *business-quality
  / industry* signal, **NOT** an attack. We removed chronic-low scoring for this
  reason; don't reintroduce it.
- **Never commit the resulting business list.** Output to `/tmp` only.

---

## 3. Pre-filter scoring — `prospect.py` (v2)

The cheap heuristic. It CANNOT tell a coordinated attack from organic noise on
its own — only reading the content (Claude) can. Its only job is to narrow.

**Anchors (required — no anchor ⇒ score forced to 0):**
- **BURST** (+40): ≥3 negatives (≤2★) in a rolling 14-day window, **velocity-
  normalized** — only fires if the count is ≥3× the business's expected
  negatives-per-window rate. (This is what stops a 13k-review business from
  flagging on 3 statistically-guaranteed background negatives.)
- **SPIKE** (+40): ≥3 one-star reviews in a rolling 7-day window when the all-time
  1★ share is < 20%.

**Corroboration (only counts if an anchor already fired):**
- **THROWAWAY** (+20): ≥2 recent negatives from accounts with ≤2 lifetime reviews.
- **TEXTLESS** (+15): ≥1 empty/near-empty 1★ from a low-history account.
- **TIGHT_CLUSTER** (+15): ≥2 negatives within 60 minutes.

**Candidate threshold:** score ≥ 50.

**False-positive modes we must keep filtering out** (all real, all NOT attacks):
1. Event-driven complaint clusters (Mother's Day rush, a stylist leaving).
2. Volume artifacts on high-traffic businesses (handled by velocity normalization).
3. Lone throwaway reviewers (only matter as corroboration, never an anchor).
4. Chronically low ratings (industry/quality signal — not scored at all).

---

## 4. What a REAL lead looks like (from our two verified London hits)

These are the signals Claude flagged on our only two confirmed leads — they are
the **ammunition** for the cold email, because they're concrete and verifiable:

- **Textless 1-star reviews** (zero/near-zero text) from accounts with no other
  Google reviews. *The single most reliable signal.*
- **Tight time clusters** of 1-stars — especially under an hour apart.
- **Vague accusations with no falsifiable specifics** from low-history accounts
  ("Very low quality work." — no service, no staff, no date).

**Depth matters:** these were invisible at depth-10 and only surfaced at depth-50.
Don't scan shallow. (This is exactly why §8's adaptive-depth idea matters.)

---

## 5. Verification — Claude (MANDATORY before any email)

For each pre-filter candidate, run it through the **live site / `/api/analyze`**
(or fan out a Sonnet subagent per candidate when a scan yields >2 hits). Read the
*actual* review content. Confirm the signal is genuine.

- This is where the free instant scan doubles as our verification tool.
- Output of verification is the **evidence** you'll cite in the email — the
  specific reviews, timestamps, account histories, and matched patterns.
- **If clean: stop.** Not a lead.

---

## 6. The cold email

**Principle:** we don't pitch a service — we *report a specific problem we found*
and offer the evidence for free. That's what separates this from spam, and it's
why it converts: you're handing a stressed owner proof of something that's costing
them money.

The **free evidence report is the lead magnet AND the consent mechanism** — it's
low-friction, and a reply is express interest.

### Anatomy
1. **Subject** — specific + a little curiosity. Avoid spammy words.
2. **Who you are** — one line, plain.
3. **The specific finding** — the concrete evidence (N reviews, the window, the
   account pattern). This is the whole email.
4. **Why it matters** — it matches Google's policy-violation criteria.
5. **Soft CTA** — "want the free report?" (not "buy now").
6. **Compliance footer** — identity, contact, unsubscribe (see §7).

### Template A — "evidence alert" (primary)
> **Subject:** Possible coordinated review attack on [Business]
>
> Hi [name],
>
> I run Ghost Reviews — we help local businesses catch and remove fake-review
> attacks on their Google profile.
>
> Looking at [Business], one thing stood out: **[N] one-star reviews posted
> within [window] on [date], all from accounts with no review history and no
> specifics about your business.** That pattern matches Google's criteria for
> fake / coordinated reviews.
>
> I put together a short **evidence report** on exactly what I found — happy to
> send it over free, no strings. If it is an attack, we can also file the removal
> requests through Google's official process on your behalf.
>
> Want me to send the report?
>
> — [Name], Ghost Reviews
> [contact email] · [mailing address] · *Not relevant? Reply "stop" and I won't
> follow up.*

### Template B — "soft heads-up" (for milder signals / warmer intros)
> **Subject:** Quick heads-up about a few reviews on [Business]
>
> Hi [name] — noticed a cluster of recent 1-star reviews on [Business] that look
> off (a few posted minutes apart from brand-new accounts). Could be nothing, but
> it fits the fake-review pattern Google will remove. I made you a quick free
> report if you want a look — just say the word. — [Name], Ghost Reviews
> [contact] · [address] · reply "stop" to opt out.

### Personalization checklist (fill before sending)
- [ ] Exact count + time window of the suspicious cluster
- [ ] The account pattern (no history / no photo / generic names)
- [ ] At least one concrete "no-specifics" example
- [ ] Business name spelled right; correct owner name if known
- [ ] Verified by Claude (not pre-filter only)

---

## 7. Compliance — CASL (Canada) & CAN-SPAM (US)

You send from **Ontario → CASL governs**, and it's stricter than US CAN-SPAM.
Our outreach email IS a "commercial electronic message" (CEM) — there is **no B2B
exemption**. This is practical guidance, **not legal advice; confirm with counsel
before scaling.**

**Our consent basis: implied consent via "conspicuous publication."** Lawful only
when ALL THREE hold:
1. The business **conspicuously published** the email address (their *own* website
   / Google Business Profile — NOT a third-party data broker or a login-gated page).
2. **No "no unsolicited email" statement** sits near that address.
3. The message is **relevant to the recipient's business role** — a verified
   fake-review attack on *their* profile clearly is. **This is why we only email
   Claude-verified leads: the verification is what makes the email lawful.**

**You carry the burden of proof.** For every contact, log: the **source URL**
(their own site/GBP), a **screenshot + timestamp**, that no opt-out notice was
present, and the relevance reason.

**Every email MUST contain (hard requirements):**
- **Sender ID** — "Ghost Reviews" + your name.
- **A physical mailing address** (P.O. box OK) + one contact method (phone/email/
  site) — kept valid **60 days**.
- **A free, one-click unsubscribe** (or "reply STOP"), valid **60 days**, and
  **honored within 10 business days**. Keep a suppression list; check it every send.

Footer template:
> Ghost Reviews · [Street / PO Box], [City], ON [Postal] · [email / site]
> Not relevant? [Unsubscribe] or reply "STOP" — I won't follow up.

**Express consent (the cleaner, inbound path):** on the website's free scan, add an
*unchecked* opt-in box ("I agree to receive emails from Ghost Reviews about my
results and related services; unsubscribe anytime"), with your name + address
beside it, and **record the consent text + timestamp.** Express consent never
expires (until they opt out).

**Exposure:** up to **$1M (individual) / $10M (corp) per violation**, and
**directors are personally liable** — but enforcement targets high-volume spammers,
not low-volume good-faith B2B. The **private right of action is currently
suspended** (individuals can't sue under CASL today) — but it can be reinstated by
order, so stay clean. A documented **due-diligence** trail (this playbook + your
logs) is your defense.

**US prospects → CAN-SPAM** (opt-out, lighter): you may email without prior consent
if you use truthful From/subject, include a physical address, and honor opt-outs
within 10 business days. Max ~$53k/email, but low risk for targeted, legitimate
outreach.

**Numbers:** honor unsubscribe ≤ **10 business days** · contact + unsub link valid
**60 days** · conspicuous-publication consent has **no expiry** (but only while the
address stays published).

> The full sourced brief (CRTC, fightspam.gc.ca, Gowling WLG, BLG, McInnes Cooper,
> Osler) is in the PR that introduced this file.

---

## 8. Scoring & depth — the next iteration _(spitball / planned)_

The fixed-depth problem (Devon's insight): scanning the **40 most-recent** reviews
treats a 100-review business and a 10,000-review business the same — but 40 of
10,000 is statistical noise, so a genuinely-attacked giant can score low while a
small business looks dramatic. Two ideas to develop:

- **Adaptive / percentage-of-total depth:** scale scan depth with the business's
  total review count (e.g., `max(40, min(CAP, total × p%))`), capped for cost/time.
- **Interaction with velocity normalization:** burst is already normalized by
  review rate; adaptive depth makes sure we *capture* enough window to detect the
  burst in the first place. The two are complementary.
- Open questions: what `p%` and `CAP`? Does deeper scanning change the
  cost/precision trade? (Outscraper free tier = 500 reviews/mo, so depth has a
  budget.) → calibrate with `prospect.py --depth-sweep` on the labeled set.

---

## 9. Operational discipline (non-negotiable)

- **Verified-only:** never email off `prospect.py` output alone.
- **Refuse to pitch a clean report.** This is the guardrail, not a suggestion.
- **Targets stay in `/tmp`** or private notes — never committed. The repo is
  effectively public; "we think these businesses are being attacked" is not
  something to publish.
- **Subagent fan-out:** when a scan yields >2 hits, fan out one Sonnet subagent
  per candidate (curl the live API, judge honestly, draft from this template). Do
  NOT spin up subagents for the scrape itself — that's network-bound (use the
  in-script worker pool).
- Keep prospect depth ≥ ~50; don't scan shallow.

---

## 10. Tracking (lightweight, for now)

A simple `/tmp` sheet (CSV) until the Supabase filing tracker exists:

| business | signal summary | verified? | emailed (date) | response | outcome |
|---|---|---|---|---|---|

Future: promote this into the Supabase `filings` table (drafted → submitted →
outcome) once we have paying customers.
