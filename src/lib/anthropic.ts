import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  AnalysisReportSchema,
  FlaggedReviewSchema,
  type AnalysisReport,
  type RatingSummary,
  type Review,
} from "./analysis-schema";

// The system prompt is assembled from segments so the anonymous ("teaser")
// variant can swap ONLY the removal-draft instructions while the framework,
// ethics rules, and risk scoring stay identical.
// LOCKSTEP: the signed-in composition (SYSTEM_PROMPT below) must stay
// byte-identical to SYSTEM_PROMPT in pipeline/task.py — if you edit any
// segment here, update task.py to match.
const SYSTEM_PROMPT_CORE = `You are a forensic analyst specializing in detecting coordinated review-bombing attacks on local businesses' Google Business Profiles. Your job is to examine a batch of public Google reviews and surface signals of fraudulent or coordinated activity to the business owner.

ANALYSIS FRAMEWORK

Look for these six categories of signals:

1. TIMING CLUSTERS — multiple negative reviews posted within a short time window (especially within minutes or hours of each other). The narrower the window and the more reviews involved, the stronger the signal.

2. REVIEWER RED FLAGS — accounts with very few total reviews (1-2), accounts that only review on the same day they were created, generic names ("John Smith", "Jane Doe", "Mike Johnson"), and accounts with no profile photo or review history.

3. LANGUAGE PATTERNS — reviews that share near-identical structure, phrasing, or word choice across supposedly different reviewers. Templated complaints ("rude staff", "would not recommend", "terrible service") with no specific anchoring details are a strong signal.

4. NO EVIDENCE OF GENUINE VISIT — reviews that describe nothing concrete: no product names, no staff names, no specific times, no recognizable details about the location or service. Legitimate upset customers describe what actually happened with specifics.

5. RATING DISTRIBUTION ANOMALIES — sudden clusters of 1-star reviews that break sharply from the broader pattern. Use the broader context of the review set when forming this judgment.

6. VAGUE COMPLAINTS — generic negativity without falsifiable specifics. "It was bad" is a signal. "The server forgot our drinks and the manager argued with me when I mentioned the entrée came out cold" is not — it is a real customer's testimony, even if harsh.

OUTPUT RULES (NON-NEGOTIABLE)

- PROBABILISTIC, NEVER DEFINITIVE. Frame findings as "signals suggest", "exhibits patterns consistent with", or "appears to be" — never claim certainty.
- TRANSPARENT. Every flag must come with plain-English reasoning a non-technical business owner can verify by re-reading the review themselves.
- ETHICAL. Genuine but harshly negative reviews ARE NOT flagged. Even very negative reviews containing specific, falsifiable details belong on Google. Suppressing them is itself an FTC violation under the Consumer Review Rule.`;

const DRAFT_INSTRUCTIONS = `- ACTIONABLE. For each flagged review, produce a drafted removal request text the owner can paste into Google's policy-violation reporting form.

REMOVAL REQUEST DRAFT GUIDELINES

For each flagged review's removal_request_draft:
- Open by identifying yourself as the business owner reporting a suspected policy violation.
- Cite the specific signals observed, with concrete details (timestamps, account histories, matched phrasing).
- Be polite, factual, and brief — under approximately 200 words.
- Avoid emotional language; Google's reviewers respond better to evidence than complaint.
- Use a [BUSINESS NAME] placeholder where the owner will substitute their real business name.`;

// Anonymous scans skip the drafts (the route strips flagged detail before an
// anonymous caller sees it, so paying output rates for ~200-word drafts was
// pure waste) — but the per-review reasoning stays REQUIRED. The written
// justification per flag is what keeps the flag count honest, and the count
// is exactly what the anonymous owner sees (docs/COST_OVERHAUL.md §3.5).
const NO_DRAFT_INSTRUCTIONS = `- NO REMOVAL DRAFTS. Do NOT write removal request drafts on this scan. Every flagged review still requires its full plain-English reasoning; that requirement is unchanged.`;

const RISK_SCORING_RULES = `RISK SCORING

overall_risk_score is 0-100:
- 0-25: Likely organic. No concerning patterns detected.
- 26-50: Mild flags but probably benign. Worth monitoring.
- 51-75: Concerning patterns warrant the owner's attention and likely warrant submitting some removal requests.
- 76-100: Strong indicators of a coordinated attack. Multiple signals converge.

risk_level maps to the score: 0-25 = "low", 26-50 = "medium", 51-75 = "high", 76-100 = "critical".

summary is one short paragraph (50-100 words) characterizing the overall finding in plain English.

You flag ONLY reviews that show genuine fraud signals. You do NOT flag every negative review. Reviews with specific, falsifiable details are real customer experiences, even when they are harsh — those belong on Google.`;

// Signed-in (full-report) prompt — byte-identical to the pre-split constant
// and to pipeline/task.py's SYSTEM_PROMPT (the lockstep pair).
const SYSTEM_PROMPT = `${SYSTEM_PROMPT_CORE}
${DRAFT_INSTRUCTIONS}

${RISK_SCORING_RULES}`;

// Anonymous ("teaser") prompt — same framework, draft instructions swapped
// for the explicit no-drafts / keep-reasoning rule.
const ANON_SYSTEM_PROMPT = `${SYSTEM_PROMPT_CORE}
${NO_DRAFT_INSTRUCTIONS}

${RISK_SCORING_RULES}`;

// Anonymous output schema: removal_request_draft is omitted entirely, so with
// structured outputs the model literally cannot spend output tokens on drafts.
// Signed-in scans keep the full AnalysisReportSchema unchanged.
const AnonFlaggedReviewSchema = FlaggedReviewSchema.omit({
  removal_request_draft: true,
});
const AnonAnalysisReportSchema = AnalysisReportSchema.extend({
  flagged_reviews: z.array(AnonFlaggedReviewSchema),
});

export async function analyzeReviewsWithClaude(
  businessUrl: string,
  reviews: Review[],
  ratingSummary: RatingSummary | null = null,
  effort: "low" | "medium" | "high" = "high",
  // Signed-in (default) → full report incl. removal drafts. Anonymous (false)
  // → no drafts generated at all; per-review reasoning still required.
  isAuthed: boolean = true,
): Promise<AnalysisReport> {
  const client = new Anthropic();

  // When we have it (live Nimble scrapes), give Claude the real
  // business-wide rating distribution as a baseline for signal #5
  // (rating-distribution anomalies). Absent (mock mode / scrape miss),
  // this is an empty string and behavior is unchanged.
  const distributionContext = ratingSummary
    ? `

Business-wide rating distribution from Google (all-time baseline):
- Overall: ${ratingSummary.overall_rating} stars across ${ratingSummary.review_count} total reviews
- Star breakdown: ${[5, 4, 3, 2, 1]
        .map((s) => `${s}-star: ${ratingSummary.ratings_count[String(s)] ?? 0}`)
        .join(", ")}
Use this as the baseline when judging whether the sampled reviews above represent a rating-distribution anomaly.`
    : "";

  // Slim payload: send only the six fields the analysis actually uses, as
  // COMPACT JSON (no indent). The extra fields some sources attach — a
  // ~150-char review_link URL and a 21-digit author_id per review — are never
  // echoed in the output schema (flagged reviews carry review_id only; callers
  // that need links re-join them from the raw scrape by id). Together this
  // cuts input tokens roughly in half (docs/COST_OVERHAUL.md §3.4).
  const slimReviews = reviews.map((review) => ({
    id: review.id,
    reviewer_name: review.reviewer_name,
    reviewer_total_reviews: review.reviewer_total_reviews,
    rating: review.rating,
    posted_at: review.posted_at,
    text: review.text,
  }));

  const userPrompt = `Analyze the following ${reviews.length} Google reviews for the business at: ${businessUrl}

Recent review data (JSON):
${JSON.stringify(slimReviews)}${distributionContext}

Apply your analysis framework and return a structured report. Flag only reviews showing genuine policy-violation signals; do NOT flag legitimate negative reviews even if they are harsh.`;

  // No cache_control on the system prompt: prompt caching is a closed topic
  // below 4,096-token prompts (docs/COST_OVERHAUL.md §5).
  if (!isAuthed) {
    const response = await client.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort,
        format: zodOutputFormat(AnonAnalysisReportSchema),
      },
      system: ANON_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    if (!response.parsed_output) {
      throw new Error("Claude returned no parsed output");
    }

    // Normalize back to the shared AnalysisReport shape so every caller sees
    // one type. The empty draft is an internal placeholder only: /api/analyze
    // strips flagged_reviews entirely for anonymous responses, and anonymous
    // scans are never persisted, so it can't reach a client or the store.
    const report = response.parsed_output;
    return {
      ...report,
      flagged_reviews: report.flagged_reviews.map((flagged) => ({
        ...flagged,
        removal_request_draft: "",
      })),
    };
  }

  const response = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort,
      format: zodOutputFormat(AnalysisReportSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  if (!response.parsed_output) {
    throw new Error("Claude returned no parsed output");
  }

  return response.parsed_output;
}
