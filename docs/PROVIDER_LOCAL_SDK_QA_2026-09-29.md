# 개인·팀 제공자 로컬 Auth·Storage SDK 검증

이 스크립트는 **실제 로컬 Supabase 서비스가 있을 때만** Auth·Storage·PostgreSQL 통합을 검사한다.
HTTP mock, PGlite의 `auth.uid()` 대체 함수, Storage 메타데이터에 직접 넣은 행으로 실제 검증을 대신하지 않는다.

## 현재 확인한 환경

2026-09-29 이 작업 PC에서 Supabase CLI 2.106.0은 실행되었지만 Docker·Podman 명령/설치 경로/엔진 파이프가 없고 WSL도 미설치 상태였다.
이 PC에서는 실제 통합 실행을 하지 않았다. 이후 아래 GitHub Actions의 빈 Docker 스택에서 실제 통합을 통과했다.
실행 안전장치 단위 테스트와 실제 통합 결과는 구분한다.
기존 PG17 테스트는 SQL·RLS·트랜잭션 검증이며 실제 Auth·Storage 서비스 검증과 구분한다.

### 실제 통합 통과 기록

- 소스 commit: `b69d8413845478fb8a30ac669eadf66a1a2ceb0c`.
- [Provider Integration 실행 36538633277](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/actions/runs/36538633277),
  `Provider Auth and Storage` 성공. 완료 출력 시각 `2026-09-29T07:49:29Z`.
- 실제 Auth 계정 생성·로그인, 승인 전 쓰기 차단, 승인 후 소개글 저장·오래된 버전 충돌,
  private Storage의 실제 WebP bytes 왕복, 공개·중지·정지·복구·관리자 권한 회수를 확인했다.
- 실제 사진 정리 worker의 실패 후 파일 보존·lease·재시도·삭제 checkpoint, Auth 삭제 cascade와
  기존 세션 거부를 확인했다. 성공 JSON의 7개 검사 그룹이 모두 기록됐다.
- `cleanupSucceeded=true`, `disposableStackStopped=true`: 생성한 합성 계정·파일과 이번 임시 스택 정리까지 확인했다.
- `nextHttpRoutesVerified=false`, `accountDeletionWorkerVerified=false`, `realTimeGraceWaitVerified=false`,
  `restoredProductionBaseline=false`, `releaseAuthorized=false`는 그대로다.

첫 CI에서 드러난 Node 22.13 Corepack 서명 키 문제는 action-setup이 설치한 고정 pnpm 사용으로 수정했다.
SQL의 혼합 줄바꿈으로 생긴 Windows/Linux 해시 차이는 Git의 LF 원문으로 계약을 다시 고정했다.
서명 검사나 해시 검사를 끄지 않았고, SQL 실행 내용도 바뀌지 않았다.

## 자동으로 임시 스택 준비하기

Docker가 있는 PC 또는 GitHub Actions에서 다음 명령으로 빈 스택 준비부터 SDK 검사·정리까지 실행한다.

```powershell
corepack pnpm supabase:provider:integration --allow-disposable-local-stack
```

`scripts/provider-local-supabase-stack.mjs`는 매번 임시 디렉터리·고유 project ID·빈 포트를 만든다.
이 저장소의 linked 프로젝트나 과거 migration 전체를 실행하지 않으며, 고정된 제공자 SQL과
검사에 필요한 public 선행 테이블만 넣는다. Auth·PostgREST·Storage는 Supabase CLI의 실제
서비스다. 운영 복원본은 아니다. SDK 검사 전에 DB의 운영 system identifier·기존 Auth 사용자·
public 테이블·Storage 객체를 확인하여 기존 데이터가 있으면 중단한다.

Docker는 이 컴퓨터의 기본 로컬 소켓만 사용한다. 상속된 Supabase 자격증명·DB 환경변수·
원격 Docker context는 제거한다. CLI가 출력하는 로컬 키·비밀번호·서비스 오류 원문은 출력하지
않고 단계 이름만 기록한다. 종료 시 이번 실행의 ID만 `stop --no-backup`으로 정리하며,
전체 프로젝트 정지나 운영 연결 기능은 없다.

`.github/workflows/provider-integration.yml`의 **Provider Auth and Storage** 검사는 이 명령을
별도 Ubuntu runner에서 실행한다. 저장소 secret이나 hosted 테스트 프로젝트를 사용하지 않는다.
CI 파일을 추가한 것만으로 실제 통합 통과를 선언하지 않으며 해당 commit의 실행 결과를 확인해야 한다.

현재 웹의 service-role 목적지 검사는 hosted Supabase URL만 허용하므로 이 로컬 runner를
Next HTTP 검증으로 간주하지 않는다. 그 검증에는 승인된 빈 hosted 환경이 추가로 필요하다.

## 준비 조건

- Docker 호환 런타임을 갖춘 별도 로컬 Supabase 스택이 필요하다. 외부에 노출하지 않는다.
- API는 `http://127.0.0.1:<port>`, DB는 `postgresql://...@127.0.0.1:<port>/postgres`만 받는다.
- Auth 사용자가 0명이고 제공자 6개 테이블과 `provider-portfolio` 객체가 모두 비어 있어야 한다.
- 검토된 provider Storage fence와 관련 migration, 기존 계정삭제 테이블을 먼저 갖춘 폐기 가능한 스택이어야 한다.
  이 runner는 migration 적용·DB 초기화·원격 연결·운영 release controller 우회를 하지 않는다.
- 로컬 Auth 관리자 생성/비밀번호 로그인, Storage SDK, PostgREST RPC가 실제로 실행되어야 한다.
- DB 계정은 synthetic 사용자 3명의 `profiles.is_admin` 설정과 읽기 검증을 할 수 있어야 한다.

Supabase 기본 로컬 스택의 시작 조건은 [공식 로컬 개발 문서](https://supabase.com/docs/guides/local-development/cli-workflows)를 참고한다.
기존 운영 복제본·복구 검증 branch·실제 사용자 데이터가 있는 개발 DB에서는 실행하지 않는다.

## 실행

프로젝트 `.env`를 자동으로 읽지 않는다. 별도 프로세스에 다음 환경변수를 주입한다. 값·JWT·비밀번호를 로그에 출력하지 않는다.

```text
PROVIDER_QA_SUPABASE_URL
PROVIDER_QA_DATABASE_URL
PROVIDER_QA_ANON_KEY
PROVIDER_QA_SERVICE_ROLE_KEY
```

```powershell
node scripts/provider-local-supabase-sdk-qa.mjs --allow-empty-local-synthetic-writes
```

키는 로컬 Supabase 스택의 서로 다른 anon/service_role 키여야 한다. 운영 키를 복사하지 않는다.
명시 실행 인자·리터럴 loopback URL 검증·기존 데이터 없음 검증을 모두 통과한 후에만 합성 계정을 생성한다.
SDK 요청은 동일 origin만 허용하며 redirect를 따라가지 않는다.

## 검사 범위와 종료 증거

- 실제 Auth SDK로 합성 소유자·타인·관리자 생성 및 로그인, DB와 Auth API가 같은 사용자 ID를 보는지 확인.
- 가입 동의를 서버 metadata로 기록한 후 신청→관리자 승인→명시 공개. 승인 전 업로드와 타인 조작, 직접 table 쓰기 거부.
- 실제 WebP bytes를 service SDK로 private Storage에 저장하고 다운로드 bytes 일치 확인.
- anon·소유자·타인이 Storage 원본에 직접 접근하지 못하는지 확인. 실제 owner RPC만 사진 확정.
- 공개 pause/suspend/restore 상태, 이미 발급된 관리자 세션의 DB 역할 회수, 미승인 쓰기 거부.
- 사진 공개 철회→실제 Storage 객체 삭제→Auth 삭제에 따른 FK cascade 및 옛 세션 거부.
- 실제 사진 정리 worker에 같은 로컬 SDK를 전달하여 35분 전 실행 거절, lease 중복 실행 방지,
  DELETE 전송 실패 주입 후 파일 보존·checkpoint 미완료, lease 만료 후 실제 삭제·checkpoint·재실행을 검사.
  합성 사진 행의 시간만 앞당기므로 실제 35분 경과나 계정삭제 worker 검증은 아니다.
- 생성한 파일 경로·Auth ID만 정리하고 SQL로 정리 여부를 확인. 파일 삭제가 불확실하면 synthetic 소유자를 남겨 재시도 가능하게 한다.

성공 JSON의 `environment`는 `actual-local-supabase-auth-storage-postgres`이며 각 통과 검사와 `cleanupSucceeded`를 포함한다.
실패 시 단계명과 정리 확인 여부만 출력하고 서비스 응답·SQL 오류·인증정보는 출력하지 않는다.

**검사 밖:** Next HTTP route와 브라우저 흐름, 실제 배포, 운영 DB의 정책, 35분 대기 계정삭제 worker 전체, 동시 업로드 부하.
사진 전달 HTTP 경로·삭제 worker는 별도 단위/통합 테스트와 함께 판단해야 한다. 이 SDK runner 결과만으로 배포 가능을 선언하지 않는다.

안전장치만 검증하는 명령:

```powershell
node --test scripts/tests/provider-local-supabase-sdk-qa.test.mjs
```
