#!/usr/bin/env node
// Read-only CLI for the prospect flywheel — pull scan / lead / filing data
// straight from Supabase so we can review leads in-session instead of pasting
// walls of text into chat.
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the
// environment (configure them on the Claude Code environment + Vercel — NEVER
// commit them). The service-role key bypasses RLS; this script only ever SELECTs
// and never prints the key.
//
// Usage:
//   node scripts/scans.mjs leads              # candidates (score >= 50), latest per business
//   node scripts/scans.mjs show <place_id>    # full flagged-review detail for one business
//   node scripts/scans.mjs all                # show every current lead (for batch verification)
//   node scripts/scans.mjs filings <place_id> # removal filings for one business
//   node scripts/scans.mjs stats              # totals

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing Supabase credentials.\n" +
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the\n" +
      "Claude Code environment (same values as Vercel). They are never read\n" +
      "from the repo and never printed.",
  );
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

function latestByPlace(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.place_id || r.id;
    if (!m.has(k)) m.set(k, r); // rows arrive scanned_at desc, so first = latest
  }
  return [...m.values()];
}

async function getScans() {
  const { data, error } = await sb
    .from("prospect_scans")
    .select("*")
    .order("scanned_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  return data || [];
}

function printBusiness(r) {
  const signals = (r.rules_fired || []).join(", ") || "none";
  console.log(`# ${r.business_name || "?"}  (${r.place_id})`);
  console.log(
    `score ${r.prefilter_score}  signals [${signals}]  rating ${
      r.overall_rating ?? "?"
    }  total ${r.total_reviews ?? "?"}  depth ${r.scan_depth ?? "?"}  scanned ${
      (r.scanned_at || "").slice(0, 10)
    }`,
  );
  if (r.counts) console.log(`counts: ${JSON.stringify(r.counts)}`);
  const flagged = Array.isArray(r.flagged_reviews) ? r.flagged_reviews : [];
  console.log(`${flagged.length} flagged reviews:`);
  flagged.forEach((fr, i) => {
    const rating = fr.rating != null ? `${fr.rating}*` : "?*";
    const life = fr.reviewer_total_reviews ?? "?";
    const tag = fr.textless ? " [textless]" : "";
    const text = fr.text_snippet ? `"${fr.text_snippet}"` : "(no text)";
    console.log(
      `  ${i + 1}. ${rating} ${fr.author_name || "Anon"} (${life} reviews)${tag} ${
        fr.posted_at || ""
      }\n     ${text}`,
    );
  });
}

async function cmdLeads() {
  const leads = latestByPlace(await getScans())
    .filter((r) => (r.prefilter_score ?? 0) >= 50)
    .sort((a, b) => (b.prefilter_score ?? 0) - (a.prefilter_score ?? 0));
  console.log(`${leads.length} leads (score >= 50), latest scan per business\n`);
  for (const r of leads) {
    const flagged = Array.isArray(r.flagged_reviews) ? r.flagged_reviews.length : 0;
    console.log(
      `${String(r.prefilter_score ?? 0).padStart(3)}  ${(r.business_name || "?").padEnd(34).slice(0, 34)}  ` +
        `[${(r.rules_fired || []).join(",")}]  ${flagged} flagged / ${r.total_reviews ?? "?"} total  ` +
        `${r.overall_rating ?? "?"}*  ${r.place_id}`,
    );
  }
}

async function cmdShow(placeId) {
  if (!placeId) return fail("show needs a <place_id>");
  const rows = (await getScans()).filter((r) => r.place_id === placeId);
  if (!rows.length) return fail("no scans for that place_id");
  printBusiness(rows[0]);
}

async function cmdAll() {
  const leads = latestByPlace(await getScans())
    .filter((r) => (r.prefilter_score ?? 0) >= 50)
    .sort((a, b) => (b.prefilter_score ?? 0) - (a.prefilter_score ?? 0));
  console.log(`# ${leads.length} leads — full detail\n`);
  for (const r of leads) {
    console.log("=".repeat(70));
    printBusiness(r);
    console.log("");
  }
}

async function cmdFilings(placeId) {
  if (!placeId) return fail("filings needs a <place_id>");
  const { data, error } = await sb
    .from("filings")
    .select("*")
    .eq("place_id", placeId)
    .order("created_at", { ascending: true });
  if (error) return fail(error.message);
  const rows = data || [];
  console.log(`${rows.length} filings for ${placeId}`);
  for (const f of rows) {
    console.log(
      `  [${f.status}] ${f.rating ?? "?"}* ${f.author_name || "Anon"} — ${
        f.removal_reason || "no reason"
      }${f.notes ? ` — ${f.notes}` : ""}`,
    );
  }
}

async function cmdStats() {
  const rows = await getScans();
  const businesses = latestByPlace(rows);
  const leads = businesses.filter((r) => (r.prefilter_score ?? 0) >= 50);
  const { count: filingCount } = await sb
    .from("filings")
    .select("*", { count: "exact", head: true });
  console.log(`scans (rows):        ${rows.length}`);
  console.log(`businesses (unique): ${businesses.length}`);
  console.log(`leads (score >= 50): ${leads.length}`);
  console.log(`filings logged:      ${filingCount ?? "?"}`);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === "leads") await cmdLeads();
  else if (cmd === "show") await cmdShow(arg);
  else if (cmd === "all") await cmdAll();
  else if (cmd === "filings") await cmdFilings(arg);
  else if (cmd === "stats") await cmdStats();
  else {
    console.log(
      "Commands: leads | show <place_id> | all | filings <place_id> | stats",
    );
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
