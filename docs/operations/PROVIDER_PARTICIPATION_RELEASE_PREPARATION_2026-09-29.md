# 제공자 참여 DB·Storage 릴리스 준비

상태: **로컬 준비·검증 / 운영 적용 차단**. 이 문서는 운영 적용 영수증이 아니다.

## 준비한 실행 경계

`supabase/release-contracts/provider-participation-v1.json`은 기존 240개 마이그레이션의
해시 검증 체인을 확인하고 제공자 변경 세 개만 더한 243개 파일 목록과 원문 SHA-256을 고정한다.
Storage 제한 정책, 삭제 manifest 변경, 정리 worker 스키마를 한 단위로 검토한다.
기존 240개 계약이나 운영 배포 차단 장치를 완화하지 않았다.

```powershell
corepack pnpm supabase:provider:prepare --check
corepack pnpm supabase:provider:prepare --local-rehearsal
node --test scripts/tests/provider-participation-release-contract.test.mjs scripts/tests/provider-participation-release-native.test.mjs
```

첫 명령은 파일·계약만 검사한다. 두 번째는 저장소의 기존 PostgreSQL 17 합성 fixture를
이용해 새로운 임시 클러스터를 127.0.0.1에 생성한다. 실제 운영 system identifier를
SQL 내부에서도 거절한다. 클러스터는 실행 후 종료·제거한다. 환경에 설치된 로컬 PG17이
없으면 검증을 통과로 만들지 않는다.

준비 CLI에는 `apply`, 원격 `inspect`, project ref, 임의 SQL, 토큰 인자가 없다.
`productionApplyImplemented`, `runtimeEvidenceVerified`, `releaseAuthorized`는 항상 false다.
실제 운영 적용은 이 도구로 실행할 수 없으며, 추후 기존 `supabase:release:apply`와
운영 증거 검증 체계에 승인된 컨트롤러를 연결해야 한다.

## 적용 단위와 사후조건

1. `20260928135517_provider_portfolio_service_fence.sql`: Storage 소유자 권한으로 수행하는
   `anon`·`authenticated` 대상 restrictive ALL 정책. 정책 추가 권한을 임의로 부여하지 않는다.
2. `20260928135517_provider_participation_self_publishing.sql`: 참여 테이블·RLS·RPC·비공개 버킷.
3. `20260928140701_provider_portfolio_account_deletion.sql`: 기존 삭제 manifest의 제공자 사진 증명.
4. `20260928142123_provider_media_cleanup.sql`: 만료·철회 사진의 durable 정리 lease와 checkpoint.

`supabase/release-checks/provider-participation-observation.sql`은 read-only 트랜잭션에서
다음 상태를 관찰한다. 관찰 파일만으로 적용 권한이나 성공을 선언하지 않는다.

- 여섯 신규 테이블의 컬럼·타입·기본값·제약·인덱스·RLS·정책·테이블/컬럼 ACL.
- `provider_private` 스키마 권한과 제공자 RPC 전체의 원문·인자 이름/기본값·소유자·실행 ACL·설정.
- 기존 삭제 manifest 함수 및 변경 대상 세 CHECK 제약의 정확한 상태.
- 비공개 버킷의 크기·MIME 제한과 정확한 restrictive Storage 정책.
- 제공자 ledger 세 행의 원문 digest와 전체 ledger 수.
- 비대상 catalog, Storage metadata, 버킷, default ACL, role settings, 기존 ledger digest.

로컬 예행은 세 마이그레이션의 바깥 BEGIN/COMMIT만 제거하고 원문 본문을 한 트랜잭션에서
실행한다. 사후조건을 검사한 뒤 반드시 ROLLBACK한다. 최후의 명령이 실패하는 경우도
반복해 부분 적용이 남지 않는지 확인한다. 앞뒤 관찰은 독립된 read-only 트랜잭션이며,
예행 내부의 관찰은 실제 read/write 트랜잭션으로 구분한다.

합성 기존 행의 digest도 비교한다. fixture의 이전 ledger 행은 테스트용 marker이고,
이전 240개 SQL의 전체 스키마를 복원한 데이터베이스는 아니다. 이 결과는 **전체 원본 복구,
hosted Storage bytes, 실제 정책 소유권 위임, 운영 부하·동시성**의 증거가 아니다.

## 이번 검증 결과 (2026-09-29)

- 준비 CLI의 `--check`와 `--local-rehearsal` 모두 종료 코드 0.
- 실제 로컬 PostgreSQL 17.10에서 정확한 대상 catalog, 기존 합성 행 보존,
  정상 rollback 및 마지막 명령 실패 뒤 rollback 확인.
- 함수 타입·본문은 같고 DEFAULT 값만 달라진 경우에도 catalog 차이를 검출.
- 계약·native·테스트 등록·SDK 실행 안전장치 15개 검사 통과, skip 0.
- SDK 실행 안전장치는 원격 대상 거절 검사이며 실제 Supabase Auth·Storage 통합 검증이 아니다.
- 신규 JavaScript 7개 구문 검사와 `git diff --check` 통과.
- 원격 호출 0, 고객 데이터 사용 없음. 운영 적용·운영 증거·릴리스 권한은 모두 false.

## 실제 운영 전에 필요한 증거

| 게이트 | 현재 부족한 실제 증거 |
|---|---|
| 정확한 소스와 대상 | 최종 commit·clean checkout·대상 project/system identifier 및 현재 hosted ledger·baseline catalog를 같은 시점에 묶은 관찰 |
| 권한 | 운영 `postgres`가 Storage 정책을 관리할 수 있는 실제 소유권/공식 위임과 같은 번들의 hosted rollback 예행 |
| 전역 쓰기 중단 | web/API/Auth/public DB/Storage write fence와 release lock의 현재 소유자·만료·유지 증거 |
| 파일 안정성 | 기존 signed upload 만료 대기, 안정된 객체 inventory와 원본 bytes 백업 |
| DB 복구 | 정확한 현재 baseline의 암호화 DB 백업 및 다른 승인된 격리 대상에서의 복원·Auth·Storage 대조 |
| hosted staging | 합성 계정으로 정확한 bundle·사후조건·rollback, Supabase Storage SDK의 업로드/다운로드/삭제·404 확인 |
| 운영 검증 | 미공개/중지/삭제 요청 후 사진 bytes 접근 차단, 정리 cron 실패 재시도, 계정 삭제의 bytes→Auth 순서 |
| 운영 책임 | 정리 실패 알림 수신자, 계정 삭제 manual-review 담당자/SLA, 사고 시 fence 유지·복구 승인자 |
| 최종 컨트롤러 | 위 비공개 원문과 fresh receipt를 검사하고 모호한 apply 응답을 자동 재시도하지 않는 승인된 production controller |

준비 CLI와 로컬 예행은 원격 조회·변경을 하지 않는다. 작업 중 별도로 확인한 운영 metadata는
아래 읽기 전용 관찰과 구분한다. 운영 DB 변경, 운영 백업 열람, 원격 synthetic 생성,
Storage 원본 다운로드, 웹 배포는 수행하지 않았다. `.env.local`이나 남아 있는 자격증명은 승인된 격리 대상의 증거로
취급하지 않는다.

### 별도 운영 read-only 관찰

2026-09-29 KST, 프로젝트 `slrtobkksjmxgzatjyqb`에 대해 `BEGIN TRANSACTION READ ONLY`
범위에서 존재 여부와 migration version만 조회했다. 고객 행·원본 파일은 읽지 않았다.

- `provider_profiles`, `provider_search_catalog`, `provider-portfolio` 버킷, restrictive fence: 모두 없음.
- 신규 제공자 migration 적용 수: 0. 전체 운영 ledger: 229개, 로컬 검토 목록: 243개.
- 로컬에만 있는 version은 아래 15개이고, 운영에만 있는 version은 `20260820100000`이다.

- `20260806090000_amora_preparation_status.sql`
- `20260807090000_amora_mediation_send_gate.sql`
- `20260821120000_events_append_only_allows_fk_detach.sql`
- `20260823120000_couple_approval_becomes_notification.sql`
- `20260824120000_amora_schedule_cancel_can_actually_apply.sql`
- `20260824130000_mediation_tells_the_partner.sql`
- `20260824140000_amora_can_change_custom_budget_categories.sql`
- `20260824150000_amora_custom_category_label_match.sql`
- `20260824160000_first_budget_entry_is_not_a_mixed_change.sql`
- `20260826000000_harden_cohort_timeline_and_contract_writes.sql`
- `20260826120000_anon_sees_only_public_authors.sql`
- `20260827090000_move_card_can_name_what_it_moves.sql`
- `20260928135517_provider_participation_self_publishing.sql`
- `20260928140701_provider_portfolio_account_deletion.sql`
- `20260928142123_provider_media_cleanup.sql`

이 결과는 migration 원문 checksum·실제 스키마 동등성의 증거가 아니다. 기존 이력의
baseline 처리·대체 SQL 여부를 조사하고 현재 상태에 맞는 검토된 적용 계획을 확보해야 한다.
ledger를 수동으로 채우거나 버전 개수만 맞추지 않는다. 240개 이전 계약을 로컬에서 읽는
정적 검사 성공을 현재 운영의 240개 적용 완료로 해석하지 않는다.

## 실패와 복구

- **커밋 전 실패:** 같은 연결의 트랜잭션을 rollback하고 별도 read-only 관찰로 이전 catalog,
  버킷·객체·ledger 상태를 비교한다. 비교가 실패하면 fence와 lock을 유지한다.
- **커밋 또는 응답 상태가 불명확:** apply 재시도, migration ledger 수동 보정, 세부 SQL 재실행을
  금지한다. 정확한 원문·ledger·catalog를 읽기 전용으로 판정할 때까지 fence와 lock을 유지한다.
- **커밋 후 제품 장애:** 테이블·사진·신청 이력을 DROP하거나 과거 Storage 정책을 복원하지 않는다.
  전역 fence를 유지한 상태에서 승인된 운영 절차로 제공자 프로필의 `approval_status='suspended'`,
  `publication_status='paused'`와 서비스의 `recommendation_status='blocked'`를 설정하고
  version을 증가시켜 오래된 편집도 충돌하게 한다. 이 상태는 공개 RPC와 사진 API 모두를 닫는다.
  웹 링크만 숨기거나 웹 환경변수만 끄는 것으로 직접 RPC를 차단했다고 판단하지 않는다.
- **복구 확인:** 공개 catalog가 비어 있고 기존 사진 URL이 bytes를 반환하지 않음을 직접 검증한다.
  restrictive Storage 정책과 계정삭제·정리 증명은 보존한다. 원인 수정 후 제공자를 일괄 자동
  재게시·재추천하지 않고 개별 운영 검토와 제공자의 공개 선택을 거친다.

커밋 후 위 운영 변경을 실행하는 emergency controller와 hosted 복구 증거는 아직 준비되지
않았다. 로컬 transaction rollback 성공을 그 대신 사용하지 않는다.

관련 정본: [AGENTS.md](../../AGENTS.md)의 운영 DB·Storage·배포 규칙,
[현재 진입점](../../START_HERE.md), [구현·운영 상태](../PROVIDER_DELIVERY_2026-09-28.md).
