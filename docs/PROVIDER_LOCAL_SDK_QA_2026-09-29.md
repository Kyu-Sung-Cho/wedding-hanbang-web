# 개인·팀 제공자 로컬 Auth·Storage SDK 검증

이 스크립트는 **실제 로컬 Supabase 서비스가 있을 때만** Auth·Storage·PostgreSQL 통합을 검사한다.
HTTP mock, PGlite의 `auth.uid()` 대체 함수, Storage 메타데이터에 직접 넣은 행으로 실제 검증을 대신하지 않는다.

## 현재 확인한 환경

2026-09-29 이 작업 PC에서 Supabase CLI 2.106.0은 실행되었지만 Docker·Podman 명령/설치 경로/엔진 파이프가 없고 WSL도 미설치 상태였다.
따라서 이 스크립트의 실제 통합 실행은 **미검증**이다. 실행 안전장치 단위 테스트 통과는 통합 통과가 아니다.
기존 PG17 테스트는 SQL·RLS·트랜잭션 검증이며 실제 Auth·Storage 서비스 검증과 구분한다.

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
- 생성한 파일 경로·Auth ID만 정리하고 SQL로 정리 여부를 확인. 파일 삭제가 불확실하면 synthetic 소유자를 남겨 재시도 가능하게 한다.

성공 JSON의 `environment`는 `actual-local-supabase-auth-storage-postgres`이며 각 통과 검사와 `cleanupSucceeded`를 포함한다.
실패 시 단계명과 정리 확인 여부만 출력하고 서비스 응답·SQL 오류·인증정보는 출력하지 않는다.

**검사 밖:** Next HTTP route와 브라우저 흐름, 실제 배포, 운영 DB의 정책, 35분 대기 계정삭제 worker 전체, 동시 업로드 부하.
사진 전달 HTTP 경로·삭제 worker는 별도 단위/통합 테스트와 함께 판단해야 한다. 이 SDK runner 결과만으로 배포 가능을 선언하지 않는다.

안전장치만 검증하는 명령:

```powershell
node --test scripts/tests/provider-local-supabase-sdk-qa.test.mjs
```
