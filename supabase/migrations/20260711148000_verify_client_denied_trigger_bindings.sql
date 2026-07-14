
SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- The preceding ACL migration made these SECURITY DEFINER trigger functions
-- non-callable by clients. Their protection still depends on the trigger being
-- present, enabled, attached to the reviewed table, and bound to the exact
-- function. Acquire every target in deterministic schema/table order, repair
-- every binding, then record the full contract in forward history.
LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.chat_messages IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.cohort_members IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.community_profiles IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.couples IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

DROP TRIGGER IF EXISTS trg_recalc_rank ON public.community_profiles;
CREATE TRIGGER trg_recalc_rank
  AFTER UPDATE OF post_count, comment_count, total_upvotes_received,
    wedding_completed ON public.community_profiles
  FOR EACH ROW EXECUTE FUNCTION public.community_recalc_rank();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_profile_on_signup();

DROP TRIGGER IF EXISTS trg_guard_amora_user_message_insert
  ON public.chat_messages;
CREATE TRIGGER trg_guard_amora_user_message_insert
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_amora_user_message_insert();

DROP TRIGGER IF EXISTS trg_guard_profile_self_insert ON public.profiles;
CREATE TRIGGER trg_guard_profile_self_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_self_insert();

DROP TRIGGER IF EXISTS trg_prevent_cohort_membership_client_write
  ON public.cohort_members;
CREATE TRIGGER trg_prevent_cohort_membership_client_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.cohort_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_cohort_membership_client_write();

DROP TRIGGER IF EXISTS trg_prevent_couple_ownership_self_change
  ON public.profiles;
CREATE TRIGGER trg_prevent_couple_ownership_self_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_couple_ownership_self_change();

DROP TRIGGER IF EXISTS trg_prevent_couple_slot_self_change ON public.couples;
CREATE TRIGGER trg_prevent_couple_slot_self_change
  BEFORE UPDATE ON public.couples
  FOR EACH ROW EXECUTE FUNCTION public.prevent_couple_slot_self_change();

DROP TRIGGER IF EXISTS trg_prevent_is_admin_self_change ON public.profiles;
CREATE TRIGGER trg_prevent_is_admin_self_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_is_admin_self_change();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public', 'community_profiles', 'trg_recalc_rank',
        'public.community_recalc_rank()',
        'CREATE TRIGGER trg_recalc_rank AFTER UPDATE OF post_count, comment_count, total_upvotes_received, wedding_completed ON community_profiles FOR EACH ROW EXECUTE FUNCTION community_recalc_rank()'),
      ('auth', 'users', 'on_auth_user_created',
        'public.create_profile_on_signup()',
        'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION create_profile_on_signup()'),
      ('public', 'chat_messages', 'trg_guard_amora_user_message_insert',
        'public.guard_amora_user_message_insert()',
        'CREATE TRIGGER trg_guard_amora_user_message_insert BEFORE INSERT ON chat_messages FOR EACH ROW EXECUTE FUNCTION guard_amora_user_message_insert()'),
      ('public', 'profiles', 'trg_guard_profile_self_insert',
        'public.guard_profile_self_insert()',
        'CREATE TRIGGER trg_guard_profile_self_insert BEFORE INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_self_insert()'),
      ('public', 'cohort_members', 'trg_prevent_cohort_membership_client_write',
        'public.prevent_cohort_membership_client_write()',
        'CREATE TRIGGER trg_prevent_cohort_membership_client_write BEFORE INSERT OR DELETE OR UPDATE ON cohort_members FOR EACH ROW EXECUTE FUNCTION prevent_cohort_membership_client_write()'),
      ('public', 'profiles', 'trg_prevent_couple_ownership_self_change',
        'public.prevent_couple_ownership_self_change()',
        'CREATE TRIGGER trg_prevent_couple_ownership_self_change BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION prevent_couple_ownership_self_change()'),
      ('public', 'couples', 'trg_prevent_couple_slot_self_change',
        'public.prevent_couple_slot_self_change()',
        'CREATE TRIGGER trg_prevent_couple_slot_self_change BEFORE UPDATE ON couples FOR EACH ROW EXECUTE FUNCTION prevent_couple_slot_self_change()'),
      ('public', 'profiles', 'trg_prevent_is_admin_self_change',
        'public.prevent_is_admin_self_change()',
        'CREATE TRIGGER trg_prevent_is_admin_self_change BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION prevent_is_admin_self_change()')
    ) expected(
      schema_name, table_name, trigger_name, function_signature, definition
    )
    LEFT JOIN pg_catalog.pg_trigger trigger_row
      ON trigger_row.tgrelid = to_regclass(
        expected.schema_name || '.' || expected.table_name
      )
     AND trigger_row.tgname = expected.trigger_name
    WHERE trigger_row.oid IS NULL
       OR trigger_row.tgisinternal
       OR trigger_row.tgenabled IS DISTINCT FROM 'O'::"char"
       OR trigger_row.tgfoid IS DISTINCT FROM
         to_regprocedure(expected.function_signature)
       OR pg_get_triggerdef(trigger_row.oid, true)
         IS DISTINCT FROM expected.definition
  ) THEN
    RAISE EXCEPTION 'CLIENT_DENIED_TRIGGER_BINDING_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;
END;
$$;
