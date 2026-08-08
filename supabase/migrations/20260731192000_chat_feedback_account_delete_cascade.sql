BEGIN;

-- chat_feedback can contain an explicitly authored correction and a copy of a
-- shared AI answer. It must therefore follow the author across the Auth
-- deletion boundary instead of becoming an ownerless training record.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE public.chat_feedback IN SHARE ROW EXCLUSIVE MODE;

-- Historical rows predate an Auth FK. Keep only coarse, allowlisted analytics
-- for rows that cannot be tied to a live Auth user; remove every identifier and
-- free-text field before enforcing the new boundary.
UPDATE public.chat_feedback AS feedback
   SET user_id = NULL,
       couple_id = NULL,
       message_id = NULL,
       correction = NULL,
       message_content = NULL,
       category = CASE
         WHEN feedback.category IN (
           'correction',
           'retry',
           'frustration',
           'negative',
           'confusion',
           'disengagement'
         ) THEN feedback.category
         ELSE NULL
       END
 WHERE feedback.user_id IS NULL
    OR NOT EXISTS (
      SELECT 1
        FROM auth.users AS auth_user
       WHERE auth_user.id = feedback.user_id
    );

DO $add_chat_feedback_auth_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_record
     WHERE constraint_record.conrelid = 'public.chat_feedback'::regclass
       AND constraint_record.conname =
         'chat_feedback_user_id_fkey'
  ) THEN
    ALTER TABLE public.chat_feedback
      ADD CONSTRAINT chat_feedback_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END;
$add_chat_feedback_auth_fk$;

ALTER TABLE public.chat_feedback
  VALIDATE CONSTRAINT chat_feedback_user_id_fkey;

DO $chat_feedback_auth_fk_postcondition$
DECLARE
  matching_constraint_count bigint;
BEGIN
  SELECT count(*)
    INTO matching_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation_record
      ON relation_record.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace_record
      ON namespace_record.oid = relation_record.relnamespace
    JOIN pg_catalog.pg_attribute AS column_record
      ON column_record.attrelid = constraint_record.conrelid
     AND constraint_record.conkey =
       ARRAY[column_record.attnum]::smallint[]
    JOIN pg_catalog.pg_attribute AS referenced_column
      ON referenced_column.attrelid = constraint_record.confrelid
     AND constraint_record.confkey =
       ARRAY[referenced_column.attnum]::smallint[]
   WHERE constraint_record.contype = 'f'
     AND namespace_record.nspname = 'public'
     AND relation_record.relname = 'chat_feedback'
     AND column_record.attname = 'user_id'
     AND constraint_record.confrelid = 'auth.users'::regclass
     AND referenced_column.attname = 'id'
     AND constraint_record.conname =
       'chat_feedback_user_id_fkey'
     AND constraint_record.convalidated
     AND NOT constraint_record.condeferrable
     AND NOT constraint_record.condeferred
     AND constraint_record.confmatchtype = 's'
     AND constraint_record.confupdtype = 'a'
     AND constraint_record.confdeltype = 'c';

  IF matching_constraint_count <> 1 THEN
    RAISE EXCEPTION 'CHAT_FEEDBACK_AUTH_DELETE_BOUNDARY_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.chat_feedback AS feedback
     WHERE feedback.user_id IS NULL
       AND (
         feedback.couple_id IS NOT NULL
         OR feedback.message_id IS NOT NULL
         OR feedback.correction IS NOT NULL
         OR feedback.message_content IS NOT NULL
         OR feedback.category IS NOT NULL
            AND feedback.category NOT IN (
              'correction',
              'retry',
              'frustration',
              'negative',
              'confusion',
              'disengagement'
            )
       )
  ) THEN
    RAISE EXCEPTION 'CHAT_FEEDBACK_ORPHAN_DATA_NOT_MINIMIZED';
  END IF;
END;
$chat_feedback_auth_fk_postcondition$;

COMMENT ON CONSTRAINT chat_feedback_user_id_fkey
  ON public.chat_feedback IS
  'Deletes explicit and automatic AI feedback when its Auth user is deleted.';

COMMIT;
