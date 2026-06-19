-- ghost.reviews — prospect_scans: business metadata for the per-business "file".
--
-- Powers the Phase 2 admin detail page (/admin/business/[placeId]): contact
-- info, a map, the direct Google links, and rating-over-time history. Every
-- column is additive + nullable, so existing rows and the best-effort insert
-- path keep working unchanged. Older scans simply have nulls here.
--
-- Apply via the Supabase SQL Editor (same as the earlier migrations). Safe to
-- re-run — every add is "if not exists".

alter table public.prospect_scans
  add column if not exists overall_rating    numeric,           -- business's all-time star average at scan time
  add column if not exists business_address  text,
  add column if not exists business_phone    text,
  add column if not exists business_website  text,
  add column if not exists business_maps_url text,               -- Google Maps place link
  add column if not exists reviews_url       text,               -- direct Google reviews page
  add column if not exists latitude          double precision,
  add column if not exists longitude         double precision;
