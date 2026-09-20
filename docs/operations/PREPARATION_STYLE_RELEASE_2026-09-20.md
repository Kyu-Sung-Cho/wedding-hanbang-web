# 우리의 준비 스타일: 237 계정 저장·상호 공유 DB 릴리스

상태: 구현·로컬 검증 단계. 운영 적용 및 사후 읽기는 아직 수행하지 않았다. 로컬 정적 계약, 합성 DB 검증, 운영 적용 증거를 구분한다.

## 변경 범위와 선택

로그인한 이용자가 웨딩코드 답을 계정에 보관하고, 연결된 상대와 양쪽이 각각 공유에 동의했을 때 두 사람 결과를 다시 보는 기능이다. 기존 공개 코드 링크나 연구 기여 저장소와 별도이며, 자동 공유·연구 참여·프로필 유형 추론을 만들지 않는다.

기존 연구 기여 테이블에 계정 식별자를 붙이는 안과 전용 비공개 저장소를 만드는 안을 비교했다. 익명 연구·동의·삭제 경계를 섞지 않도록 전용 저장소를 채택했다. 기존 릴리스의 허용 목록을 넓히는 대신 236개 원문을 보존하고 정확히 한 migration을 더하는 237 후속 계약을 채택한다.

- SQL: `supabase/migrations/20260920120000_wedding_preparation_style.sql`.
- 테이블 2개: `wedding_preparation_style_responses`, `wedding_preparation_style_shares`. FORCE RLS, 클라이언트 정책 없음, `anon`·`authenticated`·`service_role` 직접 테이블·열 권한 없음.
- 전용 revision sequence 1개. 클라이언트 및 service-role 직접 접근 없음.
- 인증 전용 RPC 5개: get/set/clear/share/unshare. 인증자 검증 및 삭제 진행 확인 후 자기 상태만 갱신한다. 답·공유의 갱신은 확인 번호를 비교해 오래된 요청을 거절한다.
- 직접 실행을 막은 내부 함수 3개: actor, 계정 삭제 정리, 커플 연결 변경 시 공유 철회.
- 기존 `account_deletion_jobs`, `profiles`, `couples`에 각각 트리거 1개를 추가한다. 기존 함수 본문·ACL·행은 변경하지 않으며 backfill은 없다.
- 전체 SQL·runtime·catalog 조회식·native PG17 기대 catalog를 새 계약에서 sha256으로 고정한다. 공유 권한이 의존하는 기존 `is_current_couple_member(uuid,uuid)`의 정의·설정·인자명·ACL도 20260716114000 원문에서 고정한다. Supabase가 관리하는 `auth.uid()`의 합성 fixture 정의를 운영 기대값으로 사용하지 않는다. 기존 signed manifest와 기존 runtime 핀은 바꾸지 않는다.

## 적용 전후 관문

`--preparation-style`는 고정 프로젝트 `slrtobkksjmxgzatjyqb`, PostgreSQL 17, system identifier `7581440907192989109`, `postgres` DB/role만 받는다. 깨끗한 Git checkout과 검토한 40자리 commit이 필요하다. 선행 236번째 migration의 ledger 한 행 원문을 검사하고, 나머지 ledger는 적용 전후 전체 해시가 보존되는지 확인한다. 이 lane이 선행 ledger 236개 전부를 개별 재검증하는 것은 아니다. 대상 SQL 경로·URL·테이블을 인자로 바꾸는 범용 인터페이스는 제공하지 않는다.

1. `node scripts/supabase-release-fence.mjs --preparation-style`: 237개 정확한 SQL과 후속 체인을 확인한다. 정적 통과는 운영 권한이나 운영 적용 증거가 아니다.
2. `--inspect`: READ ONLY 트랜잭션으로 목적지·선행 ledger·의존 객체·신규 대상 유무·public/auth/storage 비대상 catalog·ledger 해시를 관측한다. 사용자 답 행을 가져오지 않는다. 미적용 기대 상태는 `inspected-unapplied`.
3. `--rehearse`: 실제 SQL과 ledger 기록을 같은 트랜잭션으로 실행하고 대상 정의·권한·비대상 catalog 보존·신규 테이블 비어 있음·이력 한 행 추가를 검사한 뒤 ROLLBACK한다. 별도 관측으로 원상복귀를 확인한다. 기대 상태는 `rehearsed-and-rolled-back`.
4. `--apply`: 새로 inspect→자체 rehearsal→rollback→재관측→소스/핀 재확인 후, 동일 SQL bundle을 한 번 COMMIT한다. 다시 읽어 대상 catalog·기존 catalog·ledger 보존을 확인한다. 기대 상태는 `applied-and-postverified`.
5. 새 receipt 경로로 `--inspect`를 실행하여 `already-applied-verified`를 확인한다. 그 뒤에만 앱을 main에 병합·배포한다. Vercel production build fence는 정적 원문만 검사하므로 DB 적용 이전 머지를 대신 막아 주지 않는다.

```powershell
# 검토·승인 범위 안에서 한 단계씩 실행한다. 영수증은 저장소 밖 새 파일이다.
$releaseCommit = '<검토한 40자리 commit>'
$receiptDirectory = 'C:\absolute\private-output'
$projectRef = 'slrtobkksjmxgzatjyqb'
$releaseName = 'preparation-style-20260920'

node scripts/supabase-production-release.mjs --preparation-style --inspect "--expected-commit=$releaseCommit" "--project-ref=$projectRef" "--receipt-out=$receiptDirectory\preparation-style-1-inspect.jsonl" "--confirm-production=${releaseName}:${projectRef}:inspect:$releaseCommit"
node scripts/supabase-production-release.mjs --preparation-style --rehearse "--expected-commit=$releaseCommit" "--project-ref=$projectRef" "--receipt-out=$receiptDirectory\preparation-style-2-rehearse.jsonl" "--confirm-production=${releaseName}:${projectRef}:rehearse:$releaseCommit"
node scripts/supabase-production-release.mjs --preparation-style --apply "--expected-commit=$releaseCommit" "--project-ref=$projectRef" "--receipt-out=$receiptDirectory\preparation-style-3-apply.jsonl" "--confirm-production=${releaseName}:${projectRef}:apply:$releaseCommit"
node scripts/supabase-production-release.mjs --preparation-style --inspect "--expected-commit=$releaseCommit" "--project-ref=$projectRef" "--receipt-out=$receiptDirectory\preparation-style-4-readback.jsonl" "--confirm-production=${releaseName}:${projectRef}:inspect:$releaseCommit"
```

`SUPABASE_ACCESS_TOKEN`은 승인된 환경에서만 공급하며 인자·문서·로그에 값을 기록하지 않는다. 기존 production controller의 Git/Node/CLI 환경 주입 금지 규칙을 그대로 적용한다. 확인 문자열은 실행 모드와 commit에 결합한다.

## 실패와 복구

영수증은 새 파일로 독점 생성하고, 변경 전에 미확정 상태를 기록·fsync한다. 잠금 제한은 5초, 문장 제한은 30초, 관측부터 적용까지 유효 기간은 2분이다. runtime은 mutation 후 결과가 불명확하면 자동 재시도하지 않는다. `PREPARATION_STYLE_OUTCOME_REQUIRES_INSPECTION`이면 새 영수증으로 읽기 전용 inspect부터 실제 상태를 확인한다. ledger를 손으로 수정하거나 `supabase db push`, `--include-all`, 범용 SQL Editor로 우회하지 않는다.

앱을 되돌릴 때는 준비 스타일 화면의 새 쓰기 진입을 닫는다. 저장된 답을 임의 삭제하거나 RLS를 풀지 않고, 기존 계정 삭제·공유 철회 트리거와 저장소는 유지한다. 이미 생긴 이용자 데이터를 제거하는 DROP 역적용은 이 릴리스의 복구 경로가 아니다.

## 검증 범위와 한계

- 정적 테스트는 정확한 237 SQL·모든 선행 핀·새 SQL/runtime/catalog/fixture의 누락·변경·알 수 없는 SQL 추가를 거절한다. 236 이하 공개 모드는 새 checkout을 계속 거절하고 역사 fixture에서만 통과한다.
- runtime 테스트는 실제 분기에서 관측·rollback·재관측·소스 재확인·단일 commit·별도 readback 순서를 검사한다. 오래된 관측, 잘못된 대상·ACL·함수·트리거, receipt 실패, 응답 유실, 사후 catalog/ledger 불일치가 성공으로 처리되지 않아야 한다.
- native PG17 테스트는 로컬 합성 부모 객체와 고정된 선행 ledger를 준비해 실제 catalog 조회와 SQL bundle을 실행한다. rollback·잠금 경합 실패·commit·기존 객체 보존과 권한 drift를 검사하고, 실제 authenticated RPC로 양쪽 공유·철회·삭제 후 지연 요청 거절·계정 삭제 정리를 확인한다. 실제 운영 데이터·운영 이벤트 트리거가 있는 전체 DB 복원본은 아니다. PG17 바이너리가 없으면 명시적으로 skip하며 운영 증거로 바꾸어 말하지 않는다.
- 앱의 SQL 동작 회귀는 `preparationStyle.database.test.ts`가 별도로 검사한다. 최종 SQL 변경 후 기대 catalog와 계약을 다시 고정하고 관련 테스트·변이 검증을 재실행해야 한다.
- 운영 성공 여부는 위 단계의 비공개 receipt와 사후 관측으로만 확정한다. 이 문서의 절차나 로컬 성공은 운영 실행을 대신하지 않는다.
