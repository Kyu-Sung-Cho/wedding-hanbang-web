-- 가입 프로필 이름을 명시적 동의 없이 커뮤니티 닉네임으로 복사하던
-- 과거 기본값을 가명으로 교체한다. 사용자가 별도로 정한 닉네임은 유지한다.
UPDATE public.community_profiles AS community_profile
SET nickname = '웨딩친구-' || substr(md5(community_profile.user_id::text), 1, 12),
    updated_at = now()
FROM public.profiles AS account_profile
WHERE account_profile.id = community_profile.user_id
  AND nullif(btrim(account_profile.name), '') IS NOT NULL
  AND lower(regexp_replace(btrim(community_profile.nickname), '\s+', '', 'g')) =
      lower(regexp_replace(btrim(account_profile.name), '\s+', '', 'g'));
