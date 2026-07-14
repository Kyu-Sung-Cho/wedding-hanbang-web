# 한방 커플재판소 구현 계획과 현재 계약

> 상태: 보존·통합 브랜치 검증 중. 운영 DB 적용, 인증된 브라우저 E2E, 모바일 실기기 빌드,
> `main` 병합과 운영 배포는 하지 않았다.
>
> 기준 브랜치: `integration/couple-court-reconciled-20260714`
>
> 코드 체크포인트: `4a39a85ce16cab1570afcb56bb7611005a174a37` — WIP backup
> `e7c3106382fc5b537fa5f90db5ca30b0a0c04022`를 `origin/main`
> `d2eab99304c0d79fbbe6f20354074b229c9035cf`와 충돌 해결한 merge 기준. PR #38은 역사 보존용
> Draft이며 이 브랜치를 강제 갱신하거나 운영에 병합하는 절차가 아니다.
>
> 기준일: 2026-07-14
> 제품 원칙: 신뢰와 안전을 재미보다 우선하고, 승패보다 실제 합의를 완성한다.

이 문서는 위 코드 체크포인트의 구현 계약이다. 마이그레이션 파일·정적 contract test·중간 테스트 기록은 실제 Supabase 적용, 운영 배포, 복구 가능성 또는 출시 승인을 증명하지 않는다.

이 문서는 최초 요구사항과 현재 구현을 맞춘 개발 계약이다. 운영 절차와 다음 컴퓨터에서의 인계는 [`couple-court.md`](./couple-court.md)를 따른다. 문서와 코드가 다르면 다음 순서로 확인한다.

1. `apps/web/src/lib/coupleCourt/types.ts`, `state.ts`, `schema.ts`
2. `apps/web/src/app/api/couple-court/**`, `apps/web/src/lib/coupleCourt/repository.ts`
3. `supabase/migrations/20260713110000_create_couple_court.sql`
4. 이 문서

## 1. 목표와 비목표

한방 커플재판소는 결혼 준비 중 생긴 갈등을 사실, 감정, 기대, 합의, 실행으로 나눠 두 사람이 다음 행동을 정하도록 돕는다.

현재 구현 범위는 다음과 같다.

- 한 사람의 진술로 시작하는 `혼자 임시판결`
- 상대가 신청인 원문을 보지 않고 독립적으로 진술하는 `둘만의 중재실`
- OpenAI GPT-5.6 Terra의 구조화 출력으로 만드는 `한방 판결`
- 구체적 후속 행동을 수락·완료하고 아모라 할 일로 저장하는 `화해 처방`
- 별도 비식별 스냅샷, 당사자 동의, 운영 심사를 모두 거치는 `웨딩한방 공개재판`
- 공개 투표·댓글·신고와 관리자 심사
- 이의 제기 시 원문을 덮어쓰지 않는 새 진술 revision과 새 판결

다음은 비목표다.

- 법률·의료·심리 진단이나 전문 상담 대체
- 상대의 의도·성격·정신 상태 단정
- AI가 사용자 확인 없이 일정·예산·계약을 변경하는 기능
- 진술 원문을 공개 게시물이나 공유 이미지로 직접 재사용하는 기능
- 실제 사용자처럼 보이는 허위 사례·투표·후기·해결률 생성
- 안전 위험 사건에 재미 판결, 공동 대화, 공개를 권하는 기능

최우선 제품 지표는 `판결 후 실제 결정 완료율`이다. 분석에는 원문·제목·UUID·초대 토큰·전체 URL을 넣지 않는다.

## 2. 저장소 구조와 재사용 자산

웨딩한방은 pnpm/Turbo 모노레포다. 이번 기능은 기존 Next.js Route Handler, Supabase, 디자인 토큰, OpenAI 감사 래퍼를 유지하며 새 프레임워크나 상태관리 라이브러리를 추가하지 않는다.

| 영역 | 현재 위치 | 재사용 내용 |
| --- | --- | --- |
| 웹 화면 | `apps/web/src/app`, `apps/web/src/components` | `(app)` 인증 레이아웃, `(community)` 공개 레이아웃, 기존 버튼·카드·타이포·색 토큰 |
| 서버 API | `apps/web/src/app/api` | Route Handler, 사용자 확인, 안전한 JSON·same-origin 검사, 영속 rate limit |
| AI | `apps/web/src/lib/ai` | 모델 역할, 비용 가드, Responses API 감사 래퍼, 원문 비기록 |
| DB | `supabase/migrations` | PostgreSQL/Supabase, RLS, service-role 전용 원자 RPC, 계정 삭제 lifecycle |
| 후속 할 일 | `public.amora_actions` | 화해 처방을 한 번만 저장하는 원자적 연결 |
| 공유 | `apps/web/src/lib/share`, WeddingCode 공유 유틸 | Canvas 1080×1350 PNG, Web Share API와 다운로드 대체 경로 |
| 분석 | `apps/web/src/lib/analytics` | 이벤트명·속성 runtime allowlist |
| 관리자 | `/admin`, `apps/web/src/lib/utils/adminAuth.ts` | 기존 관리자 세션과 `profiles.is_admin` 심사 권한 |

## 3. 제품 언어와 모드

- 전체 기능: **한방 커플재판소**
- 비공개 2인 공간: **둘만의 중재실**
- AI 결과: **한방 판결**
- 후속 실행: **화해 처방**
- 공개 커뮤니티: **웨딩한방 공개재판**
- AI 중재자: **한방 판사 아모라**

`재판`과 `판결`은 기억을 돕는 비유다. 처벌, 승패, 유죄, 공개 망신보다 이해와 실행을 우선한다.

### 혼자 임시판결 (`solo`)

신청인 한 명의 진술만 사용하며 결과에 `provisional: true`를 강제한다. 상대의 관점·의도는 만들지 않는다. 판결 뒤 상대를 초대하면 기존 임시판결과 원문은 상대에게 노출하지 않고, 상대의 독립 진술 뒤 새 쌍방 판결을 만든다.

### 둘만의 중재실 (`couple`)

신청인과 상대가 각각 자신의 진술만 본다. 현재 구현은 판결 전후를 포함해 상대방의 **원문 진술을 직접 공개하지 않는다**. 두 진술을 바탕으로 만든 중립 요약과 관점 차이만 판결에서 제공한다.

### 판결 맛

- `gentle`: 다정맛
- `practical`: 현실맛
- `spicy`: 매운맛

말투만 달라지며 사실성·안전 기준·행동 품질은 같다. `sensitive`에서는 장난스러운 표현을 끄고, `high_risk`에서는 일반 판결 자체를 중단한다.

## 4. 카테고리 계약

코드 enum과 사용자 라벨은 다음 12개다.

| ID | 라벨 |
| --- | --- |
| `budget` | 예산 및 추가금 |
| `planning_roles` | 준비 역할 분담 |
| `venue` | 웨딩홀 선택 |
| `studio_dress_makeup` | 스튜디오·드레스·메이크업 |
| `family` | 양가 부모님 의견 |
| `guests_invitations` | 하객 및 청첩장 |
| `honeymoon` | 신혼여행 |
| `home_setup` | 혼수 및 신혼집 |
| `communication` | 연락 및 답변 속도 |
| `formalwear_shooting` | 예복 및 촬영 의상 |
| `ceremony_events` | 예식 순서 및 이벤트 |
| `other` | 기타 결혼 준비 갈등 |

질문 도움말과 12개 예시 사건은 `apps/web/src/lib/coupleCourt/catalog.ts`가 단일 출처다. 예시는 항상 `예시`로 표시하며 운영 DB를 자동 seed하지 않는다.

## 5. 정보 구조와 라우트

브라우저 canonical URL은 기존 규칙에 따라 `/wedding` prefix를 사용한다. 표에는 코드 내부 경로를 적었다.

| 목적 | 내부 경로 | 접근 |
| --- | --- | --- |
| 내 사건·기능 홈 | `/couple-court` | 로그인 + private 플래그 |
| 새 사건 | `/couple-court/new` | 로그인 + private 플래그 |
| 사건 진행 | `/couple-court/cases/[caseId]` | 사건 참여자 |
| 내 진술 | `/couple-court/cases/[caseId]/statement` | 사건 참여자 |
| 판결 | `/couple-court/cases/[caseId]/verdict` | 사건 참여자, 고위험 차단 |
| 화해 처방 | `/couple-court/cases/[caseId]/mission` | 사건 참여자 |
| 초대 수락 | `/couple-court/invite#token=...` | 공개 진입, 수락은 로그인 필요 |
| 공개 피드 | `/couple-court/public` | public 플래그, 읽기는 비로그인 가능 |
| 공개 상세 | `/couple-court/public/[postId]` | public 플래그, 쓰기는 로그인 필요 |
| 운영 심사 | `/admin/couple-court` | 기존 관리자 인증 |

초대 원문 토큰은 path/query가 아니라 URL fragment에만 둔다. fragment는 서버·CDN 요청에 실리지 않는다. 로그인 전 수락 시 서버는 토큰 해시만 AES-256-GCM HttpOnly 쿠키에 최대 10분 보관한다.

## 6. 상태 기계

private 진행, 안전, 공개 진행은 서로 독립된 축이다. `public_review`, `public_published`, `flagged`를 private workflow enum에 섞지 않는다.

### 6.1 비공개 workflow

`court_cases.workflow_status`:

- `draft`
- `awaiting_applicant_statement`
- `awaiting_partner`
- `awaiting_partner_statement`
- `statements_complete`
- `judging`
- `verdict_ready`
- `mission_active`
- `resolved`
- `archived`

주요 순방향은 `awaiting_applicant_statement → awaiting_partner|statements_complete → awaiting_partner_statement → statements_complete → judging → verdict_ready → mission_active → resolved`다. 다음 예외도 서버가 명시적으로 처리한다.

- `failed_unstarted | failed_invalid | failed_unknown`: verdict generation은 실패로 닫고 `judging → statements_complete`. 단 `failed_unknown`은 관리자 reconciliation 전 동일 입력 claim을 차단함
- `result_staged`: `judging`을 유지하고 별도 `provider_audit_state=pending | audited`를 거쳐 provider 재호출 없이 감사 복구·complete
- provider high-risk: 판결 payload 없는 `failed_invalid/safety_high_risk`와 `provider_audit_state=pending | audited`를 사용하며 일반 판결 complete는 하지 않음
- solo의 상대 초대: 링크 **발급만으로는** `solo`와 현재 workflow를 유지한다. 상대가 실제 수락할 때 `mode=couple`, `awaiting_partner_statement`로 바뀌며 기존 임시판결은 `superseded` history가 됨
- 상대 나가기: 상대의 첫 진술 전에만 가능. solo 기원 사건은 임시판결을 복원해 `solo/verdict_ready`로, 원래 couple 사건은 `couple/awaiting_partner`로 돌아감
- 이의 제기 revision: `verdict_ready|mission_active|resolved → statements_complete`. 기존 ready 판결은 `superseded` history가 됨
- 신청인 보관: 허용된 활성 상태 → `archived`

### 6.2 안전 축

- `court_cases.safety_level`: `normal | sensitive | high_risk`
- `court_cases.safety_review_status`: `none | pending | approved | rejected`

안전 등급은 낮아지지 않는 방향으로 병합한다. 독립 안전 검사가 `normal`에서 `sensitive` 이상으로 올리면 이전 안전 계약으로 생성 중이던 lease와 ready 결과를 fence하고 공개 후보·동의를 숨긴다. 반대로 현재 provider 결과가 처음 `sensitive`를 발견한 경우에는 **그 요청의 유효한 lease token을 검증한 뒤** 안전 등급 승격, 공개 철회, 검증 결과 stage를 한 트랜잭션으로 완료하고 감사 finalize 뒤에만 판결을 complete한다. `high_risk`가 되면 진행 중 판결 lease를 종료하고 기존 판결·처방도 일반 API와 직접 RLS 조회에서 숨긴다.

### 6.3 공개 축

`court_public_posts.status`:

- `awaiting_consents`
- `pending_review`
- `published`
- `hidden`
- `rejected`

별도 `moderation_status`는 `pending | approved | rejected`다. `pending_review`는 동의 완료 상태일 뿐 자동 승인 상태가 아니다. 관리자가 승인한 뒤 참여자가 publish 요청을 다시 보내야 `published`가 된다.

## 7. 데이터 모델

마이그레이션: `supabase/migrations/20260713110000_create_couple_court.sql`

### 비공개·실행 영역

- `court_cases`: 모드, 카테고리, 말투, workflow, 안전 등급, 제목, 보관 시각, exact replay용 `creation_request_id`
- `court_participants`: 사건별 `applicant | partner`, 참여 상태
- `court_invites`: SHA-256 토큰 해시, 만료·사용·폐기 시각. 원문 토큰 미저장
- `court_statements`: 작성자별 immutable revision과 구조화 진술, exact replay용 `submission_request_id`
- `court_verdicts`: 입력 hash, prompt/schema 버전, model, 순차 `generation_version`, `in_progress | ready | failed | superseded`, generation lease, 구조화 결과
- `court_provider_reservations`: provider request key/hash, couple/user quota scope, `reserved | started | result_staged | completed | failed_unstarted | failed_invalid | failed_unknown | retry_allowed`, 별도 `provider_audit_state=not_required | pending | audited`, 검증 결과 staging, 고위험·보관 시 payload-free 감사 envelope, reconciliation 메타데이터
- `court_missions`: 판결별 처방과 선택적 `amora_actions` 연결. 과거 판결의 처방은 history로 남지만 현재 상태·mutation에서 제외
- `court_mission_completions`: 참여자별 수락·완료 상태
- `court_followups`: 만족도, 남은 쟁점, 메모
- `court_case_events`: 원문이 아닌 제한된 상태 메타데이터 감사 이벤트

### 공개 영역

- `court_public_posts`: 별도 `sanitized_snapshot_json`, hash/version, 심사·공개 상태
- `court_public_consents`: 참여자가 동의한 정확한 snapshot hash
- `court_votes`: `(public_post_id, user_id)`당 하나, 선택 변경 가능
- `court_comments`: 유형, 정제 본문, moderation 상태
- `court_reports`: 게시물·댓글 신고와 처리 상태
- `court_public_feed`, `court_public_comment_feed`: 승인·공개·normal 데이터만 노출하는 보안 경계 view

P0에는 증거 업로드 테이블·UI를 넣지 않았다. 검증된 저장소·접근제어 없이 파일 기능을 노출하지 않는 것이 현재 결정이다.

### 7.1 사용자 쓰기의 exact request ID

- `court_cases.creation_request_id`는 사건 생성 UUID다. `(creator_user_id, creation_request_id)`가 unique다.
- `court_statements.submission_request_id`는 진술 제출 UUID다. `(participant_id, submission_request_id)`가 unique다.
- 같은 ID와 정규화된 동일 payload는 기존 결과를 replay한다. 같은 ID를 다른 mode/category/tone/title 또는 다른 진술/revision 의도에 재사용하면 mismatch로 거부한다.
- 클라이언트는 request ID를 user-scoped draft와 함께 보존하고 네트워크 재시도에서 그대로 보낸다. 다른 로그인 사용자의 draft는 복원하지 않으며 legacy unscoped draft는 폐기한다.
- 이 ID는 판결 input hash나 provider idempotency key를 대체하지 않는다.

## 8. 권한, 개인정보, 삭제

- private 사건은 active 참여자만 사건 기본 정보를 읽는다.
- 각 사용자는 자신의 최신 진술 원문만 일반 API로 받는다.
- verdict와 mission 테이블은 authenticated 직접 SELECT를 허용하지 않고 서버가 안전한 응답을 조립한다.
- 모든 쓰기 RPC는 service role만 실행하고, RPC 내부에서 사용자·참여자·역할·상태를 다시 확인한다.
- 공개 사용자는 private 테이블과 join하지 않는 sanitized view만 읽는다.
- 공개 후보는 전화번호, 이메일, 주소, 계좌·식별번호, 실명, 업체·예식장 후보, 정확한 금액 등 탐지 규칙과 사건별 known entity 차단을 거친다.
- 클라이언트 분석·일반 오류 로그에는 진술 원문, 토큰, 제목, UUID를 남기지 않는다. 전용 AI 감사 행은 원문 입력·출력·case ID 없이 비용·보안 상관관계용 `user_id`·`couple_id`만 플랫폼 retention 경계 안에서 보존한다.

`DELETE /api/couple-court/cases/[caseId]`는 body를 생략하거나 `action: "archive"`를 보내면 **보관**, `action: "delete"`와 확인 문구 `영구삭제`를 보내면 **영구삭제**를 요청한다. 둘 다 신청인만 실행할 수 있다. 보관은 초대를 폐기하고 공개 스냅샷·동의를 숨긴다. 일반 private 사건 행은 보존하지만 진행 중 generation lease와 `result_staged`의 private 판결·처방 payload는 제거한다. 검증 결과가 도착해 감사 의무가 생긴 호출의 input hash·request key·audit identity·response model·usage와 `pending | audited` 상태는 payload-free envelope로 보존하고 quota도 유지한다. 영구삭제는 solo 사건 또는 상대방 진술이 아직 없는 사건에서만 허용하며, 상대방 진술이 접수된 뒤에는 공동 삭제 정책이 없으므로 `409 COURT_DELETE_REQUIRES_JOINT_POLICY`로 거부한다. `workflow_status=judging`이면 먼저 보관하도록 거부하고, 어느 reservation이든 `provider_audit_state=pending`이면 감사 복구·finalize 전까지 삭제를 거부한다. 서버 API·client helper·상세 화면 입력 확인 UI가 연결되어 있다. 계정 삭제가 시작되거나 참여자 profile이 삭제되면 한 사람의 데이터만으로 안전하게 분리할 수 없으므로 사건 전체와 연결된 court 출처 `amora_actions`를 삭제한다.

영구삭제는 court case graph를 cascade 삭제하지만 별도 `ai_interactions_log` 비용·보안 감사 행을 즉시 삭제하지 않는다. 커플재판소 감사 행은 원문 입력·출력·case ID를 저장하지 않는다. checked-in 플랫폼 retention 계약은 90일 뒤 직접 식별자와 metadata를 정제하고 1년 뒤 집계 행을 삭제한다. 실제 운영 cron 적용·실행은 별도 증거가 필요하다. 사용자에게 `모든 기록이 즉시 사라진다`고 설명하면 이 계약과 어긋난다.

## 9. AI 판결 계약

- 모델 역할: `primary`
- 정확한 모델: `gpt-5.6-terra`
- reasoning effort: `none`만 허용
- 최대 출력: 800 tokens
- prompt: `apps/web/src/lib/coupleCourt/prompts/coupleCourtJudge.ko.ts`
- prompt version: `court-verdict-2026-07-13.4`
- schema version: `1.0`
- 호출 경계: `createOpenAIStructuredResponseWithAudit`
- OpenAI 저장: `store: false`
- 감사 로그의 `userInput`, `aiOutput`: `null`

판결은 자유 Markdown이 아니라 strict JSON schema 출력으로 받고 서버 AJV 검증을 다시 통과시킨다. provider 출력에는 안전 상태, provisional 여부, 중립 요약, 합의 사실, 다른 관점, 각자의 필요, 핵심 쟁점, 책임 표현, 대화 시작문, 1~3개 처방, 체크인, 한계가 포함된다. `publicCard`는 provider schema에서 제외하며, 실제 공개·공유 문구는 서버가 검증된 enum과 허용 목록으로만 결정론적으로 주입한다.

판결 멱등성은 정규화 입력·모드·카테고리·말투·모델·prompt/schema 버전 hash와 DB unique key로 보장한다. claim은 만료되는 lease token을 발급하고, 동일 token을 가진 작업만 stage/complete/fail할 수 있다. 같은 입력이 완료됐으면 저장 결과를 재사용하고, 작업 중이면 202와 `Retry-After`를 반환한다.

provider 비용 원장은 다음 전이를 구분한다.

```text
reserved -> started
    |          |-> non-high-risk result_staged [audit pending]
    |          |      -> exact keyed audit -> audit audited -> completed
    |          |      -> recovery도 provider 재호출 없이 같은 순서
    |          |-> high-risk failed_invalid/safety_high_risk [payload 없음, audit pending]
    |          |      -> exact keyed audit -> audit audited (판결 complete 없음)
    |          +-> failed_invalid | failed_unknown
    +-> failed_unstarted

failed_unknown --관리자 외부 확인+명시적 승인--> retry_allowed
```

- strict schema·PII·안전 검증을 통과한 non-high-risk 결과는 필수 성공 감사보다 먼저 `result_staged`에 저장하고 `provider_audit_state=pending`으로 둔다. stage에는 검증된 판결·처방, request model(`staged_model=Terra`)과 실제 response model(`audit_model`), 동일 request key, input/output/cached/cache-write token usage, 원 호출의 audit user/couple/preflight-safety identity가 들어간다.
- 감사 래퍼가 request key를 idempotency key로 payload-free 성공 행을 기록한 뒤 `finalize_court_provider_audit`가 사용자·커플 상관관계, model, token, canonical metadata를 envelope와 정확히 대조해야 `audited`가 된다. `complete_court_verdict`는 `result_staged + audited`가 아니면 거부한다. 정상 순서는 **stage → audit write → audit finalize → complete**다.
- 감사 또는 final complete가 실패하면 다음 claim은 새 lease와 staged payload·usage·동일 request key·고정 audit identity를 돌려준다. 감사가 pending이면 원 호출과 같은 semantic identity로 원문 없는 recovery audit를 기록·finalize하고, 이미 audited면 재기록 없이 exact 저장 payload를 complete한다. provider는 다시 부르지 않는다.
- 교차 배포 복구는 running release의 prompt/schema/model/hash로 이전 유료 결과를 다시 라벨링하지 않는다. claim은 사건의 active `result_staged`를 current identity lookup보다 먼저 잠그고 reservation/verdict 내부 일치를 검증한 뒤 저장 당시 input hash·prompt/schema, request model, response model, usage와 audit identity를 반환한다. 사용자 route와 관리자 감사 복구는 그 저장 identity만 사용한다.
- schema 이름은 TypeScript `config.ts`와 SQL finalizer의 불변 registry가 함께 관리한다. 현재 historical mapping은 `1.0 → couple_court_verdict_v1`이다. 새 schema/model을 출시할 때 pending/staged identity가 남아 있으면 이전 mapping과 DB model allowlist를 유지한다. 미지원 schema/model은 현재 상수로 치환하지 않고 503 fail-closed하며 provider를 다시 호출하지 않는다.
- AI 플래그 off, 키 누락·placeholder, 잘못된 model/reasoning env, production mock 설정에서는 route가 `p_allow_new_claim=false`로 조회·복구 전용 claim을 보낸다. ready replay, 유효한 in-progress 응답, staged 복구는 먼저 허용하되 새 generation/provider 시도와 비용 경계는 만들지 않는다. staged 복구에는 기존 generation을 위한 새 복구 lease만 발급할 수 있다. 복구할 상태가 없으면 DB mutation 없이 `unavailable`이고 HTTP 503으로 닫힌다.
- 배포 사이 identity가 바뀐 pre-provider lease는 살아 있는 동안 `in_progress`다. 만료 뒤 `started | failed_unknown`은 계속 수동 조정으로 차단하고, no-reservation/`reserved`만 AI 생성 허용 상태에서 이전 generation을 terminal 처리한다. `reserved` quota를 환불한 뒤 current identity를 다음 generation으로 만들며, lookup-only 상태에서는 어떤 환불·terminal·새 generation 변경도 없이 `unavailable`이다. route는 lookup-only 요청에서 잘못 반환된 `execute`도 비용 경계 전에 재차 거부한다.
- `result_staged`는 generic fail이 지우지 않는다. recovery audit가 실패하면 503으로 닫고 stage를 유지한다.
- provider 결과가 high-risk이면 `settle_court_high_risk_provider_result`가 유효한 lease·request key를 확인하고 안전 등급 승격, 초대·공개 차단, 기존 판결·처방 제거, 시작된 호출의 `failed_invalid/safety_high_risk` settle을 한 트랜잭션으로 수행한다. 판결 본문·설명·공유 문구·처방은 저장하지 않고 input hash·request key·audit identity·response model·usage·제한된 safety category만 payload-free envelope에 저장해 `provider_audit_state=pending`으로 둔다. exact audit와 finalize 뒤 `audited`가 되며 일반 판결 complete 단계는 없다.
- 사용자가 사건 보관을 명시하면 staged 판결을 복구하지 않는다. private stage·lease는 제거하고 호출을 quota가 유지되는 `failed_invalid/court_archived`로 settle하지만, payload-free audit identity·model·usage와 `pending | audited` 상태는 보존한다. pending이면 관리자 감사 복구 대상이다.
- provider 시작 전 실패는 `failed_unstarted`로 quota를 환불한다. strict 출력 검증 실패는 `failed_invalid`이며 이미 시작한 호출 quota는 유지한다.
- provider 시작 뒤 결과 수신 여부가 불명확한 `failed_unknown`도 quota를 유지하고 자동 재시도하지 않는다. 관리자가 provider 측 사실을 외부 확인한 뒤 `provider_dashboard_not_found | provider_dashboard_failed | provider_support_approved_retry` 중 정확한 reason code와 확인 문구 `ALLOW_RETRY_AFTER_PROVIDER_REVIEW`를 입력해야 `allow_retry`가 한 번 기록된다.
- `provider_error_code=safety_escalation_failed`인 `failed_unknown`은 위 수동 allow-retry에서도 제외된다. DB가 재시도 허용을 거부하며 안전 상태·원자 settle을 별도 remediation하기 전에는 새 provider 호출을 열지 않는다.
- reconciliation 대기열은 원문 진술·private 판결·profile·request hash·quota scope를 노출하지 않는다. verdict correlation ID, request key, provider state, 시작·실패·생성·갱신 시각, 안전한 오류 코드만 제공한다.

별도 provider 감사 복구 대기열은 브라우저에 provider state, 안전한 오류 코드, pending 시각, 시도 횟수, 마지막 제한 오류 코드·시각만 보여준다. verdict/case ID, request key/hash, user/couple ID, model, usage, metadata, staged payload는 보내지 않는다. 관리자가 `recover_one`을 요청하면 서버가 active admin을 확인하고 가장 오래된 항목 하나를 120초 lease로 claim해 safe envelope로 exact keyed audit→finalize를 수행한다. 저장된 prompt/schema/model/usage를 사용하며 실행 중 model env를 읽지 않는다. unsupported historical schema·잘못된 envelope·audit/finalize 실패는 제한 오류만 남기고 pending을 유지하며, 빈 대기열은 성공 no-op다. OpenAI를 재호출하지 않고 정상 staged 결과의 판결 complete는 다음 사용자 claim이 수행한다.

비용 상한은 KST 일자를 기준으로 한다. HTTP 판결 요청은 사용자당 24시간 10회로 제한하고, 실제 provider 예약은 검증된 couple scope(미결합 사건은 immutable 신청인 user scope)당 기본 30회, 전체 기본 60회다. DB가 global→scope 순서로 잠가 동시 요청의 oversubscription을 막는다. cap은 비용 방어선이며 사용자의 같은 입력 replay를 새 결제로 세지 않는다.

새 진술 revision이나 초대 상대의 첫 진술은 새로운 판결 generation을 만든다. 기존 ready 결과와 처방·followup은 immutable history로 보존하되 `superseded`로 표시하고, 연결된 `amora_actions`는 제거해 오래된 처방이 현재 할 일로 남지 않게 한다. 일반 조회와 처방 mutation은 현재 ready generation에만 한정한다. 단, safety가 normal 밖으로 승격되면 민감한 과거 결과를 보존하지 않고 제거한다.

production에서는 mock을 사용할 수 없다. private·AI 플래그, 유효한 키, 정확한 모델, 비용 가드 중 하나라도 준비되지 않으면 안전하게 실패한다.

## 10. 안전 정책

deterministic 사전 탐지는 자해·타해, 폭력·위협, 감금, 스토킹, 강압 통제, 성적 강요, 금전 접근 차단 등을 확인한다. AI의 safety 필드도 별도로 검증하지만 AI 단독 판단에 의존하지 않는다.

`high_risk`에서는 다음을 강제한다.

- 일반 판결, 책임 비율, 매운맛 유머, 화해 처방 생성 중단
- 초대, 공개 미리보기, 게시, 투표·댓글 경로 차단
- 기존 판결·처방 응답 숨김
- 상대 설득보다 안전한 장소·신뢰할 사람·공식 도움 자원 안내

provider가 high-risk를 처음 발견한 경우에도 자유 텍스트 결과를 stage하지 않는다. DB의 payload-free settle RPC가 사건 승격과 비용 원장을 먼저 원자 확정하고 감사에 필요한 최소 envelope만 남긴다. 감사 쓰기나 finalize가 뒤에서 실패해도 안전 차단은 유지되며 관리자 safe-envelope 복구가 감사만 완성한다.

대한민국 도움 자원의 단일 출처는 `apps/web/src/lib/coupleCourt/support.ts`다.

- 경찰 긴급신고 112
- 구조·구급 119
- 자살예방 상담전화 109
- 여성긴급전화 1366

이 기능은 위험을 확정 진단하거나 긴급기관을 대신하지 않는다.

## 11. 공개 게시와 운영 심사

공개 순서는 다음과 같다.

1. normal 판결에서 provider schema에 `publicCard`를 허용하지 않고, 서버가 검증된 enum과 허용 목록만으로 결정론적 snapshot·공유 카드를 만든다. 이름·연락처·업체·예식장·정확한 금액·날짜/시간·사건별 known entity는 private 결과 저장 전과 공개 전 각각 차단한다.
2. 동일 내용이면 현재 활성 hash/version을 재사용한다.
3. solo는 1명, couple은 현재 active 참여자 2명이 정확히 같은 hash에 동의한다.
4. 동의가 모두 모이면 `pending_review`가 된다.
5. `/admin/couple-court`에서 sanitized snapshot만 승인·반려한다.
6. 승인 뒤 참여자가 게시 상태 확인을 요청하면 DB가 동의·hash·안전·moderation을 다시 검사하고 게시한다.
7. 어느 참여자든 동의를 철회하거나 공개 철회를 요청하면 즉시 `hidden`으로 바꾸고 공개 view에서 사라진다.

댓글은 작성 즉시 공개되지 않고 `pending` 심사를 거쳐야 한다. 관리자는 댓글 승인·숨김·반려, 사건별 댓글 작성 on/off, 신고 검토 시작·기각·대상 숨김을 수행한다. 관리자 API는 사용자 ID, profile, case ID, 진술, private 판결을 반환하지 않는다.

공개 피드는 `latest | popular`, 카테고리, `solo | couple` 필터를 제공한다. 필터·정렬·exact count·page slice는 모두 서버 query에서 적용하고 `published_at, id`로 안정 정렬하며, 범위를 넘은 page는 마지막 유효 page로 clamp한다. 판결 전 private 사건은 public snapshot이 없으므로 요구사항의 `판결 대기` 공개 필터는 제공하지 않는다.

## 12. 실제 API

모든 서버측 도메인/DB mutation은 인증, JSON content type·body 크기, browser same-origin/fetch-site 또는 token-only native Bearer 경계, UUID/enum/길이, 영속 rate limit을 검사한다. 초대 `prepare_only`·로그인 handoff는 DB를 변경하지 않는 의도적 무인증 예외이며 실제 수락·거절은 인증 후에만 실행한다. 관리자 POST는 active admin과 4KiB body/출처를 확인한 뒤 관리자 ID 기준 120회/시간 limit을 통과해야 RPC를 호출한다.

| Method | 경로 | 기능 |
| --- | --- | --- |
| GET, POST | `/api/couple-court/cases` | 내 사건 목록, 사건 생성 |
| GET, DELETE | `/api/couple-court/cases/[caseId]` | 사건 조회, 신청인 보관 또는 제한된 영구삭제 |
| DELETE | `/api/couple-court/cases/[caseId]/participation` | 상대가 첫 진술 전 사건에서 나가기 |
| POST | `/api/couple-court/cases/[caseId]/statements` | 최초 진술 또는 허용된 revision 제출 |
| POST, DELETE | `/api/couple-court/cases/[caseId]/invite` | 초대 발급·재발급·취소 |
| POST | `/api/couple-court/invites/accept` | 초대 수락 또는 거절·로그인 handoff, 수락 시 solo→couple 전환 |
| POST | `/api/couple-court/cases/[caseId]/judge` | 멱등 판결 claim·생성 |
| GET | `/api/couple-court/cases/[caseId]/verdict` | 판결 상태 polling·결과 조회 |
| GET | `/api/couple-court/cases/[caseId]/verdict-history` | generation·시각·교체 여부의 metadata-only 이력 |
| POST | `/api/couple-court/missions/[missionId]/accept` | 처방 수락 |
| POST | `/api/couple-court/missions/[missionId]/complete` | 처방 완료 |
| POST | `/api/couple-court/missions/[missionId]/save-action` | 아모라 할 일 원자 저장·연결 |
| POST | `/api/couple-court/cases/[caseId]/followups` | 후속 체크인 |
| POST | `/api/couple-court/cases/[caseId]/public-preview` | 비식별 snapshot 생성·재사용 |
| POST | `/api/couple-court/cases/[caseId]/public-consent` | hash-bound 동의·철회 |
| POST, DELETE | `/api/couple-court/cases/[caseId]/publish` | 승인 후 게시, 공개 철회 |
| GET | `/api/couple-court/public` | 공개 피드 |
| GET | `/api/couple-court/public/[postId]` | 공개 상세와 visible 댓글 |
| POST | `/api/couple-court/public/[postId]/vote` | 투표 생성·변경 |
| GET, POST | `/api/couple-court/public/[postId]/comments` | 댓글 목록·심사 대기 제출 |
| POST | `/api/couple-court/public/[postId]/reports` | 게시물·댓글 신고 |
| GET, POST | `/api/admin/couple-court` | sanitized 운영 대기열·심사 조치 |

사건 생성은 `creation_request_id`, 진술 제출은 `submission_request_id` UUID를 필수로 받는다. 동일 request ID·동일 payload는 replay하고 동일 ID·다른 payload는 거부한다.

초대 취소는 HTTP API와 상세 화면에 연결되어 있다. 새 초대 발급도 이전 미사용 초대를 폐기한다. solo 초대 발급은 사건을 즉시 couple로 바꾸지 않고, 실제 수락 트랜잭션에서만 mode/workflow와 임시판결 세대를 전환한다. 초대받은 사용자는 링크를 명시적으로 거절할 수 있고 신청인은 계정·사유 없이 상태만 본다. 상대는 첫 진술 전까지만 사건에서 나갈 수 있다. 영구삭제 confirmation UI도 연결되어 있지만 상대방 진술 이후에는 DB가 공동 삭제 정책 오류로 차단한다.

후속 체크인의 outcome은 `resolved | improved | unchanged | needs_more_talk` 네 가지다. 일반 체크인은 판결 완료 72시간 뒤 참여자·판결별 한 번 허용하며, 남은 쟁점의 safety 판정과 저장을 한 트랜잭션으로 처리한다. followup 자체가 high-risk이면 안전 보고를 잃지 않도록 일반 72시간·상태·기존 체크인 제한보다 우선해 저장·승격하고 일반 판결은 반환하지 않는다.

관리자 `GET/POST`는 공개물·댓글·신고 외에 `failed_unknown` provider reconciliation 대기열과 별도 `provider_audit_state=pending` 감사 복구 대기열을 다룬다. POST는 인증된 관리자 ID 기준 영속 120회/시간으로 제한한다. 비용 재시도는 `target=provider_reconciliation`, `decision=allow_retry`이며 확인 문구·허용 reason code·active admin 검증이 없으면 실행되지 않는다. `safety_escalation_failed`는 이 경로로 재시도할 수 없다. 감사 복구는 `target=provider_audit_recovery`, `decision=recover_one`이며 서버가 대상을 선택해 lease한 뒤 exact keyed audit→finalize만 수행한다. 브라우저에는 복구 대상 식별자·request key·감사 identity·model·usage·metadata·staged payload가 전달되지 않으며, 어떤 관리자 경로도 private 판결 본문이나 진술을 대기열에 포함하지 않는다.

## 13. 환경 변수

| 변수 | 역할 | production 원칙 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 서버 전용 OpenAI 키 | Vercel secret에만 저장 |
| `OPENAI_AMORA_PRIMARY_MODEL` | 판결 모델 | 정확히 `gpt-5.6-terra` |
| `OPENAI_AMORA_PRIMARY_REASONING_EFFORT` | 추론 비용 | 정확히 `none` |
| `COUPLE_COURT_ENABLED` | private 화면·API | 미설정/false면 404로 닫힘 |
| `COUPLE_COURT_AI_ENABLED` | 실제 판결 호출 | private 기능과 별도 활성화 |
| `COUPLE_COURT_PUBLIC_ENABLED` | 공개 피드·게시 | 심사 운영 준비 뒤 활성화 |
| `COUPLE_COURT_MOCK_ENABLED` | 로컬 결정론 mock | production에서 금지 |
| `COUPLE_COURT_INVITE_COOKIE_SECRET` | 로그인 handoff 암호화 | 전용 고엔트로피 32자 이상 |
| `AMORA_IDEMPOTENCY_SECRET` | 공용 아모라 채팅 실행 식별자 HMAC | 기존 AI 플랫폼용. 커플재판소 판결 hash에는 사용하지 않음 |
| `RATE_LIMIT_KEY_SECRET` | rate-limit 주체 HMAC | 다른 키와 재사용 금지 |
| Supabase server/public 변수 | 인증·DB | 기존 프로젝트 계약 사용 |
| `ADMIN_PASSWORD` | 기존 관리자 로그인 | 전용 24자 이상 secret |

`NEXT_PUBLIC_COUPLE_COURT_ENABLED`는 직접 설정하는 비밀이 아니다. `next.config.ts`가 서버의 private 플래그로부터 공개 가능한 boolean만 파생해 라운지 진입점 표시를 제어한다.

AI 생성 설정 검사는 새 비용 경계와 durable recovery를 분리한다. `COUPLE_COURT_AI_ENABLED=false`, 유효하지 않은 `OPENAI_API_KEY`, 정확하지 않은 Terra/`none` 설정, production mock은 새 생성만 막는다. private 플래그가 열려 있으면 기존 ready/staged/in-progress 조회는 먼저 수행한다. 복구할 상태가 없을 때는 각각 `COUPLE_COURT_AI_UNAVAILABLE`, `COURT_PROVIDER_UNCONFIGURED`, `COURT_MOCK_FORBIDDEN` 503으로 닫힌다. private 플래그까지 닫으면 사용자 recovery API도 404이므로, 장애 차단 중 기존 stage를 마무리해야 할 때는 AI 플래그를 먼저 닫고 감사 대기열과 사용자 claim을 관찰한다.

release health는 private/AI/public/mock의 원시 exact-true 값과 Terra provider 설정 유효 여부만 boolean으로 공개하고 key·model 값을 노출하지 않는다. remote live smoke는 mock=false, AI open 시 provider-configured=true를 요구한다. full mode에서는 JavaScript를 실행하지 않는 원시 GET으로 `/wedding/couple-court/invite`와 `/wedding/couple-court/public`의 기대 200/404만 확인하고, DB rate-limit row나 OpenAI 비용을 만들 수 있는 Court API·judge 호출은 금지한다. probe 전후 SHA·project·플래그가 같아야 한다.

## 14. 구현 단계와 현재 남은 일

### 구현된 코드 범위

- 타입·카테고리·상태·스키마·hash·안전·PII 모듈
- SQL 테이블, RLS, 보안 view, service RPC와 판결 lease fencing
- 사건·진술·초대·판결·처방·후속 체크인 API/UI
- exact request ID 기반 사건·진술 replay와 mismatch 차단
- 초대 수락 시 solo→couple 전환, 초대 거절, 첫 진술 전 상대 나가기, revision 기반 이의 제기
- provider 비용 quota, 정상 stage→audit→finalize→complete, 교차 배포 stored-identity recovery, 설정 장애 lookup-only claim fence, 고위험 payload-free settle→audit→finalize, safe-envelope 관리자 감사 복구, `failed_unknown` 관리자 allow-retry 계약
- 1080×1350 PNG 공유 카드 미리보기·저장·시스템 공유
- hash-bound 공개 동의, 운영 심사, 공개 피드·투표·댓글·신고
- 관리자 최소 심사 화면
- PII-free 분석 allowlist

### 남은 구현·고도화

1. 상대방 진술 이후 공동 삭제·고지·보존의 제품·법무 정책 확정. 제한된 영구삭제 confirmation UI는 구현됨
2. 일정·예산 adapter. 현재 처방 연동은 아모라 할 일 저장만 실제 제공
3. 별도 Expo native 화면. 현재는 반응형 웹 구현이며 실제 모바일 binary 검증 전
4. 3일 후 자동 알림·재촉 정책. 체크인 저장은 있으나 예약 알림은 없음
5. 검증된 업로드 경계가 준비된 뒤에만 증거 첨부 검토. 과거 판결은 metadata-only history UI만 제공하며 본문 재노출은 개인정보 정책상 비목표
6. provider 감사 복구는 관리자 한 항목 수동 실행이다. 자동 worker·일괄 drain이 없고 non-high-risk stage의 최종 complete는 다음 참여자 claim이 담당한다.

## 15. 완료와 출시 게이트

다음 항목은 코드 존재만으로 완료 처리하지 않는다.

- [ ] disposable PostgreSQL/Supabase에서 migration fresh replay와 이전 체인 upgrade
- [ ] RLS·RPC·계정 삭제·공개 view를 실제 DB 세션으로 검증
- [ ] 실제 사용자 2명으로 초대, blind statement, 판결, revision, 처방, 공개 동의 E2E
- [ ] 사건·진술 exact request ID replay/mismatch와 user-scoped draft 격리 E2E
- [ ] 초대 거절, 수락 후 진술 전 나가기, solo 임시판결 복원, 진술 후 나가기 차단 E2E
- [ ] high-risk 입력의 초대·AI·공개·기존 판결 차단 E2E
- [ ] `result_staged` 뒤 감사/complete 실패 주입, provider 무재호출 recovery audit·complete 검증
- [ ] stage 생성 뒤 prompt/schema 상수를 바꾼 교차 배포에서 stored identity로 복구하고, historical schema registry와 DB model allowlist 호환성 검증
- [ ] provider 시작 전 lease 직후 배포 identity 변경을 주입해 live lease 유지, 만료 lookup-only 무변경, no-reservation/`reserved`만 안전 종료·quota 환불·다음 generation 생성, `started | failed_unknown` 수동 차단 검증
- [ ] AI 플래그 off·키 누락·placeholder·잘못된 model/reasoning env·production mock에서 replay/staged/in-progress만 허용하고, 복구 대상이 없으면 `unavailable`이며 새 generation/provider reservation·workflow 변경이 없는지 검증
- [ ] 관리자 `recover_one`의 historical identity 사용, unsupported schema fail-closed, 빈 대기열 no-op, 응답 식별 envelope 비노출 검증
- [ ] provider high-risk의 payload-free settle·안전 승격·감사 finalize, 판결·처방 payload 부재, 감사 실패 뒤 관리자 safe-envelope 복구 검증
- [ ] 보관 시 private stage 폐기·audit envelope 유지, `judging`·audit pending 영구삭제 차단과 감사 finalize 후 삭제 검증
- [ ] `failed_unknown` 자동 재시도 차단과 관리자 확인문구·reason 기반 allow-retry, `safety_escalation_failed` 재시도 거부 검증
- [ ] KST couple/user 30회·global 60회 provider quota와 시작 전 실패 환불 동시성 검증
- [ ] 360/390/430px, 키보드, 스크린리더, reduced motion 브라우저 QA
- [ ] `lint`, `typecheck`, 전체 test, production build를 최종 SHA에서 재실행
- [ ] OpenAI 실제 키로 Terra structured output·감사·비용·timeout canary
- [ ] 관리자 심사 운영자, SLA, 신고 escalation과 보유 정책 확정
- [ ] 운영 DB 백업·Storage 복구·write fence·롤백 rehearsal
- [ ] 기능 플래그 off 배포 → private → AI → public 순차 rollout
- [ ] 배포 후 canary와 비용·오류·안전 신고 관찰

2026-07-14 통합 체크포인트에서 루트 lint, 4개 패키지 typecheck, 웹 211파일·1,641개와
모바일 22개 전체 테스트, Next production build(정적 페이지 107개)를 통과했다. 같은 clean Windows
worktree에서 full-history secret scan과 복구·Auth·write-fence·Vercel·live-smoke 계약을 포함한
`corepack pnpm qa:local`도 최종 통과했다. 이전 기능 체크포인트의 SQL parser는 Couple Court
345 SQL/48 PLpgSQL과 전체 활성 117파일·2,783 SQL/216 PLpgSQL을 검증했다. web/iOS/Android
Expo export의 과거 증거와 모바일 release 정적 검사 77 pass·1 warning·0 fail은 유지되며, warning은
social login hard-disabled 상태가 store release 인증을 대신할 수 없다는 뜻이다. 공개 화면은 과거
360/390/430px, private 홈은 430px에서 가로 넘침과 주요 터치 영역을 수동 확인했다.

이 검증은 실제 DB 적용·fresh/upgrade replay를 대신하지 않는다. 인증된 2인 전체 브라우저 E2E,
키보드·스크린리더 전체 회귀, 서명 EAS·실기기 빌드, Terra 실제 호출 canary, 운영 배포·배포 후
카나리는 아직 미완료다.

## 16. 실행·검증·운영 전 인계

교차 배포·설정 장애·초대 무쓰기·관리자 복구·release canary의 최소 집중 검증은 다음 파일을 포함한다.

```powershell
corepack pnpm --filter @hanbang/web exec vitest run `
  src/app/api/couple-court/__tests__/judge-route.test.ts `
  src/app/api/couple-court/__tests__/invite-accept-route.test.ts `
  src/app/api/couple-court/__tests__/_shared.test.ts `
  src/app/api/admin/couple-court/__tests__/route.test.ts `
  src/lib/coupleCourt/__tests__/judge.test.ts `
  src/lib/__tests__/coupleCourtMigrationContract.test.ts `
  src/lib/__tests__/maintenanceContract.test.ts `
  src/lib/__tests__/releaseSafetyContract.test.ts `
  src/lib/__tests__/supabaseServerBearerBoundary.test.ts
node --test ./scripts/live-smoke-test.test.mjs
```

그 뒤 `typecheck`, `lint`, 웹 전체 test, production build, 루트 비밀 검사를 최종 SHA에서 실행한다. 정적 SQL contract는 실제 PostgreSQL replay·RLS 세션·동시성 검증을 대체하지 않는다.

운영 전에는 안전한 집계로 `result_staged`, `provider_audit_state=pending`, `failed_unknown`을 확인하고, 새 release의 TypeScript/SQL schema registry와 complete model allowlist가 저장 identity를 모두 지원하는지 검증한다. AI 플래그를 끈 상태에서 기존 stage는 복구하되 새 generation/provider 비용은 생기지 않는 disposable DB 장애 주입도 통과해야 한다. 미지원 identity나 pending 대기열이 있으면 mapping을 제거하거나 DB 상태를 수동 수정하지 말고 rollout을 중단한다.

현재 제약은 관리자 복구가 자동 background worker가 아니라는 점, private 플래그를 닫으면 사용자 staged complete도 닫힌다는 점, 등록된 verdict schema가 현재 `1.0` 하나라는 점이다. 실제 DB fresh/upgrade replay, 인증된 2인 E2E, Terra 실제 canary, 모바일 실기기, 운영 백업·복구·write fence 증거가 없으므로 이 문서만으로 출시 완료를 선언할 수 없다.
