-- 삭제 결과를 실제로 알린다
--
-- ## 법이 요구하는 것
--
-- 「개인정보 보호법」 제36조 제2항 — 정정·삭제 등 필요한 조치를 한 후 **그 결과를
-- 정보주체에게 알려야 한다.** 위임받은 시행령 제43조 제3항이 기한과 형식을 정한다:
-- **요구를 받은 날부터 10일 이내**에 "조치를 한 사실"을 알린다.
--
-- 지금 이 저장소의 탈퇴 경로에는 발송 코드가 **0줄**이다. 사용자는 탈퇴를 누르면
-- 즉시 로그아웃되고, 그 뒤로 자기 요청이 어떻게 됐는지 알 방법이 없다.
--
-- ## 왜 주소를 잠깐 들고 있어야 하는가
--
-- 가입 이메일은 `auth.users` 에만 있고 **삭제와 함께 사라진다.** 그래서 통지를
-- 보내려면 그 주소를 삭제 직전에 어딘가 옮겨 놓아야 한다.
--
-- 안 옮기면 통지는 **1회 시도**가 되고, Resend 가 한 번 실패하면 그 사람은 법이
-- 요구하는 통지를 영영 못 받는다. 그래서 짧게 보관한다 — 다만 **오래 남을 수
-- 없게 구조로 막는다.**
--
--   * 보관은 `auth.users` 삭제 **직전**에 시작하고
--   * 통지가 나가면 **즉시** 지우며
--   * "보냈는데 주소가 아직 남아 있는 상태" 는 CHECK 가 물리적으로 금지한다
--   * 시도는 3회까지(크론 5분 주기라 최악 약 15분)
--
-- 파운더에게 알린 사실: 이 짧은 보관은 통지를 재시도 가능하게 만들려는 것이고,
-- 대안(보관 없음)은 법이 요구하는 통지를 못 지키게 만든다.

ALTER TABLE public.account_deletion_jobs
  ADD COLUMN IF NOT EXISTS notice_email text,
  ADD COLUMN IF NOT EXISTS notice_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS notice_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.account_deletion_jobs.notice_email IS
  '삭제 결과 통지를 보낼 주소. auth.users 삭제 직전에만 채우고 통지가 나가면 즉시 비운다. 보낸 뒤에도 남아 있는 상태는 account_deletion_notice_no_lingering_address 가 금지한다.';

-- **보냈으면 주소가 남아 있을 수 없다.** 이 제약이 보관 기간의 상한을 대신한다.
ALTER TABLE public.account_deletion_jobs
  DROP CONSTRAINT IF EXISTS account_deletion_notice_no_lingering_address;
ALTER TABLE public.account_deletion_jobs
  ADD CONSTRAINT account_deletion_notice_no_lingering_address
  CHECK (notice_sent_at IS NULL OR notice_email IS NULL);

-- 시도 횟수는 음수가 될 수 없고 상한을 넘을 수 없다.
ALTER TABLE public.account_deletion_jobs
  DROP CONSTRAINT IF EXISTS account_deletion_notice_attempts_bounded;
ALTER TABLE public.account_deletion_jobs
  ADD CONSTRAINT account_deletion_notice_attempts_bounded
  CHECK (notice_attempts >= 0 AND notice_attempts <= 3);

/**
 * auth 삭제 직전에 통지 주소를 못 박는다.
 *
 * 워커가 `getUserById` 로 주소를 읽은 **직후**, `deleteUser` **직전**에 부른다.
 * 그 사이가 유일하게 주소를 아는 시점이다.
 */
CREATE OR REPLACE FUNCTION public.pin_account_deletion_notice_email(
  p_job_id uuid,
  p_claim_token uuid,
  p_email text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
BEGIN
  -- 모양이 아니면 통지를 포기하되 삭제는 막지 않는다. 통지 실패가 삭제를
  -- 멈추면 사용자는 지워지지도 않고 연락도 못 받는다 — 둘 다 잃는다.
  IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN false;
  END IF;

  UPDATE public.account_deletion_jobs
     SET notice_email = v_email,
         updated_at = clock_timestamp()
   WHERE id = p_job_id
     AND claim_token = p_claim_token
     AND status = 'auth_deleting'
     AND notice_sent_at IS NULL;

  RETURN FOUND;
END;
$$;

/**
 * 통지를 보낸 사실을 기록하고 **주소를 즉시 지운다.**
 *
 * 성공(`p_sent` = true)이면 주소를 비우고 시각을 남긴다. 실패면 시도 횟수만
 * 올리고 주소를 남겨 다음 크론이 다시 시도하게 한다. 상한(3)에 닿으면 주소를
 * 비운다 — **못 보내더라도 주소를 계속 들고 있지는 않는다.**
 */
CREATE OR REPLACE FUNCTION public.record_account_deletion_notice(
  p_job_id uuid,
  p_sent boolean
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_attempts integer;
BEGIN
  IF p_sent THEN
    UPDATE public.account_deletion_jobs
       SET notice_email = NULL,
           notice_sent_at = clock_timestamp(),
           updated_at = clock_timestamp()
     WHERE id = p_job_id
     RETURNING notice_attempts INTO v_attempts;
    RETURN 'sent';
  END IF;

  UPDATE public.account_deletion_jobs
     SET notice_attempts = least(notice_attempts + 1, 3),
         updated_at = clock_timestamp()
   WHERE id = p_job_id
   RETURNING notice_attempts INTO v_attempts;

  IF v_attempts IS NULL THEN
    RETURN 'unknown_job';
  END IF;

  IF v_attempts >= 3 THEN
    -- 상한에 닿았다. 더 시도하지 않고 주소를 버린다.
    UPDATE public.account_deletion_jobs
       SET notice_email = NULL, updated_at = clock_timestamp()
     WHERE id = p_job_id;
    RETURN 'gave_up';
  END IF;

  RETURN 'retry';
END;
$$;

REVOKE ALL ON FUNCTION public.pin_account_deletion_notice_email(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_account_deletion_notice(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pin_account_deletion_notice_email(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_account_deletion_notice(uuid, boolean) TO service_role;
