# 예산 결정 기록 릴리스의 정확한 Realtime 회전 보충 계약

이 문서는 `messages_2026_09_07` 삭제, `messages_2026_09_14` 추가, 해당 publication 구성 변경 세 항목만 다룬다. 새 날짜를 자동 허용하거나 managed schema를 과거 상태로 되돌리지 않는다. 웹 배포와 별개의 scoped SQL 준비이며 이 문서·로컬 시험은 운영 적용 승인이나 실행 증거가 아니다.

## 원본과 효과 기준

기존 `amora-budget-decision-hotfix-v1.json`, 과거 baseline, migration 원문 및 과거 loader의 핀은 보존한다. 신규 `loadEffectiveBudgetDecisionHotfixRelease`는 먼저 v1 전체 검사와 SQL 목록 검사를 통과한 뒤 고정 supplement·실제 원문·새 baseline을 검사한다. `hotfix.operatingBaseline`은 계속 과거 기준을 뜻한다. 현재 선택은 `effectiveOperatingBaseline`이고 `baseline`/`baselineSha256`는 그 원문과 해시다. `parentOperatingBaseline`/`parentBaselineSha256`도 함께 반환한다.

- 부모 baseline SHA256: `2a60b91a06db7d01c4d5efb06c9033b5fbb2eb0e917ed0f8fa84c777a72d12c5`
- 효과 baseline SHA256: `527b8429377a9f13f16f8dfcf64f66d8fd73a3ea4c9588cc2cd498364932db4a`
- 구조 응답 원문 SHA256: `22ff4410bfe0520e8befc5a0aaed7123ca1d5a9803e1b064cbf66184cf36b990`
- 구조 query SHA256: `b36d7701530a58b54712ac5ecc92680b77448ac5d0fdf8426e7006356a36715c`
- 전체 응답 원문 SHA256: `ba0336e51637280b6dc4ca291029e32d3973e3b018e46382cab08b51254012ac`

관측한 source commit은 `a4580a20cb2936b294ff1336df95592d3aaf9861`이다. 구조 관측 `2026-09-11T04:45:50.488989+00:00`이 전체 관측 `2026-09-11T04:54:14.801558+00:00`보다 약 8분 앞선다. 실제 원문의 시각과 만료된 공식 CLI 역할 TTL을 변경하지 않았다. 새 계약은 이 순서, 15분 이내 간격, 동일 대상의 현재/이전 object hash를 검사한다. 이 역사 증거는 실행 직전 관측을 대신하지 않는다.

전체 ledger 215개와 head `20260907085111`, 나머지 객체·관계, Storage 구조/정책, cron/vault 카운트는 부모와 같아야 한다. 효과 baseline은 실제 전체 응답에서 꺼낸 관측과 일치해야 한다. SQL은 기존 예산 결정 migration 한 개 그대로이며, ledger 216개가 되는 기존 검증을 유지한다.

구조 원문의 constraint 이름과 index DDL의 식별자, 일 단위 경계만 제한적으로 09_14에서 09_07로 재구성한다. 정책/기본값/트리거 본문과 publication의 나머지 멤버십·열·필터·권한은 유지한다. PostgreSQL `jsonb::text` 해시를 JavaScript JSON 직렬화 해시로 대체하지 않는다. 고정한 실제 query/response 원문과 서버의 재구성 해시를 사용한다.

## 실행 경계

현재 budget mode의 정적 fence, production build의 등록된 budget followup, controller CHECK/APPLY/recovery/finalizer는 같은 효과 loader를 사용한다. supplement 누락·변조 시 과거 loader로 fallback하지 않는다. 별도의 역사 loader는 과거 계약 검증용으로 남는다.

현재 evidence, outcome, finalizer receipt에 `baselineSupplementSha256`와 `effectiveBaselineSha256`가 필요하다. 원래 `hotfixContractSha256`만 같아서 과거 baseline 증거를 섞을 수 없다. apply/finalizer의 재검사에서도 새 loader 값과 동일해야 한다. Canary는 기존 `outcomeSha256`를 통해 두 필드를 포함한 outcome 전체와 연결하며 실제 provider 원문에 가상 필드를 추가하지 않는다.

새 원문 관측은 `renderBudgetRealtimeObservationSql(release, releaseCommit)`에서 만든 정확한 READ ONLY query로 수집한다. `evidence.realtimeTopology`에는 그 query SHA256와 `rawEvidence.file/sha256`를 담는다. 원문 JSON 응답은 `{ observation }` 한 행이고 실제 system, commit, 두 binding, readOnly, 시각, oldPartitionAbsent, topology를 검사한다. 누락·불일치·30분 만료는 거절한다. 허용된 서버 시계 여유는 미래 10초이며 전체 릴리스 기한은 기존 기한과 이 관측 기한의 최솟값이다.

기존 inventory는 `pg_inherits` 및 index-parent graph를 해시에 넣지 않는다. 따라서 새 공통 guard가 `realtime.messages`, 잔존 09_08, 새 09_14의 부모 수/식별자/partition key/bounds/detach 상태/열 상속/index parent를 추가 검사한다. fresh preflight, atomic before/after, finalizer가 모두 같은 guard를 호출한다. 과거 삭제된 09_07의 parent는 기존 해시에 없으므로 직접 관측했다고 주장하지 않는다.

atomic과 finalizer는 기존 5초 lock timeout 안에서 `ONLY` parent → 09_08 → 09_14 순서의 `SHARE UPDATE EXCLUSIVE` 잠금을 사용한다. 자식 전체로 재귀 확장하지 않으며 READ ONLY preflight에는 이 잠금을 넣지 않는다. 원래 public table/ledger 잠금·lease·guardBlock·데이터 해시·기한·응답 불명확 시 재시도 금지는 유지한다. 추가 실제 READ ONLY 권한 관측(2026-09-11T05:10:24.947815+00:00)에서 current_user postgres와 세 관계의 존재/스키마 USAGE/UPDATE/MAINTAIN가 모두 확인됐다. 권한 응답 원문 SHA256는 `9be8351d37419583140365f8471166a438d89e6a4df6c0d1d1f41e4a5978c621`이다. 실제 원문의 세 ACL에 postgres UPDATE/MAINTAIN 권한이 있다. 이 모드에 필요한 권한과 명시 순서는 [PostgreSQL 17 LOCK 문서](https://www.postgresql.org/docs/17/sql-lock.html)를 따른다. 로컬 엔진 실행과 운영 권한 관측은 실제 운영 잠금 경쟁 성공을 보증하지 않으며 운영 LOCK probe를 수행하지 않았다.

## 증거 재사용 범위와 남은 실행

기존 hosted rollback/concurrency/SQL 시험 원문은 원래 source commit·시각·해시를 보존하고 기존 24시간 조건과 실제 migration blob/정확한 여섯 schema 전이 검사를 통과할 때만 재사용한다. 새 Realtime 구조를 hosted에서 시험했다고 바꾸지 않는다. 최종 후보의 새 private child에서 backup, before/data, fence, dry-run, topology를 새로 수집하고 실제 recovery를 검증해야 한다. X의 사전 snapshot을 최종 후보로 relabel하지 않는다.

`amora-budget-decision-backup-collector` 및 `amora-budget-decision-archive` capture-only 경로는 역사 v1 source scope를 검사하는 기존 계약으로 유지한다. 이 경로의 성공을 새 효과 baseline의 CHECK/APPLY 승인으로 사용하지 않는다. 현재 scoped 준비물은 공통 효과 loader와 새 binding을 사용하는 별도 버전으로 준비한다.

로컬 회귀는 원문/핀/추가 네 번째 변경/기한/혼합 binding 거절, 실제 작은 PostgreSQL 엔진의 before/after/finalizer 구조 거절과 rollback, 기존 SQL 한 개와 데이터/lease 보존을 확인한다. 같은 child를 다른 parent로 옮겨도 기존 inventory가 같음을 재현했으며 새 guard를 제거한 메모리 내 시험 변이는 실패한다. 이를 운영 DB 적용·전체 복원·hosted 재시험으로 표현하지 않는다.
