# Amora writer retirement companion — 최종 로컬 인계

## 상태

로컬 후보 구현·회귀 검증 완료. hosted DB 적용, migration ledger 수정, 커밋, push, 배포는 하지 않았다. 이 문서는 전체 개인정보 삭제 saga·운영 출시·임의 관리자 DML 보호 완료 선언이 아니다.

작업 트리: `C:/Users/kcho1/.codex/worktrees/amora-safe-release-20261012/wedding`.

기존 frozen e313 v2와 25b786 cutover SQL 및 그 원본 테스트/fixture/native 파일은 그대로 보존했다. service companion 56ed도 이후 범위를 별도 파일로 분리해 보존했다. 원본 dirty worktree·HOLD·controller·package·CI·UI/hook은 수정하지 않았다.

## 선택과 구현

부모가 A 최소 권한/예약키 retirement를 승인했다. B 모든 writer의 새 공동 capability protocol은 승인 계약·lock graph·새 successor 범위가 크므로 구현하지 않았다.

1. `retirement_service_writers_v1.sql`:
   - service_role의 canonical table UPDATE를 회수한다. owner SECURITY DEFINER 수동 v2와 실제 승인 dispatcher를 재설계하지 않는다.
   - 기존 generic progress patch/remove/item의 `__amora_actions` 입력만 55000으로 저장 전에 거절한다. 일정·예산 공용 RPC를 통째로 revoke하지 않는다.
   - RPC signature/owner/ACL/config는 유지한다. upsert 문장은 새 ID여도 UPDATE 권한 부족으로 42501이며, 정상 INSERT와 기존 수동 create/requestId 중복 계약은 유지한다.
2. `retirement_reserved_plan_writers_v1.sql`:
   - 실제 기존 normalizer/apply_locked 설치가 없으면 55000으로 닫는다.
   - 공통 normalizer에서 신규 일반 plan reserved patch/remove를 거절한다.
   - private apply_locked에서 실제 pending request의 changes를 쓰기 전에 같은 normalizer로 재검증한다. 원래 actor/roster/digest/approval/decision/lock 본문은 유지하며 새 lock·승인 토큰·GUC를 추가하지 않는다.
3. `retirement_direct_journey_guard_v1.sql`:
   - 새 trigger는 SECURITY INVOKER이며 standalone EXECUTE를 clients에 부여하지 않는다.
   - `current_user=service_role`는 직접 DML을 **거절하는 조건**이지 승인의 근거가 아니다. 기존 owner SDF에 새 권한을 주거나 기존 승인 검사를 대신하지 않는다.
   - 직접 UPDATE에서 reserved 값과 presence가 달라지면 42501. missing/JSON null/빈 배열/원문 timestamp 변경을 구분한다.
   - 직접 INSERT는 nonempty/malformed reserved 값만 42501이며 guard 자체는 없는 값과 빈 배열을 허용한다. 실제 최신 기존 journey INSERT fence는 `{}`만 허용하므로 전체 조합에서는 빈 배열 초기화도 여전히 42501이다. 이를 풀기 위해 기존 fence를 약화하지 않았다.
   - 추가 advisory/row lock을 만들지 않는다. owner postgres/admin 임의 변경 보호로 해석하면 안 된다.
4. 좁은 웹 AItools retirement:
   - `executeAddAmoraAction`/`executeUpdateAmoraAction`의 dormant non-atomic 함수는 `success:false`, `AMORA_ACTION_NON_ATOMIC_MUTATION_RETIRED`를 반환하고 admin/repository/mirror 호출을 하지 않는다.
   - add 저장 오류를 잡고도 가짜 success를 반환하던 실제 RED를 제거했다.
   - pending ID/provider 번호/confirmed 입력을 넘겨도 이 함수가 새 승인 경로가 되지 않는다.
   - getter 본문과 실제 허용된 atomic AI add/pending/decision 원장은 변경하지 않았다. 사용하지 않는 mutable mirror/helper/import는 GREEN 후 정리했다.

## TDD와 증거 범위

각 구멍은 외부 함수/RPC 행동으로 먼저 RED를 관찰한 뒤 최소 변경으로 GREEN을 확인했다. 소스 문자열 검사를 저장 성공 증거로 대신하지 않았다.

- 직접 canonical service UPDATE, generic patch/remove/item: 기존 쓰기 성공 → 저장 전 거절.
- repo-current 실제 public submit wrapper: reserved 배열/2020 raw timestamp를 `applied`, revision 0→1로 저장하던 RED → input guard GREEN.
- 실제 July public submit이 만든 역사적 2/2 pending: normalizer 입력만 닫으면 accept가 reserved object를 저장하던 RED → locked request 재검증 GREEN.
- 최신 Aug23 fence는 과거 2/2 pending을 이미 40001로 닫는다는 별도 사실도 확인했다. 최신 정책에서 이미 닫힌 행동을 새 취약점으로 과장하지 않는다.
- 직접 journey service UPDATE: 실제 current fixture에서 affectedRows=1 저장 RED → INVOKER 거절 GREEN.
- nonempty journey INSERT는 최신 전체 fence가 이미 거절한다. 새 guard의 INSERT 경계 자체는 격리 fixture에서 실제 RED→GREEN으로 검증했다.
- native direct-guard 미설치 baseline: **1 PASS / 1 FAIL / exit 1**. 오래된 직접 service writer가 v2 이후 덮어쓰는 경우만 실패했다. source SHA mismatch·fixture 권한 누락은 행동 취약점 RED로 세지 않았다.

최종 실제 실행:

| 검사 | 결과 | 범위 |
| --- | --- | --- |
| AItools 및 기존 schedule/getter 3개 test files | 52 PASS / 0 SKIP | scheduleAndAmoraTools42 + nonAtomicRetirement4 + sharedTaskEvidence6 |
| 실제 manual/plan migration test 전체 | 62 PASS / 0 SKIP | 기존52 회귀 보존, 기존 정상3단계case 강화, 새10 cases |
| companion node suite | 13 PASS / 0 SKIP | 11 PGlite + 실제 PostgreSQL17 2개 |
| scoped ESLint | exit0, 0 errors/warnings | 소유 source 및 관련 tests |
| web tsc --noEmit | exit0 | 해당 실행 시 전체 web types |
| git diff --check | exit0 | 현재 작업 트리 |

반복 재실행 수와 부모/독립 suite 결과를 합산하지 않는다. 이 결과를 hosted/실계정/native full approval/모바일 테스트 성공으로 바꾸지 않는다.

## 실제 catalog와 current fixture 차이의 발견·수정

부모가 수집한 `.verification/amora-b-actual-readonly-writer-catalog-20261012.json`을 로컬로 읽었다. 이 에이전트는 Management API를 호출하지 않았다. 고객 row 없이 수집된 부모의 readonly witness와 설치된 함수 원문을 비교했다.

기존 W12 fixture에는 실제 live와 다른 revision/schedule capture와 누락된 budget capture가 있었다. 기존 historical setup을 삭제하지 않고 새 retirement 검증에만 실제 원문 trigger body를 설치했다. 다음 7개 MD5가 witness와 exact 일치하는 테스트를 만들었다.

| 함수 | 실제 witness MD5 |
| --- | --- |
| normalize_couple_plan_changes | 706476cf0b9fb4972137cbd5669bf1e2 |
| apply_couple_plan_change_locked | 0936548c6c7be1885a9d4f6e845d2a3d |
| enforce_couple_plan_change_write_boundary | a7adea14a47829f6b283952640691dae |
| advance_wedding_journey_state_revision | 16facd1736910df702ae86620c9e9a46 |
| capture_amora_shared_budget_delta | 5a8580ec8fc9aadc0486baed9752281a |
| capture_amora_shared_schedule_delta | a60e1e54508d964603c561e6a3857dfa |
| capture_amora_shared_schedule_cancel_restore_delta | f646b87909ae2482e1d97f9b9aef54ab |

같은 원문 trigger 조합 + e313 + 25b786 + companion3개에서 canonical/legacy v2를 실제 호출했다. canonical 승인 필드/source/actor/status timestamp, legacy 반환 raw token=저장 token, unknown JSON/다른 action 불변, r→r+1, stale40001, plan/audit 추가 없음이 통과했다. 정상 budget/checklist/schedule 3회와 완료 replay도 같은 조합에서 통과했다.

이 좁은 body 일치는 운영 전체 schema/receipt/restore/application 완료 증거가 아니다. 원장에 어떤 source version이 없다는 사실을 실제 함수가 없다는 뜻으로 해석하지 않는다. 부모의 actual229/latest catalog 대조와 컨트롤러 작업은 별도이다.

## 권한·생성·삭제·동시 실행

- existing authenticated/anon direct journey INSERT/UPDATE는 현재 권한/fence로 42501이다. service 조건 밖의 역할에 새 쓰기 권한을 주지 않았다.
- isolated guard에서는 `{}`/빈[] 초기 INSERT와 reserved 원문/presence를 그대로 둔 schedule/budget/metadata UPDATE가 허용된다. 최신 full fence에서는 실제 onboarding `{}`만 성공하고 빈[]는 기존 42501을 보존한다.
- 실제 reset_current_couple_membership 원문은 actor만 분리하고 재시도가 가능했다. 남은 partner의 journey/action 자료는 바뀌지 않았다. unrelated profile schema는 기존 실제 reset 함수가 요구하는 컬럼만 fixture에 추가했다.
- 실제 Auth FK ON DELETE SET NULL/CASCADE는 service canonical UPDATE 회수 이후에도 작동했다. Auth 관리 주체를 로컬 fixture 권한으로 재현한 것이며 운영 앱에 Auth 테이블 권한을 추가하지 않았다. 외부 Auth API/Storage/전체 deletion saga를 검증했다는 주장은 하지 않는다.
- source 감사: 실제 onboarding은 `progress:{}` INSERT, reset은 profile/couple 변경, 계정 삭제 saga는 job/media DELETE/FK 흐름이며 새 guard에 추가 lock이 없다.
- 실제 PG17의 v2 먼저/직접 stale writer 나중: row-lock 대기 관찰 후 v2 commit, 직접 writer42501, raw µs·다른 action·budget/schedule 보존.
- 실제 PG17의 정상 schedule RPC 먼저/v2 나중: schedule writer의 추가 advisory lock 없음 확인, 실제 row-lock 대기 후 둘 다 성공, r→r+2와 서로의 자료 보존.
- native2는 실제 엔진 lock seam 검증이다. full W12 트리거/정식 pending approval 전체 native 검증으로 표기하지 않는다.

## 독립 검수와 남은 운영 게이트

독립 agent는 새 별도 `amoraWriterRetirementApproval.independent.test.ts`에서 실제 persisted pending→claim→confirmed message→actual dispatcher를 사용해 AI add·완료 replay·budget decision·partner notification/RLS·blocked update를 검증했다. 이 에이전트의 raw service INSERT 성공이나 fake W12 atomic stub을 그 승인 증거로 세지 않는다. 최종 exact SQL3개 freeze를 독립 담당에게 보내 마지막 closed5 재대조를 요청했다. 그 최종 결과는 부모가 별도 인계한다.

remaining:

- hosted clone/운영 적용·전체 웹/실계정 smoke·릴리스 controller exact bundle/rollback은 부모 소유이며 여기서 완료하지 않았다.
- 실제 table/column/inherited ACL의 적용 후 UPDATE privilege 부재 및 모든 source catalog 전제는 운영 release gate가 확인해야 한다. 로컬 fixture에서 column UPDATE 권한이 없는 것은 실제 모든 host 권한을 대신하지 않는다.
- current_user 조건을 승인 capability라고 부르면 안 된다. owner SDF는 기존 실제 actor/claim/source/roster 계약을 계속 지켜야 한다.
- 임의 owner/admin·service의 모든 DELETE·모든 미지의 새 public SDF·완전한 roster ABA epoch·외부 Storage 삭제까지 닫았다는 주장 금지.
- 수동 v2 source/HTTP/hook 경계와 privileged AI 승인 경계는 서로 다른 계약이다. 이 companion은 승인된 현재 범위의 오래된 경로를 닫는 것이지 새 AI update를 여는 기능이 아니다.

## Freeze와 설치 순서

공유 source/test fixture에서 사용한 순서:

1. frozen e313 v2
2. frozen 25b786 최소 old writer/INSERT identity cutover
3. service retirement56ed
4. reserved plan retirement20138
5. direct journey INVOKER guard3b98

모두 BEGIN/COMMIT이 포함된 **로컬 후보**이며, 이 순서 메모는 승인된 hosted 배포 명령이나 ledger repair 지시가 아니다.

| 파일 | 최종 SHA256 |
| --- | --- |
| retirement_service_writers_v1.sql | 56edb08862ce7e178a35a357abd323954a8b35debd1fe8f2c0906aa51b6588d4 |
| retirement_reserved_plan_writers_v1.sql | 20138aab7a821c4e6ddc105b3a480160942800c389157afd500efccc91d2380d |
| retirement_direct_journey_guard_v1.sql | 3b98d9c86e1092fa5e1cd10561cfc1d25cb30e405dfc144320e9e717ddc9103c |
| retirement-candidate.test.mjs | bdab0b00468673eb987d8321bd3ecd4029d8b0ba99226012744e1de0204df5f3 |
| retirement-fixture.mjs | ed0b44b482a4d26869c638977a76e62af2948859ad012c3b7ae550fe2c8029db |
| retirement-native.test.mjs | 014772c5efdb493932c94c2e53afc64d61addeec796190ca5d2ee51ce1e9e7b2 |
| production amoraActionTools.ts | a03ebf62dd40d0d454aee3bc3230bc687f7f0c81b79c56ff6bc3b5ec1b13d1f5 |

Frozen 원문 e313/25b786 hashes는 최종 단계에서도 그대로 확인했다. SQL/source 편집은 종료했고 추가 발견이 있으면 부모에게 먼저 보고한다.
