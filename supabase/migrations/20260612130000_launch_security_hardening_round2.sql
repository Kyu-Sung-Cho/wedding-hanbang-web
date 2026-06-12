-- =============================================
-- 출시 전 보안 하드닝 2차 (2026-06-12) — 커플 탈취 + cohort IDOR + 초대코드 엔트로피
-- =============================================
-- 미검토 표면 감사에서 나온 critical/high. is_admin 잠금(20260612120000)과 같은 뿌리:
-- RLS 정책에 WITH CHECK·컬럼 잠금이 없어 anon 키 직접 UPDATE로 라우트 가드를 우회한다.
-- =============================================

-- ─────────────────────────────────────────────
-- 1) [CRITICAL] profiles.couple_id / role 자가변경 차단 → 커플 무단 합류·탈취
--    profiles_update_own이 WITH CHECK 없이 본인 행 전체를 열어둬,
--    anon 키로 supabase.from("profiles").update({couple_id, role})를 직접 쳐서
--    join_couple의 "이미 연동됨/짝 참" 가드를 전부 건너뛸 수 있었다.
--
--    판별: current_user IN ('authenticated','anon') 인 "직접 세션"만 되돌린다.
--    join_couple(SECURITY DEFINER, 소유자=postgres)·service_role 경로는
--    current_user가 다르므로 정상 통과 → 온보딩/연동 플로우 무중단.
-- ─────────────────────────────────────────────
create or replace function public.prevent_couple_ownership_self_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.couple_id := old.couple_id;
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_couple_ownership_self_change on public.profiles;
create trigger trg_prevent_couple_ownership_self_change
  before update on public.profiles
  for each row
  execute function public.prevent_couple_ownership_self_change();

-- ─────────────────────────────────────────────
-- 2) [CRITICAL] couples.bride_id / groom_id 자가변경 차단 → 상대 파트너 축출
--    couples_update_own도 WITH CHECK 없어, 정식 합류 후 상대 슬롯을 null로 밀어낼 수 있었다.
--    슬롯 변경은 join_couple(definer)·service_role(온보딩/리셋)만 정당하다.
-- ─────────────────────────────────────────────
create or replace function public.prevent_couple_slot_self_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.bride_id := old.bride_id;
    new.groom_id := old.groom_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_couple_slot_self_change on public.couples;
create trigger trg_prevent_couple_slot_self_change
  before update on public.couples
  for each row
  execute function public.prevent_couple_slot_self_change();

-- ─────────────────────────────────────────────
-- 3) [CRITICAL] join_couple이 호출자의 기존 커플 소속을 검사하지 않아 커플 고아화.
--    이미 커플 X에 속한 사용자가 타 커플 Y에 합류하면 X가 고아가 됨.
--    기존 소속이 있으면 거부 — 먼저 연동 해제(reset) 후 합류하도록.
-- ─────────────────────────────────────────────
create or replace function join_couple(p_invite_code text, p_role text)
returns jsonb as $$
declare
  v_couple record;
begin
  select * into v_couple from couples where invite_code = p_invite_code;
  if not found then
    return jsonb_build_object('error', '유효하지 않은 초대 코드입니다.');
  end if;

  -- 이미 다른 커플에 속해 있으면 거부 (고아화 방지)
  if exists (
    select 1 from profiles
    where id = auth.uid() and couple_id is not null and couple_id <> v_couple.id
  ) then
    return jsonb_build_object('error', '이미 다른 커플에 연동되어 있어요. 먼저 연동을 해제한 뒤 다시 시도해주세요.');
  end if;

  if p_role = 'bride' then
    if v_couple.bride_id is not null then
      return jsonb_build_object('error', '이미 신부가 연동되어 있습니다.');
    end if;
    update couples set bride_id = auth.uid(), updated_at = now() where id = v_couple.id;
  elsif p_role = 'groom' then
    if v_couple.groom_id is not null then
      return jsonb_build_object('error', '이미 신랑이 연동되어 있습니다.');
    end if;
    update couples set groom_id = auth.uid(), updated_at = now() where id = v_couple.id;
  else
    return jsonb_build_object('error', '유효하지 않은 역할입니다.');
  end if;

  update profiles
  set couple_id = v_couple.id, role = p_role, updated_at = now()
  where id = auth.uid();

  return jsonb_build_object(
    'success', true,
    'couple_id', v_couple.id,
    'invite_code', v_couple.invite_code
  );
end;
$$ language plpgsql security definer;

-- ─────────────────────────────────────────────
-- 4) [HIGH] 초대코드 엔트로피 상향: md5 6자리(2^24 ≈ 1670만) → 12자리(2^48).
--    빈 슬롯 커플에 무작위 코드 brute force 합류를 어렵게 한다.
-- ─────────────────────────────────────────────
create or replace function generate_invite_code()
returns text as $$
declare
  code text;
  code_exists boolean;
begin
  loop
    code := 'WH-' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12));
    select exists(select 1 from couples where invite_code = code) into code_exists;
    exit when not code_exists;
  end loop;
  return code;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────
-- 5) [HIGH] community_assign_cohort EXECUTE 회수 → 타인 강제 동기방 배정(IDOR) 차단.
--    이 RPC는 p_user_id를 파라미터로 받아 auth.uid() 강제가 안 되는데 PUBLIC EXECUTE라,
--    authenticated가 PostgREST로 직접 호출해 피해자를 임의 방에 넣고
--    community_profiles.wedding_year/month를 덮어쓸 수 있었다.
--    (형제 RPC create_booking_atomic은 이미 회수됨 — 이 함수만 누락)
--    ※ auto-assign 라우트는 service client 호출로 전환됨(같은 커밋).
-- ─────────────────────────────────────────────
revoke all on function public.community_assign_cohort(uuid, int, int) from public;
revoke all on function public.community_assign_cohort(uuid, int, int) from anon;
revoke all on function public.community_assign_cohort(uuid, int, int) from authenticated;
grant execute on function public.community_assign_cohort(uuid, int, int) to service_role;

-- =============================================
-- 검증 (수동, 적용 후):
--   -- 1·2) authenticated 세션(anon 키)으로 본인 couple_id 변경 시도 → 변동 없어야 함
--   update profiles set couple_id = '<타 커플>' where id = auth.uid();  -- 무시됨
--   -- 5) authenticated로 RPC 직접 호출 → permission denied 여야 함
--   select community_assign_cohort('<남의 uuid>', 2026, 6);  -- ERROR: permission denied
-- =============================================
