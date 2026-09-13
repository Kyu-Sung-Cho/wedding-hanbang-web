# 사진 프로필 231 후속 릴리스

상태: 로컬 구현과 합성 PostgreSQL 17 검증. 운영 적용·실제 Storage 사진 교체/삭제 검증은 별도 실제 결과가 있어야 완료다. **W13 고객 원본 수집·복구는 미완료이며 이 계약은 그 증거가 아니다.**

## 현재 적용 범위와 과거 작업 구분

229 피드백 및 230 명시적 신랑/신부 역할의 SQL·계약·runtime 원문 핀을 유지한다. 230 공개 검사에 231을 끼워 넣지 않고 `--profile-avatar` 모드를 등록한다. CI의 정적 성공은 운영 DB 적용이나 기존 owner build authorization을 대신하지 않는다.

과거 `profile-avatar-service-only.sql`은 전체 Storage rollout에 전역 fence·원본 복구를 요구한 별도 작업이다. 그 원문을 수정하거나 해당 조건이 완료됐다고 해석하지 않는다. 현재 승인된 좁은 신규 리소스 범위는 새 `profile-avatar-delivery-service-only.sql`과 `profile-avatar-v1.json`이 명시한다. 새 정책의 실행 SQL은 동일하고, 과거 파일도 역사 핀으로 보존한다.

- 신규 빈 비공개 `profile-avatars` 버킷: WebP 1 MiB, 일반 anon/authenticated 직접 접근을 막는 restrictive 정책 하나.
- 신규 `profile_avatars`, `profile_avatar_assets`와 service-only 함수 세 개. 기존 프로필·실제 역할·커플 슬롯·Auth 사용자·기존 Storage 객체 백필/수정 없음.
- 기존 삭제 manifest 함수는 pinned 이전 원문의 권한·기존 source 증명을 유지하면서 등록된 개인 사진 자산을 추가한다. 해당 테이블의 bucket/source CHECK 두 개만 확장한다.
- 정책, DDL, 신규 버킷 생성, raw migration ledger 기록을 **같은 트랜잭션**에서 수행한다. 개별 정책만 먼저 COMMIT하지 않는다.

이는 고객 자료가 든 전체 서비스 복원과 다른 실행 범위다. 기존 버킷/테이블/함수/권한은 정확한 변경 대상만 제외한 catalog 및 버킷 metadata digest로 전후 비교한다. 고객 대화·Auth 원문·파일 bytes를 수집하지 않는다. 새 리소스가 존재하거나 이력이 충돌하면 자동 정리/덮어쓰기하지 않는다. 기존 bucket_id=NULL 객체가 있으면 이 restrictive 식의 영향을 별도 검토해야 한다.

## 운영 순서

1. 승인된 clean exact Git HEAD, 원문 두 정책·migration·runtime·PG17 기대 catalog, 고정 프로젝트 `slrtobkksjmxgzatjyqb` / system `7581440907192989109`를 확인한다.
2. `--inspect`: 230 raw ledger와 기존 manifest 함수 원문, 대상 없음/정확한 기존 보호 정책, RLS 및 실제 정책 관리 위임을 읽는다. 공식 `supautils.policy_grants`는 비소유자도 지정 테이블 정책 관리를 지원한다. shared_preload 문자열에 이름이 없다고 거절하지 않는다. 권한을 추가하거나 `supabase_admin`으로 전환하지 않는다.
3. `--rehearse`: 현재 역할이 같은 고정 Management API `/v1/projects/{ref}/database/query`로 정책+DDL을 실제 수행하고 ROLLBACK한다. 다시 읽어 정책·테이블·버킷·함수·ledger·비대상 catalog가 모두 원상임을 확인한다. 이것이 실제 정책 DDL 권한 증거다.
4. 독립 검토 후 `--apply`: 새 예행/ROLLBACK/재관측을 자체적으로 다시 수행하고, 같은 bundle을 한 번 COMMIT한다. 2분 관측/실행 기한, 짧은 테이블 잠금 및 statement timeout을 적용한다. 사후 독립 읽기로 raw ledger 한 건 추가, 신규 catalog, 비대상 catalog/bucket 보존을 확인한다.
5. 이후에만 사진 UI/API를 배포한다. 본인 소유 시험 계정에서 사진 저장→두 번째 사진 교체→기본 이미지 복귀, 현재 연결 상대만 조회, 제3자/이전 계정 거절, 삭제 worker의 정확한 자산 증명을 검증한다. 실제 파일 삭제 검증 없이 SQL cascade 검사를 사진 bytes 삭제 완료로 보고하지 않는다.

```powershell
$mode = 'inspect' # 별도 검토 후 rehearse 또는 apply
$commit = (git rev-parse HEAD).Trim()
$receipt = 'C:\absolute\private-output\new-avatar-inspect.jsonl'
corepack pnpm supabase:release:apply --profile-avatar "--$mode" "--expected-commit=$commit" --project-ref=slrtobkksjmxgzatjyqb "--receipt-out=$receipt" "--confirm-production=profile-avatar-20260913:slrtobkksjmxgzatjyqb:${mode}:$commit"
```

`SUPABASE_ACCESS_TOKEN`은 환경에서만 읽고 SQL·토큰을 공개 출력하지 않는다. 영수증은 새 파일에만 쓰며, 각 원격 변경 전에 fsync한다. 응답 유실·영수증 실패·사후조건 실패는 미확정 상태를 남기고 **자동 재시도/역변경하지 않는다**. 새 read-only inspect로 실제 상태부터 확인한다. 적용 후 사용자가 사진을 저장했다면 신규 테이블/버킷을 삭제하는 rollback은 허용하지 않는다. DB는 additive 상태로 유지하고 앱 문제를 별도로 수정한다.

## 검증과 한계

로컬 native PG17은 고정 policy/DDL bundle의 실제 실행·원자 rollback/commit·원문 ledger·기존 catalog 보존, private RLS, revision 충돌, 자산 유지, 삭제 manifest의 upload_until 증명 및 Auth FK cascade를 검사한다. 합성 host의 system identifier만 fixture 값으로 대체한다. 운영 권한을 모사해 통과했다고 주장하지 않는다. 웹 API/helper의 저장·조회·교체·삭제/계정 전환 회귀는 별도 제품 테스트이며, 원격 bytes 검증과 구분한다.

공식 근거: [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Supautils Manage Policies](https://github.com/supabase/supautils#manage-policies), [Management API database query](https://supabase.com/docs/reference/api/v1-run-a-query).
