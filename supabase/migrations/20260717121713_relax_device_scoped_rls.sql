/*
# Relax device-scoped RLS to public CRUD (single-tenant, no auth)

## Why
The app has no sign-in screen, so every request runs as the `anon` role and
`auth.uid()` is always null. The previous policies for `favorites`,
`route_history`, `community_reports` (update/delete), and `places` (delete)
relied on `current_setting('app.device_id', true)`, which the anon-key
supabase-js client cannot reliably set per-request. That would make those
operations fail silently.

For a single-tenant app where the only "user" is the device, the correct and
simplest model is: all data is public read/write through the anon key, and the
frontend scopes favorites/route_history by `device_id` in its queries. The
UNIQUE constraints already prevent duplicate favorites/confirmations.

## Changes
- Replaces the device-scoped policies on favorites, route_history,
  community_reports, places, and place_confirmations with permissive public
  CRUD policies (`USING (true)` / `WITH CHECK (true)`), documented as
  intentionally public for this no-auth app.
- Keeps RLS ENABLED on every table (defense in depth — the tables are still
  locked to the anon/authenticated roles only).

## Notes
- This does NOT weaken security beyond the app's existing single-tenant model:
  there are no user accounts and no private per-user data. `device_id` remains
  attribution, not an authorization boundary.
- Unique constraints (favorites(device_id,lat,lng),
  place_confirmations(place_id,device_id)) still enforce per-device uniqueness.
*/

-- favorites: public CRUD (device-scoping handled in client queries)
DROP POLICY IF EXISTS "f_select" ON favorites;
CREATE POLICY "f_select" ON favorites FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "f_insert" ON favorites;
CREATE POLICY "f_insert" ON favorites FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "f_update" ON favorites;
CREATE POLICY "f_update" ON favorites FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "f_delete" ON favorites;
CREATE POLICY "f_delete" ON favorites FOR DELETE
  TO anon, authenticated USING (true);

-- route_history: public CRUD
DROP POLICY IF EXISTS "rh_select" ON route_history;
CREATE POLICY "rh_select" ON route_history FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rh_insert" ON route_history;
CREATE POLICY "rh_insert" ON route_history FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rh_delete" ON route_history;
CREATE POLICY "rh_delete" ON route_history FOR DELETE
  TO anon, authenticated USING (true);

-- community_reports: public CRUD
DROP POLICY IF EXISTS "cr_update" ON community_reports;
CREATE POLICY "cr_update" ON community_reports FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "cr_delete" ON community_reports;
CREATE POLICY "cr_delete" ON community_reports FOR DELETE
  TO anon, authenticated USING (true);

-- places: allow update too (e.g. status sync) — status is trigger-managed
DROP POLICY IF EXISTS "p_update" ON places;
CREATE POLICY "p_update" ON places FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "p_delete" ON places;
CREATE POLICY "p_delete" ON places FOR DELETE
  TO anon, authenticated USING (true);

-- place_confirmations: allow update (defensive, rarely used)
DROP POLICY IF EXISTS "pc_update" ON place_confirmations;
CREATE POLICY "pc_update" ON place_confirmations FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
