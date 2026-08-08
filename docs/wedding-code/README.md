# WeddingCode 문서 권위·상태 인덱스

최종 갱신: 2026-07-31 — 공개 장면 대화 도구, 네 글자 응답 요약, 측정 연구 경계 분리

전체 작업 트리와 GitHub/Web/DB/Community/Mobile 릴리스 상태는
`docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`를 따른다. 이 문서는
WeddingCode 제품·연구 경계의 영역 정본이며 전체 배포 승인이 아니다.

현재 운영 판정:

- **Candidate 6.3 측정 연구의 Production 수집·결과·커플 비교 차단 유지**
- 위 차단에는 점수·유형·궁합 결과와 커플 비교 결과의 Production 제공이 모두 포함된다.
- `/wedding-code` 장면 대화 도구는 공개 가능. 단, 응답 DB 저장·성격 판정·궁합·성공 예측
  없이 본인이 고른 답의 집계·인용과 다음 대화 절차만 제공한다.
- **네 글자 코드는 제공한다**(2026-07-31 파운더 결정, `CLAUDE.md`·`PRINCIPLES.md` 갱신됨).
  코드는 축마다 어느 쪽 답을 더 많이 골랐는지를 적은 것이지 성격 판정이 아니다.
  - 축당 문항은 **홀수(5개)** 다. 짝수면 정확히 반반인 자리가 생겨 글자를 정할 수 없다
    (4문항일 때 축마다 26%, 네 글자가 모두 나올 확률은 30%밖에 안 된다).
  - 글자마다 **몇 대 몇이었는지**를 함께 보여준다. 3:2로 아슬한 글자는 **소문자**로 적고
    "다시 답하면 바뀔 수 있다"를 화면에서 먼저 알린다. MBTI가 숨기는 부분이다.
  - 건너뛰었거나 정확히 반반인 자리는 `·`로 두고 글자를 지어내지 않는다.
  - 두 코드는 **점수로 합치지 않는다.** 자리마다 같은지 다른지만 말하고, 다른 자리에서
    할 이야기는 기존 차이 지도가 맡는다.
  - 코드 옆 설명은 글자 뜻 한 줄과 **본인이 고른 문장 인용**뿐이다. 성격 설명·동물·
    캐릭터·등급은 붙이지 않는다.
- **코드만 아는 사람의 입구**: `/wedding-code/c/[code]`가 네 글자의 뜻과 반대쪽 글자를
  보여준다. 이 경로에는 개인 응답이 없다(코드에 누가 무엇을 골랐는지는 들어 있지 않다).
  없는 코드는 뜻을 지어내지 않고 404로 보내며 `noindex`를 붙인다.
- **색인은 라우트가 아니라 주소로 가른다.** 답은 fragment(`#`)에 있어 검색엔진이 볼 수
  없으므로 맨 `/wedding-code`는 `index, follow`다. 반면 과거 `?a=`·`?b=` 링크는 query에
  실제 응답이 들어 있어 `noindex, nofollow`다. 라우트째 막으면 「여러 예비부부가 쓰는
  도구」가 될 길이 없다 — 보호할 것은 응답이지 입구가 아니다.
- 개인 결과는 축마다 **셈(어느 쪽 답을 몇 번 골랐나)·인용(실제 고른 문장)·부재(한 번도
  고르지 않은 확인)** 세 가지와 상대에게 할 한 문장, 계약 전 확인 항목을 돌려준다.
  전부 사용자가 방금 남긴 응답에서 나오며, 사용자가 근거를 보고 직접 반증할 수 있다.
  이것은 잠재 특성 추정이 아니므로 유형·점수·등급·궁합이 아니지만, **문항 이해도와
  대화 유용성은 여전히 `UNVALIDATED`다.**
- **안 맞는 장면은 건너뛴다.** 부모님이 안 계시거나, 결혼식을 하지 않거나, 사진 촬영을
  하지 않는 사람에게 네 개 중 하나를 억지로 고르게 하는 것은 불편할 뿐 아니라 고르지도
  않은 답을 결과와 아모라 제안에 싣는 일이다. 건너뛴 문항은 공유 코드에 미응답(`-`)으로
  남고, 그 축은 결과에서 비운다. 답이 하나도 없으면 빈 결과 대신 안내를 띄우고 공유
  링크를 만들지 않는다(전부 미응답인 코드는 유효한 링크가 아니다).
- **서술형은 결과의 「상대에게 보낼 말」 한 곳에만 둔다.** 문항마다 자유 입력을 받으면
  그 글이 공유 링크(`#a=...`)에 실려 이름·집안 사정·금액이 카톡과 브라우저 기록에 남고,
  전달된 링크는 회수할 수 없다. 저장하는 쪽으로 바꾸면 로그인·동의·삭제·AI 로그 원문
  비복제가 한 묶음으로 딸려오므로 그건 아모라 쪽 설계다. 결과의 편집 상자는 링크에도
  저장소에도 들어가지 않고 사용자의 클립보드로만 나간다.
- **선택지는 고른 사람을 탓하지 않는다.** 솔직한 답과 자책하는 답은 다르다. 같은 행동도
  「고르는 게 지쳐서 그냥 정해달라고 했다」로 쓰면 고르는 순간 자기 흠을 인정하는 문장이
  되고, 사람들이 그 답을 피한 만큼 축이 기운다 — **불편함과 편향은 같은 자리에서 생긴다.**
  `솔직히`·`그냥`·`통보`·`하소연`·`지쳐서` 같은 말과 `잘못`·`무책임`류 판정어는 테스트가 막는다.
- v0.7 문항은 **기록체**로 쓴다. 「~하고 싶다」류 희망 사항 어미는 전체 선택지의 40%
  이하이고, 문항마다 조금 찔리는 답(`candid`)이 최소 하나 있어야 한다. 네 선택지가 전부
  사회적으로 옳으면 사람들은 자기가 한 일이 아니라 좋아 보이는 답을 고르고, 그 오염된
  답이 그대로 아모라 도움 방식 제안이 된다. 재미와 정확도가 같은 자리에서 갈린다.
  이 조건은 `constants/__tests__/weddingCodeV07.test.ts`가 기계로 강제한다.
- 아모라 연결은 **제안까지만** 열려 있다. `lib/weddingCode/profile/amoraBridge.ts`가
  응답을 기존 `amora_personalization_preferences` 값으로 옮기는 제안을 만들지만,
  저장·적용·네트워크 호출을 하지 않는다. 실제 반영은 사용자가 `/settings/amora-style`에서
  직접 고를 때만 일어난다. 커플 조합은 계정별 설정에 저장하지 않는다 — 갈린 축에서
  한 사람의 값으로 아모라를 맞추면 아모라가 자동으로 한쪽 편이 되기 때문이다.
- 공개 가능은 유용성이 검증됐다는 뜻이 아니다. 문항 이해도·선택지 포괄성·대화 유용성은
  사람 인지면접과 커플 사용성 검증 전까지 `UNVALIDATED`다.

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
| `63` | `PRODUCT-DESIGN-PLAN / LOCAL-PROTOTYPE-ONLY` | `61`의 §2·§3을 화면·카피·파일로 내린 실행 기획과 2026-07-28 로컬 실측 | 운영 출시 승인, 차단 해제, 점수·유형 승인 |
| `64` | `ADVERSARIAL-AUDIT / OPEN-FINDINGS` | `63` 구현(PR #75)의 독립 적대 감사. 반증 통과 21건과 머지 전 닫을 M1~M4 | 구현이 검증됐다는 근거(오히려 가드 결손을 지적한 문서다) |
| `/wedding-code` v0.6/v0.7 | `PUBLIC CONVERSATION TOOL / UNVALIDATED UTILITY` | 실제 선택 문장 비교, 본인 응답의 셈·인용·부재 요약, 장면별 다음 대화 제안, URL 공유 | 심리검사·성향 유형·궁합·갈등 또는 결혼 결과 예측 |
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
- 공개 `/wedding-code`는 Candidate 6.3 측정 코드와 별개다. `v0.6-scene`은 과거 공유 링크
  호환용이고, 새 진입은 `v0.7-plain`을 사용한다. 버전 없는 답 링크는 v0.6으로만 해석하며,
  알 수 없는 버전을 현재 문항으로 바꾸어 읽지 않는다.
- 공개 장면 도구의 응답은 DB나 브라우저 저장소에 저장하지 않는다. 새 링크는 답 코드를
  URL fragment(`#`)에 넣어 서버 요청과 referrer에서 제외하고, 이 경로의 제품 분석·세션
  녹화도 끈다. 다만 전체 링크를 받은 사람은 답을 볼 수 있으므로 공유 전에 알린다.
- 과거 `?a=`·`?b=` 링크는 v0.6 호환을 위해 읽은 뒤 fragment 링크로 바꾼다. 최초 요청이
  이미 서버에 도달한 과거 링크의 노출을 되돌릴 수는 없으므로 신규 공유에는 쓰지 않는다.

## 4. 재개 전 필수 인간 게이트

아래는 문서나 자동 테스트로 대신할 수 없으며 현재 모두 **미통과**다.

- 대상자 concept elicitation과 Candidate 6.3 반복 인지면접
- simulation/power 계획에 따른 파일럿과 별도 구조 검증
- 독립 동의한 실제 커플 최소 3쌍의 비난·도구화 검증
- 측정/설문 또는 관계·소비자 연구 전문가 검토
- 개인정보·소비자 안전 담당자의 서면 승인
- 별도 Production 재개 PR과 운영 승인

이 게이트가 끝나기 전에는 “검증됨”, “정확한 웨딩 성향”, “궁합”, “성공 예측”을 말하거나
Candidate 6.3 containment를 해제하지 않는다. 공개 장면 도구 역시 사람 검증 전에는
“유용성이 입증됨”, “최상”, “갈등을 예방함”이라고 말하지 않는다.
