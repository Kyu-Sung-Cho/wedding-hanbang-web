-- Public community reads are text-only. Legacy price, media, cohort and AI
-- columns stay available only to controlled service-role maintenance. Remove
-- Postgres Changes for this table because it emits row payloads outside the
-- explicit API DTO boundary.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $revoke_browser_columns$
DECLARE
  all_columns text;
BEGIN
  SELECT pg_catalog.string_agg(
    pg_catalog.quote_ident(attribute_row.attname),
    ', ' ORDER BY attribute_row.attnum
  )
  INTO all_columns
  FROM pg_catalog.pg_attribute AS attribute_row
  WHERE attribute_row.attrelid = 'public.community_posts'::pg_catalog.regclass
    AND attribute_row.attnum > 0
    AND NOT attribute_row.attisdropped;

  IF all_columns IS NOT NULL THEN
    EXECUTE pg_catalog.format(
      'REVOKE SELECT (%s), INSERT (%s), UPDATE (%s) ON TABLE public.community_posts FROM PUBLIC, anon, authenticated',
      all_columns,
      all_columns,
      all_columns
    );
  END IF;
END;
$revoke_browser_columns$;

REVOKE SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.community_posts
  FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id,
  author_id,
  category,
  title,
  content,
  visibility,
  ad_disclosure,
  sponsorship_detail,
  is_resolved,
  under_review,
  upvote_count,
  downvote_count,
  comment_count,
  view_count,
  bookmark_count,
  is_pinned,
  is_weekly_best,
  tags,
  created_at,
  updated_at
) ON TABLE public.community_posts TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.community_posts
  TO service_role;

DO $remove_postgres_changes$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'community_posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.community_posts;
  END IF;
END;
$remove_postgres_changes$;

CREATE OR REPLACE FUNCTION public.block_retired_community_structured_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.price_data IS NOT NULL
       OR NEW.cost_data IS NOT NULL
       OR NEW.ai_comment IS NOT NULL
       OR NEW.cohort_room_id IS NOT NULL
       OR NEW.rating IS NOT NULL
       OR COALESCE(NEW.is_quick_review, FALSE)
       OR COALESCE(NEW.is_verified_review, FALSE)
       OR NEW.verification_doc_url IS NOT NULL
       OR COALESCE(pg_catalog.array_length(NEW.vendor_tags, 1), 0) > 0 THEN
      RAISE EXCEPTION 'community_structured_fields_retired'
        USING ERRCODE = '55000';
    END IF;

    IF COALESCE(NEW.content, '') ~* '<[[:space:]]*a([[:space:]]|>)' THEN
      RAISE EXCEPTION 'community_rich_links_retired'
        USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
  END IF;

  IF (NEW.price_data IS DISTINCT FROM OLD.price_data AND NEW.price_data IS NOT NULL)
     OR (NEW.cost_data IS DISTINCT FROM OLD.cost_data AND NEW.cost_data IS NOT NULL)
     OR (NEW.ai_comment IS DISTINCT FROM OLD.ai_comment AND NEW.ai_comment IS NOT NULL)
     OR (NEW.cohort_room_id IS DISTINCT FROM OLD.cohort_room_id AND NEW.cohort_room_id IS NOT NULL)
     OR (NEW.rating IS DISTINCT FROM OLD.rating AND NEW.rating IS NOT NULL)
     OR (NEW.is_quick_review IS DISTINCT FROM OLD.is_quick_review AND COALESCE(NEW.is_quick_review, FALSE))
     OR (NEW.is_verified_review IS DISTINCT FROM OLD.is_verified_review AND COALESCE(NEW.is_verified_review, FALSE))
     OR (NEW.verification_doc_url IS DISTINCT FROM OLD.verification_doc_url AND NEW.verification_doc_url IS NOT NULL)
     OR (
       NEW.vendor_tags IS DISTINCT FROM OLD.vendor_tags
       AND COALESCE(pg_catalog.array_length(NEW.vendor_tags, 1), 0) > 0
     ) THEN
    RAISE EXCEPTION 'community_structured_fields_retired'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.content IS DISTINCT FROM OLD.content
     AND COALESCE(NEW.content, '') ~* '<[[:space:]]*a([[:space:]]|>)' THEN
    RAISE EXCEPTION 'community_rich_links_retired'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.block_retired_community_structured_fields()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.block_retired_community_structured_fields()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_retired_community_structured_fields()
  TO service_role;

DROP TRIGGER IF EXISTS block_retired_community_structured_fields
  ON public.community_posts;
CREATE TRIGGER block_retired_community_structured_fields
  BEFORE INSERT OR UPDATE ON public.community_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.block_retired_community_structured_fields();

DO $assert_community_boundary$
DECLARE
  forbidden_column text;
  browser_role text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'community_posts'
  ) THEN
    RAISE EXCEPTION 'community_posts remains in supabase_realtime';
  END IF;

  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF pg_catalog.has_table_privilege(browser_role, 'public.community_posts', 'INSERT')
       OR pg_catalog.has_table_privilege(browser_role, 'public.community_posts', 'UPDATE')
       OR pg_catalog.has_table_privilege(browser_role, 'public.community_posts', 'DELETE') THEN
      RAISE EXCEPTION '% still has community_posts mutation privilege', browser_role;
    END IF;

    FOREACH forbidden_column IN ARRAY ARRAY[
      'images',
      'slides',
      'price_data',
      'cost_data',
      'ai_comment',
      'cohort_room_id',
      'vendor_tags',
      'rating',
      'is_quick_review',
      'is_verified_review',
      'verification_doc_url',
      'search_vector'
    ]
    LOOP
      IF pg_catalog.has_column_privilege(
        browser_role,
        'public.community_posts',
        forbidden_column,
        'SELECT'
      ) THEN
        RAISE EXCEPTION '% can still select community_posts.%', browser_role, forbidden_column;
      END IF;
    END LOOP;
  END LOOP;
END;
$assert_community_boundary$;

COMMENT ON FUNCTION public.block_retired_community_structured_fields() IS
  'Prevents new legacy price, media-linkage, cohort, AI, verification, quick-review and clickable-link content while permitting controlled cleanup of historical rows.';

COMMIT;
