# Community DecisionThread P0 로컬 릴리스 후보

> 상태: **LOCAL RELEASE CANDIDATE — PRODUCTION NO-GO**
>
> 기준일: 2026-08-04
>
> 현재 브랜치: `agent/release-handoff-20260731`
>
> Git·배포 상태: **정확한 source commit·push·browser QA receipt는
> `AMORA_COMMUNITY_IMPLEMENTATION_HANDOFF_2026-08-04.md` §5를 따른다. production 미배포**
>
> DB 상태: **로컬 migration 작성만 완료. 원격 Supabase 미적용**

이 문서는 `docs/COMMUNITY_AMORA_DECISION_NETWORK_MASTER_SPEC_2026-08-03.md`의
DecisionThread P0를 현재 로컬 코드에서 어디까지 만들었는지 기록하는 릴리스 후보 스냅샷이다.
릴리스 후보라는 이름은 기능 묶음이 로컬에서 연결되었다는 뜻일 뿐, 운영 출시 승인이나 배포
증거가 아니다. source-level 적대적 감사와 전수 로컬 검증 뒤에도 원격 DB 적용,
인증된 브라우저·실기기 E2E, 운영 공급 검증이 남아 있으므로 현재 상태는 반드시
**NO-GO**로 해석한다.

판단 우선순위는 `PRINCIPLES.md`, `AGENTS.md`, 현재 release gate, 실제 코드·테스트 순이다.
이 문서와 코드가 다르면 코드의 현재 동작을 먼저 확인하고 이 문서를 함께 갱신한다.

## 1. 소비자에게 만드는 한 가지 루프

P0의 목적은 게시글 수를 늘리는 것이 아니다. 예비부부가 불확실한 결정을 사람의 실제
경험으로 좁히고, 나중에 결과를 돌려줘 다음 커플의 판단 비용까지 줄이는 것이다.

1. 사용자가 계약·추가금 상황과 원하는 답변을 구조화해 질문한다.
2. 같은 주제에 확정된 peer primary와 backup 공급이 모두 있을 때만 공개한다. 공급이
   부족하면 `202 private_waitlist`로 보관하며 공개된 것처럼 말하지 않는다.
3. 직접 경험이 있고 현재 답변 자격을 충족한 사람이 조건·근거·한계를 분리해 답한다.
4. 질문자는 각 답변이 자기 상황에 적용되는지 별도로 표시한다. 이 선택만으로 질문을
   해결 상태로 바꾸지 않는다.
5. 질문자가 현재 보이는 답변을 다시 확인하고 다음 행동과 이유를 적어 명시적으로
   해결한다.
6. 실제 행동 뒤 결과를 revision으로 남긴다. 새 revision은 과거 기록을 지우지 않는다.
7. 공개 동의를 받은 결과도 운영 검수를 통과한 projection만 공개 피드에 들어간다.
   private canonical outcome을 공개 정답이나 대표 결과로 노출하지 않는다.
8. 앱에서는 질문·답변·적용·해결·결과 회수를 이어가고, 웹에서는 공개 가능한 질문과
   검수된 결과를 발견한다.

이 루프에서 AI, 운영자, 업체 공식 답변은 사람의 peer 경험을 대신하지 않는다. 화면도
작성 출처·상황 조건·상태를 반응 수보다 먼저 보여준다.

## 2. 앱-first, 웹 discovery 계약

| 표면 | P0 역할 | 현재 로컬 구현 |
|---|---|---|
| 모바일 Community | 매일 확인하는 주 사용면 | 실제 DecisionThread feed와 inbox를 일반 커뮤니티보다 먼저 읽고, `둘러보기`·`내 경험 필요`·`결과`를 제공 |
| 모바일 질문 작성 | 내용-first 질문과 안전한 재시도 | owner-scoped 로컬 draft/pending, UUID idempotency key, `private_waitlist`와 공개 성공 분리 |
| 모바일 상세 | 답변·적용·해결·결과·철회 | 질문 상태와 구조화 답변을 읽고, 적용 선택과 최종 해결을 분리하며 서버 철회를 사용 |
| 웹 Community | 공개 가능한 결정 질문 발견 | 기존 일반 글 feed 앞에 compact discovery를 두고 `둘러보기`·`내 경험 필요`·`결과`를 정직하게 표시 |
| 웹 카드 | 출처와 조건을 먼저 확인 | 회원 작성 출처, 경험 범위, 준비 단계, 계약 단계, 공개 관계, 상태 뒤에 실제 답변 수를 표시 |
| 웹 장애 상태 | 기존 커뮤니티 가치 보존 | 최초 DecisionThread API 실패 시 패널을 숨겨 기존 실제 글이 바로 이어짐 |

API 내부 mode 이름 `for_you`는 웹에서 `둘러보기`로 표시한다. P0에는 개인화 품질을
입증한 데이터가 없으므로 사용자에게 “나에게 맞는” 피드라고 주장하지 않는다. inbox도
로그인 사용자에게 실제 count가 있을 때만 한 줄로 표시한다.

## 3. 로컬 구현 경로

### 3.1 핵심 SQL

| 경로 | 역할 |
|---|---|
| `supabase/migrations/20260804190000_community_decision_thread_vertical.sql` | private intake, beta member, thread, append-only event, 구조화 answer, answer별 applicability, revisioned outcome, 상태 전이와 service RPC |
| `supabase/migrations/20260804193000_community_decision_feed_read.sql` | 공개·인증 feed, inbox, 공개 outcome projection queue와 service-only read RPC |
| `supabase/migrations/20260804194000_community_decision_outcome_review.sql` | 운영 검수 command, approve/reject, 검수 대기열, 공개 철회 |
| `supabase/migrations/20260804195000_community_decision_public_outcome_read.sql` | 현재 검수된 공개 projection과 작성자 전용 공개 상태를 원본 outcome과 분리해 읽는 service-only RPC |

DecisionThread가 기대는 같은 날짜의 안전 기반은 다음과 같다.

- `20260804103000_community_report_resolution_atomic.sql`: 신고·조치·복원·이의 제기 원자성
- `20260804120000_community_profile_guestbook_p0_hardening.sql`: public profile 신뢰 경계
- `20260804130000_community_runtime_control.sql`: read-only·kill switch
- `20260804140000_community_responder_supply_foundation.sql`: primary·backup responder 공급
- `20260804150000_community_comment_service_write_boundary.sql`: comment service-only write
- `20260804160000_community_poll_set_intent.sql`: set-intent 투표 계약
- `20260804170000_notification_session_ownership.sql`: 알림 설치·세션 소유권
- `20260804180000_community_viewer_controls.sql`: 사용자 차단
- `20260804185000_notification_delivery_outbox.sql`: 명시 opt-in push outbox
- `20260804200000_community_post_service_write_boundary.sql`: post service-only write

이 순서는 파일명만 보고 운영 DB에 직접 적용하라는 지시가 아니다. 승인된 migration
manifest, backup, staging/dry-run, apply receipt, postcondition이 모두 있어야 한다.

### 3.2 웹 API

| 메서드·경로 | 역할 |
|---|---|
| `GET /api/community/decision-threads` | `for_you`·`needs_help`·`outcomes` feed |
| `POST /api/community/decision-threads` | 질문 intake와 공급 gate 뒤 공개 또는 private waitlist |
| `GET /api/community/decision-threads/[threadId]` | viewer별 차단·가시성·권한이 반영된 상세 read model |
| `POST /api/community/decision-threads/[threadId]/answers` | 자격을 다시 확인한 구조화 경험 답변 |
| `PUT /api/community/decision-threads/[threadId]/applicability` | answer별 적용 여부 set-intent |
| `POST /api/community/decision-threads/[threadId]/resolve` | 선택 답변 재검증 뒤 명시적 해결 |
| `GET /api/community/decision-threads/[threadId]/outcomes` | 차단·삭제·정지·runtime·선택 근거를 다시 확인한 현재 검수 공개 projection만 조회 |
| `POST /api/community/decision-threads/[threadId]/outcomes` | private canonical 결과 revision 작성과 선택적 공개 검수 요청 |
| `POST /api/community/decision-threads/[threadId]/withdraw` | private waitlist 또는 공개 질문의 작성자 철회 |
| `GET /api/community/decision-threads/inbox` | 답변 대기·내 경험 필요·돌아온 결과의 실제 count와 target |
| `GET /api/community/decision-threads/[threadId]/outcomes/[outcomeId]/publication` | 작성자만 보는 정확한 공개 상태와 현재 철회 가능 여부 |
| `DELETE /api/community/decision-threads/[threadId]/outcomes/[outcomeId]/publication` | 작성자의 공개 동의 철회 |
| `GET /api/admin/community/decision-outcomes` | 관리자 전용 결과 검수 대기열 |
| `PATCH /api/admin/community/decision-outcomes/[outcomeId]/review` | 관리자 전용 approve/reject |

공통 검증·오류 계약은
`apps/web/src/lib/community/decisionThreadApi.ts`와
`apps/web/src/lib/community/decisionOutcomeReviewApi.ts`에 있다. 서버 응답은
`private, no-store`를 기본으로 하며, 클라이언트는 exact response shape를 확인하지 못하면
성공으로 처리하지 않는다.

### 3.3 UI와 공유 계약

- 모바일 feed·inbox: `apps/mobile/app/(tabs)/community.tsx`
- 모바일 작성: `apps/mobile/app/community/decision/write.tsx`
- 모바일 상세: `apps/mobile/app/community/decision/[id].tsx`
- 모바일 route layout: `apps/mobile/app/community/decision/_layout.tsx`
- 모바일 request·response parser: `apps/mobile/src/lib/communityDecisionThread.mjs`
- owner-scoped draft·pending 저장: `apps/mobile/src/lib/communityDecisionPending.ts`
- 웹 discovery: `apps/web/src/components/community/CommunityDecisionDiscovery.tsx`
- 웹 연결 위치: `apps/web/src/components/community/CommunityLandingClient.tsx`
- feed·inbox 공유 parser: `packages/shared/src/contracts/communityDecisionFeed.mjs`

웹 카드는 기존 `/community/post/{postId}` 상세로 연결한다. 웹 전용 DecisionThread 작성·상세
제품면은 P0 범위가 아니며, 앱이 주 사용면이다.

## 4. 안전 불변식

아래는 운영에서도 반드시 유지해야 할 제품·데이터 계약이다. 현재 로컬 코드와 focused
테스트가 이 계약을 겨냥하고 있지만, 원격 DB에서의 충족은 아직 증명되지 않았다.

1. **P0 주제 고정**: 공개 질문은 `contract_extra_cost`만 허용한다.
2. **text-only**: DecisionThread intake·answer·outcome에는 media reference를 받지 않는다.
3. **공급 전 공개 금지**: distinct accepted peer primary 1명과 backup 1명이 모두 확정되지
   않으면 private waitlist로 남긴다.
4. **동시 공개 상한**: controlled beta의 active 공개 thread는 최대 20개다.
5. **사람 답변 정직성**: 직접 경험·현재 자격·공개 관계를 확인한 peer/pro 답변만 각 count에
   들어간다. AI·운영자·질문자 자기 답변은 peer answered를 만들지 않는다.
6. **service-only mutation**: raw table의 anon/auth direct write를 허용하지 않고, 인증된
   사용자를 확인한 서버 RPC만 상태를 바꾼다.
7. **exact idempotency**: UUID operation key와 payload digest를 묶는다. exact replay만 같은
   receipt를 반환하고 payload mismatch와 stale version은 성공으로 위장하지 않는다.
8. **부분 성공 금지**: thread state, event, answer/comment, notification, outcome revision은
   같은 transaction 계약 안에서 닫히며 결과를 확인하지 못하면 `state_unconfirmed`다.
9. **적용과 해결 분리**: applicability는 answer별 set-intent이고, resolve는 현재 보이는
   선택 답변·source·차단·상태를 다시 확인한 별도 명령이다.
10. **차단·가시성 일치**: feed, 상세, 답변, 적용, 결과, inbox, push에서 viewer block,
    moderation, 삭제, suspended profile, source availability를 같은 방향으로 적용한다.
11. **PII와 관계 공개**: exact calendar date, 전화번호 등 공개 개인 정보 후보를 차단하고,
    혜택·고용·소유·제휴 관계는 detail과 함께 저장한다.
12. **private outcome 우선**: 결과는 기본적으로 private canonical record다. 명시 공개 동의,
    운영 검수, 현재 revision, 보이는 선택 답변을 모두 만족한 projection만 공개한다.
13. **철회 우선**: 질문·대기열·결과 공개 동의 철회는 emergency read-only에서도 가능한
    안전 행동이어야 하며, 철회 뒤 feed·inbox·push·검색 후보에서 빠져야 한다.
14. **push 기본 OFF**: in-app inbox는 기준 기록이고 외부 push는 별도 durable consent가
    있어야 한다. lock screen payload에는 민감한 질문 내용을 넣지 않는다.
15. **AI 자동 적용 금지**: P0 커뮤니티 근거를 Amora가 자동으로 예산·일정·할 일에 쓰지
    않는다.

## 5. 현재 확인된 검증 결과

| 범위 | 현재 확인된 결과 | 해석 |
|---|---|---|
| DecisionThread DB·API 적대적 focused | PASS — capacity/retry 5 files 35 tests, replay/visibility 관련 20 files 265 tests | 공개 thread 20개 상한의 동시 요청, slot 반환, exact receipt, hidden/blocked/source-unavailable fail-closed까지 확인 |
| Web typecheck | PASS | ingest와 `@hanbang/web`을 포함한 모노레포 4 package typecheck 통과 |
| Web 전체 lint | PASS, 경고 0건 | stale poll-test warning까지 제거한 최종 ESLint 결과 |
| Web production build | PASS | Next.js 16.2.11 compile·TypeScript·150/150 static page 생성 완료 |
| Mobile 전체 test | 425/425 PASS | DecisionThread 작성·대기·재시도·상세·공개 결과·철회, push target, 기존 앱 회귀 포함 |
| Mobile typecheck·전체 lint | PASS | `@hanbang/mobile`의 TypeScript와 ESLint 모두 통과 |
| Mobile bundle export | PASS | Expo Web·iOS·Android 번들 export 완료. Sentry organization/project 미설정 경고는 있었으나 build exit는 0 |
| Shared typecheck | PASS | 공개 feed·outcome 계약을 포함한 `@hanbang/shared` 타입 검사 통과 |
| 범위 내 적대적 코드 감사 | 확인된 Critical/P1/P2 닫힘 | 상업 관계, ghost count, 검수·inbox parity, durable 철회, active-thread concurrency, transitive mutation trust guard를 수정·재감사. 제3자 보안 인증이나 운영 승인을 뜻하지 않음 |
| Moderation focused | 6 files, 78 tests PASS | 신고·조치·복원·작성자 의도·appeal 관련 로컬 회귀 검사 |
| Web 전체 test suite | 588 files, 5,816 tests PASS | 같은 source candidate를 8개 deterministic shard로 전수 실행했고 8/8 exit 0 |
| Mobile release readiness | 104/104 PASS | 설정·release gate·Sentry privacy·OAuth·production fail-closed 계약 확인 |
| Repository/release contracts | 273/273 PASS | handoff, dependency security pin, release controller, storage·write fence를 포함한 최종 전수 실행 |
| Supabase static release fence | PASS, `deployment_blocked` | predecessor 27, successor 80 migrations와 새 local tail 14개 순서·hash 고정. hosted apply 증거는 아님 |
| Source commit·GitHub push | PASS — 구현 `cedd7a1b...`, composer QA fix `7d39645d...` | `7d39645d...` 게시 직후 local/tracking/remote exact 일치 |
| GitHub PR·CI snapshot | PARTIAL — Draft PR #79 OPEN, review 없음 | 구현 run 30889455231의 Mobile·Vendor·Static 성공, Web 진행 중. hosted evidence 차단 check는 실패했으므로 CI 전체 PASS·배포 증거가 아님 |
| Safe preview-stub browser | PASS (LIMITED) | public Landing desktop/390/320, Community fallback desktop/390, Start-here→Amora 390 smoke. DecisionThread API는 의도된 503이므로 실제 stateful E2E는 미증명 |

또한 다음은 확인되지 않았다.

- 원격 Supabase migration apply·RLS postcondition·backup·restore
- production 배포·원격 smoke
- GitHub PR review·GitHub CI 최종 결과
- 실제 브라우저 키보드·스크린리더 E2E
- iOS·Android 실기기, offline/retry, deep link, account switch E2E
- 서로 다른 두 계정의 질문자·답변자 전체 루프
- 실제 push provider delivery·logout·token rotation
- 운영 primary·backup staffed capacity와 24시간 SLA

따라서 이 검증 표는 로컬 회귀 근거이며 출시 승인표가 아니다.

## 6. 출시 전 체크리스트

### A. 코드 동결과 리뷰

- [x] 최종 source+handoff staged diff·secret·generated artifact를 90초 무변경 뒤 감사한다.
- [x] DecisionThread 범위의 AI-assisted 적대적 코드 감사에서 helper grant, RLS,
      SECURITY DEFINER, search path, cross-user/cross-couple 경계와 공개 projection
      가시성 일치를 재확인하고 발견된 Critical/P1/P2를 닫는다.
- [x] 전체 web test suite 588 files·5,816 tests가 8/8 shard PASS summary를 남긴다.
- [x] mobile 전체 425개 test·typecheck·lint의 로컬 실행 결과를 확인한다.
- [x] 웹 production build와 Web·iOS·Android 모바일 bundle export를 확인한다.
- [x] 구현 source commit과 composer QA fix의 exact SHA를 기록하고 같은 branch에 push한다.
- [x] Draft PR #79가 exact 구현 head `7d39645d...`로 열린 사실을 확인한다.
- [ ] GitHub PR review 결과를 기록한다.
- [ ] GitHub CI checks의 최종 결과를 기록한다. Run 30889455231은 2026-08-04 17:09 KST에
      Web Quality 진행 중이었고 hosted evidence 차단 check는 실패 상태였다.

### B. DB 출시 증거

- [x] local `deployment_blocked` manifest에서 1900 → 1930 → 1940 → 1950 → 2000
      순서와 exact hash를 정적으로 확인한다. 이는 hosted 적용 승인이 아니다.
- [ ] staging 또는 동등한 격리 환경에서 dry-run, 예상 row count, 정책·grant diff를 검토한다.
- [ ] 운영 backup과 실제 restore drill 증거를 확보한다.
- [ ] 승인 후 한 번만 적용하고 migration apply receipt를 보존한다.
- [ ] anon/auth/service role별 raw table·RPC·feed·inbox RLS postcondition을 실행한다.
- [ ] 실패 시 migration history를 손으로 고치지 않고 forward-fix 절차를 사용한다.

### C. 공급과 운영

- [ ] `contract_extra_cost`에 verified peer primary와 backup을 각각 확정한다.
- [ ] staffed hours, handoff, decline, WIP, PII incident 연락 경로를 운영자가 확인한다.
- [ ] 공개 active thread 20개 상한과 새 질문 freeze를 실제 동시 요청으로 검증한다.
- [ ] global read-only, acquisition freeze, push off, media off kill switch를 drill한다.
- [ ] 응답·신고·appeal SLA가 기존 community release gate를 충족하는지 실제 cohort로 본다.

### D. 소비자·안전 E2E

- [ ] 질문 → private waitlist → 공급 확정 → 공개의 사실 표시를 확인한다.
- [ ] 질문자와 답변자 두 계정으로 answer → applicability → resolve → outcome revision을
      끝까지 수행한다.
- [ ] outcome 공개 동의 → pending review → approve/reject → 공개 → 작성자 철회를 확인한다.
- [ ] 차단, 삭제, suspended profile, source unavailable이 feed·상세·inbox·push에 함께
      반영되는지 확인한다.
- [ ] 중복 요청, payload mismatch, stale version, 네트워크 단절, 재로그인에서 거짓 성공이나
      중복 기록이 생기지 않는지 확인한다.
- [ ] exact date, 전화번호, 계좌, 주소, 관계 미공개 payload를 API와 UI 양쪽에서 거부한다.

### E. 실제 화면과 접근성

- [x] safe preview-stub에서 Landing desktop·390px·320px, Community fallback desktop·390px,
      Start-here → Amora 390px public shell을 확인한다. 이는 실제 인증·DB 쓰기 증거가 아니다.
- [ ] 320px·375px·desktop에서 첫 실제 질문, 탭, 상태, 답변 행동이 잘리지 않는지 캡처한다.
- [ ] 키보드, VoiceOver, TalkBack, 최대 글자 크기에서 작성·탭·상태·오류 복구를 확인한다.
- [ ] 빈 상태·오류·로딩이 기존 일반 커뮤니티의 첫 실제 글을 과도하게 밀지 않는지 본다.
- [ ] 사용자 화면 어디에도 `for_you`를 근거 없는 개인화로 번역하거나 private outcome을
      정답·대표 결과로 부르는 문구가 없는지 감사한다.

### F. 제한 배포와 관찰

- [ ] production deploy receipt와 운영 URL smoke 결과를 보존한다.
- [ ] controlled beta 외 신규 유입은 닫은 채 최대 20개 thread로 시작한다.
- [ ] 첫 사람 답변 시간, 24시간 응답률, outcome 회수, 신고·appeal, responder 집중도를
      사실 데이터로 본다.
- [ ] 기존 `COMMUNITY_PRODUCTION_RELEASE_GATE_2026-07-31.md`의 Gate 0과 Gate 1을 실제
      데이터로 통과하기 전 확장하지 않는다.

## 7. P0의 명시적 한계

- 주제는 **`contract_extra_cost` 하나뿐**이다. 다른 웨딩 주제를 일반화하지 않는다.
- text-only다. 계약서 이미지, OCR, 사진 업로드와 자동 마스킹을 지원하지 않는다.
- controlled beta이며 active 공개 thread는 최대 20개다.
- 개인화 추천, 전체 검색·SEO canonical, 업체 marketplace, 예약·결제, 법률 판단이 아니다.
- 전문 답변 count는 법률 자문, 계약 유효성, 환불 가능성 보증이 아니다.
- 공개 결과는 검수된 projection이지 모든 커플에게 맞는 정답이나 시장 대표값이 아니다.
- 앱이 주 사용면이고 웹은 discovery다. 웹 전용 전체 작성·해결 flow는 P0에 없다.
- Amora가 커뮤니티 답을 자동으로 계획에 적용하는 기능은 아직 없다.

## 8. 다음 단계: Amora proposal에서 실행 영수증까지

P0가 안정된 뒤의 다음 연결은 자동 실행이 아니라 **근거가 붙은 제안과 명시 승인**이다.

1. 사용자가 선택한 보이는 답변과 현재 공개 가능한 source만 Amora 입력 후보로 삼는다.
2. Amora는 “이렇게 바꿔도 될까요?”라는 proposal을 만들고, 어떤 답변의 어떤 조건을
   근거로 삼았는지, 불확실한 점과 바뀔 field를 분리해 보여준다.
3. 사용자가 명시적으로 승인한다. 커플 공유 항목이면 현재 roster와 같은 proposal version에
   필요한 partner 승인도 다시 확인한다.
4. 승인 뒤에만 service command가 task, budget, schedule 변경을 수행한다. AI가 직접 raw
   table을 쓰거나 대화만으로 승인된 것으로 추정하지 않는다.
5. 모든 AI 호출은 `ai_interactions_log`, 모든 커플 의사결정은 `decision_nodes`에 남긴다.
6. 실행 결과는 다음을 포함한 영수증으로 반환한다.
   - 추가·수정·삭제된 task
   - budget 항목과 금액·출처·이전 값
   - schedule 일정과 날짜·이전 값
   - 사용한 DecisionThread·answer·outcome revision
   - 승인자, proposal version, command/idempotency key, 실행 시각
   - 실패·부분 미적용 항목과 안전한 재시도 또는 되돌리기 경로
7. receipt가 확인되지 않거나 일부만 적용되면 성공으로 말하지 않는다.

이 Amora bridge는 **다음 단계이며 현재 P0 release candidate에 구현 완료된 것으로 간주하지
않는다.** 먼저 사람 답변 공급과 결과 회수 루프가 실제 beta 데이터로 안전하게 작동해야 한다.

## 9. 이 문서를 CURRENT로 승격하는 조건

아래 증거가 모두 붙기 전에는 이 문서를 로컬 후보 이상으로 해석하지 않는다.

- exact commit SHA, PR, CI checks
- 승인된 migration manifest, backup·restore, apply receipt, RLS postcondition
- web 전체 test·build, mobile 전체 test·typecheck·lint
- 브라우저와 iOS·Android 실기기 E2E
- primary·backup 운영 확인과 controlled beta 시작 receipt
- production deployment와 smoke·rollback/kill drill

증거가 생기면 체크박스를 실제 receipt 링크로 교체한다. 체크 표시나 “완료” 문구를 증거
대신 쓰지 않는다.
