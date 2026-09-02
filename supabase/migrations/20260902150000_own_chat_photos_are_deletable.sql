-- 자기가 올린 채팅 사진은 탈퇴 때 지워진다
--
-- ## 무엇이 막고 있었나
--
-- 아모라 채팅에 사진을 **한 번이라도** 올린 계정은 탈퇴가 자동으로 끝나지
-- 않았다. 인벤토리가 chat-image 항목을 무조건 `quarantine` 으로 만들고,
-- `replace_account_deletion_media_manifest` 가 `quarantine_count > 0` 이면
-- 그 자리에서 `manual_review` 로 못박는다. 그리고 그것을 푸는
-- `resume_account_deletion_after_manual_review` 는 **앱에서 부르는 곳이 0건**이다.
--
-- 즉 사용자는 계정이 멀쩡히 살아 있는 채로 업로드만 조용히 막힌 상태에 갇힌다.
--
-- ## 왜 격리였나, 그리고 왜 이제 풀 수 있나
--
-- `docs/operations/ACCOUNT_DELETION_STORAGE_SAGA.md` 가 이유를 적어 두었다 —
-- 소유 증명이 없어서가 아니라 **정책이 미승인**이었기 때문이다. 그런데 그
-- 문서보다 나중에 만든 사용자 약속이 이미 반대로 말한다:
--
--     packages/shared/src/constants/accountDeletionPolicy.ts (2026-08-25)
--     "계정과 로그인 정보, 프로필, 내가 올린 사진·첨부 파일은 삭제돼요."
--
-- 둘 중 하나는 거짓이었다. 파운더가 탈퇴를 제대로 끝내고 열기로 결정했으므로
-- (2026-09-02) 화면이 약속한 쪽으로 맞춘다.
--
-- ## 소유는 경로가 아니라 DB 행이 증명한다
--
-- 경로만으로는 증명할 수 없다. Storage RLS(20260611100000)는 경로의 **첫 칸
-- (커플)만** 검사하므로 두 번째 칸은 배우자도 쓸 수 있다. 경로를 믿으면 남의
-- 파일을 지운다.
--
-- 그래서 커뮤니티 미디어가 `community_upload_sessions` 로 증명하는 것과 같은
-- 형태를 쓴다 — `chat_messages.sender_id` 가 그 사람이고 그 행의
-- `metadata->'imagePaths'` 가 그 경로를 담고 있을 때만 `chat_message` 로
-- 인정한다. **증명이 없으면 예전 그대로 `quarantine`** 이고 manual_review 로 간다.
--
-- 기존 값·기존 갈래·기존 예외는 하나도 지우지 않는다. 갈래를 하나 더 열 뿐이다.

-- 1) 새 source 값을 허용한다.
ALTER TABLE public.account_deletion_media_manifest
  DROP CONSTRAINT IF EXISTS account_deletion_media_source;
ALTER TABLE public.account_deletion_media_manifest
  ADD CONSTRAINT account_deletion_media_source
  CHECK (source IN ('session_staging', 'session_final', 'legacy_prefix', 'quarantine', 'chat_message'));

-- 2) chat-image 버킷은 quarantine 또는 chat_message 만 가질 수 있다.
ALTER TABLE public.account_deletion_media_manifest
  DROP CONSTRAINT IF EXISTS account_deletion_media_chat_quarantine_only;
ALTER TABLE public.account_deletion_media_manifest
  ADD CONSTRAINT account_deletion_media_chat_quarantine_only
  CHECK (bucket <> 'chat-image' OR source IN ('quarantine', 'chat_message'));

-- 3) 거꾸로도 막는다 — `chat_message` 는 chat-image 버킷에서만 쓸 수 있다.
--    이게 없으면 커뮤니티 객체를 chat_message 로 주장해 증명 검사를 우회할 수 있다.
ALTER TABLE public.account_deletion_media_manifest
  DROP CONSTRAINT IF EXISTS account_deletion_media_chat_message_bucket_only;
ALTER TABLE public.account_deletion_media_manifest
  ADD CONSTRAINT account_deletion_media_chat_message_bucket_only
  CHECK (source <> 'chat_message' OR bucket = 'chat-image');

/**
 * 이 경로가 **그 사람이 올린 채팅 사진**인가.
 *
 * 서버가 쓴 `chat_messages` 행으로만 판정한다. 경로는 근거가 아니다 —
 * Storage RLS 가 두 번째 칸을 검사하지 않으므로 배우자도 거기 쓸 수 있다.
 *
 * **모르면 거짓이다.** 증명이 없으면 격리로 남고 사람이 본다. 잘못 참을
 * 돌려주면 남의 사진을 지운다 — 되돌릴 수 없다.
 */
CREATE OR REPLACE FUNCTION public.chat_photo_belongs_to_user(
  p_user_id uuid,
  p_path text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_messages m
    WHERE m.sender_id = p_user_id
      AND m.couple_id::text = split_part(p_path, '/', 1)
      AND jsonb_typeof(COALESCE(m.metadata -> 'imagePaths', 'null'::jsonb)) = 'array'
      AND (m.metadata -> 'imagePaths') ? p_path
  );
$$;

REVOKE ALL ON FUNCTION public.chat_photo_belongs_to_user(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_photo_belongs_to_user(uuid, text) TO service_role;

COMMENT ON FUNCTION public.chat_photo_belongs_to_user(uuid, text) IS
  '탈퇴 시 채팅 사진의 소유 증명. 경로가 아니라 chat_messages 행으로 판정한다 — Storage RLS 는 경로의 첫 칸만 보므로 두 번째 칸은 배우자도 쓸 수 있다. 증명이 없으면 격리로 남는다.';

-- 4) 매니페스트 검증기가 그 증명을 **직접 확인**하게 한다.
--
--    앱이 `chat_message` 라고 주장하는 것만으로는 부족하다. 앱이 뚫리거나 잘못
--    짜이면 남의 사진이 삭제 대상이 된다. 그래서 DB 가 같은 트랜잭션에서
--    `chat_photo_belongs_to_user` 로 다시 본다.
--
--    아래 본문은 **운영에 배포된 정의를 그대로 떠서 chat 갈래 한 곳만** 치환한
--    것이다. 손으로 옮겨 적으면 다른 검증이 조용히 바뀔 수 있다.

CREATE OR REPLACE FUNCTION public.replace_account_deletion_media_manifest(p_job_id uuid, p_claim_token uuid, p_manifest jsonb)
 RETURNS SETOF account_deletion_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
  v_item jsonb;
  v_bucket text;
  v_path text;
  v_source text;
  v_not_before timestamptz;
  v_session public.community_upload_sessions%ROWTYPE;
  v_quarantine_count integer;
  v_ready_after timestamptz;
BEGIN
  SELECT * INTO v_job
    FROM public.account_deletion_jobs
   WHERE id = p_job_id
     AND status = 'inventorying'
     AND claim_token = p_claim_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF p_manifest IS NULL
     OR jsonb_typeof(p_manifest) <> 'array'
     OR jsonb_array_length(p_manifest) > 10000 THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_INVALID' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.account_deletion_media_manifest WHERE job_id = p_job_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_manifest)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR (v_item - 'bucket' - 'path' - 'source' - 'not_before') <> '{}'::jsonb THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_INVALID' USING ERRCODE = '22023';
    END IF;
    v_bucket := v_item->>'bucket';
    v_path := v_item->>'path';
    v_source := v_item->>'source';
    BEGIN
      v_not_before := (v_item->>'not_before')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_INVALID' USING ERRCODE = '22023';
    END;

    IF v_bucket NOT IN (
         'community-media-staging', 'community-images', 'community-videos',
         'chat-image'
       )
       OR v_path IS NULL
       OR char_length(v_path) NOT BETWEEN 38 AND 512
       OR (
         v_bucket = 'chat-image'
         AND v_path !~ (
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
           || v_job.user_id::text
           || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpeg|jpg|png|gif|webp)$'
         )
         -- 옛 2단 경로(`<커플>/<파일>`)도 받는다.
         --
         -- 2026-09-02 운영 실측: chat-image 객체 6개가 전부 2단이고 그중
         -- **5개는 살아 있는 대화에 지금 보이고 있다.** 3단만 받으면 이 사진들은
         -- 인벤토리에도 매니페스트에도 못 들어가서, 주인이 탈퇴해도 **그대로
         -- 남는데 우리는 "지웠다"고 말하게 된다.**
         --
         -- 2단에는 경로에 사용자가 없다. 그래서 여기서 소유를 판정하지 않고
         -- **아래 `chat_photo_belongs_to_user` 에 전적으로 맡긴다** — 그 판정은
         -- 원래도 경로가 아니라 `chat_messages` 행으로 한다(RLS 가 경로의 첫 칸만
         -- 보므로 경로는 처음부터 근거가 아니었다). 증명이 없으면 격리로 남는다.
         AND v_path !~ (
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
           || '[^/]+\.(jpeg|jpg|png|gif|webp)$'
         )
       )
       OR (
         v_bucket <> 'chat-image'
         AND (
           v_path !~ ('^' || v_job.user_id::text || '/[^/\\[:cntrl:]]+$')
           OR split_part(v_path, '/', 2) IN ('.', '..')
         )
       ) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_PATH_INVALID' USING ERRCODE = '22023';
    END IF;

    IF v_bucket = 'chat-image' THEN
      IF v_source = 'chat_message' THEN
        IF NOT public.chat_photo_belongs_to_user(v_job.user_id, v_path) THEN
          RAISE EXCEPTION 'ACCOUNT_DELETION_CHAT_PROOF_INVALID' USING ERRCODE = '23514';
        END IF;
      ELSIF v_source <> 'quarantine' THEN
        RAISE EXCEPTION 'ACCOUNT_DELETION_CHAT_PROOF_INVALID' USING ERRCODE = '23514';
      END IF;
    ELSIF v_source IN ('session_staging', 'session_final') THEN
      SELECT * INTO v_session
        FROM public.community_upload_sessions
       WHERE user_id = v_job.user_id
         AND (
           (v_source = 'session_staging'
             AND v_bucket = 'community-media-staging'
             AND staging_path = v_path)
           OR
           (v_source = 'session_final'
             AND final_bucket = v_bucket
             AND final_path = v_path)
         );
      IF NOT FOUND OR v_not_before < v_session.expires_at + interval '5 minutes' THEN
        RAISE EXCEPTION 'ACCOUNT_DELETION_SESSION_PROOF_INVALID' USING ERRCODE = '23514';
      END IF;
    ELSIF v_source = 'legacy_prefix' THEN
      IF NOT (
        (
          v_bucket = 'community-images'
          AND v_path ~* ('^' || v_job.user_id::text || '/[0-9]{13}_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$')
        )
        OR (
          v_bucket = 'community-videos'
          AND v_path ~* ('^' || v_job.user_id::text || '/[0-9]{13}_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp4|mov|webm)$')
        )
      ) THEN
        RAISE EXCEPTION 'ACCOUNT_DELETION_LEGACY_PROOF_INVALID' USING ERRCODE = '23514';
      END IF;
    ELSIF v_source <> 'quarantine' THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_SOURCE_INVALID' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.account_deletion_media_manifest(
      job_id, bucket, path, source, not_before
    ) VALUES (p_job_id, v_bucket, v_path, v_source, v_not_before);
  END LOOP;

  SELECT count(*) FILTER (WHERE source = 'quarantine'),
         coalesce(max(not_before) FILTER (WHERE source <> 'quarantine'), clock_timestamp())
    INTO v_quarantine_count, v_ready_after
    FROM public.account_deletion_media_manifest
   WHERE job_id = p_job_id;

  UPDATE public.account_deletion_jobs
     SET status = CASE WHEN v_quarantine_count > 0
                       THEN 'manual_review' ELSE 'inventory_ready' END,
         quarantine_count = v_quarantine_count,
         ready_after = v_ready_after,
         claim_token = NULL,
         claimed_at = NULL,
         last_error_code = CASE WHEN v_quarantine_count > 0
                                THEN 'unproven_legacy_media' ELSE NULL END,
         updated_at = clock_timestamp()
   WHERE id = p_job_id
   RETURNING * INTO v_job;
  RETURN NEXT v_job;
END;
$function$;

