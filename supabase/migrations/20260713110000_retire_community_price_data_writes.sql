-- Retire community_posts.price_data as a write surface.
-- Historical values remain readable so old posts do not break. A value may
-- only be cleared for privacy/correction; it can never be inserted or changed.

CREATE OR REPLACE FUNCTION public.enforce_retired_community_price_data()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.price_data IS NOT NULL THEN
      RAISE EXCEPTION 'community_price_data_is_retired'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.price_data IS DISTINCT FROM OLD.price_data THEN
    -- Removing a historical user-entered value remains possible. This is the
    -- only price_data mutation permitted after retirement.
    IF OLD.price_data IS NOT NULL AND NEW.price_data IS NULL THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'community_price_data_is_retired'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_retired_community_price_data_write
  ON public.community_posts;
CREATE TRIGGER enforce_retired_community_price_data_write
  BEFORE INSERT OR UPDATE ON public.community_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_retired_community_price_data();

REVOKE ALL ON FUNCTION public.enforce_retired_community_price_data()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_retired_community_price_data()
  TO service_role;
