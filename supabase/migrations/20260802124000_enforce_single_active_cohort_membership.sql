-- Make active cohort membership a database invariant.
--
-- The cohort GET endpoint historically repaired multiple active memberships as
-- a side effect of reading. Keep the newest membership deterministically,
-- deactivate older duplicates, repair denormalized room counts, and prevent the
-- invalid state from recurring. This is an explicit one-time data repair.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $cohort_membership_preflight$
DECLARE
  missing_prerequisite text;
BEGIN
  SELECT string_agg(
    format('%I.%I', prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_name, prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('cohort_rooms', 'id'),
    ('cohort_rooms', 'member_count'),
    ('cohort_members', 'id'),
    ('cohort_members', 'room_id'),
    ('cohort_members', 'user_id'),
    ('cohort_members', 'joined_at'),
    ('cohort_members', 'is_active')
  ) AS prerequisite(table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = 'public'
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'COHORT_ACTIVE_MEMBERSHIP_PREREQUISITE_MISSING: %',
      missing_prerequisite
      USING ERRCODE = '55000';
  END IF;
END;
$cohort_membership_preflight$;

-- Block concurrent room assignment while the invariant is repaired and the
-- partial unique index is installed.
LOCK TABLE public.cohort_rooms IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.cohort_members IN SHARE ROW EXCLUSIVE MODE;

WITH ranked_active_memberships AS (
  SELECT
    member.id,
    row_number() OVER (
      PARTITION BY member.user_id
      ORDER BY member.joined_at DESC NULLS LAST, member.id DESC
    ) AS recency_rank
  FROM public.cohort_members AS member
  WHERE member.is_active IS TRUE
)
UPDATE public.cohort_members AS member
SET is_active = FALSE
FROM ranked_active_memberships AS ranked
WHERE ranked.id = member.id
  AND ranked.recency_rank > 1
  AND member.is_active IS TRUE;

UPDATE public.cohort_rooms AS room
SET member_count = (
  SELECT count(*)::integer
  FROM public.cohort_members AS member
  WHERE member.room_id = room.id
    AND member.is_active IS TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS cohort_members_one_active_per_user_uidx
  ON public.cohort_members (user_id)
  WHERE is_active IS TRUE;

DO $cohort_membership_postcondition$
DECLARE
  duplicate_user uuid;
  inconsistent_room uuid;
BEGIN
  SELECT member.user_id
  INTO duplicate_user
  FROM public.cohort_members AS member
  WHERE member.is_active IS TRUE
  GROUP BY member.user_id
  HAVING count(*) > 1
  LIMIT 1;

  IF duplicate_user IS NOT NULL THEN
    RAISE EXCEPTION 'COHORT_ACTIVE_MEMBERSHIP_DUPLICATE_REMAINS: %',
      duplicate_user
      USING ERRCODE = '55000';
  END IF;

  SELECT room.id
  INTO inconsistent_room
  FROM public.cohort_rooms AS room
  WHERE room.member_count IS DISTINCT FROM (
    SELECT count(*)::integer
    FROM public.cohort_members AS member
    WHERE member.room_id = room.id
      AND member.is_active IS TRUE
  )
  LIMIT 1;

  IF inconsistent_room IS NOT NULL THEN
    RAISE EXCEPTION 'COHORT_ACTIVE_MEMBERSHIP_COUNT_MISMATCH: %',
      inconsistent_room
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_definition
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_definition.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = index_relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND index_relation.relname = 'cohort_members_one_active_per_user_uidx'
      AND index_definition.indisunique
      AND index_definition.indisvalid
      AND index_definition.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'COHORT_ACTIVE_MEMBERSHIP_UNIQUE_INDEX_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$cohort_membership_postcondition$;

COMMIT;
