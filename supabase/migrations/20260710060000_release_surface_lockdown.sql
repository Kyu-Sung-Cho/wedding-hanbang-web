-- Conservative release lockdown for write surfaces that already have validated
-- server routes. Browser/mobile PostgREST must not bypass rate limits, ownership
-- checks, moderation, booking capacity, or server-owned fields.

-- The prior migration adds owner_user_id without guessing legacy ownership.
-- Stop before changing visibility if any ledger rows still need export-backed
-- operator mapping; silently hiding a couple's historical ledger is not safe.
DO $$
DECLARE v_unowned_money_count bigint;
BEGIN
  SELECT count(*) INTO v_unowned_money_count
  FROM public.congratulatory_money
  WHERE owner_user_id IS NULL;
  IF v_unowned_money_count > 0 THEN
    RAISE EXCEPTION
      'LEGACY_MONEY_OWNER_REPAIR_REQUIRED unowned_rows=%', v_unowned_money_count
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Community posts/comments/profiles are written by service-role API routes.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_posts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_comments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_profiles FROM anon, authenticated;
GRANT ALL ON TABLE public.community_posts, public.community_comments, public.community_profiles TO service_role;

-- Row visibility is not column privacy. Keep verification documents and the
-- generated search vector out of PostgREST while preserving the public post
-- contract consumed by the feed/detail clients.
REVOKE SELECT ON TABLE public.community_posts FROM anon, authenticated;
GRANT SELECT (
  id, author_id, category, title, content, images, slides, visibility,
  ad_disclosure, sponsorship_detail, ai_comment, is_resolved,
  is_verified_review, price_data, is_quick_review, rating, cohort_room_id,
  under_review, upvote_count, downvote_count, comment_count, view_count,
  bookmark_count, is_pinned, is_weekly_best, vendor_tags, tags, cost_data,
  created_at, updated_at
) ON TABLE public.community_posts TO anon, authenticated;

-- Public author cards need pseudonymous identity and contribution counters,
-- not wedding timing, region, progress or moderation state. Full own/same-room
-- profile reads are served by authenticated server routes.
REVOKE SELECT ON TABLE public.community_profiles FROM anon, authenticated;
GRANT SELECT (
  user_id, nickname, avatar_url, badge, rank, post_count, comment_count,
  total_upvotes_received, total_xp, level, created_at, updated_at
) ON TABLE public.community_profiles TO anon, authenticated;

DROP POLICY IF EXISTS "cp_insert" ON public.community_posts;
DROP POLICY IF EXISTS "cp_update" ON public.community_posts;
DROP POLICY IF EXISTS "cp_delete" ON public.community_posts;
DROP POLICY IF EXISTS "cc_insert" ON public.community_comments;
DROP POLICY IF EXISTS "cc_update" ON public.community_comments;
DROP POLICY IF EXISTS "cc_delete" ON public.community_comments;
DROP POLICY IF EXISTS "community_profiles_insert" ON public.community_profiles;
DROP POLICY IF EXISTS "community_profiles_update" ON public.community_profiles;

-- Moderated posts are invisible outside trusted admin/service routes. Drafts
-- remain author-only; members posts still require an authenticated session.
DROP POLICY IF EXISTS "cp_select_public" ON public.community_posts;
DROP POLICY IF EXISTS "cp_select_members" ON public.community_posts;
DROP POLICY IF EXISTS "cp_select_drafts" ON public.community_posts;
DROP POLICY IF EXISTS community_posts_safe_select ON public.community_posts;
CREATE POLICY community_posts_safe_select ON public.community_posts
  FOR SELECT TO anon, authenticated
  USING (
    author_id = auth.uid()
    OR (
      COALESCE(under_review, false) = false
      AND (
        visibility = 'public'
        OR (visibility = 'members' AND auth.role() = 'authenticated')
      )
    )
  );

-- A comment can only be read when its parent post is readable through the same
-- moderation/visibility rule. All comment mutations flow through server routes.
DROP POLICY IF EXISTS "cc_select" ON public.community_comments;
DROP POLICY IF EXISTS community_comments_safe_select ON public.community_comments;
CREATE POLICY community_comments_safe_select ON public.community_comments
  FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.community_posts AS post
    WHERE post.id = community_comments.post_id
  ));

-- Reports are server-inserted after persistent validation/rate limiting. Remove
-- legacy direct INSERT and enforce one report per reporter/target at the DB.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_reports FROM anon, authenticated;
GRANT SELECT ON TABLE public.community_reports TO authenticated;
GRANT ALL ON TABLE public.community_reports TO service_role;
DROP POLICY IF EXISTS "cr_insert" ON public.community_reports;
DROP POLICY IF EXISTS community_reports_insert_own ON public.community_reports;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY reporter_id, post_id ORDER BY created_at, id
  ) AS position
  FROM public.community_reports
  WHERE post_id IS NOT NULL
)
DELETE FROM public.community_reports AS report
USING ranked
WHERE report.id = ranked.id AND ranked.position > 1;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY reporter_id, comment_id ORDER BY created_at, id
  ) AS position
  FROM public.community_reports
  WHERE comment_id IS NOT NULL
)
DELETE FROM public.community_reports AS report
USING ranked
WHERE report.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_reports_reporter_post
  ON public.community_reports(reporter_id, post_id)
  WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_reports_reporter_comment
  ON public.community_reports(reporter_id, comment_id)
  WHERE comment_id IS NOT NULL;

UPDATE public.community_posts AS post
SET under_review = true
WHERE COALESCE(post.under_review, false) = false
  AND (
    SELECT count(DISTINCT report.reporter_id)
    FROM public.community_reports AS report
    WHERE report.post_id = post.id AND report.status = 'pending'
  ) >= 3;

-- Voting is server-route only so visibility checks and rate limits cannot be
-- bypassed by direct RPC. Row locks plus source-of-truth recounts prevent two
-- simultaneous toggles from drifting cached counters.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_votes FROM anon, authenticated;
GRANT SELECT ON TABLE public.community_votes TO authenticated;
GRANT ALL ON TABLE public.community_votes TO service_role;
DROP POLICY IF EXISTS "cv_insert" ON public.community_votes;
DROP POLICY IF EXISTS "cv_update" ON public.community_votes;
DROP POLICY IF EXISTS "cv_delete" ON public.community_votes;

-- Bookmark mutations likewise pass through the validated server route so the
-- cached bookmark_count cannot drift through direct PostgREST writes.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_bookmarks FROM anon, authenticated;
GRANT SELECT ON TABLE public.community_bookmarks TO authenticated;
GRANT ALL ON TABLE public.community_bookmarks TO service_role;
DROP POLICY IF EXISTS "cb_all" ON public.community_bookmarks;
DROP POLICY IF EXISTS community_bookmarks_select_own ON public.community_bookmarks;
CREATE POLICY community_bookmarks_select_own ON public.community_bookmarks
  FOR SELECT TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON FUNCTION public.community_update_bookmark_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_update_bookmark_count(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_update_bookmark_count(uuid) TO service_role;

-- Repair cached counters from their source tables before ranks consume them.
-- This is intentionally a one-time full recount and must run in the documented
-- maintenance window on production-sized data.
UPDATE public.community_posts AS post
SET upvote_count = (
      SELECT count(*)::integer FROM public.community_votes AS vote
      WHERE vote.post_id = post.id AND vote.vote_type = 1
    ),
    downvote_count = (
      SELECT count(*)::integer FROM public.community_votes AS vote
      WHERE vote.post_id = post.id AND vote.vote_type = -1
    ),
    comment_count = (
      SELECT count(*)::integer FROM public.community_comments AS comment
      WHERE comment.post_id = post.id
        AND COALESCE(comment.is_deleted, false) = false
    ),
    bookmark_count = (
      SELECT count(*)::integer FROM public.community_bookmarks AS bookmark
      WHERE bookmark.post_id = post.id
    );

UPDATE public.community_comments AS comment
SET upvote_count = (
  SELECT count(*)::integer FROM public.community_votes AS vote
  WHERE vote.comment_id = comment.id AND vote.vote_type = 1
);

UPDATE public.community_profiles AS profile
SET post_count = (
      SELECT count(*)::integer FROM public.community_posts AS post
      WHERE post.author_id = profile.user_id
    ),
    comment_count = (
      SELECT count(*)::integer FROM public.community_comments AS comment
      WHERE comment.author_id = profile.user_id
        AND COALESCE(comment.is_deleted, false) = false
    ),
    total_upvotes_received = (
      SELECT count(*)::integer
      FROM public.community_votes AS vote
      WHERE vote.vote_type = 1
        AND (
          EXISTS (
            SELECT 1 FROM public.community_posts AS post
            WHERE post.id = vote.post_id AND post.author_id = profile.user_id
          )
          OR EXISTS (
            SELECT 1 FROM public.community_comments AS comment
            WHERE comment.id = vote.comment_id
              AND comment.author_id = profile.user_id
              AND COALESCE(comment.is_deleted, false) = false
          )
        )
    );

CREATE OR REPLACE FUNCTION public.community_vote_post(
  p_user_id uuid, p_post_id uuid, p_vote_type smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_vote_type NOT IN (0, 1) THEN
    RAISE EXCEPTION 'invalid_post_vote_type' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.community_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_vote_type = 0 THEN
    DELETE FROM public.community_votes
    WHERE user_id = p_user_id AND post_id = p_post_id;
  ELSE
    INSERT INTO public.community_votes(user_id, post_id, comment_id, vote_type)
    VALUES (p_user_id, p_post_id, NULL, 1)
    ON CONFLICT (user_id, post_id) DO UPDATE SET vote_type = EXCLUDED.vote_type;
  END IF;

  UPDATE public.community_posts
  SET upvote_count = (
        SELECT count(*)::integer FROM public.community_votes
        WHERE post_id = p_post_id AND vote_type = 1
      ),
      downvote_count = (
        SELECT count(*)::integer FROM public.community_votes
        WHERE post_id = p_post_id AND vote_type = -1
      )
  WHERE id = p_post_id;
END;
$$;
REVOKE ALL ON FUNCTION public.community_vote_post(uuid, uuid, smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_vote_post(uuid, uuid, smallint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_vote_post(uuid, uuid, smallint) TO service_role;

CREATE OR REPLACE FUNCTION public.community_vote_comment(
  p_user_id uuid, p_comment_id uuid, p_vote_type smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_vote_type NOT IN (-1, 0, 1) THEN
    RAISE EXCEPTION 'invalid_comment_vote_type' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.community_comments WHERE id = p_comment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'comment not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_vote_type = 0 THEN
    DELETE FROM public.community_votes
    WHERE user_id = p_user_id AND comment_id = p_comment_id;
  ELSE
    INSERT INTO public.community_votes(user_id, post_id, comment_id, vote_type)
    VALUES (p_user_id, NULL, p_comment_id, p_vote_type)
    ON CONFLICT (user_id, comment_id) DO UPDATE SET vote_type = EXCLUDED.vote_type;
  END IF;

  UPDATE public.community_comments
  SET upvote_count = (
    SELECT count(*)::integer FROM public.community_votes
    WHERE comment_id = p_comment_id AND vote_type = 1
  )
  WHERE id = p_comment_id;
END;
$$;
REVOKE ALL ON FUNCTION public.community_vote_comment(uuid, uuid, smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_vote_comment(uuid, uuid, smallint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_vote_comment(uuid, uuid, smallint) TO service_role;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_poll_votes FROM anon, authenticated;
GRANT ALL ON TABLE public.community_poll_votes TO service_role;
DROP POLICY IF EXISTS "poll_votes_insert_own" ON public.community_poll_votes;
DROP POLICY IF EXISTS "poll_votes_delete_own" ON public.community_poll_votes;
DELETE FROM public.community_poll_votes AS vote
WHERE NOT EXISTS (
  SELECT 1 FROM public.community_poll_options AS option
  WHERE option.id = vote.option_id AND option.poll_id = vote.poll_id
);
ALTER TABLE public.community_poll_options
  DROP CONSTRAINT IF EXISTS community_poll_options_id_poll_unique;
ALTER TABLE public.community_poll_options
  ADD CONSTRAINT community_poll_options_id_poll_unique UNIQUE (id, poll_id);
ALTER TABLE public.community_poll_votes
  DROP CONSTRAINT IF EXISTS community_poll_votes_option_same_poll_fkey;
ALTER TABLE public.community_poll_votes
  ADD CONSTRAINT community_poll_votes_option_same_poll_fkey
  FOREIGN KEY (option_id, poll_id)
  REFERENCES public.community_poll_options(id, poll_id)
  ON DELETE CASCADE;
UPDATE public.community_poll_options AS option
SET vote_count = (
  SELECT count(*)::integer FROM public.community_poll_votes AS vote
  WHERE vote.option_id = option.id
);
UPDATE public.community_polls AS poll
SET total_votes = (
      SELECT count(*)::integer FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = poll.id
    ),
    total_voters = (
      SELECT count(DISTINCT vote.user_id)::integer FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = poll.id
    );

CREATE OR REPLACE FUNCTION public.community_report_auto_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF NEW.post_id IS NOT NULL THEN
    SELECT count(DISTINCT reporter_id) INTO v_count
    FROM public.community_reports
    WHERE post_id = NEW.post_id AND status = 'pending';
    IF v_count >= 3 THEN
      UPDATE public.community_posts SET under_review = true WHERE id = NEW.post_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.community_report_auto_review() FROM PUBLIC;

-- Cohort contract/timeline inserts are validated by membership-aware API routes.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cohort_contracts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cohort_timeline_events FROM anon, authenticated;
GRANT ALL ON TABLE public.cohort_contracts, public.cohort_timeline_events TO service_role;
DROP POLICY IF EXISTS "cohort_contracts_insert" ON public.cohort_contracts;
DROP POLICY IF EXISTS "cohort_contracts_update" ON public.cohort_contracts;
DROP POLICY IF EXISTS "cohort_contracts_delete" ON public.cohort_contracts;
DROP POLICY IF EXISTS "cohort_timeline_insert" ON public.cohort_timeline_events;

-- Public community media is uploadable only through /api/community/upload,
-- which validates content bytes, type, size, lifecycle state and rate limits.
DROP POLICY IF EXISTS "community-images authenticated write" ON storage.objects;
DROP POLICY IF EXISTS "community-images authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "community-images own folder write" ON storage.objects;
DROP POLICY IF EXISTS "community-images own folder update" ON storage.objects;
DROP POLICY IF EXISTS "community-videos authenticated write" ON storage.objects;
DROP POLICY IF EXISTS "community-videos authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "community-videos own folder write" ON storage.objects;
DROP POLICY IF EXISTS "community-videos own folder update" ON storage.objects;

-- Marketplace approval, booking state, reviews, messages and view events are
-- server-owned. Existing read policies remain intact.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendors FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_bookings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_reviews FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_messages FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_views FROM anon, authenticated;
GRANT ALL ON TABLE public.vendors, public.vendor_bookings, public.vendor_reviews,
  public.vendor_messages, public.vendor_views TO service_role;

-- Approved-vendor row RLS did not protect columns: select=* exposed owner,
-- registration, moderation, commission and bank data. Public clients receive
-- only the catalogue columns below; owner/admin details stay server-only.
REVOKE SELECT ON TABLE public.vendors FROM anon, authenticated;
GRANT SELECT (
  id, name, category, region, address, phone, website, instagram, description,
  style_tags, is_fixed_price, is_verified, rating, review_count, thumbnail_url,
  location, tags, price_range, price_min, price_max, status, ai_recommend,
  business_hours, created_at, updated_at
) ON TABLE public.vendors TO anon, authenticated;

REVOKE SELECT ON TABLE public.vendor_reviews FROM anon, authenticated;
GRANT SELECT (
  id, vendor_id, product_id, rating, content, images, reply, replied_at,
  is_visible, created_at, updated_at
) ON TABLE public.vendor_reviews TO anon, authenticated;

DROP POLICY IF EXISTS "vendors_insert_own" ON public.vendors;
DROP POLICY IF EXISTS "vendors_update_own" ON public.vendors;
DROP POLICY IF EXISTS "vendors_delete_own" ON public.vendors;
DROP POLICY IF EXISTS "업체: 본인 업체 수정" ON public.vendors;
DROP POLICY IF EXISTS "vendor_bookings_insert" ON public.vendor_bookings;
DROP POLICY IF EXISTS "vendor_bookings_update" ON public.vendor_bookings;
DROP POLICY IF EXISTS "vendor_reviews_insert" ON public.vendor_reviews;
DROP POLICY IF EXISTS "vendor_reviews_update_own" ON public.vendor_reviews;
DROP POLICY IF EXISTS "고객: 리뷰 작성" ON public.vendor_reviews;
DROP POLICY IF EXISTS "고객: 본인 리뷰 수정" ON public.vendor_reviews;
DROP POLICY IF EXISTS "업체: 리뷰 답변" ON public.vendor_reviews;
DROP POLICY IF EXISTS "vendor_messages_insert" ON public.vendor_messages;
DROP POLICY IF EXISTS "vendor_messages_update" ON public.vendor_messages;
DROP POLICY IF EXISTS "vendor_views_insert" ON public.vendor_views;

-- Dead guestbook insert and dormant contract state machines are read-only until
-- dedicated validated transition APIs and retention rules are approved.
REVOKE INSERT ON TABLE public.guestbook_messages FROM anon, authenticated;
DROP POLICY IF EXISTS "gb_messages_insert_anon" ON public.guestbook_messages;
REVOKE SELECT ON TABLE public.guestbook_messages FROM anon, authenticated;
GRANT SELECT (
  id, guestbook_id, guest_name, relation, message, image_url, message_type,
  is_approved, created_at
) ON TABLE public.guestbook_messages TO anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.contracts FROM anon, authenticated;
GRANT ALL ON TABLE public.contracts TO service_role;
DROP POLICY IF EXISTS "업체: 본인 계약 관리" ON public.contracts;
DROP POLICY IF EXISTS "고객: 본인 계약 업데이트" ON public.contracts;

-- Congratulatory-money rows must follow the person who created/owned them, not
-- a reusable bride/groom slot. All legacy rows lack person-level provenance
-- and remain quarantined (owner NULL) for export-backed manual remediation.
ALTER TABLE public.congratulatory_money
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_congratulatory_money_owner
  ON public.congratulatory_money(owner_user_id, received_at DESC);

REVOKE INSERT, UPDATE, DELETE ON TABLE public.congratulatory_money FROM anon, authenticated;
GRANT SELECT ON TABLE public.congratulatory_money TO authenticated;
GRANT ALL ON TABLE public.congratulatory_money TO service_role;
DROP POLICY IF EXISTS "money_owner" ON public.congratulatory_money;
DROP POLICY IF EXISTS money_owner_select ON public.congratulatory_money;
CREATE POLICY money_owner_select ON public.congratulatory_money
  FOR SELECT TO authenticated
  USING (
    public.is_couple_member(couple_id)
    AND EXISTS (
      SELECT 1
      FROM public.couples AS couple
      WHERE couple.id = congratulatory_money.couple_id
        AND congratulatory_money.owner_user_id IN (couple.bride_id, couple.groom_id)
    )
  );

-- Legacy API validation allowed a reply to point at a parent in another post.
-- Detach those grafts, then make the same-post invariant a database constraint.
UPDATE public.community_comments AS reply
SET parent_id = NULL
FROM public.community_comments AS parent
WHERE parent.id = reply.parent_id
  AND parent.post_id IS DISTINCT FROM reply.post_id;
ALTER TABLE public.community_comments
  DROP CONSTRAINT IF EXISTS community_comments_id_post_unique;
ALTER TABLE public.community_comments
  ADD CONSTRAINT community_comments_id_post_unique UNIQUE (id, post_id);
ALTER TABLE public.community_comments
  DROP CONSTRAINT IF EXISTS community_comments_parent_same_post_fkey;
ALTER TABLE public.community_comments
  ADD CONSTRAINT community_comments_parent_same_post_fkey
  FOREIGN KEY (parent_id, post_id)
  REFERENCES public.community_comments(id, post_id)
  ON DELETE CASCADE;

-- Decision edges have no direct product consumer and can reveal private-node
-- relationships. Keep them service-only until visibility/owner columns exist.
REVOKE ALL ON TABLE public.decision_edges FROM anon, authenticated;
GRANT ALL ON TABLE public.decision_edges TO service_role;
DROP POLICY IF EXISTS "decision_edges_owner_all" ON public.decision_edges;

-- SECURITY DEFINER functions inherit EXECUTE for PUBLIC unless explicitly
-- revoked. These two legacy functions either mutate bookings or expose a
-- cross-user leaderboard and have no authenticated direct-call contract.
REVOKE ALL ON FUNCTION public.create_booking_atomic(
  uuid, uuid, date, text, uuid, uuid, text, text, text, text, numeric, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_booking_atomic(
  uuid, uuid, date, text, uuid, uuid, text, text, text, text, numeric, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(
  uuid, uuid, date, text, uuid, uuid, text, text, text, text, numeric, text
) TO service_role;

REVOKE ALL ON FUNCTION public.community_weekly_leaderboard(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_weekly_leaderboard(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_weekly_leaderboard(integer) TO service_role;
