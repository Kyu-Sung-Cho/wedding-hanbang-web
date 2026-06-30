-- Decouple operator/seed curation from public vendor ranking.
-- `public_vendors` was intentionally dropped in 20260611150000 because the app
-- uses the API route backed by the `vendors` table directly. Do not re-create a
-- definer view just to change ordering; that would reopen an unused DB surface.

DROP VIEW IF EXISTS public.public_vendors;
