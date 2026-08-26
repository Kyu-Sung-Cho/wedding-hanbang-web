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
      WHEN auth.uid() IS NULL THEN
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
      ELSE
        profile.user_id = auth.uid()
        OR community_private.viewer_can_see_current_user(profile.user_id)
    END;

COMMENT ON VIEW public.community_public_profiles IS
  '커뮤니티 표시용 프로필. 로그아웃 상태에서는 공개 글·댓글의 작성자만 보인다 '
  '(2026-08-26: 그 전에는 가입만 한 사람 27/42명까지 익명 키로 열거됐다). '
  'security_invoker 가 아니므로 접근 통제는 이 뷰의 WHERE 절이 전부다.';
