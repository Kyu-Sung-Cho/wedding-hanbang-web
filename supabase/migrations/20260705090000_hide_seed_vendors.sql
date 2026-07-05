-- 시드(가공) 업체 전량 비노출 — 2026-07-05 Management API로 프로덕션 적용 완료 (기록용)
--
-- 배경: approved 업체 52곳이 전부 시드 데이터였음 ("C 메이크업", "B 드레스" 등
-- 창작 업체 + 실존 브랜드명 무단 사용 사례 포함). 실업체 확인: owner_id 보유 0건.
-- 전략 확정 결정("업체 기능은 공급 확보 전 숨김 유지")이 데이터에서 미집행된 상태였고,
-- 가공 업체가 업체 탐색·AI 추천에 실존처럼 노출되는 것은 "중립·신뢰" 포지션과
-- 정면 충돌 + 상표/표시광고 리스크.
--
-- 노출 경로는 전부 status='approved' 필터(웹 /api/vendors·AI vendorTools 검색/추천·
-- 모바일 목록)라 status 전환만으로 모든 표면에서 제거됨.
-- 복원 규칙: 실업체 온보딩 시작 시 개별 재승인만 허용 (일괄 re-approve 금지).
--
-- 적용 결과: 52행 pending 전환 → 분포 pending 176 / rejected 1 / approved 0.
-- 원격 검증: /api/vendors total=0 확인.

UPDATE vendors SET status = 'pending' WHERE status = 'approved' AND owner_id IS NULL;
