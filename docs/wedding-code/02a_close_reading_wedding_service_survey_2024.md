# Source Close Reading — 결혼서비스 실태조사 (2024)

> 02 템플릿의 첫 실정독. 아래 수치는 웨딩한방 제품(`apps/web/src/constants/hiddenCosts.ts`,
> 유통 게시글, 견적 체크 요약문)에서 이미 인용·라이브 표기 중인 검증된 범위만 옮긴 것이다.
> 새로 추가하는 수치는 원문 재확인 전까지 등재 금지.

## Source Title
결혼서비스 실태조사 (2024)

## Source URL
정부 발표 자료 (보건복지부·기획재정부) — 원문 링크는 원문 재확인 시 병기

## Source Type
정부 실태조사 (2024-05~11 조사, 2024-11-14 발표)

## Source Grade
A

## Date Accessed
2026-06-11 (제품 데이터 구축 시) / 2026-07-05 (본 정독 기록)

## What The Source Actually Says
- 스드메 기본 계약금 평균 346만원 → 실제 지불 평균 520만원 (추가금 평균 174만원, 약 +50%)
- 추가 항목 이용률: 원본 데이터 구매 59.4% / 앨범 추가 68.1% / 본식 촬영 67.2% / 헬퍼비 55.0%
- 개별 가격 고지 비율 34.3% (= 3곳 중 2곳은 항목별 가격을 사전 고지하지 않음)
- 현금 결제 유도 78.1%

## Directly Usable Concepts
- "계약 시점 가격 ≠ 최종 지불 가격"이 통계적 상수라는 것 → `costRisk` 구인의 실재 근거
- 가격 불투명(고지율 34.3%)이 소비자 행동이 아니라 시장 구조라는 것 → 문항에서
  "확인하는 사람"을 의심 많은 사람으로 그리면 안 되는 이유(레드팀의 money-shaming 가드와 연결)
- 추가금이 특정 항목(원본·앨범·헬퍼)에 집중된다는 것 → q01·q02·q12의 시나리오 사실성

## What Must Not Be Copied
해당 없음 — 통계 조사이며 검사 문항·유형 체계가 아님.

## Connected WeddingCode Constructs
costRisk (직접) / evidenceDecision (직접) / decisionPaceRisk (간접 — 불투명 구조가 성급 계약 리스크를 키움) / guidanceNeed (간접 — 항목 복잡성이 압축 안내 수요의 근거)

## Product Implications
견적 체크(/check)의 존재 이유 그 자체. 웨딩코드 비용 계열 문항이 이 도구로 라우팅되는 것은 자연스러운 연결이다.

## Possible Report Language
"결혼서비스 실태조사(2024)에서는 스드메 계약금 외 추가 지불이 평균 174만원으로 보고됐어요" — 이미 제품에서 사용 중인 문형. 출처·기준 시점 병기 필수.

## Remaining Unknowns
관계·가족 역학(coPreparation, familyIntegration 등)에 대한 데이터는 이 조사에 없음 — 해당 구인은 별도 근거 필요.

## Claim Status
confirmed (수치 한정 — 제품에서 인용·표기 검증됨)

## Notes
표시광고 리스크 규칙: 수치 인용 시 화면에 출처·기준 시점 병기 (hiddenCosts.ts 헤더 규칙 준수).
