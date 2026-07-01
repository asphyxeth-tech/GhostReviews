// DiscoveredBusiness — the normalized shape a discovery provider returns.
//
// The PAID Outscraper Maps-search client that used to live in this file was
// DELETED (docs/COST_OVERHAUL.md §3 item 7): it fired as a silent fallback
// whenever GOOGLE_MAPS_API_KEY was missing, spending Outscraper credits on an
// env-var typo with no budget and no log. Discovery now runs exclusively
// through the free Google Places Text Search client (src/lib/google-places.ts),
// and a missing key is a loud 500 in /api/admin/discover.
//
// Only this type remains because google-places.ts imports it. Follow-up: move
// the type into google-places.ts and delete this file entirely.

export type DiscoveredBusiness = {
  name: string;
  place_id: string;
  full_address: string;
  total_reviews: number;
  rating: number | null;
  type: string;
  phone: string;
  site: string;
  reviews_per_score: Record<string, number> | null;
};
