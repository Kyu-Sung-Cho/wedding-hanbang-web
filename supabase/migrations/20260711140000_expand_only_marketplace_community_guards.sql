-- Compatibility-conscious marketplace/community lockdown. Published catalog,
-- booking-read, vote and bookmark contracts stay available, but direct
-- state-machine writes and dormant guestbook access are intentionally retired.

-- ---------------------------------------------------------------------------
-- Marketplace: prevent owner self-approval and expose only catalog columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_vendor_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.owner_id IS DISTINCT FROM auth.uid()
        OR COALESCE(NEW.status, 'pending') <> 'pending'
        OR COALESCE(NEW.is_verified, false)
        OR COALESCE(NEW.ai_recommend, false)
        OR COALESCE(NEW.rating, 0) <> 0
        OR COALESCE(NEW.review_count, 0) <> 0
        OR NEW.approved_at IS NOT NULL
        OR NEW.rejected_at IS NOT NULL
        OR NEW.reject_reason IS NOT NULL
      THEN
        RAISE EXCEPTION 'vendor_server_fields_forbidden' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
        OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.is_verified IS DISTINCT FROM OLD.is_verified
        OR NEW.ai_recommend IS DISTINCT FROM OLD.ai_recommend
        OR NEW.rating IS DISTINCT FROM OLD.rating
        OR NEW.review_count IS DISTINCT FROM OLD.review_count
        OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
        OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at
        OR NEW.reject_reason IS DISTINCT FROM OLD.reject_reason
        OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
      THEN
        RAISE EXCEPTION 'vendor_server_fields_forbidden' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_vendor_server_fields ON public.vendors;
CREATE TRIGGER trg_guard_vendor_server_fields
  BEFORE INSERT OR UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_server_fields();
REVOKE ALL ON FUNCTION public.guard_vendor_server_fields() FROM PUBLIC, anon, authenticated;

-- Consumer clients only read catalog columns. Sensitive owner, license,
-- commission and bank fields remain available to service_role/admin APIs.
REVOKE SELECT ON TABLE public.vendors FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'vendors'
    AND column_name = ANY (ARRAY[
      -- RLS may evaluate owner_id without projecting it to callers. Public and
      -- member catalog reads never need the vendor owner's authentication UUID.
      'id', 'name', 'category', 'region', 'address', 'location', 'website',
      'instagram', 'description', 'style_tags', 'tags', 'price_range',
      'price_min', 'price_max', 'business_hours', 'status', 'thumbnail_url',
      'is_verified', 'ai_recommend', 'rating', 'review_count', 'created_at',
      'updated_at', 'is_fixed_price'
    ]);
  IF v_columns IS NULL THEN
    RAISE EXCEPTION 'vendors public catalog columns are missing';
  END IF;
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.vendors TO anon, authenticated', v_columns);
END;
$$;

-- Public review payloads never need the reviewer auth UUID or the underlying
-- booking UUID. Keep the current UI/API shape while making select=* unable to
-- disclose those linkage identifiers.
DROP POLICY IF EXISTS "vendor_reviews_select" ON public.vendor_reviews;
CREATE POLICY "vendor_reviews_select" ON public.vendor_reviews FOR SELECT
  USING (is_visible = true);
REVOKE SELECT ON TABLE public.vendor_reviews FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'vendor_reviews'
    AND column_name = ANY (ARRAY[
      'id', 'vendor_id', 'product_id', 'rating', 'content', 'images', 'reply',
      'replied_at', 'is_visible', 'created_at', 'updated_at'
    ]);
  IF v_columns IS NULL THEN
    RAISE EXCEPTION 'vendor_reviews public columns are missing';
  END IF;
  EXECUTE format(
    'GRANT SELECT (%s) ON TABLE public.vendor_reviews TO anon, authenticated',
    v_columns
  );
END;
$$;

-- Current consumer apps mutate these resources only through authenticated
-- server APIs. Remove the direct state-machine bypass while retaining SELECT.
DROP POLICY IF EXISTS "vendors_insert_own" ON public.vendors;
DROP POLICY IF EXISTS "vendors_update_own" ON public.vendors;
DROP POLICY IF EXISTS "vendors_delete_own" ON public.vendors;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendors FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "vendor_bookings_insert" ON public.vendor_bookings;
DROP POLICY IF EXISTS "vendor_bookings_update" ON public.vendor_bookings;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_bookings FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "vendor_messages_insert" ON public.vendor_messages;
DROP POLICY IF EXISTS "vendor_messages_update" ON public.vendor_messages;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_messages FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "vendor_views_insert" ON public.vendor_views;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_views FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "vendor_reviews_insert" ON public.vendor_reviews;
DROP POLICY IF EXISTS "vendor_reviews_update_own" ON public.vendor_reviews;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_reviews FROM PUBLIC, anon, authenticated;

-- Upload paths must be owned by the authenticated user. File magic/byte quota
-- remain server API release gates; this closes arbitrary cross-user paths now.
DROP POLICY IF EXISTS "업체: 본인 이미지 업로드" ON storage.objects;
DROP POLICY IF EXISTS "업체: 사업자등록증 업로드" ON storage.objects;
CREATE POLICY "vendor images own folder insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vendor-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "vendor licenses own folder insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vendor-licenses'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Community: immutable moderation fields and distinct-reporter auto review.
-- ---------------------------------------------------------------------------
-- Match the live report path's reports -> posts lock order. Acquiring this
-- before changing post triggers avoids a migration/report-insert deadlock.
LOCK TABLE public.community_reports IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.guard_community_post_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_at := now();
      NEW.updated_at := now();
      IF NEW.author_id IS DISTINCT FROM auth.uid()
        OR COALESCE(NEW.upvote_count, 0) <> 0
        OR COALESCE(NEW.downvote_count, 0) <> 0
        OR COALESCE(NEW.comment_count, 0) <> 0
        OR COALESCE(NEW.view_count, 0) <> 0
        OR COALESCE(NEW.bookmark_count, 0) <> 0
        OR COALESCE(NEW.is_pinned, false)
        OR COALESCE(NEW.is_weekly_best, false)
        OR COALESCE(NEW.is_verified_review, false)
        OR NEW.verification_doc_url IS NOT NULL
        OR NEW.ai_comment IS NOT NULL
        OR COALESCE(NEW.under_review, false)
      THEN
        RAISE EXCEPTION 'community_server_fields_forbidden' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.author_id IS DISTINCT FROM OLD.author_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.upvote_count IS DISTINCT FROM OLD.upvote_count
        OR NEW.downvote_count IS DISTINCT FROM OLD.downvote_count
        OR NEW.comment_count IS DISTINCT FROM OLD.comment_count
        OR NEW.view_count IS DISTINCT FROM OLD.view_count
        OR NEW.bookmark_count IS DISTINCT FROM OLD.bookmark_count
        OR NEW.is_pinned IS DISTINCT FROM OLD.is_pinned
        OR NEW.is_weekly_best IS DISTINCT FROM OLD.is_weekly_best
        OR NEW.is_verified_review IS DISTINCT FROM OLD.is_verified_review
        OR NEW.verification_doc_url IS DISTINCT FROM OLD.verification_doc_url
        OR NEW.ai_comment IS DISTINCT FROM OLD.ai_comment
        OR NEW.under_review IS DISTINCT FROM OLD.under_review
      THEN
        RAISE EXCEPTION 'community_server_fields_forbidden' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_community_post_server_fields ON public.community_posts;
CREATE TRIGGER trg_guard_community_post_server_fields
  BEFORE INSERT OR UPDATE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_community_post_server_fields();
REVOKE ALL ON FUNCTION public.guard_community_post_server_fields() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_community_profile_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_at := now();
      NEW.updated_at := now();
      IF NEW.user_id IS DISTINCT FROM auth.uid()
        OR COALESCE(NEW.badge, 'member') <> 'member'
        OR COALESCE(NEW.rank, 'sprout') <> 'sprout'
        OR COALESCE(NEW.post_count, 0) <> 0
        OR COALESCE(NEW.comment_count, 0) <> 0
        OR COALESCE(NEW.total_upvotes_received, 0) <> 0
        OR COALESCE(NEW.total_xp, 0) <> 0
        OR COALESCE(NEW.level, 1) <> 1
        OR COALESCE(NEW.warning_count, 0) <> 0
        OR COALESCE(NEW.is_suspended, false)
      THEN
        RAISE EXCEPTION 'community_profile_server_fields_forbidden' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.badge IS DISTINCT FROM OLD.badge
        OR NEW.rank IS DISTINCT FROM OLD.rank
        OR NEW.post_count IS DISTINCT FROM OLD.post_count
        OR NEW.comment_count IS DISTINCT FROM OLD.comment_count
        OR NEW.total_upvotes_received IS DISTINCT FROM OLD.total_upvotes_received
        OR NEW.total_xp IS DISTINCT FROM OLD.total_xp
        OR NEW.level IS DISTINCT FROM OLD.level
        OR NEW.warning_count IS DISTINCT FROM OLD.warning_count
        OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended
      THEN
        RAISE EXCEPTION 'community_profile_server_fields_forbidden' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_community_profile_server_fields ON public.community_profiles;
CREATE TRIGGER trg_guard_community_profile_server_fields
  BEFORE INSERT OR UPDATE ON public.community_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_community_profile_server_fields();
REVOKE ALL ON FUNCTION public.guard_community_profile_server_fields() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_community_comment_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_at := now();
      NEW.updated_at := now();
      IF NEW.author_id IS DISTINCT FROM auth.uid()
        OR COALESCE(NEW.upvote_count, 0) <> 0
        OR COALESCE(NEW.is_deleted, false)
      THEN
        RAISE EXCEPTION 'community_comment_server_fields_forbidden' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.author_id IS DISTINCT FROM OLD.author_id
        OR NEW.post_id IS DISTINCT FROM OLD.post_id
        OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.upvote_count IS DISTINCT FROM OLD.upvote_count
        OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted
      THEN
        RAISE EXCEPTION 'community_comment_server_fields_forbidden' USING ERRCODE = '42501';
      END IF;
    END IF;

    IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.community_comments parent
      WHERE parent.id = NEW.parent_id
        AND parent.post_id = NEW.post_id
    ) THEN
      RAISE EXCEPTION 'community_comment_parent_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_community_comment_server_fields
  ON public.community_comments;
CREATE TRIGGER trg_guard_community_comment_server_fields
  BEFORE INSERT OR UPDATE ON public.community_comments
  FOR EACH ROW EXECUTE FUNCTION public.guard_community_comment_server_fields();
REVOKE ALL ON FUNCTION public.guard_community_comment_server_fields()
  FROM PUBLIC, anon, authenticated;

-- Keep one report per reporter/target. Existing duplicate spam is collapsed to
-- its oldest row before unique indexes are installed.
-- The early table lock blocks inserts between deduplication and index creation.
-- Supabase migrations execute transactionally; staging must verify that runner contract.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY reporter_id, post_id
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS row_number
  FROM public.community_reports
  WHERE post_id IS NOT NULL
)
DELETE FROM public.community_reports report
USING ranked
WHERE report.id = ranked.id
  AND ranked.row_number > 1;
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY reporter_id, comment_id
           ORDER BY created_at ASC NULLS LAST, id ASC
         ) AS row_number
  FROM public.community_reports
  WHERE comment_id IS NOT NULL
)
DELETE FROM public.community_reports report
USING ranked
WHERE report.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_community_report_reporter_post
  ON public.community_reports(reporter_id, post_id)
  WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_community_report_reporter_comment
  ON public.community_reports(reporter_id, comment_id)
  WHERE comment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.community_report_auto_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NEW.post_id IS NOT NULL AND NEW.status = 'pending' THEN
    -- Serialize report thresholds per post. The COUNT runs after this lock is
    -- acquired, so concurrent reporters cannot all observe a sub-threshold set.
    PERFORM 1 FROM public.community_posts
    WHERE id = NEW.post_id
    FOR UPDATE;
    SELECT COUNT(DISTINCT reporter_id) INTO v_count
    FROM public.community_reports
    WHERE post_id = NEW.post_id AND status = 'pending';
    IF v_count >= 3 THEN
      UPDATE public.community_posts SET under_review = TRUE WHERE id = NEW.post_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.community_report_auto_review() FROM PUBLIC, anon, authenticated;

-- Repair rows missed by the historical non-distinct/racy trigger. Never
-- auto-unhide an already moderated post in this migration.
UPDATE public.community_posts post
SET under_review = true
WHERE NOT COALESCE(post.under_review, false)
  AND post.id IN (
    SELECT report.post_id
    FROM public.community_reports report
    WHERE report.post_id IS NOT NULL
      AND report.status = 'pending'
    GROUP BY report.post_id
    HAVING COUNT(DISTINCT report.reporter_id) >= 3
  );

-- Reports go through the rate-limited server route; service_role inserts them.
DROP POLICY IF EXISTS "cr_insert" ON public.community_reports;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_reports FROM PUBLIC, anon, authenticated;

-- Moderated content disappears from public/member feeds but remains visible to
-- its author for status and appeal UX.
DROP POLICY IF EXISTS "cp_select_public" ON public.community_posts;
DROP POLICY IF EXISTS "cp_select_members" ON public.community_posts;
DROP POLICY IF EXISTS "cp_select_drafts" ON public.community_posts;
CREATE POLICY "cp_select_public" ON public.community_posts FOR SELECT
  USING (
    visibility = 'public'
    AND (NOT COALESCE(under_review, false) OR author_id = auth.uid())
  );
CREATE POLICY "cp_select_members" ON public.community_posts FOR SELECT
  USING (
    visibility = 'members'
    AND auth.role() = 'authenticated'
    AND (NOT COALESCE(under_review, false) OR author_id = auth.uid())
  );
CREATE POLICY "cp_select_drafts" ON public.community_posts FOR SELECT
  USING (visibility = 'draft' AND author_id = auth.uid());

DROP POLICY IF EXISTS "cc_select" ON public.community_comments;
CREATE POLICY "cc_select" ON public.community_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.community_posts post
      WHERE post.id = community_comments.post_id
        AND (
          (post.visibility = 'public')
          OR (post.visibility = 'members' AND auth.role() = 'authenticated')
        )
        AND (NOT COALESCE(post.under_review, false) OR post.author_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Dormant guestbook: no live UI/API exists, so fail closed instead of exposing
-- names, exact wedding details, anonymous writes, or reaction IP hashes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "guestbooks_select_active" ON public.guestbooks;
DROP POLICY IF EXISTS "guestbooks_insert" ON public.guestbooks;
DROP POLICY IF EXISTS "guestbooks_update" ON public.guestbooks;
DROP POLICY IF EXISTS "guestbooks_delete" ON public.guestbooks;
REVOKE ALL ON TABLE public.guestbooks FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "gb_messages_select" ON public.guestbook_messages;
DROP POLICY IF EXISTS "gb_messages_insert_anon" ON public.guestbook_messages;
DROP POLICY IF EXISTS "gb_messages_owner_update" ON public.guestbook_messages;
DROP POLICY IF EXISTS "gb_messages_owner_delete" ON public.guestbook_messages;
REVOKE ALL ON TABLE public.guestbook_messages FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "gb_reactions_select" ON public.guestbook_message_reactions;
REVOKE ALL ON TABLE public.guestbook_message_reactions FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "gb_photos_select" ON public.guestbook_photos;
DROP POLICY IF EXISTS "gb_photos_insert_owner" ON public.guestbook_photos;
DROP POLICY IF EXISTS "gb_photos_update_owner" ON public.guestbook_photos;
DROP POLICY IF EXISTS "gb_photos_delete_owner" ON public.guestbook_photos;
REVOKE ALL ON TABLE public.guestbook_photos FROM PUBLIC, anon, authenticated;

-- Closing the dormant feature also retires bearer-style public object URLs.
-- Objects are preserved for account-deletion/export handling, but no longer
-- anonymously readable; any future revival must use short-lived signed URLs.
UPDATE storage.buckets
SET public = false
WHERE id = 'guestbook-uploads';

COMMENT ON FUNCTION public.guard_vendor_server_fields() IS
  'Defense in depth: direct consumer roles cannot approve or rank vendors.';
COMMENT ON FUNCTION public.guard_community_post_server_fields() IS
  'Defense in depth: authors cannot forge moderation, verification, AI, or counter fields.';
