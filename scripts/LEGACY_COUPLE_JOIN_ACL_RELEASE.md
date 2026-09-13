# Legacy couple join: 정확한 함수 ACL 한 건 릴리스

상태: **2026-09-13 운영 권한 회수 적용·별도 사후 조회 완료.** 기존 전체 DB migration allowlist나 release controller의 허용 범위를 바꾸지 않는다. 이 문서는 정확한 ACL 한 건의 결과이며 전체 웹 출시·두 브라우저·전체 DB/Auth/Storage 복원 완료 증명이 아니다.

2026-09-13 03:38:00 UTC 최초 Management `inspect`는 `legacy-executable`을 확인했다. 이후 Root가 같은 운영 대상에서 리허설·적용·별도 사후 조회를 실행했다. 완료 시각과 결과는 아래 실제 receipt를 기준으로 기록한다. 사후 상태에서 별도의 운영 `rollback` 명령을 실행한 것은 아니다.

## 운영 적용 결과

| 단계 | 완료 시각 UTC (KST) | 결과 / 로컬 receipt |
|---|---|---|
| 리허설 | 2026-09-13 03:39:28.189 (12:39:28.189) | `rehearsed-and-rolled-back`. 트랜잭션 안의 변경을 되돌려 기존 세 함수 ACL/MD5와 일치. `join-acl-rehearse-1789270765868.json` |
| 적용 | 2026-09-13 03:39:41.407 (12:39:41.407) | `legacy-revoked`. 대상 authenticated EXECUTE만 회수하고 사후조건 통과. `join-acl-apply-1789270777666.json` |
| 독립 후조회 | 2026-09-13 03:40:15.565 (12:40:15.565) | `legacy-revoked`. 원래 연결과 분리된 inspect에서 동일 정의·권한을 확인. `join-acl-inspect-1789270814666.json` |

위 세 receipt의 경로는 `C:/Users/kcho1/.codex/visualizations/launch-closeout-20260913/`다.
적용 SQL SHA256은 `4c20c3e7211c70551e11efb9801569540dc76e916d1283d3caa921cdcfe50458`이며 실제 receipt에서 대조했다.

- `join_couple(text,text)`는 `{postgres=X/postgres}`이고 anon/authenticated/service_role effective EXECUTE 모두 false.
- `join_couple_server(uuid,text,text)`는 기존 service_role EXECUTE만 허용하는 상태를 유지했다.
- `join_couple_invite_core(uuid,text,text,text)`는 고객·service_role 직접 EXECUTE 모두 금지 상태를 유지했다.
- 세 함수 정의 MD5는 리허설 전·후, 적용 전·후, 후속 inspect에서 일치했다. 함수 본문·계정/커플 행·Auth/Storage·migration history 변경을 릴리스 범위에 추가하지 않았다.

현재 실제 두 브라우저의 초대·연결 변경·상대 표시 확인은 마스터 점검표 W06에 남긴다.
실행 권한 조회 결과를 새로운 두 계정 API 연결 실행 또는 모든 과거 설치 앱의 호환성 검사로 확대하지 않는다.

## 변경과 복구 범위

대상은 `slrtobkksjmxgzatjyqb`의 `public.join_couple(text,text)` 실행 권한뿐이다. 적용 전 ACL은 `{postgres=X/postgres,authenticated=X/postgres}`였고 적용 후 실제 ACL은 `{postgres=X/postgres}`다. `PUBLIC`의 권한 부재와 `anon`, `authenticated`, `service_role`의 effective EXECUTE false를 요구한다. 함수 본문, 계정, 커플, 초대, 가입 동의, migration history, Auth·Storage 데이터는 변경하지 않는다.

`join_couple_server(uuid,text,text)`와 `join_couple_invite_core(uuid,text,text,text)`의 정확한 함수 정의·소유자·ACL·effective 권한은 사전/사후 동일해야 한다. 의도하지 않은 overload, inherited 권한, 정의 변경은 거절한다. 서버 함수는 service_role만 호출할 수 있고 core는 고객·service_role 직접 호출이 모두 금지된 기존 상태를 유지한다.

복구는 정확한 기존 `authenticated` EXECUTE 한 건의 복원이다. 현재가 예상된 회수 후 상태일 때만 `GRANT`하고 트랜잭션 안에서 원래 ACL까지 확인한다. 이는 **동의 우회 경로를 다시 여는 보안상 후퇴**이므로 운영 담당자가 장애 원인·영향을 검토하고 명시적으로 선택한다. 자동 rollback이나 재시도는 없다. 전체 DB/Auth/Storage 복구를 이 ACL 한 건의 선행조건으로 요구하지 않는다.

## 적용 전 실제 확인

1. 웹 `/api/onboarding`과 `/api/couple/link`가 배포된 소스에서 본인 `auth.getUser()` 및 가입 동의를 검사한 뒤 `join_couple_server`를 호출하는지 확인한다. `/api/couple/link`는 클라이언트가 지목한 사용자 ID나 역할을 받지 않는다.
2. 현재 모바일 `apps/mobile/app/onboarding/index.tsx`는 `/api/onboarding`을 사용한다. 현재 소스와 전체 로컬 git 이력의 모바일 `join_couple` 검색은 일치 없음. 이는 **모든 과거 설치 바이너리의 동작 증거는 아니다**. 배포 담당자는 구형 직접 RPC 소비자가 지원 대상에 있는지 판정한다. 서버 API 경로가 없는 구 클라이언트는 회수 후 연결만 거절된다.
3. 동의된 전용 시험 계정에서 정상 API 연결·동일 요청 재시도·미동의 계정 거절을 확인한다. 실제 사용자 연결은 시험하지 않는다. 준비된 API 시험 helper는 시험이 생성한 계정에만 사용한다.
4. 코드를 독립 검토하고 아래 로컬 시험을 실행한다. 현재 함수 신원·권한을 `inspect`로 다시 확인한다. 다른 함수 정의나 예상 밖 ACL이면 계약을 임의 완화하지 않고 중단한다.

## 실행 계약

기본 연결은 루트의 `pg` 패키지이며 공식 direct DB hostname·포트·DB·사용자와 TLS 인증서 검증을 고정한다. `JOIN_ACL_TRANSPORT=management`를 명시하면 기존 릴리스 도구에서도 사용하는 공식 `https://api.supabase.com/v1/projects/slrtobkksjmxgzatjyqb/database/query`를 사용한다. 이 어댑터는 같은 inventory·고정 SQL만 허용하며 임의 SQL 파일·URL을 받지 않는다. 현재 연결 자격증명은 환경으로만 전달하고 콘솔·문서·Git에 남기지 않는다.

환경:

- `JOIN_ACL_PROJECT_REF=slrtobkksjmxgzatjyqb`
- `JOIN_ACL_TRANSPORT`: `direct`(기본) 또는 `management`.
- direct 연결의 `JOIN_ACL_DATABASE_URL`: 승인된 PostgreSQL 연결 문자열. `postgres` 사용자, `/postgres` DB, 포트 5432. 비밀번호는 기존 비밀 전달 경로 사용.
- management 연결의 `SUPABASE_ACCESS_TOKEN`: 기존 운영 PAT를 프로세스 환경으로만 전달. DB 비밀번호·새 계정·IPv6 연결은 필요 없다.
- `JOIN_ACL_CONFIRMATION`: 쓰기 모드마다 `legacy-couple-join-acl-20260913:slrtobkksjmxgzatjyqb:<mode>`와 정확히 일치해야 한다.

각 명령의 마지막 인수는 **존재하지 않는** 로컬 receipt 파일 경로다. 기록에 비밀번호·고객 행은 포함되지 않는다. `inspect`는 카탈로그만 읽으며 확인 문자열이 필요 없다.

```powershell
node scripts/legacy-couple-join-acl-release.mjs inspect <새 사전확인.json 경로>
node scripts/legacy-couple-join-acl-release.mjs rehearse <새 리허설.json 경로>
node scripts/legacy-couple-join-acl-release.mjs apply <새 적용.json 경로>
node scripts/legacy-couple-join-acl-release.mjs inspect <새 사후확인.json 경로>
```

`rehearse`도 실제 권한 DDL을 트랜잭션 안에서 실행한 뒤 `ROLLBACK`하므로 승인된 운영 단계에서만 실행한다. `apply`는 사전 상태를 파일에 먼저 기록하고, 같은 트랜잭션 안의 사전조건 → REVOKE → 사후조건 → COMMIT 순서로 실행한다. 잠금 제한 5초·문장 제한 30초다. 에러 시 rollback을 요청하지만 연결 단절의 결과는 추정하지 않는다. `prepared-outcome-unverified` 또는 오류 receipt가 남았다면 **새 inspect로 사실을 확인한 뒤** 결정한다.

Management API에서도 같은 BEGIN→사전조건→REVOKE→사후조건→COMMIT 전체 문자열을 한 HTTP 요청으로 보낸다. inspect에는 SQL `BEGIN READ ONLY`를 씌운다. API의 `read_only:false`는 기존 도구와 같이 관리 연결을 선택하며 읽기 SQL 자체는 READ ONLY 트랜잭션으로 제한한다. 요청마다 연결이 다를 수 있어 실패 후 별도 HTTP `ROLLBACK`을 보내거나 성공적인 복구로 간주하지 않는다. 해당 오류는 결과 미확인으로 남고 새 inspect로 판단한다. HTTP 재시도·redirect는 금지된다. 공식 계약: [Run SQL query](https://supabase.com/docs/reference/api/v1-run-a-query).

장애 시 별도 승인한 `rollback` 모드를 사용한다. 시작 상태는 반드시 정확한 회수 후 상태여야 하고, 복구도 동일한 전후 검사를 통과해야 한다.

적용 후 익명·로그인 사용자 direct RPC의 42501 거절(실제 가입이 발생하지 않는 검사), 정상 서버 API의 연결/재시도, 미동의 사용자 API 거절을 각각 확인한다. ACL 검사 성공은 전체 서비스 출시 승인이나 모든 과거 앱 호환 검증을 의미하지 않는다.

## 로컬 검증 및 기존 수동 시험

```powershell
node --test scripts/tests/legacy-couple-join-acl-release.test.mjs
corepack pnpm --filter @hanbang/web exec vitest run src/lib/couples/__tests__/coupleInviteExpiryTruthfulness.test.ts src/lib/couples/__tests__/membershipRpc.test.ts src/app/api/couple/link/__tests__/route.test.ts src/app/api/onboarding/__tests__/route.test.ts src/app/api/onboarding/__tests__/onboardingConsentGate.test.ts src/app/api/onboarding/__tests__/roleMismatchBeforeRpc.test.ts
```

PGlite는 실제 기존 마이그레이션 세 개로 함수를 구성하고 운영에서 읽은 정의 hash와 일치하는지 확인한다. 권한 거절·실제 서버 연결·재시도·사후조건 실패 rollback·정확한 ACL 복구·데이터 불변을 검사한다. 이 합성 DB 결과를 hosted 실행 완료로 적지 않는다.

`amora-preview-integration.mjs`, `amora-engine-v2-hosted-integration.mjs`의 join은 이제 `AMORA_PREVIEW_APP_URL`의 인증 API를 사용한다. 앱 URL을 실행 전에 명시해야 하며, 기존 Supabase 대상·생산 거절/생산 합성시험 확인·정리 조건은 그대로 유지한다. helper는 세션 소유자와 앱의 `auth/me?consent_only=1` 사용자 ID를 맞춘 뒤 현재 정책판 동의를 API로 기록하고 온보딩 join을 실행한다. 공유 예식일·예산·진행 필드는 보내지 않는다. 이 수동 시험은 본 작업에서 운영 실행하지 않았다.
