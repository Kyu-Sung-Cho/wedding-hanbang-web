# WeddingCode 연구 기여 저장소: 235 장면 버전 v0.9 허용 DB 적용

상태: **2026-09-17 운영 적용 완료.** 커밋 `754a7a0d2b727419147d4cd1f69f61859757e3c0`의 깨끗한 checkout에서 아래 순서대로 실행했고 영수증 상태는 `inspected-unapplied` → `rehearsed-and-rolled-back` → `applied-and-postverified` → `already-applied-verified`(사후 읽기)였다. 영수증 파일은 저장소 밖 비공개 보관 폴더에 둔다. 아래 절차는 다시 확인하거나 다른 환경에 적용할 때 그대로 쓴다. 이 lane은 migration SQL이 정확히 235개인 checkout(235를 main에 넣은 병합 커밋 `d643b5f49043ac2a97752cd5df516a9ba8d402e0` 등)에서만 실행된다. 236번째 SQL(`20260918090000_wedding_code_research_scene_v10.sql`)이 있는 checkout에서는 아래 정적 검사와 실행기가 `NEW_MIGRATION_NOT_REVIEWED`로 거절하며, 그 다음 단계는 `WEDDING_CODE_RESEARCH_SCENE_V10_RELEASE_2026-09-18.md`를 따른다.

## 왜 하는가

WeddingCode 장면 세트가 v0.9로 바뀐다. 답 형식은 그대로(`A`–`D`·`-` 20자리, 적어도 한 글자는 답)지만, 234가 만든 저장소는 `scene_version`으로 `'v0.8-code'`만 받는다. 이대로면 v0.9 장면에서 나온 답은 저장 함수 안에서 CHECK 위반(SQLSTATE `23514`)으로 거절된다.

- 장면이 다르면 같은 글자도 다른 질문의 답이다. 그래서 v0.9 답을 v0.8로 적어 넣지 않고, **버전을 그대로 남겨 분석을 `scene_version`별로 따로** 한다. 두 버전을 한 표본으로 섞지 않는다.
- 이미 저장된 행은 전부 `'v0.8-code'`이며 이 migration은 행을 읽지도 바꾸지도 않는다.
- **넓히기만 한다.** 허용 목록에 `'v0.9-code'` 하나를 더할 뿐 다른 규칙은 그대로다.

## 범위

`supabase/migrations/20260917090000_wedding_code_research_scene_v09.sql` 한 건(235번째 SQL)이다. 한 트랜잭션에서:

```sql
ALTER TABLE public.wedding_code_research_contributions
  DROP CONSTRAINT wcr_contributions_scene_version,
  ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version IN ('v0.8-code', 'v0.9-code'));
```

그 뒤 같은 트랜잭션의 검증 블록이 다음을 다시 확인하고, 하나라도 어긋나면 `RAISE EXCEPTION`으로 전체를 되돌린다.

- 새 CHECK의 PostgreSQL 역파싱 정의가 정확히 `CHECK (scene_version = ANY (ARRAY['v0.8-code'::text, 'v0.9-code'::text]))`이고 검증된(validated) 상태인지.
- 응답 테이블의 제약(NOT NULL 제외)이 234와 같은 8개인지.
- 두 테이블 모두 RLS 사용·정책 없음·`anon`/`authenticated`/`service_role`의 테이블·열 권한 없음인지.
- 소유자 권한 함수 세 개(`insert_…`/`delete_…`/`purge_expired_…`)가 있고, `SECURITY DEFINER`·`search_path=""`·본문(prosrc) MD5가 234 원문 그대로이며, `anon`/`authenticated`는 실행 불가·`service_role`만 실행 가능한지.

바꾸지 않는 것: 답 코드·동의 버전·receipt hash·보유 기간·날짜 절삭 CHECK, 인덱스, 테이블·함수 권한, RLS, 함수 본문, tombstone 테이블, 기존 행. 새 객체는 없다.

정적 범위 검사(`scripts/lib/wedding-code-research-scene-v09-release-contract.mjs`)는 주석 줄(`-- `)을 뺀 실행 원문 전체가 위 ALTER와 검증 블록 하나와 **한 글자도 다르지 않을 때만** 통과시킨다. 정규식으로 넓히기, `'v0.8-code'` 빼기, 다른 값 더하기, `NOT VALID`, 문장 추가(GRANT·UPDATE·함수 교체·이력 쓰기 등), 검증 블록 약화, CRLF, 앞 문장 추가는 전부 거절된다. 원문 바이트는 계약의 sha256이 따로 고정한다.

## 선행 조건

- 운영 `supabase_migrations.schema_migrations`에 234 `20260915130000_wedding_code_research_contributions`가 **검토한 원문 그대로** 있어야 한다. 234는 2026-09-16 운영에 적용됐다(`WEDDING_CODE_RESEARCH_CONTRIBUTIONS_RELEASE_2026-09-15.md` 상태 줄). 실행기는 매번 이 행과 234 객체의 정확한 정의를 다시 읽고, 없거나 다르면 원격에 쓰지 않고 멈춘다.
  - 행이 없으면 `WEDDING_CODE_SCENE_VERSION_PREDECESSOR_NOT_APPLIED`와 함께 234를 먼저 적용하는 순서를 안내한다. 234는 migration SQL이 234개인 커밋 `fab8d67e7994590c58dbf4d1c60ae34bfabc5595`(234를 main에 넣은 병합 커밋)의 깨끗한 checkout에서 `--wedding-code-research-contributions`로만 실행된다. **이 checkout(235개)에서는 234 lane을 실행할 수 없고, 234 정적 검사도 `NEW_MIGRATION_NOT_REVIEWED`로 거절된다(설계).**
  - 행이 다르면 `WEDDING_CODE_SCENE_VERSION_PREDECESSOR_LEDGER_MISMATCH`로 멈춘다. 행을 고치거나 234를 다시 적용하지 말고 누가 기록했는지부터 확인한다.
- **앱 순서.** `'v0.9-code'`를 보내는 앱 경로는 이 migration이 운영에 적용되고 사후 읽기(`already-applied-verified`)까지 확인된 **뒤에** 연다. 그 전에 열면 v0.9 답이 전부 CHECK 위반으로 저장되지 않는다.
- `schema_migrations`에 행을 손으로 넣지 않는다. `supabase db push`, `--include-all`, SQL Editor 임의 실행을 쓰지 않는다.

## 적용 순서

1. 모든 관련 검사를 통과한 **깨끗한 Git commit**을 고정한다(`git status --porcelain`이 비어 있어야 실행기가 진행한다). 기존 234개 SQL 원문과 선행 계약·runtime 핀은 그대로다. 로컬 정적 검사:

   ```powershell
   node scripts/supabase-release-fence.mjs --wedding-code-research-scene-v09
   ```

   기대 출력: `WeddingCode research scene v0.9 contract verified (235 exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).` 이것은 로컬 원문 검사이며 운영 인가가 아니다. (`corepack pnpm supabase:release:fence --wedding-code-research-scene-v09`도 같은 스크립트다.)
2. **사람 검토(필수).** 단계마다 운영 책임자가 해당 commit, 고정 프로젝트 `slrtobkksjmxgzatjyqb` / system identifier `7581440907192989109`, 위 SQL 범위, 직전 단계 영수증을 직접 확인하고 다음 단계를 승인한다. 에이전트나 자동화가 승인을 대신하지 않는다.
3. `--inspect`: 읽기 전용 트랜잭션에서 대상 식별값, 선행 234 이력 원문, 234 객체(두 테이블·세 함수)의 정확한 정의·ACL(적용 전이면 v0.8 전용 CHECK), 그 밖의 public/auth/storage catalog 해시, 이력 해시를 읽는다. 연구 응답 행은 읽지 않는다. 기대 결과 `inspected-unapplied`.
4. `--rehearse`: 실제 ALTER·검증 블록·이력 기록을 한 트랜잭션에서 실행하고 ROLLBACK한다. 다시 읽어 CHECK·이력·비대상 catalog가 그대로인지 확인한다. 이것이 운영 권한·운영 행으로 CHECK 교체와 기존 행 검증이 실제로 되는지의 증거다. 기대 결과 `rehearsed-and-rolled-back`.
5. 독립 검토 후 `--apply`: 매번 새로 관측하고 자체 예행·ROLLBACK·재관측을 다시 수행한 뒤, 같은 bundle을 한 번 COMMIT한다. 외부의 오래된 예행 영수증으로 예행을 건너뛸 수 없다. 트랜잭션 안의 사후 검사가 두 테이블·세 함수의 정확한 정의(CHECK 한 줄만 바뀜), 비대상 catalog 보존, 이력 한 건 추가를 확인하고, 어긋나면 전체를 되돌린다. 그 뒤 별도 읽기로 한 번 더 확인한다. 기대 결과 `applied-and-postverified`.
6. **사후 읽기(read-back).** 새 영수증 경로로 `--inspect`를 한 번 더 실행한다. 이력 `20260917090000` 행의 원문 MD5, 넓어진 CHECK를 포함한 234 객체 정의 전체, 234 이력 행을 다시 확인한다. 기대 결과 `already-applied-verified`. 이 결과를 본 뒤에 앱 경로를 연다.

```powershell
# 저장소 루트(깨끗한 checkout)에서 실행한다.
# $commit: 검토한 40자리 commit(git rev-parse HEAD). $out: 저장소 밖의 실제 폴더(심볼릭 링크 아님).
# 영수증 파일은 매번 아직 없는 새 경로여야 한다. 한 번에 승인된 단계 하나만 실행한다.
$commit = '<검토한 40자리 commit>'
$out = 'C:\absolute\private-output'
$ref = 'slrtobkksjmxgzatjyqb'
$release = 'wedding-code-research-scene-v09-20260917'

# 3) inspect — 기대: SUPABASE_PRODUCTION_RELEASE_VERIFIED: inspected-unapplied
node scripts/supabase-production-release.mjs --wedding-code-research-scene-v09 --inspect "--expected-commit=$commit" "--project-ref=$ref" "--receipt-out=$out\wedding-code-scene-v09-1-inspect.jsonl" "--confirm-production=${release}:${ref}:inspect:$commit"

# 4) rehearse — 기대: SUPABASE_PRODUCTION_RELEASE_VERIFIED: rehearsed-and-rolled-back
node scripts/supabase-production-release.mjs --wedding-code-research-scene-v09 --rehearse "--expected-commit=$commit" "--project-ref=$ref" "--receipt-out=$out\wedding-code-scene-v09-2-rehearse.jsonl" "--confirm-production=${release}:${ref}:rehearse:$commit"

# 5) apply — 기대: SUPABASE_PRODUCTION_RELEASE_VERIFIED: applied-and-postverified
node scripts/supabase-production-release.mjs --wedding-code-research-scene-v09 --apply "--expected-commit=$commit" "--project-ref=$ref" "--receipt-out=$out\wedding-code-scene-v09-3-apply.jsonl" "--confirm-production=${release}:${ref}:apply:$commit"

# 6) read-back(inspect 재실행) — 기대: SUPABASE_PRODUCTION_RELEASE_VERIFIED: already-applied-verified
node scripts/supabase-production-release.mjs --wedding-code-research-scene-v09 --inspect "--expected-commit=$commit" "--project-ref=$ref" "--receipt-out=$out\wedding-code-scene-v09-4-readback.jsonl" "--confirm-production=${release}:${ref}:inspect:$commit"
```

`node scripts/supabase-production-release.mjs`는 `supabase:release:apply` 스크립트와 같은 진입점이다. 고정 HTTPS Management API(`/v1/projects/{ref}/database/query`)만 쓴다. SQL 파일·URL·테이블을 인자로 바꾸는 범용 DDL 인터페이스는 없다. 확인 문자열의 `<mode>` 자리는 실행하는 단계와 같아야 한다(`inspect`로 확인하고 `--apply`를 부르면 거절). 234·233 공개 모드는 235번째 SQL이 있는 checkout을 계속 거절한다.

영수증은 한 줄에 한 JSON이다. 각 줄에 `format: wedding-code-research-scene-v09-runtime-v1`, `release`, `mode`, `releaseCommit`, 계약·SQL·runtime sha256이 붙는다. 단계 기록 순서는 `started` → `before-observed` → (inspect) `inspected-unapplied` 또는 `already-applied-verified` / (rehearse·apply) `rehearsal-outcome-unverified` → `rehearsed-and-rolled-back` → (apply) `apply-outcome-unverified` → `applied-and-postverified`. 실패하면 마지막 줄이 `blocked-before-mutation`(원격 변경 전) 또는 `outcome-requires-readonly-inspection`(변경 시작 후)이다. 영수증은 저장소 밖에 보관하고 Git·문서에 원문을 옮기지 않는다.

## 환경 변수

- 필요: `SUPABASE_ACCESS_TOKEN` — 승인된 로컬 환경에서만 공급한다. 명령 인자·영수증·로그·문서에 값을 넣지 않는다.
- 설정되어 있으면 거절: `SUPABASE_CLI_BINARY_OVERRIDE`, `NODE_OPTIONS`, `NODE_PATH`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG_GLOBAL`, `GIT_CEILING_DIRECTORIES`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>`.

## 실패와 되돌리기

- 영수증은 새 파일로 독점 생성하고, 원격 변경 전에 결과 미확정 기록을 fsync한다. 경로·짧은 쓰기·디스크 실패는 변경 시작 전에 멈춘다.
- **잠금.** `ALTER TABLE`은 응답 테이블에 `ACCESS EXCLUSIVE` 잠금을 잡고, 기존 행 전체로 새 CHECK를 검증한다. `lock_timeout`은 5초다. 저장·삭제·정리 트랜잭션이 잠금을 쥐고 있으면 5초 안에 포기하고(`55P03`) 아무것도 바꾸지 않는다. 이 경우 실행기는 `WEDDING_CODE_SCENE_VERSION_OUTCOME_REQUIRES_INSPECTION`으로 멈추므로, 새 영수증 경로로 `--inspect`부터 다시 실행해 미적용을 확인한 뒤 요청이 적은 시간에 다시 시도한다.
- 응답 유실·예행 복귀 불일치·기한(2분) 만료·적용 후 확인 실패도 `WEDDING_CODE_SCENE_VERSION_OUTCOME_REQUIRES_INSPECTION`이다. **자동 재시도·역적용·이력 수선을 하지 않는다.** 새 영수증 경로로 `--inspect`부터 다시 실행해 실제 상태(`inspected-unapplied` 또는 `already-applied-verified`)를 확인한다.
- **적용 후 되돌리기 = 기여 플래그 끄기.** v0.9 답을 더 받지 않으려면 앱의 `WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED`를 `false`로 되돌린다(`WEDDING_CODE_RESEARCH_RECEIPT_SECRET`은 유지해 삭제·보유 기간 처리가 계속 돌게 한다).
- **CHECK를 다시 좁히지 않는다.** `'v0.8-code'`만 받게 되돌리는 migration은 이미 저장된 `'v0.9-code'` 행 때문에 실패하거나, 그 행을 참여자의 삭제 receipt·60일 보유 계약 밖에서 지워야 한다. 넓어진 CHECK는 앱 경로가 닫혀 있으면 기존 기능에 영향이 없으므로 그대로 두는 것이 기본이다. 행 제거가 정말 필요하면 보유 기간·삭제 receipt 계약을 지키는 **별도 검토 migration과 release lane**으로만 한다.

## 검증 근거와 한계

- 로컬 정적(`scripts/tests/wedding-code-research-scene-v09-release-contract.test.mjs`): 235 계약 원문 핀, 234 이하 전체 핀, 실행 원문 완전일치 범위 검사와 심은 위반 거절, 새 SQL을 끼워 넣거나 핀을 바꾸면 거절, 234 공개 모드·234 후속 계약이 이 checkout을 거절, 정적 CLI 인자 혼합 거절.
- 런타임 모의(`scripts/tests/wedding-code-research-scene-v09-runtime.test.mjs`): 성공, inspect/rehearse/이미 적용, 인자·확인 문자열 오류, 대상·선행 이력·catalog(234 객체 없음, 이력 없이 CHECK만 넓어짐, 다른 식으로 넓어짐, v0.8 빠짐)·ACL·함수 드리프트, 예행 실패·복귀 불일치, 기한·영수증 실패, 응답 유실, 사후조건 실패. PGlite(PostgreSQL 18)에서 234 적용 상태 위에 실제 관측식과 적용 bundle의 예행·ROLLBACK·기준선 드리프트 거절·COMMIT.
- PGlite 동작(`apps/web/src/lib/__tests__/weddingCodeResearchSceneV09Migration.test.ts`): 234→235 순서 적용, 기존 v0.8 행 보존, 함수로 `v0.9-code`·`v0.8-code` 저장, `v1.0-code`·빈 문자열 등 거절, v0.9에서도 답 코드 규칙 유지, 다른 제약 정의 불변, 권한·RLS·함수 본문 불변, 검증 블록이 13가지 위반을 각각 거절, 검증 실패 시 CHECK가 v0.8 전용으로 남음, 234 없이 적용 불가. (234 자체 동작은 `apps/web/src/lib/weddingCode/__tests__/weddingCodeResearchContributionsMigration.test.ts`가 맡는다.)
- 로컬 native PostgreSQL 17.10(있을 때만, `scripts/tests/wedding-code-research-scene-v09-catalog.test.mjs`): 실제 PG17 역파싱 CHECK 문자열이 기대와 같음, 예행 ROLLBACK, 저장 트랜잭션이 잠금을 쥔 동안 적용이 `lock_timeout`으로 약 5초 뒤 `55P03`을 내고 아무것도 바꾸지 않음, 적용 후 기존 행·비대상 catalog 보존, 역할 경계, CHECK·ACL 드리프트 거절. PG17 바이너리가 없는 CI에서는 이 검사만 명시적으로 skip된다.
- 운영 응답 테이블의 행 수와 쓰기 빈도는 이 lane이 읽지 않는다(연구 응답 행 비열람). CHECK 검증 시간과 잠금 경합은 운영 `--rehearse`가 실제로 드러낸다. 운영 Supabase의 이벤트 트리거가 ALTER 뒤 권한을 바꾸는 경우는 로컬에서 재현하지 않았다. 그런 경우 `--rehearse` 트랜잭션 안의 검증 블록 또는 사후 검사(`WEDDING_CODE_SCENE_VERSION_AFTER_DRIFT`)가 실패해 전체가 ROLLBACK되고, 적용 전에 드러난다.
- 이 lane은 벤더 공시 릴리스 매니페스트를 바꾸지 않는다. 후속 migration은 `validateSuccessorReleaseContract`의 후속 계약(`wedding-code-research-scene-v09`)으로만 디렉터리 목록에 더해지므로, 프로덕션 빌드 서명(`VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION`) 값은 그대로다.
