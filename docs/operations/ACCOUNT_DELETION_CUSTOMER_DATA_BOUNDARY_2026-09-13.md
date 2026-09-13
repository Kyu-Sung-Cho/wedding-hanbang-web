# 탈퇴 전 개인 상담 데이터 경계 (232 후보)

기준: 운영 소스 `d7f7599aba289066b246c19220ba55627331ab0c`에서 출발한 코드 검토와 로컬 합성 PostgreSQL 실행. 이 문서는 운영 migration 적용·고객 삭제·전체 보존 정책 완료를 증명하지 않는다. 고객 row 조회/변경, cron 호출, 메일 발송은 수행하지 않았다. 운영 카탈로그의 FK/trigger metadata만 읽었다.

## 발견과 기존 동작

- `communityStorageSaga.ts`의 `processAccountDeletionJob`은 Storage inventory/삭제/부재 검증 뒤 `prepare_account_deletion_auth_delete`를 호출하고 Auth를 삭제했다. 호출자는 인증된 삭제 API, account-deletion cron, 단건 support CLI이다. 새 customer-data prep은 이 공통 worker의 삭제 단계에서 Storage remove보다 먼저 실행한다.
- 기존 `prepare_account_deletion_auth_delete`는 exact job/claim, 상태, quarantine, vendor 보유, media 청소만 검증했다. 개인 원문/출처 정리 영수증은 없었다.
- 기존 authenticated 전용 `hard_delete_current_user_private_chat`는 `auth.uid()`와 실제 profile/slot을 확인하고 claim → private memory 잠금, 저장 복사본 → 파생 기억 → 도구/claim → 원문 순으로 정리한다. 일반 대화 지우기 기능이므로 수동 private 결정은 남긴다. 이 함수를 서비스 사용자로 가장해 호출하지 않았다.
- `20260902120000_leaving_does_not_erase_the_partner_memory.sql`은 이탈 시 떠나는 private 파생 레인만 정리하고 공유 기억/중재를 보존한다. 원문, 수동 private 결정, 모든 도구 provenance를 지우는 함수는 아니다. Auth BEFORE DELETE에는 기존 community viewer-control 식별자 tombstone도 있으며, 새 경계는 그것을 대체하지 않는다.
- `chat_summaries.user_id`의 실제 선언은 Auth `CASCADE`다. 공유 기억 보존 트리거만으로 이 FK 삭제를 막을 수 없어, 현재 살아남는 파트너의 공유 summary는 본문을 유지하고 subject `user_id`만 NULL로 먼저 분리한다.

## 처리 범위

| 데이터 | 연결된 파트너가 남을 때 | 마지막 멤버/연결 전 | 이번 영수증의 범위 |
|---|---|---|---|
| subject private `chat_messages`, 수동·자동 `decision_nodes`, summaries, `amora_couple_profiles` | 정확히 subject의 검증된 현재 private lane만 제거 | 연결된 마지막 멤버도 자기 lane 먼저 제거; 연결 전에는 lane을 추측하지 않음 | 포함 |
| private 원문을 복사한 `amora_saved_notes` | 원문 FK가 NULL이 되기 전에 복사본 제거; 남은 파트너의 별도 메모 보존 | 현재 source가 증명되는 복사본만 동일 처리 | 포함 |
| subject claims의 journal, `amora_tool_executions`, enqueue repair candidate/dead-letter | subject의 원래 claim 관계를 이용해 정리; 이미 적용된 예산/일정 결과는 유지 | 정확 owner가 확인되는 요청만 정리 | 포함 |
| private memory jobs/consents/settings | jobs/consents 제거, settings off + reset boundary | 동일; couple가 없어지면 기존 FK cascade | 포함 |
| 공유 채팅·결정, 파트너 private, budgets/일정/체크리스트 | 본문/금액/상태 보존, 기존 FK에 따른 식별자 분리 | 마지막 slot이 사라지면 기존 empty-couple trigger/FK cascade | 공유 파괴 금지 |
| 본인이 별도로 저장한 notes, profile/개인 역할·사진 장부/동의 등 | 기존 Auth/profile CASCADE 계약 | 동일 | 기존 DB/Auth 경계; 사진 bytes는 Storage saga 별도 |
| 원본 없는 legacy tool key, 현재 roster 밖/서로 다른 owner가 섞인 private provenance, 과거 couple의 subject-linked shared summary | 추측으로 지우거나 완료 처리하지 않고 scope review | 동일 | 미지원 시 Auth 전에 중단 |
| AI 운영 로그, 검색/행동 로그, legacy quote·messages, 업체/커뮤니티/감사 보존, 백업 | 기존 공표 정책과 각 데이터 계약을 별도 검토 | 동일 | 전체 삭제/익명화 완료로 주장하지 않음 |

`/privacy`의 별도 저장 노트·운영 로그·백업 문구와 기존 데이터 계약을 그대로 기준으로 삼았다. 코드에는 과거 AI raw payload 90일 정리, 관리자 접근 기록 1년 보존이 명시돼 있지만, 이를 새로운 법정 보존 의무로 해석하거나 모든 로그가 익명이라고 쓰지 않는다. 원문/식별 연결을 보유할 수 있는 운영 자료는 support case의 전체 scope review가 끝난 것으로 자동 변경되지 않는다.

## nullable FK와 출처가 사라지는 곳

`20260716117000_account_deletion_auth_fk_contract.sql`의 SET NULL 목록은 다음 15개다. 이름만 NULL로 만드는 것을 개인정보 전체 삭제로 간주하면 안 된다.

| 묶음 | nullable FK 열 |
|---|---|
| AI/준비 | `ai_interactions_log.user_id`, `amora_actions.created_by`, `amora_memory_jobs.user_id`, `amora_memory_settings.enabled_by`, `amora_quote_checks.user_id` |
| 대화/커플 | `chat_messages.sender_id`, legacy `messages.sender_id`, `couples.bride_id`, `couples.groom_id` |
| 행동/운영 | `customer_events.user_id`, `search_logs.user_id`, `community_agent_personas.backing_user_id` |
| 업체 | `vendor_bookings.receipt_verified_by`, `vendor_reviews.customer_id`, `vendor_views.viewer_id` |

운영 카탈로그를 metadata 전용 SELECT로 확인한 결과, `public/community_private`에서 Auth/profile/couple을 참조하는 SET NULL FK는 **40개**였다. 위 15개 외의 25개는 다음과 같다. 고객 row는 조회하지 않았다.

| 참조 | 추가 SET NULL 열 |
|---|---|
| Auth (11개) | `community_decision_answers.author_id`, `community_decision_outcome_publications.reviewed_by`, `community_decision_outcomes.author_id`, `community_decision_publication_commands.actor_id`, `community_decision_thread_events.actor_id`, `community_decision_threads.author_id`, `community_responder_supply_events.actor_id`, `community_thread_evidence_selections.author_id`, `community_viewer_control_events.blocked_user_id/blocker_user_id`, `events.user_id` |
| profile (9개) | `amora_today_one_signals.muted_by`, `community_agent_content_drafts.created_by/posted_by`, `community_agent_personas.created_by`, `community_responder_questions.created_by_operator`, `community_responder_requests.created_by_operator`, `responder_capacity_slots.reviewed_by`, `wedding_payment_ledger.created_by/updated_by` |
| couple (5개) | `amora_quote_checks.couple_id`, `customer_events.couple_id`, `customer_insights.couple_id`, `profiles.couple_id`, `vendor_bookings.couple_id` |

같은 카탈로그 관측에서 Auth/profile의 non-internal trigger 9개를 확인했다. 기존 Auth BEFORE DELETE 정리는 viewer-control tombstone 1개였고 개인 채팅 전체 정리 trigger는 없었다. 전체 데이터베이스의 모든 참조/보존 자료 조사로 확대하지 않는다. 원문 metadata 근거: 외부 `avatar-delivery-20260913/account-deletion-identity-catalog-readonly.json`.

반대로 nullable라도 `chat_summaries.user_id`, submission verification/report/submission 계열은 CASCADE이고, `amora_saved_notes.saved_by`와 `amora_chat_request_claims.user_id`는 각각 Auth/profile CASCADE다. repair outbox/dead-letter `user_id`는 자체 Auth FK가 없고 원래 claim/message FK에 의존한다. `amora_tool_executions`는 claim FK가 없어 명시 정리와 지연 재생성 차단이 필요하다. AI log `message_id`도 soft link이므로 private 원문 FK 삭제만으로 운영 로그가 사라지지 않는다. `vendors.owner_id`는 의도된 RESTRICT로 자동 삭제를 중단한다.

## 새 SQL 계약과 재시도

`20260913103407_account_deletion_customer_data_boundary.sql`은 다음 경계를 추가한다.

1. `prepare_account_deletion_customer_data(job_id, claim_token) -> boolean`: 정확 claim의 deleting/auth_deleting 상태만 처리한다. `false`는 binding/state 불일치, `ACCOUNT_DELETE_CUSTOMER_SCOPE_REVIEW_REQUIRED`는 grace/quarantine/vendor/불명확 provenance/Auth 부재+영수증 부재이다. 일반 SQL 오류를 성공으로 바꾸지 않는다.
2. user별 account-data exclusive 잠금 → membership/profile/couple 확인 → claim row 잠금 → private scope 잠금 순으로 한 DB 트랜잭션에서 정리한다. 완료 시 `data_prepared_at`와 version 1을 함께 기록한다. 어느 SQL 단계가 실패해도 삭제와 영수증이 같이 rollback된다.
3. `account_deletion_private_scopes`는 퇴장 lane을 영구 차단하고 `account_deletion_retired_requests`는 요청 키의 SHA256으로 claim 삭제 후 늦은 tool 결과를 차단한다. 두 표는 서비스 읽기만 가능하며 일반 API 역할의 쓰기/RPC 접근은 없다. 원문·직접 user ID를 담지 않지만 couple/job과 연결된 가명 정보이며 익명 자료가 아니다.
4. 정상 writer끼리는 shared advisory lock을 공유한다. prep가 exclusive를 가진 동안 writer는 기다리지 않고 55P03으로 종료해 claim 잠금 역순 교착을 피한다. active job/retired lane의 subject 쓰기만 막으며 파트너 private와 정상 공유 쓰기를 유지한다. 실제 변경되는 membership slot만 Auth cascade 예외를 받으므로 두 멤버가 동시에 삭제 신청해도 서로의 Auth FK 처리를 막지 않는다.
5. memory queue의 동일 source bookkeeping UPDATE는 허용한다. `claim_amora_memory_job`은 삭제 대기 owner/retired lane를 후보에서 제외해 다른 고객 queue 진행이 막히지 않게 한다. ID-only dead-letter는 기존 claim/message FK가 재삽입을 제한하므로 불필요한 전역 writer fence를 추가하지 않는다.
6. 기존 `prepare_account_deletion_auth_delete`와 새 Auth BEFORE DELETE trigger는 active job의 data receipt 및 Storage 검증을 강제한다. Auth가 사라진 재시도는 기존 exact job receipt가 있어야 한다. `Auth 없음`만 보고 개인 데이터 정리를 완료로 추정하지 않는다. 활성 deletion job 없는 관리자 생성 실패 rollback은 기존 경로를 유지한다.

기억과 예산의 원자적 저장 경계도 확인했다. `20260716090000_amora_memory_engine_v2.sql`의 최신 `commit_amora_memory_job`은 decision node upsert 뒤 같은 트랜잭션에서 subject `user_id`로 summary를 저장하므로, 새 summary guard가 삭제 중 subject를 거절하면 앞선 기억 upsert도 함께 rollback된다. 예산은 `20260911080244_amora_budget_plan_explicit_allocations.sql`의 `apply_amora_atomic_tool_execution_pre_shared_revision`에서 도메인 변경 뒤 같은 트랜잭션으로 tool ledger를 갱신하며, `20260730102000_amora_shared_action_approval_and_notifications.sql`의 바깥 함수는 오류를 다시 던진다. 따라서 새 ledger guard가 실패한 요청을 예산만 일부 저장된 성공으로 바꾸는 경로는 확인되지 않았다. 이는 현재 함수 원문과 후속 재정의 검색에 근거한 코드 검토이며 운영 요청 실행 결과는 아니다.

## 검증과 제한

- 최종 SQL `f18bac2cb2361390364b85fb8e74e4f503b656dc0b65bc8970b5ae5a3e42f1c8`의 PGlite 의미 회귀 **22개 PASS**: 신랑/신부 양방향, private AI와 수동 결정·복사 notes·claim/tool purge, 공유/파트너/예산/일정/체크리스트 보존, wrong claim, quarantine/grace/vendor/혼합 legacy 중단, 트랜잭션 rollback, Auth 삭제 후 receipt 재시도, NULL receipt pair, 실제 greeting/lifecycle/mediation key, retired system-request 지연 쓰기, 두 active 삭제 job, 전역 healthy queue, 연결 전 계정, 과거 couple의 subject-linked shared summary를 지우지 않고 scope review로 중단하는 경계. 파일: `apps/web/src/lib/accountDeletion/customerDataBoundary.schema.test.ts`.
- 기존 private hard-delete 및 9/2 roster 함수와 8/2 privacy epoch 함수·trigger를 함께 실행했다. fixture는 필요한 실제 관계를 모델링하며 전체 231 migration/hosted Auth 검사가 아니다.
- 영구 native PostgreSQL **17.10** 회귀 **1개 PASS(5경계)**: 같은 사용자 normal private/shared 동시 쓰기, 실제 prep 대기, 삭제 중 late actor 거절과 파트너 쓰기 보존, claim→prep 역순 교착 회피, frozen/expired queue와 healthy candidate 공존. 파일: `scripts/tests/account-deletion-customer-data-concurrency.test.mjs`. 최종 공통 factory를 사용하는 루트 `test:repo`에서도 이 회귀의 PASS를 확인했다. 원격/고객 데이터 0, 임시 PG 정상 종료.
- 공통 합성 fixture는 `scripts/tests/fixtures/account-deletion-customer-data-database.mjs`이며 PGlite와 native가 함께 사용한다. 앞선 외부 `avatar-delivery-20260913/customer-data-boundary-native.test.mjs`와 `customer-data-boundary-native-receipt.json`은 역사 증거로 보존한다. SQL/test source ESLint 및 diff 공백 검사 PASS. 전체 통합 gate/DDL 배포/실제 support 삭제는 루트의 별도 릴리스 검증 대상이다.

232 최초 expand adapter는 이번 운영 metadata 관측에서 확인된 `account_deletion_jobs` 전체 0건 상태만 허용한다. active job만 제외하는 조건이 아니며, 완료 이력도 포함해 새 기록이 생기면 원격 직전 재관측과 DB 트랜잭션 검증에서 중단한다. 기존 completed 감사 기록을 삭제하거나 조건을 완화해 통과시키지 않는다. 이 제한은 고객 데이터 purge 또는 전체 운영 보존 정책의 완료를 뜻하지 않는다.

Supabase 함수의 search_path/기본 PUBLIC 실행 권한 지침: [Database Functions](https://supabase.com/docs/guides/database/functions). 공식 changelog도 읽었으며 이 일반 PostgreSQL 함수/RLS 작업에 해당하는 새 breaking change는 확인하지 못했다. 정책 advisor는 운영 DB에 실행하지 않았다.
