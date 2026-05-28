import type { AnalysisReport, Review } from "./analysis-schema";

export const MOCK_REVIEWS: Review[] = [
  {
    id: "r-001",
    reviewer_name: "Sarah M.",
    reviewer_total_reviews: 47,
    rating: 5,
    posted_at: "2026-04-15T14:23:00Z",
    text: "Came here for my anniversary dinner. The mushroom risotto was perfectly creamy and our server Marco recommended a great Barolo to pair with it. The patio seating was lovely. Will definitely come back!",
  },
  {
    id: "r-002",
    reviewer_name: "David K.",
    reviewer_total_reviews: 23,
    rating: 4,
    posted_at: "2026-04-22T19:05:00Z",
    text: "Food was excellent — the seared scallops were the highlight — but the wait for our table was 25 minutes past our reservation time. Service apologized which was nice. Would come back but call ahead to confirm wait times.",
  },
  {
    id: "r-003",
    reviewer_name: "John Smith",
    reviewer_total_reviews: 1,
    rating: 1,
    posted_at: "2026-04-28T13:47:00Z",
    text: "Terrible place. Staff are rude. Would not recommend to anyone.",
  },
  {
    id: "r-004",
    reviewer_name: "Jane Doe",
    reviewer_total_reviews: 1,
    rating: 1,
    posted_at: "2026-04-28T13:51:00Z",
    text: "Worst restaurant ever. The staff are extremely rude. Do not go here.",
  },
  {
    id: "r-005",
    reviewer_name: "Mike Johnson",
    reviewer_total_reviews: 2,
    rating: 1,
    posted_at: "2026-04-28T13:54:00Z",
    text: "Awful experience. Rude staff. I would not recommend this place at all.",
  },
  {
    id: "r-006",
    reviewer_name: "Patricia L.",
    reviewer_total_reviews: 89,
    rating: 1,
    posted_at: "2026-05-03T20:30:00Z",
    text: "I'm a regular here but tonight was a disaster. Our server forgot our drinks, my entrée came out cold, and when I mentioned it the manager argued with me instead of apologizing. I've recommended this place to many friends over the years but won't be returning.",
  },
  {
    id: "r-007",
    reviewer_name: "Carlos R.",
    reviewer_total_reviews: 31,
    rating: 5,
    posted_at: "2026-05-18T12:15:00Z",
    text: "Excellent brunch! The eggs benedict with crab were outstanding. Service was attentive without being intrusive. Their cold brew is also some of the best I've had in the city.",
  },
];

export const MOCK_REPORT: AnalysisReport = {
  overall_risk_score: 72,
  risk_level: "high",
  summary:
    "Strong indicators of a coordinated review-bombing attack detected on April 28, 2026. Three 1-star reviews from low-history accounts were posted within a 7-minute window, all citing 'rude staff' in nearly identical templated phrasing with no specific details about staff names, products, or events. This is the classic signature of a coordinated campaign. A separate legitimate 1-star review from May 3 includes specific, falsifiable details and is not flagged — that customer's experience should be addressed directly, not contested as fraudulent.",
  flagged_reviews: [
    {
      review_id: "r-003",
      reviewer_name: "John Smith",
      rating: 1,
      posted_at: "2026-04-28T13:47:00Z",
      risk_level: "high",
      signals: [
        "Timing cluster: posted within a 7-minute window with two other 1-star reviews on 2026-04-28",
        "Low-history account: only 1 total review on this Google account",
        "Generic complaint: 'rude staff' with no specifics about staff members, behavior, or context",
        "Templated phrasing: structure closely matches reviews r-004 and r-005",
        "Generic reviewer name: 'John Smith' is a high-probability placeholder identity",
      ],
      reasoning:
        "This review exhibits five hallmark signals of a coordinated review-bombing campaign. The reviewer's Google account has only one review, posted within a 7-minute window of two other 1-star reviews using nearly identical templated language. No specific details are provided that would suggest a genuine visit — no product, server, time of day, or event. While we cannot prove fraud, the constellation of signals strongly suggests this is not an organic review.",
      removal_request_draft:
        "I am the owner of [BUSINESS NAME] and I am reporting a suspected violation of Google's review content policies. The review by 'John Smith' posted on April 28, 2026 at 13:47 UTC appears to be part of a coordinated review-bombing attack. Specifically: (1) it was posted within a 7-minute window with two other 1-star reviews from low-history accounts ('Jane Doe' and 'Mike Johnson'); (2) all three reviews use nearly identical templated phrasing centered on 'rude staff' and 'would not recommend'; (3) the account has only one review in its entire history; and (4) the review contains no specific details — no menu items, staff names, dates, or incidents — that would suggest a genuine visit to my business. I respectfully request that this review be reviewed for fake-review policy violation. Thank you.",
    },
    {
      review_id: "r-004",
      reviewer_name: "Jane Doe",
      rating: 1,
      posted_at: "2026-04-28T13:51:00Z",
      risk_level: "high",
      signals: [
        "Timing cluster: posted 4 minutes after review r-003 and 3 minutes before r-005, all 1-star",
        "Low-history account: only 1 total review",
        "Templated phrasing: structurally identical to reviews r-003 and r-005",
        "Generic reviewer name: 'Jane Doe' is a placeholder identity",
        "Vague complaint with no falsifiable details",
      ],
      reasoning:
        "This review sits in the middle of the April 28 timing cluster, posted 4 minutes after 'John Smith' and 3 minutes before 'Mike Johnson'. All three accounts have effectively no review history, all gave 1-star ratings, and all use the same templated 'rude staff / would not recommend' structure with no specific details. The probability that three independent, real customers posted reviews this similar within a 7-minute window approaches zero.",
      removal_request_draft:
        "I am the owner of [BUSINESS NAME] and I am reporting a suspected coordinated review-bombing attack. The review by 'Jane Doe' posted on April 28, 2026 at 13:51 UTC sits in the middle of a 7-minute timing cluster with two other 1-star reviews ('John Smith' at 13:47 and 'Mike Johnson' at 13:54). All three reviewer accounts have only 1-2 reviews in total, all three use nearly identical templated phrasing ('rude staff', 'would not recommend', 'do not go here'), and none of them mention specific details such as menu items, staff names, or events that would suggest an actual visit. I respectfully request that this review be reviewed for fake-review policy violation. Thank you.",
    },
    {
      review_id: "r-005",
      reviewer_name: "Mike Johnson",
      rating: 1,
      posted_at: "2026-04-28T13:54:00Z",
      risk_level: "high",
      signals: [
        "Timing cluster: third in a 7-minute window of suspicious 1-star reviews",
        "Low-history account: only 2 total reviews",
        "Templated phrasing: structurally identical to reviews r-003 and r-004",
        "Vague complaint without specifics",
      ],
      reasoning:
        "This review closes the April 28 timing cluster. It uses the same 'rude staff / would not recommend' template as the other two reviews posted within the prior 7 minutes. The reviewer account has only two reviews total, and this one contains no concrete details about the alleged visit. Taken together with reviews r-003 and r-004, this strongly suggests a coordinated campaign rather than three independent customer experiences.",
      removal_request_draft:
        "I am the owner of [BUSINESS NAME] and I am reporting a suspected coordinated review-bombing attack. The review by 'Mike Johnson' posted on April 28, 2026 at 13:54 UTC is the third in a 7-minute timing cluster of 1-star reviews from low-history accounts ('John Smith' at 13:47 and 'Jane Doe' at 13:51 are the others). All three use nearly identical templated phrasing focused on 'rude staff' and 'would not recommend' with no specific anchoring details — no menu items, no staff names, no times, no events. The reviewer's account has only two total reviews. I respectfully request that this review be reviewed for fake-review policy violation. Thank you.",
    },
  ],
  total_reviews_analyzed: 7,
};
