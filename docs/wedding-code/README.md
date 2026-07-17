# WeddingCode 문서 권위·상태 인덱스

최종 갱신: 2026-07-17

현재 운영 판정: **Production 수집·결과·커플 비교 차단 유지**

> [!IMPORTANT]
> 이 디렉터리의 문서는 작성 시점이 서로 다르다. 과거 문서의 `PASS`, 구현 완료, Production QA,
> 점수, 유형, overlap 또는 공유 사양은 현재 승인으로 해석하지 않는다. 아래 권위 순서와 상태가
> 파일 본문보다 우선한다.

## 1. 권위 순서

1. [`55_conservative_readiness_audit_2026-07-15.md`](./55_conservative_readiness_audit_2026-07-15.md)
   — 현재 출시 차단, public/API/DB containment, 재개 게이트의 최상위 기준
2. [`56_candidate5_research_spec_2026-07-17.md`](./56_candidate5_research_spec_2026-07-17.md)
   — 유일한 Candidate 5 연구 설계안. **미검증이며 runtime·수집·출시 승인이 아님**
3. [`57_candidate5_item_evidence_matrix_2026-07-17.md`](./57_candidate5_item_evidence_matrix_2026-07-17.md)
   — Candidate 5 문항별 상황 소재 근거와 측정 타당도 상태
4. `00`, `02a`, `02b`, `22` — 연구 원칙·출처 정독·근거 백본 참고 자료. 개별 문항의
   타당도나 결과 공식을 승인하지 않음
5. 그 밖의 문서 — 역사·감사 추적용. 위 문서와 충돌하면 사용하지 않음

## 2. 상태표

| 문서/범위 | 상태 | 허용되는 용도 | 금지되는 용도 |
|---|---|---|---|
| `55` | `AUTHORITATIVE-CURRENT` | containment와 출시 게이트 판정 | 차단을 우회하는 근거 |
| `56` | `AUTHORITATIVE-RESEARCH-DRAFT / UNVALIDATED` | 정적 연구 설계·사람 검증 준비 | runtime 연결, 응답 수집, 결과 제공 |
| `57` | `AUTHORITATIVE-RESEARCH-COMPANION / M0` | 문항별 근거 한계·편향·폐기 기준 추적 | 과학적·정확한 검사 주장 |
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
- Candidate 5 연구 코드는 `apps/web/src/lib/weddingCode/research/`에만 둘 수 있고, legacy score,
  report, answers, share, storage 또는 Candidate 4 상수를 import할 수 없다.
- Candidate 5 연구 모듈도 Production route/component에서 import하면 안 된다. 정적 스키마와
  데이터 요청이 없는 프로토타입 검증만 허용한다.

## 4. 재개 전 필수 인간 게이트

아래는 문서나 자동 테스트로 대신할 수 없으며 현재 모두 **미통과**다.

- Candidate 5 exact-version 인지면접 `n=5`
- 두 wave 미니테스트 `n=20`
- 독립 동의한 실제 커플 최소 3쌍의 비난·도구화 검증
- 측정/설문 또는 관계·소비자 연구 전문가 검토
- 개인정보·소비자 안전 담당자의 서면 승인
- 별도 Production 재개 PR과 운영 승인

이 게이트가 끝나기 전에는 “검증됨”, “정확한 웨딩 성향”, “궁합”, “성공 예측”을 말하거나
현재 containment를 해제하지 않는다.
