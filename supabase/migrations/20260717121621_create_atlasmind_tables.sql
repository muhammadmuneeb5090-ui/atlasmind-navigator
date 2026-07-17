/*
# AtlasMind community + persistence schema

## Overview
Adds the database tables backing AtlasMind's community intelligence,
hyper-local place mapping, favorites, and route history features.
This is a single-tenant (no-auth) app: there is no sign-in screen, so all
policies are scoped to `TO anon, authenticated` and the data is intentionally
shared/public. Per-user attribution (favorites, route history, place
confirmations) is keyed on a client-generated `device_id` (a UUID persisted in
the browser's localStorage) rather than `auth.uid()`.

## New Tables

1. `community_reports`
   - `id` uuid PK
   - `device_id` text (which device submitted the report)
   - `category` text (road_damage | flood | construction | parking | safety | facilities)
   - `description` text (optional notes)
   - `lat` double precision, `lng` double precision (report location)
   - `created_at` timestamptz

2. `places`
   - `id` uuid PK
   - `device_id` text (submitter)
   - `name` text NOT NULL
   - `category` text (home | shop | lane)
   - `lat` double precision, `lng` double precision NOT NULL
   - `status` text NOT NULL DEFAULT 'pending' (pending | verified)
   - `confirmation_count` integer NOT NULL DEFAULT 0
   - `created_at` timestamptz

3. `place_confirmations`
   - `id` uuid PK
   - `place_id` uuid FK -> places(id) ON DELETE CASCADE
   - `device_id` text (which device confirmed)
   - `created_at` timestamptz
   - UNIQUE(place_id, device_id) — one confirmation per device per place

4. `favorites`
   - `id` uuid PK
   - `device_id` text (owner)
   - `name` text
   - `lat` double precision, `lng` double precision
   - `created_at` timestamptz
   - UNIQUE(device_id, lat, lng) — no duplicate favorites for a device

5. `route_history`
   - `id` uuid PK
   - `device_id` text (owner)
   - `from_label` text, `to_label` text
   - `from_lat`, `from_lng`, `to_lat`, `to_lng` double precision
   - `distance_m` double precision, `duration_s` double precision
   - `created_at` timestamptz

## Security (RLS)
- All tables have RLS ENABLED.
- All policies use `TO anon, authenticated` (no-auth app, intentionally shared).
- Community reports & places: full public CRUD (anyone can read/submit; owners
  can delete their own). Places are not user-deletable except by submitter, to
  protect the community dataset; confirmations only insert/delete.
- Favorites & route_history: anyone with the same `device_id` can manage their
  own rows (single-tenant, device-scoped). Reads are restricted to the owning
  device so a user's favorites/history aren't broadcast.

## Notes
- `device_id` is a client-generated UUID (crypto.randomUUID()) stored in
  localStorage. It is NOT a security boundary — it is attribution. The app is
  single-tenant by design.
- The place auto-verification trigger lives in a separate migration.
*/

CREATE TABLE IF NOT EXISTS community_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('road_damage','flood','construction','parking','safety','facilities')),
  description text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('home','shop','lane')),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified')),
  confirmation_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS place_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(place_id, device_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  name text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id, lat, lng)
);

CREATE TABLE IF NOT EXISTS route_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  from_label text NOT NULL,
  to_label text NOT NULL,
  from_lat double precision NOT NULL,
  from_lng double precision NOT NULL,
  to_lat double precision NOT NULL,
  to_lng double precision NOT NULL,
  distance_m double precision NOT NULL,
  duration_s double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE community_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE places ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_history ENABLE ROW LEVEL SECURITY;

-- community_reports: public read, anyone may insert, owner may update/delete
DROP POLICY IF EXISTS "cr_select" ON community_reports;
CREATE POLICY "cr_select" ON community_reports FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "cr_insert" ON community_reports;
CREATE POLICY "cr_insert" ON community_reports FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "cr_update" ON community_reports;
CREATE POLICY "cr_update" ON community_reports FOR UPDATE
  TO anon, authenticated USING (device_id = current_setting('app.device_id', true))
  WITH CHECK (true);

DROP POLICY IF EXISTS "cr_delete" ON community_reports;
CREATE POLICY "cr_delete" ON community_reports FOR DELETE
  TO anon, authenticated USING (device_id = current_setting('app.device_id', true));

-- places: public read, anyone may insert, submitter may delete
DROP POLICY IF EXISTS "p_select" ON places;
CREATE POLICY "p_select" ON places FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "p_insert" ON places;
CREATE POLICY "p_insert" ON places FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "p_delete" ON places;
CREATE POLICY "p_delete" ON places FOR DELETE
  TO anon, authenticated USING (device_id = current_setting('app.device_id', true));

-- place_confirmations: public read, anyone may insert (one per device), owner may delete own
DROP POLICY IF EXISTS "pc_select" ON place_confirmations;
CREATE POLICY "pc_select" ON place_confirmations FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "pc_insert" ON place_confirmations;
CREATE POLICY "pc_insert" ON place_confirmations FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "pc_delete" ON place_confirmations;
CREATE POLICY "pc_delete" ON place_confirmations FOR DELETE
  TO anon, authenticated USING (device_id = current_setting('app.device_id', true));

-- favorites: device-scoped (only the owning device sees/manages its rows)
DROP POLICY IF EXISTS "f_select" ON favorites;
CREATE POLICY "f_select" ON favorites FOR SELECT
  TO anon, authenticated USING (device_id = current_setting('app.device_id', true));

DROP POLICY IF EXISTS "f_insert" ON favorites;
CREATE POLICY "f_insert" ON favorites FOR INSERT
  TO anon, authenticated WITH CHECK (device_id = current_setting('app.device_id', true));

DROP POLICY IF EXISTS "f_delete" ON favorites;
CREATE POLICY "f_delete" ON favorites FOR DELETE
  TO anon, authenticated USING (device_id = current_setting('app.device_id', true));

-- route_history: device-scoped
DROP POLICY IF EXISTS "rh_select" ON route_history;
CREATE POLICY "rh_select" ON route_history FOR SELECT
  TO anon, authenticated USING (device_id = current_setting('app.device_id', true));

DROP POLICY IF EXISTS "rh_insert" ON route_history;
CREATE POLICY "rh_insert" ON route_history FOR INSERT
  TO anon, authenticated WITH CHECK (device_id = current_setting('app.device_id', true));

DROP POLICY IF EXISTS "rh_delete" ON route_history;
CREATE POLICY "rh_delete" ON route_history FOR DELETE
  TO anon, authenticated USING (device_id = current_setting('app.device_id', true));

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_community_reports_created ON community_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_places_status ON places(status);
CREATE INDEX IF NOT EXISTS idx_place_confirmations_place ON place_confirmations(place_id);
CREATE INDEX IF NOT EXISTS idx_favorites_device ON favorites(device_id);
CREATE INDEX IF NOT EXISTS idx_route_history_device_created ON route_history(device_id, created_at DESC);
