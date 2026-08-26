-- 로그아웃하면 커뮤니티 회원 명부가 통째로 열렸다.
--
-- ## 무엇이 있었나 (2026-08-26 운영 실측, 읽기전용)
--
-- `community_public_profiles` 는 `security_invoker` 가 아니라 소유자(postgres) 권한으로
-- 돌기 때문에 밑에 있는 `community_profiles` 의 RLS 를 타지 않는다. 접근 통제는
-- 뷰의 WHERE 절 하나뿐이었고, 그 첫 항이 이랬다:
--
--     auth.uid() IS NULL OR user_id = auth.uid() OR viewer_can_see_current_user(user_id)
--
-- 로그아웃 상태에서는 `auth.uid() IS NULL` 이 참이라 **뒤를 보지 않고 전부 통과**한다.
-- 공개 anon 키(브라우저 번들에 들어 있다)로 잰 값:
--
--     GET /rest/v1/community_public_profiles?select=user_id,nickname
--       → HTTP 200, content-range: 0-41/42
--
--     프로필 42명 중 글도 댓글도 쓴 적 없는 사람 27명 (64%)
--
-- 즉 가입만 하고 아무것도 공개하지 않은 사람의 닉네임·아바타·user_id 가
-- 누구에게나 열려 있었다. 가입자가 늘수록 그대로 늘어난다.
--
-- ## 무엇을 바꾸고 무엇을 안 바꿨나
--
-- **로그인한 사람의 경로는 한 글자도 건드리지 않는다.** 차단 관계를 보는
-- `viewer_can_see_current_user` 는 그대로다. 바꾼 것은 로그아웃 갈래 하나다:
--
--     로그아웃이면 → 공개 글의 작성자이거나, 공개 글에 달린 댓글의 작성자일 때만
--
-- 삭제된 댓글도 세는 이유는 그 자리에 남는 표시(툼스톤)를 익명도 보기 때문이다.
-- 그 사람은 한때 공개적으로 썼다.
--
-- 좁히기 전후를 운영에서 미리 재 봤다:
--
--     지금       익명에게 42명
--     좁힌 뒤    익명에게 15명   ← 오늘 anon 이 실제로 보는 글·댓글의 작성자 전원
--     가려지는 수 27명
--
-- 15 는 우연이 아니라 **현재 작성자 집합과 정확히 같은 수**다. 그래서 지금 화면에
-- 이름이 나오던 자리는 하나도 비지 않는다.
--
-- ## uid 가 없다고 다 익명이 아니다
--
-- 처음엔 `WHEN auth.uid() IS NULL THEN <좁힌 조건>` 으로 썼다. 그런데 **서버가
-- 서비스 롤로 부를 때도 uid 는 NULL** 이라, 적용 직후 운영에서 재 보니:
--
--     service_role = 15   (원래 42)
--     anon         = 15
--
-- `community/cohort`, `community/profiles/[userId]`, `community/blocks`,
-- `lib/community/authorProfiles`, `lib/community/publicPostDetail` 이 전부
-- `createAdminClient()` 로 이 뷰를 읽는다. 글을 쓴 적 없는 사람의 이름이
-- **로그인한 사람의 화면에서도** 조용히 비었을 것이다.
--
-- 그래서 좁히는 대상을 웹에서 오는 역할(`anon`·`authenticated`)로 못박았다.
-- PostgREST 는 JWT 의 role 로 세션 역할을 바꾸므로 뷰 안에서 `current_user` 가
-- 그 역할이다(운영에서 `current_user in view=service_role` 로 확인).
--
-- ## 동기방은 원래 익명에게 닫혀 있다
--
-- 이 뷰의 호출자 중 절반은 동기방(멤버 목록·메시지·타임라인)이다. 좁히면 그쪽이
-- 깨질까 봐 먼저 쟀는데, 익명은 `cohort_members` 에서 이미 막힌다:
--
--     GET /rest/v1/cohort_members → HTTP 401 (42501 permission denied)
--
-- 익명은 멤버 id 를 얻을 수 없으므로 이 뷰로 이름을 되찾을 일도 없다.

CREATE OR REPLACE VIEW public.community_public_profiles
WITH (security_barrier = true) AS
  SELECT
    profile.user_id,
    profile.nickname,
    profile.avatar_url,
    profile.badge,
    profile.rank
  FROM public.community_profiles profile
  WHERE public.community_runtime_mode() <> 'disabled'::text
    AND COALESCE(profile.is_suspended, false) = false
    AND CASE
      -- 로그인한 사람이 먼저다. 이 갈래는 예전 그대로 — 차단 관계를 그대로 본다.
      WHEN auth.uid() IS NOT NULL THEN
        profile.user_id = auth.uid()
        OR community_private.viewer_can_see_current_user(profile.user_id)
      -- **`auth.uid() IS NULL` 을 곧 "익명" 으로 읽으면 안 된다.** 서버가 서비스
      -- 롤로 부를 때도 uid 는 NULL 이다. 처음에 그렇게 썼다가 운영에서 재 보니
      -- `service_role=15` 로 떨어져 있었다(원래 42). 동기방 멤버 목록·프로필
      -- 페이지·차단 목록이 `createAdminClient()` 로 이 뷰를 읽기 때문에, 글을 쓴 적
      -- 없는 사람의 이름이 로그인 화면에서도 조용히 비었을 것이다.
      --
      -- 그래서 좁히는 대상을 **웹에서 오는 역할**로 못박는다. PostgREST 는 JWT 의
      -- role 로 세션 역할을 바꾸므로 뷰 안에서 `current_user` 가 그 역할이다.
      WHEN current_user IN ('anon', 'authenticated') THEN
        EXISTS (
          SELECT 1
          FROM public.community_posts p
          WHERE p.author_id = profile.user_id
            AND p.visibility = 'public'
        )
        OR EXISTS (
          SELECT 1
          FROM public.community_comments c
          JOIN public.community_posts p ON p.id = c.post_id
          WHERE c.author_id = profile.user_id
            AND p.visibility = 'public'
        )
      -- 서버 내부 경로(service_role·postgres). 예전과 똑같이 전부 본다 — 여기서
      -- 좁히면 로그인 사용자가 보는 화면이 깨진다.
      ELSE TRUE
    END;

COMMENT ON VIEW public.community_public_profiles IS
  '커뮤니티 표시용 프로필. 로그아웃 상태에서는 공개 글·댓글의 작성자만 보인다 '
  '(2026-08-26: 그 전에는 가입만 한 사람 27/42명까지 익명 키로 열거됐다). '
  'security_invoker 가 아니므로 접근 통제는 이 뷰의 WHERE 절이 전부다.';
