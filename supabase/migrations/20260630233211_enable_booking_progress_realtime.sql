-- =============================================
-- Realtime Publication: booking/progress sync (2026-06-30 UTC)
-- =============================================
-- Mobile Bookings and Budget screens subscribe to these shared planning tables.
-- Focus refresh still works without Realtime, but partner-visible updates should
-- broadcast immediately when bookings or journey progress change.
-- =============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'vendor_bookings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vendor_bookings;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'wedding_journeys'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wedding_journeys;
  END IF;
END $$;

-- Verification:
--   SELECT schemaname, tablename
--   FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime'
--     AND schemaname = 'public'
--     AND tablename IN ('vendor_bookings', 'wedding_journeys');
