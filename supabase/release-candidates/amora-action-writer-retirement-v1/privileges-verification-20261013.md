# B2 scoped privilege observation — 검증·인계 계약

2026-10-13. 이 산출물은 **READ ONLY catalog 관찰/내용 검증 + 소유 로컬 PG17 테스트**다. 운영 적용·복구·B2 source242 등록·릴리스 승인 증거가 아니다. B1 source241와 frozen SQL 4개는 변경하지 않았다. 새 파일만 이 candidate 폴더 안에 추가했다.

## 고정 산출물

| 파일 | SHA256 |
|---|---|
| `privileges-observation.mjs` | `d74b4d576ccc2557df3e922c05d09b44d6440f6e64bf4313c1ee3b50b4019d55` |
| `privileges-observation.test.mjs` | `7130a8e463fffbd1ff477125b5bccaa982b4e5aa6bf0eeec2f03d42ae596709f` |
| `privileges-fixture.mjs` (독립 초기 fixture + 승인된 status 후속) | `698f10019a144fd44c98e125576d12f2d781ebecd810468653ea471effef2f13` |

이전 source80cea/test6c71/fixture271858의 전체 실행: `node --test supabase/release-candidates/amora-action-writer-retirement-v1/privileges-observation.test.mjs` → **17 PASS / 0 FAIL / 0 SKIP / exit0 / 176237.5086ms**. 이 17에는 non-generic hash 형식 선택 실행 1개가 포함됐다. status 후속 source65f946/test0fa8/fixture698f10의 전체18은 **14 PASS / 2 FAIL / 2 CANCEL / exit1 / 540865.4815ms**였다. actual status native before/after+LF 거절과 일반 before/after positive는 GREEN이지만, 오래 공유한 before snapshot의 정상120초 만료가 다른 metadata-error보다 먼저 발생했고 로컬 주그룹300초 timeout/cancel도 있었다. 구 harness50초 선택 실행은 cancelled1/exit1로 별도 기록한다. test379a의 harness 정리도 아직 실행하지 않았으며, 현재 test7130은 그 정리에 승인된 journey column SET/ADMIN 회귀2를 더한 상태다. **현재 source d74b/test7130의 public native20 전체 및 신규 native2는 아직 실행하지 않았다.** 현재 exact-source pure 술어2는 GREEN/exit0이지만 native20의 성공이 아니다. 이전17이나 개별GREEN을 현재 전체 성공으로 승격하지 않는다. 운영 freshness120초를 늘리거나 승인용 캡처 시각을 바꾸지 않았다. 과거15/선택1/cutover19/companion13/manual62/AI5/recovery11을 더해 총 테스트 수를 만들지 않는다.

부모의 test-only 승인을 따라 모든 metadata shape negative 바로 전에 actual READ ONLY query를 다시 실행하도록 바꿨다. after-role case는 다른 긴 negative들과 snapshot/권한 변화를 공유하지 않는 새 owned fixture의 actual before→frozen4→after pair로 이동했다. 기존18 사례의 기대값을 보존하고 named security 회귀2만 추가했다. fixture698f10, 원문4/B1 source241/운영120초·미래10초/실제ID는 변경하지 않았다. 만료를 검증하는 기존2020 불량입력은 거절용 negative일 뿐 새 승인 snapshot/대체 시계가 아니다. 부모의 전역 검사 종료·실행 허가 전에는 새 native를 시작하지 않으며, 준비된 재실행 명령은 위와 같다. module/test의 `node --check`와 scoped `git diff --check`는 exit0이다. 이것을 native GREEN으로 세지 않는다.

운영 SQL/API 호출, 새 자격증명·유료 clone·프로젝트·private artifact 생성, 커밋·배포는 이 담당자 작업에서 모두 0이다. 독립 담당은 새 fixture만 작성했다.

## 정확 API와 반환 alias

```js
import {
  buildAmoraWriterPrivilegesObservationSql,
  validateAmoraWriterPrivilegesObservation,
} from './supabase/release-candidates/amora-action-writer-retirement-v1/privileges-observation.mjs';

const sql = buildAmoraWriterPrivilegesObservationSql({repoRoot, phase: 'before'});
// 고정 기존 프로젝트의 실제 READ ONLY transport는 운영 담당이 실행한다.
// SQL의 단일 JSONB 반환 alias는 observation이다.

const receipt = validateAmoraWriterPrivilegesObservation(observation, {
  repoRoot,
  phase: 'before',
  expectedNativeSystemIdentifier: null,
  beforeObservation: null,
});

// after는 같은 실제 system/database에서 수집한 fresh before 원문이 필수다.
const afterReceipt = validateAmoraWriterPrivilegesObservation(afterObservation, {
  repoRoot,
  phase: 'after',
  expectedNativeSystemIdentifier: null,
  beforeObservation,
});
```

native는 `expectedNativeSystemIdentifier`에 실제 owned PG17에서 별도 조회한 local system ID만 넣는다. 운영 ID `7581440907192989109`를 native 값으로 사용하면 거절한다. 운영 content lane은 이 ID, `postgres` DB, PG17, `postgres` 또는 provider READ ONLY observer `supabase_read_only_user`만 받는다. freshness는 실제 현재 시각 기준 120초/미래 10초이며 caller `now`, skip/verified/expected-catalog 입력은 받지 않는다.

SQL은 8063 bytes/before SHA `37a481e2027f7a3e3115292144e94e1e01dfa283cffe1950c854536045482db4`, 8062 bytes/after SHA `f7bd79c5eaf9195af13e4b63a617966e756dedc083ea839f5e49cd7d4579a465`다. alias 등을 바꾸면 새 SQL hash가 되며 원 pin을 주장하지 않는다. query는 `BEGIN READ ONLY`/고정 timeout/search_path/SELECT/COMMIT만 반환한다. 고객 row/count/value, 자격증명, `pg_authid`/password, 함수 원문은 조회 결과에 포함하지 않는다. 반환 원문은 role/table/column/function/trigger/schema/default ACL metadata와 hash다.

현재 loader는 B1 strict source241와 원문 pin을 요구한다. 향후 formal source242 등록 뒤 이 모듈을 그대로 운영 B2 admission으로 승격하지 않는다. 별도의 승인 B2 loader/runtime integration이 필요하며 기존 B1 loader를 느슨하게 하지 않는다.

## before/after와 B1 전 진단의 차이

- `before`: B1이 실제 적용된 상태다. B1 두 함수·v2 timestamp trigger를 포함한 target 함수19, canonical trigger2, journey trigger8이 정확해야 한다. B2 새 함수/trigger 슬롯은 없어야 한다.
- `after`: frozen4를 설치한 로컬 후보 상태다. target 함수21, canonical trigger3, journey trigger9가 정확해야 한다. 서비스 canonical UPDATE와 any/all column UPDATE는 false다. 다른 service table privileges 및 authenticated SELECT 등 기존 계약은 그대로다.
- B1 적용 전 query 자체는 실행 가능하다. 누락 v2 함수2와 generic timestamp 등 실제 상태를 그대로 반환한다. **함수17인 B1 전 진단을 before-compatible/릴리스·복구 성공으로 인정하지 않는다.** validator는 누락 target를 거절한다. 누락 함수를 합성해 채워 넣거나 운영/local ID·시각을 치환하지 않는다.

`receipt.status`는 `catalog-compatible-before/after`이고 범위는 content-only다. `releaseAuthorized`, `executionProvenanceVerified`, `privateRecoveryVerified`, `fullSchemaVerified`, `ledgerVerified`, `remoteWritesPerformed`는 모두 false다. serializable JSON만으로 실제 transport·collector·clean Git/origin/CI·private original/replay·release fence·원장230→231·운영 COMMIT/postverify가 증명되지 않는다.

## 관찰·NO-GO 경계

실제 `pg_roles` 전체 flags, `pg_auth_members`의 grantor/admin/inherit/set, actor별 MEMBER/USAGE/SET, raw/expanded table·column ACL, actor 및 다른 role의 effective table/column 권한, public schema ACL/effective USAGE/CREATE, postgres global/public function default ACL, 모든 target 함수 effective EXECUTE를 관찰한다.

정확 body SHA256/MD5와 owner/result/language/security/config/strict/volatility/parallel/cost/support/arguments/defaults 등 metadata를 고정 소스에 대조한다. generic timestamp는 실제204b body + whole-definition SHA7b39 + ACL5 한 쌍만 받는다. target 이름의 추가 overload, missing 함수, disabled/변형 trigger, drift한 기본 입력/ACL/hash 타입은 NO-GO다. before/after가 보존해야 할 roles/graph/schema/default ACL/column ACL/기존 함수 metadata를 같은 실제 before snapshot으로 대조한다.

즉시 NO-GO인 우회:

- 승인 table-only delta 밖의 column UPDATE grant, nominal REVOKE 뒤 남는 inherited UPDATE.
- 다른 current_user writer/owner/superuser 역할로 도달하는 USAGE/SET 경로.
- 현재 USAGE/SET=false여도 client가 기존 writer role의 ADMIN OPTION을 가지고 자기 SET membership을 다시 grant할 수 있는 경로.
- journey의 whole-table UPDATE가 false여도 다른 SET 역할 또는 ADMIN 대상 writer의 any-column UPDATE가 true인 경로. `UPDATE(progress)`만 있는 역할도 이 gate가 거절한다.
- frozen private guard REVOKE 대상 외 role에 주어진 postgres function default EXECUTE.
- 새 private guard에 남는 client/상속 effective EXECUTE, after service canonical/any/all column UPDATE.

이 판정기는 발견한 role/column/default ACL을 자동으로 고치거나 전역 REVOKE하지 않는다. 관찰한 direct DML 우회면 중단하고 정확한 최소 addendum을 별도 승인·테스트·freeze한다. BYPASSRLS를 쓰기 권한이나 승인 capability로 사용하지 않는다. 현재 보존한 DELETE/TRUNCATE, 임의 postgres/admin/DDL, 모든 future role 관리, 전체 DB/Auth/Storage를 방어한다고 주장하지 않는다.

## 실제 반례와 TDD

1. 동일 함수 body에 입력 DEFAULT만 바꾼 actual native 정의가 초기 validator를 통과했다(Missing expected exception RED). header arguments/defaultCount/defaults exact 비교 뒤 GREEN.
2. non-generic full-definition hash를 `[64hex]` 배열로 바꾸면 regex의 문자열 coercion으로 초기 validator가 받아들였다(실제 native metadata 기반 RED). string 타입·raw ACL string-array·시각/버전 타입 검사 뒤 GREEN. 이것은 mandatory metadata 형식 결함이며 운영 provenance나 DB write 우회로 과장하지 않는다.
3. authenticated→service_role ADMIN=true/INHERIT=false/SET=false를 설치했다. 실제 authenticated가 자기 membership SET=true를 grant하는 데 성공했지만 초기 validator는 거절하지 않았다(RED). 기존 target writer ADMIN 경로에 한정된 NO-GO gate 뒤 GREEN. 실제 proof transaction은 ROLLBACK하며 운영 role을 바꾸지 않는다.
4. null column ACL을 빈 ACL array로 바꿔 aclexplode하면 PG17이 22023을 냈다. 실제 nullable attacl을 그대로 펼쳐 빈 결과를 `[]`로 집계하도록 고쳐 정상 before/after 관찰이 GREEN이다.
5. 부모의 실제 B1 전 diagnostic17을 읽기 전용으로 대조했다. 16개 함수의 body SHA/header/owner/config/ACL 차이는0이고 status 본문 한 개는 actual CRLF였다. actual MD5 `aee9c4ab5fecc898ff52e1160decad22`/SHA `1ca50d98486ba9a8c90b6fcbdaa14bd01a2fa26737fc48a2b664f21e1b30dae4` vs repo LF MD5 `81845432224794db21b09bd8cf444b12`/SHA `b0459301f48a8f9d9313b6c319e1f5c704c88ecf7d60a33a6b86d35c849349f6`였다. 이 한 repo body의 LF→CRLF가 actual strong pair에 exact 일치한다. 실제 native CRLF 설치→기존 checker FUNCTION_DRIFT:bodyMd5 RED(44160.2384ms) 뒤 부모의 별도 한정 승인으로 before/after 기대값과 fixture를 수정했다. 관찰값 normalize/두 대안 허용/원문 capsule·운영 ID·시각 copy는 없다. 실제17 snapshot은 v2두 함수 부재/canonical generic timestamp인 B1 전 진단이지 before-compatible 또는 복구 증거가 아니다.
6. 독립 담당은 이전 module65f946의 실제 `validateBypasses` 술어를 추출해 pure synthetic rights 두 개를 확인했다(술어 SHA `dd184d94793922ccba8eed09d35009e39753de9783666f24d49a33b9b3f6c681`). 다른 SET 역할 또는 ADMIN-only writer에게 journey `UPDATE(progress)=true/anyColumnUpdate=true`, table UPDATE=false를 주면 둘 다 `Missing expected exception` RED였다. 같은 입력의 table UPDATE=true는 기존 gate가 거절했다. 부모 승인에 따라 SET writer와 ADMIN writer 판정에 `journeyRights.anyColumnUpdate`만 추가했다. 현재 d74b4d exact source SHA를 확인하고 같은 함수의 실제 술어를 추출한 인메모리2는 각각 REACHABLE_WRITER_BYPASS/ADMIN_WRITER_BYPASS로 거절하여 **pure2 GREEN/exit0**이다. 실제 owned PG17의 별도 fresh before 두 회귀를 작성했지만 아직 실행하지 않았다. pure 술어 RED→GREEN은 full validator/native/운영 DML 증거가 아니며, 부모 실제 diagnostic의 non-self SET/USAGE paths0와도 구분한다. 현재 운영 우회가 존재한다고 주장하지 않는다.

PG17의 테이블 privilege REVOKE는 같은 grant chain의 대응 column privileges도 제거한다. native 직접 service column 테스트에서 whole/any/title UPDATE가 모두 false가 됐다. 이를 직접 column grant가 남는 반례로 부르지 않는다. 다른 inherited 역할의 title UPDATE는 같은 nominal service table REVOKE 뒤 whole=false/any=true/title=true로 실제 남았다. 해당 두 경로를 별개 테스트로 유지했다. [PostgreSQL 17 REVOKE](https://www.postgresql.org/docs/17/sql-revoke.html), [PG17 privilege inquiry](https://www.postgresql.org/docs/17/functions-info.html).

## fixture 제한과 남은 실행 단계

fixture는 actual owned PG17.10 ID/시각을 유지한다. canonical16/journey14 column descriptors, writer6 owner/config/ACL, 실제 current journey8 guard body/slots, generic177와 B1 v2 source를 설치한다. 소유 cluster의 role flags/default ACL은 합성이며 전체 주변 AI/approval/booking/원장/Auth/Storage/schema 복제·기능 테스트가 아니다. 전체 source와 정상 create/수동 v2/일정/예산/AI add/reset/FK 기능의 증거는 기존 별도 계층과 미래 formal bundle 회귀를 계속 요구한다.

부모가 승인한 세 좁은 fixture seed/bridge만 있다: 비민감 generic177 actual timestamp definition seed, 기존 generic patch 한 body의 repo LF→actual CRLF(SHA `79bf17d9a7be4582f023dc64282ef03fda1c122c5f21ad40c9a6e9b1bf88ebab`/MD5 `8b4fa7b975715aa7cb6bcf076052c498`), 그리고 위 status 한 body의 actual CRLF strong pair다. 다른 원문·HOLD·private capsule·고객 정보·운영 ID/시각을 옮기지 않았다. 이 line-ending bridge는 source-only encoding 대조이지 실제 원본 캡처/복구 증거가 아니다.

운영 담당은 B1 완료 뒤 fresh 실제 READ ONLY query/strict validator를 다시 실행하고 source/원장/private original/native replay/release fence/정식 B2 bundle 승인을 결합해야 한다. rollback-before-commit/forward-fix-after-commit을 유지한다. B1 전 오래된 diagnostic 파일이나 이번 로컬17 PASS를 실제 적용 허가로 승격하지 않는다.

이 tracked report와 module d74b/test7130/fixture698f는 부모의 B1 commit/CI를 위해 이 상태로 동결한다. 이후 승인된 native20 실제 실행 결과는 ignored `.verification`/PR 후속에만 남긴다. 이 정적 문서가 현재 whole/native/운영 false를 성공으로 바꾸지는 않는다.
