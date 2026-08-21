-- 탈퇴가 영영 완료되지 않던 원인을 없앤다.
--
-- public.events 는 user_id/agency_id 를 ON DELETE SET NULL 로 참조하면서
-- 동시에 BEFORE UPDATE OR DELETE append-only 트리거를 갖는다. FK 의 SET NULL 은
-- 내부적으로 UPDATE 라서 트리거가 EVENTS_ARE_APPEND_ONLY 를 던지고
-- **부모 DELETE 트랜잭션 전체가 롤백된다.**
--
-- 실제 영향: 로그인 상태로 가격 화면을 한 번이라도 본 사용자는 탈퇴가 실패한다.
-- 워커의 auth_delete_failed 는 MANUAL_REVIEW_CODES 에 없어 수동 검토로 승격되지도
-- 않고 무한 재시도하며, 그동안 storage write fence 가 그 사용자의 업로드를 계속
-- 막는다. 탈퇴도 못 하고 서비스도 제대로 못 쓰는데 운영자에게는 신호가 뜨지 않는다.
--
-- 고치는 방향은 둘이었다
-- (apps/web/src/lib/auth/__tests__/eventsAppendOnlyDeletionDeadlock.test.ts 주석).
--   (a) 트리거가 FK 주도의 NULL UPDATE 만 통과시킨다
--   (b) 두 컬럼을 FK 로 두지 않고 삭제 워커가 명시적으로 끊는다
-- (a) 를 택한다. (b) 는 워커가 놓친 행이 개인 식별자를 계속 들고 남는데,
-- append-only 라 나중에 지울 수도 없다.
--
-- 통과 조건을 좁게 잡는다.
--   - user_id/agency_id 외의 컬럼이 하나라도 다르면 거부한다.
--   - 그 두 컬럼도 **NULL 이 되는 방향으로만** 허용한다. 다른 사용자로 바꿔
--     치기하는 UPDATE 는 여전히 막힌다.
--   - DELETE 와 TRUNCATE 는 그대로 막는다. 감사 기록의 성격을 바꾸지 않는다.
--     탈퇴 뒤에는 user_id 가 NULL 이 되어 그 행이 더 이상 개인을 가리키지
--     않으므로, 행이 남는 것 자체는 개인정보 보유 문제가 아니다.

CREATE OR REPLACE FUNCTION public.reject_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $reject_event_mutation$
DECLARE
  v_probe public.events%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- 바뀐 것이 정말 그 두 컬럼뿐인지 본다. 나머지를 OLD 값으로 되돌려 놓고
    -- 전체 행이 같으면, 다른 컬럼은 건드리지 않은 것이다.
    v_probe := NEW;
    v_probe.user_id := OLD.user_id;
    v_probe.agency_id := OLD.agency_id;

    IF v_probe IS NOT DISTINCT FROM OLD
       AND (NEW.user_id IS NULL OR NEW.user_id = OLD.user_id)
       AND (NEW.agency_id IS NULL OR NEW.agency_id = OLD.agency_id)
       AND (NEW.user_id IS DISTINCT FROM OLD.user_id
            OR NEW.agency_id IS DISTINCT FROM OLD.agency_id)
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'EVENTS_ARE_APPEND_ONLY' USING ERRCODE = '42501';
END
$reject_event_mutation$;

-- CREATE OR REPLACE 는 기존 ACL 을 보존하지만, 소유자와 권한을 원래 계약대로
-- 다시 못박는다. 이 함수는 트리거로만 실행되며 직접 호출 대상이 아니다.
ALTER FUNCTION public.reject_event_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
