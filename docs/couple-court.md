# 한방 커플재판소 운영·개발 핸드오프

> 문서 기준일: 2026-07-14
>
> 구현 브랜치: `feature/couple-court` (`agent/amora-openai-gpt56`, PR #38의 후속 기능 브랜치)
>
> 코드 체크포인트: `1d7f8f17` — 기능 코드, 서버 공개 피드 paging, 보안·release health·무쓰기 live canary와 Bearer/cookie 격리 회귀까지 커밋된 기준
>
> 출시 상태: **미출시 / 운영 NO-GO**
> 미완료 증거: 실제 DB 적용, 인증된 2인 브라우저 E2E, Expo 실기기 빌드, 운영 배포, 배포 후 카나리
>
> 이 문서는 위 코드 체크포인트의 계약을 설명한다. 마이그레이션 파일이 존재한다는 사실은 어떤 Supabase 환경에도 적용됐다는 증거가 아니며, 이 문서 자체는 원격 DB 변경이나 배포 승인이 아니다.

이 문서는 한방 커플재판소를 다음 컴퓨터에서 이어 개발하고, 검증하고, 안전하게 출시하기 위한 현재 코드 기준 핸드오프다. 제품 계약은 [`couple-court-plan.md`](./couple-court-plan.md), 전체 운영 출시 순서는 [`PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md`](./PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md), Supabase 원격 변경은 [`SUPABASE_REMOTE_OPERATIONS.md`](./SUPABASE_REMOTE_OPERATIONS.md)를 함께 따른다.

## 1. 제품 개요

한방 커플재판소는 결혼 준비 중 생긴 서운함을 재미있게 꺼내되, 누가 이겼는지를 정하는 데서 끝내지 않는다. 두 사람의 진술을 분리해 받고 사실·관점·필요를 구조화한 뒤, 오늘 실행할 수 있는 화해 처방으로 연결한다.

제품 이름은 다음과 같다.

- 전체 기능: 한방 커플재판소
- 비공개 2인 공간: 둘만의 중재실
- AI 결과: 한방 판결
- 후속 행동: 화해 처방
- 공개 커뮤니티: 웨딩한방 공개재판
- AI 중재자: 한방 판사 아모라

법률·의료·심리 진단이나 전문 상담을 대신하지 않는다. 안전 위험이 감지되면 재미 판결을 중단한다.

## 2. 사용자 모드와 핵심 여정

### 혼자 임시판결

1. 사용자가 모드·카테고리·판결 맛을 고른다.
2. 사건 생성 뒤 사실, 감정, 기대, 시도, 원하는 합의를 작성한다.
3. 서버가 안전 신호를 먼저 평가하고 진술을 제출한다.
4. 사용자가 한방 판결을 요청한다.
5. 결과는 항상 한쪽 진술만 바탕으로 한 임시판결로 표시한다.
6. 사용자는 화해 처방을 수락·완료하고 아모라 할 일로 저장할 수 있다.
7. 원하면 상대를 초대해 새 쌍방 판결로 전환한다.

### 둘만의 중재실

1. 신청인이 사건과 초대 링크를 만든다.
2. 상대가 로그인하고 초대를 수락한다.
3. 상대는 신청인의 진술 원문과 임시판결을 보지 않고 자신의 진술을 작성한다.
4. 두 진술이 모두 제출되면 한 사람이 판결을 요청한다.
5. 같은 입력 조합의 중복 요청은 DB lease와 hash로 한 번만 실행한다.
6. 두 사람은 원문 대신 AI가 중재한 요약과 관점 차이를 본다.
7. 처방을 각자 수락·완료하고 필요하면 할 일로 저장한다.
8. 공개를 원하면 같은 비식별 snapshot에 각각 동의한다.

현재 구현은 상대방의 원문 진술을 판결 후에도 직접 공개하지 않는다. 이는 최초 명세의 “쌍방 진술 함께 확인”보다 보수적인 개인정보 계약이다.

## 3. 화면과 진입점

실제 브라우저 URL은 `/wedding` prefix를 사용한다. 예를 들어 내부 `/couple-court/new`는 `/wedding/couple-court/new`로 접근한다.

| 화면 | 내부 경로 | 비고 |
| --- | --- | --- |
| 내 사건 홈 | `/couple-court` | 로그인, private 플래그 |
| 사건 생성 | `/couple-court/new` | 단계식 폼 |
| 사건 진행 | `/couple-court/cases/[caseId]` | 참여자 전용 |
| 진술 | `/couple-court/cases/[caseId]/statement` | 내 원문만 조회 |
| 판결 | `/couple-court/cases/[caseId]/verdict` | polling·재시도 |
| 처방 | `/couple-court/cases/[caseId]/mission` | 수락·완료·할 일 저장 |
| 초대 | `/couple-court/invite#token=...` | 로그인 handoff 지원 |
| 공개 피드 | `/couple-court/public` | 비로그인 읽기 가능 |
| 공개 상세 | `/couple-court/public/[postId]` | 투표·댓글·신고는 로그인 |
| 관리자 심사 | `/admin/couple-court` | 기존 관리자 인증 |

라우트 파일은 다음 위치에 있다.

- private: `apps/web/src/app/(app)/couple-court`
- invite/public: `apps/web/src/app/(community)/couple-court`
- admin: `apps/web/src/app/(admin)/admin/couple-court`
- API: `apps/web/src/app/api/couple-court`, `apps/web/src/app/api/admin/couple-court`
- UI: `apps/web/src/components/couple-court`

## 4. 데이터 흐름

```text
브라우저 입력
  -> Route Handler의 인증·body·browser same-origin 또는 native Bearer·영속 rate-limit 검사
  -> deterministic 안전 탐지
  -> service-role 전용 원자 RPC
  -> private Supabase 테이블
  -> 판결 요청 시 PII 마스킹
  -> audited OpenAI Responses structured output
  -> 서버 schema 검증
  -> non-high-risk: result_staged + provider_audit_state=pending
  -> request key로 정확히 한 번인 감사 행 기록
  -> 감사 증거 검증·finalize 후에만 fenced complete RPC로 판결·처방 저장
  -> high-risk: 판결·처방 없이 payload-free 비용·감사 envelope만 저장하고 안전 승격
  -> 참여자별 allowlist 응답

공개 선택
  -> 서버가 별도 sanitized snapshot 생성
  -> snapshot hash/version에 참여자 동의
  -> 관리자 심사
  -> 승인·동의·안전을 DB에서 재검사해 게시
  -> public security-barrier view만 외부 조회
```

클라이언트는 service role 키나 OpenAI 키를 받지 않는다. AI 문자열을 `innerHTML`로 렌더링하지 않고 검증된 구조를 React 컴포넌트로 렌더링한다.

모든 서버측 도메인/DB mutation은 인증, JSON·body 상한, browser same-origin/fetch-site 또는 token-only native Bearer 경계, 영속 rate limit을 검사한다. 초대의 `prepare_only`와 로그인 handoff는 DB를 바꾸지 않는 의도적 무인증 예외이며 암호화된 token hash만 HttpOnly 쿠키에 보관한다. 실제 수락·거절은 인증 후에만 실행한다. 관리자 POST도 active admin 확인과 4KiB JSON/출처 검사 뒤 관리자 ID 기준 120회/시간 영속 limit을 통과해야 service-role RPC를 호출한다.

## 5. 상태 머신

하나의 enum에 모든 상태를 섞지 않는다.

### private workflow

`court_cases.workflow_status`:

```text
draft
awaiting_applicant_statement
awaiting_partner
awaiting_partner_statement
statements_complete
judging
verdict_ready
mission_active
resolved
archived
```

초대 **발급만으로는** solo 사건의 모드·workflow·임시판결을 바꾸지 않는다. 상대가 초대를 실제 수락할 때만 `solo → couple`, `awaiting_partner_statement`로 원자 전환하고 임시판결을 `superseded`로 보존한다. 상대가 진술 전에 나가면 solo 기원 사건은 임시판결을 복원하고, 처음부터 couple이던 사건은 `awaiting_partner`로 돌아간다. 이의 제기는 새 immutable statement revision을 만든 뒤 `statements_complete`로 돌아간다. 상대의 첫 진술이나 새 revision이 접수되면 기존 ready 판결을 삭제하지 않고 `superseded` generation으로 보존한다. 다만 그 세대의 연결 `amora_actions`는 제거하며 현재 조회·처방 mutation에는 최신 ready generation만 사용한다.

provider 상태는 private workflow와 별도로 `court_provider_reservations.provider_state`에서 관리한다. 감사 상태도 다시 `provider_audit_state=not_required | pending | audited`로 분리한다. 시작 전 실패, 검증 실패, 결과 불명, 검증 결과 임시 저장, 감사 대기를 모두 같은 `provider 실패`로 취급하면 안 된다. 정확한 전이는 7절의 비용 원장·복구 계약을 따른다.

### 안전 상태

- `safety_level`: `normal | sensitive | high_risk`
- `safety_review_status`: `none | pending | approved | rejected`

안전 상태는 낮춰 덮어쓰지 않는다. `high_risk`는 일반 판결·초대·공개를 차단하고 진행 중 AI lease를 종료한다.

### 공개 상태

- `status`: `awaiting_consents | pending_review | published | hidden | rejected`
- `moderation_status`: `pending | approved | rejected`

`pending_review`는 동의 완료, `moderation_status=approved`는 운영 승인이다. 두 조건을 혼동하지 않는다.

## 6. 데이터베이스

마이그레이션 파일:

`supabase/migrations/20260713110000_create_couple_court.sql`

### private 테이블

- `court_cases`
- `court_participants`
- `court_invites`
- `court_statements`
- `court_verdicts`: 순차 `generation_version`, `in_progress | ready | failed | superseded`, lease와 구조화 결과
- `court_provider_reservations`: provider 호출별 request key/hash, 비용 quota scope, `reserved → started → result_staged → completed` 원장, 별도 `provider_audit_state`, 고위험·보관 시 payload-free 감사 envelope, 실패·관리자 reconciliation 메타데이터
- `court_missions`
- `court_mission_completions`
- `court_followups`
- `court_case_events`

### public 테이블과 view

- `court_public_posts`
- `court_public_consents`
- `court_votes`
- `court_comments`
- `court_reports`
- `court_public_feed`
- `court_public_comment_feed`

모든 base table은 RLS를 사용한다. 일반 authenticated 사용자의 직접 쓰기는 허용하지 않는다. verdict·mission·invite·event·public snapshot base table은 일반 직접 조회도 허용하지 않고 서버 응답이나 안전 view를 사용한다. 진술 RLS는 작성자 원문만 읽게 한다.

주요 RPC는 사건 생성, 진술 제출, 초대 발급·취소·거절·수락, 진술 전 상대 나가기, 안전 승격, 판결 claim·provider reserve/start/stage·고위험 payload-free settle·감사 finalize/recovery·complete·fail·reconcile, 처방 상태·할 일 연결, followup, 공개 snapshot·동의·심사·게시·철회, 투표·댓글·신고를 원자적으로 처리한다. 모든 쓰기 RPC는 service role만 실행할 수 있고 RPC 안에서 대상 사용자·참여자·역할·상태를 다시 검사한다. HTTP API가 내부 안전 승격이나 판결 lease 같은 모든 DB RPC를 그대로 노출하는 것은 아니다.

### 사용자 mutation의 exact 멱등성

네트워크 재전송과 더블 탭이 새 사건·중복 진술을 만들지 않도록 브라우저가 UUID request ID를 초안과 함께 보존하고 서버가 이를 필수로 받는다.

- 사건 생성: `creation_request_id`. DB unique key는 `(creator_user_id, creation_request_id)`다.
- 진술 제출: `submission_request_id`. DB unique key는 `(participant_id, submission_request_id)`다.
- 같은 request ID와 **정규화된 동일 payload** 재전송은 처음 생성된 행을 그대로 replay한다.
- 같은 request ID를 다른 payload, 다른 revision 의도, 다른 사건 속성에 재사용하면 mismatch로 거부한다. 서버는 request ID를 새로 만들어 사용자의 의도를 추정하지 않는다.
- request ID는 판결의 입력 hash·provider request key와 목적이 다르다. 전자는 사용자 쓰기 재전송, 후자는 동일 AI 입력의 실행·비용 중복 방지 경계다.

## 7. AI 판결 구조

### 설정

| 항목 | 값 |
| --- | --- |
| 모델 역할 | `primary` |
| 모델 | 정확히 `gpt-5.6-terra` |
| reasoning effort | `none` |
| 출력 상한 | 800 tokens |
| schema | `1.0` |
| prompt version | `court-verdict-2026-07-13.4` |
| prompt 파일 | `apps/web/src/lib/coupleCourt/prompts/coupleCourtJudge.ko.ts` |
| 판결 모듈 | `apps/web/src/lib/coupleCourt/judge.ts` |
| schema/검증 | `apps/web/src/lib/coupleCourt/schema.ts` |

OpenAI 호출은 `createOpenAIStructuredResponseWithAudit`만 사용한다. Responses API에 `store: false`, reasoning `none`, strict JSON schema를 전달한다. 감사 metadata에는 모드·카테고리·말투·버전·안전 등급·입력 hash만 남기며 원문 입력과 원문 출력은 저장하지 않는다. 전용 감사 행의 `user_id`·`couple_id` 상관관계 필드는 비용·보안 추적을 위해 플랫폼 retention 경계 안에서만 보존하고, case ID는 기록하지 않는다.

### 출력 계약

- 안전 등급·risk type·공개 가능 여부
- 생성 제목·카테고리·solo provisional
- 중립 요약
- 합의된 사실과 다른 관점
- 신청인·상대의 필요
- 핵심 충돌
- percentage 또는 qualitative 책임 표현
- 판결 상태·제목·근거·선택적 한마디
- 그대로 읽을 수 있는 대화 시작문
- 1~3개 화해 처방
- 체크인 질문·신뢰도·한계
- 공개 카드 필드는 provider schema에서 제외. 서버가 검증된 enum·허용 목록으로만 결정론적 주입

서버 검증은 high-risk 비율·유머·mission 금지, percentage 합계 100, solo 상대 추정 금지, mission 시간 10분~72시간, 길이·enum·추가 필드 거부를 포함한다.

### 멱등성과 장애 복구

정규화 입력과 모델·prompt/schema 버전으로 SHA-256 hash를 만든다. DB unique key와 lease token을 사용해 오래된 worker가 새 결과를 덮어쓰지 못하게 한다. provider 호출은 별도 request key/hash와 비용 원장을 사용한다.

- 완료된 같은 입력: 저장된 판결 replay
- 같은 입력 생성 중: `202` + `Retry-After`
- lease 만료: provider 상태가 재실행을 허용할 때만 재claim
- 배포 사이 prompt/schema identity가 바뀌고 이전 lease가 provider 시작 전에 만료된 경우: live lease는 `in_progress`로 유지한다. 만료 뒤에도 `started | failed_unknown`은 수동 조정으로 차단하고, reservation 없음 또는 `reserved`만 새 생성 허용 설정에서 이전 generation을 `release_identity_changed_before_provider_start`로 종료한다. `reserved` quota는 원자 환불하고 새 release identity는 다음 generation으로 시작한다. 조회·복구 전용 설정에서는 이전 행을 바꾸지 않고 `unavailable`을 반환한다.
- provider 시작 전 실패: `failed_unstarted`; 예약한 quota를 환불하고 자동 재시도 가능
- provider가 반환했지만 strict schema/정책 검증 실패: `failed_invalid`; 이미 시작한 호출 quota는 유지하고 안전 오류만 남긴 뒤 새 생성 시도 가능
- provider 시작 뒤 결과 수신 여부가 불명: `failed_unknown`; 이미 시작한 호출 quota는 유지하고 **자동 재시도 금지**. 비용 중복을 막기 위해 관리자 reconciliation이 필요
- 상대의 첫 진술·revision: 이전 ready generation과 missions/followups를 history로 보존하고 연결된 현재 할 일만 제거
- 독립 안전 검사에서 normal→sensitive/high-risk 승격: 이전 안전 계약의 진행 중 lease와 ready 결과를 fence
- provider 결과가 sensitive를 처음 발견: 현재 유효한 lease token을 확인한 뒤 승격·공개 철회·검증 결과 stage를 한 트랜잭션으로 완료하고, 감사 finalize 뒤에만 판결 complete
- provider 결과가 high-risk를 발견: 현재 lease·request key를 검증한 뒤 사건 승격·공개 철회·기존 결과 제거·호출 비용 settle을 한 트랜잭션으로 완료하고 일반 판결 payload 저장 금지

#### 검증 결과 staging과 감사 복구

유료 provider 응답을 strict schema·PII·안전 검증까지 통과시키면, 필수 성공 감사 로그를 쓰기 **전에** 검증된 non-high-risk 판결·처방, request model(`staged_model=Terra`)과 실제 provider response model(`audit_model`), 동일 request key, input/output/cached/cache-write token usage, 원 호출의 audit user/couple/preflight-safety identity를 `result_staged`로 durable 저장하고 `provider_audit_state=pending`으로 둔다. 감사 래퍼가 request key로 payload-free 성공 감사 행을 정확히 한 번 기록하면 `finalize_court_provider_audit`가 그 행의 사용자·커플 상관관계, 모델, token, canonical metadata를 DB envelope와 대조해 `audited`로 바꾼다. `complete_court_verdict`는 `result_staged + audited`가 아니면 거부한다. 따라서 정상 순서는 **stage → audit write → audit finalize → complete**다.

검증 결과가 high-risk이면 `settle_court_high_risk_provider_result`가 유효한 lease·request key를 확인하고 사건을 `high_risk`로 단조 승격하며 초대·공개·기존 판결·처방을 차단 또는 제거하고, 호출을 quota가 유지되는 `failed_invalid/safety_high_risk`로 settle한다. 이 경로에는 판결 본문·설명·공유 문구·처방을 저장하지 않고, input hash·request key·실제 response model·token usage·고정 audit identity·제한된 안전 category만 payload-free envelope로 남겨 `provider_audit_state=pending`으로 둔다. 그 뒤 같은 request key의 감사 행을 기록하고 finalize한다. 고위험 경로에는 판결 complete 단계가 없다.

다음 동일 입력 claim이 non-high-risk `result_staged`를 받으면 새 lease와 staged payload·usage·동일 request key·고정 audit identity를 반환한다. 감사가 아직 `pending`이면 서버는 원 호출과 같은 semantic identity로 원문 입력·출력 없는 recovery audit를 request key의 부분 unique 멱등 계약으로 기록하고 finalize한 뒤, 저장된 exact stage와 새 lease를 검증해 complete한다. 이미 `audited`면 감사 재기록 없이 complete한다. recovery audit가 실패하면 stage를 유지하고 503으로 닫으며 provider를 재호출하지 않는다. 일반 fail 경로는 유효한 `result_staged`를 임의로 `failed_unknown`으로 바꾸면 안 된다.

이 복구 조회는 **현재 배포의** input hash·prompt/schema 버전·model 일치 검사를 하기 전에, 사건에 남아 있는 활성 `result_staged`를 먼저 찾는다. DB가 stage 당시의 `input_hash`, `prompt_version`, `schema_version`, request model, 실제 response model, usage와 audit identity를 돌려주며 서버는 이 저장값으로만 audit·complete한다. 배포 사이에 prompt가 바뀌었거나 현재 model 환경 변수가 잘못됐더라도 이전 유료 응답을 현재 release 상수로 다시 라벨링하거나 OpenAI에 재요청하지 않는다.

schema 이름은 `config.ts`와 `finalize_court_provider_audit`의 버전별 registry가 함께 보존한다. 현재 등록된 과거 계약은 `1.0 → couple_court_verdict_v1`이다. 새 schema를 출시할 때는 pending audit와 staged 결과가 모두 소진될 때까지 이전 mapping과 DB complete/model allowlist를 삭제하면 안 된다. 저장된 schema가 registry에 없거나 저장 model을 현재 DB 계약이 더 이상 허용하지 않으면 복구는 503으로 닫고 stage를 유지해야 하며, 임의 버전 치환이나 provider 재호출로 우회하지 않는다.

#### AI 생성 설정 장애와 새 claim fence

판결 라우트는 새 비용 경계를 열기 전에 `COUPLE_COURT_AI_ENABLED`, 서버 OpenAI 키, 정확한 `gpt-5.6-terra`·`none` 설정, production mock 금지를 평가한다. 하나라도 실패하면 `claim_court_verdict(..., p_allow_new_claim=false)`로 **조회·복구 전용** claim을 보낸다.

- 이미 완료된 같은 입력은 `replay`, 아직 유효한 작업은 `in_progress`, 활성 `result_staged`는 위 저장 identity로 복구할 수 있다.
- 복구할 상태가 없으면 `unavailable`을 반환한다. 이 분기는 새 verdict/provider lease를 만들거나 만료 lease를 갱신하거나 사건을 `judging`으로 바꾸지 않는다.
- RPC가 계약을 어겨 조회·복구 전용 요청에 `execute` lease를 반환하더라도 HTTP route가 reservation과 OpenAI 호출 전에 다시 차단한다.
- 그 뒤 HTTP는 AI 플래그 off면 `COUPLE_COURT_AI_UNAVAILABLE`, 키 누락·placeholder·잘못된 model/reasoning 설정이면 `COURT_PROVIDER_UNCONFIGURED`, production mock 설정이면 `COURT_MOCK_FORBIDDEN`으로 503을 반환한다.
- 잘못된 현재 model 환경 변수는 `hasOpenAIConfig("primary")=false`로 처리하고, stage 조회용 hash에는 코드에 고정된 Terra 기본값만 사용한다. staged 복구 분기는 현재 hash/model 일치보다 먼저 실행되므로 저장된 paid-call identity를 잃지 않는다.

이 fence는 `COUPLE_COURT_ENABLED`가 열린 private API 안에서만 동작한다. private 플래그까지 닫으면 사용자의 staged complete 요청은 404로 닫히므로, 장애 대응 중 pending 결과를 마무리할 필요가 있으면 먼저 AI 플래그만 닫고 관리자 감사 대기열과 사용자 recovery를 관찰한다.

사용자가 사건 보관을 명시하면 staged 판결은 더 이상 복구하지 않는다. 보관 RPC는 private staged 판결·처방과 generation lease를 제거하고 호출을 quota가 유지되는 `failed_invalid/court_archived`로 settle하지만, 검증 결과가 도착해 감사 의무가 생긴 호출의 payload-free input hash·request key·audit identity·모델·usage와 `pending|audited` 상태는 보존한다. 감사가 pending이면 관리자 복구 대기열에서 먼저 감사 행을 완성한다. 사건 보관은 private 판결 payload 보존을 뜻하지 않지만 비용·보안 감사 의무를 없애지도 않는다.

#### 관리자 감사 복구

`provider_audit_state=pending`은 `failed_unknown` 비용 reconciliation과 별도 대기열이다. 브라우저 GET에는 provider state, 안전한 오류 코드, pending 시각, 시도 횟수, 마지막 제한 오류 코드·시각만 노출하며 verdict/case ID, request key/hash, user/couple ID, 모델, usage, metadata, staged payload는 노출하지 않는다. 관리자가 `provider_audit_recovery/recover_one`을 실행하면 서버가 active admin을 재검사하고 가장 오래된 항목 하나를 120초 lease로 claim한다. 서버 내부 safe envelope로만 exact keyed recovery audit를 기록하고 DB 증거를 finalize하며, 실패하면 제한 오류 코드와 lease를 남긴다. 이 작업은 OpenAI를 다시 호출하지 않고, non-high-risk staged 판결의 complete는 다음 사용자 claim이 담당한다.

관리자 복구도 저장된 prompt/schema/model/usage를 사용하며 실행 중 release의 model 환경 변수를 읽지 않는다. 지원하지 않는 historical schema, 잘못된 envelope, 감사 쓰기 실패, DB evidence 불일치는 각각 제한된 오류 코드만 기록하고 `pending`을 유지한다. 빈 대기열의 `recover_one`은 성공 no-op이다. 관리자 화면은 한 번에 한 항목만 처리하므로 자동 background worker나 대량 drain으로 간주하지 않는다.

#### 비용 quota와 수동 reconciliation

- HTTP 사용자 판결 요청: 사용자당 24시간 10회 rate limit. replay·polling과 실제 provider 결제 횟수를 같은 지표로 보지 않는다.
- provider 원장 기본 cap: KST 일자 기준 검증된 couple scope(미결합 사건은 immutable 신청인 user scope) 30회, 전체 60회. DB가 global→scope 순서로 잠그고 예약한다.
- request key/hash가 동일한 기존 예약만 재사용할 수 있다. verdict·case·input·quota scope가 다르면 거부한다.
- `failed_unknown`은 관리자 대기열에 원문 없이 verdict correlation ID, request key, provider state, 시작·실패·생성·갱신 시각, 안전한 오류 코드만 노출한다. request hash, quota scope, 사용자·커플 식별자, 진술, private 결과는 반환하지 않는다.
- 운영자가 provider 측 처리 여부를 외부에서 확인한 뒤에만 `provider_dashboard_not_found | provider_dashboard_failed | provider_support_approved_retry` 중 정확한 reason code와 확인 문구 `ALLOW_RETRY_AFTER_PROVIDER_REVIEW`로 `allow_retry`를 실행한다. DB는 active admin을 재검사하고 `failed_unknown → retry_allowed`를 한 번만 기록한다.
- `provider_error_code=safety_escalation_failed`인 `failed_unknown`은 일반 비용 확인으로 다시 실행할 수 없다. DB가 `allow_retry`를 거부하므로 안전 상태와 원자 settle 실패를 별도 절차로 조사·복구해야 하며, 그 전에는 새 provider 호출을 열지 않는다.
- `allow_retry`는 이전 응답을 되살리거나 성공으로 바꾸는 기능이 아니다. 중복 비용 가능성을 사람이 검토했다는 명시적 승인 뒤 다음 새 시도를 허용할 뿐이다.

## 8. 안전 정책

안전 탐지 코드는 `apps/web/src/lib/coupleCourt/safety.ts`, 지원 자원은 `support.ts`가 단일 출처다.

검토 대상은 자해·타해, 신체·성적 폭력, 위협, 감금, 스토킹, 강압적 통제, 금전 접근 차단이다.

`high_risk`에서 수행하는 동작:

- 책임 비율과 판사 유머 제거
- 일반 화해 처방과 공동 대화 권유 제거
- 초대, 판결 provider 호출, 공개 snapshot 차단
- 과거 판결·처방을 일반 API에서 숨김
- 안전한 장소와 신뢰할 사람, 공식 자원 안내

`sensitive`는 중재 자체를 중단하지 않지만 normal 전용 결과를 재사용하지 않고 모든 공개 후보·동의를 즉시 숨긴다. 안전 등급은 낮아지는 방향으로 갱신하지 않는다.

대한민국 중앙 지원 자원:

- 112 경찰 긴급신고
- 119 구조·구급
- 109 자살예방 상담전화
- 1366 여성긴급전화

문구는 위험을 확정 진단하지 않는다. 즉시 위험하면 앱 안에서 해결하도록 유도하지 않는다.

## 9. 개인정보와 공개 정책

### private 경계

- 각 사용자는 자신의 진술 원문만 받는다.
- 상대는 자신의 첫 진술 전후 모두 다른 사람의 원문을 직접 받지 않는다.
- 브라우저 생성·진술 초안은 로그인 user ID가 묶인 v2 envelope로 저장한다. 다른 계정으로 바뀌면 복원하지 않고 삭제하며, 과거 unscoped legacy key도 폐기한다. 초안에는 재전송용 exact request ID가 함께 들어간다.
- 초대 원문 토큰은 DB·로그·분석에 저장하지 않는다.
- URL fragment의 토큰은 서버 요청에 포함되지 않는다.
- 로그인 연결에는 token hash만 암호화한 10분 HttpOnly 쿠키를 사용한다.
- 오류 응답은 `{ code, error }`만 반환하고 내부 예외나 원문을 노출하지 않는다.

### 공개 snapshot

공개 snapshot과 PNG 공유 카드의 `publicCard`는 provider 출력 schema에 존재하지 않는다. 서버가 검증된 category·mode·provisional·result enum과 코드 allowlist로만 아래 필드를 결정론적으로 주입한다. 따라서 모델 자유 문구가 공개 경로로 전달되는 trust boundary 자체를 만들지 않는다.

- snapshot version
- category, mode, provisional
- safe title
- one-line summary
- result label
- 제한된 hashtag

진술, 각자 관점, 이름, 사건 번호, private 판결, 대화 문장, 처방은 공개 snapshot에 들어가지 않는다. 전화번호, 이메일, 주소, 계좌·예약 식별자, SNS, 업체·예식장 후보, 정확한 금액·날짜/시간과 사건의 known entity를 탐지한다. private AI 결과도 저장 전에 known entity와 PII를 다시 정제한다. 자동 탐지는 완벽하지 않으므로 사용자가 최종 미리보기를 직접 확인해야 하며, 사건이 `sensitive` 또는 `high_risk`로 승격되면 기존 공개 후보·동의를 즉시 숨긴다.

### 공개·심사 순서

1. normal 사건의 판결 완료
2. immutable snapshot 생성 또는 동일 hash/version 재사용
3. solo 1명, couple 2명의 정확한 snapshot 동의
4. 관리자 sanitized snapshot 심사
5. 승인 상태에서 참여자 publish 요청
6. DB가 current hash·동의 수·안전·moderation을 원자적으로 재검사
7. `published` view 노출

동의 철회, 사건 보관, 계정 삭제, 관리자 숨김은 공개물을 즉시 `hidden`으로 만든다. 댓글은 기본 `pending`이고 승인된 본문만 public comment view에 보인다.

## 10. API 계약

### 사건·진술·초대

```text
GET    /api/couple-court/cases
POST   /api/couple-court/cases
GET    /api/couple-court/cases/:caseId
DELETE /api/couple-court/cases/:caseId          # body action: archive | delete
DELETE /api/couple-court/cases/:caseId/participation
POST   /api/couple-court/cases/:caseId/statements
POST   /api/couple-court/cases/:caseId/invite
DELETE /api/couple-court/cases/:caseId/invite
POST   /api/couple-court/invites/accept          # accept 또는 reject
```

사건 DELETE는 기본적으로 보관한다. 영구삭제는 `{ "action": "delete", "confirmation": "영구삭제" }`가 필요하며 신청인의 solo 사건 또는 상대방 진술 전 사건만 허용한다. 상대방 진술 이후 요청은 `409 COURT_DELETE_REQUIRES_JOINT_POLICY`다. 판결 생성 중인 `judging` 사건은 먼저 보관해 유료 호출을 안전하게 settle해야 하며, `provider_audit_state=pending`인 호출이 하나라도 있으면 감사 복구·finalize 전까지 영구삭제를 DB가 거부한다. 상세 화면에는 입력 확인을 포함한 영구삭제 UI가 연결되어 있다. 초대 DELETE는 아직 사용되지 않은 현재 초대를 폐기한다.

초대 링크는 발급 시점부터 72시간 유효하고 새 링크를 발급하면 이전 미사용 링크를 폐기한다. 수락 API는 `{ reject: true }`로 명시적 거절도 처리한다. 거절하면 링크가 무효가 되고 신청인에게는 거절 상태만 보이며 거절 계정·이유는 노출하지 않는다. 수락한 상대는 **자신의 첫 진술을 제출하기 전**에만 participation DELETE로 나갈 수 있다. solo에서 전환된 사건은 기존 임시판결을 복원하고, 원래 couple 사건은 새 상대를 기다리는 상태로 돌아간다. 진술 제출 후에는 한 사람이 일방적으로 나갈 수 없다.

사건 생성 body에는 `creation_request_id`, 진술 제출 body에는 `submission_request_id` UUID가 필수다. 클라이언트는 네트워크 오류 재시도 때 같은 ID와 같은 payload를 보내야 한다.

### 판결·처방·체크인

```text
POST /api/couple-court/cases/:caseId/judge
GET  /api/couple-court/cases/:caseId/verdict
GET  /api/couple-court/cases/:caseId/verdict-history
POST /api/couple-court/missions/:missionId/accept
POST /api/couple-court/missions/:missionId/complete
POST /api/couple-court/missions/:missionId/save-action
POST /api/couple-court/cases/:caseId/followups
```

일반 3일 후 체크인은 판결 완료 72시간 뒤 참여자·판결별 한 번 저장한다. outcome은 정확히 `resolved`(해결됐다), `improved`(조금 나아졌다), `unchanged`(아직 그대로다), `needs_more_talk`(오히려 더 이야기해야 한다) 네 가지며 내부 점수는 각각 4·3·2·1이다. `remaining_issue`는 필수이고, 안전 신호는 followup 저장과 같은 트랜잭션에서 단조 승격한다. followup 자체가 high-risk이면 안전 보고를 잃지 않도록 일반 72시간·상태·기존 체크인 제한보다 우선해 저장·승격하며, 일반 판결을 되살리지 않고 안전 안내만 반환한다.

### 공개재판

```text
POST   /api/couple-court/cases/:caseId/public-preview
POST   /api/couple-court/cases/:caseId/public-consent
POST   /api/couple-court/cases/:caseId/publish
DELETE /api/couple-court/cases/:caseId/publish
GET    /api/couple-court/public
GET    /api/couple-court/public/:postId
POST   /api/couple-court/public/:postId/vote
GET    /api/couple-court/public/:postId/comments
POST   /api/couple-court/public/:postId/comments
POST   /api/couple-court/public/:postId/reports
```

### 관리자

```text
GET  /api/admin/couple-court
POST /api/admin/couple-court
```

관리자 응답에는 sanitized snapshot, pending 댓글 본문, 신고 사유, `failed_unknown` provider reconciliation용 최소 메타데이터와 별도 provider 감사 복구 대기열의 제한 상태만 포함한다. profile·일반 user ID·진술·private 판결을 반환하지 않는다. provider 재시도 허용은 `target=provider_reconciliation`, `decision=allow_retry`, 허용된 reason code, 정확한 확인 문구를 모두 요구하며 DB가 active admin과 현재 상태를 다시 검사한다. 감사 복구는 `target=provider_audit_recovery`, `decision=recover_one`으로 서버가 대상을 선택·lease하고 exact audit→finalize만 수행한다. 브라우저는 복구 대상 ID·request key·감사 identity·usage·staged payload를 받지 않는다.

공개 피드의 category·mode 필터와 `latest | popular` 정렬은 서버 query에서 적용한다. exact count와 안정적인 `published_at, id` 순서로 페이지를 자르고, 범위를 넘은 page는 마지막 유효 page로 clamp한다. 클라이언트가 최신 일부만 내려받아 필터링하는 구조가 아니므로 조건에 맞는 과거 게시물이 누락되지 않는다.

## 11. 환경 변수

샘플은 `apps/web/.env.example`에 있다. 실제 값은 `.env.local` 또는 배포 secret에만 둔다.

### 필수 기반

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RATE_LIMIT_KEY_SECRET=
```

### private·AI·public 플래그

```dotenv
COUPLE_COURT_ENABLED=false
COUPLE_COURT_AI_ENABLED=false
COUPLE_COURT_PUBLIC_ENABLED=false
COUPLE_COURT_MOCK_ENABLED=false
COUPLE_COURT_INVITE_COOKIE_SECRET=
```

production에서는 세 기능 플래그가 정확히 `true`일 때만 각 표면을 연다. public은 private에 의존한다. mock은 production에서 값과 무관하게 금지한다. AI 플래그, 키, model/reasoning 설정, production mock 중 하나라도 유효하지 않으면 새 claim은 DB에서 차단되지만 기존 ready/staged 조회·복구는 먼저 시도한다. `NEXT_PUBLIC_COUPLE_COURT_ENABLED`는 운영자가 별도로 넣는 secret이 아니라 `next.config.ts`가 서버의 private 플래그에서 공개 가능한 boolean만 파생해 라운지 진입점 표시용으로 사용한다.

`/api/health/maintenance`는 잘못된 조합을 숨기지 않도록 세 기능 플래그와 mock의 **원시 exact-true 상태**, 그리고 Terra 키·정확한 model·`none` reasoning이 유효한지를 값 없는 `coupleCourtProviderConfigured` boolean으로만 보고한다. 키·model 문자열은 응답하지 않는다. remote live smoke는 mock=false를 강제하고 AI를 열 때 provider 구성 boolean=true를 요구한다. AI 비용과 사건 mutation을 피하기 위해 judge API는 canary에서 호출하지 않는다.

### OpenAI

```dotenv
OPENAI_API_KEY=
OPENAI_AMORA_PRIMARY_MODEL=gpt-5.6-terra
OPENAI_AMORA_PRIMARY_REASONING_EFFORT=none
AMORA_IDEMPOTENCY_SECRET=
```

키는 클라이언트 변수나 Git 파일에 넣지 않는다. 판결은 primary Terra만 사용한다. 일반 아모라 채팅의 Luna 설정과 혼동하지 않는다. `AMORA_IDEMPOTENCY_SECRET`은 공용 아모라 채팅 실행 식별자용 기존 플랫폼 secret이며, 커플재판소 판결의 입력 hash는 비밀키 없는 정규화 SHA-256과 DB case scope를 사용한다.

### 관리자

```dotenv
ADMIN_PASSWORD=
```

운영 초기 관리자 생성은 별도 기존 정책을 따른다. 커플재판소 때문에 임의 관리자 우회 경로를 만들지 않는다.

## 12. 로컬 개발

요구사항:

- Node.js 22.13 이상
- Corepack
- 저장소에 고정된 pnpm 11.7.0
- 실제 로컬 Supabase를 쓸 경우 Docker

### 설치와 실행

```powershell
corepack pnpm install
if (-not (Test-Path apps/web/.env.local)) {
  Copy-Item apps/web/.env.example apps/web/.env.local
}
corepack pnpm dev:web
```

기존 `.env.local`에는 실제 로컬 secret이 있을 수 있으므로 복사 명령으로 덮어쓰지 않는다. 파일이 이미 있으면 필요한 새 변수 이름만 수동으로 병합하고 값은 출력·커밋하지 않는다.

로컬 mock 판결을 쓰려면 `.env.local`에서 다음처럼 설정한다.

```dotenv
COUPLE_COURT_ENABLED=true
COUPLE_COURT_AI_ENABLED=false
COUPLE_COURT_PUBLIC_ENABLED=true
COUPLE_COURT_MOCK_ENABLED=true
COUPLE_COURT_INVITE_COOKIE_SECRET=<로컬 전용 32자 이상 무작위 값>
```

mock은 AI 응답만 대체한다. 사건·초대·공개 흐름에는 migration이 적용된 Supabase가 필요하다.

로컬 Docker가 준비된 경우에만 로컬 프로젝트에서 실행한다.

```powershell
corepack pnpm exec supabase start
corepack pnpm exec supabase db reset
```

`db reset`은 데이터가 삭제되는 명령이다. 출력으로 확인한 로컬 Supabase에만 사용한다. linked preview·production에는 실행하지 않는다.

실제 Terra를 로컬에서 제한적으로 확인할 때는 mock을 false, AI 플래그를 true로 바꾸고 서버 전용 OpenAI 키를 넣는다. 비용이 발생하므로 자동 test suite에서는 실제 provider를 호출하지 않는다.

## 13. 마이그레이션 적용

### 로컬·폐기 가능한 환경

1. 정확한 branch와 migration 파일을 확인한다.
2. 운영 ref가 아닌 로컬 또는 승인된 폐기 가능 프로젝트인지 확인한다.
3. blank fresh replay와 이전 migration 체인에서의 upgrade를 각각 실행한다.
4. DB lint, migration contract, RLS/RPC, 계정 삭제, public view를 검증한다.
5. 테스트 사용자 데이터는 실명·실제 업체·실제 갈등을 사용하지 않는다.

원격 preview 절차는 [`SUPABASE_REMOTE_OPERATIONS.md`](./SUPABASE_REMOTE_OPERATIONS.md)를 따른다. 현재 저장소의 승인된 disposable ref와 복구 producer가 준비되지 않았다면 원격 적용을 시도하지 않는다.

### production

운영에서 다음을 직접 실행하지 않는다.

- 원시 `supabase db push`
- `db reset --linked`
- `migration repair`
- `--include-all`
- SQL Editor에 migration 일부를 복사해 이어서 적용

승인된 전체 릴리스에서만 다음 guarded entrypoint를 사용한다.

```powershell
corepack pnpm supabase:ship:safe -- -ExpectedProjectRef <production-project-ref>
```

현재 이 경로는 write fence, backup/restore, signed release evidence가 준비되지 않아 원격 변경 전에 의도적으로 hard-stop한다. 이 hard-stop을 우회하는 것은 출시가 아니다.

운영 적용 전 최소 증거:

- exact SHA와 clean worktree
- 동일 migration 체인의 disposable fresh/upgrade replay
- maintenance와 write fence의 실제 쓰기 차단 probe
- DB와 Storage를 포함한 백업·복구 rehearsal, RPO/RTO
- 현재 remote ledger와 pending migration inventory
- post-deploy DB contract
- 이전 정상 웹 deployment와 환경 snapshot

## 14. 롤백

이 기능에는 자동 파괴적 down migration이 없다. 롤백은 데이터 보존을 우선한다.

### 기능 이상

1. `COUPLE_COURT_PUBLIC_ENABLED=false`로 공개 표면을 먼저 닫는다.
2. 필요하면 `COUPLE_COURT_AI_ENABLED=false`로 새 provider 호출을 막는다. 이 상태에서도 private 플래그가 열려 있으면 기존 ready replay와 `result_staged`의 감사·complete 복구는 허용되며 새 provider lease는 열리지 않는다.
3. 필요하면 `COUPLE_COURT_ENABLED=false`로 private 표면을 닫는다.
4. 정확한 이전 안전 deployment를 승격한다.
5. DB 행은 조사·복구가 끝날 때까지 유지한다.

플래그 변경은 재배포가 필요하다. Vercel code rollback은 DB나 환경변수를 자동으로 되돌리지 않는다.

### 개인정보·공개 사고

공개를 단순히 UI에서 숨기는 데 그치지 않는다. 승인된 관리자 숨김 또는 참여자 철회 경로로 DB 상태를 `hidden`으로 바꾸고 public view에서 사라졌는지 확인한 뒤 public 플래그를 닫는다. 원문을 운영 로그나 이슈에 복사하지 않는다.

### provider 결과 불명

`failed_unknown`은 자동 장애 복구 대상이 아니라 비용 reconciliation 대상이다.

1. 연속 발생이나 비용 이상이면 `COUPLE_COURT_AI_ENABLED=false`로 새 호출을 먼저 닫고 새 deployment에 반영됐는지 확인한다.
2. `/admin/couple-court`의 provider 대기열에서 verdict correlation ID·request key·provider state·시각·안전한 오류 코드만 확인한다. 진술이나 private 결과를 찾기 위해 DB 원문을 복사하지 않는다.
3. 승인된 provider 요청/비용 기록에서 해당 호출의 처리 여부를 외부 확인한다. 확인할 수 없으면 `failed_unknown`을 유지한다.
4. 중복 비용 가능성을 수용하고 새 시도가 맞다는 운영 판단이 기록된 경우에만 제한된 reason code와 `ALLOW_RETRY_AFTER_PROVIDER_REVIEW`를 입력해 `allow_retry`를 실행한다.
5. `provider_reconciled` event, 관리자·시각·reason이 저장됐는지 확인하고 사용자의 다음 시도를 관찰한다. 임의 SQL로 `provider_state`나 counter를 직접 수정하지 않는다.

`safety_escalation_failed`는 4번의 예외다. 안전 승격과 비용 settle의 원자성 실패 가능성을 뜻하므로 일반 `allow_retry`가 DB에서 차단된다. AI 플래그를 닫고 사건 안전 상태·reservation·verdict를 조사해 별도 안전 remediation을 완료하기 전에는 재호출하지 않는다.

`provider_audit_state=pending`은 위 비용 대기열과 다른 감사 복구 대기열이다. 관리자 화면의 `recover_one`은 브라우저에 식별 envelope를 노출하지 않은 채 서버에서 하나를 lease해 exact keyed audit와 finalize만 수행한다. `result_staged`는 사건이 활성인 동안 recovery audit와 fenced complete가 성공할 때까지 private stage를 보존하고 provider를 재호출하지 않는다. 보관된 사건은 private stage를 즉시 폐기하되 payload-free 비용·감사 envelope는 finalize될 때까지 보존한다.

### DB 손상

임의 SQL 역변환을 만들지 않는다. maintenance/write fence를 유지하고 [`PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md`](./PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md)의 승인된 recovery point, DB·Storage 복구, exact contract, 서비스 canary를 따른다.

## 15. 테스트

### 집중 테스트

```powershell
corepack pnpm --filter @hanbang/web exec vitest run `
  src/lib/coupleCourt `
  src/components/couple-court/__tests__ `
  src/app/api/couple-court/__tests__ `
  src/app/api/admin/couple-court/__tests__ `
  src/lib/__tests__/coupleCourtMigrationContract.test.ts
```

현재 관련 test 파일은 schema, state, hash, catalog, safety, privacy, judge, invite handoff·route, API normalizer, 공개 피드 paging, public identity, analytics, admin moderation·rate-limit, release health·live smoke, migration contract를 다룬다.

배포 경계·설정 장애·관리자 감사 복구는 다음 파일을 반드시 포함해 확인한다.

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

여기서 확인할 핵심은 historical prompt/schema identity 사용, AI 플래그 off·키 없음·잘못된 model env·production mock 상태의 `allowNewClaim=false`, staged 결과의 provider 무재호출 복구, unsupported schema의 fail-closed, 관리자 응답의 식별 envelope 비노출, 초대 로그인 전 DB 무쓰기, 관리자 120회/시간 limit, Bearer가 있을 때 cookie fallback 금지, 오류 응답 no-store, raw release flag·provider 구성과 읽기 전용 page probe 계약이다.

### 웹 전체 게이트

```powershell
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/web lint
corepack pnpm --filter @hanbang/web test
corepack pnpm --filter @hanbang/web build
```

최종 릴리스 SHA에서는 루트 게이트와 비밀 검사도 실행한다.

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm security:secrets
```

정적 migration contract test 통과는 PostgreSQL 적용 성공과 같지 않다. 실제 disposable DB replay가 별도로 필요하다.

### 필수 브라우저 E2E

서로 다른 인증 사용자 2명을 사용한다.

1. solo 사건 생성·진술·mock 또는 Terra 임시판결
2. solo 결과 뒤 상대 초대, 임시판결 비노출 확인
3. 다른 계정의 초대 수락과 독립 진술
4. 쌍방 판결, 처방 수락·완료, 한 번만 할 일 저장
5. 이의 제기 후 새 revision·판결, 이전 generation의 `superseded` history 보존, 오래된 할 일 제거
6. solo 1명 / couple 2명 snapshot 동의
7. 관리자 승인 전 public 미노출, 승인·게시 후 sanitized 필드만 노출
8. 투표 변경, 댓글 pending, 댓글 승인, 신고·숨김
9. 공개 철회 즉시 404/피드 제거
10. high-risk 입력에서 초대·판결·공개와 과거 판결 차단
11. 만료·사용·재발급 초대, 본인 수락, 다른 계정 충돌
12. 초대 거절, 진술 전 상대 나가기, solo 임시판결 복원, 진술 후 나가기 거부
13. 같은 `creation_request_id`/`submission_request_id`와 같은 payload replay, 다른 payload mismatch 거부
14. 정상 provider `result_staged → audit pending → exact keyed audit → audited → complete`, 중간 실패 뒤 재호출 없는 사용자 claim 복구
15. stage를 만든 release와 다른 prompt/schema 상수로 재배포한 뒤 저장 identity로 복구하고, AI 플래그 off·키 누락·잘못된 model env·production mock에서도 새 generation/provider 시도 없이 기존 stage에 복구 lease만 발급해 complete되는지 확인
16. 복구할 stage가 없는 같은 설정 장애에서는 `unavailable`·503이고 새 verdict/provider reservation·workflow 변경이 없는지 확인
17. provider high-risk의 payload-free settle·안전 승격·audit finalize, 감사 실패 뒤 관리자 safe-envelope `recover_one`, 판결·처방 payload 부재 확인
18. provider `failed_unknown` 자동 재시도 차단, 관리자 확인문구 없는 reconciliation 거부, 승인 후 새 시도, `safety_escalation_failed` allow-retry 거부
19. `judging`과 provider 감사 pending 상태의 영구삭제 거부, 보관 시 private stage 폐기·audit envelope 유지·복구 후 삭제
20. couple/user 30회·global 60회 KST quota 경계와 시작 전 실패 quota 환불
21. 느린 네트워크, 중복 클릭, 판결 timeout, 새로고침 복구

화면 폭 360px, 390px, 430px, 태블릿, 데스크톱을 확인한다. 키보드 탐색, dialog focus trap·복귀, Escape, 오류-필드 연결, live region, 200% 확대, reduced motion도 포함한다.

## 16. 분석과 운영 관측

허용 이벤트명은 `apps/web/src/lib/coupleCourt/types.ts`, runtime 속성 allowlist는 `apps/web/src/components/couple-court/analytics.ts`가 단일 출처다. 허용 속성은 제한된 `mode`, `category`, `tone`, `status`뿐이다.

다음을 분석에 넣지 않는다.

- 진술·제목·판결·댓글 원문
- 이름·연락처
- user/case/post/mission UUID
- 초대 토큰·URL
- 첨부 경로
- 내부 오류 전문

rollout 중 확인할 지표:

- 사건·진술·초대·판결·처방 funnel
- 판결 ready/failed/timeout 비율과 latency
- schema 검증 실패율
- Terra 호출 수·token·비용
- safety redirect 수와 공개 차단 수
- 공개 심사 대기 시간, 댓글·신고 backlog
- 공개 철회가 view에 반영되는 시간

수치 이상을 원문 샘플 수집으로 해결하지 않는다. 안전한 오류 코드와 합성 fixture로 재현한다.

## 17. 보관, 삭제, 계정 삭제

세 동작은 의미가 다르다.

| 동작 | 현재 사용자 경로 | 결과 |
| --- | --- | --- |
| 사건 보관 | `DELETE /api/couple-court/cases/:caseId` | 신청인만 가능. workflow archived, 초대 폐기, 공개 숨김. 일반 private 사건 데이터는 유지하되 진행 중 generation lease와 staged 판결·처방 payload는 폐기. 검증 결과가 도착한 호출의 payload-free 감사 envelope는 유지 |
| 공개 철회 | `DELETE /api/couple-court/cases/:caseId/publish` | 공개 snapshot·동의 숨김. private 사건 유지 |
| 영구삭제 | 상세 화면 확인 UI → 사건 DELETE의 `action: delete` → DB `delete_court_case` RPC | 신청인의 solo 또는 상대방 진술 전 사건만 graph와 연결 court 출처 할 일을 삭제. 상대방 진술 후에는 409로 거부 |
| 계정 삭제 | 기존 account deletion lifecycle | 참여한 사건 전체 삭제. 공개·파생 판결·처방·court 할 일도 제거 |

두 사람의 진술에서 만든 판결을 한 사람 몫만 안전하게 분리할 수 없으므로, 한 참여자의 계정 삭제는 해당 2인 사건 전체를 삭제하는 보수적 정책이다. 상대 진술 후 공동 삭제를 운영에 열기 전에는 상대방 고지, 보존 의무, 신고·분쟁 보존 기간을 제품·법무 책임자가 확정해야 한다.

`영구삭제`가 즉시 지우는 범위는 `court_cases`에 cascade된 진술·판결·처방·followup·event·공개 graph와 연결된 court 출처 `amora_actions`다. 별도 플랫폼 규정에 따른 `ai_interactions_log` 비용·보안 감사 행은 사건 graph FK가 아니므로 사건 삭제와 함께 지우지 않는다. 커플재판소 감사 행은 애초 `user_input`, `ai_output`, case ID를 저장하지 않고 안전한 버전·분류·hash·사용량 메타데이터만 저장한다. checked-in 플랫폼 retention 계약은 90일 뒤 직접 식별자와 metadata를 정제하고, 1년 뒤 집계 감사 행을 삭제한다. 실제 운영 cron 적용·실행 증거는 별도 출시 게이트다. 이 차이를 영구삭제 UI·개인정보 처리방침·법무 승인에서 숨기면 안 된다.

영구삭제 RPC는 `workflow_status=judging`이면 먼저 보관하도록 거부하고, 사건에 `provider_audit_state=pending` reservation이 하나라도 있으면 감사 복구 전 삭제를 거부한다. 이는 유료 호출의 private payload는 보관 시 없애면서도 필수 감사 행을 잃지 않기 위한 DB 최종 방어선이다.

## 18. 단계적 rollout

1. final SHA에서 전체 테스트·빌드·비밀 검사를 통과한다.
2. disposable DB에서 fresh/upgrade replay와 실제 RLS/RPC contract를 통과한다.
3. 현재 `result_staged`, `provider_audit_state=pending`, `failed_unknown` 수를 안전한 집계로 확인하고, 새 release가 모든 저장 schema/model identity를 계속 지원하는지 확인한다.
4. DB·Storage 복구 rehearsal과 write fence를 확보한다.
5. 세 플래그가 false인 웹을 exact SHA로 stage한다.
6. DB migration과 post-deploy contract를 완료한다.
7. AI 플래그 off·키/모델 설정 장애 상태에서 lookup-only claim이 새 generation/provider 시도·비용을 만들지 않고, 기존 staged 결과에만 복구 lease를 발급하는지 검증한다.
8. 내부 사용자에게 private 기능만 연다.
9. 비용·schema·안전 canary 뒤 Terra 판결을 연다.
10. 관리자 담당자·SLA·신고 대응이 준비된 뒤 public을 연다.
11. 소수 사용자부터 latency, 비용, 공개 철회, 안전 차단을 본다.
12. 문제 없을 때만 범위를 넓힌다.

각 단계는 독립적으로 되돌릴 수 있어야 한다. public, AI, private를 한 번에 켜지 않는다.

## 19. 현재 검증 상태

| 항목 | 상태 | 해석 |
| --- | --- | --- |
| 제품·API·UI 코드 | `feature/couple-court` 코드 체크포인트 `1d7f8f17`까지 커밋 | 출시 증거 아님 |
| 관련 단위·계약 테스트 | 앞선 전체 웹 172파일·1,326개·모바일 22개 통과 후, 운영 안전 경계 집중 웹 5파일·79개와 live-smoke 7개, Bearer 격리 포함 3파일·27개 통과 | 문서 반영 뒤 최종 SHA 전체 재실행 필요 |
| lint·typecheck·build | 루트 lint 통과, 4개 패키지 typecheck 통과, Next production build 108개 정적 페이지 생성 통과 | 실제 배포 검증과 별개 |
| SQL 정적 contract | migration contract 29개, Couple Court 345 SQL/48 PLpgSQL, 전체 활성 117파일·2,783 SQL/216 PLpgSQL parser 검증 통과 | 실제 PostgreSQL replay 대체 불가 |
| 비밀정보·working tree 위생 | 앞선 전체 추적·미추적 1,161파일·Git 1,144커밋 검사와 현재 scanner 단위 7개 통과 | 새 문서 커밋을 포함한 최종 history scan·외부 secret manager 검증과 별개 |
| disposable DB fresh/upgrade | 미완료 | blocker |
| 인증된 2인 브라우저 E2E | 미완료 | blocker |
| 360/390/430 실제 브라우저 QA | 공개 화면 3개 폭과 private 홈 430px 수동 확인, 가로 넘침 없음 | 인증된 전체 흐름·키보드·스크린리더 검증은 미완료 |
| Expo export·release 정적 검사 | web/iOS/Android export 통과, release check 77 pass·1 warning·0 fail | 서명 EAS build·실기기와 별도 native 커플재판소 화면은 미완료; social login hard-disabled 경고 |
| OpenAI Terra 실제 종단 canary | 미완료 | mock 통과와 별개 |
| 운영 DB migration | 미적용 | 로컬 SQL 존재와 운영 상태는 다름 |
| 운영 health·무쓰기 canary 코드 | raw private/AI/public/mock, Terra provider 구성, invite/public 원시 HTML 200/404 계약 구현·단위 검증 | 실제 staged/production 실행은 미수행 |
| 운영 배포·배포 후 카나리 | 미수행 | 서비스 완료로 보고 금지 |

## 20. 알려진 제한과 P1

1. 초대 취소 RPC·API·상세 화면 버튼은 있다. 재발급도 이전 미사용 링크를 무효화한다.
2. 영구삭제 confirmation UI까지 연결되어 있지만 상대방 진술 이후의 공동 삭제·고지·보존 정책은 미결이어서 DB가 삭제를 거부한다.
3. 처방은 실제 아모라 할 일로 저장할 수 있지만 calendar·budget adapter와 버튼은 아직 없다.
4. 3일 후 체크인 저장은 있으나 자동 알림·예약 worker는 없다.
5. 일반 revision·상대 첫 진술의 이전 판결과 처방·followup은 `superseded` DB history로 보존한다. 판결 화면은 생성 차수·시각·교체 여부의 metadata-only 이력을 보여주고 과거 판결 본문은 다시 노출하지 않는다. safety 승격 시에는 민감한 과거 결과를 제거한다.
6. 증거 파일 업로드는 구현하지 않았다.
7. 공개 피드는 서버측 exact count·paging·필터·정렬을 지원하지만 판결 완료·승인 게시물만 다뤄 `판결 대기` 필터가 없다.
8. 공개 예시는 코드 fixture뿐이며 production DB seed는 하지 않는다.
9. 관리자 대기열은 종류별 오래된 항목 50개까지 읽고, 처리 후 다음 묶음을 불러온다.
10. 공유 카드는 브라우저 Canvas와 Web Share API에 의존하며 지원하지 않는 환경은 PNG 저장으로 대체한다.
11. 별도 Expo native 커플재판소 화면은 없다. 모바일 앱에서의 실제 진입·인증·safe-area·키보드는 별도 검증이 필요하다.
12. provider 감사 복구는 관리자 한 항목 수동 실행이며 자동 worker나 일괄 drain은 없다. non-high-risk stage의 최종 판결 complete도 관리자 작업이 아니라 다음 참여자 claim이 담당하므로, pending 대기열이 남은 상태를 자동 복구 완료로 보고하면 안 된다.

우선순위는 실제 DB·브라우저 검증, 상대 진술 후 공동 삭제 정책 확정, provider staging/reconciliation 장애 주입 검증, 할 일 외 adapter, 예약 체크인 순이다. 검증되지 않은 업로드나 공개 확장은 뒤로 둔다.

## 21. 다음 컴퓨터에서 시작할 체크리스트

```powershell
git fetch origin
git switch feature/couple-court
git pull --ff-only origin feature/couple-court
git status --short --branch
git merge-base --is-ancestor 1d7f8f17 HEAD
corepack pnpm install
```

다른 컴퓨터에 로컬 브랜치가 아직 없으면 `git switch --track origin/feature/couple-court`로 처음 만든다. `git merge-base`가 0이 아니면 인계 체크포인트를 포함하지 않은 것이므로 작업을 시작하지 말고 fetch/branch를 다시 확인한다. 기존 `apps/web/.env.local`은 복사나 checkout으로 덮어쓰지 않는다.

그다음 순서:

1. 이 문서와 `couple-court-plan.md`를 읽는다.
2. `git status`에서 공유 작업자의 미커밋 변경을 덮어쓰지 않는다.
3. migration과 `repository.ts`의 RPC signature가 같은지 확인한다.
4. `config.ts`와 SQL의 historical schema registry, `complete_court_verdict` model allowlist가 현재 pending/staged identity를 모두 지원하는지 확인한다.
5. 관련 집중 테스트, typecheck, lint, 전체 test, build를 실행한다.
6. 실제 DB가 없으면 성공으로 보고하지 말고 static-only라고 기록한다.
7. production이 아닌 disposable DB에서 replay와 설정 장애 lookup-only claim을 준비한다.
8. 인증된 2인 E2E와 모바일 폭 QA를 수행한다.
9. 모든 운영 안전 게이트 전에는 merge·운영 DB 변경·배포를 하지 않는다.
