-- 로컬 companion 후보: 직접 service DML의 예약값 변경만 거절한다.
-- INVOKER 신원은 거절 조건이지 승인의 근거가 아니다. 기존 owner SDF의
-- actor/claim/roster 검사를 대체하거나 postgres/admin의 임의 변경을 보호하지 않는다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.guard_amora_reserved_journey_direct_dml_retirement_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
BEGIN
  IF CURRENT_USER = 'service_role' AND (
    (TG_OP = 'INSERT'
      AND coalesce(NEW.progress,'{}'::jsonb) ? '__amora_actions'
      AND (NEW.progress -> '__amora_actions') IS DISTINCT FROM '[]'::jsonb)
    OR (TG_OP = 'UPDATE' AND (
      (coalesce(NEW.progress,'{}'::jsonb) ? '__amora_actions') IS DISTINCT FROM
        (coalesce(OLD.progress,'{}'::jsonb) ? '__amora_actions')
      OR (coalesce(NEW.progress,'{}'::jsonb) -> '__amora_actions') IS DISTINCT FROM
        (coalesce(OLD.progress,'{}'::jsonb) -> '__amora_actions')
    ))
  ) THEN
    RAISE EXCEPTION 'AMORA_ACTION_DIRECT_JOURNEY_WRITER_RETIRED' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.guard_amora_reserved_journey_direct_dml_retirement_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_amora_reserved_journey_direct_dml_retirement_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_amora_reserved_journey_direct_dml_retirement_v1
BEFORE INSERT OR UPDATE ON public.wedding_journeys
FOR EACH ROW EXECUTE FUNCTION public.guard_amora_reserved_journey_direct_dml_retirement_v1();

COMMIT;
