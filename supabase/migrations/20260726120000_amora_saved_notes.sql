-- 아모라가 한 말 중 중요한 것을 모아 두는 공간.
--
-- 채팅은 길어질수록 앞에서 들은 중요한 말(위약금 조건, 물어볼 것, 결정한 것)이
-- 스크롤 뒤로 묻힌다. 다시 찾으려면 대화를 거슬러 올라가야 한다. 저장해 두면
-- 한 곳에서 다시 볼 수 있다.
--
-- 설계 결정:
--   · 커플 단위로 저장한다. 준비는 둘이 같이 하므로 한쪽이 저장한 것을 다른
--     쪽도 봐야 한다. 누가 저장했는지는 saved_by에 남긴다.
--   · 원문을 스냅샷으로 복사한다(content). messages를 조인하지 않아도 읽히고,
--     대화를 새로 시작해 메시지가 정리돼도 저장한 내용은 남는다.
--   · memo는 사용자가 "왜 저장했는지" 적는 칸이다. 우리가 요약하지 않는다 —
--     요약은 해석이고, 해석은 이 제품이 금지한 판정에 가까워진다.
--   · 같은 메시지를 두 번 저장할 수 없다(부분 유니크 인덱스).
--
-- 되돌리기: DROP TABLE public.amora_saved_notes;

CREATE TABLE IF NOT EXISTS public.amora_saved_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  saved_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 원본 메시지가 사라져도 저장본은 남는다.
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  content text NOT NULL,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amora_saved_notes_content_bounded
    CHECK (char_length(btrim(content)) BETWEEN 1 AND 4000),
  CONSTRAINT amora_saved_notes_memo_bounded
    CHECK (memo IS NULL OR char_length(memo) <= 500)
);

-- 목록은 항상 커플 기준 최신순이다.
CREATE INDEX IF NOT EXISTS amora_saved_notes_couple_recent_idx
  ON public.amora_saved_notes (couple_id, created_at DESC);

-- 같은 메시지 중복 저장 방지. message_id가 없는 직접 입력분은 제한하지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS amora_saved_notes_unique_message_idx
  ON public.amora_saved_notes (couple_id, message_id)
  WHERE message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_amora_saved_note()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $touch_amora_saved_note$
BEGIN
  NEW.updated_at := now();
  -- 소유 정보는 생성 이후 바뀌지 않는다(다른 커플로 옮겨 붙이는 사고 차단).
  NEW.couple_id := OLD.couple_id;
  NEW.saved_by := OLD.saved_by;
  NEW.message_id := OLD.message_id;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$touch_amora_saved_note$;

DROP TRIGGER IF EXISTS amora_saved_notes_touch ON public.amora_saved_notes;
CREATE TRIGGER amora_saved_notes_touch
BEFORE UPDATE ON public.amora_saved_notes
FOR EACH ROW EXECUTE FUNCTION public.touch_amora_saved_note();

-- 정책 안에서 쓸 커플 판정.
--
-- 기존 is_current_couple_member(uuid, uuid)는 authenticated에 EXECUTE가 없어
-- 정책에서 부르면 권한 오류가 난다(2026-07-26 스테이징 실측: 전 요청 403).
-- 그렇다고 그 함수를 열면 "임의의 사용자 X가 커플 Y 소속인가"를 물을 수 있게
-- 된다. 그래서 auth.uid()로 고정한 전용 판정을 따로 둔다 — 자기 자신에 대해서만
-- 답한다.
CREATE OR REPLACE FUNCTION public.is_my_couple(p_couple_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '5s'
AS $is_my_couple$
  SELECT public.is_current_couple_member(auth.uid(), p_couple_id);
$is_my_couple$;

ALTER FUNCTION public.is_my_couple(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_my_couple(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_couple(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_my_couple(uuid) IS
  'RLS 정책용 — 지금 로그인한 사용자가 해당 커플의 구성원인지만 답한다.';

ALTER TABLE public.amora_saved_notes ENABLE ROW LEVEL SECURITY;

-- 커플 밖에서는 읽지도 쓰지도 못한다.
DROP POLICY IF EXISTS amora_saved_notes_select ON public.amora_saved_notes;
CREATE POLICY amora_saved_notes_select ON public.amora_saved_notes
  FOR SELECT TO authenticated
  USING (public.is_my_couple(couple_id));

DROP POLICY IF EXISTS amora_saved_notes_insert ON public.amora_saved_notes;
CREATE POLICY amora_saved_notes_insert ON public.amora_saved_notes
  FOR INSERT TO authenticated
  WITH CHECK (saved_by = auth.uid() AND public.is_my_couple(couple_id));

DROP POLICY IF EXISTS amora_saved_notes_update ON public.amora_saved_notes;
CREATE POLICY amora_saved_notes_update ON public.amora_saved_notes
  FOR UPDATE TO authenticated
  USING (public.is_my_couple(couple_id))
  WITH CHECK (public.is_my_couple(couple_id));

-- 삭제는 커플 누구나 가능하다. 모아 둔 목록은 둘의 것이고, 지우지 못하면
-- 잘못 저장한 것이 계속 쌓인다.
DROP POLICY IF EXISTS amora_saved_notes_delete ON public.amora_saved_notes;
CREATE POLICY amora_saved_notes_delete ON public.amora_saved_notes
  FOR DELETE TO authenticated
  USING (public.is_my_couple(couple_id));

REVOKE ALL ON TABLE public.amora_saved_notes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.amora_saved_notes TO authenticated;
GRANT ALL ON TABLE public.amora_saved_notes TO service_role;

COMMENT ON TABLE public.amora_saved_notes IS
  '아모라 대화에서 커플이 따로 모아 둔 원문. 요약·해석은 저장하지 않는다.';
