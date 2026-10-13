# Amora 최소 writer cutover — 로컬 후보 검증

## 상태와 범위

- 작업 트리: `C:/Users/kcho1/.codex/worktrees/amora-safe-release-20261012/wedding`.
- 이 문서는 운영 DB 적용·배포·전체 writer CAS 완료 선언이 아니다.
- 생성한 파일은 이 별도 후보 폴더의 `cutover*` 5개뿐이다. 앱·controller·migration ledger·기존 HOLD는 수정하지 않았다.
- 선행 v2 원본 SQL `e31372d192a0215d4ddf280a99abb628e7a8f732ebc02cb0b7e55fed1373730d` 및 원본 테스트/fixture/native 3개를 변경하지 않았다. fixture가 실제 v2 SQL SHA를 확인한 뒤 사용한다.
- 부모가 승인한 A: 구 public 무버전 수정 retirement + 최소 canonical INSERT identity guard. 새로운 AI update 승인·revision bridge·private stamp는 추가하지 않는다.

## 비교한 설계

1. A — 기존 create RPC는 보존하고 update만 55000으로 거절한다. 구 legacy updater를 retirement한다. canonical BEFORE INSERT가 v2와 같은 identity lock을 즉시 시도하고 현재 journey를 확인한다. 변경량과 호환 영향이 작고, API의 requestId 중복 23505를 보존한다.
2. B — 전용 create RPC와 모든 privileged writer의 공동 새 계약을 만든다. 구조는 더 일관될 수 있지만 POST·AI dispatcher·승인/재전송·릴리스 범위가 커진다. 이번 승인 범위가 아니므로 구현하지 않았다.

P1 데이터 무결성·P3 명시 승인·P6 작은 출시 단위에 따라 A부터 검증했다. A만으로 전체 service-role writer 보호를 주장하지 않는다.

## 이번 변경

- `mutate_own_amora_action(uuid,text,text,jsonb)`는 기존 actor/member lock·입력 검증·ACL·create 반환 계약을 유지한다. `update`만 `55000 AMORA_ACTION_UNVERSIONED_UPDATE_RETIRED`로 저장 전에 거절한다.
- `update_own_legacy_amora_action(uuid,uuid,text,bigint,jsonb)`는 기존 actor/member·입력 검증 후 동일한 55000으로 저장 전에 거절한다.
- `guard_amora_action_insert_identity_cutover_v1()`는 새 private SECURITY DEFINER 트리거 함수이며 standalone EXECUTE를 PUBLIC/anon/authenticated/service_role에 주지 않는다.
- INSERT 순서: `pg_try_advisory_xact_lock(hashtextextended(NEW.id,710041))` → 이미 canonical 동일 ID이면 23505 → 현재 couple journey `FOR UPDATE` → progress/container 검증 → legacy 같은 ID면 40001 → INSERT 허용.
- identity busy는 대기하지 않고 40001이다. 이는 journey-first privileged 호출과 v2 identity-first 호출의 역대기를 끊기 위한 최소 경계다. [PostgreSQL advisory lock 공식 설명](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS).
- 기존 canonical ID는 `ON CONFLICT DO UPDATE`나 `DO NOTHING`이어도 BEFORE INSERT에서 23505이며 기존 행은 바뀌지 않는다. [PostgreSQL trigger 동작](https://www.postgresql.org/docs/17/trigger-definition.html).
- no-journey create는 기존 호환을 유지한다. 부재 행에 대한 미래 journey INSERT phantom, 별도 progress writer, 임의 PostgreSQL 관리자 변경을 보호한 것이 아니다.

## 실제 writer 추적과 정책 정정

아래는 이번 세션에서 실제 소스를 읽어 확인한 코드 계약이며, hosted 사용 빈도를 측정한 결과는 아니다.

| 경로 | 현재 판단 | 이번 변경 영향 |
| --- | --- | --- |
| `/api/amora/actions/[id]` PATCH | v2 raw view + actor/couple 확인을 거치는 수동 수정 | e313 v2 함수/코드 불변 |
| 기존 public `mutate_own_amora_action(...,'update',...)` | version 없는 구 수동 writer | 55000으로 retirement |
| 기존 public legacy updater | journey revision만 사용하던 구 writer | 55000으로 retirement |
| 기존 public create | 정상 POST 생성/정확한 requestId 재시도 | 생성 성공·23505 중복·provenance 유지 |
| 정상 chat pending 승인 및 model provider mutation | `toolExecutor`가 providerCallIndex/pendingActionId로 atomic dispatcher를 강제 | dispatcher/claim/source/audit/decision 함수 수정 없음. 실제 정식 AI add 독립 검증은 아직 필요 |
| AI `update_amora_action` | shared TypeScript 정책·SQL 정책은 blocked. 정상 execution completion trigger도 ELSE 42501 | 신규 update 허용이나 승인 토큰을 추가하지 않음 |
| private atomic SQL의 latent update branch | SQL 본문에 UPDATE가 있다는 것만으로 현재 정상 AI update가 active라고 판단하면 안 됨 | 기존 정책 우선, latent 본문 불변 |
| dormant non-atomic `executeAddAmoraAction` | repository `.upsert`; 실패를 잡고 mirror 후 success를 반환하는 기존 코드 존재 | 신규 canonical INSERT는 허용하지만 동일 ID upsert는 차단. dormant 진실성 결함은 별도 폐쇄 필요 |
| dormant non-atomic `executeUpdateAmoraAction` | repository service `.update`와 legacy `saveProgress` fallback 코드 존재 | 직접 service UPDATE와 legacy progress writer는 아직 미폐쇄 |
| `saveProgress`/progress patch RPC | 정상 일정 도구들도 공용 RPC를 사용함 | 전체 RPC를 임의로 revoke하지 않음 |

근거 파일:

- `packages/shared/src/contracts/amoraActionApproval.ts`: add만 single 허용 목록에 있고 update는 blocked.
- `apps/web/src/app/api/chat/route.ts`: blocked pending 거절·model proposal 필터 및 pending/provider context 전달.
- `apps/web/src/lib/ai/toolExecutor.ts`: `requiresAtomicCommit`, 정상 atomic 경로, dormant `executeToolOnce`.
- `apps/web/src/lib/ai/tools/amoraActionTools.ts`: add upsert/mirror catch, update DML/legacy fallback.
- `apps/web/src/lib/amora/actionRepository.ts`: 기존 admin upsert/UPDATE 호출자.
- `apps/web/src/lib/ai/tools/progressTools.ts`, `scheduleTools.ts`: 예약된 배열의 top-level 교체와 정상 일정 호출자.
- `20260823120000_couple_approval_becomes_notification.sql`: 현재 SQL 정책.
- `20260802140000_amora_manual_schedule_fairness.sql`: real claim/source/binding execution fence, add의 revision 보존 및 update ELSE 거절.
- `20260915101500_amora_atomic_not_applicable_status.sql`: 실제 add INSERT, latent update, completed replay.
- `20260730102000_amora_shared_action_approval_and_notifications.sql`: 실제 pending wrapper.
- `20260731123000_couple_plan_change_write_boundary.sql`: authenticated journey INSERT/UPDATE는 이미 revoke됨.

앞서 latent SQL UPDATE를 active AI update라고 표현한 판단은 정정했다. 정책이 blocked인 현재 경로에 새 AI update 기능을 발명하지 않는다.

## TDD·실제 실행 결과

1. 구 canonical 수정 RED: 실제 기존 RPC가 저장해 `Missing expected rejection`. 최소 update retirement 후 GREEN.
2. 구 legacy 수정 RED: 현재 revision을 보내도 실제 저장해 `Missing expected rejection`. retirement 후 GREEN.
3. legacy 동일 ID create와 service canonical upsert RED: 실제 기존 동작이 성공했다. identity trigger 추가 후 GREEN.
4. native baseline(`AMORA_CUTOVER_BASELINE=1`, 후보 미설치) 4개 실제 반례: 0 PASS / 4 FAIL / exit 1. 성공 shadow, journey/identity 잠금 부재가 실제로 관찰됐다.
5. 후보 설치 검증: 15 PGlite + 4 실제 PostgreSQL 17 = **19 PASS / 0 FAIL / 0 SKIP / exit 0**.

실행 명령:

```text
node --test supabase/release-candidates/amora-action-writer-cutover-v1/cutover-candidate.test.mjs supabase/release-candidates/amora-action-writer-cutover-v1/cutover-native.test.mjs
```

19개는 보호·호환 검증과 남은 열린 writer를 증명하는 검사 2개를 포함한다. 남은 경로가 열려 있다는 테스트 PASS를 수정 완료로 세지 않는다. 기존 backend 537 / hook 56 결과에 재실행 수를 더해 중복 합산하지 않는다.

native는 기존 로컬 PostgreSQL fixture의 소유한 임시 클러스터만 사용한다. hosted 접속 문자열을 받지 않으며 외부 DB/API 호출은 없다. 실제 `pg_stat_activity`/`pg_locks`의 대기·보유 상태를 관찰한다.

- legacy v2 수정 먼저: authenticated create와 service INSERT 모두 1000ms statement timeout 안에서 40001. timeout 57014·deadlock 40P01·shadow 없음.
- journey-first service INSERT와 identity-first v2가 교차: try lock이 즉시 40001로 닫히고 v2가 진행한다. 이 검사는 INSERT seam의 잠금 검증이지 실제 pending AI 승인 증거가 아니다.
- INSERT identity 먼저·journey barrier: INSERT는 실제 journey를 읽고 기존 legacy ID를 거절하며 기다리던 v2 수정은 성공한다.
- 새 canonical INSERT 먼저: 기다리던 v2는 새 canonical raw timestamp를 선택해 오래된 token에 40001을 반환한다.
- 원문 receipt timestamp와 저장된 legacy `updatedAt`이 같다. 0–6자리 소수 계약이며 6자리로 재발명하지 않는다. PGlite 시계의 3자리 원문도 유효하다.
- budget/schedule/다른 legacy 원문/추가 unknown 필드 보존을 비교한다.
- 함수 ACL/owner/proconfig 및 actor helper·value helper·e313 v2 정의를 전후 비교한다.

## 남은 경계와 다음 승인 요청

실제 local counterexample으로 확인했다:

- service-role 직접 canonical UPDATE는 계속 저장된다.
- 실제 `apply_journey_progress_patch`로 오래된 `__amora_actions` 배열·timestamp를 덮어쓸 수 있다.
- 실제 `apply_journey_progress_item_patch`의 reserved key로 배열을 잘못된 object로 바꿀 수 있다.
- normal schedule/budget RPC 호출은 여전히 성공한다. 따라서 공용 RPC 전체 revoke는 올바른 최소 수정이 아니다.

추가 폐쇄는 이 후보에 섞지 않았다. 부모 승인이 필요한 두 대안:

1. 최소 권한 A — service-role 직접 canonical UPDATE를 회수하고, progress patch/remove/item의 `__amora_actions`만 거절한다. owner SECURITY DEFINER v2와 허용된 atomic AI add를 보존할 수 있으나, `.upsert`는 새 ID여도 UPDATE 권한을 요구할 수 있어 dormant fallback을 별도 retirement해야 한다. raw privileged journey UPDATE/후속 INSERT까지 이것만으로 닫았다고 주장하면 안 된다.
2. 공동 protocol B — 모든 canonical/legacy writer가 raw snapshot·실제 claim/source 승인·identity/storage binding을 따르게 중앙 guard/새 successor를 설계한다. 더 넓게 닫을 수 있으나 새 승인 계약과 실제 lock graph가 필요하다. GUC/current_user 같은 문자열을 승인 증거로 사용하거나 journey/canonical 역순 트리거를 즉석 추가하면 안 된다.

권고는 실제 정상 AI add/결정 원장 독립 검증과 정상 caller 영향 감사를 먼저 하고, 작은 권한/예약키 retirement부터 합의하는 것이다. 아직 운영 적용 승인·release controller payload·전체 writer 공동 경계 검증은 없다.

## 후보 freeze 식별

- SQL SHA256: `25b78629def538a85e13848df70f5e9142df8469f5ee75aa1096dfb1183ef2ca`.
- fixture SHA256: `8b59ba8b83f09efadf1f4c3f7d39d176c3fc102477b59c225642d0e40cba702c`.
- PGlite test SHA256: `d3e877cf6072694c41c16111df23592f096ec027fbbd159b8ad5dfc5ef7bf245`.
- native test SHA256: `c5270e8e9fa5285adc689b5babd66c1fadbce26377d307fb5d22c9c1d371aeee`.
- 독립 정식 pending AI add/decision ledger 검증은 부모가 별도 담당에게 배정한다. 여기의 raw service INSERT 성공은 그 증거로 사용하지 않는다.
