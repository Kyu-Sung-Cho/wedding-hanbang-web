# Source Close Reading — 한국소비자원 참가격 결혼서비스 가격조사

> 02 템플릿의 두 번째 실정독. 웨딩한방은 이 데이터를 자동 수집 파이프라인
> (`npm run update:market-prices` → `marketPricesData.generated.ts`)으로 사용 중이며
> 시세표·견적 체크의 지역 중위가 비교가 전부 여기서 나온다.

## Source Title
한국소비자원 참가격 — 결혼서비스 가격조사

## Source URL
price.go.kr (공공데이터)

## Source Type
공공기관 가격조사 (2025-04 첫 조사, 2025-05-28 공개, 이후 격월 갱신 — 레포 반영 기준 2026-04 데이터)

## Source Grade
A

## Date Accessed
2026-06-11 (자동 수집 파이프라인 구축) / 2026-07-05 (본 정독 기록)
※ 2026-07-05 수집 재실행 시 응답 0건으로 fail-closed — 격월 갱신 전 스크립트/원문 구조 재확인 필요 (백로그).

## What The Source Actually Says
- 스드메 패키지·스튜디오·드레스·메이크업·예식장(대관·식대)의 지역별 중위가
- 핵심 구조 사실: **서울과 경기/인천의 스드메 패키지 중위가가 크게 벌어짐**
  (서울 350만대 vs 경기/인천 230만대 규모 — 지역 무시 비교는 정상 견적을 오판하게 만듦)
- 격월 발표 = 시점 명기가 필수인 변동 데이터

## Directly Usable Concepts
- "예산 초과"는 절대액이 아니라 지역 기준 대비 개념이라는 것 → q13의 300만원 시나리오가
  비현실적 과장이 아님(지역 간 격차가 실제 그 규모)
- 출처 있는 중위가 "참고 표시"만 하고 판정하지 않는 원칙(제품 확정 결정)이
  웨딩코드 문항에도 동일 적용되어야 함

## What Must Not Be Copied
해당 없음 — 가격 통계이며 검사 자료가 아님.

## Connected WeddingCode Constructs
costRisk (직접) / evidenceDecision (직접 — "실제 가격 비교"라는 근거 행동의 대상) / experienceMeaning (간접 — 의미 지출 판단의 기준선)

## Product Implications
시세표(/market-prices)·견적 체크의 marketComparatorLabel(비교 기준 명시)이 이 데이터 기반. 웨딩코드 비용 문항의 라우팅 목적지가 이미 라이브다.

## Possible Report Language
"한국소비자원 참가격(YYYY-MM 기준) 지역 중위가와 비교하면 —" 형태. 판정 언어 금지(좋다/나쁘다/바가지).

## Remaining Unknowns
관계·가족·커플 역학 구인에 대한 근거 없음(가격 데이터). 얼리스타트·헬퍼 등 세부 옵션 단가의 지역 편차는 항목별 확인 필요.

## Claim Status
confirmed (파이프라인 검증·라이브 표기 중 — 단 시점 명기 필수)

## Notes
격월 갱신 실패(2026-07-05) 건은 유지보수 백로그 — 데이터 자체의 신뢰성 문제가 아니라 수집 스크립트/원문 구조 변경 이슈.
