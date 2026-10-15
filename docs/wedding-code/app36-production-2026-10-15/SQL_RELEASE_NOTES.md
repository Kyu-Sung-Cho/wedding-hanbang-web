# 36문항 전용 DB 변경 검수

상태: 로컬 SQL 회귀 통과. 이 문서는 운영 적용 영수증이 아니다.

## 변경 범위

- 적용 후보: `supabase/migrations/20261015070000_wedding_code36_private_pairing.sql` 한 파일.
- 새 테이블: `public.wedding_code36_responses`, `public.wedding_code36_pairs`.
- 새 함수: `wc36_submit`, `wc36_pair`, `wc36_read_report`, `wc36_invite_status`, `wc36_update_sharing`, `wc36_delete`, `wc36_purge_expired`.
- 기존 16문항·장면 도구·연구 수집·아모라·공유 기억·Storage 테이블과 정책은 변경하지 않는다.
- 테이블 직접 권한은 `PUBLIC`, `anon`, `authenticated`, `service_role` 모두 회수한다. 함수 소유자의 권한으로 실행하는 서버용 RPC만 `service_role`이 실행한다.

## 커플 연결 보정

두 사람이 각자 빈 초대를 만든 뒤 상대의 초대에 참여할 수 있다. 대상 초대가 유효하고 빈 상태인지 확인한 다음, 참여자의 기존 빈 초대를 닫고 상대 초대에 연결한다. 성공 이후 옛 빈 초대는 사용할 수 없다.

대상이 없거나, 만료되거나, 이미 가득 찼거나, 같은 비밀키의 본인 응답이면 기존 빈 초대를 보존한다. 이미 두 결과가 연결된 응답은 다른 초대 요청으로 이동하지 않는다. 같은 제출 키로 다시 요청해도 저장된 답을 바꾸지 않는다.

빈 초대 이동의 `DELETE`와 대상 초대의 `UPDATE`는 같은 RPC 트랜잭션이다. `UPDATE` 직전 예외를 주입한 실제 SQL 검사에서 두 변경이 모두 취소되는지 확인했다.

연결·삭제·만료 청소는 공통 `wc36-pair-graph` 트랜잭션 advisory 잠금을 먼저 잡는다. 응답별 잠금도 같은 순서로 잡는다. 여러 초대 사이의 응답 중복 소속과 서로 반대 방향 참여를 보수적으로 직렬화한다. 이 선택은 연결 쓰기 처리량을 제한한다. 잠금 대기 시간·네트워크 재시도·다중 PostgreSQL 세션의 동시성은 단일 세션 PGlite 결과로 입증하지 않는다.

## 보관과 삭제

결과는 서버가 처음 저장한 시각부터 7일간 유효하다. 공유 설정 변경과 재시도는 만료 시각을 연장하지 않는다. 만료된 본인 결과·초대·파트너 비교는 청소 작업 전에도 RPC에서 차단한다. 대상 초대만 만료된 새 제출은 개인 결과 저장 성공과 분리하여 `unpaired` 및 `invite_expired`로 복구할 수 있다.

본인 삭제는 응답 본문을 즉시 `NULL`로 지우고 연결 행을 제거한다. 상대의 개인 답은 지우지 않는다. 삭제 재시도와 지연 제출 방지를 위해 결과 ID, 제출 ID, 접근 키 해시, 생성·만료·삭제 시각만 원래 만료 시점까지 남긴다. 같은 ID의 삭제는 그 기간 동안 다시 요청해도 성공한다. 삭제 후 원래 제출을 재생해도 응답 본문을 복구하지 않는다.

`wc36_purge_expired()`는 만료된 응답·삭제 표지와 해당 연결을 물리적으로 삭제한다. 기존 서버 보관 정리 작업에서 매일 실행하고 실패를 운영 경보로 확인해야 한다. SQL 함수만 만든 것은 주기 실행이나 최대 24시간 안의 청소가 실제로 운영됐다는 증거가 아니다.

현재 UUIDv4 제출 계약에는 원요청의 검증 가능한 만료 시각이 없다. 삭제 표지가 원래 만료 후 물리적으로 사라진 뒤 수동 재생되는 아주 오래된 POST를 영구적으로 식별한다고 주장하지 않는다. 이 경계를 넘는 영구 재생 방지는 별도 서명된 제출 유효기간 계약 또는 최소 영구 재생 표지가 필요하다.

## 적용 전후 확인

운영 프로젝트, 현재 production 웹 source commit, Supabase 프로젝트 ref와 시스템 식별자, PostgreSQL 17 실행자, 정확한 SQL hash, 대상 2개 테이블·7개 함수 부재, 기존 catalog·migration ledger의 변경 없음, 제한된 릴리스 승인과 복구 자료를 확인한다. 현재 범위 밖의 대기 중 마이그레이션을 일괄 적용하지 않는다. `supabase db push`로 우회하지 않는다.

별도 scoped controller가 한 트랜잭션에서 명시된 파일과 migration ledger 한 행만 적용하고, 정확한 schema·권한·검색 경로·함수 본문 및 기존 catalog·ledger 보존을 확인해야 한다. 적용 뒤 PostgREST schema cache 갱신과 실제 서버 API를 통한 합성 개인·커플·공유 철회·삭제·만료 경계를 확인한다.

## 되돌리기

우선 웹을 직전의 검증된 배포로 되돌려 새 36문항 쓰기를 멈춘다. 새 자료는 보존하며 자동으로 테이블을 DROP하거나 응답을 삭제하지 않는다. 추가 차단이 필요하면 이 릴리스의 7개 함수에 한해서 `service_role` 실행 권한을 회수하고 schema cache를 갱신한다. 그 상태에서도 개인정보 보관 정리의 재개 방법을 운영자가 별도로 확보해야 한다. 수정 배포 뒤 권한 복구는 정확한 함수 목록과 hash로 다시 검수한다.

기존 릴리스 manifest 전체나 다른 기능의 과거 정책을 복구하는 조치는 이 변경의 rollback이 아니다. 사용자 자료 삭제를 동반하는 rollback은 자동 실행하지 않는다.

## 재현

`WC36_PGLITE_MODULE`에는 이미 확보한 로컬 `@electric-sql/pglite` 모듈의 `dist/index.js` 절대 경로를 지정한다. 이 검사기는 환경 파일을 읽거나 원격 연결을 만들지 않는다.

```powershell
node scripts/tests/wedding-code36-sql-regression.mjs --report=docs/wedding-code/app36-production-2026-10-15/sql-regression.json
```

원래 SQL을 `--migration=<원래 파일 경로> --pairing-only`로 실행한 RED 결과와 수정 SQL의 전체 GREEN 결과를 각각 `sql-regression-before.json`, `sql-regression.json`에 기록했다. 합성 데이터와 SQL 실행 검증이며 사람 대상 타당성 검증이 아니다.
