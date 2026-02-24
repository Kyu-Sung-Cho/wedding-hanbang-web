-- ============================================================
-- 004: RLS 정책 강화 - 무한 재귀 수정 + service role 우회 제거
-- Supabase SQL Editor에서 실행
-- ============================================================

-- ═══════════════════════════════════════════
-- 핵심 수정: profiles 무한 재귀 해결
-- ═══════════════════════════════════════════

-- 기존 profiles_select_couple 정책이 profiles 자체를 참조해서 무한 재귀 발생
-- profiles → profiles 대신 profiles → couples 로 변경
DROP POLICY IF EXISTS "profiles_select_couple" ON profiles;
CREATE POLICY "profiles_select_couple" ON profiles FOR SELECT
  USING (
    id IN (
      SELECT bride_id FROM couples WHERE bride_id = auth.uid() OR groom_id = auth.uid()
      UNION
      SELECT groom_id FROM couples WHERE bride_id = auth.uid() OR groom_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════
-- wedding_journeys: profiles 대신 couples 직접 확인
-- (기존 정책도 profiles 서브쿼리 → 재귀 위험)
-- ═══════════════════════════════════════════

-- 기존 정책 교체 (profiles 서브쿼리 → couples 서브쿼리)
DROP POLICY IF EXISTS "journeys_select_couple" ON wedding_journeys;
CREATE POLICY "journeys_select_couple" ON wedding_journeys FOR SELECT
  USING (
    couple_id IN (
      SELECT id FROM couples
      WHERE bride_id = auth.uid() OR groom_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "journeys_insert_couple" ON wedding_journeys;
CREATE POLICY "journeys_insert_couple" ON wedding_journeys FOR INSERT
  WITH CHECK (
    couple_id IN (
      SELECT id FROM couples
      WHERE bride_id = auth.uid() OR groom_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "journeys_update_couple" ON wedding_journeys;
CREATE POLICY "journeys_update_couple" ON wedding_journeys FOR UPDATE
  USING (
    couple_id IN (
      SELECT id FROM couples
      WHERE bride_id = auth.uid() OR groom_id = auth.uid()
    )
  );

-- 중복 정책 제거 (위에서 이미 교체했으므로)
DROP POLICY IF EXISTS "journeys_insert_via_couple" ON wedding_journeys;
DROP POLICY IF EXISTS "journeys_update_via_couple" ON wedding_journeys;
DROP POLICY IF EXISTS "journeys_select_via_couple" ON wedding_journeys;

-- ═══════════════════════════════════════════
-- chat_messages: profiles 대신 couples 직접 확인
-- ═══════════════════════════════════════════

DROP POLICY IF EXISTS "chat_select_couple" ON chat_messages;
CREATE POLICY "chat_select_couple" ON chat_messages FOR SELECT
  USING (
    couple_id IN (
      SELECT id FROM couples
      WHERE bride_id = auth.uid() OR groom_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_insert_couple" ON chat_messages;
CREATE POLICY "chat_insert_couple" ON chat_messages FOR INSERT
  WITH CHECK (
    couple_id IN (
      SELECT id FROM couples
      WHERE bride_id = auth.uid() OR groom_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════
-- 커플 조인 함수 (SECURITY DEFINER)
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION join_couple(p_invite_code TEXT, p_role TEXT)
RETURNS jsonb AS $$
DECLARE
  v_couple RECORD;
BEGIN
  SELECT * INTO v_couple FROM couples WHERE invite_code = p_invite_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', '유효하지 않은 초대 코드입니다.');
  END IF;

  IF p_role = 'bride' THEN
    IF v_couple.bride_id IS NOT NULL THEN
      RETURN jsonb_build_object('error', '이미 신부가 연동되어 있습니다.');
    END IF;
    UPDATE couples SET bride_id = auth.uid(), updated_at = NOW() WHERE id = v_couple.id;
  ELSIF p_role = 'groom' THEN
    IF v_couple.groom_id IS NOT NULL THEN
      RETURN jsonb_build_object('error', '이미 신랑이 연동되어 있습니다.');
    END IF;
    UPDATE couples SET groom_id = auth.uid(), updated_at = NOW() WHERE id = v_couple.id;
  ELSE
    RETURN jsonb_build_object('error', '유효하지 않은 역할입니다.');
  END IF;

  UPDATE profiles
  SET couple_id = v_couple.id, role = p_role, updated_at = NOW()
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'success', true,
    'couple_id', v_couple.id,
    'invite_code', v_couple.invite_code
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
