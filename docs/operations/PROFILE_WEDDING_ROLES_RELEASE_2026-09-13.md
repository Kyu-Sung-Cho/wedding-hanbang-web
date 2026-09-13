# 본인이 고른 웨딩 역할: 별도 DB 적용

범위는 `20260913075045_profile_wedding_roles.sql` 한 건이다. 새 private 테이블과 service 전용 RPC 두 개만 추가한다. 기존 `profiles.role`·커플 슬롯·사진·Auth 사용자·Storage·고객 행을 바꾸지 않는다. 신랑/신부를 가입 순서로 추정하지 않는다.

현재 구현 검사는 운영 실행 증거가 아니다. 실제 운영 관측·예행·적용·후검증은 아래 전용 실행 결과로 구분한다. 전체 고객 자료의 백업/복원 성공을 주장하지 않는다.

## 적용 순서

1. 모든 관련 검사를 완료한 깨끗한 Git commit을 고정한다. 기존 229개 SQL 원문과 feedback runtime/계약 핀은 유지한다. `corepack pnpm supabase:release:fence --profile-wedding-roles`는 로컬 230개 원문 검사이며 운영 인가가 아니다.
2. 검토자가 해당 commit, 정확한 Supabase project/system identifier, 새 SQL의 scope를 확인한다. `SUPABASE_ACCESS_TOKEN`은 승인된 로컬 환경에서만 공급하며 명령 인수·영수증에 넣지 않는다.
3. 같은 controller의 `--inspect`로 현재 상태를 읽는다. 선행 feedback SQL 이력 원문, 필요한 8개 컬럼, 새 객체 부재/이미 적용된 객체의 정확 정의와 ACL을 검사한다. 관측에는 고객 행을 넣지 않는다.
4. `--rehearse`는 실제 DDL·이력 기록을 한 트랜잭션에서 실행하고 ROLLBACK한다. 별도 읽기에서 새 객체 부재, 이력 및 비대상 catalog 해시 복귀를 확인한다.
5. `--apply`는 매번 새 관측과 자체 롤백 예행을 수행한 뒤 동일 SQL을 한 번 COMMIT한다. 외부에서 오래된 예행 영수증을 넣어 적용을 생략할 수 없다. 적용 전후 동일 SQL 원문·함수 정의·테이블/RPC ACL·RLS 및 비대상 public/auth/storage catalog·선행 이력을 비교한다.

```powershell
# $commit은 검토한 40자리 commit, $receipt는 존재하지 않는 절대 JSONL 경로다.
# $mode에는 inspect, rehearse, apply 중 이번에 승인된 단계 하나만 넣는다.
corepack pnpm supabase:release:apply --profile-wedding-roles "--$mode" "--expected-commit=$commit" --project-ref=slrtobkksjmxgzatjyqb "--receipt-out=$receipt" "--confirm-production=profile-wedding-roles-20260913:slrtobkksjmxgzatjyqb:${mode}:$commit"
```

고정 HTTPS Management API만 사용한다. SQL 파일/URL/테이블을 사용자가 임의로 지정하는 범용 DDL 인터페이스는 없다. 기존 feedback 공개 모드는 230번째 SQL을 계속 거절한다.

## 실패와 완료 경계

- 영수증은 새 파일로 독점 생성하고, 원격 mutation 전 결과 미확정 기록을 fsync한다. 경로/짧은 쓰기/디스크 실패는 적용 시작 전에 멈춘다.
- 응답 유실·예행 복귀 불일치·적용 후 확인 실패는 `PROFILE_ROLE_OUTCOME_REQUIRES_INSPECTION`이다. 자동 재시도/역적용/이력 수선은 하지 않는다. 남은 영수증으로 먼저 `--inspect`를 실행해 정확한 상태를 확인한다.
- 적용 후 되돌릴 필요가 있으면 먼저 역할 입력 UI/API의 신규 쓰기를 중지하는 제품 변경을 검토한다. 자료가 생긴 새 테이블을 자동 DROP하지 않는다. 기본 회원 기능은 optional 조회 실패 시 역할 미확정으로 유지되므로 기존 로그인·가입 슬롯은 보존된다.
- 배포 후 본인 명시 선택·변경·미선택, 연결 상대 양쪽 색상, 다른 계정/이전 상대 비노출, 계정 전환의 최신 값 보존을 확인한다. 웹 코드 검사만으로 이 운영 동작을 완료로 표시하지 않는다.

검증: 런타임 모의 검사(성공/롤백/이력 충돌/만료/응답 유실/영수증 실패), 229 역사 회귀, 230 정적 및 production build 후속 검사. 로컬 PostgreSQL 17.10에서는 합성 DB 하나에서 원문 DDL·catalog·롤백·적용·기존 행 보존을 실행했다. PG17이 없는 CI에서는 이 native 검사만 명시적으로 미검증/skip이며 다른 계약·런타임 검사는 실행한다.
