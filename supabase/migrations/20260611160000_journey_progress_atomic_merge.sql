-- wedding_journeys.progress 원자적 부분 병합 RPC
--
-- 문제(감사 확정 critical): 기존 toolExecutor 는 요청 시작 시점의 progress 스냅샷을
--   읽어 변경 후 통째로 덮어썼다(.update({ progress: 전체 })). 커플 2인(또는 동시
--   도구 호출)이 서로 다른 키(예: A=예산, B=일정)를 수정하면 나중 쓰기가 앞 쓰기를
--   클로버해 lost update(데이터 유실)가 발생.
--
-- 해결: 변경된 "최상위 키"만 patch 로 받아 DB 안에서 원자적으로 병합한다.
--   UPDATE 한 문장이 row lock 을 잡고 현재 progress 를 읽어 병합하므로,
--   서로 다른 키를 동시에 수정해도 유실되지 않는다.
--   remove_keys 로 카테고리 삭제/초기화도 같은 호출로 처리.
--
-- 한계: __events / __amora_actions 같은 "배열 값 최상위 키"는 patch 가 배열 전체를
--   교체하므로, 같은 배열 키에 대한 동시 수정의 좁은 경합은 남는다. 이는 일정/액션을
--   별도 정규 테이블로 분리하는 후속 단계에서 해소한다.

create or replace function apply_journey_progress_patch(
  p_couple_id uuid,
  p_patch jsonb default '{}'::jsonb,
  p_remove_keys text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_progress jsonb;
begin
  update wedding_journeys
     set progress = (coalesce(progress, '{}'::jsonb) - p_remove_keys) || coalesce(p_patch, '{}'::jsonb),
         updated_at = now()
   where couple_id = p_couple_id
   returning progress into v_progress;

  if v_progress is null then
    raise exception 'wedding_journeys row not found for couple_id=%', p_couple_id
      using errcode = 'no_data_found';
  end if;

  return v_progress;
end;
$$;

-- 서비스 롤 전용: toolExecutor 는 service role 로 호출한다(상위 chat 라우트에서 couple
-- 소유권을 이미 검증). 클라이언트가 임의 couple_id 로 직접 호출하는 IDOR 을 막기 위해
-- anon/authenticated 권한은 회수한다.
revoke all on function apply_journey_progress_patch(uuid, jsonb, text[]) from public;
revoke all on function apply_journey_progress_patch(uuid, jsonb, text[]) from anon;
revoke all on function apply_journey_progress_patch(uuid, jsonb, text[]) from authenticated;
grant execute on function apply_journey_progress_patch(uuid, jsonb, text[]) to service_role;
