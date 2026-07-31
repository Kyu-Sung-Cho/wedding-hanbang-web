-- 커플이 계약 금액과 지급 진행을 함께 확인하는 준비 기록.
--
-- 이 테이블은 결제, 예약, 전자계약, 환불 판정을 실행하지 않는다. 브라우저
-- 직접 변경은 막고, 인증·커플 멤버십·입력값·낙관적 잠금을 확인하는 서버 API만
-- service_role로 변경한다.
--
-- 롤백:
--   DROP FUNCTION public.update_wedding_payment_ledger(
--     uuid, uuid, uuid, bigint, text, text, text, bigint, bigint, date,
--     bigint, text, text
--   );
--   DROP FUNCTION public.create_wedding_payment_ledger(
--     uuid, uuid, uuid, text, text, text, bigint, bigint, date, bigint,
--     text, text
--   );
--   DROP TABLE public.wedding_payment_ledger;

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.wedding_payment_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL
    REFERENCES public.couples(id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL,
  item_name text NOT NULL,
  vendor_display_name text,
  category_key text NOT NULL,
  contract_amount_won bigint NOT NULL DEFAULT 0,
  paid_amount_won bigint NOT NULL DEFAULT 0,
  balance_amount_won bigint
    GENERATED ALWAYS AS (contract_amount_won - paid_amount_won) STORED,
  balance_due_date date,
  refundable_amount_won bigint,
  status text NOT NULL DEFAULT 'planned',
  evidence_status text NOT NULL DEFAULT 'user_stated',
  created_by uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT wedding_payment_ledger_item_name_check
    CHECK (
      char_length(item_name) BETWEEN 1 AND 100
      AND item_name !~ '[[:cntrl:]]'
      AND item_name = btrim(item_name)
    ),
  CONSTRAINT wedding_payment_ledger_vendor_name_check
    CHECK (
      vendor_display_name IS NULL
      OR (
        char_length(vendor_display_name) BETWEEN 1 AND 120
        AND vendor_display_name !~ '[[:cntrl:]]'
        AND vendor_display_name = btrim(vendor_display_name)
      )
    ),
  CONSTRAINT wedding_payment_ledger_category_key_check
    CHECK (
      char_length(category_key) BETWEEN 1 AND 40
      AND category_key ~ '^[a-z0-9][a-z0-9_-]*$'
    ),
  CONSTRAINT wedding_payment_ledger_contract_amount_check
    CHECK (contract_amount_won BETWEEN 0 AND 1000000000),
  CONSTRAINT wedding_payment_ledger_paid_amount_check
    CHECK (
      paid_amount_won BETWEEN 0 AND 1000000000
      AND paid_amount_won <= contract_amount_won
    ),
  CONSTRAINT wedding_payment_ledger_refundable_amount_check
    CHECK (
      refundable_amount_won IS NULL
      OR (
        refundable_amount_won BETWEEN 0 AND 1000000000
        AND refundable_amount_won <= paid_amount_won
      )
    ),
  CONSTRAINT wedding_payment_ledger_status_check
    CHECK (
      status IN (
        'planned',
        'contracted',
        'partially_paid',
        'paid',
        'cancelled',
        'disputed'
      )
    ),
  CONSTRAINT wedding_payment_ledger_status_amount_check
    CHECK (
      (status = 'planned' AND paid_amount_won = 0)
      OR (
        status = 'contracted'
        AND contract_amount_won > 0
        AND paid_amount_won = 0
      )
      OR (
        status = 'partially_paid'
        AND paid_amount_won > 0
        AND paid_amount_won < contract_amount_won
      )
      OR (
        status = 'paid'
        AND contract_amount_won > 0
        AND paid_amount_won = contract_amount_won
      )
      OR status IN ('cancelled', 'disputed')
    ),
  CONSTRAINT wedding_payment_ledger_evidence_status_check
    CHECK (evidence_status IN ('user_stated', 'provider_written')),
  CONSTRAINT wedding_payment_ledger_revision_check
    CHECK (revision BETWEEN 1 AND 9007199254740991),
  CONSTRAINT wedding_payment_ledger_idempotency_key
    UNIQUE (couple_id, client_request_id)
);

CREATE INDEX wedding_payment_ledger_couple_status_due_idx
  ON public.wedding_payment_ledger (
    couple_id,
    status,
    balance_due_date
  );

CREATE INDEX wedding_payment_ledger_couple_updated_idx
  ON public.wedding_payment_ledger (couple_id, updated_at DESC);

ALTER TABLE public.wedding_payment_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_payment_ledger FORCE ROW LEVEL SECURITY;

CREATE POLICY wedding_payment_ledger_member_select
  ON public.wedding_payment_ledger
  FOR SELECT
  TO authenticated
  USING (public.is_couple_member(couple_id));

-- 연결된 사용자는 본인 커플 기록을 읽을 수 있지만 브라우저에서 직접 바꿀
-- 수는 없다. service_role도 테이블 권한이 없고, postgres 소유 RPC만 현재
-- membership을 원자적으로 확인한 뒤 생성·수정한다. 삭제 RPC는 제공하지 않는다.
REVOKE ALL ON TABLE public.wedding_payment_ledger
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.wedding_payment_ledger TO authenticated;

CREATE OR REPLACE FUNCTION public.create_wedding_payment_ledger(
  p_user_id uuid,
  p_couple_id uuid,
  p_client_request_id uuid,
  p_item_name text,
  p_vendor_display_name text,
  p_category_key text,
  p_contract_amount_won bigint,
  p_paid_amount_won bigint,
  p_balance_due_date date,
  p_refundable_amount_won bigint,
  p_status text,
  p_evidence_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_existing public.wedding_payment_ledger%ROWTYPE;
  v_created public.wedding_payment_ledger%ROWTYPE;
  v_count integer;
BEGIN
  IF p_user_id IS NULL
     OR p_couple_id IS NULL
     OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_INVALID_IDENTIFIER'
      USING ERRCODE = '22023';
  END IF;

  -- 회원 연결 변경 RPC/trigger와 같은 사용자 advisory lock을 잡고, 실제
  -- membership 두 행도 공유 잠금한다. 확인 뒤 service-role INSERT 사이에
  -- 탈퇴·상대 변경이 끼어드는 TOCTOU를 막는다.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:couple-membership:' || p_user_id::text,
      0
    )
  );
  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
    AND (
      couple.bride_id = p_user_id
      OR couple.groom_id = p_user_id
    )
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  -- 커플별 생성과 한도를 직렬화한다. 같은 키 재시도는 아래 기존 receipt로
  -- 끝나고, 다른 키 두 개가 동시에 200개 한도를 넘는 일도 없다.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'wedding-payment-ledger-v1:' || p_couple_id::text,
      0
    )
  );
  SELECT ledger.*
  INTO v_existing
  FROM public.wedding_payment_ledger AS ledger
  WHERE ledger.couple_id = p_couple_id
    AND ledger.client_request_id = p_client_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF ROW(
      v_existing.item_name,
      v_existing.vendor_display_name,
      v_existing.category_key,
      v_existing.contract_amount_won,
      v_existing.paid_amount_won,
      v_existing.balance_due_date,
      v_existing.refundable_amount_won,
      v_existing.status,
      v_existing.evidence_status
    ) IS NOT DISTINCT FROM ROW(
      p_item_name,
      p_vendor_display_name,
      p_category_key,
      p_contract_amount_won,
      p_paid_amount_won,
      p_balance_due_date,
      p_refundable_amount_won,
      p_status,
      p_evidence_status
    ) THEN
      RETURN pg_catalog.to_jsonb(v_existing);
    END IF;
    RAISE EXCEPTION 'PAYMENT_LEDGER_IDEMPOTENCY_CONFLICT'
      USING ERRCODE = '23505';
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.wedding_payment_ledger AS ledger
  WHERE ledger.couple_id = p_couple_id;
  IF v_count >= 200 THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_LIMIT'
      USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.wedding_payment_ledger (
    couple_id,
    client_request_id,
    item_name,
    vendor_display_name,
    category_key,
    contract_amount_won,
    paid_amount_won,
    balance_due_date,
    refundable_amount_won,
    status,
    evidence_status,
    created_by,
    updated_by
  )
  VALUES (
    p_couple_id,
    p_client_request_id,
    p_item_name,
    p_vendor_display_name,
    p_category_key,
    p_contract_amount_won,
    p_paid_amount_won,
    p_balance_due_date,
    p_refundable_amount_won,
    p_status,
    p_evidence_status,
    p_user_id,
    p_user_id
  )
  RETURNING * INTO v_created;

  RETURN pg_catalog.to_jsonb(v_created);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_wedding_payment_ledger(
  p_user_id uuid,
  p_couple_id uuid,
  p_entry_id uuid,
  p_expected_revision bigint,
  p_item_name text,
  p_vendor_display_name text,
  p_category_key text,
  p_contract_amount_won bigint,
  p_paid_amount_won bigint,
  p_balance_due_date date,
  p_refundable_amount_won bigint,
  p_status text,
  p_evidence_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_current public.wedding_payment_ledger%ROWTYPE;
  v_updated public.wedding_payment_ledger%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
     OR p_couple_id IS NULL
     OR p_entry_id IS NULL
     OR p_expected_revision NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_INVALID_IDENTIFIER'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:couple-membership:' || p_user_id::text,
      0
    )
  );
  PERFORM 1
  FROM public.profiles AS profile
  WHERE profile.id = p_user_id
    AND profile.couple_id = p_couple_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
    AND (
      couple.bride_id = p_user_id
      OR couple.groom_id = p_user_id
    )
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_SCOPE_DENIED'
      USING ERRCODE = '42501';
  END IF;

  SELECT ledger.*
  INTO v_current
  FROM public.wedding_payment_ledger AS ledger
  WHERE ledger.id = p_entry_id
    AND ledger.couple_id = p_couple_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_NOT_FOUND'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current.revision <> p_expected_revision THEN
    -- 응답 유실 뒤 같은 목표 상태를 재시도한 경우에는 revision을 다시 올리지
    -- 않고 기존 receipt를 반환한다.
    IF v_current.revision = p_expected_revision + 1
       AND ROW(
         v_current.item_name,
         v_current.vendor_display_name,
         v_current.category_key,
         v_current.contract_amount_won,
         v_current.paid_amount_won,
         v_current.balance_due_date,
         v_current.refundable_amount_won,
         v_current.status,
         v_current.evidence_status
       ) IS NOT DISTINCT FROM ROW(
         p_item_name,
         p_vendor_display_name,
         p_category_key,
         p_contract_amount_won,
         p_paid_amount_won,
         p_balance_due_date,
         p_refundable_amount_won,
         p_status,
         p_evidence_status
       ) THEN
      RETURN pg_catalog.to_jsonb(v_current);
    END IF;
    RAISE EXCEPTION 'PAYMENT_LEDGER_REVISION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.wedding_payment_ledger
  SET item_name = p_item_name,
      vendor_display_name = p_vendor_display_name,
      category_key = p_category_key,
      contract_amount_won = p_contract_amount_won,
      paid_amount_won = p_paid_amount_won,
      balance_due_date = p_balance_due_date,
      refundable_amount_won = p_refundable_amount_won,
      status = p_status,
      evidence_status = p_evidence_status,
      updated_by = p_user_id,
      updated_at = clock_timestamp(),
      revision = revision + 1
  WHERE id = p_entry_id
    AND couple_id = p_couple_id
    AND revision = p_expected_revision
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_REVISION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;
  RETURN pg_catalog.to_jsonb(v_updated);
END;
$function$;

ALTER FUNCTION public.create_wedding_payment_ledger(
  uuid, uuid, uuid, text, text, text, bigint, bigint, date, bigint, text, text
) OWNER TO postgres;
ALTER FUNCTION public.update_wedding_payment_ledger(
  uuid, uuid, uuid, bigint, text, text, text, bigint, bigint, date, bigint, text, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_wedding_payment_ledger(
  uuid, uuid, uuid, text, text, text, bigint, bigint, date, bigint, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_wedding_payment_ledger(
  uuid, uuid, uuid, bigint, text, text, text, bigint, bigint, date, bigint, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_wedding_payment_ledger(
  uuid, uuid, uuid, text, text, text, bigint, bigint, date, bigint, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_wedding_payment_ledger(
  uuid, uuid, uuid, bigint, text, text, text, bigint, bigint, date, bigint, text, text
) TO service_role;

-- DDL이 일부만 적용되거나 권한·FK 동작이 바뀐 상태에서는 마이그레이션 자체를
-- 실패시킨다. 애플리케이션 테스트가 실행되지 않는 운영 적용 경로에서도 같은
-- 출시 경계를 보장한다.
DO $postcondition$
DECLARE
  v_check_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'wedding_payment_ledger'
      AND relation.relkind = 'r'
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_RLS_POSTCONDITION_FAILED';
  END IF;

  IF NOT (
    pg_catalog.has_table_privilege(
      'authenticated',
      'public.wedding_payment_ledger',
      'SELECT'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated',
      'public.wedding_payment_ledger',
      'INSERT'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated',
      'public.wedding_payment_ledger',
      'UPDATE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated',
      'public.wedding_payment_ledger',
      'DELETE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role',
      'public.wedding_payment_ledger',
      'SELECT'
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role',
      'public.wedding_payment_ledger',
      'INSERT'
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role',
      'public.wedding_payment_ledger',
      'UPDATE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role',
      'public.wedding_payment_ledger',
      'DELETE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'anon',
      'public.wedding_payment_ledger',
      'SELECT'
    )
  ) THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_PRIVILEGE_POSTCONDITION_FAILED';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wedding_payment_ledger'
      AND policyname = 'wedding_payment_ledger_member_select'
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND qual LIKE '%is_couple_member%'
  ) <> 1
  OR (
    SELECT count(*)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wedding_payment_ledger'
  ) <> 1 THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_POLICY_POSTCONDITION_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.wedding_payment_ledger'::regclass
      AND conname = 'wedding_payment_ledger_couple_id_fkey'
      AND contype = 'f'
      AND confdeltype = 'c'
      AND convalidated
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.wedding_payment_ledger'::regclass
      AND conname = 'wedding_payment_ledger_created_by_fkey'
      AND contype = 'f'
      AND confdeltype = 'n'
      AND convalidated
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.wedding_payment_ledger'::regclass
      AND conname = 'wedding_payment_ledger_updated_by_fkey'
      AND contype = 'f'
      AND confdeltype = 'n'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_FK_POSTCONDITION_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.wedding_payment_ledger'::regclass
      AND attname = 'balance_amount_won'
      AND attgenerated = 's'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_BALANCE_POSTCONDITION_FAILED';
  END IF;

  SELECT count(*)
  INTO v_check_count
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.wedding_payment_ledger'::regclass
    AND contype = 'c'
    AND convalidated
    AND conname IN (
      'wedding_payment_ledger_item_name_check',
      'wedding_payment_ledger_vendor_name_check',
      'wedding_payment_ledger_category_key_check',
      'wedding_payment_ledger_contract_amount_check',
      'wedding_payment_ledger_paid_amount_check',
      'wedding_payment_ledger_refundable_amount_check',
      'wedding_payment_ledger_status_check',
      'wedding_payment_ledger_status_amount_check',
      'wedding_payment_ledger_evidence_status_check',
      'wedding_payment_ledger_revision_check'
    );
  IF v_check_count <> 10 THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_CHECK_POSTCONDITION_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.wedding_payment_ledger'::regclass
      AND conname = 'wedding_payment_ledger_idempotency_key'
      AND contype = 'u'
      AND convalidated
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.wedding_payment_ledger'::regclass
      AND attname = 'client_request_id'
      AND attnotnull
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_IDEMPOTENCY_POSTCONDITION_FAILED';
  END IF;

  IF NOT (
    pg_catalog.has_function_privilege(
      'service_role',
      'public.create_wedding_payment_ledger(uuid,uuid,uuid,text,text,text,bigint,bigint,date,bigint,text,text)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.create_wedding_payment_ledger(uuid,uuid,uuid,text,text,text,bigint,bigint,date,bigint,text,text)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'anon',
      'public.create_wedding_payment_ledger(uuid,uuid,uuid,text,text,text,bigint,bigint,date,bigint,text,text)',
      'EXECUTE'
    )
    AND pg_catalog.has_function_privilege(
      'service_role',
      'public.update_wedding_payment_ledger(uuid,uuid,uuid,bigint,text,text,text,bigint,bigint,date,bigint,text,text)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.update_wedding_payment_ledger(uuid,uuid,uuid,bigint,text,text,text,bigint,bigint,date,bigint,text,text)',
      'EXECUTE'
    )
    AND NOT pg_catalog.has_function_privilege(
      'anon',
      'public.update_wedding_payment_ledger(uuid,uuid,uuid,bigint,text,text,text,bigint,bigint,date,bigint,text,text)',
      'EXECUTE'
    )
  ) THEN
    RAISE EXCEPTION 'PAYMENT_LEDGER_RPC_ACL_POSTCONDITION_FAILED';
  END IF;
END;
$postcondition$;

COMMENT ON TABLE public.wedding_payment_ledger IS
  '커플 공유 계약·지급 준비 기록. 실제 결제·예약·환불 권리 판정을 수행하지 않는다.';
COMMENT ON COLUMN public.wedding_payment_ledger.vendor_display_name IS
  '사용자가 구분을 위해 적은 업체 표시명이며 공식 업체 신원 검증값이 아니다.';
COMMENT ON COLUMN public.wedding_payment_ledger.refundable_amount_won IS
  '사용자가 확인해 옮긴 참고 금액. 확정 환불 권리나 법률 판단이 아니다.';
COMMENT ON COLUMN public.wedding_payment_ledger.evidence_status IS
  'user_stated 또는 provider_written. 어느 값도 웨딩한방의 독립 검증을 뜻하지 않는다.';

COMMIT;
