BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

-- Keep the complete authorization predicate behind one source-hashed helper.
-- The four policies below then have a tiny, anchored expression that can be
-- compared exactly instead of accepting a few marker substrings.
CREATE OR REPLACE FUNCTION public.can_read_amora_couple_data(
  p_couple_id uuid,
  p_visibility text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      JOIN public.couples AS couple ON couple.id = profile.couple_id
      WHERE profile.id = auth.uid()
        AND profile.couple_id = p_couple_id
        AND profile.account_deleting_at IS NULL
        AND profile.amora_membership_resetting_at IS NULL
        AND couple.amora_shared_resetting_at IS NULL
        AND (
          (profile.role::text = 'bride' AND couple.bride_id = profile.id)
          OR (profile.role::text = 'groom' AND couple.groom_id = profile.id)
        )
        AND CASE p_visibility
          WHEN 'shared' THEN true
          WHEN 'bride_private' THEN profile.role::text = 'bride'
          WHEN 'groom_private' THEN profile.role::text = 'groom'
          ELSE false
        END
    );
$$;

ALTER FUNCTION public.can_read_amora_couple_data(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_read_amora_couple_data(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_amora_couple_data(uuid, text)
  TO authenticated;

-- A membership reset is a privacy revocation boundary, not merely a write
-- fence. The reset API can return 202 while an already-running provider lease
-- drains, so authenticated clients must lose direct SELECT access as soon as
-- either lifecycle marker is set. Keep all four policy replacements in one
-- transaction so there is no permissive policy window.
LOCK TABLE public.amora_couple_profiles IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.chat_messages IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.chat_summaries IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.decision_nodes IN SHARE ROW EXCLUSIVE MODE;

DROP POLICY IF EXISTS "amora_couple_profiles_select_with_privacy" ON public.amora_couple_profiles;
CREATE POLICY "amora_couple_profiles_select_with_privacy"
  ON public.amora_couple_profiles
  FOR SELECT TO authenticated
  USING (
    public.can_read_amora_couple_data(couple_id, visibility::text)
  );

DROP POLICY IF EXISTS "chat_select_with_privacy" ON public.chat_messages;
CREATE POLICY "chat_select_with_privacy"
  ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    public.can_read_amora_couple_data(couple_id, visibility::text)
  );

DROP POLICY IF EXISTS "chat_summaries_select_with_privacy" ON public.chat_summaries;
CREATE POLICY "chat_summaries_select_with_privacy"
  ON public.chat_summaries
  FOR SELECT TO authenticated
  USING (
    public.can_read_amora_couple_data(couple_id, visibility::text)
  );

DROP POLICY IF EXISTS "decision_nodes_select_with_privacy" ON public.decision_nodes;
CREATE POLICY "decision_nodes_select_with_privacy"
  ON public.decision_nodes
  FOR SELECT TO authenticated
  USING (
    public.can_read_amora_couple_data(couple_id, visibility::text)
  );

COMMIT;
