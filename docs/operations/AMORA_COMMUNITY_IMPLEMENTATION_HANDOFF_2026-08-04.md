# Amora·커뮤니티 구현 및 다른 컴퓨터 인수인계

기준일: 2026-08-04
대상 브랜치: `agent/release-handoff-20260731`
상태: **로컬 source release candidate — production NO-GO**

## 1. 이 문서가 보장하는 것과 보장하지 않는 것

이 문서는 2026-08-04 working tree에서 Amora 대화 안전성과 사람 경험 결정 네트워크를
어디까지 구현했는지, 다음 컴퓨터에서 무엇을 확인해야 하는지, 어떤 외부 증거가 없어서
배포하면 안 되는지를 한곳에 고정한다.

- 코드·migration·테스트가 로컬에 있다는 사실과 운영 적용은 다르다.
- 녹색 단위/PGlite 테스트는 hosted PostgreSQL, Storage, Expo, Vercel, 실제 기기를
  증명하지 않는다.
- 모든 소비자가 만족한다고 주장하지 않는다. 현재 candidate는 위험한 실패를 줄이고
  통제 베타에서 만족도를 측정할 수 있는 기반이다.
- 이 작업은 production DB write, Vercel production 승격, EAS production build/submit,
  feature flag 활성화를 승인하지 않는다.

현재 제품 결정은 다음 한 문장이다.

> 사용자는 Amora 한 대화 안에서 준비를 이어가되, 실제 사람의 경험이 필요한 결정은
> 출처가 보이는 DecisionThread로 연결하고, 예산·할 일·일정 변경은 명시 승인과 영수증
> 뒤에만 반영한다.

화면에는 한 대화가 유지되지만 내부에서는 account/couple, privacy lane, conversation
segment, source/reply pair를 분리한다. 이 구조는 긴 대화의 편의성과 계정 전환·private
내용·중단 복구의 안전성을 함께 얻기 위한 것이다.

## 2. 이번 source candidate의 핵심 결과

### 2.1 Amora 대화와 복구

- 웹·모바일 메시지는 인증된 서버 ingest를 정본으로 사용한다.
- 같은 요청 UUID의 재시도는 actor/account/couple/lane/source row를 다시 검증한다.
- 늦게 도착한 응답은 계정·커플·lane generation이 바뀌면 폐기한다.
- attachment v2는 MIME, 전체 byte 길이, SHA-256, storage object, canonical message를
  같은 요청 계약으로 묶는다.
- provider에 보낼 수 없는 private/W2 또는 위기/W5 입력은 deterministic 경계에서
  분리하며, 실제 저장·공유 성공을 확인하지 못했으면 성공했다고 말하지 않는다.
- 장기 기억은 source와 canonical assistant reply가 같은 허용 lane에 남아 있을 때만
  후보가 되며 auxiliary memory flag는 기본 off다.

관련 정본:

- `docs/AMORA_CONVERSATION_FOUNDATION_2026-08-01.md`
- `docs/AMORA_INTEGRATED_CARE_PRODUCT_SPEC_2026-07-30.md`
- `docs/operations/AMORA_SAFETY_RELEASE_HANDOFF_2026-08-04.md`

### 2.2 커뮤니티 P0 신뢰 경계

- report/moderation 결과는 원자 command와 감사 영수증으로 묶는다.
- 일반 운영자는 작성자의 글·댓글을 일반 수정 API로 조용히 바꾸지 않고 별도 감사
  moderation 경로만 사용한다.
- profile과 폐기 guestbook 데이터는 direct authenticated write를 차단한다.
- runtime은 `normal`, `read_only`, `disabled`로 분리하며 신규 일반 쓰기는 DB에서도
  다시 확인한다.
- responder capacity와 request는 수락·소비·철회·만료를 원장으로 기록한다.
- post/comment/poll mutation은 service-only actor-explicit RPC와 durable intent를 사용한다.
- poll은 toggle이 아니라 최종 선택 set-intent라 응답 유실 재시도가 선택을 뒤집지 않는다.
- block은 feed, 댓글, 알림, responder 경계에 대칭 적용하고 상대에게 차단 사실을 직접
  조회할 수 있는 공개 오라클을 제공하지 않는다.
- public/profile/post/poll 읽기는 actor-scoped projection을 사용하며 모바일의 direct
  base-table fallback을 제거한다.
- 통제 베타의 media publish는 웹 server flag와 모바일 public hint를 모두 exact `true`로
  승인하기 전까지 UI·API에서 닫힌다.

### 2.3 DecisionThread 수직 루프

로컬 candidate에는 다음 경로가 있다.

1. 조건과 원하는 답을 포함한 질문 발행
2. `for_you`, `needs_help`, `outcomes` feed와 개인 inbox
3. thread 상세와 qualified 사람 답변
4. 질문자의 private 적용성 판단
5. resolve·follow-up·withdraw 상태 전환
6. revisioned outcome 기록
7. 공개 동의 철회 가능한 outcome publication review
8. 웹 발견 카드와 모바일 Community 진입·write·detail

모든 durable mutation은 사용자 operation key와 DB 내부 command ID를 다른 필드로
검증한다. 이미 커밋된 exact actor+path+payload receipt는 rate limit, runtime mode,
suspension 같은 변경 가능한 신규 작업 gate보다 먼저 안전하게 재조회하며, 최초 body와
HTTP status를 그대로 반환한다. 다른 actor, 다른 path, 다른 payload의 같은 key는
충돌로 닫는다.

아직 community → Amora cited proposal → 커플 승인 → 예산/할 일/일정 적용 영수증의
실기기 한 바퀴는 완료 증거가 없다. 따라서 DecisionThread가 구현됐다는 사실을 “결혼
결정이 자동으로 해결된다”는 마케팅 주장으로 바꾸지 않는다.

### 2.4 모바일 계정·캐시·알림

- community cache는 owner/account scope를 캡처하고 계정 전환 뒤 late response를 버린다.
- explicit logout, account switch, account deletion은 이전 owner의 cache와 decision
  draft/pending mutation을 purge한다. 일시적인 token refresh나 네트워크 오류는 draft를
  삭제하지 않는다.
- reply push는 사용자 DB preference가 기본 off이고 Settings의 명시 opt-in만 OS 권한을
  요청한다.
- token은 installation + exact Auth session + binding epoch로 묶고 logout 전에 server
  release와 device unregister 중 적어도 한 전달 경계를 닫는다.
- 구버전의 session-scoped legacy binding은 같은 user+session의 새 installation bind에서
  트랜잭션 안에 이전한다. 다른 사용자·다른 세션 token 탈취는 계속 거부한다.
- push queue는 발송 직전 preference, session, block, suspension, content 상태를 다시
  확인한다. 탭 시에도 owner와 현재 콘텐츠를 서버에서 재확인한 뒤에만 이동한다.
- 탭 재검증 URL은 exact `EXPO_PUBLIC_SITE_URL`만 사용한다. preview/production에서 값이
  없거나 안전하지 않으면 운영 도메인을 추측하지 않고 fail-closed한다.
- push payload에는 글 제목·본문·업체·금액·예식일을 넣지 않는다.
- provider 전달은 default-off이고 기본 Vercel cron에도 등록하지 않는다. Expo
  ticket/receipt 실기기 canary와 별도 rollout 승인 전에는 켜지 않는다.

### 2.5 Storage와 의존성

- migration은 Supabase가 관리하는 `storage.objects` policy나 `storage.buckets`를 직접
  수정하지 않는다.
- 폐기된 `guestbook-images`, `guestbook-uploads`는 지원되는 Storage API로 private 전환하는
  별도 destination-fenced operation만 제공한다. object 이름·byte는 출력하거나 삭제하지
  않는다.
- `postcss`, `undici 6/7`, `brace-expansion`, `fast-uri`의 알려진 advisory 패치 버전을
  workspace override로 고정한다.

Storage 실행 절차:

- `supabase/platform-operations/storage/README.md`
- `scripts/retire-guestbook-storage-buckets.mjs`
- `supabase/platform-operations/storage/20260804120000_retired_guestbook_storage_inventory.sql`
- `supabase/platform-operations/storage/20260804120000_retired_guestbook_storage_verify.sql`

## 3. active local migration candidate 순서

아래 파일은 `supabase/migrations`에 있으나 hosted apply 증거가 없는 successor candidate다.
순서를 바꾸거나 한 파일만 수동 적용하지 않는다.

| 순서 | migration | 책임 |
|---:|---|---|
| 1 | `20260804103000_community_report_resolution_atomic.sql` | moderation/report/appeal 원자 영수증 |
| 2 | `20260804120000_community_profile_guestbook_p0_hardening.sql` | profile direct-write 차단과 guestbook DB retirement |
| 3 | `20260804130000_community_runtime_control.sql` | normal/read-only/disabled runtime 원장 |
| 4 | `20260804140000_community_responder_supply_foundation.sql` | responder capacity/request 수명주기 |
| 5 | `20260804150000_community_comment_service_write_boundary.sql` | comment service-only 원자 쓰기·재시도 |
| 6 | `20260804160000_community_poll_set_intent.sql` | single-choice set-intent와 projection |
| 7 | `20260804170000_notification_session_ownership.sql` | installation/session push token ownership |
| 8 | `20260804180000_community_viewer_controls.sql` | block·hide와 actor-scoped visibility |
| 9 | `20260804185000_notification_delivery_outbox.sql` | opt-in reply push outbox/ticket/receipt |
| 10 | `20260804190000_community_decision_thread_vertical.sql` | DecisionThread command/event/outcome core |
| 11 | `20260804193000_community_decision_feed_read.sql` | 결정 feed/inbox service read model |
| 12 | `20260804194000_community_decision_outcome_review.sql` | 공개 outcome 검수·철회 |
| 13 | `20260804195000_community_decision_public_outcome_read.sql` | 검수·동의된 최신 outcome의 최소 public detail read |
| 14 | `20260804200000_community_post_service_write_boundary.sql` | post create/delete 원자 command boundary |

`supabase/release-manifests/vendor-disclosure-v2-20260718.json`가 ordered file과 SHA-256을
고정한다. 상태는 계속 `deployment_blocked`이고 hosted staging, backup, hosted restore,
Storage, finalizer evidence는 모두 `missing`이어야 한다.

별도의 Amora safety Wave A/B SQL은 `supabase/release-candidates`에만 남는다. 이 파일을
active migration으로 옮기는 것은 이번 handoff의 일부가 아니다.

## 4. 기본-off 출시 스위치

다음 값은 외부 증거와 명시 승인 전까지 그대로 유지한다.

```dotenv
COMMUNITY_REPLY_PUSH_DELIVERY_ENABLED=false
COMMUNITY_MEDIA_PUBLISHING_ENABLED=false
NEXT_PUBLIC_COMMUNITY_MEDIA_PUBLISHING_ENABLED=false
EXPO_PUBLIC_PUSH_REGISTRATION_ENABLED=false
EXPO_PUBLIC_COMMUNITY_MEDIA_PUBLISHING_ENABLED=false
AMORA_AUXILIARY_MEMORY_ENABLED=false
```

`COMMUNITY_RUNTIME_MODE=normal`은 앱 환경 힌트일 뿐 DB runtime 원장을 우회하지 않는다.
사고 대응에서는 DB 원장을 먼저 `read_only` 또는 `disabled`로 전환하고 runbook receipt를
남긴다.

reply-push provider route는 구현되어 있지만 기본 `apps/web/vercel.json`에는 schedule을
등록하지 않는다. hosted DB·Expo·실기기 canary와 실제 Vercel plan을 확인한 승인 배포에서만
별도 schedule을 추가한다. 기존 5·10·15분 cron도 sub-daily를 지원하는 plan이 필요하므로
실제 프로젝트 plan은 배포 전에 read-only로 확인한다.

## 5. 최종 로컬 검증

아래 결과는 2026-08-04 같은 source candidate에서 재실행한 로컬 증거다. 로컬 검증이
통과했다는 뜻이며 hosted 환경, 서명된 앱, 실제 사용자 E2E 또는 production 배포를
증명하지 않는다.

| 검증 | 최종 결과 |
|---|---|
| frozen install | PASS — `corepack pnpm install --frozen-lockfile`, lockfile 변경 없음 |
| production + full dependency audit | PASS — 두 audit 모두 알려진 취약점 0건 |
| monorepo typecheck/lint | PASS — ingest + 4 package typecheck, 전체 lint 경고 0건 |
| web Vitest 8 shards | PASS — 588 files, 5,816 tests, 8/8 shard exit 0 |
| mobile full tests | PASS — 425/425 |
| repository/release tests | PASS — stale dependency pin을 RED 재현·수정한 뒤 최종 273/273 |
| Amora transferred-draft regression | PASS — 새 회귀 파일과 기존 composer draft 묶음 2 files, 28 tests |
| web production build | PASS — Next.js 16.2.11 compile·TypeScript·150/150 static page generation |
| Expo export/release check | PASS — Web·Android·iOS export, 104/104 release checks. 로컬 Sentry org/project 경고는 외부 gate로 유지 |
| release fence + manifest hash | PASS — predecessor 27, successor 80 migrations, local tail 14개 hash mismatch 0; 상태 `deployment_blocked` |
| browser desktop/mobile QA | PASS (LIMITED — local safe preview-stub shell/fail-closed smoke). 아래 §5.2 범위만 확인 |

### 5.1 Git 게시 영수증

- 대규모 Amora·커뮤니티 source candidate: `cedd7a1bf1ed4a5c7dfab11dde1feebc3d2f7414`
  (`feat: harden Amora decision and community release candidate`).
- 모바일 첫 질문 초안 가시성 회귀 수정: `7d39645dffacffebd5dc53e85e670e9e618ea13e`
  (`fix(qa): expand transferred Amora draft for review`).
- `7d39645d...` 게시 직후 local HEAD, tracking ref, GitHub `ls-remote`가 exact 일치했고
  working tree는 clean이었다.
- 이 수정 push의 pre-push gate는 typecheck·lint·test 8/8 task PASS(5 cached),
  11분 18초였다. 훅을 우회하지 않았다.
- Draft PR [#79](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/79)가
  `main` ← `agent/release-handoff-20260731`로 열려 있고, 확인 당시 head는 exact
  `7d39645d...`였다. review decision은 아직 없다.
- 구현 commit의 GitHub CI
  [run 30889455231](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/actions/runs/30889455231)은
  2026-08-04 17:09 KST snapshot에서 Mobile Quality, Vendor Disclosure Quality,
  Static Release Contracts가 성공했고 Web Quality의 web tests가 진행 중이었다.
  `Production Readiness: BLOCKED (Hosted Evidence Required)`는 hosted evidence가 없으면
  fail-closed하는 step에서 실패했다. 따라서 source가 원격 브랜치에 있다는 사실을
  review·CI 전체 통과·배포 완료로 해석하지 않는다.
- 이 문서를 갱신하는 documentation-only commit 때문에 브랜치 tip은 위 구현 commit보다
  새로울 수 있다. 다른 컴퓨터에서는 고정 SHA를 추측하지 말고 `git rev-parse HEAD`와
  `git rev-parse @{u}`를 다시 비교한다.

GitHub push가 출력한 `34 vulnerabilities`는 저장소 **default branch**에 대한 Dependabot
안내였다. 이 브랜치 source candidate에서는 같은 날 `corepack pnpm audit`와 production
audit를 별도로 실행해 알려진 취약점 0건을 확인했다. 두 범위를 섞어 “GitHub 전체가
안전하다”거나 “이 브랜치에 34건이 있다”고 말하지 않는다.

### 5.2 safe preview-stub 브라우저 영수증

아래 브라우저 QA는 실제 credential 대신 repository의 synthetic Supabase 환경과
`NEXT_PUBLIC_PREVIEW_STUB_MODE=true`를 사용한 HMR 없는 local production server에서
실행했다. 외부 쓰기를 막은 public shell·fail-closed 검증이며 hosted/authenticated/stateful
E2E가 아니다.

| source | 화면·viewport | 확인 결과 |
|---|---|---|
| `cedd7a1b...` | Landing 1440×1000, 390×844, 320×720 | 200, 핵심 제목·CTA 표시, horizontal overflow 0, 44px 미만 visible target 0(모바일), console error 0 |
| `cedd7a1b...` | Landing 일정 반영 예시·mobile menu | 예시 1건과 reset 표시, anchor 이동 뒤 menu 닫힘·`aria-expanded=false`. 빠른 이동 뒤 responsive hero preload warning 1건은 있었지만 console error는 아님 |
| `cedd7a1b...` | Community 1440×1000, 390×844 | `/community` → canonical `/wedding` 307, public shell 제목·기존 fallback 표시, horizontal overflow 0 |
| `cedd7a1b...` | Start-here 390×844 → Amora demo | `/api/demo/start` 200, `/wedding/chat` 이동, demo 경계·공유 composer·private disabled 표시, console error 0. 이 과정에서 104자 인수인계 초안이 44px 입력창에 잘리는 회귀를 발견 |
| `7d39645d...` | Start-here 390×844 → Amora demo 재검증 | 같은 104자 초안이 `clientHeight=140`, `scrollHeight=140`, `maxHeight=160px`; 스크롤 없이 전부 검토 가능, horizontal overflow 0, console error 0 |

Community의 preview-stub DecisionThread API는 의도적으로
`503 preview_stub_api_disabled`를 반환했고 discovery component는 이를 숨긴 뒤 기존 public
shell을 유지했다. 이 결과는 fallback의 fail-closed 동작만 증명하며 DecisionThread의 실제
read/write E2E를 증명하지 않는다. 브라우저 스크린샷은 `.gstack/qa-reports/screenshots/`의
로컬 생성 증거로 보존했지만 generated artifact이므로 Git source에는 넣지 않았다.

따라서 이번 브라우저 결과가 증명하지 않는 범위는 실제 로그인, 서로 다른 두 계정,
hosted DB/Storage, DecisionThread 질문·답변·해결·outcome write/read, production network,
실제 push, 모바일 키보드·VoiceOver·TalkBack, Lazyweb 보고서다.

## 6. production NO-GO를 유지하는 외부 증거

다음 중 하나라도 없으면 migration apply, public 확대, push enable, media enable을 하지 않는다.

1. 실제 linked Supabase remote ledger와 exact pending set
2. exact clean commit의 logical backup과 다른 hosted project restore
3. supported Storage API inventory/apply/verify와 CDN/object 보존 receipt
4. migration controller apply, postcondition, canary, finalizer receipt
5. Vercel project plan, cron 등록, `CRON_SECRET`, destination fence 증거
6. Expo access control, iOS/Android 실제 push ticket·receipt·tap·logout·upgrade 검증
7. 서명된 EAS build와 최소 지원 버전/구버전 차단 계획
8. 실제 두 계정·두 기기에서 질문→답변→적용성→결정→outcome 한 바퀴
9. 답변자 capacity, moderation/appeal, 고객지원 owner와 SLA 리허설
10. Lazyweb 화면 보고서 또는 동등한 실제 화면·접근성 캡처

현재 환경에는 Lazyweb 보고서 도구가 로드되지 않아 시각 품질을 완료로 판정하지 않는다.
기존 `DESIGN.md`, design token, AppUI 방향은 유지했지만 이는 실기기 UX 증거가 아니다.

### 알려진 source-level 잔여 위험

- 작성자 post/comment PATCH는 admin 타인 수정, PII, media, body 크기, author TOCTOU를
  fail-closed로 막지만 아직 별도 durable command receipt가 없는 set-state update다.
  중복 부작용은 없지만 응답 유실과 같은 계정의 동시 편집을 완전히 판별하려면
  operation key + expected revision 경계를 후속으로 추가해야 한다.
- Expo provider가 ticket을 성공 반환한 직후 DB ticket 저장 전에 process가 종료되면
  at-least-once 재발송 가능성이 남는다. notification ID 기반 `collapseId`로 중복 표시를
  줄였지만 provider/DB 분산 transaction을 증명하는 것은 아니다.
- PGlite 동시성 검증은 실제 hosted PostgreSQL의 다중 connection pool, Vercel timeout,
  Realtime 순서를 대신하지 않는다.
- 사람 답변 공급·moderation staffing·고객지원 연락처의 실제 운영 owner가 코드만으로
  확정되는 것은 아니다.

이 항목은 숨은 완료 조건이 아니라 controlled beta의 명시적 제한이다. 실제 사용자에게
영향이 생기는 범위를 넓히기 전에 별도 evidence와 중단 기준으로 닫는다.

## 7. 안전한 배포 순서

1. 이 브랜치의 clean commit과 원격 SHA를 고정한다.
2. feature/push/media/memory flag를 모두 off로 확인한다.
3. read-only remote ledger를 수집하고 manifest pending set과 exact 비교한다.
4. backup·다른 hosted project restore·Storage prestate를 검증한다.
5. controller가 허용한 ordered migration 전체를 staging에 적용한다.
6. anon/authenticated/service/admin, 두 사용자, 두 세션, 재시도와 rollback probe를 실행한다.
7. backward-compatible server/API와 web을 먼저 배포한다.
8. mobile을 배포하고 최소 지원 버전과 legacy ingest/push migration을 검증한다.
9. controlled beta allowlist에서 text-only DecisionThread를 연다.
10. responder/moderation SLA와 실제 결과가 안정된 뒤에만 범위를 넓힌다.
11. push는 별도 opt-in cohort에서 ticket/receipt/tap/quiet-hour 증거 후 켠다.
12. media와 검색 색인은 각각 별도의 privacy/moderation gate 후 검토한다.

실패 시 직접 migration 파일을 고치거나 history repair하지 않는다. fence/flag를 닫고 기존
receipt를 보존한 뒤 forward-only migration 또는 runtime rollback을 설계한다.

## 8. 다른 컴퓨터에서 이어서 개발하기

Git에는 source와 공개 가능한 runbook만 둔다. `.env*`, service-role key, Expo token,
production receipt, 실제 사용자 데이터는 승인된 secret/evidence store에서 별도로 복원한다.

```powershell
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
cd wedding-hanbang-web
git switch --track origin/agent/release-handoff-20260731
corepack enable
corepack pnpm install --frozen-lockfile
git status --short --branch
git rev-parse HEAD
```

로컬 branch가 이미 있으면 다음처럼 한다.

```powershell
git switch agent/release-handoff-20260731
git fetch origin
git pull --ff-only
git branch -vv
```

기본 확인:

```powershell
corepack pnpm audit
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm --dir apps/web test
corepack pnpm --dir apps/mobile test
corepack pnpm test:repo
corepack pnpm mobile:release-check
corepack pnpm supabase:release:fence
git diff --check
```

`supabase db push`, `--include-all`, migration history repair, production alias 승격은 개발 환경
복원 명령이 아니다. 외부 증거와 승인 없이 실행하지 않는다.

## 9. 다음 우선순위

1. 실제 인증 환경의 desktop/390px/320px DecisionThread read/write와 키보드·스크린리더 QA
2. 실제 iOS/Android 두 계정·두 세션·앱 upgrade/logout/account deletion 검증
3. 한 주제(`contract_extra_cost`)의 사람 답변 capacity와 moderation 운영 리허설
4. community → Amora cited proposal → 승인 → 할 일 하나 → outcome 영수증 E2E
5. 답변 대기 시간, 결정 명확성, 불안 변화, 알림 피로를 통제 cohort에서 측정
6. Lazyweb 근거를 사용한 화면별 정보 계층 검수

이 순서를 통과하기 전에는 더 많은 feed 형식, 이미지, 업체 공식 답변, 게임화, 유료 유입을
추가하지 않는다. 기능 수보다 “한 커플의 실제 고민이 안전하게 한 결정으로 닫히는가”가
현재 Definition of Done이다.

## 10. 운영 판단에 사용한 공식 문서

- Vercel Cron 사용량·요금제 제한:
  <https://vercel.com/docs/cron-jobs/usage-and-pricing>
- Vercel Cron 관리와 배포 동작:
  <https://vercel.com/docs/cron-jobs/manage-cron-jobs>
- Supabase Storage schema는 read-only로 취급:
  <https://supabase.com/docs/guides/storage/schema/design>
- Supabase Storage 권한과 `supabase_storage_admin`:
  <https://supabase.com/docs/guides/platform/permissions>
- 지원되는 bucket update API:
  <https://supabase.com/docs/reference/javascript/file-buckets-updatebucket>

문서 URL은 근거 출처일 뿐 현재 Vercel plan, hosted bucket 상태, 실제 배포 성공을
증명하지 않는다. 그 값은 exact release 시점에 다시 확인한다.
