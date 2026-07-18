# WeddingCode 문서 권위·상태 인덱스

최종 갱신: 2026-07-18 — Candidate 6.3 근거·순서·보안·모바일 계약 개정

현재 운영 판정: **Production 수집·결과·커플 비교 차단 유지**

> [!IMPORTANT]
> 이 디렉터리의 문서는 작성 시점이 서로 다르다. 과거 문서의 `PASS`, 구현 완료, Production QA,
> 점수, 유형, overlap 또는 공유 사양은 현재 승인으로 해석하지 않는다. 아래 권위 순서와 상태가
> 파일 본문보다 우선한다.

## 먼저 읽기

전체 제품 생각, 설계 계보, 현재 구현, 21개 문항 풀, 사람 검증, 안전한 공유·아모라 적용 방향을
한 번에 보려면 [`62_wedding_code_master_design_and_current_state_2026-07-18.md`](./62_wedding_code_master_design_and_current_state_2026-07-18.md)를
먼저 읽는다. 이 통합 문서는 이해를 위한 진입점이며, 운영 출시 승인은 아니다. 충돌 시 아래 권위
순서가 우선한다. exact 문구와 schema 표현은 코드가 source of truth지만, 코드 drift가 연구·안전
계약이나 운영 차단을 덮어쓰지는 않는다.

## 1. 권위 순서

1. [`55_conservative_readiness_audit_2026-07-15.md`](./55_conservative_readiness_audit_2026-07-15.md)
   — 현재 출시 차단, public/API/DB containment, 재개 게이트의 최상위 기준
2. [`58_candidate6_product_research_contract_2026-07-17.md`](./58_candidate6_product_research_contract_2026-07-17.md)
   — Candidate 6.3의 next-research 제품·측정·로컬 프로토타입 계약. **전 문항 M0이며 출시 승인이 아님**
3. [`59_candidate6_item_evidence_matrix_2026-07-17.md`](./59_candidate6_item_evidence_matrix_2026-07-17.md)
   — Candidate 6.3 문항별 대안 해석·편향·폐기 기준
4. [`60_candidate6_validation_execution_kit_2026-07-17.md`](./60_candidate6_validation_execution_kit_2026-07-17.md)
   — 사람 검증 실행 준비안. 모집·녹음·수집 승인이 아님
5. [`61_candidate6_productization_roadmap_2026-07-18.md`](./61_candidate6_productization_roadmap_2026-07-18.md)
   — 안전한 재미·공유·아모라 적용을 위한 제품화 순서. 운영 출시 승인이 아님
6. `56`, `57` — Candidate 5 연구 계보와 이전 문제의 비교 기준. 새 구현 기준은 아님
7. `00`, `02a`, `02b`, `22` — 연구 원칙·출처 정독·근거 백본 참고 자료. 개별 문항의
   타당도나 결과 공식을 승인하지 않음
8. 그 밖의 문서 — 역사·감사 추적용. 위 문서와 충돌하면 사용하지 않음

## 2. 상태표

| 문서/범위 | 상태 | 허용되는 용도 | 금지되는 용도 |
|---|---|---|---|
| `62` | `MASTER OVERVIEW / NOT LAUNCH APPROVAL` | 전체 설계·현재 상태·계보 이해 | 운영 차단 해제, 점수·유형 승인 |
| `55` | `AUTHORITATIVE-CURRENT` | containment와 출시 게이트 판정 | 차단을 우회하는 근거 |
| `58` | `AUTHORITATIVE-NEXT-RESEARCH / UNVALIDATED / M0` | Candidate 6.3 정적·로컬 연구 설계 | public runtime, 응답 수집, 결과 제공 |
| `59` | `AUTHORITATIVE-RESEARCH-COMPANION / M0` | Candidate 6.3 문항별 근거 한계·편향·폐기 기준 | 과학적·정확한 검사 주장 |
| `60` | `RESEARCH-EXECUTION-DRAFT` | 사람 검증 준비 | 모집·녹음·수집 승인 |
| `61` | `PRODUCT-DIRECTION / UNVALIDATED` | 안전한 소비자 여정·공유·제품화 순서 | 운영 출시 승인 |
| `56`, `57` | `SUPERSEDED-RESEARCH-LINEAGE / M0` | Candidate 5 계보·회귀 비교 | 새 제품·연구 구현 기준 |
| `00`, `02a`, `02b`, `22` | `REFERENCE-ONLY` | 출처 품질·시장 장면·안전 원칙 참고 | 선택지·축·점수의 타당도 주장 |
| `21` | `RETIRED` | 과거 성장 아이디어 감사 | 답 공개, 분포, 유형, 게임화 구현 |
| `23`–`47` | `RETIRED / SUPERSEDED` | Candidate 4 이전 의사결정 추적 | 문항·가중치·score·overlap·Production 절차 재사용 |
| `48`, `49`, `51` | `RETIRED` | 과거 실행 계획 보존 | 모집·수집·SQL·운영 실행 |
| `52`–`54` | `SUPERSEDED` | 과거 카피·구현 기록 보존 | Candidate 5 카피 또는 출시 근거 |
| 그 외 `01`–`20` | `HISTORICAL / REFERENCE-ONLY` | 초기 가설의 출처 추적 | 현행 제품 사양으로 직접 사용 |

## 3. 코드 상태

- `apps/web/src/constants/weddingCodeV05.ts`, `apps/web/src/lib/weddingCode/*`,
  `WeddingCodeClient.tsx`, `ResultClient.tsx`는 Candidate 4의 **휴면 legacy/retired 구현**이다.
- public 안내-only, result redirect, `410 Gone` API, DB write fence 때문에 현재 실행 경로가 아니다.
- Candidate 5/6 연구 코드는 `apps/web/src/lib/weddingCode/research/`에만 둘 수 있고, legacy score,
  report, answers, share, storage 또는 Candidate 4 상수를 import할 수 없다.
- Candidate 6.3의 item/schema, source linkage와 UI도 같은 연구 디렉터리에 둔다. page module은
  `localPreviewPage.tsx`이며 전용 dev wrapper가 무추적 route를 실행 중에만 생성한다. 운영 빌드와
  연구 실행은 같은 exclusive lock을 쓰고, build 뒤 manifest/static/server 후보 문자열을 재검사한다.
- Candidate 6.3 R1은 recording/vendor-assisted/partner-collaboration screener를 먼저 거치며, 같은 theme
  적격 대체가 없으면 `incompatible`로 투여를 막고 item별 assigned/administered/eligible/non-applicable을
  기록한다. `eligibilityAtAssignment`와 `responseDisposition`은 독립 필드라 사전 적격과 사후 비해당을
  한 row에 함께 보존한다. 다만 exact-version·Form/orientation·support order·원문항→대체문항·전체 노출
  균형을 잇는 완성 연구 원장은 아직 미구현이다. 이 운영 규칙도 사람 타당도 근거나 수집 승인이 아니다.
- 위 로컬 경로는 React memory state만 사용하고 전역 analytics/UTM·외부 CSP를 차단한다. Candidate 5/6 모두 Production·Preview route,
  API, DB, analytics, browser storage, 점수·유형·overlap에 연결하면 안 된다.

## 4. 재개 전 필수 인간 게이트

아래는 문서나 자동 테스트로 대신할 수 없으며 현재 모두 **미통과**다.

- 대상자 concept elicitation과 Candidate 6.3 반복 인지면접
- simulation/power 계획에 따른 파일럿과 별도 구조 검증
- 독립 동의한 실제 커플 최소 3쌍의 비난·도구화 검증
- 측정/설문 또는 관계·소비자 연구 전문가 검토
- 개인정보·소비자 안전 담당자의 서면 승인
- 별도 Production 재개 PR과 운영 승인

이 게이트가 끝나기 전에는 “검증됨”, “정확한 웨딩 성향”, “궁합”, “성공 예측”을 말하거나
현재 containment를 해제하지 않는다.
