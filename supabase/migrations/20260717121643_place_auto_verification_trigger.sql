/*
# Place auto-verification trigger

## Overview
When a place accumulates 3 distinct device confirmations (3 different devices),
its `status` automatically flips from 'pending' to 'verified' and
`confirmation_count` is kept in sync. This runs entirely in the database via a
trigger on `place_confirmations` so the frontend never has to poll or manually
promote places.

## Changes
1. Function `sync_place_confirmation_count()` — after insert/delete on
   place_confirmations, recomputes the distinct device count for the affected
   place and updates places.confirmation_count and places.status (verified when
   count >= 3).
2. Triggers `place_confirmations_ai` (after insert) and `place_confirmations_ad`
   (after delete) calling the function.

## Notes
- `confirmation_count` stores the count of DISTINCT device_id values, matching
  the UNIQUE(place_id, device_id) constraint so it can never exceed the row
  count.
- Idempotent: re-running drops and recreates the function and triggers.
*/

DROP TRIGGER IF EXISTS place_confirmations_ai ON place_confirmations;
DROP TRIGGER IF EXISTS place_confirmations_ad ON place_confirmations;
DROP FUNCTION IF EXISTS sync_place_confirmation_count();

CREATE FUNCTION sync_place_confirmation_count() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  affected_place uuid;
  cnt integer;
BEGIN
  affected_place := COALESCE(NEW.place_id, OLD.place_id);
  IF affected_place IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT COUNT(DISTINCT device_id) INTO cnt
  FROM place_confirmations
  WHERE place_id = affected_place;
  UPDATE places
    SET confirmation_count = cnt,
        status = CASE WHEN cnt >= 3 THEN 'verified' ELSE 'pending' END
    WHERE id = affected_place;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER place_confirmations_ai
  AFTER INSERT ON place_confirmations
  FOR EACH ROW EXECUTE FUNCTION sync_place_confirmation_count();

CREATE TRIGGER place_confirmations_ad
  AFTER DELETE ON place_confirmations
  FOR EACH ROW EXECUTE FUNCTION sync_place_confirmation_count();
