BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 이 영수증은 탈퇴 전 개인 레인 정리만 증명한다. 운영 로그/백업/보존 사유의
-- 검토 완료나 전체 개인정보 익명화를 뜻하지 않는다. 사용자 ID를 추가 보존하지 않는다.
ALTER TABLE public.account_deletion_jobs
  ADD COLUMN data_prepared_at timestamptz,
  ADD COLUMN data_prepared_version integer,
  ADD CONSTRAINT account_deletion_data_receipt_pair CHECK (
    (data_prepared_at IS NULL AND data_prepared_version IS NULL)
    OR (data_prepared_at IS NOT NULL AND data_prepared_version IS NOT DISTINCT FROM 1)
  );

CREATE TABLE public.account_deletion_private_scopes (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  visibility text NOT NULL CHECK (visibility IN ('bride_private','groom_private')),
  job_id uuid NOT NULL REFERENCES public.account_deletion_jobs(id) ON DELETE RESTRICT,
  retired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (couple_id, visibility)
);
ALTER TABLE public.account_deletion_private_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_private_scopes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_private_scopes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.account_deletion_private_scopes TO service_role;

-- lifecycle/mediation 키는 사용자 UUID를 포함하지 않는다. claim 삭제 뒤에도
-- 같은 요청의 늦은 tool-result 쓰기를 거절할 수 있도록 키의 SHA256만 남긴다.
CREATE TABLE public.account_deletion_retired_requests (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  job_id uuid NOT NULL REFERENCES public.account_deletion_jobs(id) ON DELETE RESTRICT,
  PRIMARY KEY(couple_id,request_digest)
);
ALTER TABLE public.account_deletion_retired_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_retired_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_retired_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.account_deletion_retired_requests TO service_role;

-- 사용자별 쓰기와 정리는 같은 잠금을 쓴다. 기존 chat finalizer는 claim을 먼저
-- 잠그므로 writer는 대기하지 않고 실패한다. job -> claim 순서와 교착하지 않는다.
CREATE FUNCTION public.guard_account_deletion_customer_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_actor uuid; v_couple uuid; v_visibility text; v_row jsonb := pg_catalog.to_jsonb(NEW);
  v_key text; v_current_owner uuid;
BEGIN
  v_couple := (v_row->>'couple_id')::uuid;
  v_visibility := v_row->>'visibility';
  -- Queue claim/retry/terminal bookkeeping has no new customer payload. Let it
  -- finish so one deleting account cannot abort the global recovery batch.
  IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('amora_memory_jobs','amora_memory_enqueue_repair_candidates')
     AND (v_row->'couple_id') IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)->'couple_id')
     AND (v_row->'visibility') IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)->'visibility')
     AND (v_row->'user_id') IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)->'user_id')
     AND (v_row->'to_message_id') IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)->'to_message_id')
     AND (v_row->'request_key') IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD)->'request_key') THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'amora_tool_executions' THEN
    v_key := NEW.request_key;
    IF EXISTS (SELECT 1 FROM public.account_deletion_retired_requests
      WHERE couple_id=v_couple AND request_digest=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_key,'UTF8')),'hex')) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_REQUEST_RETIRED' USING ERRCODE='55000';
    END IF;
    SELECT user_id,visibility INTO v_actor,v_visibility FROM public.amora_chat_request_claims
      WHERE couple_id=v_couple AND request_key=v_key;
    IF NOT FOUND AND v_key ~ '^(chat|greeting):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(:|$)' THEN
      v_actor := pg_catalog.split_part(v_key, ':', 2)::uuid;
    END IF;
    IF v_actor IS NULL AND EXISTS (SELECT 1 FROM public.account_deletion_jobs AS job
      JOIN public.profiles AS profile ON profile.id=job.user_id
      WHERE profile.couple_id=v_couple AND job.status<>'completed') THEN
      RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_WRITE_SCOPE_UNKNOWN' USING ERRCODE='55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'amora_saved_notes' THEN
    v_actor := NEW.saved_by;
    IF NEW.message_id IS NOT NULL THEN
      SELECT message.visibility INTO v_visibility FROM public.chat_messages AS message
      WHERE message.id = NEW.message_id AND message.couple_id = v_couple;
    END IF;
  ELSIF TG_TABLE_NAME IN ('chat_summaries','amora_chat_request_claims','amora_memory_jobs',
      'amora_memory_enqueue_repair_candidates','amora_memory_enqueue_repair_dead_letters',
      'amora_memory_consents') THEN
    v_actor := (v_row->>'user_id')::uuid;
  ELSIF TG_TABLE_NAME = 'chat_messages' THEN
    v_actor := NEW.sender_id;
  END IF;
  IF v_visibility IN ('bride_private','groom_private') THEN
    SELECT CASE WHEN v_visibility = 'bride_private' THEN bride_id ELSE groom_id END
      INTO v_current_owner FROM public.couples WHERE id = v_couple;
    -- sender_id=NULL 인 AI 답변도 레인의 현재 소유자로 검사한다.
    IF v_actor IS NULL THEN v_actor := v_current_owner; END IF;
    IF v_current_owner IS NULL OR v_actor IS DISTINCT FROM v_current_owner THEN
      RAISE EXCEPTION 'ACCOUNT_DELETE_PRIVATE_SCOPE_RETIRED' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF v_actor IS NOT NULL THEN
    IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('hanbang:account-data:' || v_actor::text,0)) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_WRITE_BUSY' USING ERRCODE = '55P03';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_actor)
       OR EXISTS (SELECT 1 FROM public.account_deletion_jobs WHERE user_id = v_actor AND status <> 'completed') THEN
      RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_WRITE_FROZEN' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF v_visibility IN ('bride_private','groom_private') THEN
    IF EXISTS (SELECT 1 FROM public.account_deletion_private_scopes
        WHERE couple_id = v_couple AND visibility = v_visibility) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETE_PRIVATE_SCOPE_RETIRED' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_account_deletion_customer_write() FROM PUBLIC,anon,authenticated,service_role;

DO $triggers$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['chat_messages','chat_summaries','decision_nodes',
    'amora_couple_profiles','amora_chat_request_claims','amora_tool_executions',
    'amora_memory_jobs','amora_memory_enqueue_repair_candidates',
    'amora_memory_consents','amora_saved_notes'] LOOP
    EXECUTE pg_catalog.format('CREATE TRIGGER trg_00_account_deletion_customer_write BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_customer_write()',v_table);
  END LOOP;
END;
$triggers$;

-- 삭제 대상의 소속/슬롯을 먼저 바꾸면 private provenance가 사라진다.
-- Auth FK가 실제 삭제 중 NULL을 넣는 경우만 영수증과 auth 부재로 구분한다.
CREATE FUNCTION public.guard_account_deletion_membership_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_actor uuid; v_actors uuid[]; v_job public.account_deletion_jobs%ROWTYPE;
  v_related_couples uuid[]; v_auth_cascade boolean := true;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    IF TG_OP = 'UPDATE' AND NEW.couple_id IS NOT DISTINCT FROM OLD.couple_id
       AND NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
    v_actors := ARRAY[CASE WHEN TG_OP = 'INSERT' THEN NEW.id ELSE OLD.id END];
    v_related_couples := CASE WHEN TG_OP='INSERT' THEN ARRAY[NEW.couple_id]
      WHEN TG_OP='DELETE' THEN ARRAY[OLD.couple_id] ELSE ARRAY[OLD.couple_id,NEW.couple_id] END;
  ELSE
    IF TG_OP = 'UPDATE' AND NEW.bride_id IS NOT DISTINCT FROM OLD.bride_id
       AND NEW.groom_id IS NOT DISTINCT FROM OLD.groom_id THEN RETURN NEW; END IF;
    v_actors := CASE WHEN TG_OP = 'INSERT' THEN ARRAY[NEW.bride_id,NEW.groom_id]
      WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.bride_id,OLD.groom_id]
      ELSE ARRAY[
        CASE WHEN OLD.bride_id IS DISTINCT FROM NEW.bride_id THEN OLD.bride_id END,
        CASE WHEN OLD.bride_id IS DISTINCT FROM NEW.bride_id THEN NEW.bride_id END,
        CASE WHEN OLD.groom_id IS DISTINCT FROM NEW.groom_id THEN OLD.groom_id END,
        CASE WHEN OLD.groom_id IS DISTINCT FROM NEW.groom_id THEN NEW.groom_id END] END;
    v_related_couples := ARRAY[CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END];
    -- NULL 슬롯을 제3자가 채우는 것도 이미 퇴장한 private 레인을 되살릴 수 없다.
    IF TG_OP <> 'DELETE' AND EXISTS (
      SELECT 1 FROM public.account_deletion_private_scopes AS scope
      WHERE scope.couple_id = NEW.id AND (
        (scope.visibility = 'bride_private' AND NEW.bride_id IS NOT NULL)
        OR (scope.visibility = 'groom_private' AND NEW.groom_id IS NOT NULL)
      ) AND (TG_OP = 'INSERT' OR
        (scope.visibility = 'bride_private' AND NEW.bride_id IS DISTINCT FROM OLD.bride_id)
        OR (scope.visibility = 'groom_private' AND NEW.groom_id IS DISTINCT FROM OLD.groom_id))
    ) THEN RAISE EXCEPTION 'ACCOUNT_DELETE_MEMBERSHIP_FROZEN' USING ERRCODE = '55000'; END IF;
  END IF;
  FOREACH v_actor IN ARRAY v_actors LOOP
    CONTINUE WHEN v_actor IS NULL;
    IF EXISTS (SELECT 1 FROM auth.users WHERE id=v_actor) OR NOT EXISTS (
      SELECT 1 FROM public.account_deletion_jobs WHERE user_id=v_actor AND status='auth_deleting'
        AND data_prepared_at IS NOT NULL AND data_prepared_version=1 AND storage_verified_at IS NOT NULL
    ) THEN v_auth_cascade := false; END IF;
  END LOOP;
  IF NOT v_auth_cascade AND EXISTS (SELECT 1 FROM public.account_deletion_jobs AS job
    JOIN public.profiles AS profile ON profile.id=job.user_id
    WHERE job.status<>'completed' AND profile.couple_id=ANY(v_related_couples)) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_MEMBERSHIP_FROZEN' USING ERRCODE='55000';
  END IF;
  FOREACH v_actor IN ARRAY v_actors LOOP
    CONTINUE WHEN v_actor IS NULL;
    IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('hanbang:account-data:' || v_actor::text,0)) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETE_MEMBERSHIP_BUSY' USING ERRCODE = '55P03';
    END IF;
    SELECT * INTO v_job FROM public.account_deletion_jobs
      WHERE user_id = v_actor AND status <> 'completed';
    IF FOUND AND NOT (
      v_job.status = 'auth_deleting' AND v_job.data_prepared_at IS NOT NULL
      AND v_job.data_prepared_version = 1 AND v_job.storage_verified_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_actor)
    ) THEN RAISE EXCEPTION 'ACCOUNT_DELETE_MEMBERSHIP_FROZEN' USING ERRCODE = '55000'; END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_account_deletion_membership_transition() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_00_account_deletion_membership BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_membership_transition();
CREATE TRIGGER trg_00_account_deletion_membership BEFORE INSERT OR UPDATE OR DELETE ON public.couples
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_membership_transition();

CREATE FUNCTION public.prepare_account_deletion_customer_data(p_job_id uuid,p_claim_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '30s'
AS $function$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE; v_profile public.profiles%ROWTYPE;
  v_couple public.couples%ROWTYPE; v_visibility text;
  v_now timestamptz; v_partner uuid;
BEGIN
  SELECT * INTO v_job FROM public.account_deletion_jobs
    WHERE id = p_job_id AND claim_token = p_claim_token
      AND status IN ('deleting','auth_deleting') AND user_id IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hanbang:account-data:' || v_job.user_id::text,0));
  IF v_job.quarantine_count <> 0 OR v_job.ready_after IS NULL OR v_job.ready_after > clock_timestamp()
     OR EXISTS (SELECT 1 FROM public.account_deletion_media_manifest
       WHERE job_id = p_job_id AND (source = 'quarantine' OR not_before > clock_timestamp()))
     OR EXISTS (SELECT 1 FROM public.vendors WHERE owner_id = v_job.user_id) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_SCOPE_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_job.data_prepared_at IS NOT NULL AND v_job.data_prepared_version = 1 THEN RETURN true; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_job.user_id) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_SCOPE_REVIEW_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'hanbang:couple-membership:' || v_job.user_id::text,0));
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_job.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_SCOPE_REVIEW_REQUIRED'; END IF;
  IF v_profile.couple_id IS NOT NULL THEN
    SELECT * INTO v_couple FROM public.couples WHERE id = v_profile.couple_id FOR SHARE;
    IF NOT FOUND OR NOT COALESCE((
      (v_profile.role = 'bride' AND v_couple.bride_id = v_job.user_id AND v_couple.groom_id IS DISTINCT FROM v_job.user_id)
      OR (v_profile.role = 'groom' AND v_couple.groom_id = v_job.user_id AND v_couple.bride_id IS DISTINCT FROM v_job.user_id)
    ),false) THEN RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_SCOPE_REVIEW_REQUIRED'; END IF;
    v_visibility := CASE WHEN v_profile.role = 'bride' THEN 'bride_private' ELSE 'groom_private' END;
    v_partner := CASE WHEN v_profile.role = 'bride' THEN v_couple.groom_id ELSE v_couple.bride_id END;
    IF v_partner IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles
      WHERE id = v_partner AND couple_id = v_couple.id
        AND role = CASE WHEN v_profile.role = 'bride' THEN 'groom' ELSE 'bride' END) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_SCOPE_REVIEW_REQUIRED';
    END IF;
  END IF;
  -- claim이 없는 비표준 도구 키는 owner를 추측할 수 없다. 정상 서비스의
  -- 기존 key 형식을 바꾸지 않고, 해당 계정 삭제만 수동 검토로 남긴다.
  IF v_couple.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.amora_tool_executions AS execution
    WHERE execution.couple_id=v_couple.id AND NOT EXISTS (
      SELECT 1 FROM public.amora_chat_request_claims AS claim
      WHERE claim.couple_id=execution.couple_id AND claim.request_key=execution.request_key)
    AND execution.request_key !~ '^(chat|greeting):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(:|$)') THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_SCOPE_REVIEW_REQUIRED';
  END IF;
  -- 현재 슬롯 밖의 개인 데이터나 두 개의 로스터는 추측으로 분류하지 않는다.
  IF EXISTS (SELECT 1 FROM public.couples WHERE (bride_id = v_job.user_id OR groom_id = v_job.user_id)
        AND id IS DISTINCT FROM v_profile.couple_id)
     OR EXISTS (SELECT 1 FROM public.chat_messages WHERE sender_id = v_job.user_id
        AND visibility <> 'shared' AND (couple_id IS DISTINCT FROM v_profile.couple_id OR visibility IS DISTINCT FROM v_visibility))
     OR EXISTS (SELECT 1 FROM public.amora_chat_request_claims WHERE user_id = v_job.user_id
        AND visibility <> 'shared' AND (couple_id IS DISTINCT FROM v_profile.couple_id OR visibility IS DISTINCT FROM v_visibility))
     OR EXISTS (SELECT 1 FROM public.chat_summaries WHERE user_id = v_job.user_id
        AND (couple_id IS DISTINCT FROM v_profile.couple_id
          OR (visibility <> 'shared' AND visibility IS DISTINCT FROM v_visibility)))
     OR EXISTS (SELECT 1 FROM public.chat_messages WHERE couple_id=v_couple.id AND visibility=v_visibility
        AND sender_id IS NOT NULL AND sender_id<>v_job.user_id)
     OR EXISTS (SELECT 1 FROM public.chat_summaries WHERE couple_id=v_couple.id AND visibility=v_visibility
        AND user_id IS NOT NULL AND user_id<>v_job.user_id)
     OR EXISTS (SELECT 1 FROM public.amora_memory_jobs WHERE couple_id=v_couple.id AND visibility=v_visibility
        AND user_id IS NOT NULL AND user_id<>v_job.user_id) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_SCOPE_REVIEW_REQUIRED';
  END IF;
  -- 모든 subject claim의 journal은 개인정보일 수 있다. 공유 결과(예산 등)는
  -- 유지하면서 재시도용 요청/도구 payload만 source 관계가 살아 있을 때 정리한다.
  PERFORM request_key FROM public.amora_chat_request_claims
    WHERE user_id = v_job.user_id OR (couple_id = v_couple.id AND visibility = v_visibility)
    ORDER BY couple_id,request_key FOR UPDATE;
  INSERT INTO public.account_deletion_retired_requests(couple_id,request_digest,job_id)
    SELECT couple_id,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(request_key,'UTF8')),'hex'),p_job_id
      FROM public.amora_chat_request_claims WHERE user_id=v_job.user_id;
  IF v_couple.id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'hanbang:amora-memory-consent:' || v_couple.id::text || ':' || v_visibility,0));
    IF EXISTS (SELECT 1 FROM public.amora_chat_request_claims WHERE couple_id = v_couple.id
        AND visibility = v_visibility AND user_id <> v_job.user_id) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_SCOPE_REVIEW_REQUIRED';
    END IF;
    v_now := clock_timestamp();
    INSERT INTO public.account_deletion_private_scopes(couple_id,visibility,job_id,retired_at)
      VALUES(v_couple.id,v_visibility,p_job_id,v_now);
    INSERT INTO public.amora_private_chat_delete_boundaries(couple_id,visibility,deleted_at,revision)
      VALUES(v_couple.id,v_visibility,v_now,1)
      ON CONFLICT(couple_id,visibility) DO UPDATE SET deleted_at=excluded.deleted_at,
        revision=public.amora_private_chat_delete_boundaries.revision+1,updated_at=excluded.deleted_at;
    DELETE FROM public.amora_saved_notes AS note USING public.chat_messages AS message
      WHERE note.message_id=message.id AND message.couple_id=v_couple.id AND message.visibility=v_visibility;
    DELETE FROM public.amora_memory_jobs WHERE couple_id=v_couple.id AND visibility=v_visibility;
    DELETE FROM public.chat_summaries WHERE couple_id=v_couple.id AND visibility=v_visibility;
    DELETE FROM public.decision_nodes WHERE couple_id=v_couple.id AND visibility=v_visibility;
    DELETE FROM public.amora_couple_profiles WHERE couple_id=v_couple.id AND visibility=v_visibility;
    DELETE FROM public.amora_memory_consents WHERE couple_id=v_couple.id AND visibility=v_visibility;
    INSERT INTO public.amora_memory_settings(couple_id,visibility,enabled,enabled_by,enabled_at,memory_reset_at,legacy_purged_at)
      VALUES(v_couple.id,v_visibility,false,NULL,NULL,v_now,v_now)
      ON CONFLICT(couple_id,visibility) DO UPDATE SET enabled=false,enabled_by=NULL,enabled_at=NULL,
        memory_reset_at=v_now,legacy_purged_at=v_now,updated_at=v_now;
    -- Auth user_id CASCADE가 shared summary 본문까지 지우지 않도록 식별자만 분리.
    IF v_partner IS NOT NULL THEN
      UPDATE public.chat_summaries SET user_id=NULL
        WHERE couple_id=v_couple.id AND visibility='shared' AND user_id=v_job.user_id;
    END IF;
  END IF;
  DELETE FROM public.amora_tool_executions AS execution
    WHERE execution.request_key LIKE 'chat:' || v_job.user_id::text || ':%'
      OR execution.request_key = 'greeting:' || v_job.user_id::text
      OR execution.request_key LIKE 'greeting:' || v_job.user_id::text || ':%'
      OR EXISTS (SELECT 1 FROM public.amora_chat_request_claims AS claim
        WHERE claim.couple_id=execution.couple_id AND claim.request_key=execution.request_key
          AND claim.user_id=v_job.user_id);
  DELETE FROM public.amora_memory_enqueue_repair_candidates WHERE user_id=v_job.user_id;
  DELETE FROM public.amora_memory_enqueue_repair_dead_letters WHERE user_id=v_job.user_id;
  DELETE FROM public.amora_chat_request_claims WHERE user_id=v_job.user_id;
  IF v_couple.id IS NOT NULL THEN
    DELETE FROM public.chat_messages WHERE couple_id=v_couple.id AND visibility=v_visibility;
    IF EXISTS (SELECT 1 FROM public.chat_messages WHERE couple_id=v_couple.id AND visibility=v_visibility)
      OR EXISTS (SELECT 1 FROM public.decision_nodes WHERE couple_id=v_couple.id AND visibility=v_visibility)
      OR EXISTS (SELECT 1 FROM public.chat_summaries WHERE couple_id=v_couple.id AND visibility=v_visibility)
      OR EXISTS (SELECT 1 FROM public.amora_couple_profiles WHERE couple_id=v_couple.id AND visibility=v_visibility)
      OR EXISTS (SELECT 1 FROM public.amora_memory_jobs WHERE couple_id=v_couple.id AND visibility=v_visibility) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_POSTCONDITION_FAILED';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.amora_chat_request_claims WHERE user_id=v_job.user_id)
    OR EXISTS (SELECT 1 FROM public.amora_tool_executions WHERE request_key LIKE 'chat:' || v_job.user_id::text || ':%')
    OR EXISTS (SELECT 1 FROM public.amora_memory_enqueue_repair_candidates WHERE user_id=v_job.user_id)
    OR EXISTS (SELECT 1 FROM public.amora_memory_enqueue_repair_dead_letters WHERE user_id=v_job.user_id) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_POSTCONDITION_FAILED';
  END IF;
  UPDATE public.account_deletion_jobs SET data_prepared_at=clock_timestamp(),data_prepared_version=1,updated_at=clock_timestamp()
    WHERE id=p_job_id AND claim_token=p_claim_token;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.prepare_account_deletion_customer_data(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion_customer_data(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion_auth_delete(p_job_id uuid,p_claim_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_prepared boolean := false;
BEGIN
  UPDATE public.account_deletion_jobs AS job
  SET status='auth_deleting',storage_verified_at=COALESCE(job.storage_verified_at,clock_timestamp()),updated_at=clock_timestamp()
  WHERE job.id=p_job_id AND job.claim_token=p_claim_token AND job.status IN ('deleting','auth_deleting')
    AND job.data_prepared_at IS NOT NULL AND job.data_prepared_version=1
    AND job.quarantine_count=0
    AND NOT EXISTS (SELECT 1 FROM public.vendors WHERE owner_id=job.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.account_deletion_media_manifest
      WHERE job_id=job.id AND (source='quarantine' OR cleaned_at IS NULL))
  RETURNING true INTO v_prepared;
  RETURN COALESCE(v_prepared,false);
END;
$function$;
REVOKE ALL ON FUNCTION public.prepare_account_deletion_auth_delete(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion_auth_delete(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_amora_memory_job(
  p_lease_seconds integer DEFAULT 300,
  p_job_id uuid DEFAULT NULL
)
RETURNS SETOF public.amora_memory_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
BEGIN
  IF p_lease_seconds < 60 OR p_lease_seconds > 1800 THEN
    RAISE EXCEPTION 'AMORA_MEMORY_JOB_CLAIM_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hanbang:amora-memory-claim', 0)
  );

  UPDATE public.amora_memory_jobs
  SET status = 'failed',
      claimed_at = NULL,
      completed_at = now(),
      last_error_code = 'LEASE_EXHAUSTED',
      updated_at = now()
  WHERE status = 'processing'
    AND (p_job_id IS NULL OR id = p_job_id)
    AND claimed_at < now() - make_interval(secs => p_lease_seconds)
    AND attempt_count >= 5;

  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
    FROM public.amora_memory_jobs AS job
    WHERE job.available_at <= now()
      AND (p_job_id IS NULL OR job.id = p_job_id)
      AND (
        job.status = 'pending'
        OR (
          job.status = 'processing'
          AND job.claimed_at < now() - make_interval(secs => p_lease_seconds)
        )
      )
      AND job.attempt_count < 5
      AND NOT EXISTS (SELECT 1 FROM public.account_deletion_jobs AS deletion
        WHERE deletion.user_id=job.user_id AND deletion.status<>'completed')
      AND NOT EXISTS (SELECT 1 FROM public.account_deletion_private_scopes AS retired
        WHERE retired.couple_id=job.couple_id AND retired.visibility=job.visibility)
      AND NOT EXISTS (
        SELECT 1
        FROM public.amora_memory_jobs AS active
        WHERE active.couple_id = job.couple_id
          AND active.visibility = job.visibility
          AND active.status = 'processing'
          AND active.claimed_at >= now() - make_interval(secs => p_lease_seconds)
          AND active.id <> job.id
          AND NOT EXISTS (SELECT 1 FROM public.account_deletion_jobs AS deletion
            WHERE deletion.user_id=active.user_id AND deletion.status<>'completed')
          AND NOT EXISTS (SELECT 1 FROM public.account_deletion_private_scopes AS retired
            WHERE retired.couple_id=active.couple_id AND retired.visibility=active.visibility)
      )
    ORDER BY job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.amora_memory_jobs AS job
  SET status = 'processing',
      claimed_at = now(),
      attempt_count = job.attempt_count + 1,
      last_error_code = NULL,
      updated_at = now()
  FROM candidate
  WHERE job.id = candidate.id
  RETURNING job.*;
END
$function$;

ALTER FUNCTION public.claim_amora_memory_job(integer, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_amora_memory_job(integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_amora_memory_job(integer, uuid)
  TO service_role;


CREATE FUNCTION public.guard_account_deletion_auth_boundary()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hanbang:account-data:' || OLD.id::text,0));
  IF EXISTS (SELECT 1 FROM public.account_deletion_jobs WHERE user_id=OLD.id AND status<>'completed'
    AND (status<>'auth_deleting' OR data_prepared_at IS NULL OR data_prepared_version IS DISTINCT FROM 1 OR storage_verified_at IS NULL)) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETE_CUSTOMER_DATA_NOT_PREPARED' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_account_deletion_auth_boundary() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_account_deletion_auth_boundary BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_deletion_auth_boundary();

COMMENT ON COLUMN public.account_deletion_jobs.data_prepared_at IS
  'Atomic v1 pre-Auth private-lane and request-provenance cleanup receipt; does not certify operating-log, backup or overall privacy-retention closure.';
COMMENT ON TABLE public.account_deletion_private_scopes IS
  'Content-free retired private-lane fence without a direct user ID; couple/job linkage remains pseudonymous. Survives Auth deletion/finalization while a partner retains the sealed couple; cascades only with that couple.';
COMMIT;
