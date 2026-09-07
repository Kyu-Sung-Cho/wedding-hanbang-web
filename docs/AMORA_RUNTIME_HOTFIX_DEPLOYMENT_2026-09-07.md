# 아모라 8개 SQL 운영 전환

이 절차는 2026-09-07 운영 DB에 없는 아모라 RPC와 커뮤니티 정렬 열을 웹 코드와 함께 적용한다. 기존 `--current-baseline` 전체 DB·Storage 복구 실행기와 검증 기준은 유지한다. 이 절차로 전체 원본의 hosted 복구나 Storage 객체 복원을 완료했다고 표시하지 않는다.

## 변경 범위와 전환 순서

- 운영 대상: Supabase `slrtobkksjmxgzatjyqb`, Vercel `wedding-hanbang-web`, `hanbang.ai`와 `www.hanbang.ai`.
- SQL 정본: `supabase/release-contracts/amora-runtime-hotfix-v1.json`의 SHA로 고정한 8개 파일. 운영 이력은 기존 206개에서 214개가 된다. 과거 미적용 파일을 섞거나 이력을 repair하지 않는다.
- 웹을 먼저 열면 채팅·저장·커뮤니티 요청이 없는 RPC/열을 참조한다. SQL을 먼저 적용하고 이전 웹의 쓰기를 열어 두면 메모 저장 권한과 예산 요청 형식이 맞지 않는다. 전환 동안 웹과 public DB 쓰기를 차단한다.
- 운영 환경으로 새 버전과 기존 버전 복구용 서버를 먼저 빌드한다. `--skip-domain` 배포는 실제 서비스 전환 완료가 아니다. GitHub metadata와 HTTP 응답의 커밋을 실제 Git 원문과 대조한다.
- DB 전환 전에 PostgreSQL 원본 백업을 암호화하고, 실제 복호화·hash·archive 전체 decode를 확인한다. 별도 PostgreSQL 대상에서 실제 SQL, 합성 승인 흐름, 동시 요청과 트랜잭션 rollback을 검증한다. 변경 전 스키마 원문과 기존 웹의 복구용 서버도 보존한다.
- 쓰기 차단 후 새 백업·스키마·기존 행 지문을 수집한다. 동일 소유자 lease, 원문 SQL, 마이그레이션 이력 기록, 전후 조건을 하나의 DB 트랜잭션으로 실행한다.
- 실제 운영 서버와 도메인의 응답을 검증한 뒤 같은 소유자와 커밋에 묶인 finalizer로 쓰기 차단을 해제한다. 이후 로그인 전 화면, API, 데스크톱·모바일 렌더링을 다시 확인한다.

## 증거와 실패 처리

새 실행기는 `supabase:release:apply -- --amora-runtime-hotfix`로 선택한다. `--check-only`와 `--apply`는 정확한 커밋·프로젝트 확인 문자열, 원본 백업, 실제 hosted SQL·동시 요청 기록, 실제 CLI dry-run, 웹·DB 쓰기 차단 증거가 필요하다. 자격 증명은 기존 공식 CLI 인증을 사용하고, 명령 인자나 결과 파일에 기록하지 않는다.

DB 응답이 끊기면 원래 결과 경로와 lease를 보존한다. 빈 이력만 보고 rollback으로 판단하거나 같은 적용 요청을 재전송하지 않는다. 실제 커밋된 8개 SQL 원문과 같은 lease 소유자·커밋·단계를 다시 조회해 판단한다. 불확실한 상태에서는 차단을 자동 해제하지 않는다.

백업 archive를 읽을 수 있다는 확인은 hosted 전체 복원 성공을 뜻하지 않는다. 이 작업의 rollback 시험은 합성 대상에서 트랜잭션을 취소하고 스키마와 행이 이전 상태로 돌아오는지 확인한다. 커밋 이후의 원본 archive 복원이나 역방향 SQL을 실행한 증거로 표시하지 않는다. 실제 릴리스 완료 여부는 실행 결과와 운영 도메인 증거로 판단하며, 이 문서 자체는 완료 증거가 아니다.

## 플랫폼 관측의 차이

- Supabase CLI 2.106.0은 임시 비밀번호 발급 뒤 pooler에 같은 자격 증명으로 접속을 재시도한다. 발급 직후 인증 실패는 새 비밀번호를 반복 발급해 해결하지 않는다.
- libpq의 `verify-full`은 클라이언트와 pooler 사이의 TLS·인증서·호스트 이름을 검증한다. `pg_stat_ssl`은 pooler와 DB 사이의 별도 연결 상태이므로 두 값을 나누어 기록한다.
- 관리 API의 `read_only: true`는 `supabase_read_only_user` 연결을 선택한다. 배포 검사의 `postgres` 세션과 구분해야 하므로 scoped 실행기는 `postgres` 연결을 선택하고, 조회 SQL 자체의 `BEGIN READ ONLY … COMMIT` 경계를 검사한다. 적용·해제 세션의 `postgres`·JWT 없음 조건은 유지한다.
- 두 연결의 기본 `search_path`가 달라 같은 뷰·기본값·제약·이벤트 트리거가 16개 다른 지문으로 표현됐다. 실제 양쪽 조회에서 `pg_catalog, public`으로 고정하면 이 차이가 사라졌다. scoped 관측은 독립 쿼리와 트랜잭션 내부 관측 모두 이 경로를 명시한다. 원래 inventory SQL이나 전체 복구 실행기의 기준은 바꾸지 않는다.
- 원래 관측에서 추가된 `realtime.messages_2026_09_10`, 이후 삭제된 `realtime.messages_2026_09_03`, 해당 publication의 정확한 변경만 scoped 기준에 반영한다. 삭제 주체나 retention 작업의 실행 여부는 이 관측만으로 확인한 것이 아니다. 앱 스키마나 다른 관리 객체의 변화를 포괄적으로 무시하지 않는다.
