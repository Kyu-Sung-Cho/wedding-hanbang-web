-- ============================================
-- RLS 정책 수정 + 시드 데이터
-- ============================================

-- contracts: 고객 SELECT 정책 수정 (customer_id = couple_id이므로 profiles 통해 확인)
DROP POLICY IF EXISTS "고객: 본인 계약 조회" ON contracts;
CREATE POLICY "고객: 본인 계약 조회" ON contracts FOR SELECT
  USING (
    customer_id = auth.uid()
    OR customer_id IN (SELECT couple_id FROM profiles WHERE id = auth.uid() AND couple_id IS NOT NULL)
  );

-- contracts: 고객 UPDATE 정책 추가 (서명 + viewed 상태 업데이트)
CREATE POLICY "고객: 본인 계약 업데이트" ON contracts FOR UPDATE
  USING (
    customer_id = auth.uid()
    OR customer_id IN (SELECT couple_id FROM profiles WHERE id = auth.uid() AND couple_id IS NOT NULL)
  );

-- payments: 고객 INSERT 정책 (결제 생성)
CREATE POLICY "고객: 본인 결제 생성" ON payments FOR INSERT
  WITH CHECK (customer_id = auth.uid());

-- payments: 고객 UPDATE 정책 (결제 완료/환불)
CREATE POLICY "고객: 본인 결제 업데이트" ON payments FOR UPDATE
  USING (customer_id = auth.uid());

-- settlements: 관리자 정산 관리 정책
CREATE POLICY "관리자: 전체 정산 관리" ON settlements FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ============================================
-- 표준 계약 템플릿 시드 데이터
-- ============================================
INSERT INTO contract_templates (category, title, content, cancellation_policy, default_deposit_rate)
VALUES
  (
    'studio',
    '스튜디오 촬영 표준계약서',
    '[{"title":"촬영 일정","body":"촬영은 계약서에 명시된 날짜와 시간에 진행되며, 일정 변경은 최소 7일 전에 사전 협의가 필요합니다."},{"title":"촬영 구성","body":"촬영 구성은 상품 설명에 따르며, 추가 컷/앨범/액자 등은 별도 비용이 발생합니다."},{"title":"보정 및 납품","body":"촬영 후 보정본은 4~6주 이내에 전달되며, 원본 데이터는 별도 협의 시 제공됩니다."},{"title":"초상권","body":"촬영된 사진은 업체 포트폴리오 및 홍보 목적으로 사용될 수 있습니다. 미동의 시 사전 고지 바랍니다."}]',
    '[{"daysBefore":30,"refundPercent":100,"label":"30일 전: 100% 환불"},{"daysBefore":14,"refundPercent":80,"label":"14일 전: 80% 환불"},{"daysBefore":7,"refundPercent":50,"label":"7일 전: 50% 환불"},{"daysBefore":3,"refundPercent":20,"label":"3일 전: 20% 환불"},{"daysBefore":0,"refundPercent":0,"label":"당일: 환불 불가"}]',
    0.3
  ),
  (
    'dress',
    '드레스 대여 표준계약서',
    '[{"title":"대여 기간","body":"드레스 대여는 본식 당일 기준이며, 사전 피팅 1회가 포함됩니다."},{"title":"관리 책임","body":"대여 기간 중 훼손/분실 시 수선비 또는 원가의 일부를 부담할 수 있습니다."},{"title":"변경 및 수선","body":"피팅 시 기본 수선(기장 조절 등)이 포함되며, 대폭 수선은 추가 비용이 발생합니다."}]',
    '[{"daysBefore":30,"refundPercent":100,"label":"30일 전: 100% 환불"},{"daysBefore":14,"refundPercent":70,"label":"14일 전: 70% 환불"},{"daysBefore":7,"refundPercent":50,"label":"7일 전: 50% 환불"},{"daysBefore":0,"refundPercent":0,"label":"당일: 환불 불가"}]',
    0.2
  ),
  (
    'makeup',
    '메이크업 표준계약서',
    '[{"title":"서비스 내용","body":"본식 당일 메이크업 + 헤어 서비스가 포함되며, 리허설은 별도 협의합니다."},{"title":"시간 및 장소","body":"본식 시작 시간에 맞춰 출장 또는 매장에서 진행됩니다."},{"title":"추가 인원","body":"신부 외 추가 인원(어머님, 혼주 등)은 별도 비용이 발생합니다."}]',
    '[{"daysBefore":14,"refundPercent":100,"label":"14일 전: 100% 환불"},{"daysBefore":7,"refundPercent":80,"label":"7일 전: 80% 환불"},{"daysBefore":3,"refundPercent":50,"label":"3일 전: 50% 환불"},{"daysBefore":0,"refundPercent":0,"label":"당일: 환불 불가"}]',
    0.3
  ),
  (
    'venue',
    '예식장 표준계약서',
    '[{"title":"예식 일시","body":"예식은 계약서에 명시된 날짜, 시간, 홀에서 진행됩니다."},{"title":"하객 인원","body":"보증 인원을 초과하는 하객에 대해 추가 식대가 부과될 수 있습니다."},{"title":"부대 시설","body":"신부 대기실, 폐백실 등 부대 시설 이용 조건은 예식장 규정에 따릅니다."},{"title":"외부 반입","body":"외부 업체(꽃, 사진 등) 반입 시 사전 허가가 필요합니다."}]',
    '[{"daysBefore":60,"refundPercent":100,"label":"60일 전: 100% 환불"},{"daysBefore":30,"refundPercent":70,"label":"30일 전: 70% 환불"},{"daysBefore":14,"refundPercent":50,"label":"14일 전: 50% 환불"},{"daysBefore":7,"refundPercent":30,"label":"7일 전: 30% 환불"},{"daysBefore":0,"refundPercent":0,"label":"당일: 환불 불가"}]',
    0.3
  )
ON CONFLICT DO NOTHING;
