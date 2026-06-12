-- =============================================
-- is_admin 자기 권한 상승(self-escalation) 차단 (2026-06-12)
-- =============================================
-- CRITICAL: profiles_update_own 정책이 USING (auth.uid()=id)만 있고 WITH CHECK가
--   없어, 로그인한 아무 유저나 anon 키로 브라우저에서
--     supabase.from("profiles").update({ is_admin: true }).eq("id", <본인 uid>)
--   를 실행해 스스로 어드민이 될 수 있었다. 그러면 verifyAdmin이 통과시켜
--   모든 어드민 API(고객 PII·예약 연락처 등)가 열린다.
--
-- 해결: BEFORE UPDATE 트리거로 is_admin 컬럼을 잠근다.
--   - service_role 세션(서버 admin 클라이언트)은 자유롭게 변경 가능.
--   - 그 외(anon/authenticated) 세션은 is_admin 값을 바꾸려 하면 OLD 값으로 강제 복원.
--   정책 WITH CHECK 방식보다 트리거가 안전 — 향후 정책이 교체돼도 컬럼 잠금은 유지.
-- =============================================

create or replace function public.prevent_is_admin_self_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role 만 is_admin 을 바꿀 수 있다. 그 외 역할은 변경 시도를 무시(이전 값 유지).
  if new.is_admin is distinct from old.is_admin
     and current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and current_user is distinct from 'service_role' then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_is_admin_self_change on public.profiles;
create trigger trg_prevent_is_admin_self_change
  before update on public.profiles
  for each row
  execute function public.prevent_is_admin_self_change();

-- =============================================
-- 검증 (수동):
--   -- authenticated 세션(anon 키)으로 본인 행 is_admin=true 시도 → 여전히 false 여야 함
--   update profiles set is_admin = true where id = auth.uid();
--   select is_admin from profiles where id = auth.uid();  -- → false
--
--   -- 기존에 이미 부정 승격된 계정이 있는지 점검 (실제 어드민만 남겨야 함)
--   select id, email, is_admin from profiles where is_admin = true;
-- =============================================
