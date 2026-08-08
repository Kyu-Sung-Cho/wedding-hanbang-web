# 아모라 중립 커플 member 모델 전환 제안

- 상태: **PROPOSED — 구현되지 않음**
- 작성일: 2026-08-02
- 장기 기능 플래그: **모두 OFF가 기본값**
- 대상: 성별·성정체성 조합과 관계없이 연결할 수 있는 **정확히 2인의 파트너**
- 비대상: 3인 이상 관계, 법적 혼인 가능 여부 판단, 가족관계·성별·호칭의 자동 추론

이 문서는 현재 `bride/groom` 고정 모델을 안전하게 중립 `member` 모델로 옮기기 위한 설계 제안이다. 문서에 적힌 테이블, RPC, 플래그, 전환 단계는 현재 제품에 반영된 기능이 아니다. 실제 구현은 별도 migration, 코드 변경, 검증, 승인 과정을 거쳐야 한다.

## 1. 결론

UI 문구의 `신부/신랑`을 `파트너 1/2`로 바꾸는 것만으로는 포용적인 제품이 되지 않는다. 현재 역할 값은 커플 membership, private 대화, 승인 roster, 중재, 의사결정 출처, payer, 예약과 레거시 기능에 연결되어 있다. 따라서 다음 세 가지 깊은 Module을 먼저 만들어 역할 문자열의 의미를 한곳에 모아야 한다.

1. **Couple Roster Module**: 현재 사용자, 파트너, member 수, roster version/digest를 하나의 작은 Interface로 제공한다.
2. **Private Scope Module**: `shared` 또는 특정 `member` 소유 private 범위를 판정한다.
3. **Financial Attribution Module**: 비용 부담 주체를 member와 사용자 입력 기준으로 표현하고 기존 payer enum을 Adapter로만 다룬다.

이 구조는 성별 조건문을 여러 화면과 RPC에 반복하는 대신, 복잡한 호환·보안 구현을 작은 Interface 뒤에 숨인다. 가장 중요한 전환 기준은 포용적인 표현 자체가 아니라 기존 privacy roster epoch, no-refill, 정확한 2인 승인 불변식을 약화하지 않는 것이다.

## 2. 이번 감사에서 직접 확인한 현재 상태

아래는 2026-08-02 로컬 작업 트리에서 확인한 사실이다.

- `couples`는 `bride_id`, `groom_id` 두 slot을 사용한다.
- `profiles.role`과 다수 TypeScript 타입은 `bride | groom`을 요구한다.
- `chat_messages.sender_type`과 private visibility는 역할 문자열을 사용한다.
- 현재 roster 보호는 `membership_sealed_at`, profile↔slot 양방향 일치, 봉인 뒤 빈 slot 재사용 금지에 의존한다.
- shared action과 couple plan change는 정확한 roster fingerprint와 서로 다른 두 사람의 승인을 사용한다.
- mediation은 같은 proposal/version/roster에서 두 사람이 각각 수락한 뒤에만 `decision_nodes`에 공유 결정을 기록한다.
- `conversation_segments`는 private lane의 `owner_user_id`를 갖지만, visibility는 여전히 `bride_private | groom_private`다.
- payer는 `couple | bride_parents | groom_parents | both_parents`다.
- 일정 assignee 자체는 profile ID 기반으로 중립적이지만 일부 서버 요약 문구가 `예비 신부/예비 신랑`으로 다시 변환한다.
- 웹과 모바일 온보딩은 신부/신랑 중 하나를 필수로 선택한다.

대표 기준 파일과 migration:

- `PRINCIPLES.md`
- `supabase/migrations/20260716094000_couple_roster_epoch.sql`
- `supabase/migrations/20260716114000_current_couple_membership_privacy_fence.sql`
- `supabase/migrations/20260731173000_private_chat_hard_delete_boundary.sql`
- `supabase/migrations/20260731123000_couple_plan_change_write_boundary.sql`
- `supabase/migrations/20260802170000_amora_shared_action_roster_binding.sql`
- `supabase/migrations/20260802210000_amora_conversation_segment_roster_repair.sql`
- `apps/web/src/types/database.types.ts`
- `apps/web/src/components/onboarding/RoleSelection.tsx`
- `apps/mobile/app/onboarding/index.tsx`

## 3. 제품 범위와 표현 원칙

### 3.1 이번 전환이 보장하려는 것

- 두 파트너가 성별이나 신부/신랑 역할을 입력하지 않고 커플을 만들고 연결할 수 있다.
- 제품은 이름, `나`, `파트너`를 사용하며 성별·호칭을 추론하지 않는다.
- private 대화는 역할이 아니라 stable member ID에 귀속된다.
- 공유 변경은 현재 roster의 서로 다른 두 member가 확인해야 한다.
- 한 사람이 나간 뒤 남은 사람이 새 파트너로 slot을 채울 수 없다는 현재 privacy epoch 규칙을 유지한다.
- AI 호출은 계속 `ai_interactions_log`에, 커플 의사결정은 계속 `decision_nodes`에 기록한다.

### 3.2 보장하지 않는 것

- 3인 이상 관계 지원
- 심리·관계 적합성, 결혼 성공, 법적 자격 판단
- 성별, 대명사, 가족관계, 부모 호칭 자동 결정
- 기존 앱이 neutral couple을 잘못된 신부/신랑 호칭으로 표시해도 괜찮다는 하위 호환

`모든 커플을 지원한다`는 문구는 이 범위만으로 사용할 수 없다. 출시 표현은 `성별 역할 선택 없이 두 파트너가 연결 가능`처럼 검증 가능한 범위로 제한한다.

## 4. 절대 약화하면 안 되는 불변식

| 불변식 | 전환 뒤 요구사항 |
|---|---|
| 현재 member 판정 | profile과 couple roster가 같은 membership을 가리킬 때만 허용 |
| 최대 인원 | active member 최대 2명 |
| no-refill | 한 번 사용된 couple slot은 탈퇴 뒤에도 다른 사람이 사용할 수 없음 |
| roster 봉인 | 처음 두 사람이 연결된 시점은 변경 불가 |
| private lane | shared와 본인 private만 읽기·쓰기 가능, 파트너 private는 거부 |
| direct message | 송신자와 정확한 상대 member만 접근 가능 |
| shared approval | active member가 2명이면 서로 다른 2인의 확인 필요 |
| stale 방지 | roster, revision, proposal digest가 바뀌면 이전 확인은 재사용 불가 |
| mediation | 두 member의 명시적 수락 뒤 정확히 한 번만 공유 결정 기록 |
| private hard delete | 본인 lane만 삭제하고 shared·파트너 lane은 보존 |
| AI/decision audit | 모든 AI 호출과 모든 확정 의사결정의 기존 기록 원칙 유지 |

중요한 세부 규칙: 2인 roster에서 만들어진 proposal은 한 명이 탈퇴했다고 1인 승인으로 자동 축소하지 않는다. 기존 proposal은 stale 처리하고, 새 roster에서 새 proposal을 만들어야 한다.

## 5. 목표 데이터 모델

### 5.1 새 `couple_members` 테이블

권장 필드:

| 필드 | 의미 |
|---|---|
| `id uuid` | stable member ID. private owner와 decision actor의 기준 |
| `couple_id uuid` | 소속 couple |
| `profile_id uuid null` | active 시 사용자 profile. 계정 삭제 정책에 따라 null 가능 |
| `slot_no smallint` | 1 또는 2. 내부 topology일 뿐 사용자 정체성이나 표시 순서가 아님 |
| `status text` | `active | left` |
| `joined_at timestamptz null` | 실제 시각을 아는 신규 membership에만 기록 |
| `left_at timestamptz null` | 탈퇴 또는 계정 삭제 시 기록 |
| `provenance text` | `current_write`, `legacy_slot_backfill` 등 생성 근거 |
| `recorded_at timestamptz` | 이 행을 기록한 시각. `joined_at`과 혼동하지 않음 |

필수 제약:

- `(couple_id, slot_no)`는 전체 이력에서 unique다. `left` 뒤에도 slot 재사용을 금지한다.
- active `profile_id`는 모든 couple에서 unique다.
- 같은 couple에 row는 최대 2개다.
- 상태 전이는 `active -> left` 단방향이다. 같은 row를 재활성화하지 않는다.
- roster mutation은 client table write가 아니라 server-owned RPC만 허용한다.
- profile 삭제 뒤에도 non-identifying member ID와 slot epoch는 남기되, 개인정보 보존·삭제 정책과 함께 결정한다.

### 5.2 `couples` 확장

제안 필드:

- `member_model_version smallint not null default 1`
- `roster_version bigint not null default 0`

`roster_version`은 join, leave, account deletion처럼 접근권한을 바꾸는 사건마다 같은 transaction에서 증가한다. 기존 `membership_sealed_at`은 유지하고, 최초 2인 roster가 완성될 때만 설정한다.

### 5.3 versioned roster digest

기존 md5·role-ordered fingerprint를 조용히 재해석하지 않는다. v2에는 다음 canonical payload를 SHA-256으로 digest한다.

```text
{
  schemaVersion: 2,
  coupleId,
  rosterVersion,
  members: [{ memberId, profileId, slotNo }] // slotNo 오름차순
}
```

승인·receipt 테이블에는 `roster_schema_version`, `roster_version`, `roster_member_ids`, `roster_digest_v2`를 추가한다. 기존 v1 컬럼은 pending request와 감사 이력을 위해 유지한다.

## 6. Roster Module과 RPC 전환

### 6.1 목표 Interface

서버·웹·모바일은 role 조건을 직접 만들지 않고 다음 의미만 요청한다.

- 현재 인증 사용자의 active member 조회
- couple의 active members 조회
- 상대 member 조회
- active member 수와 required approval count 조회
- current roster version/digest 조회
- current member인지 검증

DB helper와 TypeScript Adapter가 같은 용어를 사용해야 한다. `slot_no`는 Implementation 안에 숨기고 화면에 노출하지 않는다.

### 6.2 신규 RPC

- `create_couple_for_current_user_v2()`
- `join_couple_v2(p_invite_code text)`
- `leave_current_couple_v2()` 또는 기존 reset 의미를 명확히 한 동등 RPC
- account deletion에서 호출할 동일 roster mutation core

v2 create/join은 성별 인자를 받지 않는다. 첫 member가 slot 1, 초대받은 member가 남은 slot을 차지한다.

### 6.3 레거시 Adapter

기존 RPC는 즉시 삭제하지 않는다.

- `create_couple_for_current_user(p_role)`
- `join_couple(p_invite_code, p_role)`
- `reset_current_couple_membership()`

레거시 RPC와 v2 RPC는 하나의 transactional core Implementation을 호출한다. 별도의 앱 요청 두 번으로 신·구 테이블을 쓰지 않는다. DB가 normalized member row와 기존 `couples.bride_id/groom_id`, `profiles.role` mirror를 같은 transaction에서 dual-write한다.

v2 couple에서 legacy mirror의 bride/groom 값은 **호환 slot alias**일 뿐 실제 성별이 아니다. 따라서 오래된 클라이언트가 이 값을 사용자 호칭으로 표시하게 두면 안 된다. neutral onboarding을 켜기 전에 다음 중 하나가 필요하다.

- old client를 minimum supported version 아래로 차단하거나,
- `member_model_version = 2` couple에 대해 old client가 명확한 업데이트 화면만 보도록 한다.

### 6.4 동시성

create, join, leave/reset, account deletion의 lock 순서를 한 번에 통일한다.

1. 사용자 profile lock
2. couple advisory/row lock
3. active roster와 slot 검증
4. normalized write와 legacy mirror write
5. `roster_version` 증가와 관련 stale 처리

동시 join에서는 정확히 한 요청만 성공해야 하며, lock 순서가 다른 이전 RPC가 남아 deadlock을 만들지 않도록 모두 같은 core로 이동한다.

## 7. RLS와 private lane 전환

### 7.1 신규 helper

- `is_current_couple_member_v2(p_user_id, p_couple_id)`
- `current_couple_member_id(p_user_id, p_couple_id)`
- `can_access_couple_scope(p_user_id, p_couple_id, p_scope_kind, p_owner_member_id)`

`scope_kind`는 `shared | private`만 사용하고 private일 때 `owner_member_id`를 필수로 한다. helper는 `auth.uid()`와 active normalized roster를 대조한다. SECURITY DEFINER를 사용할 경우 고정 `search_path`, 명시적 revoke/grant, 입력 검증을 기존 보안 패턴과 동일하게 적용한다.

mixed row 판정:

- v2 owner가 있으면 v2 판정이 우선한다.
- v2 owner가 없고 historical legacy row일 때만 기존 visibility Adapter를 사용한다.
- v2와 legacy 값이 동시에 존재하면서 서로 모순되면 fail closed한다.

### 7.2 private scope를 추가할 테이블

다음 테이블에 `scope_kind`, `owner_member_id`를 추가한다.

- `chat_messages`
- `chat_summaries`
- `conversation_segments`
- `decision_nodes`
- `amora_couple_profiles`
- `amora_memory_settings`
- `amora_memory_consents`
- `amora_memory_jobs`
- `amora_chat_request_claims`
- `amora_private_chat_delete_boundaries`

추가 attribution:

- `chat_messages.sender_member_id`
- direct message가 있으면 `recipient_member_id`
- `decision_nodes.source_member_id`
- `conversation_segments.owner_member_id`는 생성 뒤 불변

기존 `visibility`, `sender_type`, `source_actor_role`, `owner_user_id`는 호환·감사를 위해 유지한다. 신규 write는 양쪽을 채우고, read cutover 전에는 기존 경로가 계속 source of truth다.

### 7.3 private hard delete와 background job

- hard delete는 `owner_member_id`로 본인 private lane만 선택한다.
- partner/private와 shared row가 하나라도 삭제되면 transaction을 실패시킨다.
- delete boundary도 `(couple_id, owner_member_id)`를 canonical key로 사용한다.
- 오래된 memory job, claim, summary worker는 roster version과 owner member가 맞지 않으면 결과를 쓰지 못한다.
- 기존 conversation segment read flag는 parity 검증 전까지 계속 OFF다.

## 8. 승인, 중재, 의사결정

### 8.1 승인 대상 테이블

v2 roster binding을 dual-write해야 하는 대상:

- `amora_shared_action_roster_bindings`
- `amora_shared_action_acceptances`
- `amora_shared_action_application_claims`
- `amora_shared_action_journey_mutation_receipts`
- `couple_plan_change_requests`
- `couple_plan_change_acceptances`
- `couple_change_notifications`
- booking cancellation·schedule decision 관련 receipt와 acceptance 테이블

규칙:

- active member 2명: 서로 다른 `member_id` 2개가 필요하다.
- active member 1명: 새 proposal은 1명 확인으로 가능하다.
- request 생성 당시의 required count, roster version/digest, proposal digest를 고정한다.
- 어떤 값이든 바뀌면 stale 처리한다.
- v1 pending request는 v1 규칙으로 만료 시점까지 동작하고, 신규 request는 v1+v2를 dual-populate한다.
- lost response retry는 기존 exact replay receipt를 유지한다.

### 8.2 mediation

`amora_mediation_acceptances`에 `member_id`, v2 roster version/digest를 추가한다. 같은 proposal version과 같은 roster에서 서로 다른 두 member가 수락해야 하며, 그 뒤에만 `decision_nodes`에 conflict resolution을 정확히 한 번 기록한다. roster가 바뀌면 기존 acceptance와 파생 decision을 현재 정책처럼 무효화한다.

### 8.3 `decision_nodes`와 AI

- 신규 decision은 `source_member_id`를 canonical actor로 쓴다.
- private decision은 `owner_member_id`를 갖는다.
- 기존 role 기반 unique index와 충돌하지 않는 v2 unique index를 먼저 만들고 검증한 뒤 read를 전환한다.
- 일정 assignee 요약은 profile ID에 연결된 사용자가 정한 이름 또는 중립 `파트너`를 사용한다. `예비 신부/예비 신랑`으로 되돌리지 않는다.
- AI context는 role map이 아니라 ordered roster와 안전한 display name을 전달한다.
- AI는 성별, 책임감, 갈등 성향을 slot에서 추론하지 않는다.
- 모든 AI 호출의 `ai_interactions_log` 기록과 모든 확정 결정의 `decision_nodes` 기록을 회귀 테스트한다.

## 9. payer와 레거시 도메인

### 9.1 neutral payer descriptor

`wedding_journeys.progress`의 각 항목에 기존 `payer`와 함께 다음 `payer_v2`를 추가한다.

```ts
type PayerV2 =
  | { kind: "couple" }
  | { kind: "member_family"; memberId: string }
  | { kind: "families"; memberIds: [string, string] }
  | { kind: "other"; label: string };
```

- `member_family`는 사용자가 명시적으로 선택한 member 측 가족이라는 뜻이다.
- `families`는 정확한 두 member ID를 갖는다.
- `other.label`은 사용자 입력이며 AI나 slot이 만들지 않는다.
- UI는 `payer_v2`를 먼저 읽고 profile name으로 표시한다.
- 구형 client write가 `payer_v2`를 지우지 않도록 서버 canonical merge를 사용한다.
- legacy mapping은 내부 Adapter에서만 수행한다: slot 1 family ↔ `bride_parents`, slot 2 family ↔ `groom_parents`.
- shared approval 요약도 신부/신랑이 아니라 display name 또는 `파트너`를 사용한다.

`wedding_payment_ledger`는 payer 필드가 없으므로 neutral membership helper 전환이 주 작업이다.

### 9.2 별도 inventory가 필요한 레거시 표면

현재 MVP navigation에서 숨겨졌더라도 다음 role 필드는 cleanup 전에 모두 Adapter 또는 neutral 구조로 옮겨야 한다.

- `congratulatory_money.side = bride | groom | both`
- invitation account/RSVP의 side
- invitations의 bride/groom/father/mother name
- `vendor_bookings`의 bride/groom name
- booking cancellation receipt의 bride/groom roster snapshot
- guestbook의 bride/groom name
- preregistration role
- admin export, CSV header, 운영자 검색·필터

권장 방향은 neutral party/member reference 또는 사용자 정의 label을 함께 추가하고, 기존 컬럼은 구형 Adapter와 감사용으로만 남기는 것이다.

## 10. 온보딩과 표시 문구

### 10.1 v2 onboarding

1. 역할 질문 없이 `새 커플 시작` 또는 `초대코드로 연결`을 선택한다.
2. 첫 사용자는 v2 create RPC를 호출한다.
3. 파트너는 v2 join RPC를 호출한다.
4. 이후 기본 표시는 `나`, 상대의 profile display name, 또는 `파트너`다.
5. 성별·대명사·가족 호칭은 제품 기능에 필요하고 사용자가 직접 설정할 때만 별도 선택값으로 받는다.

`파트너 1/2`를 identity label로 표시하지 않는다. slot은 내부 topology이며 사용자가 우열이나 고정 역할로 받아들일 수 있다.

### 10.2 단기 truthful-launch 조치

neutral member backend가 준비되기 전에는 가짜 중립 역할 옵션을 추가하지 않는다. 로컬 작업 트리에는 다음 실제 제약 문구를 역할 선택과 베타 신청 인접 위치에 표시하는 변경이 있다. 아직 배포 사실을 뜻하지 않는다.

> 현재 베타 커플 연결은 신부 1명·신랑 1명 구성부터 지원해요.

> 다양한 커플 형태도 개인정보와 대화 기록을 안전하게 지킬 수 있는 구조로 준비하고 있어요.

공개 랜딩 전체를 이 메시지로 덮지 않고, 실제 역할 선택·베타 조건·신청 폼에만 배치한다.

## 11. zero-downtime rollout

### Phase 0 — truthful launch

- 위 제한 문구를 웹·모바일 역할 선택과 베타 신청에 표시한다.
- neutral 역할 선택은 제공하지 않는다.
- 장기 feature flag는 모두 OFF다.

### Phase 1 — contract 고정

- 정확히 2인 scope와 용어집을 ADR/PRD로 승인한다.
- roster, private scope, approval, payer v2 contract를 테스트로 먼저 고정한다.
- old client minimum version 전략을 결정한다.

### Phase 2 — expand only

- `couple_members`, `member_model_version`, `roster_version`을 추가한다.
- 관련 테이블에 nullable v2 컬럼을 추가한다.
- 기존 column, policy, RPC, index를 삭제하거나 재해석하지 않는다.
- 빈 테이블 index를 먼저 만들고, 가능한 constraint는 `NOT VALID` 후 검증한다.

### Phase 3 — preflight와 backfill

- 오염 데이터를 먼저 탐지하고 fail한다.
- legacy bride slot → slot 1, groom slot → slot 2로 provenance와 함께 backfill한다.
- old/new parity를 row count와 digest로 검증한다.
- 실제 가입 시각을 모르면 `joined_at`을 migration 시각으로 꾸미지 않는다.

### Phase 4 — DB-owned dual-write

- 모든 membership mutation을 하나의 core RPC로 이동한다.
- old/new RPC Adapter를 동시에 제공한다.
- normalized row와 legacy mirror를 같은 transaction에서 기록한다.
- 기존 trigger와 side effect가 이중 실행되지 않게 한 경로만 canonical mutation을 수행한다.

### Phase 5 — shadow read

- production response는 여전히 legacy read를 사용한다.
- shadow에서 v2 결과를 계산하고 ID를 로그에 남기지 않은 parity metric만 기록한다.
- mismatch, missing owner, digest 차이가 0이 될 때까지 cutover하지 않는다.

### Phase 6 — privacy·approval·payer dual data

- private owner, decision actor, approval roster, payer v2를 신규 write에 필수로 채운다.
- historical legacy row는 명시적 fallback으로만 읽는다.
- RLS adversarial test와 mixed-client test를 통과한다.

### Phase 7 — read와 onboarding cutover

- server read를 먼저 v2로 전환한다.
- 그 뒤 web과 mobile neutral onboarding을 함께 배포한다.
- old client version gate를 켠다.
- private scope read와 conversation segment read는 각각 독립적으로 검증 후 켠다.

### Phase 8 — cleanup

- 지원 client sunset, pending v1 request TTL, 운영 rollback window가 모두 끝난 뒤 수행한다.
- legacy role 컬럼은 감사·복구 목적상 더 오래 유지할 수 있다.
- 실제 column drop 전 백업 복원 rehearsal과 별도 승인 절차가 필요하다.

## 12. backfill preflight와 데이터 원칙

다음 중 하나라도 발견되면 자동 보정하지 말고 migration을 중단한다.

- 같은 사용자가 bride와 groom slot을 모두 차지함
- 동일 사용자가 여러 active couple slot에 존재함
- `profiles.couple_id/role`과 couple slot 불일치
- active private segment owner와 slot 불일치
- pending approval fingerprint와 현재 roster 불일치
- sealed couple의 비어 있는 slot에 이후 다른 사용자가 들어간 흔적

backfill 원칙:

- bride → slot 1, groom → slot 2 mapping은 호환 topology일 뿐 성별 진실로 재사용하지 않는다.
- `provenance = legacy_slot_backfill`을 남긴다.
- `recorded_at`과 실제 `joined_at`을 구분한다.
- 과거 탈퇴 member는 message sender 등 명시적이고 지속 가능한 증거가 있을 때만 재구성한다.
- 증거가 없는 historical private row의 owner를 추측하지 않는다. legacy fallback을 유지한다.
- migration은 재실행 가능하고 idempotent해야 한다.
- parity telemetry에는 user/profile/member ID나 대화 내용을 넣지 않는다.

## 13. proposed feature flags

아래 이름과 동작은 제안이며 현재 구현되지 않았다. 초기값은 모두 OFF 또는 legacy다.

| 플래그 | 초기값 | 의미 |
|---|---|---|
| `COUPLE_MEMBER_MODEL_MODE` | `legacy` | `legacy | shadow | enabled` server read mode |
| `COUPLE_MEMBER_ONBOARDING_ENABLED` | `false` | neutral create/join 노출 |
| `AMORA_MEMBER_PRIVATE_SCOPE_READ_ENABLED` | `false` | member-owned private read cutover |
| 기존 `AMORA_CONVERSATION_SEGMENT_READ_ENABLED` | `false` 유지 | segment read cutover |

원칙:

- unset·invalid 값은 fail closed하여 `legacy/false`로 동작한다.
- capability는 server가 `/api/auth/me` 또는 별도 runtime contract로 web/mobile에 제공한다.
- DB dual-write는 migration이 적용된 뒤 앱 환경변수로 끌 수 없게 한다. 한쪽 write만 꺼지는 split-brain을 막기 위해서다.
- neutral onboarding은 backend, web, mobile, old-client gate가 모두 준비되기 전 켜지 않는다.

## 14. rollback

destructive cleanup 전 rollback은 데이터 삭제가 아니라 read 경로 복귀다.

1. `COUPLE_MEMBER_ONBOARDING_ENABLED=false`
2. old-client/update gate 유지
3. `AMORA_MEMBER_PRIVATE_SCOPE_READ_ENABLED=false`
4. `COUPLE_MEMBER_MODEL_MODE=legacy`
5. DB dual-write는 유지해 추가 divergence를 막음
6. write fence 아래 clone에서 parity mismatch 원인을 조사하고 reconcile

새 row나 v2 컬럼을 자동 삭제하지 않는다. legacy columns, v1 fingerprints, pending receipts를 rollback window 동안 유지한다. Phase 8의 destructive cleanup 뒤에는 일반 flag rollback이 불가능하므로, 그 전에 hosted backup restore rehearsal과 명시적 승인 증거가 필요하다.

## 15. 정확한 영향 목록

### DB/RPC/RLS

- `couples`, `profiles`, 신규 `couple_members`
- create/join/reset/leave/account deletion membership RPC
- `is_current_couple_member`, `can_access_couple_visibility`, profile/path membership helper와 모든 의존 RLS
- `chat_messages`, `chat_summaries`, `conversation_segments`
- private delete boundary와 memory/profile/settings/consent/job/request claim
- `decision_nodes`, decision edge·projection·receipt 경로
- shared action roster bindings/acceptances/claims/receipts
- couple plan change requests/acceptances/notifications
- mediation acceptance와 conflict resolution write
- schedule decision receipt와 manual schedule summary
- booking creation/cancellation/receipt
- payer validation/canonical merge
- invitation, money, guestbook, preregistration의 레거시 role/side/name 경로

### 웹

- DB·chat·onboarding·money 타입
- onboarding page, RoleSelection, couple link/reset/settings
- `/api/auth/me`, onboarding, couple code/link/reset
- chat route/store/bubble/panel/private delete/memory/mediation/today-one
- journey, budget payer, payment support, schedule approval
- booking/admin/CSV/legacy money 화면
- AI profile projection, prompt compiler, mediation, booking/schedule tools
- community avatar와 role 기반 표시

### 모바일

- onboarding create/join
- chat role/visibility/partner query
- profile/settings role display
- memory privacy scope
- budget payer
- community avatar
- runtime capability와 minimum version gate
- web/mobile realtime mixed-version contract

## 16. 테스트 매트릭스

### DB membership

- 성별 값을 입력하지 않은 두 사용자가 create/join 성공
- 기존 bride/groom 커플 backfill parity
- old→old, old→new, new→old, new→new client 조합
- 동시 join에서 한 요청만 성공
- 같은 profile의 두 couple active membership 거부
- 한 couple 3번째 member 거부
- sealed slot leave 뒤 refill 거부
- create/join/leave/account-delete race와 deadlock 부재
- migration 재실행 idempotency

### RLS/private

- 각 member는 shared와 자기 private만 접근
- partner private, non-member, former member는 거부
- v2 row, historical legacy row, mixed row 각각 검증
- v2/legacy contradiction fail closed
- direct message는 정확한 두 member만 접근
- optional memory/insight/booking/invitation 테이블도 같은 helper 사용
- hard delete는 자기 private만 삭제하고 shared/partner는 보존
- roster가 바뀐 stale worker 결과 write 거부

### approval/mediation

- 2 active member면 서로 다른 2인 승인
- 1 active member가 새로 만든 proposal은 1인 승인
- 2인 proposal 생성 뒤 탈퇴 시 stale이며 1인으로 축소되지 않음
- roster/revision/proposal digest 변경 시 stale
- v1 pending request가 만료 전 기존 규칙으로 동작
- v2 digest mismatch 거부
- retry/lost response exact replay
- mediation 두 수락과 `decision_nodes` 정확히 한 번 기록

### decision/AI

- `source_member_id`와 private owner 보존
- slot에서 성별·성향·책임 추론 금지
- 일정·예산 승인 요약에 신부/신랑 자동 label 없음
- 모든 AI 호출 로그와 모든 확정 decision node 기록

### payer

- couple, 각 member family, both families, other round-trip
- old client update가 `payer_v2`를 유실하지 않음
- legacy enum↔slot Adapter 정확성
- 승인 preview와 적용 결과가 같은 neutral label 사용

### web/mobile UX

- neutral onboarding에서 role 입력 없음
- `나`, profile name, `파트너` 표시
- fake neutral option이 legacy mode에 노출되지 않음
- v2 couple을 old client가 잘못된 신부/신랑으로 표시하지 않고 update gate 처리
- mixed version, logout/login, realtime reconnect
- 스크린리더가 제한 문구와 선택 상태를 읽음
- 역할 선택·베타 조건의 truthful copy 계약

### 운영

- clone/staging migration과 parity report
- backup 생성·복원 rehearsal
- flag rollback rehearsal
- hosted RLS adversarial probe
- 실제 web browser와 iOS/Android device QA

## 17. Definition of Done

다음이 모두 충족되기 전 neutral member 지원을 출시 완료라고 말하지 않는다.

- [ ] 두 파트너가 성별 역할을 입력하지 않고 create/join 가능
- [ ] current legacy↔v2 roster parity mismatch 0
- [ ] 신규 private row 중 `owner_member_id` 누락 0
- [ ] roster epoch, seal, no-refill 회귀 테스트 통과
- [ ] 2인 high-impact action과 mediation의 서로 다른 2인 승인 통과
- [ ] partner private 접근 adversarial RLS 테스트 전부 거부
- [ ] private hard delete가 partner/shared를 보존
- [ ] UI와 AI가 legacy slot에서 성별·호칭을 추론하지 않음
- [ ] payer v2가 web/mobile/API에서 무손실 round-trip
- [ ] 모든 AI interaction log와 모든 확정 decision node 기록 검증
- [ ] old client minimum version/update gate 검증
- [ ] mixed-client와 realtime 회귀 검증
- [ ] backup restore와 flag rollback rehearsal 증거 확보
- [ ] web/mobile 접근성·실기기·브라우저 QA 통과
- [ ] 공개 카피가 실제 활성 capability와 일치

## 18. 현재 작업 범위의 검증 경계

이 문서를 작성한 작업에서는 production/staging 접속, browser QA, hosted Supabase migration, 배포, commit을 수행하지 않는다. 로컬 카피와 계약 테스트 변경만 구현하며, neutral schema/RPC/RLS/feature flag는 이 문서의 proposed 설계로 남긴다.
