# 2026-08-02 커뮤니티·전체 작업 트리 세션 인계

> [!IMPORTANT]
> **상태: SOURCE HANDOFF / NOT DEPLOYED / DATABASE BLOCKED / COMMUNITY PRODUCTION NO-GO / MOBILE NOT RELEASED**
>
> 이 문서는 `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`를 대체하지
> 않는다. 기존 문서가 전체 릴리스 상태 정본이고, 이 문서는 2026-08-02에 추가된
> 커뮤니티 설계와 대규모 후속 구현을 자세히 넘기는 보충 기록이다. clone·환경·웹/
> 모바일 연결 절차는 `docs/operations/CROSS_MACHINE_DEVELOPMENT_HANDOFF_2026-08-02.md`와
> 함께 읽는다.
>
> 이 문서를 GitHub에 올리는 것은 소스 공유일 뿐이다. Supabase migration 적용,
> Vercel production 배포, 커뮤니티 공개, EAS 빌드·스토어 출시는 승인하지 않는다.

## 1. 60초 인계

현재 제품 계약은 바뀌지 않았다.

**웨딩한방은 아모라에게 결혼 준비를 말하면, 예산·체크리스트·일정이 함께 정리되는
서비스입니다.**

이번 제품 판단은 아모라와 커뮤니티 중 하나를 없애는 것이 아니라, 방문 맥락에 따라
주인공을 분명히 하는 것이다.

- 웨딩한방 랜딩과 전체 브랜드에서는 **아모라**가 중심이다.
- 커뮤니티 홈과 글 상세에서는 **사람이 직접 남긴 경험과 답변**이 중심이다.
- 두 축은 `사람의 경험 → 내 상황에 맞는 해석 → 아모라 → 예산·일정·할 일` 순서로
  연결한다.
- 로그인 후 홈의 장기 방향은 아모라와 커뮤니티가 섞인 **커플 결정 인박스**다.

커뮤니티의 목적은 글을 많이 나열하는 것이 아니다. 예비부부가 지금 가진 질문을
가까운 조건의 실제 경험으로 해결하고, 결과를 다시 남겨 다음 커플의 결정을 돕는
**결정 네트워크**를 만드는 것이다.

커뮤니티 문화 문장은 다음과 같다.

> 자랑보다 조건을 남기고, 추천보다 이유를 남기고, 질문 뒤에는 결과를 남긴다.

## 2. Git 기준점과 저장소 함정

| 항목 | 값 |
|---|---|
| repository | `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git` |
| 작업 branch | `agent/release-handoff-20260731` |
| 작업 시작 HEAD | `764fb2136d56d7a3b8ba5ba884358c5a31bc939d` |
| 기존 Draft PR | `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/79` |
| 최종 source | 이 문서를 포함한 `origin/agent/release-handoff-20260731` HEAD |

현재 컴퓨터에는 중첩 저장소 함정이 있다.

- 실제 작업 저장소:
  `C:\Users\kcho1\Desktop\workspace\hanbang\wedding\wedding-hanbang-web`
- 바깥 `C:\Users\kcho1\Desktop\workspace\hanbang\wedding`도 별도 Git 저장소다.
- 바깥 저장소에서 보면 내부 저장소 전체가 untracked directory다.
- stage·commit·push는 반드시 내부 `wedding-hanbang-web` 루트에서 실행한다.

2026-08-02 문서화 직전 내부 저장소 감사 기준은 471개 visible 경로였다.

- tracked: 수정 292, 삭제 2
- untracked: 177
- tracked diff: 26,901 additions, 5,336 deletions
- staged: 0
- 로컬 branch와 origin branch: 시작 시 0 ahead, 0 behind

문서 수정으로 최종 경로 수는 달라진다. 최종 범위는 다음으로 다시 확인한다.

```powershell
git status --porcelain=v1 -uall
git show --stat --oneline HEAD
git diff HEAD^ --name-status
```

`artifacts/`의 브라우저 QA PNG 19개와 `apps/web/.env.local`은 소스가 아니며 커밋하지
않는다. `.gitignore`가 저장소 루트 `artifacts/`를 제외한다. 실제 비밀, 사용자 대화
원문, backup payload, raw 운영 receipt도 Git에 넣지 않는다.

## 3. 사용자와 확정한 제품 구성

### 웨딩한방 랜딩

- 아모라가 무엇인지 첫 화면에서 바로 이해되어야 한다.
- 기능 목록보다 `말하면 정리되고, 확인한 뒤 함께 반영된다`는 핵심 loop를 보여준다.
- 실제 커뮤니티 기록은 아모라를 대체하는 전면 기능이 아니라 신뢰 증거로 사용한다.
- 첫 방문자가 기능을 탐색하기 전에 결혼 준비의 부담이 가벼워질 수 있음을 느끼게 한다.

### 커뮤니티 홈

- 아모라 소개보다 검색과 사람의 해결 기록을 먼저 보여준다.
- 사용자가 게시판 구조를 배워야 하는 대신 자기 상황과 가까운 질문을 바로 찾게 한다.
- `답변 기다려요`, `해결된 고민`, `내 글`처럼 참여 이유와 다음 행동이 명확해야 한다.
- 글 수, 조회 수, 인기 순위보다 조건·출처·진행 상태를 먼저 읽을 수 있어야 한다.

### 커뮤니티 글 상세

- 순서는 `질문 또는 경험 → 작성 출처·광고 공개 → 사람의 답변 → 다음 행동`이다.
- `해결됨`은 질문자가 해결 여부를 표시했다는 뜻이며 특정 답변의 채택이나 정확성
  보증으로 과장하지 않는다.
- 사람의 답변을 읽은 다음에만 맥락형 아모라 행동을 제시한다.
- 아모라는 사람의 경험을 정답으로 확정하지 않고, 사용자가 반영 여부를 직접 고른다.

### 로그인 후 홈의 장기 방향

- 커뮤니티와 아모라를 별도 메뉴 두 개로만 두지 않는다.
- `우리와 비슷한 커플의 해결 기록`, `파트너와 맞출 기준`, `오늘 결정할 한 가지`,
  `결정 뒤 일정·예산·할 일 반영`을 하나의 결정 흐름으로 연결한다.
- 이 장기 방향은 이번 커밋에서 전부 구현된 기능이 아니다.

## 4. 이번에 실제 구현된 커뮤니티

### 검색 우선 홈

- 첫 소개 블록에서 비슷한 상황을 찾는 검색창을 전면에 둔다.
- 검색 → 사람 답변 → 출처·광고·해결 상태 확인의 사용 순서를 짧게 설명한다.
- 주제를 모바일에서도 한 번에 볼 수 있게 배치하고 세부 주제는 명시적으로 펼친다.
- 기본 홈에서는 사람의 글과 해결 상태를 아모라 소개보다 먼저 보여준다.
- 상태별 진입점 `답변 기다려요`, `해결된 고민`, `내 글`을 추가했다.
- 결과가 없으면 입력한 검색어를 질문 초안으로 이어갈 수 있게 안내한다.

### 신뢰가 보이는 글 상세

- 글 위에 다음 상태 중 하나를 표시한다.
  - 첫 사람 답변을 기다리는 질문
  - 사람의 답변을 확인 중인 질문
  - 질문자가 해결됐다고 표시한 기록
  - 운영 검토 중인 글
  - 사람이 남긴 경험 기록
- `content_origin`, 광고·혜택 공개 여부, 마지막 수정 시점을 함께 보여준다.
- 출처·광고 표시는 정확성 보증이 아니라는 경계 문구를 표시한다.
- 질문 내용, 사람의 답변, 다음 행동으로 바로 이동할 수 있게 구성했다.
- 본문 집중을 위해 중복된 좌측 정보 레일을 제거하고 관련 글은 별도 보조 영역으로 둔다.
- 상세 route의 `noindex` 계약은 유지한다.

### 사람 답변 뒤 아모라 연결

- 댓글 영역 뒤에만 `ServiceCTA`가 나타난다.
- 글 제목, 평문화한 본문 일부, 공개 가격 정보, 글 링크를 아모라 prefill에 함께 전달한다.
- 카테고리에 따라 예산 또는 일정 화면으로 이어지는 보조 행동을 제시한다.
- CTA는 아모라가 경험을 정답으로 확정하지 않으며 사용자가 반영을 선택한다고 명시한다.

### 비프로덕션 비교 시안

- 개발 환경에서만 `/community?variant=decision`, `stories`, `clinic` 세 시안을 비교할 수
  있다.
- production에서는 query가 있어도 시안을 렌더링하지 않는다.
- 시안의 예시 데이터는 UI 비교용 fallback이며 실제 회원 활동이나 운영 지표가 아니다.
- 시안 자체는 출시 승인이 아니며 실제 콘텐츠 공급과 사람 검증 뒤에 방향을 확정한다.

대표 파일:

- `apps/web/src/components/community/CommunityLandingClient.tsx`
- `apps/web/src/components/community/CommunityAcquisitionPrototype.tsx`
- `apps/web/src/app/(community)/community/post/[id]/PostDetailClient.tsx`
- `apps/web/src/components/community/ServiceCTA.tsx`
- `apps/web/src/components/community/__tests__/consumerValueBoundary.test.ts`
- `apps/web/src/components/community/__tests__/previewStub.test.tsx`
- `apps/web/src/app/(community)/community/page.test.tsx`
- `apps/web/src/app/(community)/community/post/[id]/page.test.tsx`

## 5. 아직 구현하지 않은 이상형

다음은 제품 방향 또는 후속 요구사항이다. 이번 source snapshot의 완료 기능으로 말하지
않는다.

- 게시글을 자유 텍스트에만 두지 않고 `선택·결과·적용 조건`으로 구조화
- 질문자가 실제로 도움 된 답변을 선택하고 이유를 남기는 흐름
- 경험 분야와 준비 단계에 따라 답할 가능성이 높은 사람에게 질문을 연결
- 파트너 두 명의 의견 차이를 비교하고 함께 확정하는 커플 결정함
- 해결 기록을 바탕으로 다음 질문과 준비 항목을 개인화하는 홈
- 결정 이후 실제 예산·일정·할 일 반영 결과를 커뮤니티에 되돌리는 loop
- 실제 해결 기록과 꾸준한 사람 답변 공급을 위한 운영 체계
- 신고, 복원, 이의제기, 광고·협찬, 개인정보·명예훼손 운영 훈련

## 6. 행복하고 즐거운 준비에서 남은 부족함

현재 방향은 정보 부족과 결정 불안을 줄이는 데는 강해졌지만, 기대감·소속감·작은
성취·둘만의 추억을 만드는 층은 아직 약하다. 글과 알림을 늘리는 것만으로 해결하지
않는다.

후속 제품은 홈에서 다음 세 가지를 균형 있게 다뤄야 한다.

1. 방금 해결된 고민
2. 지금 도움이 필요한 질문
3. 오늘 다른 커플이 기뻐한 순간

후속 기능 후보:

- 오늘 하나만 정하는 모드
- 두 사람이 짧게 의견을 맞추는 결정방
- 예산 절약뿐 아니라 취향 발견·첫 계약·준비 완료 같은 작은 성취 기록
- 내 답변이 다른 커플의 실제 결정에 도움 됐다는 결과 알림
- 비교 피로를 줄이는 주제 숨김, 알림 휴식, 조용한 준비 모드
- 갈등보다 서로의 취향과 기대를 발견하는 긍정 질문

향후 지표는 체류시간이나 글 수만 보지 않는다.

- 사용 후 마음이 가벼워졌는가
- 두 사람이 실제로 하나를 결정했는가
- 사람의 경험이 일정·예산·할 일로 안전하게 이어졌는가
- 비교 때문에 더 불안해지지 않았는가
- 도움을 받은 사람이 결과를 다시 남겼는가

## 7. 전체 작업 트리 영역 지도

이번 변경은 커뮤니티 UI만의 작업이 아니다. 일부만 골라 커밋하면 계약과 테스트가
끊길 수 있어, 로컬 생성물과 비밀을 제외한 연결된 source를 한 후보로 검증한다.

### 아모라 대화·안전

- shared AI, shared partner, private AI 대화 lane
- draft·attachment 안정화와 storage attachment 처리
- idempotent client request와 스트림·세션 재시도
- conversation segment 기반, dual-write와 read feature gate
- bounded continuity와 질문 범위 제한
- provider preview gate, provider call ledger, privacy epoch
- memory enqueue·repair·replay·recovery
- 위기 분류·회복과 W0–W5 안전 범위
- 숨은 자동 갈등 감지·중재 production 거부

### 오늘의 한 가지와 커플 공동 결정

- opt-in, in-app-only TodayOne care 계약과 웹·모바일 표면
- shared schedule decision receipt와 승인 정책
- manual schedule fairness와 roster binding
- revision·dual approval·pending approval inbox
- 취소·복원·재시도에서 중복 반영 방지

### 예산·예약·일정 무결성

- budget revision과 category registry
- quote/spend soft cancel
- 예약 결과와 일정 연결
- journey budget progress 무결성
- 날짜 분류와 수동 일정 변경 계약

### 커뮤니티·랜딩·온보딩

- 검색 우선 커뮤니티 홈과 상태·출처가 보이는 상세
- atomic cohort assignment와 idempotent community writes
- `start-here`를 route group 밖의 `/start-here`로 이동
- 랜딩 첫 방문 명료화와 준비 결과 preview
- 포용적 역할 copy와 관련 계약 테스트
- neutral couple-member 전환은 제안 문서만 있으며 DB 모델 전환은 미구현

### 모바일·공유 계약·관리자 API

- 웹·모바일 API bridge와 account-switch fence
- 채팅 세션 generation, community post mutation과 cohort access
- push registration gate, 예산·일정 write contract
- admin auth·upload·report·bookmark·moderation trust boundary
- `packages/shared`의 공통 contract와 safety export

## 8. Supabase migration과 릴리스 경계

로컬 successor manifest는 66개 migration을 고정하며 마지막 파일은
`20260802240000_amora_memory_job_recovery.sql`이다.

- normalized manifest SHA-256:
  `7019565f14ab03b60a033ddb5dd56a9c7cd3b4a810aa2fdb9aa9448431fb8cad`
- ordered migration versions digest:
  `96bc9d77687b502482f3bc361a5bce8c01f450d6ffd1f77488094221fee78360`

이번 작업 트리에 추가된 18개 migration:

1. `20260801090000_amora_chat_delivery_safety.sql`
2. `20260801100000_amora_conversation_segments.sql`
3. `20260802090000_amora_moment_care_source_revision.sql`
4. `20260802100000_amora_shared_schedule_decision_receipts.sql`
5. `20260802110000_amora_shared_schedule_approval_policy.sql`
6. `20260802120000_amora_conversation_segment_dual_write.sql`
7. `20260802130000_amora_in_app_today_one.sql`
8. `20260802140000_amora_manual_schedule_fairness.sql`
9. `20260802150000_amora_today_one_budget_guardrails.sql`
10. `20260802160000_booking_quote_spend_soft_cancel.sql`
11. `20260802170000_amora_shared_action_roster_binding.sql`
12. `20260802180000_community_cohort_assignment_atomic.sql`
13. `20260802190000_community_idempotent_writes.sql`
14. `20260802200000_journey_budget_progress_integrity.sql`
15. `20260802210000_amora_conversation_segment_roster_repair.sql`
16. `20260802220000_amora_memory_enqueue_repair.sql`
17. `20260802230000_amora_atomic_privacy_epoch.sql`
18. `20260802240000_amora_memory_job_recovery.sql`

이 18개는 **로컬 source와 정적 계약일 뿐 운영 DB에 적용되지 않았다.** hosted pending
set, backup, restore, apply receipt, read-only postcheck, rollback·canary 증거가 없다.
일반 `supabase db push`, `--include-all`, Dashboard 임의 SQL로 우회하지 않는다.

운영 전까지 exact value를 유지할 feature flag:

```dotenv
AMORA_AUXILIARY_MEMORY_ENABLED=false
AMORA_CARE_OUTBOUND_ENABLED=false
AMORA_COMMUNITY_AI_COMMENT_ENABLED=false
AMORA_CONVERSATION_SEGMENT_READ_ENABLED=false
AMORA_AUTOMATIC_CONFLICT_MEDIATION_ENABLED=false
AMORA_TODAY_ONE_ENABLED=false
```

실제 값은 각 플랫폼의 승인된 secret store에서 주입한다. `.env.local`을 컴퓨터 사이에
복사하거나 Git에 올리지 않는다.

## 9. 검증 ledger

2026-07-31의 `3,948 tests PASS`는 당시 candidate의 역사적 증거다. 이번 변경의 완료
증거로 재사용하지 않는다. 아래 표는 이 문서를 포함한 최종 source에서 다시 실행한
결과로 갱신한다.

| 명령 | 이번 snapshot 결과 |
|---|---|
| `git diff --check` | PASS; stage 후 한 번 더 실행 |
| 고신뢰 비밀 패턴과 민감 파일명 감사 | 실제 key 0; key처럼 보이는 값은 synthetic test fixture로 확인; stage 후 재검사 |
| `corepack pnpm typecheck` | PASS; ingest와 design-tokens/shared/mobile/web 4/4 |
| `corepack pnpm lint` | PASS; web/mobile 2/2, warning 0, error 0 |
| `corepack pnpm test` | PASS; root 종료 코드 0, web 529 files / 5,070 tests, Turbo 2/2 |
| `corepack pnpm mobile:release-check` | PASS; 104/104, warning 0, failure 0 |
| `corepack pnpm supabase:release:test` | PASS; 189/189 |
| `corepack pnpm supabase:release:fence` | PASS; 66개 manifest, 상태는 의도대로 `deployment_blocked` |
| `node scripts/audit/community-release-readiness.mjs` | local 13개 계약 READY, production은 외부 증거 부재로 NO-GO |
| `node --test scripts/tests/community-release-readiness.test.mjs` | PASS; 2/2 |
| `node --test scripts/tests/repository-handoff-docs.test.mjs` | PASS; 6/6 |
| `corepack pnpm qa:local` | 통합 명령은 실행하지 않음; 다른 작업의 web dev lock을 강제 종료하지 않고 개별 gate를 실행 |
| web production build | PASS; 격리 worktree와 local QA synthetic 환경에서 Next.js 16.2.11, 142개 정적 페이지, artifact 검사 1/1 |

실행하지 못했거나 실패한 항목은 `PENDING`, `FAILED`, `BLOCKED`로 남긴다. 문서의 체크
표시로 성공을 만들지 않는다.

## 10. 다른 컴퓨터에서 이어가기

일반 개발은 Node `22.13.0` 권장, root engine `>=22.13.0`, pnpm `11.7.0`이 기준이다.
Expo dev server는 별도 Node `20.19.x` terminal을 사용한다.

Windows PowerShell:

```powershell
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
Set-Location wedding-hanbang-web
git fetch --prune origin
git switch --track origin/agent/release-handoff-20260731
corepack enable
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm hooks:install
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/mobile/.env.example apps/mobile/.env.local
git status --short --branch
```

branch가 이미 로컬에 있으면:

```powershell
git fetch --prune origin
git switch agent/release-handoff-20260731
git pull --ff-only origin agent/release-handoff-20260731
```

최초 읽기 순서:

1. `PRINCIPLES.md`
2. `AGENTS.md`
3. `docs/MVP_PRODUCT_DIRECTION_2026-07-30.md`
4. `docs/operations/FULL_WORKSPACE_RELEASE_HANDOFF_2026-07-31.md`
5. 이 문서
6. 작업 영역의 release gate와 실제 code·test·migration

로컬 실행:

```powershell
corepack pnpm dev:web
corepack pnpm dev:mobile
```

GitHub source 동일성 확인:

```powershell
$branch = git branch --show-current
$localHead = git rev-parse HEAD
$remoteHead = (git ls-remote --heads origin "refs/heads/$branch" -split "\s+")[0]
[pscustomobject]@{ Branch = $branch; LocalHead = $localHead; RemoteHead = $remoteHead }
if ($localHead -ne $remoteHead) { throw "local HEAD와 origin branch HEAD가 다릅니다." }
git status --short --branch
gh pr view 79 --web
```

## 11. 다음 작업 순서

1. 이 source snapshot의 전체 gate와 GitHub checks를 먼저 닫는다.
2. DB는 backup·restore·hosted staging·postcheck 증거 없이 적용하지 않는다.
3. 커뮤니티의 실제 해결 기록과 사람 답변 공급 방식을 확보한다.
4. 질문·답변·선택·결과·적용 조건을 구조화한다.
5. 경험 기반 답변 라우팅과 신고·복원 운영을 검증한다.
6. 파트너와 함께 보는 커플 결정함을 만든다.
7. 작은 성취·긍정 경험·휴식 제어를 제품에 넣는다.
8. 사람 검증 뒤에만 커뮤니티 공개 범위를 넓힌다.
9. 아모라 연결은 항상 제안→확인→승인→반영 경계를 유지한다.

## 12. 지금 하지 말아야 할 것

- 이 branch를 검증 없이 `main`에 merge
- production deploy 또는 Vercel production alias 전환
- 직접 `supabase db push`나 Dashboard SQL 실행
- `AMORA_CONVERSATION_SEGMENT_READ_ENABLED`, `AMORA_TODAY_ONE_ENABLED`, 자동 갈등 중재를
  운영에서 활성화
- 예시 커뮤니티 데이터를 실제 회원 활동처럼 노출
- 커뮤니티 local READY를 production 공개 승인으로 해석
- 모바일 production build·submit gate 우회
- `.env.local`, 운영 token, 사용자 원문, backup·raw receipt 커밋
