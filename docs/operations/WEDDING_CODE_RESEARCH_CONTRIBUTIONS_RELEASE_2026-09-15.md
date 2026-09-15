# WeddingCode 연구 기여 저장소: 234 별도 DB 적용

상태: 로컬 구현과 합성 PostgreSQL 검증까지. **운영 DB 미적용.** 운영 관측·예행·적용·사후검증은 아래 전용 실행 결과(영수증)가 있어야 완료다. 이 문서와 로컬 검사 통과는 운영 적용 인가가 아니다.

## 범위

`supabase/migrations/20260915130000_wedding_code_research_contributions.sql` 한 건이다. 동의한 참여자의 익명 연구 응답만 받는 저장소를 **새로** 만든다.

- 새 테이블 `public.wedding_code_research_contributions`: `id`, `created_at`, `expires_at`(최대 60일), `scene_version`(`v0.8-code`만), `answer_code`(`A`–`D`·`-` 20자, 적어도 한 글자는 답), `consent_version`(`wc-research-consent-vN`), `deletion_receipt_hash`(32바이트, 고유).
- 새 테이블 `public.wedding_code_research_deletion_tombstones`: 삭제한 receipt hash, 삭제 날짜, 만료 날짜(30일)만.
- **시각은 UTC 날짜(자정)로만 저장한다.** `created_at`·`deleted_at` 기본값은 `date_trunc('day', now(), 'UTC')`, 만료는 그 날짜 + 60일/30일이다. `created_at = date_trunc('day', created_at, 'UTC')`·`deleted_at = date_trunc('day', deleted_at, 'UTC')` CHECK가 있어 소유자 권한으로도 시·분·초가 있는 값을 넣거나 바꿀 수 없다. 분석·요청 로그와 저장 시각으로 행을 이어 붙이지 못하게 하려는 것이다. 같은 날 들어온 응답끼리는 순서가 남지 않지만, `id`는 무작위 UUID라 입력 순서를 드러내지 않는다.
- 같은 receipt hash를 다시 저장하면 UNIQUE 위반(SQLSTATE `23505`)이 그대로 올라간다. receipt를 참여자 쪽에서 만들기 때문에, 호출 API는 `23505`를 같은 요청의 재시도로 보고 성공으로 처리한다. 함수 안에서 이 오류를 삼키거나 다른 코드로 바꾸지 않는다.
- 새 함수 세 개(모두 `SECURITY DEFINER`, `search_path=''`, `service_role`만 EXECUTE): `insert_wedding_code_research_contribution(text,text,text,bytea)`, `delete_wedding_code_research_contribution(bytea)`, `purge_expired_wedding_code_research_contributions()`.
- 두 테이블 모두 RLS 사용, 정책 없음, `PUBLIC`·`anon`·`authenticated`·`service_role`의 테이블 권한 없음(소유자만).
- 사용자 ID·IP·user agent·자유서술·계정/아모라/커플 결합 키는 **없다**. 과거에 닫은 WeddingCode 수집 테이블·RPC는 이름을 쓰지도, 권한을 주지도, 쓰지도 않는다. 기존 테이블·함수·고객 행은 바꾸지 않는다.
- 같은 receipt hash의 저장과 삭제는 트랜잭션 advisory lock으로 한 줄로 선다. 삭제는 행 존재 여부와 무관하게 같은 결과를 내고 tombstone을 남긴다.
- tombstone이 하는 일은 둘이다. ① 만료 전까지 삭제한 receipt의 **재저장을 막는다**(`22023` / `WEDDING_CODE_RESEARCH_CONTRIBUTION_REJECTED`). ② `purge_expired_wedding_code_research_contributions()`가 만료 행과 함께 **tombstone에 hash가 있는 응답 행도 지우고**, 그 수를 반환 값에 더한다. 그 뒤에 만료 tombstone을 지운다.
- **한계(복원):** tombstone은 같은 DB 안에 있다. DB 전체를 백업 시점으로 복원하면 응답 행과 함께 tombstone도 그 시점으로 돌아가므로, 백업 이후에 삭제한 응답은 **다시 지워지지 않는다.** ②는 tombstone이 남아 있는 상태에서 응답 행만 되살아난 경우(부분 복원·수작업 입력)에만 적용된다. 전체 복원 뒤 재삭제는 이 lane이 보장하지 않으며, 연구 스펙 §9의 "복원 후 재삭제"는 DB 밖에 보관한 삭제 목록 같은 별도 절차와 증적이 필요하다.

이 lane은 저장소만 만든다. 연구 수집 API·화면을 열거나 실제 참여자를 받는 것은 `docs/wedding-code/56_candidate5_research_spec_2026-07-17.md` §8–10의 게이트(동의 문구 검토, 삭제 리허설, 백업·복원 후 재삭제 증적 등)를 따로 통과해야 한다.

## 선행 조건

- 운영 `supabase_migrations.schema_migrations`에 233 `20260915101500_amora_atomic_not_applicable_status`가 **검토한 원문 그대로** 있어야 한다. 없으면 runtime이 원격에 쓰지 않고 멈추며, 233을 먼저 적용하는 정확한 순서를 오류 문구로 안내한다. 233은 migration SQL이 233개인 커밋 `965f9f37ea486b7b6d8f9dcd8516e2eb7e381a31`의 깨끗한 checkout에서 `--amora-not-applicable-status`로만 실행된다. **이 checkout(234개)에서는 233을 실행할 수 없다.**
- `schema_migrations`에 행을 손으로 넣지 않는다. `supabase db push`, `--include-all`, SQL Editor 임의 실행을 쓰지 않는다.

## 적용 순서

1. 모든 관련 검사를 통과한 **깨끗한 Git commit**을 고정한다. 기존 233개 SQL 원문과 선행 계약·runtime 핀은 그대로다. 로컬 정적 검사:

   ```powershell
   corepack pnpm supabase:release:fence --wedding-code-research-contributions
   ```

   기대 출력: `WeddingCode research contributions contract verified (234 exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).` 이것은 로컬 원문 검사이며 운영 인가가 아니다.
2. **사람 검토(필수).** 적용 단계마다 운영 책임자가 해당 commit, 고정 프로젝트 `slrtobkksjmxgzatjyqb` / system identifier `7581440907192989109`, 새 SQL 범위(위 목록), 직전 단계 영수증을 직접 확인하고 다음 단계를 승인한다. 에이전트나 자동화가 승인을 대신하지 않는다.
3. `--inspect`: 읽기 전용 트랜잭션에서 대상 식별값, 선행 233 이력 원문, 새 객체 부재(또는 이미 적용된 객체의 정확한 정의·ACL), 새 객체만 제외한 public/auth/storage catalog 해시, 이력 해시를 읽는다. 고객 행은 읽지 않는다.
4. `--rehearse`: 실제 DDL과 이력 기록을 한 트랜잭션에서 실행하고 ROLLBACK한다. 다시 읽어 새 객체 부재, 이력·비대상 catalog 해시 복귀를 확인한다. 이것이 운영 권한으로 DDL이 실제로 되는지의 증거다.
5. 독립 검토 후 `--apply`: 매번 새로 관측하고 자체 예행·ROLLBACK·재관측을 다시 수행한 뒤, 같은 bundle을 한 번 COMMIT한다. 외부의 오래된 예행 영수증으로 예행을 건너뛸 수 없다. 트랜잭션 안의 사후 검사가 두 테이블·세 함수의 정확한 정의·RLS·정책 없음·테이블/함수 ACL, 비대상 catalog 보존, 이력 한 건 추가를 확인하고, 어긋나면 전체를 되돌린다. 그 뒤 별도 읽기로 한 번 더 확인한다.

```powershell
# $commit: 검토한 40자리 commit. $receipt: 아직 없는 절대 경로의 JSONL 파일.
# $mode: inspect, rehearse, apply 중 이번에 승인된 단계 하나만.
$mode = 'inspect'
$commit = '<검토한 40자리 commit>'
$receipt = 'C:\absolute\private-output\wedding-code-research-inspect.jsonl'
corepack pnpm supabase:release:apply --wedding-code-research-contributions "--$mode" "--expected-commit=$commit" --project-ref=slrtobkksjmxgzatjyqb "--receipt-out=$receipt" "--confirm-production=wedding-code-research-contributions-20260915:slrtobkksjmxgzatjyqb:${mode}:$commit"
```

고정 HTTPS Management API(`/v1/projects/{ref}/database/query`)만 쓴다. SQL 파일·URL·테이블을 인자로 바꾸는 범용 DDL 인터페이스는 없다. 233·232 공개 모드는 234번째 SQL이 있는 checkout을 계속 거절한다.

## 환경 변수

- 필요: `SUPABASE_ACCESS_TOKEN` — 승인된 로컬 환경에서만 공급한다. 명령 인자·영수증·로그·문서에 값을 넣지 않는다.
- 설정되어 있으면 거절: `SUPABASE_CLI_BINARY_OVERRIDE`, `NODE_OPTIONS`, `NODE_PATH`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_GLOBAL`, `GIT_CEILING_DIRECTORIES`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>`.

## 실패와 되돌리기

- 영수증은 새 파일로 독점 생성하고, 원격 변경 전에 결과 미확정 기록을 fsync한다. 경로·짧은 쓰기·디스크 실패는 변경 시작 전에 멈춘다.
- 응답 유실·예행 복귀 불일치·기한(2분) 만료·적용 후 확인 실패는 `WEDDING_CODE_RESEARCH_OUTCOME_REQUIRES_INSPECTION`이다. **자동 재시도·역적용·이력 수선을 하지 않는다.** 새 영수증 경로로 `--inspect`부터 다시 실행해 실제 상태를 확인한다.
- 적용 후 되돌려야 하면: 먼저 이 저장소를 쓰는 앱 경로(아직 없음)를 닫는 제품 변경을 검토한다. 새 테이블·함수를 자동 DROP하지 않는다. 행이 생긴 뒤의 제거는 보유 기간·삭제 receipt 계약을 지키는 **별도 검토 migration과 release lane**으로만 한다. 저장소가 비어 있고 앱 경로가 없으면 새 객체는 기존 기능에 영향이 없으므로 additive 상태로 두는 것이 기본이다.

## 검증 근거와 한계

- 로컬 정적: 234 계약 원문 핀, 233 이하 전체 핀, SQL 범위 검사(과거 수집 객체 이름·계정/네트워크 식별자·정책·권한 확대·이력 쓰기 금지), 새 SQL을 끼워 넣거나 핀을 바꾸면 거절.
- 런타임 모의: 성공, inspect/rehearse/이미 적용, 인자·확인 문자열 오류, 대상·선행 이력·catalog·ACL 드리프트, 예행 실패, 기한·영수증 실패, 응답 유실, 사후조건 실패.
- PGlite(PostgreSQL 18): 실제 관측식과 적용 bundle의 예행·ROLLBACK·COMMIT, 함수 동작(권한 경계, 형식 거절, 중복 hash `23505`, 삭제·tombstone, 재저장 거절, UTC 날짜 절삭과 절삭 안 된 값 거절, 만료·tombstone 행 정리와 반환 개수, 60일 상한).
- 로컬 native PostgreSQL 17.10(있을 때만): 실제 PG17 catalog가 기대 정의와 정확히 같음(3인자 `date_trunc` CHECK 포함), 기존 행 보존, 역할 경계, 같은 hash의 저장·삭제 동시 실행 직렬화, 세션 시간대가 `Asia/Seoul`이어도 UTC 자정 저장, 중복 hash `23505`, tombstone 행 purge, ACL 드리프트 거절. PG17 바이너리가 없는 CI에서는 이 검사만 명시적으로 skip된다.
- 운영 Supabase의 기본 권한·이벤트 트리거가 새 객체 ACL을 기대와 다르게 만들 가능성은 로컬에서 재현하지 않았다. 그런 경우 `--rehearse` 트랜잭션 안의 사후 검사(`WEDDING_CODE_RESEARCH_AFTER_DRIFT`)가 실패해 전체가 ROLLBACK되고, 실행기는 `WEDDING_CODE_RESEARCH_OUTCOME_REQUIRES_INSPECTION`으로 멈춘다. 적용 전에 드러나며, 그 상태에서 `--apply`로 넘어가지 않는다.
