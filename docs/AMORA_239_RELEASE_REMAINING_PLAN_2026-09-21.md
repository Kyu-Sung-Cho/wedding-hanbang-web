# 아모라 239 후보 — 운영 적용까지 남은 최소 작업

상태: **PLAN / 운영 적용 차단 유지**. 2026-09-21 로컬 소스 읽기 전용 설계 감사에 따른 후속 계획이다. 이 문서 작성으로 컨트롤러 구현, 운영 증거 수집, DB 적용, 배포가 완료되거나 승인되지 않는다. 아래 파일·행 번호는 이 감사 시점 기준이다.

후속 실행 상태는 [배포 실행·검증 기록](AMORA_RELEASE_EXECUTION_2026-09-21.md)이 우선한다. 그 뒤 239 읽기 전용 inspector와 테스트는 구현·검증했지만 apply/finalize는 여전히 제공하지 않는다. 기존 무료 staging을 재개하여 존재와 상태를 확인했으며, Auth 계정 197개·Storage 객체 924개가 있어 비어 있거나 폐기 가능한 격리 복원 대상으로 취급하지 않는다. 아래의 “이번 감사에서는 관측하지 않았다”는 문장은 초기 설계 감사의 범위를 가리킨다.

## 현재 사실과 반드시 구분할 것

- 후보는 `amora-decision-privacy-candidate-v1.json`의 `productionApplyImplemented:false`, `runtimeEvidenceVerified:false`, `status:deployment-blocked` 상태다. 정적 검증기는 이를 그대로 강제한다. 근거: `supabase/release-contracts/amora-decision-privacy-candidate-v1.json:3`, `scripts/lib/amora-decision-privacy-candidate.mjs:51`.
- **237/239는 저장소에서 검토된 SQL 파일 수다. 이번 감사에서는 live 운영 ledger를 조회하지 않았다.** 실제 운영 ledger의 전체 version/name/statements 해시·행 수·head는 별도 관측하고 검토된 기준에 묶어야 한다. 237을 관측값처럼 하드코딩하면 안 된다. 기존 237 validator는 `ledgerCount > 0`과 선행 migration 행 등을 확인하므로, 그대로 복사하면 전체 역사 기준의 승인이 되지 않는다. 근거: `scripts/lib/amora-decision-privacy-candidate.mjs:59`, `scripts/lib/preparation-style-catalog.mjs:113`.
- 후보 범위는 기존 함수 8개 변경·함수 6개 추가, 애플리케이션 테이블 DDL 유지·기존 행 backfill 없음이다. 여기에는 함수 본문 변경뿐 아니라 기존 reset/memory 실행권한 축소와 함수 rename도 포함된다. 근거: 후보 manifest `:26`, `:36`; `supabase/migrations/20260921100000_amora_approved_decision_records.sql:290`, `:515`; `supabase/migrations/20260921101000_privacy_confirmation_targets.sql:6`, `:96`.
- 기존 로컬 native PG17 행동·catalog 테스트는 후속 구현의 출발점이지 실제 전체 운영 스키마, hosted Auth/RLS, 백업 복구 증거의 대체물이 아니다. fixture는 필요한 실제 SQL과 최소 합성 스키마를 조합한다. 근거: `scripts/tests/amora-privacy-decision-native.test.mjs:30`, `scripts/tests/fixtures/amora-privacy-decision-native.mjs:95`.

## 두 가지 구현 대안

| 대안 | 범위와 위험 | 판단 |
| --- | --- | --- |
| A. 별도 239 전용 controller를 단계적으로 추가 | 237의 원문 핀·catalog·transaction rehearsal 패턴을 재사용하되, 239 전용 evidence 검증·lease/fence·호환 rollback·finalizer를 명시적으로 추가한다. 기존 237 실행 계약과 과거 핀은 보존한다. | **추천.** 변경 영향이 가장 명확하고 `inspect`부터 닫힌 상태로 검증할 수 있다. |
| B. 기존 Amora hotfix controller에 새 release kind/profile 추가 | 이미 있는 원본 증거 binding, lease, 통신 실패 판정, canary/finalizer를 활용한다. 대신 오래된 baseline, backup 범위, 허용 schema 변경, hosted 시나리오, CLI mode 모두 새 계약에 맞게 검증해야 하며 기존 hotfix lane 전체 회귀 범위가 커진다. | 가능하지만 이번 최소 작업으로는 비추천. 단순 mode 추가나 숫자 변경만으로는 안전하지 않다. |

**안전하지 않은 지름길:** 237 controller를 복제하고 migration 개수만 2개로 바꾸기, candidate의 false 값을 true로 변경하기, 함수 전체를 wildcard 허용하기, 정적 fence 통과를 운영 인가로 취급하기. 현재 `runProductionRelease`는 237 lane으로 바로 분기하며 해당 runtime은 backup/fence/restore/finalizer 증거를 입력받아 검증하지 않는다. 근거: `scripts/lib/supabase-production-release-controller.mjs:2621`, `scripts/lib/preparation-style-release.mjs:91`.

대안 B의 참고 경계는 `scripts/lib/amora-runtime-hotfix-controller.mjs:254`(증거), `:447`(원자 적용), `:613`(lease·결과 미확정 처리), `:683`(canary), `:725`(finalizer)다. 구현 패턴을 참고할 수 있다는 뜻이지 그 release의 증거를 239 증거로 승계한다는 뜻이 아니다.

## 추천하는 단계별 최소 구현

1. **239 전용 읽기 전용 관측기와 계약부터 만든다.** 새 catalog/runtime/evidence 모듈 및 hash-pinned PG17 before/after fixture를 마련한다. 기존 candidate와 237 historical pin은 보존하고, 실제 runtime을 갖춘 별도 계약에서 이를 참조하는 방식을 우선한다. 초기에는 `inspect`만 허용하고 apply/finalize는 거부한다. 정확한 Git commit·origin·destination·SQL 두 원문·전체 ledger·현재 함수 baseline을 결합한다.
2. **운영 증거의 실제 생성·검증 경로를 구현한다.** 문서에 나열된 필수 항목을 boolean 자기선언으로 통과시키지 않는다. private raw artifact의 해시, source identity, release/commit/migration-set, 관측 시점·만료, 범위·실행 결과를 검증한다. DB와 Storage 원본 백업, 격리 복구 검증, 전체 write fence와 진행 중 요청/worker drain, hosted 두 계정·다중 연결 검증, 호환 rollback 결과를 각각 구분한다. 근거: 후보 manifest `:50`.
3. **두 SQL의 단일 원자 적용과 복구 판정을 구현한다.** 검증된 동일 owner lease와 fence 아래에서 두 migration body와 두 ledger 행을 한 transaction으로 처리한다. 변경 전 기준을 transaction 안에서 다시 검증하고, rehearsal rollback 후 독립 readback을 수행한다. 이미 두 개 모두 적용된 상태만 정확한 catalog/ledger로 확인할 수 있고, 하나만 존재하면 자동 이어쓰기 대신 차단·읽기 전용 판정한다. rename이 있으므로 재전송을 멱등하다고 간주하지 않는다. 통신 응답 유실은 rollback 증거가 아니며, fence/lease를 유지하고 같은 apply를 자동 재시도하지 않는다.
4. **구버전 호환·Vercel 배포·finalizer를 연결한다.** 새 RPC를 아는 서버와 구버전 모바일/웹의 재확인·복구 동작을 검증한다. rollback은 새로운 privacy 경계와 저장된 행을 보존하는 호환 서버/forward-fix여야 한다. 옛 no-argument reset을 다시 활성화하거나 memory 원시 함수 권한을 되돌리지 않는다. 실제 `hanbang.ai`의 정확한 commit/deployment와 오류·읽기·fence canary를 확인한 뒤 동일 lease owner만 fence를 해제하게 한다. 단순 `/api/health` 성공은 제품 흐름 검증이 아니다.

추가할 파일의 최소 논리 단위는 `amora-decision-privacy-release-contract`, `amora-decision-privacy-catalog`, `amora-decision-privacy-evidence`, `amora-decision-privacy-release`와 이들의 행동 테스트다. 실제 경로·파일 분리는 구현 단계에서 기존 구조에 맞춰 정한다. 기존 production dispatcher와 package wiring 변경은 새 mode의 거부·허용 경계가 검증된 뒤에만 추가한다. 역사적 컨트롤러를 광범위하게 리팩터링하는 일은 이번 범위에 넣지 않는다.

## 8개 변경·6개 추가에 필요한 catalog/evidence 보강

- **함수별 정확한 before/after:** schema/name/입력 타입뿐 아니라 인자 이름·default·반환형, 전체 정의, owner, SECURITY DEFINER, search_path 등 config, volatility/strict/parallel/leakproof 속성, 정규화한 ACL을 고정한다. 6개 신규 signature는 before에서 없어야 하며, 예상하지 않은 overload·삭제·변경을 거부한다. 237의 함수 shape가 유용한 출발점이다: `scripts/lib/preparation-style-catalog.mjs:44`.
- **rename과 실행권한:** 원래 구현이 세 개의 내부 alias로 이동하는 관계와 alias의 client/service-role 직접 호출 금지, 새 wrapper의 정확한 호출권한을 확인한다. `pg_depend`/trigger의 함수 참조를 signature로 관측해 예상하지 않은 참조 변화도 검토한다. 환경 간 numeric OID를 동일하다고 가정하지 않는다. effective `has_function_privilege`와 실제 role 호출 결과도 ACL 원문과 별도로 확인한다.
- **변경하지 않은 보안 경계:** 14개 exact signature만 변경 범위에서 제외한다. 같은 이름의 다른 overload나 부모 테이블 전체를 제외하지 않는다. 의존하는 공유 승인·epoch·membership 함수와 준비방식/계정삭제 trigger, relation/column ACL, RLS/force-RLS, 정책·constraint·index·sequence 등을 보존한다. 운영 fence 객체는 검토된 exact lifecycle만 별도로 취급한다.
- **행 보존과 ledger:** profile/couple, approval/claim/execution/decision, memory/consent/epoch, 준비방식 응답·공유 등을 포함한 검토 대상 행의 count+digest를 DB 안에서 계산한다. 고객 원문은 관측 응답·Git에 넣지 않는다. transaction rollback 전후 및 적용 전후 보존을 확인하며, ledger는 두 신규 행 외 기존 전체 행이 동일해야 한다. 기존 row-digest 패턴 참고: `scripts/lib/account-deletion-customer-data-catalog.mjs:76`.
- **실제 행동 증거:** reset↔memory와 reset↔decision 양방향 경쟁, stale actor/epoch·roster, 승인 재시도 exactly-once, receipt 실패 시 decision rollback, 개인/상대/공유 기억 보존, 구 호출의 fail-closed와 사용자 재확인 복구를 포함한다. 로컬 native 사례를 hosted 동일 의미의 증거로 확장하되 로컬 통과값을 hosted 결과로 복사하지 않는다.

## 백업 범위와 비용·프로젝트 경계

**부분 백업은 전체 백업/복구가 아니다.** 기존 hotfix validator는 `storageBytesCaptured:false`, `restoreRehearsalCompleted:false`를 명시적으로 검증하고, synthetic transaction rollback과 실제 원본 archive 복구를 구분한다. 그 결과를 후보의 DB+Storage 원본 백업·격리 복구 완료로 재명명할 수 없다. 근거: `scripts/lib/amora-runtime-hotfix-controller.mjs:281`, `:292`, `:316`; `:575`의 archive 복호화·해시 확인도 그 자체로 실제 DB 복구 실행 증거는 아니다.

- 운영 대상은 기존 Supabase 프로젝트 `slrtobkksjmxgzatjyqb`를 유지한다. 이 계획은 운영 프로젝트 이전, 유료 플랜, 새 프로젝트 생성·결제를 요구하거나 허가하지 않는다.
- 별도 Supabase 프로젝트를 새로 만드는 것이 복구 검증의 필수 구현 방식은 아니다. 로컬 격리 PostgreSQL에 대한 안전한 원본 복구 검증과 Storage 원본 archive 검증을 설계할 수 있다. 다만 이것만으로 hosted Auth/JWT/RLS/Storage 플랫폼 검증까지 완료했다고 말하지 않는다.
- hosted 시험은 이미 소유·허용된 격리 시험 대상이 있는지 먼저 확인한다. **이 감사에서는 그런 대상의 존재나 사용 가능성도 관측하지 않았다.** 없으면 해당 증거는 미충족으로 유지하고 안전한 검증 경로를 별도로 결정한다. 새 유료 프로젝트를 자동 생성하거나 운영 고객 데이터에 destructive restore/시험을 하지 않는다.
- 과거 generic successor가 `different-project-destructive-restore`를 요구하는 계약이라는 이유로 새 프로젝트를 만들거나, 반대로 그 옛 검증기를 약화해 통과시키지 않는다. 239에서 실제로 채택한 격리 복구 방식의 범위와 한계를 새 계약에 명시해야 한다. 근거: `scripts/lib/supabase-successor-release-contract.mjs:95`.

완료 기준: 위 컨트롤러·증거 검증의 RED/GREEN 및 실패 주입 테스트, 실제 독립 runtime 증거, 호환 배포·canary·finalizer가 모두 확인되기 전에는 **운영 배포 완료 / 239 적용 가능**으로 표시하지 않는다. 이번 작업에서 변경한 것은 이 계획 문서뿐이다.
