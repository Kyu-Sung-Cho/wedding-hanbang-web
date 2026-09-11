# 전체 복구 검증 준비 — 2026-09-11

현재 단계는 최신 수정본에 맞는 암호화 백업 연결과 복원 환경 준비다. 이 문서는 실제 원본 수집·복원·운영 배포 성공 증거가 아니다.

## 이번 단계의 완료 기준

1. 현재 운영 ledger215/head20260907085111 및 후보의 검토된 SQL 전체를 고정한다.
2. 기존 collector의 DB 쓰기 차단 검사, 전체 관리 schema 수집, 두 snapshot·파일 원본 hash 비교, DPAPI 암호화를 유지한다.
3. 새 capture-only entrypoint는 기본 실행에서 네트워크·인증값에 접근하지 않는다. 실제 실행도 복원·배포 권한을 부여하지 않는다.
4. 복원 환경에서 외부 접근과 외부 송신 차단을 실제 검사한 뒤에만 고객 원본을 복제한다.
5. 전체 DB/Auth/Storage가 복원된 증거와 후보·backupSet을 연결한 정식 후속 인가 계약을 별도로 검토한다.

## 확인한 사실

- E: 2026-09-10 23:05:44 UTC 운영 DB 읽기 전용 조회에서 PostgreSQL17.6, ledger215를 확인했다. 확장7개 중 pg_cron1.6.4와 supabase_vault0.3.1은 현재 Windows native17.10 bundle에 없다. foreign servers0은 모든 외부 송신이 차단됐다는 뜻이 아니다.
- E: 23:07:52 UTC Storage metadata는662행,12버킷(공개8), 버전 사용0·archived0·중복 논리 경로0이다. 파일 다운로드/실제 bytes 검증은 수행하지 않았다.
- E: 23:08:36 UTC Supabase Management API GET은 physical backup8건을 COMPLETED로 반환했다. 가장 최근 inserted_at은2026-09-10T20:13:57.151Z다. 응답에 completed_at이 없으므로 inserted_at을 완료시각으로 바꾸지 않는다. PITR은false다.
- E: 이 PC는Windows11Pro10.0.26200이다. docker 실행 파일/관련 service를 찾지 못했고 wsl --status/list는 WSL 미설치라고 응답했다.
- E: 기존 운영 소스·서비스 설정·원격 DB/Storage를 변경하지 않았다.
- S: DB 백업에 Storage 파일 bytes는 포함되지 않는다. [Supabase 백업 문서](https://supabase.com/docs/guides/platform/backups)
- S: Supabase DB Network Restrictions는 HTTPS API 전체를 차단하지 않는다. [Network Restrictions](https://supabase.com/docs/guides/platform/network-restrictions)

## 복원 환경 선택

| 선택 | 현재 판정 | 이유 |
|---|---|---|
| 기존 Supabase 시험 프로젝트에 즉시 고객 복제 | 실행 보류 | DB IP 제한·가입 차단만으로 Auth refresh, 공개 Storage, 외부 송신 차단을 입증하지 못했다. |
| 현재 Windows native PostgreSQL만 사용 | 전체 복구 증거로 부적합 | 운영 확장2개와 실제 Auth·Storage 서비스가 없다. 원본 schema를 생략하거나 대체하면 요구 범위가 줄어든다. |
| 격리한 Linux 컨테이너/VM에 Supabase 복원 | 준비 권장 | 운영과 호환되는 Postgres/Auth/Storage 서비스 및 ingress/egress 제어를 함께 구성할 수 있다. 설치와 버전 호환 검증이 필요하다. |

권장안은 이 PC의 WSL2/Docker Desktop 또는 별도 Linux 서버에 복원 전용 Supabase 환경을 만드는 것이다. 현재 프로젝트나 일반 개발 DB와 공유하지 않는다. 이미지/버전을 공식 원문으로 고정하고, 모든 데이터 서비스는 internal 네트워크만 사용하며 host network·Docker socket·운영 signing keys·메일/API 비밀값을 넘기지 않는다. 검사 포트는 필요한 경우에만127.0.0.1로 제한한다. 내부 network라고 단정하지 말고 외부 접속·송신 실패와 합성 로그인/파일 canary를 실제 확인한다.

Docker/WSL 설치는 Windows 기능 변경과 재부팅을 요구할 수 있어, 설치 직전 사용자의 확인을 받는다. 이 확인은 운영 배포 승인 재요청이 아니라 PC 실행환경 변경 범위 확인이다. [Docker Windows 설치](https://docs.docker.com/desktop/setup/install/windows-install/), [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting/docker)

## 실행 순서

1. 설치 환경 확정 → 원본 호환 이미지/확장 및 자원 검증.
2. 비어 있는 복원 전용 서비스 기동 → 외부 접근·송신·이메일 차단을 합성 데이터로 검증.
3. 전체 restore runner와 근거 검증 계약 구현·독립 검수. 기존 hosted-only 계약을 이름만 바꾸거나 false를 true로 바꾸지 않는다.
4. 운영 쓰기 차단/되돌리기 도구 검증과 작업창 확정. 서명 업로드·재개 가능 업로드의 실제 최대 수명 및 안정성 대기는 별도 조건이다.
5. 같은 backupSet의 최신 DB/Auth/schema/권한/파일 원본 전체 암호화 수집.
6. 격리 대상에 실제 복원. table·sequence·partition·권한·RLS·RPC·ledger 및 모든 파일 identity/길이/hash 비교. 관리 schema나 FK/trigger 실패는 생략하지 않고 중단한다.
7. Auth 합성 canary, 실패/중단 복구, 삭제 요청 재적용 절차 검증.
8. 검증된 전체 증거를 후속 controller에 연결한 뒤 정상 release check/apply·canary·쓰기 차단 해제 순서로 운영 반영.

현재 관리형 대상의 합성 hosted 시험과 기존 암호화 archive의 무결성 검사는 보존한다. 이 결과를 전체 고객 원본 복원 성공으로 재사용하지 않는다.

## 백업 수집 연결의 구현과 검증

신규 진입점은 `scripts/amora-budget-decision-backup-collect.mjs`다. 인자 없이 실행하거나 `--help`를 주면 원격 접속/인증값 읽기 없이 현재215 baseline·227 SQL과 실행 조건을 출력한다. 실제 실행은 정확한 commit·origin·프로젝트 연결·CA/pg_dump 해시를 먼저 검사하고, 기존 collector의 실제 DB fence 검사와 두 snapshot 비교를 그대로 사용한다. 새 kind/hotfix SHA/후보/backupSet/원본 artifact digest로 영수증을 묶으며 `releaseReady:false`를 유지한다. 기존 collector/runtime/worker/manifest의 원문은 변경하지 않았다.

신규12개와 관련3개 파일의54개 시험이 통과했다(중복 집계하지 않는다). 관련 시험에는 실제 Windows HBAM2/DPAPI 왕복 및 중단본 거절이 포함된다. 최종 공개 baseline fixture 변경 후 신규12개를 다시 통과했고, `test:repo` 등록 검사3개 및 JS 구문/diff 검사를 확인했다. 네트워크/운영 수집/복원은 실행하지 않았다. 새 entrypoint는 기존 관계JSON/schema/Storage 원본 수집 연결이며, 전체 복원 실행용 custom archive를 같은 snapshot/backupSet에 추가하는 후속 작업은 아직 남아 있다.

상세 로컬 영수증은 `operations-day3/full-restore-capture-final-tests.log`, `full-restore-capture-related-tests.log`, `full-restore-capture-source-freeze.json`에 보존한다.

## 후속 단계: 같은 snapshot의 복원용 archive와 대상 증거 계약

위 첫 단계 다음으로 `scripts/amora-budget-decision-archive-collect.mjs`를 추가했다. 첫 DB export transaction이 열린 동안 `pg_dump --format=custom --snapshot`으로 owner/ACL을 유지한 전체 archive를 얻고, DB 접속 없이 `pg_restore --list`와 전체 SQL decode를 통과시킨다. 기존 DB 관계/schema/globals/Storage 수집과 두 snapshot 비교가 모두 성공한 뒤 archive를 마지막 DPAPI 암호화 part로 붙인다. 첫 snapshot, 후보 commit, backupSet, 원본/도구 hash와 새 artifact count를 최종 영수증에 함께 묶는다. 기존 collector/runtime/worker/출시 controller 원문은 변경하지 않았다.

기본 실행/도움말은 원격에 접속하지 않는 계획 출력이다. 실제 수집은 새로운 `ARCHIVE:` 확인 문구, clean candidate와 원본/도구/CA pins 및 기존 쓰기 차단 검사를 요구한다. 이 명령에도 복원/배포 기능은 없고 `releaseReady:false`를 유지한다. custom archive 상한은 약24MiB, envelope32MiB, 전체 decode256MiB이며 초과 시 중단한다. 이 상한이 운영 DB에 충분한지는 아직 실제 수집으로 확인하지 않았다. TOC 검사는 필수 schema 존재만 확인하며 모든 관계의 동일성은 실제 복원 뒤 별도 비교해야 한다. SQL 문법/데이터를 해독했다는 사실도 실제 서비스 복원 성공을 뜻하지 않는다.

`scripts/lib/full-restore-target-admission.mjs`는 원본/대상/격리 영수증과 파일 목록의 순수 검증 계약이다. 후보/backupSet/시스템 식별자, 도구 pins, 15분 이내 영수증, 확장·역할·관리 schema 일치, 검토된 빈 대상 상태, 외부 접근·송신15개 경계 증거, 전체 관계/파일 목록 결합을 검사한다. 실제 producer의 `database-custom-archive` scope를 사용하고 globals는 `schema-original` 내부 원문으로 후속 consumer가 검증해야 한다. 핵심 관리 관계7개는 모든 목록에서 함께 지워도 통과하지 못한다. 이 함수는 외부 실행 사실이나 파일 bytes를 인증하지 않으므로 `observationsAuthenticated`, `artifactsRehashed`, `restoreExecuted`, `releaseAuthorized`는 모두false다. 이 반환값만으로 원본 접근이나 배포를 허가하면 안 된다.

합성 native 시험 중 큰 정상 archive를 목록 조회할 때 Windows stdin EOF가 발생하는 문제와 프로세스 timeout 후 종료 이벤트를 무기한 기다릴 수 있는 문제를 발견해 수정했다. 조기 stdin 종료 예외는 정확한 `--list` 호출의 EPIPE/EOF만 받으며 exit0, 유효 TOC와 후속 전체 decode 성공을 모두 요구한다. timeout/오류는 즉시 실패하고 늦은 출력은 폐기한다.

현재 로컬 PostgreSQL17.10 합성 시험5개는 실제 빈 DB 복원으로 snapshot 이전 값, 큰 bytea hash, 타입, 고정 sequence, ACL을 확인했다. sequence는 MVCC 대상이 아니므로 시험 중 변경하지 않았으며 운영에서는 쓰기 차단이 별도로 필요하다. 잘린 archive/만료 snapshot은 거절했다. 암호화 연결 시험에는 실제 Windows DPAPI worker 왕복과 마지막 archive part의 영수증 대조가 포함된다. native 도구가 없는 CI에서는 해당5개가 명시적으로 건너뛰며 그 결과를 복원 성공으로 집계하지 않는다.

현재 완료 범위는 수집 도구·증거 계약·합성 native 복원 검증이다. 실제 전체 Supabase 환경 설치, 외부 접근/송신 차단의 실측, 운영 원본 수집·DB/Auth/Storage 전체 복원, 원문 증거의 후속 인가 controller 연결, 운영 배포는 아직 남아 있다. 고객 원본을 현재 hosted 대상에 복제하지 않았다.

최종 관련7개 파일 통합 실행은187 PASS/실패0/건너뜀0이다. 신규130개(archive 연결11·대상 계약114·native5)가 이 수에 포함되며 중복 합산하지 않는다. 나머지는 기존 수집/릴리스 계약 및 `test:repo` 등록 검사다. 실제 Windows DPAPI 및 합성 native 복원도 이번 최종 실행에서 통과했다. 구문/diff 검사와 독립 검토를 마쳤다. 제품 화면이나 런타임 코드는 이번 단계에서 바꾸지 않았으므로 전체 웹 테스트/build를 다시 실행하지 않았으며, 이전 합본의 결과와 이번187개 결과를 구분한다. 최종 원문은 `operations-day3/full-restore-snapshot-final-tests.log`다.

공식 동작 근거: [PostgreSQL17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [PostgreSQL17 pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html). 상세 합성 실행 증거는 로컬 `operations-day3/POSTGRES_SNAPSHOT_NATIVE_VERIFICATION_20260911.md`와 `postgres-snapshot-native-receipt.json`에 보존한다.
