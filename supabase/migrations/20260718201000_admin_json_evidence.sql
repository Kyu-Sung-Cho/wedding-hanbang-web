BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- The authenticated admin JSON upload is itself the immutable input artifact
-- for the manual ingestion path. Keep the same content-addressed key contract
-- as disclosure documents while permitting only the non-executable JSON
-- extension and exact MIME type.
CREATE OR REPLACE FUNCTION public.disclosure_object_keys_are_safe(
  p_object_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $disclosure_object_keys_are_safe$
  SELECT
    p_object_keys IS NOT NULL
    AND cardinality(p_object_keys) <= 100
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_object_keys) AS object_key(value)
      WHERE value IS NULL
        OR value !~ '^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png|json)$'
    );
$disclosure_object_keys_are_safe$;

ALTER FUNCTION public.disclosure_object_keys_are_safe(text[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.disclosure_object_keys_are_safe(text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disclosure_object_keys_are_safe(text[])
  TO service_role;

UPDATE storage.buckets AS bucket
SET public = false,
    allowed_mime_types = ARRAY(
      SELECT DISTINCT mime_type
      FROM unnest(
        COALESCE(bucket.allowed_mime_types, '{}'::text[])
        || ARRAY['application/json']::text[]
      ) AS allowed(mime_type)
      ORDER BY mime_type
    )
WHERE bucket.id = 'disclosure-raw';

DO $admin_json_evidence_postconditions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets AS bucket
    WHERE bucket.id = 'disclosure-raw'
      AND bucket.public IS FALSE
      AND 'application/json' = ANY(bucket.allowed_mime_types)
  ) THEN
    RAISE EXCEPTION 'ADMIN_JSON_EVIDENCE_BUCKET_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;

  IF NOT public.disclosure_object_keys_are_safe(
    ARRAY[repeat('a', 64) || '.json']::text[]
  ) OR public.disclosure_object_keys_are_safe(
    ARRAY['../' || repeat('a', 64) || '.json']::text[]
  ) THEN
    RAISE EXCEPTION 'ADMIN_JSON_EVIDENCE_KEY_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END
$admin_json_evidence_postconditions$;

COMMIT;
