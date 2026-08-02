-- Close the remaining direct database surfaces that bypass current server
-- validation. Public marketplace reads remain column-projected, while every
-- mutation is server-owned. Core profile/couple/journey/decision mutations are
-- server-owned as well. Raw analytics, dormant fitting data, and the retired
-- contract/payment layer are service-only because no current web or mobile
-- client consumes those base tables directly.
--
-- RLS does not protect TRUNCATE, REFERENCES, or TRIGGER. Remove those powers
-- from untrusted API roles on every current and future public table. The
-- service role is intentionally excluded from the global rule because trusted
-- operational tables require separate, reviewed ACLs; it loses these powers
-- on every application table fenced explicitly below. The production release
-- lease already has no service-role table privileges and is never re-granted.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $residual_privilege_preflight$
DECLARE
  missing_role text;
  missing_table text;
BEGIN
  SELECT required.role_name
  INTO missing_role
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']::text[])
    AS required(role_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS actual
    WHERE actual.rolname = required.role_name
  )
  ORDER BY required.role_name
  LIMIT 1;

  IF missing_role IS NOT NULL THEN
    RAISE EXCEPTION 'RESIDUAL_PRIVILEGE_ROLE_MISSING: %', missing_role
      USING ERRCODE = '55000';
  END IF;

  SELECT required.table_name
  INTO missing_table
  FROM unnest(ARRAY[
    'vendor_products',
    'vendor_images',
    'vendor_timeslots',
    'product_timeslots',
    'vendor_staff',
    'staff_timeslots',
    'customer_events',
    'search_logs',
    'vendor_daily_stats',
    'profiles',
    'couples',
    'wedding_journeys',
    'decision_nodes',
    'cohort_timeline_events',
    'decision_edges',
    'congratulatory_money',
    'amora_saved_notes'
  ]::text[]) AS required(table_name)
  WHERE pg_catalog.to_regclass(
    pg_catalog.format('public.%I', required.table_name)
  ) IS NULL
  ORDER BY required.table_name
  LIMIT 1;

  IF missing_table IS NOT NULL THEN
    RAISE EXCEPTION 'RESIDUAL_PRIVILEGE_TABLE_MISSING: %', missing_table
      USING ERRCODE = '55000';
  END IF;
END;
$residual_privilege_preflight$;

-- Supabase's historical table defaults can include privileges that RLS never
-- evaluates. Remove them from every current public base/partitioned table and
-- from tables created by later postgres-owned migrations.
DO $remove_untrusted_non_dml_table_privileges$
DECLARE
  target_relation record;
BEGIN
  FOR target_relation IN
    SELECT pg_catalog.format('%I.%I', namespace.nspname, relation.relname)
      AS qualified_name
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
    ORDER BY relation.relname
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE %s FROM PUBLIC, anon, authenticated',
      target_relation.qualified_name
    );
  END LOOP;
END;
$remove_untrusted_non_dml_table_privileges$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES
  FROM PUBLIC, anon, authenticated;

-- PostgreSQL grants EXECUTE on newly created functions to PUBLIC by default.
-- Every tracked Supabase RPC callsite has been cross-checked against an
-- explicit role grant. Remove only the inherited PUBLIC path: direct grants to
-- anon/authenticated/service_role remain intact, including the two vendor RLS
-- helpers that public marketplace SELECT policies execute as anon.
DO $remove_implicit_public_definer_execute$
DECLARE
  routine record;
BEGIN
  FOR routine IN
    SELECT
      CASE procedure.prokind
        WHEN 'p' THEN 'PROCEDURE'
        ELSE 'FUNCTION'
      END AS object_kind,
      pg_catalog.format(
        '%I.%I(%s)',
        namespace.nspname,
        procedure.proname,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      ) AS signature
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prosecdef
      AND procedure.prokind IN ('f', 'p')
    ORDER BY procedure.oid
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE EXECUTE ON %s %s FROM PUBLIC',
      routine.object_kind,
      routine.signature
    );
  END LOOP;
END;
$remove_implicit_public_definer_execute$;

-- Function PUBLIC EXECUTE is a global default. PostgreSQL explicitly documents
-- that a schema-scoped REVOKE cannot subtract it, so this statement must not
-- carry IN SCHEMA public.
ALTER DEFAULT PRIVILEGES
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Reassert the exact ACLs at the highest-risk client/service boundaries. The
-- remaining application RPCs already rebuild their exact ACL in their owning
-- migrations; the PUBLIC-only loop above cannot remove those explicit grants.
DO $reassert_critical_definer_acls$
DECLARE
  acl_contract record;
  target_role text;
BEGIN
  FOR acl_contract IN
    SELECT required.signature, required.intended_roles
    FROM (VALUES
      ('public.is_vendor_owner(uuid)',
       ARRAY['anon', 'authenticated']::text[]),
      ('public.is_vendor_public(uuid)',
       ARRAY['anon', 'authenticated']::text[]),
      ('public.is_couple_member(uuid)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.is_cohort_member(uuid)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.can_read_profile(uuid)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.can_access_couple_visibility(uuid,text)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.is_current_couple_path_member(text)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.is_my_couple(uuid)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.is_approved_vendor_owner(uuid)',
       ARRAY['authenticated']::text[]),
      ('public.account_deletion_storage_writes_allowed()',
       ARRAY['authenticated']::text[]),
      ('public.production_storage_writes_allowed()',
       ARRAY['authenticated']::text[]),
      ('public.create_couple_for_current_user(text)',
       ARRAY['authenticated']::text[]),
      ('public.join_couple(text,text)',
       ARRAY['authenticated']::text[]),
      ('public.reset_current_couple_membership()',
       ARRAY['authenticated']::text[]),
      ('public.resolve_shared_chat_clear_request(uuid,text)',
       ARRAY['authenticated']::text[]),
      ('public.set_my_mobile_push_preferences(boolean,boolean,boolean)',
       ARRAY['authenticated']::text[]),
      ('public.attach_my_mobile_push_token(text)',
       ARRAY['authenticated']::text[]),
      ('public.detach_my_mobile_push_token()',
       ARRAY['authenticated']::text[]),
      ('public.community_vote_post(uuid,uuid,smallint)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.community_vote_comment(uuid,uuid,smallint)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.community_toggle_bookmark(uuid,uuid)',
       ARRAY['service_role']::text[]),
      ('public.community_cast_poll_vote(uuid,uuid,uuid)',
       ARRAY['service_role']::text[]),
      ('public.community_assign_cohort(uuid,integer,integer)',
       ARRAY['service_role']::text[]),
      ('public.generate_invite_code()',
       ARRAY['service_role']::text[]),
      ('public.check_rate_limit_cost(text,integer,integer,integer)',
       ARRAY['service_role']::text[]),
      ('public.apply_journey_progress_patch(uuid,jsonb,text[])',
       ARRAY['service_role']::text[]),
      ('public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)',
       ARRAY['service_role']::text[]),
      ('public.reserve_amora_turn(uuid,integer,integer,bigint,bigint)',
       ARRAY['service_role']::text[]),
      ('public.reserve_amora_turn(uuid,integer,integer)',
       ARRAY['service_role']::text[]),
      ('public.reserve_amora_provider_call(uuid,uuid,text,uuid,integer,integer,bigint,bigint)',
       ARRAY['service_role']::text[]),
      ('public.create_booking_atomic(uuid,uuid,date,text,uuid,uuid,text,text,text,text,numeric,text)',
       ARRAY['service_role']::text[]),
      ('public.begin_account_deletion_job(uuid,text)',
       ARRAY['service_role']::text[]),
      ('public.send_vendor_message_service_v1(uuid,uuid,uuid,text)',
       ARRAY['service_role']::text[]),
      ('public.mark_vendor_messages_read_service_v1(uuid,uuid,uuid)',
       ARRAY['service_role']::text[]),
      ('public.bootstrap_initial_admin_profile(uuid,text,text)',
       ARRAY['service_role']::text[])
    ) AS required(signature, intended_roles)
  LOOP
    -- Hosted schemas can legitimately omit dormant modules. A present critical
    -- function, however, receives an exact named-role ACL every time.
    IF pg_catalog.to_regprocedure(acl_contract.signature) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      acl_contract.signature
    );
    FOREACH target_role IN ARRAY acl_contract.intended_roles
    LOOP
      EXECUTE pg_catalog.format(
        'GRANT EXECUTE ON FUNCTION %s TO %I',
        acl_contract.signature,
        target_role
      );
    END LOOP;
  END LOOP;
END;
$reassert_critical_definer_acls$;

DO $definer_acl_postflight$
DECLARE
  acl_contract record;
  target_role text;
  leaked_function text;
BEGIN
  SELECT pg_catalog.format(
           '%I.%I(%s)',
           namespace.nspname,
           procedure.proname,
           pg_catalog.pg_get_function_identity_arguments(procedure.oid)
         )
  INTO leaked_function
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      procedure.proacl,
      pg_catalog.acldefault('f', procedure.proowner)
    )
  ) AS privilege
  WHERE namespace.nspname = 'public'
    AND procedure.prosecdef
    AND privilege.grantee = 0
    AND privilege.privilege_type = 'EXECUTE'
  ORDER BY procedure.oid
  LIMIT 1;

  IF leaked_function IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY_DEFINER_PUBLIC_EXECUTE_REMAINS: %',
      leaked_function
      USING ERRCODE = '55000';
  END IF;

  FOR acl_contract IN
    SELECT required.signature, required.intended_roles
    FROM (VALUES
      ('public.is_vendor_owner(uuid)',
       ARRAY['anon', 'authenticated']::text[]),
      ('public.is_vendor_public(uuid)',
       ARRAY['anon', 'authenticated']::text[]),
      ('public.is_couple_member(uuid)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.is_cohort_member(uuid)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.can_read_profile(uuid)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.can_access_couple_visibility(uuid,text)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.is_current_couple_path_member(text)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.is_my_couple(uuid)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.is_approved_vendor_owner(uuid)',
       ARRAY['authenticated']::text[]),
      ('public.account_deletion_storage_writes_allowed()',
       ARRAY['authenticated']::text[]),
      ('public.production_storage_writes_allowed()',
       ARRAY['authenticated']::text[]),
      ('public.create_couple_for_current_user(text)',
       ARRAY['authenticated']::text[]),
      ('public.join_couple(text,text)',
       ARRAY['authenticated']::text[]),
      ('public.reset_current_couple_membership()',
       ARRAY['authenticated']::text[]),
      ('public.resolve_shared_chat_clear_request(uuid,text)',
       ARRAY['authenticated']::text[]),
      ('public.set_my_mobile_push_preferences(boolean,boolean,boolean)',
       ARRAY['authenticated']::text[]),
      ('public.attach_my_mobile_push_token(text)',
       ARRAY['authenticated']::text[]),
      ('public.detach_my_mobile_push_token()',
       ARRAY['authenticated']::text[]),
      ('public.community_vote_post(uuid,uuid,smallint)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.community_vote_comment(uuid,uuid,smallint)',
       ARRAY['authenticated', 'service_role']::text[]),
      ('public.community_toggle_bookmark(uuid,uuid)',
       ARRAY['service_role']::text[]),
      ('public.community_cast_poll_vote(uuid,uuid,uuid)',
       ARRAY['service_role']::text[]),
      ('public.community_assign_cohort(uuid,integer,integer)',
       ARRAY['service_role']::text[]),
      ('public.generate_invite_code()',
       ARRAY['service_role']::text[]),
      ('public.check_rate_limit_cost(text,integer,integer,integer)',
       ARRAY['service_role']::text[]),
      ('public.apply_journey_progress_patch(uuid,jsonb,text[])',
       ARRAY['service_role']::text[]),
      ('public.apply_amora_atomic_tool_execution(uuid,text,text,integer,text,jsonb,jsonb,jsonb)',
       ARRAY['service_role']::text[]),
      ('public.reserve_amora_turn(uuid,integer,integer,bigint,bigint)',
       ARRAY['service_role']::text[]),
      ('public.reserve_amora_turn(uuid,integer,integer)',
       ARRAY['service_role']::text[]),
      ('public.reserve_amora_provider_call(uuid,uuid,text,uuid,integer,integer,bigint,bigint)',
       ARRAY['service_role']::text[]),
      ('public.create_booking_atomic(uuid,uuid,date,text,uuid,uuid,text,text,text,text,numeric,text)',
       ARRAY['service_role']::text[]),
      ('public.begin_account_deletion_job(uuid,text)',
       ARRAY['service_role']::text[]),
      ('public.send_vendor_message_service_v1(uuid,uuid,uuid,text)',
       ARRAY['service_role']::text[]),
      ('public.mark_vendor_messages_read_service_v1(uuid,uuid,uuid)',
       ARRAY['service_role']::text[]),
      ('public.bootstrap_initial_admin_profile(uuid,text,text)',
       ARRAY['service_role']::text[])
    ) AS required(signature, intended_roles)
  LOOP
    IF pg_catalog.to_regprocedure(acl_contract.signature) IS NULL THEN
      CONTINUE;
    END IF;

    FOREACH target_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role'
    ]::text[]
    LOOP
      IF pg_catalog.has_function_privilege(
           target_role,
           acl_contract.signature,
           'EXECUTE'
         ) IS DISTINCT FROM (target_role = ANY(acl_contract.intended_roles))
      THEN
        RAISE EXCEPTION 'CRITICAL_DEFINER_ACL_INVALID: % -> %',
          acl_contract.signature,
          target_role
          USING ERRCODE = '55000';
      END IF;
    END LOOP;
  END LOOP;
END;
$definer_acl_postflight$;

-- The current product has no vendor self-service portal. Direct vendor-owner
-- writes could therefore bypass moderation, price validation, and availability
-- invariants. Keep the explicit public SELECT projections established by
-- 20260802141000, but make every write server-owned.
DO $close_marketplace_child_mutations$
DECLARE
  target_table text;
  policy_row record;
  all_columns text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'vendor_products',
    'vendor_images',
    'vendor_timeslots',
    'product_timeslots',
    'vendor_staff',
    'staff_timeslots'
  ]::text[]
  LOOP
    FOR policy_row IN
      SELECT policyname
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    LOOP
      EXECUTE pg_catalog.format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        policy_row.policyname,
        target_table
      );
    END LOOP;

    SELECT pg_catalog.string_agg(
      pg_catalog.format('%I', column_name),
      ', ' ORDER BY ordinal_position
    )
    INTO all_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = target_table;

    IF all_columns IS NULL THEN
      RAISE EXCEPTION 'MARKETPLACE_MUTATION_COLUMNS_MISSING: %', target_table
        USING ERRCODE = '55000';
    END IF;

    EXECUTE pg_catalog.format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      target_table
    );
    EXECUTE pg_catalog.format(
      'REVOKE INSERT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      all_columns,
      target_table
    );
    EXECUTE pg_catalog.format(
      'REVOKE UPDATE (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      all_columns,
      target_table
    );
    EXECUTE pg_catalog.format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      target_table
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      target_table || '_service_role_all',
      target_table
    );
  END LOOP;
END;
$close_marketplace_child_mutations$;

-- Decision edges are generated by the server-owned decision recorder. The old
-- couple-wide FOR ALL policy let a client forge the AI decision graph and even
-- point an edge at another couple's node. Preserve couple-scoped reads, make
-- writes service-only, and enforce the node/couple invariant for every writer
-- (including SECURITY DEFINER RPCs and service-role table writes).
DO $decision_edge_existing_boundary_preflight$
DECLARE
  invalid_edge uuid;
BEGIN
  SELECT edge.id
  INTO invalid_edge
  FROM public.decision_edges AS edge
  LEFT JOIN public.decision_nodes AS from_node
    ON from_node.id = edge.from_node_id
  LEFT JOIN public.decision_nodes AS to_node
    ON to_node.id = edge.to_node_id
  WHERE edge.couple_id IS NULL
     OR edge.from_node_id IS NULL
     OR edge.to_node_id IS NULL
     OR from_node.id IS NULL
     OR to_node.id IS NULL
     OR edge.couple_id IS DISTINCT FROM from_node.couple_id
     OR edge.couple_id IS DISTINCT FROM to_node.couple_id
  ORDER BY edge.id
  LIMIT 1;

  IF invalid_edge IS NOT NULL THEN
    RAISE EXCEPTION 'DECISION_EDGE_BOUNDARY_REQUIRES_REVIEW: %', invalid_edge
      USING ERRCODE = '55000';
  END IF;
END;
$decision_edge_existing_boundary_preflight$;

CREATE OR REPLACE FUNCTION public.enforce_decision_edge_couple_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $enforce_decision_edge_couple_boundary$
DECLARE
  from_couple_id uuid;
  to_couple_id uuid;
BEGIN
  IF NEW.couple_id IS NULL
     OR NEW.from_node_id IS NULL
     OR NEW.to_node_id IS NULL THEN
    RAISE EXCEPTION 'decision edge endpoints and couple are required'
      USING ERRCODE = '23502';
  END IF;

  SELECT node.couple_id
  INTO from_couple_id
  FROM public.decision_nodes AS node
  WHERE node.id = NEW.from_node_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'decision edge source node does not exist'
      USING ERRCODE = '23503';
  END IF;

  SELECT node.couple_id
  INTO to_couple_id
  FROM public.decision_nodes AS node
  WHERE node.id = NEW.to_node_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'decision edge target node does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.couple_id IS DISTINCT FROM from_couple_id
     OR NEW.couple_id IS DISTINCT FROM to_couple_id THEN
    RAISE EXCEPTION 'decision edge nodes must belong to the edge couple'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$enforce_decision_edge_couple_boundary$;

ALTER FUNCTION public.enforce_decision_edge_couple_boundary()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_decision_edge_couple_boundary()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS decision_edges_couple_boundary
  ON public.decision_edges;
CREATE TRIGGER decision_edges_couple_boundary
BEFORE INSERT OR UPDATE OF couple_id, from_node_id, to_node_id
ON public.decision_edges
FOR EACH ROW EXECUTE FUNCTION public.enforce_decision_edge_couple_boundary();

-- An edge-only trigger is insufficient if a later service update can move one
-- of its nodes to another couple. Couple ownership is part of a decision node's
-- identity, so make it immutable for every writer.
CREATE OR REPLACE FUNCTION public.prevent_decision_node_couple_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $prevent_decision_node_couple_reassignment$
BEGIN
  IF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    RAISE EXCEPTION 'decision node couple is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$prevent_decision_node_couple_reassignment$;

ALTER FUNCTION public.prevent_decision_node_couple_reassignment()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_decision_node_couple_reassignment()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS decision_nodes_couple_immutable
  ON public.decision_nodes;
CREATE TRIGGER decision_nodes_couple_immutable
BEFORE UPDATE OF couple_id
ON public.decision_nodes
FOR EACH ROW EXECUTE FUNCTION public.prevent_decision_node_couple_reassignment();

DO $close_decision_edge_client_mutations$
DECLARE
  policy_row record;
  all_columns text;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'decision_edges'
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.decision_edges',
      policy_row.policyname
    );
  END LOOP;

  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I', column_name),
    ', ' ORDER BY ordinal_position
  )
  INTO all_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'decision_edges';

  REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.decision_edges
    FROM PUBLIC, anon, authenticated, service_role;
  EXECUTE pg_catalog.format(
    'REVOKE SELECT (%s) ON TABLE public.decision_edges FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );
  EXECUTE pg_catalog.format(
    'REVOKE INSERT (%s) ON TABLE public.decision_edges FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );
  EXECUTE pg_catalog.format(
    'REVOKE UPDATE (%s) ON TABLE public.decision_edges FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );

  GRANT SELECT ON TABLE public.decision_edges TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.decision_edges
    TO service_role;
END;
$close_decision_edge_client_mutations$;

DROP POLICY IF EXISTS decision_edges_select_couple
  ON public.decision_edges;
CREATE POLICY decision_edges_select_couple
  ON public.decision_edges
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));

CREATE POLICY decision_edges_service_role_all
  ON public.decision_edges
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Congratulatory money is an active shared financial ledger. The server API
-- bounds amount/text/date values and checks current couple ownership, so retain
-- authenticated reads while forcing all mutations through that API.
DO $close_congratulatory_money_client_mutations$
DECLARE
  policy_row record;
  all_columns text;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'congratulatory_money'
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.congratulatory_money',
      policy_row.policyname
    );
  END LOOP;

  SELECT pg_catalog.string_agg(
    pg_catalog.format('%I', column_name),
    ', ' ORDER BY ordinal_position
  )
  INTO all_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'congratulatory_money';

  REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.congratulatory_money
    FROM PUBLIC, anon, authenticated, service_role;
  EXECUTE pg_catalog.format(
    'REVOKE SELECT (%s) ON TABLE public.congratulatory_money FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );
  EXECUTE pg_catalog.format(
    'REVOKE INSERT (%s) ON TABLE public.congratulatory_money FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );
  EXECUTE pg_catalog.format(
    'REVOKE UPDATE (%s) ON TABLE public.congratulatory_money FROM PUBLIC, anon, authenticated, service_role',
    all_columns
  );

  GRANT SELECT ON TABLE public.congratulatory_money TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.congratulatory_money TO service_role;
END;
$close_congratulatory_money_client_mutations$;

DROP POLICY IF EXISTS congratulatory_money_select_couple
  ON public.congratulatory_money;
CREATE POLICY congratulatory_money_select_couple
  ON public.congratulatory_money
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));

CREATE POLICY congratulatory_money_service_role_all
  ON public.congratulatory_money
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Saved notes are couple-shared, but their route-level origin/rate/body checks
-- were previously bypassable through direct PostgREST writes. Before closing
-- that path, fail closed if historical rows cross a couple boundary or already
-- exceed the product cap. No historical row is rewritten by this migration.
DO $saved_notes_existing_boundary_preflight$
DECLARE
  invalid_note uuid;
  over_limit_couple uuid;
BEGIN
  SELECT note.id
  INTO invalid_note
  FROM public.amora_saved_notes AS note
  LEFT JOIN public.chat_messages AS message
    ON message.id = note.message_id
  WHERE note.message_id IS NOT NULL
    AND (
      message.id IS NULL
      OR message.couple_id IS DISTINCT FROM note.couple_id
    )
  ORDER BY note.id
  LIMIT 1;

  IF invalid_note IS NOT NULL THEN
    RAISE EXCEPTION 'SAVED_NOTE_MESSAGE_BOUNDARY_REQUIRES_REVIEW: %', invalid_note
      USING ERRCODE = '55000';
  END IF;

  SELECT note.couple_id
  INTO over_limit_couple
  FROM public.amora_saved_notes AS note
  GROUP BY note.couple_id
  HAVING pg_catalog.count(*) > 300
  ORDER BY note.couple_id
  LIMIT 1;

  IF over_limit_couple IS NOT NULL THEN
    RAISE EXCEPTION 'SAVED_NOTES_LIMIT_REQUIRES_REVIEW: %', over_limit_couple
      USING ERRCODE = '55000';
  END IF;
END;
$saved_notes_existing_boundary_preflight$;

-- The advisory transaction lock serializes the count-and-insert decision for
-- one couple. A route-side count remains useful for a friendly response, but
-- only this database invariant is authoritative under concurrent requests.
CREATE OR REPLACE FUNCTION public.enforce_saved_note_boundary_and_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $enforce_saved_note_boundary_and_limit$
DECLARE
  message_couple_id uuid;
  existing_note_count bigint;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    RAISE EXCEPTION 'SAVED_NOTE_COUPLE_IMMUTABLE'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.saved_by IS DISTINCT FROM OLD.saved_by THEN
    RAISE EXCEPTION 'SAVED_NOTE_OWNER_IMMUTABLE'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.message_id IS NOT NULL THEN
    SELECT message.couple_id
    INTO message_couple_id
    FROM public.chat_messages AS message
    WHERE message.id = NEW.message_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'SAVED_NOTE_MESSAGE_NOT_FOUND'
        USING ERRCODE = '23503';
    END IF;

    IF message_couple_id IS DISTINCT FROM NEW.couple_id THEN
      RAISE EXCEPTION 'SAVED_NOTE_MESSAGE_COUPLE_MISMATCH'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'amora_saved_notes:' || NEW.couple_id::text,
        0
      )
    );

    SELECT pg_catalog.count(*)
    INTO existing_note_count
    FROM public.amora_saved_notes AS note
    WHERE note.couple_id = NEW.couple_id;

    IF existing_note_count >= 300 THEN
      RAISE EXCEPTION 'SAVED_NOTES_LIMIT'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$enforce_saved_note_boundary_and_limit$;

ALTER FUNCTION public.enforce_saved_note_boundary_and_limit()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_saved_note_boundary_and_limit()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zz_amora_saved_notes_boundary_and_limit
  ON public.amora_saved_notes;
CREATE TRIGGER zz_amora_saved_notes_boundary_and_limit
BEFORE INSERT OR UPDATE OF couple_id, saved_by, message_id
ON public.amora_saved_notes
FOR EACH ROW EXECUTE FUNCTION public.enforce_saved_note_boundary_and_limit();

-- Core profile/couple/journey/decision rows and cohort timeline events are now
-- mutated only by server APIs and exact-ACL RPCs. Retire historical client
-- grants and write policies so a direct REST call cannot bypass atomic progress
-- merges, onboarding checks, canonical decision recording, timeline validation,
-- or route-level abuse controls. chat_messages is deliberately excluded:
-- current web/mobile partner-message flows use its tightly column-scoped INSERT
-- grant and own-user RLS policy.
DO $close_core_client_mutations$
DECLARE
  target_table text;
  policy_row record;
  all_columns text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'profiles',
    'couples',
    'wedding_journeys',
    'decision_nodes',
    'cohort_timeline_events',
    'amora_saved_notes'
  ]::text[]
  LOOP
    FOR policy_row IN
      SELECT policyname
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    LOOP
      EXECUTE pg_catalog.format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        policy_row.policyname,
        target_table
      );
    END LOOP;

    SELECT pg_catalog.string_agg(
      pg_catalog.format('%I', column_name),
      ', ' ORDER BY ordinal_position
    )
    INTO all_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = target_table;

    EXECUTE pg_catalog.format(
      'REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      target_table
    );
    EXECUTE pg_catalog.format(
      'REVOKE SELECT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      all_columns,
      target_table
    );
    EXECUTE pg_catalog.format(
      'REVOKE INSERT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      all_columns,
      target_table
    );
    EXECUTE pg_catalog.format(
      'REVOKE UPDATE (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      all_columns,
      target_table
    );
    EXECUTE pg_catalog.format(
      'GRANT SELECT ON TABLE public.%I TO authenticated',
      target_table
    );
    EXECUTE pg_catalog.format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      target_table
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      target_table || '_service_role_all',
      target_table
    );
  END LOOP;
END;
$close_core_client_mutations$;

-- Raw event/search rows contain user, couple, session, and free-text context.
-- All current ingestion and reporting paths are server-side. Quarantine these
-- tables so direct PostgREST cannot bypass allow-lists, metadata scrubbing, or
-- rate limits, and vendor accounts cannot enumerate individual visitors.
DO $close_raw_analytics_surfaces$
DECLARE
  target_table text;
  policy_row record;
  all_columns text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'customer_events',
    'search_logs',
    'vendor_daily_stats'
  ]::text[]
  LOOP
    FOR policy_row IN
      SELECT policyname
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
    LOOP
      EXECUTE pg_catalog.format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        policy_row.policyname,
        target_table
      );
    END LOOP;

    SELECT pg_catalog.string_agg(
      pg_catalog.format('%I', column_name),
      ', ' ORDER BY ordinal_position
    )
    INTO all_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = target_table;

    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      target_table
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      target_table
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      all_columns,
      target_table
    );
    EXECUTE pg_catalog.format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      target_table
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      target_table || '_service_role_all',
      target_table
    );
  END LOOP;
END;
$close_raw_analytics_surfaces$;

-- These hosted-only tables are referenced by deletion/retention machinery but
-- have no current browser or mobile data path. Legacy fitting usage writes can
-- forge quota counters; legacy contract/payment policies expose financial and
-- signature data or let a vendor forge contract state. Fence them conditionally
-- because some older hosted projects contain only a subset.
DO $quarantine_dormant_sensitive_surfaces$
DECLARE
  target_table text;
  policy_row record;
  all_columns text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'fitting_requests',
    'fitting_usage',
    'user_fitting_photos',
    'invitations',
    'invitation_photos',
    'invitation_accounts',
    'invitation_rsvp',
    'invitation_guestbook',
    'invitation_visits',
    'ai_scripts',
    'customer_insights',
    'vendor_contract_templates',
    'contracts',
    'payments',
    'settlements'
  ]::text[]
  LOOP
    IF pg_catalog.to_regclass(
      pg_catalog.format('public.%I', target_table)
    ) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      target_table
    );

    FOR policy_row IN
      SELECT policyname
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
    LOOP
      EXECUTE pg_catalog.format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        policy_row.policyname,
        target_table
      );
    END LOOP;

    SELECT pg_catalog.string_agg(
      pg_catalog.format('%I', column_name),
      ', ' ORDER BY ordinal_position
    )
    INTO all_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = target_table;

    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      target_table
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      all_columns,
      target_table
    );
    EXECUTE pg_catalog.format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      target_table
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      target_table || '_service_role_all',
      target_table
    );
  END LOOP;
END;
$quarantine_dormant_sensitive_surfaces$;

-- Counter-maintaining triggers must not be replaceable or bypassed by a
-- service-key-backed PostgREST client. Production release lease tables are not
-- part of this explicit application-table list.
DO $close_counter_table_ddl_bypasses$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'cohort_rooms',
    'cohort_members',
    'cohort_messages',
    'guestbooks',
    'guestbook_messages',
    'community_profiles',
    'community_posts',
    'community_comments',
    'community_polls',
    'community_poll_votes'
  ]::text[]
  LOOP
    IF pg_catalog.to_regclass(
      pg_catalog.format('public.%I', target_table)
    ) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE pg_catalog.format(
      'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM service_role',
      target_table
    );
  END LOOP;
END;
$close_counter_table_ddl_bypasses$;

DO $residual_privilege_postflight$
DECLARE
  target_table text;
  target_role text;
  exposed_column text;
  unsafe_policy text;
BEGIN
  -- Every current public table must reject the non-DML privileges that bypass
  -- or alter row-level enforcement for untrusted API roles.
  SELECT pg_catalog.format('%I.%I -> %I',
           namespace.nspname,
           relation.relname,
           role_name.role_name)
  INTO unsafe_policy
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  CROSS JOIN unnest(ARRAY['anon', 'authenticated']::text[])
    AS role_name(role_name)
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND (
      pg_catalog.has_table_privilege(
        role_name.role_name,
        relation.oid,
        'TRUNCATE'
      )
      OR pg_catalog.has_table_privilege(
        role_name.role_name,
        relation.oid,
        'REFERENCES'
      )
      OR pg_catalog.has_table_privilege(
        role_name.role_name,
        relation.oid,
        'TRIGGER'
      )
    )
  ORDER BY relation.relname, role_name.role_name
  LIMIT 1;

  IF unsafe_policy IS NOT NULL THEN
    RAISE EXCEPTION 'UNTRUSTED_NON_DML_TABLE_PRIVILEGE_REMAINS: %',
      unsafe_policy
      USING ERRCODE = '55000';
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'vendor_products',
    'vendor_images',
    'vendor_timeslots',
    'product_timeslots',
    'vendor_staff',
    'staff_timeslots',
    'profiles',
    'couples',
    'wedding_journeys',
    'decision_nodes',
    'cohort_timeline_events',
    'decision_edges',
    'congratulatory_money',
    'amora_saved_notes'
  ]::text[]
  LOOP
    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated']::text[]
    LOOP
      IF pg_catalog.has_table_privilege(
        target_role,
        pg_catalog.format('public.%I', target_table),
        'INSERT'
      ) OR pg_catalog.has_table_privilege(
        target_role,
        pg_catalog.format('public.%I', target_table),
        'UPDATE'
      ) OR pg_catalog.has_table_privilege(
        target_role,
        pg_catalog.format('public.%I', target_table),
        'DELETE'
      ) THEN
        RAISE EXCEPTION 'SERVER_OWNED_CLIENT_MUTATION_REMAINS: %.%',
          target_role,
          target_table
          USING ERRCODE = '55000';
      END IF;
    END LOOP;

    SELECT column_name
    INTO exposed_column
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND (
        pg_catalog.has_column_privilege(
          'anon',
          pg_catalog.format('public.%I', target_table),
          column_name,
          'INSERT'
        )
        OR pg_catalog.has_column_privilege(
          'anon',
          pg_catalog.format('public.%I', target_table),
          column_name,
          'UPDATE'
        )
        OR pg_catalog.has_column_privilege(
          'authenticated',
          pg_catalog.format('public.%I', target_table),
          column_name,
          'INSERT'
        )
        OR pg_catalog.has_column_privilege(
          'authenticated',
          pg_catalog.format('public.%I', target_table),
          column_name,
          'UPDATE'
        )
      )
    ORDER BY ordinal_position
    LIMIT 1;

    IF exposed_column IS NOT NULL THEN
      RAISE EXCEPTION 'SERVER_OWNED_CLIENT_COLUMN_MUTATION_REMAINS: %.%',
        target_table,
        exposed_column
        USING ERRCODE = '55000';
    END IF;

    IF NOT pg_catalog.has_table_privilege(
      'service_role',
      pg_catalog.format('public.%I', target_table),
      'SELECT'
    ) OR NOT pg_catalog.has_table_privilege(
      'service_role',
      pg_catalog.format('public.%I', target_table),
      'INSERT'
    ) OR NOT pg_catalog.has_table_privilege(
      'service_role',
      pg_catalog.format('public.%I', target_table),
      'UPDATE'
    ) OR NOT pg_catalog.has_table_privilege(
      'service_role',
      pg_catalog.format('public.%I', target_table),
      'DELETE'
    ) THEN
      RAISE EXCEPTION 'SERVER_OWNED_SERVICE_DML_MISSING: %', target_table
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT pg_catalog.format('%I.%I policy %I',
           namespace.nspname,
           relation.relname,
           policy.polname)
  INTO unsafe_policy
  FROM pg_catalog.pg_policy AS policy
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = policy.polrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname IN (
      'vendor_products',
      'vendor_images',
      'vendor_timeslots',
      'product_timeslots',
      'vendor_staff',
      'staff_timeslots',
      'profiles',
      'couples',
      'wedding_journeys',
      'decision_nodes',
      'cohort_timeline_events',
      'decision_edges',
      'congratulatory_money',
      'amora_saved_notes'
    )
    AND policy.polcmd IN ('*', 'a', 'w', 'd')
    AND EXISTS (
      SELECT 1
      FROM unnest(policy.polroles) AS granted_role(role_oid)
      WHERE granted_role.role_oid = 0
         OR pg_catalog.pg_get_userbyid(granted_role.role_oid)
              IN ('anon', 'authenticated')
    )
  ORDER BY relation.relname, policy.polname
  LIMIT 1;

  IF unsafe_policy IS NOT NULL THEN
    RAISE EXCEPTION 'SERVER_OWNED_CLIENT_MUTATION_POLICY_REMAINS: %',
      unsafe_policy
      USING ERRCODE = '55000';
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'customer_events',
    'search_logs',
    'vendor_daily_stats',
    'fitting_requests',
    'fitting_usage',
    'user_fitting_photos',
    'invitations',
    'invitation_photos',
    'invitation_accounts',
    'invitation_rsvp',
    'invitation_guestbook',
    'invitation_visits',
    'ai_scripts',
    'customer_insights',
    'vendor_contract_templates',
    'contracts',
    'payments',
    'settlements'
  ]::text[]
  LOOP
    IF pg_catalog.to_regclass(
      pg_catalog.format('public.%I', target_table)
    ) IS NULL THEN
      CONTINUE;
    END IF;

    FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated']::text[]
    LOOP
      IF pg_catalog.has_table_privilege(
        target_role,
        pg_catalog.format('public.%I', target_table),
        'SELECT'
      ) OR pg_catalog.has_table_privilege(
        target_role,
        pg_catalog.format('public.%I', target_table),
        'INSERT'
      ) OR pg_catalog.has_table_privilege(
        target_role,
        pg_catalog.format('public.%I', target_table),
        'UPDATE'
      ) OR pg_catalog.has_table_privilege(
        target_role,
        pg_catalog.format('public.%I', target_table),
        'DELETE'
      ) THEN
        RAISE EXCEPTION 'SENSITIVE_SERVICE_ONLY_CLIENT_ACCESS_REMAINS: %.%',
          target_role,
          target_table
          USING ERRCODE = '55000';
      END IF;
    END LOOP;

    IF NOT pg_catalog.has_table_privilege(
      'service_role',
      pg_catalog.format('public.%I', target_table),
      'SELECT'
    ) OR NOT pg_catalog.has_table_privilege(
      'service_role',
      pg_catalog.format('public.%I', target_table),
      'INSERT'
    ) OR NOT pg_catalog.has_table_privilege(
      'service_role',
      pg_catalog.format('public.%I', target_table),
      'UPDATE'
    ) OR NOT pg_catalog.has_table_privilege(
      'service_role',
      pg_catalog.format('public.%I', target_table),
      'DELETE'
    ) OR pg_catalog.has_table_privilege(
      'service_role',
      pg_catalog.format('public.%I', target_table),
      'TRUNCATE'
    ) OR pg_catalog.has_table_privilege(
      'service_role',
      pg_catalog.format('public.%I', target_table),
      'REFERENCES'
    ) OR pg_catalog.has_table_privilege(
      'service_role',
      pg_catalog.format('public.%I', target_table),
      'TRIGGER'
    ) THEN
      RAISE EXCEPTION 'SENSITIVE_SERVICE_ONLY_ACL_INVALID: %', target_table
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  FOREACH target_table IN ARRAY ARRAY[
    'profiles',
    'couples',
    'wedding_journeys',
    'decision_nodes',
    'cohort_timeline_events',
    'decision_edges',
    'congratulatory_money',
    'amora_saved_notes'
  ]::text[]
  LOOP
    IF NOT pg_catalog.has_table_privilege(
      'authenticated',
      pg_catalog.format('public.%I', target_table),
      'SELECT'
    ) THEN
      RAISE EXCEPTION 'COUPLE_SERVER_WRITE_READ_ACL_MISSING: %', target_table
        USING ERRCODE = '55000';
    END IF;

    IF pg_catalog.has_table_privilege(
      'anon',
      pg_catalog.format('public.%I', target_table),
      'SELECT'
    ) THEN
      RAISE EXCEPTION 'COUPLE_SERVER_WRITE_ANON_READ_REMAINS: %', target_table
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.decision_edges AS edge
    LEFT JOIN public.decision_nodes AS from_node
      ON from_node.id = edge.from_node_id
    LEFT JOIN public.decision_nodes AS to_node
      ON to_node.id = edge.to_node_id
    WHERE edge.couple_id IS NULL
       OR edge.from_node_id IS NULL
       OR edge.to_node_id IS NULL
       OR from_node.id IS NULL
       OR to_node.id IS NULL
       OR edge.couple_id IS DISTINCT FROM from_node.couple_id
       OR edge.couple_id IS DISTINCT FROM to_node.couple_id
  ) THEN
    RAISE EXCEPTION 'DECISION_EDGE_BOUNDARY_INVALID_AFTER_MIGRATION'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'public.decision_edges'::pg_catalog.regclass
      AND trigger.tgname = 'decision_edges_couple_boundary'
      AND NOT trigger.tgisinternal
      AND trigger.tgenabled <> 'D'
  ) OR pg_catalog.has_function_privilege(
    'anon',
    'public.enforce_decision_edge_couple_boundary()',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.enforce_decision_edge_couple_boundary()',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'service_role',
    'public.enforce_decision_edge_couple_boundary()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'DECISION_EDGE_BOUNDARY_TRIGGER_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'public.decision_nodes'::pg_catalog.regclass
      AND trigger.tgname = 'decision_nodes_couple_immutable'
      AND NOT trigger.tgisinternal
      AND trigger.tgenabled <> 'D'
  ) OR pg_catalog.has_function_privilege(
    'anon',
    'public.prevent_decision_node_couple_reassignment()',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.prevent_decision_node_couple_reassignment()',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'service_role',
    'public.prevent_decision_node_couple_reassignment()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'DECISION_NODE_COUPLE_IMMUTABILITY_TRIGGER_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.amora_saved_notes AS note
    LEFT JOIN public.chat_messages AS message
      ON message.id = note.message_id
    WHERE note.message_id IS NOT NULL
      AND (
        message.id IS NULL
        OR message.couple_id IS DISTINCT FROM note.couple_id
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'public.amora_saved_notes'::pg_catalog.regclass
      AND trigger.tgname = 'zz_amora_saved_notes_boundary_and_limit'
      AND NOT trigger.tgisinternal
      AND trigger.tgenabled <> 'D'
  ) OR pg_catalog.has_function_privilege(
    'anon',
    'public.enforce_saved_note_boundary_and_limit()',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.enforce_saved_note_boundary_and_limit()',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'service_role',
    'public.enforce_saved_note_boundary_and_limit()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'SAVED_NOTE_BOUNDARY_TRIGGER_INVALID'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT note.couple_id
    FROM public.amora_saved_notes AS note
    GROUP BY note.couple_id
    HAVING pg_catalog.count(*) > 300
  ) THEN
    RAISE EXCEPTION 'SAVED_NOTES_LIMIT_INVALID_AFTER_MIGRATION'
      USING ERRCODE = '55000';
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'cohort_rooms',
    'cohort_members',
    'cohort_messages',
    'guestbooks',
    'guestbook_messages',
    'community_profiles',
    'community_posts',
    'community_comments',
    'community_polls',
    'community_poll_votes'
  ]::text[]
  LOOP
    IF pg_catalog.to_regclass(
      pg_catalog.format('public.%I', target_table)
    ) IS NOT NULL AND (
      pg_catalog.has_table_privilege(
        'service_role',
        pg_catalog.format('public.%I', target_table),
        'TRUNCATE'
      )
      OR pg_catalog.has_table_privilege(
        'service_role',
        pg_catalog.format('public.%I', target_table),
        'REFERENCES'
      )
      OR pg_catalog.has_table_privilege(
        'service_role',
        pg_catalog.format('public.%I', target_table),
        'TRIGGER'
      )
    ) THEN
      RAISE EXCEPTION 'COUNTER_TABLE_SERVICE_DDL_PRIVILEGE_REMAINS: %',
        target_table
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$residual_privilege_postflight$;

COMMIT;
