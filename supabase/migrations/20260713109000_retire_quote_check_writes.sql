-- The standalone quote checklist is retired.
-- Revoke every historical bearer link, then allow only the owner's
-- privacy-preserving public -> private revocation during deployment overlap.
-- Account deletion remains a DELETE and is intentionally unaffected.

UPDATE public.amora_quote_checks
SET is_public = FALSE,
    published_at = NULL
WHERE is_public = TRUE
   OR published_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_retired_quote_check_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'quote_check_retired'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      OLD.is_public = TRUE
      AND NEW.is_public = FALSE
      AND NEW.published_at IS NULL
      AND (
        to_jsonb(NEW) - ARRAY['is_public', 'published_at', 'updated_at']
      ) = (
        to_jsonb(OLD) - ARRAY['is_public', 'published_at', 'updated_at']
      )
    ) THEN
      RAISE EXCEPTION 'quote_check_retired_read_only'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_retired_quote_check_write
  ON public.amora_quote_checks;
CREATE TRIGGER enforce_retired_quote_check_write
  BEFORE INSERT OR UPDATE ON public.amora_quote_checks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_retired_quote_check_write();

COMMENT ON TABLE public.amora_quote_checks IS
'Retired quote-check records. Historical public links were revoked; no new rows or edits are allowed, only defensive reads, revocation, and deletion.';
