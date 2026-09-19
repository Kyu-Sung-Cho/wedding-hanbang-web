# WeddingCode 문서 권위·상태 인덱스

2026-09-19 PDF 피드백 반영: [`2026-09-19_feedback_resolution.md`](./2026-09-19_feedback_resolution.md).
첫 반영에서는 문항의 뜻과 v1.0 계산을 유지하고 소개·결과 이해·취향 진입·선택 참여 안내를 보완했다.
이어진 문항별 교정은 [`2026-09-19_v11_question_revision.md`](./2026-09-19_v11_question_revision.md)에 기록한다.

최종 갱신: 2026-09-20 — 소비자 역할로 문항·결과·취향 경로를 재검토했다. 새 장면 진입은 v1.2-code이며 v1.1 및 이전 판의 원문·공유 링크는 보존한다. 문항 보완은 [소비자 관점 검토](./2026-09-20_consumer_walkthrough.md), 결과 보완은 [결과 카피 검토](./2026-09-20_result_copy_gate.md), 취향 보완은 [취향 질문 검토](./2026-09-20_taste_question_gate.md)를 따른다.

이 문서는 WeddingCode 제품·연구 경계의 영역 정본이며 전체 배포 승인이 아니다.
`docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`의 배포 식별자는 당시 기록이다.
현재 운영 반영은 해당 릴리스의 commit·검사·Vercel deployment·운영 도메인 관측으로 별도 확인한다.

**이번 변경의 상태:** 아래의 응답 요약 v2, 직접 도움 설정, 선택형 취향·개인 상담 연결은
현재 작업 트리에 구현됐다. 2026-09-19 수정과 2026-09-20 추가 수정 모두 로컬 전체 관문과 웹 빌드를 통과했다.
**로컬 최종 관문 PASS: 2026-09-20 02:14:11 KST. 다음 대화 8곳의 추가 보완까지 전체 관문과 빌드를 통과했다. 이 확인 시점에는 운영 배포 전이었다.** 이후 병합·배포 상태와 운영 확인 결과는 [릴리스 PR #431](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/431)의 commit·검사·Vercel 배포 기록을 따른다.
추가 수정의 범위와 최신 검증 상태는 [다음 대화 추가 검수](./2026-09-20_followup_conversation_review.md)를 따른다.
기본 교정은 [`v1.2 교정 기록`](./2026-09-19_v12_question_revision.md), 최신 실행 결과와 미검증 범위는
[`소비자 역할 테스트 기록`](./2026-09-20_consumer_walkthrough.md)을 따른다.
이 문서를 사람 검증이나 운영 반영 영수증으로 사용하지 않는다. 상세 설계는
[`2026-09-09_direct_preferences_design.md`](./2026-09-09_direct_preferences_design.md)를 따른다.

공개 제품과 측정 연구의 경계:

- 2026-09-12 경험 설명 보완: D4의 즉석 계약 경험과 D1의 대화 중단 등을
  할 일 정리·마음 듣기 행동으로 단정하지 않는다. M/H/A 설명을 답의 주제로 한정하고
  실제 선택한 원문에만 필요한 안내를 덧붙인다. 문항·집계·공유 코드는 유지한다.
  [변경 범위·22개 솔직한 답 검토·회귀 증거](./2026-09-12_response_experience_copy_review.md)는
  로컬 검증 기록이며 운영 배포나 사람 타당도 검증 완료를 뜻하지 않는다.

- 2026-09-11 응답 설명 정정 후보: B5의 연락 지연을 실제 공동 검토로 단정하지 않고,
  1응답을 포함한 결과 제목은 ‘이번에 고른 것’으로 적는다. 문항·집계·기존 공유 코드는
  유지한다. [변경 범위·주장 감사](./2026-09-11_response_copy_claim_review.md)는 로컬 검증 기록이며
  운영 배포나 사람 타당도 검증 완료를 뜻하지 않는다.

- **Candidate 6.3 측정 연구의 Production 수집·결과·커플 비교 차단 유지**
- 위 차단은 Candidate 6.3 측정 연구의 점수·유형·궁합·커플 비교에 적용한다.
  아래 공개 장면·직접 취향의 실제 선택 나란히 보기를 측정 연구 결과로 소개하지 않는다.
- `/wedding-code` 장면 대화 도구는 공개 가능. 단, 응답 DB 저장(아래 §3의 본인 동의 익명
  보태기만 예외)·성격 판정·궁합·성공 예측 없이 본인이 고른 답의 집계·인용과 다음 대화 절차만 제공한다.
- **네 글자 코드는 제공한다**(2026-07-31 파운더 결정, `CLAUDE.md`·`PRINCIPLES.md` 갱신됨).
  코드는 축마다 어느 쪽 답을 더 많이 골랐는지를 적은 것이지 성격 판정이 아니다.
  - 현재 `v1.2-code`는 **4개 축·축당 5개, 총 20장면**이다. 선택지 뜻이 바뀌면 판을 올리고, 옛 판
    (`v1.1-code`·`v1.0-code`·`v0.9-code`·`v0.8-code`)은 그 판으로 만든 링크를 열 때만 쓴다(판 → 문항 표는 `lib/weddingCode/scene/config.ts`).
    v1.2는 실제 구분되는 보기만 2~4개 남겼다(`constants/weddingCodeV12.ts`). 보기 수나 양극의 노출 수가 같다는 주장은 하지 않는다.
  - 글자마다 **응답한 장면 수와 양쪽 답의 수**를 함께 보여준다. 양쪽 답이 있고 한 표 차이면
    소문자로 적는다. 부분 응답에서 글자가 나올 수 있지만 전체 완료로 표시하지 않는다.
  - 축의 답이 없거나 정확히 반반이면 `·`로 두고 글자를 지어내지 않는다.
  - 분포 설명은 "모두 같은 쪽", "한쪽이 더 많음", "하나 차이", 글자가 없으면 "글자 비움"이다
    (2026-09-17 개정). 이를 사람의 확신·심리적 신뢰도·재응답 안정성으로 해석하지 않는다.
  - 결과 배지 아래 「네 글자 읽는 법」은 접지 않는다. 축마다 **양쪽 글자와 짧은 이름**(예:
    V 조건 먼저 ↔ M 분위기 먼저), 답한 장면 하나당 한 칸인 막대, 셈 문장("답한 5장면 중
    4장면은 V(조건 먼저), 1장면은 M(분위기 먼저) 쪽이었어요.")을 함께 보여준다. 숫자·영문
    바로 뒤에는 조사를 붙이지 않고, 막대 너비는 비율로 계산하지 않는다(백분율 없음).
    가드: `profile/__tests__/resultCopyGuards.test.ts`, `app/wedding-code/WeddingCodeBadge.test.tsx`.
  - 두 코드는 **점수로 합치지 않는다.** 자리마다 같은지 다른지만 말하고, 다른 자리에서
    할 이야기는 기존 차이 지도가 맡는다.
  - 코드 옆 설명은 글자 뜻 한 줄과 **본인이 고른 문장 인용**뿐이다. 성격 설명·동물·
    캐릭터·등급은 붙이지 않는다.
- **코드만 아는 사람의 입구**: `/wedding-code/c/[code]`가 네 글자가 다루는 공통 주제와 반대쪽 글자를
  보여준다. 이 경로에는 문항 판과 개인 응답이 없으므로 어떤 문항에서 무엇을 골랐다고 설명하지 않는다.
  정확한 풀이는 함께 받은 응답 결과 링크에서 확인하도록 안내한다.
  없는 코드는 뜻을 지어내지 않고 404로 보내며 `noindex`를 붙인다.
- **색인과 공유는 별도 경계다.** 맨 `/wedding-code`는 `index, follow`, 과거 `?a=`·`?b=`
  응답 링크는 `noindex, nofollow`다. 새 답은 서버 요청·referrer에 포함되지 않는 fragment(`#`)에
  싣는다. fragment는 암호화나 접근 제어가 아니며 전체 링크를 받은 사람은 답을 읽을 수 있다.
  새 `/wedding-code/taste`는 `noindex, nofollow`와 `no-referrer`를 사용한다.
- 개인 결과는 축마다 **셈(어느 쪽 답을 몇 번 골랐나)·인용(실제 고른 문장)·부재(한 번도
  고르지 않은 확인)** 세 가지와 상대에게 할 한 문장, 계약 전 확인 항목을 돌려준다.
  전부 사용자가 방금 남긴 응답에서 나오며, 사용자가 근거를 보고 직접 반증할 수 있다.
  이것은 잠재 특성 추정이 아니므로 유형·점수·등급·궁합이 아니지만, **문항 이해도와
  대화 유용성은 여전히 `UNVALIDATED`다.**
- **안 맞는 장면은 건너뛴다.** 부모님이 안 계시거나, 결혼식을 하지 않거나, 사진 촬영을
  하지 않는 사람에게 보기 중 하나를 억지로 고르게 하는 것은 불편할 뿐 아니라 고르지도
  않은 답을 결과와 아모라 제안에 싣는 일이다. 건너뛴 문항은 공유 코드에 미응답(`-`)으로
  남고, 해당 문항은 집계에서 제외한다. 축 전체가 미응답이면 그 축을 비운다. 답이 하나도 없으면 안내를 띄우고 공유
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
- 현재 활성 문항은 `constants/weddingCodeV12.ts`, 진입 기준은 `scene/config.ts`다.
  `weddingCodeV07` 문항·검사는 이전 버전 기록이며 현재 문항의 이해도·정확도 근거가 아니다.
  새 판은 지금 나라면 고를 답으로 시제를 맞췄다. 받고 싶은 도움과 상대에게 건넬 말을
  질문과 결과에서 구분하며, 실제 행동이나 고정된 성격으로 자동 변환하지 않는다. C축은 최종 결정에 누가 참여하는지 묻는다.
  `scene/resultProfile.ts`는 선택한 장면들을 연결하고 그 근거를 인용한다. 모든 답은 펼쳐 볼 수 있다.
  v1.1·v1.2 연구 기여는 허용하지 않으며 기존 판의 수집·삭제 경계를 유지한다.
- 응답 설명 버전은 **`wedding-code-response-summary-v2`**다. 소수 답의 실제 문장도 보존하고,
  비교는 두 응답에 공통으로 답한 동일 장면을 기준으로 한다. 미응답은 일치로 세지 않는다.
- **아모라 도움 설정은 직접 확인 후 저장한다.** `profile/amoraBridge.ts`는 자동 설정값 대신
  답한 축에 대응하는 미선택 질문을 만든다. 사용자가 `decisionStart`, `workMode`, `familyOrder`,
  `supportOrder` 중 직접 고른 enum만 기존 개인 설정 API에 저장한다. 로그인된 사용자는 결과에서
  저장할 수 있고, 비로그인은 명시적인 계속 동작 후 `/settings/amora-style`에서 로그인·계정·변경
  내용을 다시 확인한다. 원래 20개 답과 인용문은 보내지 않고 고르지 않은 기존 설정은 보존한다.
  서버 성공 전에는 반영 완료로 표시하지 않으며 상대 설정·공동 합의는 변경하지 않는다.
- **실제 취향은 별도 선택형 화면에서 묻는다.** `/wedding-code/taste`의 새 진입 `wedding-taste-v2`는
  우선 주제 최대 2개, 분위기, 고른 주제의 세부 취향, 피할 것, 의견이 다를 때 처음 살펴볼 후보 범위를 최대 6개 질문으로
  확인한다. 기본 답·자유문·심리 점수는 없다. 미정·상관없음·계획없음·건너뜀을 구분하며,
  모두 건너뛴 결과는 공유·아모라 전달을 제공하지 않는다. v2 하객 수는 하객 없음과 1~49명을 구분한다.
  v1 링크는 기존 질문·유지 선호 표현으로 열고 상대도 같은 판으로 답한다. 서로 다른 판의 답을 합쳐 공유하거나 비교하지 않는다.
- 직접 취향은 공유 동의 후 고정 enum만 별도 버전 fragment에 넣는다. 먼저·나중에 답한 사람은
  응답 순서이며 계정 인증된 상대라는 뜻이 아니다. 두 사람이 모두 값을 고른 항목만 같은/다른
  선택으로 표시하고, 미정·미응답 등이 포함된 항목은 직접 확인할 부분으로 남긴다.
- **내 취향만 나만 상담의 초안으로 연결한다.** 본인이 이 화면에서 직접 입력한 선택을 검토하고
  요청할 때만 전달한다. 받은 링크의 답을 본인 것으로 자동 적용하거나 상대 답을 AI로 보내지 않는다.
  로그인·온보딩·상담 인계의 허용 enum만 현재 탭 `sessionStorage`에 최대 15분 보관하고 URL에는
  일회용 표식만 넣는다. 계정·커플·역할을 확인하며 기존 본문·첨부 초안은 덮지 않는다.
  본인이 보내기를 누르기 전에는 메시지 저장·AI 호출·예산·일정·할 일 변경이 없다.
- 공개 가능은 유용성이 검증됐다는 뜻이 아니다. 문항 이해도·선택지 포괄성·대화 유용성은
  사람 인지면접과 커플 사용성 검증 전까지 `UNVALIDATED`다.

> [!IMPORTANT]
> 이 디렉터리의 문서는 작성 시점이 서로 다르다. 과거 문서의 `PASS`, 구현 완료, Production QA,
> 점수, 유형, overlap 또는 공유 사양은 현재 승인으로 해석하지 않는다. 아래 권위 순서와 상태가
> 파일 본문보다 우선한다.

## 먼저 읽기

이번 공개 제품 구현과 저장 경계는
[`2026-09-09_direct_preferences_design.md`](./2026-09-09_direct_preferences_design.md)를 먼저 읽는다.
전체 제품 생각, 설계 계보, 당시 구현과 21개 연구 문항 풀, 사람 검증·제품화 방향을
한 번에 보려면 [`62_wedding_code_master_design_and_current_state_2026-07-18.md`](./62_wedding_code_master_design_and_current_state_2026-07-18.md)를
참고할 수 있다. 이 통합 문서는 작성 당시의 이해를 위한 진입점이며 현재 공개 사양이나 운영 출시 승인은 아니다. 충돌 시 아래 권위
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
| `/wedding-code` v1.2 / v1.1·v1.0·v0.9·v0.8·v0.6 호환 | `PUBLIC CONVERSATION TOOL / UNVALIDATED UTILITY` | 실제 선택 문장 비교, 본인 응답의 셈·인용·부재 요약, 장면별 다음 대화 제안, URL 공유 | 심리검사·성향 유형·궁합·갈등 또는 결혼 결과 예측 |
| `2026-09-09_direct_preferences_design.md` | `IMPLEMENTED / LOCAL VERIFICATION PASSED` | 응답 요약 v2, 직접 도움 설정, 선택형 취향·공유·개인 상담 인계의 구현 계약. 배포 상태는 릴리스 PR #431에서 확인 | 이 설계 문서만으로 운영 배포·운영 DB·실제 계정 저장 검증 완료 주장, 측정 연구 재개 승인 |
| `56`, `57` | `SUPERSEDED-RESEARCH-LINEAGE / M0` | Candidate 5 계보·회귀 비교 | 새 제품·연구 구현 기준 |
| `00`, `02a`, `02b`, `22` | `REFERENCE-ONLY` | 출처 품질·시장 장면·안전 원칙 참고 | 선택지·축·점수의 타당도 주장 |
| `21` | `RETIRED` | 과거 성장 아이디어 감사 | 답 공개, 분포, 유형, 게임화 구현 |
| `23`–`47` | `RETIRED / SUPERSEDED` | Candidate 4 이전 의사결정 추적 | 문항·가중치·score·overlap·Production 절차 재사용 |
| `48`, `49`, `51` | `RETIRED` | 과거 실행 계획 보존 | 모집·수집·SQL·운영 실행 |
| `52`–`54` | `SUPERSEDED` | 과거 카피·구현 기록 보존 | Candidate 5 카피 또는 출시 근거 |
| 그 외 `01`–`20` | `HISTORICAL / REFERENCE-ONLY` | 초기 가설의 출처 추적 | 현행 제품 사양으로 직접 사용 |

## 3. 코드 상태

- `apps/web/src/constants/weddingCodeV05.ts`, `WeddingCodeClient.tsx`, `ResultClient.tsx`와
  Candidate 4의 score/report/storage 계열은 **휴면 legacy/retired 구현**이다.
  `lib/weddingCode/*` 전체가 휴면인 것은 아니며 활성 `scene/`, `profile/`, `taste/`와 구분한다.
- Candidate 4의 result redirect, `410 Gone` API, DB write fence는 유지한다.
  이를 현재 공개 `/wedding-code` 화면도 안내-only라는 뜻으로 해석하지 않는다.
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
- 공개 `/wedding-code`는 Candidate 6.3 측정 코드와 별개다. `v0.6-scene`·`v0.8-code`·`v0.9-code`·`v1.0-code`·`v1.1-code`는 과거 공유 링크
  호환용이고, 새 진입은 `v1.2-code`를 사용한다. 버전 없는 답 링크는 v0.6으로만 해석하며,
  알 수 없는 버전을 현재 문항으로 바꾸어 읽지 않는다.
- 공개 장면 도구의 응답은 DB나 브라우저 저장소에 저장하지 않는다. 새 링크는 답 코드를
  URL fragment(`#`)에 넣어 서버 요청과 referrer에서 제외하고, 이 경로의 페이지뷰·세션
  녹화도 끈다. 다만 전체 링크를 받은 사람은 답을 볼 수 있으므로 공유 전에 알린다.
- **2026-09-15 파운더 결정: 흐름 통계는 연다.** 경로 억제는 유지하고, 이름을 박아 둔
  `wedding_code_*` 이벤트만 `sanitizeWeddingCodeFunnelCapture`를 거쳐 보낸다 — 주소는 쿼리와
  `#`를 잘라 경로만, 속성은 버전·장면 순번·개수·자리 이름만 남긴다. 고른 답·코드·링크는
  싣지 않는다. 처리방침 제10조의 사전 고지 약속에 따라 2026-09-23부터 보낸다
  (`WEDDING_CODE_FUNNEL_ANALYTICS_EFFECTIVE_AT`). 이것은 응답 저장이나 연구 수집 재개가 아니다.
- **2026-09-16 파운더 결정: 답 익명 보태기(선택)를 연다.** 과거 `wedding_code_responses`
  (retired, 410)를 되살리지 않고 새 테이블 `wedding_code_research_contributions`와 새 경로
  `/api/wedding-code/research-contribution`을 쓴다. 명세 `56` §8.1·§9.1의 조건을 코드로 지킨다:
  기본값이 꺼진 동의·만 19세 확인, 받는 것(문항 판·답 기호·동의 판·시각)과 받지 않는 것(이름·
  연락처·계정·IP·링크·상대 답) 고지, 60일 TTL(보태기 RPC와 `ai-log-retention` 크론), 원문을
  저장하지 않는 HMAC 삭제 코드, 존재 여부를 드러내지 않는 삭제 응답, 삭제 tombstone 30일.
  - **받기와 지키기는 스위치가 다르다(2026-09-16 적대 검토 반영).** 지키기
    (`isWeddingCodeResearchStorageActive()` = 32자 이상 `WEDDING_CODE_RESEARCH_RECEIPT_SECRET`)가
    전용 보관기간 크론(`/api/cron/wedding-code-research-retention`)·삭제 API·삭제 폼·처리방침
    고지를 켠다. 받기(`isWeddingCodeResearchContributionOpen()`)는 지키기 + 플래그 +
    `WEDDING_CODE_RESEARCH_CONTRIBUTION_EFFECTIVE_AT`(처리방침 제10조 사전 고지, 2026-09-23) 이후에만
    카드·보태기 API를 켠다. 수집을 멈출 때는 플래그만 끄고, 비밀값은 마지막 보태기 후 60일까지
    지우거나 바꾸지 않는다.
  - 삭제 코드는 브라우저가 먼저 만든다(끊겨도 같은 코드로 재전송·삭제, 고유 제약으로 한 번만
    저장). 저장 시각은 날짜 단위로만 남기고, 보냈다는 분석 이벤트는 보내지 않는다 — 이름 없는
    답이 시각 대조로 한 기기에 이어지지 않게. tombstone은 같은 코드의 재저장을 막고 지운 코드의
    남은 행을 크론이 지운다. DB 전체를 백업 시점으로 되돌리면 tombstone도 함께 되돌아가므로
    그 경우의 재삭제는 약속하지 않는다.
  - 운영 순서: DB 레인 inspect → rehearse → apply(사람 승인) → 비밀값 → 플래그 → 재배포.
  - 이것은 문항 타당도 검증이 아니다. 아래 §4 인간 게이트(Candidate 6.3)는 그대로 미통과이며,
    보탠 답으로 유형·점수·궁합을 만들지 않는다.
- 과거 `?a=`·`?b=` 링크는 v0.6 호환을 위해 읽은 뒤 fragment 링크로 바꾼다. 최초 요청이
  이미 서버에 도달한 과거 링크의 노출을 되돌릴 수는 없으므로 신규 공유에는 쓰지 않는다.
- `profile/amoraHandoff.ts`와 `tasteHandoff.ts`의 임시 저장은 본인이 따로 확인한 도움 설정·취향의
  제한된 인계다. 장면 응답 DB 저장이나 Candidate 6.3의 browser storage 금지를 해제하지 않는다.
  취향 입력의 전용 DB 테이블·마이그레이션은 추가하지 않는다. 개인 상담에서 보내기를 누른 뒤에는
  기존 개인 대화의 처리·저장·AI 로그 경계를 따른다.

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
