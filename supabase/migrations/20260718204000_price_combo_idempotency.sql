-- A double tap, a browser retry, or a lost HTTP response must not create two
-- saved combinations. The API supplies one UUID key and a canonical request
-- hash; the database makes that pair durable per authenticated owner.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.combos
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS request_hash text;

-- Existing combinations predate the HTTP idempotency contract. Give each one
-- a unique non-replayable key and an explicit legacy marker that still conforms
-- to the fixed-width hash boundary.
UPDATE public.combos
SET idempotency_key = COALESCE(idempotency_key, gen_random_uuid()),
    request_hash = COALESCE(request_hash, repeat('0', 64))
WHERE idempotency_key IS NULL
   OR request_hash IS NULL;

ALTER TABLE public.combos
  ALTER COLUMN idempotency_key SET DEFAULT gen_random_uuid(),
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN request_hash SET NOT NULL;

DO $combo_request_hash_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.combos'::regclass
      AND constraint_row.conname = 'combos_request_hash_check'
  ) THEN
    ALTER TABLE public.combos
      ADD CONSTRAINT combos_request_hash_check
      CHECK (request_hash ~ '^[a-f0-9]{64}$')
      NOT VALID;
  END IF;
END
$combo_request_hash_constraint$;

ALTER TABLE public.combos
  VALIDATE CONSTRAINT combos_request_hash_check;

CREATE UNIQUE INDEX IF NOT EXISTS combos_user_idempotency_unique
  ON public.combos (user_id, idempotency_key);

COMMENT ON COLUMN public.combos.idempotency_key IS
  'Opaque client request UUID. Unique per owner so retries return one saved combo.';
COMMENT ON COLUMN public.combos.request_hash IS
  'Lowercase SHA-256 of the normalized pre-repricing save request; key reuse with another request fails closed.';

DO $combo_idempotency_postconditions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = 'combos'
      AND column_row.column_name IN ('idempotency_key', 'request_hash')
      AND column_row.is_nullable <> 'NO'
  )
    OR (
      SELECT count(*)
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'combos'
        AND column_row.column_name IN ('idempotency_key', 'request_hash')
    ) <> 2
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.combos'::regclass
        AND constraint_row.conname = 'combos_request_hash_check'
        AND constraint_row.convalidated
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_row
      WHERE index_row.indexrelid =
        'public.combos_user_idempotency_unique'::regclass
        AND index_row.indrelid = 'public.combos'::regclass
        AND index_row.indisunique
        AND index_row.indisvalid
    )
  THEN
    RAISE EXCEPTION 'PRICE_COMBO_IDEMPOTENCY_POSTCONDITION_FAILED'
      USING ERRCODE = '55000';
  END IF;
END
$combo_idempotency_postconditions$;

COMMIT;
