-- Make cohort assignment and cohort/guestbook counters transactionally exact.
--
-- Cohort assignment used a denormalized counter without serialization, while
-- several server routes independently recreated the same multi-statement flow.
-- Auth/user and parent cascades could also leave all three message/member
-- counters stale. This migration installs one serialized assignment primitive,
-- enforces room capacity for every writer, and reconciles counters at commit.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $cohort_guestbook_preflight$
DECLARE
  missing_prerequisite text;
  missing_foreign_key text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role'
     ) THEN
    RAISE EXCEPTION 'COHORT_GUESTBOOK_REQUIRED_ROLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'COHORT_GUESTBOOK_AUTH_HELPER_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I.%I', prerequisite.table_name, prerequisite.column_name),
    ', ' ORDER BY prerequisite.table_name, prerequisite.column_name
  )
  INTO missing_prerequisite
  FROM (VALUES
    ('auth', 'users', 'id'),
    ('public', 'cohort_rooms', 'id'),
    ('public', 'cohort_rooms', 'year'),
    ('public', 'cohort_rooms', 'month'),
    ('public', 'cohort_rooms', 'room_number'),
    ('public', 'cohort_rooms', 'name'),
    ('public', 'cohort_rooms', 'member_count'),
    ('public', 'cohort_rooms', 'message_count'),
    ('public', 'cohort_rooms', 'is_active'),
    ('public', 'cohort_members', 'id'),
    ('public', 'cohort_members', 'room_id'),
    ('public', 'cohort_members', 'user_id'),
    ('public', 'cohort_members', 'joined_at'),
    ('public', 'cohort_members', 'is_active'),
    ('public', 'cohort_messages', 'id'),
    ('public', 'cohort_messages', 'room_id'),
    ('public', 'cohort_messages', 'author_id'),
    ('public', 'guestbooks', 'id'),
    ('public', 'guestbooks', 'owner_id'),
    ('public', 'guestbooks', 'message_count'),
    ('public', 'guestbook_messages', 'id'),
    ('public', 'guestbook_messages', 'guestbook_id'),
    ('public', 'community_profiles', 'user_id'),
    ('public', 'community_profiles', 'wedding_year'),
    ('public', 'community_profiles', 'wedding_month')
  ) AS prerequisite(table_schema, table_name, column_name)
  LEFT JOIN information_schema.columns AS existing
    ON existing.table_schema = prerequisite.table_schema
   AND existing.table_name = prerequisite.table_name
   AND existing.column_name = prerequisite.column_name
  WHERE existing.column_name IS NULL;

  IF missing_prerequisite IS NOT NULL THEN
    RAISE EXCEPTION 'COHORT_GUESTBOOK_PREREQUISITE_MISSING: %',
      missing_prerequisite
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.string_agg(
    pg_catalog.format(
      '%I.%I -> %I.%I',
      required_fk.source_table,
      required_fk.source_column,
      required_fk.target_table,
      required_fk.target_column
    ),
    ', ' ORDER BY required_fk.source_table, required_fk.source_column
  )
  INTO missing_foreign_key
  FROM (VALUES
    ('public', 'cohort_members', 'room_id', 'public', 'cohort_rooms', 'id'),
    ('public', 'cohort_members', 'user_id', 'auth', 'users', 'id'),
    ('public', 'cohort_messages', 'room_id', 'public', 'cohort_rooms', 'id'),
    ('public', 'cohort_messages', 'author_id', 'auth', 'users', 'id'),
    ('public', 'guestbooks', 'owner_id', 'auth', 'users', 'id'),
    ('public', 'guestbook_messages', 'guestbook_id', 'public', 'guestbooks', 'id')
  ) AS required_fk(
    source_schema,
    source_table,
    source_column,
    target_schema,
    target_table,
    target_column
  )
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS source_relation
      ON source_relation.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS source_namespace
      ON source_namespace.oid = source_relation.relnamespace
    JOIN pg_catalog.pg_class AS target_relation
      ON target_relation.oid = constraint_record.confrelid
    JOIN pg_catalog.pg_namespace AS target_namespace
      ON target_namespace.oid = target_relation.relnamespace
    JOIN pg_catalog.pg_attribute AS source_attribute
      ON source_attribute.attrelid = source_relation.oid
     AND constraint_record.conkey =
       ARRAY[source_attribute.attnum]::smallint[]
    JOIN pg_catalog.pg_attribute AS target_attribute
      ON target_attribute.attrelid = target_relation.oid
     AND constraint_record.confkey =
       ARRAY[target_attribute.attnum]::smallint[]
    WHERE constraint_record.contype = 'f'
      AND constraint_record.convalidated
      AND constraint_record.confdeltype = 'c'
      AND source_namespace.nspname = required_fk.source_schema
      AND source_relation.relname = required_fk.source_table
      AND source_attribute.attname = required_fk.source_column
      AND target_namespace.nspname = required_fk.target_schema
      AND target_relation.relname = required_fk.target_table
      AND target_attribute.attname = required_fk.target_column
  );

  IF missing_foreign_key IS NOT NULL THEN
    RAISE EXCEPTION 'COHORT_GUESTBOOK_CASCADE_FK_INVALID: %',
      missing_foreign_key
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_attribute AS room_column
      ON room_column.attrelid = constraint_record.conrelid
     AND room_column.attname = 'room_id'
    JOIN pg_catalog.pg_attribute AS user_column
      ON user_column.attrelid = constraint_record.conrelid
     AND user_column.attname = 'user_id'
    WHERE constraint_record.conrelid =
      'public.cohort_members'::pg_catalog.regclass
      AND constraint_record.contype = 'u'
      AND constraint_record.convalidated
      AND constraint_record.conkey @>
        ARRAY[room_column.attnum, user_column.attnum]::smallint[]
      AND pg_catalog.array_length(constraint_record.conkey, 1) = 2
  ) THEN
    RAISE EXCEPTION 'COHORT_MEMBERS_ROOM_USER_UNIQUE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_attribute AS year_column
      ON year_column.attrelid = constraint_record.conrelid
     AND year_column.attname = 'year'
    JOIN pg_catalog.pg_attribute AS month_column
      ON month_column.attrelid = constraint_record.conrelid
     AND month_column.attname = 'month'
    JOIN pg_catalog.pg_attribute AS room_number_column
      ON room_number_column.attrelid = constraint_record.conrelid
     AND room_number_column.attname = 'room_number'
    WHERE constraint_record.conrelid =
      'public.cohort_rooms'::pg_catalog.regclass
      AND constraint_record.contype = 'u'
      AND constraint_record.convalidated
      AND constraint_record.conkey @> ARRAY[
        year_column.attnum,
        month_column.attnum,
        room_number_column.attnum
      ]::smallint[]
      AND pg_catalog.array_length(constraint_record.conkey, 1) = 3
  ) THEN
    RAISE EXCEPTION 'COHORT_ROOMS_PERIOD_NUMBER_UNIQUE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS index_definition
    JOIN pg_catalog.pg_class AS index_relation
      ON index_relation.oid = index_definition.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = index_relation.relnamespace
    JOIN pg_catalog.pg_attribute AS user_column
      ON user_column.attrelid = index_definition.indrelid
     AND user_column.attname = 'user_id'
    WHERE namespace.nspname = 'public'
      AND index_relation.relname =
        'cohort_members_one_active_per_user_uidx'
      AND index_definition.indrelid =
        'public.cohort_members'::pg_catalog.regclass
      AND index_definition.indisunique
      AND index_definition.indisvalid
      AND index_definition.indisready
      AND index_definition.indnkeyatts = 1
      AND index_definition.indnatts = 1
      AND index_definition.indkey[0] = user_column.attnum
      AND pg_catalog.pg_get_expr(
        index_definition.indpred,
        index_definition.indrelid
      ) = '(is_active IS TRUE)'
  ) THEN
    RAISE EXCEPTION 'COHORT_MEMBERS_ACTIVE_USER_UNIQUE_MISSING'
      USING ERRCODE = '55000';
  END IF;
END;
$cohort_guestbook_preflight$;

-- Lock child tables before parents. Existing server flows historically wrote
-- membership first and rooms second, so this order avoids introducing a new
-- deployment/runtime deadlock cycle while the triggers and counters change.
LOCK TABLE
  public.cohort_members,
  public.cohort_messages,
  public.cohort_rooms,
  public.guestbook_messages,
  public.guestbooks
IN SHARE ROW EXCLUSIVE MODE;

DO $cohort_capacity_precondition$
DECLARE
  over_capacity_room uuid;
BEGIN
  SELECT room.id
  INTO over_capacity_room
  FROM public.cohort_rooms AS room
  WHERE room.is_active IS TRUE
    AND 30 < (
      SELECT pg_catalog.count(*)::integer
      FROM public.cohort_members AS member
      WHERE member.room_id = room.id
        AND member.is_active IS TRUE
    )
  ORDER BY room.id
  LIMIT 1;

  IF over_capacity_room IS NOT NULL THEN
    RAISE EXCEPTION 'COHORT_ROOM_OVER_CAPACITY_REQUIRES_REVIEW: %',
      over_capacity_room
      USING ERRCODE = '55000';
  END IF;
END;
$cohort_capacity_precondition$;

-- Keep cohort membership assignment server-owned even if an older deployment
-- accumulated column-level grants. Table-level REVOKE does not remove those
-- grants, so both privilege layers are closed explicitly.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.cohort_members
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES (
  id,
  room_id,
  user_id,
  joined_at,
  last_seen_at,
  is_active
) ON TABLE public.cohort_members
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cohort_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cohort_members
  TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_cohort_membership_client_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $prevent_cohort_membership_client_write$
DECLARE
  actor_role text := COALESCE(
    pg_catalog.current_setting('request.jwt.claim.role', TRUE),
    ''
  );
BEGIN
  IF actor_role IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'cohort membership is server-managed'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$prevent_cohort_membership_client_write$;

CREATE OR REPLACE FUNCTION public.cohort_membership_capacity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $cohort_membership_capacity_guard$
DECLARE
  target_room_is_active boolean;
  active_member_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Match account deletion's auth-user -> cohort relation lock order before
    -- the foreign-key check runs. This avoids a user-delete/room-lock cycle
    -- for trusted writers that insert membership outside the canonical RPC.
    PERFORM actor.id
    FROM auth.users AS actor
    WHERE actor.id = NEW.user_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'cohort_actor_not_found'
        USING ERRCODE = '23503';
    END IF;

    PERFORM room.id
    FROM public.cohort_rooms AS room
    WHERE room.id = NEW.room_id
    FOR UPDATE;

    SELECT room.is_active
    INTO target_room_is_active
    FROM public.cohort_rooms AS room
    WHERE room.id = NEW.room_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'cohort_room_not_found'
        USING ERRCODE = '23503';
    END IF;

    IF NEW.is_active IS TRUE THEN
      IF target_room_is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'cohort_room_inactive'
          USING ERRCODE = '55000';
      END IF;

      SELECT pg_catalog.count(*)::integer
      INTO active_member_count
      FROM public.cohort_members AS member
      WHERE member.room_id = NEW.room_id
        AND member.is_active IS TRUE;

      IF active_member_count >= 30 THEN
        RAISE EXCEPTION 'cohort_room_capacity_reached'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- Lock both possible parent rows in UUID order before a move/reactivation.
  PERFORM room.id
  FROM public.cohort_rooms AS room
  WHERE room.id = OLD.room_id OR room.id = NEW.room_id
  ORDER BY room.id
  FOR UPDATE;

  SELECT room.is_active
  INTO target_room_is_active
  FROM public.cohort_rooms AS room
  WHERE room.id = NEW.room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cohort_room_not_found'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.is_active IS TRUE
     AND (
       OLD.is_active IS NOT TRUE
       OR OLD.room_id IS DISTINCT FROM NEW.room_id
     ) THEN
    IF target_room_is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'cohort_room_inactive'
        USING ERRCODE = '55000';
    END IF;

    SELECT pg_catalog.count(*)::integer
    INTO active_member_count
    FROM public.cohort_members AS member
    WHERE member.room_id = NEW.room_id
      AND member.is_active IS TRUE
      AND member.id <> OLD.id;

    IF active_member_count >= 30 THEN
      RAISE EXCEPTION 'cohort_room_capacity_reached'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$cohort_membership_capacity_guard$;

CREATE OR REPLACE FUNCTION public.cohort_member_count_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $cohort_member_count_trigger$
DECLARE
  affected_room_id uuid;
  exact_member_count integer;
BEGIN
  FOR affected_room_id IN
    SELECT DISTINCT candidate.room_id
    FROM (
      VALUES
        (CASE WHEN TG_OP = 'INSERT' THEN NULL::uuid ELSE OLD.room_id END),
        (CASE WHEN TG_OP = 'DELETE' THEN NULL::uuid ELSE NEW.room_id END)
    ) AS candidate(room_id)
    WHERE candidate.room_id IS NOT NULL
    ORDER BY candidate.room_id
  LOOP
    -- Lock first, then count in a separate statement. Under READ COMMITTED a
    -- waiter receives a fresh snapshot after the prior counter writer commits,
    -- so concurrent inserts cannot overwrite a newer total with a stale one.
    PERFORM room.id
    FROM public.cohort_rooms AS room
    WHERE room.id = affected_room_id
    FOR UPDATE;

    IF FOUND THEN
      SELECT pg_catalog.count(*)::integer
      INTO exact_member_count
      FROM public.cohort_members AS member
      WHERE member.room_id = affected_room_id
        AND member.is_active IS TRUE;

      UPDATE public.cohort_rooms AS room
      SET member_count = exact_member_count
      WHERE room.id = affected_room_id;
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$cohort_member_count_trigger$;

CREATE OR REPLACE FUNCTION public.cohort_message_count_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $cohort_message_count_trigger$
DECLARE
  affected_room_id uuid;
  exact_message_count integer;
BEGIN
  FOR affected_room_id IN
    SELECT DISTINCT candidate.room_id
    FROM (
      VALUES
        (CASE WHEN TG_OP = 'INSERT' THEN NULL::uuid ELSE OLD.room_id END),
        (CASE WHEN TG_OP = 'DELETE' THEN NULL::uuid ELSE NEW.room_id END)
    ) AS candidate(room_id)
    WHERE candidate.room_id IS NOT NULL
    ORDER BY candidate.room_id
  LOOP
    PERFORM room.id
    FROM public.cohort_rooms AS room
    WHERE room.id = affected_room_id
    FOR UPDATE;

    IF FOUND THEN
      SELECT pg_catalog.count(*)::integer
      INTO exact_message_count
      FROM public.cohort_messages AS message
      WHERE message.room_id = affected_room_id;

      UPDATE public.cohort_rooms AS room
      SET message_count = exact_message_count
      WHERE room.id = affected_room_id;
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$cohort_message_count_trigger$;

CREATE OR REPLACE FUNCTION public.cohort_room_counter_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $cohort_room_counter_guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.member_count := 0;
    NEW.message_count := 0;
    RETURN NEW;
  END IF;

  -- Normalize every writer, including nested trigger updates, from the source
  -- rows. No trusted/manual path can persist an invented counter value.
  SELECT pg_catalog.count(*)::integer
  INTO NEW.member_count
  FROM public.cohort_members AS member
  WHERE member.room_id = OLD.id
    AND member.is_active IS TRUE;

  SELECT pg_catalog.count(*)::integer
  INTO NEW.message_count
  FROM public.cohort_messages AS message
  WHERE message.room_id = OLD.id;

  RETURN NEW;
END;
$cohort_room_counter_guard$;

CREATE OR REPLACE FUNCTION public.gb_message_count_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $gb_message_count_trigger$
DECLARE
  affected_guestbook_id uuid;
  exact_message_count integer;
BEGIN
  FOR affected_guestbook_id IN
    SELECT DISTINCT candidate.guestbook_id
    FROM (
      VALUES
        (CASE WHEN TG_OP = 'INSERT' THEN NULL::uuid ELSE OLD.guestbook_id END),
        (CASE WHEN TG_OP = 'DELETE' THEN NULL::uuid ELSE NEW.guestbook_id END)
    ) AS candidate(guestbook_id)
    WHERE candidate.guestbook_id IS NOT NULL
    ORDER BY candidate.guestbook_id
  LOOP
    PERFORM guestbook.id
    FROM public.guestbooks AS guestbook
    WHERE guestbook.id = affected_guestbook_id
    FOR UPDATE;

    IF FOUND THEN
      SELECT pg_catalog.count(*)::integer
      INTO exact_message_count
      FROM public.guestbook_messages AS message
      WHERE message.guestbook_id = affected_guestbook_id;

      UPDATE public.guestbooks AS guestbook
      SET message_count = exact_message_count
      WHERE guestbook.id = affected_guestbook_id;
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$gb_message_count_trigger$;

CREATE OR REPLACE FUNCTION public.guestbook_message_count_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $guestbook_message_count_guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.message_count := 0;
    RETURN NEW;
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO NEW.message_count
  FROM public.guestbook_messages AS message
  WHERE message.guestbook_id = OLD.id;

  RETURN NEW;
END;
$guestbook_message_count_guard$;

CREATE OR REPLACE FUNCTION public.community_assign_cohort(
  p_user_id uuid,
  p_year integer,
  p_month integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $community_assign_cohort$
DECLARE
  existing_membership_id uuid;
  existing_room_id uuid;
  existing_room_year integer;
  existing_room_month integer;
  existing_room_number integer;
  existing_room_is_active boolean;
  target_room_id uuid;
  target_room_number integer;
  target_room_name text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL
     OR p_year IS NULL
     OR p_year < 2020
     OR p_year > 2100
     OR p_month IS NULL
     OR p_month < 1
     OR p_month > 12 THEN
    RAISE EXCEPTION 'invalid cohort assignment input'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the actor before any cohort relation. Account deletion takes the
  -- auth row first, so matching that order prevents a delete/assignment cycle.
  PERFORM actor.id
  FROM auth.users AS actor
  WHERE actor.id = p_user_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cohort_actor_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- A table lock handles the empty-room case, where no row exists to lock.
  -- It also gives room-number allocation a deterministic, collision-free view.
  LOCK TABLE public.cohort_members IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.cohort_rooms IN SHARE ROW EXCLUSIVE MODE;

  SELECT
    member.id,
    room.id,
    room.year,
    room.month,
    room.room_number,
    room.is_active
  INTO
    existing_membership_id,
    existing_room_id,
    existing_room_year,
    existing_room_month,
    existing_room_number,
    existing_room_is_active
  FROM public.cohort_members AS member
  JOIN public.cohort_rooms AS room ON room.id = member.room_id
  WHERE member.user_id = p_user_id
    AND member.is_active IS TRUE
  ORDER BY member.joined_at DESC NULLS LAST, member.id DESC
  LIMIT 1
  FOR UPDATE OF member, room;

  IF FOUND
     AND existing_room_is_active IS TRUE
     AND existing_room_year = p_year
     AND existing_room_month = p_month THEN
    UPDATE public.cohort_rooms AS room
    SET name = CASE
          WHEN p_year = 2100 AND p_month = 10
            THEN '날짜 미정·1년 이후 동기방'
          ELSE pg_catalog.format(
            '%s년 %s분기 결혼 동기',
            p_year,
            (p_month + 2) / 3
          )
        END || CASE
          WHEN existing_room_number > 1
            THEN pg_catalog.format(' %s방', existing_room_number)
          ELSE ''
        END
    WHERE room.id = existing_room_id;
    RETURN existing_room_id;
  END IF;

  IF existing_membership_id IS NOT NULL THEN
    UPDATE public.cohort_members AS member
    SET is_active = FALSE
    WHERE member.id = existing_membership_id
      AND member.is_active IS TRUE;
  END IF;

  SELECT room.id, room.room_number
  INTO target_room_id, target_room_number
  FROM public.cohort_rooms AS room
  WHERE room.year = p_year
    AND room.month = p_month
    AND room.is_active IS TRUE
    AND (
      SELECT pg_catalog.count(*)::integer
      FROM public.cohort_members AS member
      WHERE member.room_id = room.id
        AND member.is_active IS TRUE
    ) < 30
  ORDER BY room.room_number DESC, room.id
  LIMIT 1
  FOR UPDATE OF room;

  IF target_room_id IS NULL THEN
    SELECT COALESCE(pg_catalog.max(room.room_number), 0) + 1
    INTO target_room_number
    FROM public.cohort_rooms AS room
    WHERE room.year = p_year
      AND room.month = p_month;

    target_room_name := CASE
      WHEN p_year = 2100 AND p_month = 10
        THEN '날짜 미정·1년 이후 동기방'
      ELSE pg_catalog.format(
        '%s년 %s분기 결혼 동기',
        p_year,
        (p_month + 2) / 3
      )
    END || CASE
      WHEN target_room_number > 1
        THEN pg_catalog.format(' %s방', target_room_number)
      ELSE ''
    END;

    INSERT INTO public.cohort_rooms (
      year,
      month,
      room_number,
      name,
      member_count,
      message_count,
      is_active
    )
    VALUES (
      p_year,
      p_month,
      target_room_number,
      target_room_name,
      0,
      0,
      TRUE
    )
    RETURNING id INTO target_room_id;
  ELSE
    target_room_name := CASE
      WHEN p_year = 2100 AND p_month = 10
        THEN '날짜 미정·1년 이후 동기방'
      ELSE pg_catalog.format(
        '%s년 %s분기 결혼 동기',
        p_year,
        (p_month + 2) / 3
      )
    END || CASE
      WHEN target_room_number > 1
        THEN pg_catalog.format(' %s방', target_room_number)
      ELSE ''
    END;

    UPDATE public.cohort_rooms AS room
    SET name = target_room_name
    WHERE room.id = target_room_id
      AND room.name IS DISTINCT FROM target_room_name;
  END IF;

  INSERT INTO public.cohort_members (room_id, user_id, is_active)
  VALUES (target_room_id, p_user_id, TRUE)
  ON CONFLICT (room_id, user_id) DO UPDATE
  SET is_active = TRUE;

  UPDATE public.community_profiles AS profile
  SET wedding_year = p_year,
      wedding_month = p_month
  WHERE profile.user_id = p_user_id;

  RETURN target_room_id;
END;
$community_assign_cohort$;

ALTER FUNCTION public.prevent_cohort_membership_client_write()
  OWNER TO postgres;
ALTER FUNCTION public.cohort_membership_capacity_guard() OWNER TO postgres;
ALTER FUNCTION public.cohort_member_count_trigger() OWNER TO postgres;
ALTER FUNCTION public.cohort_message_count_trigger() OWNER TO postgres;
ALTER FUNCTION public.cohort_room_counter_guard() OWNER TO postgres;
ALTER FUNCTION public.gb_message_count_trigger() OWNER TO postgres;
ALTER FUNCTION public.guestbook_message_count_guard() OWNER TO postgres;
ALTER FUNCTION public.community_assign_cohort(uuid, integer, integer)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prevent_cohort_membership_client_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cohort_membership_capacity_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cohort_member_count_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cohort_message_count_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cohort_room_counter_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gb_message_count_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guestbook_message_count_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_assign_cohort(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_assign_cohort(uuid, integer, integer)
  TO service_role;

DROP TRIGGER IF EXISTS trg_prevent_cohort_membership_client_write
  ON public.cohort_members;
CREATE TRIGGER trg_prevent_cohort_membership_client_write
BEFORE INSERT OR UPDATE OR DELETE ON public.cohort_members
FOR EACH ROW EXECUTE FUNCTION public.prevent_cohort_membership_client_write();

DROP TRIGGER IF EXISTS trg_cohort_membership_capacity_guard
  ON public.cohort_members;
CREATE TRIGGER trg_cohort_membership_capacity_guard
BEFORE INSERT OR UPDATE OF room_id, is_active ON public.cohort_members
FOR EACH ROW EXECUTE FUNCTION public.cohort_membership_capacity_guard();

DROP TRIGGER IF EXISTS trg_cohort_member_count
  ON public.cohort_members;
CREATE CONSTRAINT TRIGGER trg_cohort_member_count
AFTER INSERT OR UPDATE OR DELETE ON public.cohort_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.cohort_member_count_trigger();

DROP TRIGGER IF EXISTS trg_cohort_msg_count
  ON public.cohort_messages;
CREATE CONSTRAINT TRIGGER trg_cohort_msg_count
AFTER INSERT OR UPDATE OR DELETE ON public.cohort_messages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.cohort_message_count_trigger();

DROP TRIGGER IF EXISTS trg_cohort_room_counter_insert_guard
  ON public.cohort_rooms;
CREATE TRIGGER trg_cohort_room_counter_insert_guard
BEFORE INSERT ON public.cohort_rooms
FOR EACH ROW EXECUTE FUNCTION public.cohort_room_counter_guard();

DROP TRIGGER IF EXISTS trg_cohort_room_counter_update_guard
  ON public.cohort_rooms;
CREATE TRIGGER trg_cohort_room_counter_update_guard
BEFORE UPDATE OF member_count, message_count ON public.cohort_rooms
FOR EACH ROW EXECUTE FUNCTION public.cohort_room_counter_guard();

DROP TRIGGER IF EXISTS trg_gb_msg_count
  ON public.guestbook_messages;
CREATE CONSTRAINT TRIGGER trg_gb_msg_count
AFTER INSERT OR UPDATE OR DELETE ON public.guestbook_messages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.gb_message_count_trigger();

DROP TRIGGER IF EXISTS trg_guestbook_message_count_insert_guard
  ON public.guestbooks;
CREATE TRIGGER trg_guestbook_message_count_insert_guard
BEFORE INSERT ON public.guestbooks
FOR EACH ROW EXECUTE FUNCTION public.guestbook_message_count_guard();

DROP TRIGGER IF EXISTS trg_guestbook_message_count_update_guard
  ON public.guestbooks;
CREATE TRIGGER trg_guestbook_message_count_update_guard
BEFORE UPDATE OF message_count ON public.guestbooks
FOR EACH ROW EXECUTE FUNCTION public.guestbook_message_count_guard();

-- Reconcile historical drift under the write locks above. The room guards
-- deliberately normalize these top-level writes from the authoritative rows.
UPDATE public.cohort_rooms AS room
SET member_count = room.member_count,
    message_count = room.message_count;

UPDATE public.guestbooks AS guestbook
SET message_count = guestbook.message_count;

DO $cohort_guestbook_postcondition$
DECLARE
  function_signature text;
  function_owner text;
  function_is_security_definer boolean;
  function_config text[];
  unexpected_grantee text;
  trigger_spec record;
  trigger_count integer;
  trigger_is_deferrable boolean;
  trigger_is_initially_deferred boolean;
  over_capacity_room uuid;
BEGIN
  IF pg_catalog.has_function_privilege(
       'anon',
       'public.community_assign_cohort(uuid, integer, integer)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.community_assign_cohort(uuid, integer, integer)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role',
       'public.community_assign_cohort(uuid, integer, integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'COMMUNITY_ASSIGN_COHORT_GRANT_INVALID'
      USING ERRCODE = '55000';
  END IF;

  -- The client-side membership write fence from 20260615090000 must remain
  -- closed. Mobile still contains a stale best-effort upsert path.
  IF pg_catalog.has_table_privilege(
       'anon', 'public.cohort_members',
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     OR pg_catalog.has_any_column_privilege(
       'anon', 'public.cohort_members', 'INSERT'
     )
     OR pg_catalog.has_any_column_privilege(
       'anon', 'public.cohort_members', 'UPDATE'
     )
     OR pg_catalog.has_any_column_privilege(
       'anon', 'public.cohort_members', 'REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.cohort_members',
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     OR pg_catalog.has_any_column_privilege(
       'authenticated', 'public.cohort_members', 'INSERT'
     )
     OR pg_catalog.has_any_column_privilege(
       'authenticated', 'public.cohort_members', 'UPDATE'
     )
     OR pg_catalog.has_any_column_privilege(
       'authenticated', 'public.cohort_members', 'REFERENCES'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.cohort_members', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.cohort_members', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.cohort_members', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.cohort_members', 'DELETE'
     ) THEN
    RAISE EXCEPTION 'COHORT_MEMBERSHIP_CLIENT_WRITE_FENCE_INVALID'
      USING ERRCODE = '55000';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.community_assign_cohort(uuid, integer, integer)',
    'public.prevent_cohort_membership_client_write()',
    'public.cohort_membership_capacity_guard()',
    'public.cohort_member_count_trigger()',
    'public.cohort_message_count_trigger()',
    'public.cohort_room_counter_guard()',
    'public.gb_message_count_trigger()',
    'public.guestbook_message_count_guard()'
  ]::text[]
  LOOP
    SELECT
      pg_catalog.pg_get_userbyid(proc.proowner),
      proc.prosecdef,
      proc.proconfig
    INTO
      function_owner,
      function_is_security_definer,
      function_config
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = pg_catalog.to_regprocedure(function_signature);

    IF function_owner IS DISTINCT FROM 'postgres'
       OR function_is_security_definer IS NOT TRUE
       OR function_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
      RAISE EXCEPTION 'COHORT_GUESTBOOK_FUNCTION_AUTHORITY_INVALID: %',
        function_signature
        USING ERRCODE = '55000';
    END IF;

    SELECT pg_catalog.string_agg(
      COALESCE(grantee.rolname, 'PUBLIC'),
      ', ' ORDER BY COALESCE(grantee.rolname, 'PUBLIC')
    )
    INTO unexpected_grantee
    FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
    ) AS privilege
    LEFT JOIN pg_catalog.pg_roles AS grantee
      ON grantee.oid = privilege.grantee
    WHERE proc.oid = pg_catalog.to_regprocedure(function_signature)
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee <> proc.proowner
      AND NOT (
        function_signature =
          'public.community_assign_cohort(uuid, integer, integer)'
        AND grantee.rolname = 'service_role'
      );

    IF unexpected_grantee IS NOT NULL THEN
      RAISE EXCEPTION 'COHORT_GUESTBOOK_FUNCTION_GRANT_INVALID: % -> %',
        function_signature,
        unexpected_grantee
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.prevent_cohort_membership_client_write()',
    'public.cohort_membership_capacity_guard()',
    'public.cohort_member_count_trigger()',
    'public.cohort_message_count_trigger()',
    'public.cohort_room_counter_guard()',
    'public.gb_message_count_trigger()',
    'public.guestbook_message_count_guard()'
  ]::text[]
  LOOP
    IF pg_catalog.has_function_privilege(
         'anon', function_signature, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'authenticated', function_signature, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege(
         'service_role', function_signature, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'COHORT_GUESTBOOK_TRIGGER_FUNCTION_GRANT_INVALID: %',
        function_signature
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  FOR trigger_spec IN
    SELECT *
    FROM (VALUES
      (
        'trg_prevent_cohort_membership_client_write',
        'public.cohort_members',
        'public.prevent_cohort_membership_client_write()',
        FALSE,
        FALSE
      ),
      (
        'trg_cohort_membership_capacity_guard',
        'public.cohort_members',
        'public.cohort_membership_capacity_guard()',
        FALSE,
        FALSE
      ),
      (
        'trg_cohort_member_count',
        'public.cohort_members',
        'public.cohort_member_count_trigger()',
        TRUE,
        TRUE
      ),
      (
        'trg_cohort_msg_count',
        'public.cohort_messages',
        'public.cohort_message_count_trigger()',
        TRUE,
        TRUE
      ),
      (
        'trg_cohort_room_counter_insert_guard',
        'public.cohort_rooms',
        'public.cohort_room_counter_guard()',
        FALSE,
        FALSE
      ),
      (
        'trg_cohort_room_counter_update_guard',
        'public.cohort_rooms',
        'public.cohort_room_counter_guard()',
        FALSE,
        FALSE
      ),
      (
        'trg_gb_msg_count',
        'public.guestbook_messages',
        'public.gb_message_count_trigger()',
        TRUE,
        TRUE
      ),
      (
        'trg_guestbook_message_count_insert_guard',
        'public.guestbooks',
        'public.guestbook_message_count_guard()',
        FALSE,
        FALSE
      ),
      (
        'trg_guestbook_message_count_update_guard',
        'public.guestbooks',
        'public.guestbook_message_count_guard()',
        FALSE,
        FALSE
      )
    ) AS expected_trigger(
      trigger_name,
      relation_signature,
      function_signature,
      is_deferrable,
      is_initially_deferred
    )
  LOOP
    SELECT
      pg_catalog.count(*)::integer,
      pg_catalog.bool_and(trigger.tgdeferrable),
      pg_catalog.bool_and(trigger.tginitdeferred)
    INTO
      trigger_count,
      trigger_is_deferrable,
      trigger_is_initially_deferred
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgname = trigger_spec.trigger_name
      AND trigger.tgrelid = pg_catalog.to_regclass(
        trigger_spec.relation_signature
      )
      AND trigger.tgfoid = pg_catalog.to_regprocedure(
        trigger_spec.function_signature
      )
      AND trigger.tgisinternal IS FALSE
      AND trigger.tgenabled <> 'D';

    IF trigger_count <> 1
       OR trigger_is_deferrable IS DISTINCT FROM trigger_spec.is_deferrable
       OR trigger_is_initially_deferred IS DISTINCT FROM
         trigger_spec.is_initially_deferred THEN
      RAISE EXCEPTION 'COHORT_GUESTBOOK_TRIGGER_INVALID: %',
        trigger_spec.trigger_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.cohort_rooms AS room
    WHERE room.member_count IS DISTINCT FROM (
      SELECT pg_catalog.count(*)::integer
      FROM public.cohort_members AS member
      WHERE member.room_id = room.id
        AND member.is_active IS TRUE
    )
       OR room.message_count IS DISTINCT FROM (
      SELECT pg_catalog.count(*)::integer
      FROM public.cohort_messages AS message
      WHERE message.room_id = room.id
    )
  ) THEN
    RAISE EXCEPTION 'COHORT_ROOM_COUNTER_BACKFILL_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.guestbooks AS guestbook
    WHERE guestbook.message_count IS DISTINCT FROM (
      SELECT pg_catalog.count(*)::integer
      FROM public.guestbook_messages AS message
      WHERE message.guestbook_id = guestbook.id
    )
  ) THEN
    RAISE EXCEPTION 'GUESTBOOK_MESSAGE_COUNTER_BACKFILL_INVALID'
      USING ERRCODE = '55000';
  END IF;

  SELECT room.id
  INTO over_capacity_room
  FROM public.cohort_rooms AS room
  WHERE room.is_active IS TRUE
    AND room.member_count > 30
  ORDER BY room.id
  LIMIT 1;

  IF over_capacity_room IS NOT NULL THEN
    RAISE EXCEPTION 'COHORT_ROOM_CAPACITY_POSTCONDITION_INVALID: %',
      over_capacity_room
      USING ERRCODE = '55000';
  END IF;
END;
$cohort_guestbook_postcondition$;

COMMENT ON FUNCTION public.community_assign_cohort(uuid, integer, integer) IS
  'Service-only, actor-validated, serialized cohort assignment with a 30-member capacity invariant.';
COMMENT ON FUNCTION public.cohort_member_count_trigger() IS
  'Reconciles exact active cohort member counts at commit, including auth and room cascades.';
COMMENT ON FUNCTION public.cohort_message_count_trigger() IS
  'Reconciles exact physical cohort message counts at commit, including auth and room cascades.';
COMMENT ON FUNCTION public.gb_message_count_trigger() IS
  'Reconciles exact physical guestbook message counts at commit, including guestbook cascades.';

COMMIT;
