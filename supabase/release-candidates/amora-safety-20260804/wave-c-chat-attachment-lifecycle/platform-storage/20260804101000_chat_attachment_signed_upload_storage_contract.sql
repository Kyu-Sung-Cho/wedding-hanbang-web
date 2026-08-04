-- PLATFORM OPERATION / RELEASE CANDIDATE ONLY.
-- Do not run through `supabase db push` or the SQL editor. Hosted Supabase
-- owns storage.objects; reproduce this exact operation through the approved
-- Dashboard/controller path only after the signed-upload fleet and token-drain
-- gates in the companion handoff have passed.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $signed_upload_precondition$
DECLARE
  v_policy_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'storage'
       AND relation.relname = 'objects'
       AND relation.relkind = 'r'
       AND relation.relrowsecurity
       AND NOT relation.relforcerowsecurity
       AND pg_catalog.pg_get_userbyid(relation.relowner)
         = 'supabase_storage_admin'
  )
  OR pg_catalog.to_regclass('public.chat_attachment_runtime_state') IS NULL
  OR NOT EXISTS (
    SELECT 1
      FROM public.chat_attachment_runtime_state AS state
     WHERE state.singleton
       AND state.storage_write_contract = 'legacy_mutable'
       AND state.storage_contract_evidence_sha256 IS NULL
       AND state.storage_contract_activated_at IS NULL
  )
  OR pg_catalog.to_regprocedure('extensions.digest(text,text)') IS NULL
  OR NOT EXISTS (
    SELECT 1
      FROM storage.buckets AS bucket
     WHERE bucket.id = 'chat-image'
       AND bucket.name = 'chat-image'
       AND NOT bucket.public
  )
  OR (
    SELECT count(*)
      FROM pg_catalog.pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
  ) <> 1 THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_SIGNED_UPLOAD_PRECONDITION_INVALID';
  END IF;

  SELECT policy.policyname
    INTO v_policy_name
    FROM pg_catalog.pg_policies AS policy
   WHERE policy.schemaname = 'storage'
     AND policy.tablename = 'objects'
     AND policy.permissive = 'PERMISSIVE'
     AND policy.roles = ARRAY['authenticated']::name[]
     AND policy.cmd = 'INSERT'
     AND pg_catalog.encode(extensions.digest(lower(pg_catalog.regexp_replace(
       coalesce(policy.qual, '') || E'\n' || coalesce(policy.with_check, ''),
       E'\s+', '', 'g'
     )), 'sha256'), 'hex')
       = '7b9e967897a69bdc226f09e02a240db1ca64f0caeb58244912445ff0f5032482';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_SIGNED_UPLOAD_PRECONDITION_INVALID';
  END IF;

  -- The server-signed token is exact-path and upsert=false. Removing this last
  -- authenticated mutation policy closes the unsigned bypass that otherwise
  -- has no durable session row and therefore cannot be swept after a crash.
  EXECUTE pg_catalog.format(
    'DROP POLICY %I ON storage.objects',
    v_policy_name
  );
END;
$signed_upload_precondition$;

UPDATE storage.buckets
   SET public = false,
       file_size_limit = 10 * 1024 * 1024,
       allowed_mime_types = ARRAY[
         'image/jpeg', 'image/png', 'image/gif', 'image/webp'
       ]::text[]
 WHERE id = 'chat-image';

-- This state flip is in the same transaction as the last unsigned mutation
-- policy removal. Cleanup remains fail-closed until this atomic contraction
-- commits, and the DB candidate makes signed_only monotonic.
UPDATE public.chat_attachment_runtime_state
   SET storage_write_contract = 'signed_only',
       storage_contract_evidence_sha256 = pg_catalog.encode(
         extensions.digest(
           'amora-chat-attachment-signed-only-storage-v1',
           'sha256'
         ),
         'hex'
       ),
       storage_contract_activated_at = clock_timestamp(),
       updated_at = clock_timestamp()
 WHERE singleton
   AND storage_write_contract = 'legacy_mutable';

DO $signed_upload_postcondition$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
  )
  OR NOT EXISTS (
    SELECT 1
      FROM public.chat_attachment_runtime_state AS state
     WHERE state.singleton
       AND state.storage_write_contract = 'signed_only'
       AND state.storage_contract_evidence_sha256 = pg_catalog.encode(
         extensions.digest(
           'amora-chat-attachment-signed-only-storage-v1',
           'sha256'
         ),
         'hex'
       )
       AND state.storage_contract_activated_at IS NOT NULL
  )
  OR NOT EXISTS (
    SELECT 1
      FROM storage.buckets AS bucket
     WHERE bucket.id = 'chat-image'
       AND bucket.name = 'chat-image'
       AND NOT bucket.public
       AND bucket.file_size_limit = 10 * 1024 * 1024
       AND bucket.allowed_mime_types = ARRAY[
         'image/jpeg', 'image/png', 'image/gif', 'image/webp'
       ]::text[]
  ) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_SIGNED_UPLOAD_POSTCONDITION_INVALID';
  END IF;
END;
$signed_upload_postcondition$;

COMMIT;
