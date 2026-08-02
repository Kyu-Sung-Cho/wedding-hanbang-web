# 보안·개인정보 하드닝 인수인계 (2026-08-03)

이 문서는 `codex/security-hardening-20260802` 브랜치를 다른 컴퓨터에서 이어서
검토·개발·릴리스하기 위한 현재 소스 오브 트루스다. 오래된 세션 문서와 내용이
충돌하면 이 문서, 실제 코드, 패키지 매니페스트, 릴리스 매니페스트 순으로 다시
확인한다.

## 1. 현재 상태

- 원격 저장소: `https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git`
- 작업 브랜치: `codex/security-hardening-20260802`
- 기준 커밋: `0f84665e9b8828f30e5a83ca5854ef618c3f4518` (`origin/main`)
- 범위: 웹, 모바일, 공유 패키지, Supabase 마이그레이션, 수동 플랫폼 작업,
  릴리스 게이트, CI, 테스트, 운영 문서
- 소스 상태: 하드닝 구현과 로컬 검증 완료
- 운영 상태: **미배포**. 운영 DB 마이그레이션, Storage 정책 변경, Auth 설정,
  Vercel production 배포를 실행하지 않았다.
- 릴리스 상태: `deployment_blocked`. 국외이전 고지, 업체 공시·모바일 외부 서명
  승인, 후속 Supabase controller와 필수 운영 증거가 없으면 production 빌드·모바일
  EAS 릴리스·Supabase 릴리스가 실패하도록 되어 있다.

이 브랜치는 review·staging 후보이지 “운영 반영 완료”가 아니다.
DB나 Storage가 실제로 바뀌었다는 주장은 반드시 별도 운영 receipt로 확인한다.

## 2. 다른 컴퓨터에서 시작하기

새 클론에서는 다음 순서로 시작한다.

먼저 원격 브랜치가 실제로 게시됐는지 확인한다. 이 명령이 실패하면 기준
`origin/main`만 받아 하드닝 변경 0바이트인 상태가 되므로 아래 작업을 진행하지
않는다.

```powershell
git ls-remote --exit-code --heads https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git refs/heads/codex/security-hardening-20260802
```

```powershell
git clone https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git
Set-Location wedding-hanbang-web
git fetch --prune origin
git switch --track -c codex/security-hardening-20260802 origin/codex/security-hardening-20260802
corepack enable
corepack pnpm install --frozen-lockfile
git status --short --branch
$localHead = git rev-parse HEAD
$remoteHead = git rev-parse origin/codex/security-hardening-20260802
if ($localHead -ne $remoteHead) { throw "remote branch와 로컬 HEAD가 다릅니다." }
```

이미 같은 브랜치가 있다면 새 브랜치를 만들지 말고 다음처럼 동기화한다.

```powershell
git switch codex/security-hardening-20260802
git fetch --prune origin
git pull --ff-only
corepack pnpm install --frozen-lockfile
```

필수 런타임은 루트 `package.json` 기준 Node.js `>=22.13.0`, pnpm `>=11.7.0`,
고정 package manager는 `pnpm@11.7.0`이다.

`apps/web/.env.local`과 모바일 로컬 환경 파일은 Git에서 복원되지 않는다.
`.env.example`을 참고하되 운영 비밀값은 팀의 비밀 저장소에서 별도로 받아야 한다.
서비스 역할 키, 운영 access token, 백업 데이터, 사용자 원문, signed URL, 원본
receipt처럼 비밀·PII가 포함된 자료는 Git에 추가하지 않는다. 릴리스 계약이 요구하는
공개 가능한 최소 count/hash/status evidence만 비밀 제거 검토 후
`docs/operations/evidence/`에 추가하고 manifest에서 해시로 고정한다.

## 3. 이번 브랜치에서 닫은 보안 경계

### 인증·세션·관리자

- 관리자 API를 Supabase 사용자 확인, `is_admin`, 서명형 step-up 쿠키,
  same-origin mutation 증거에 결합했다.
- 관리자 읽기·쓰기 API에 영속 rate limit을 적용하고 인증 실패 시 service-role
  client를 만들기 전에 종료한다.
- OAuth 모바일 콜백을 PKCE code 교환으로 고정하고 callback URL의 access/refresh
  token 수용을 차단했다.
- 비밀번호 복구 링크, 새 비밀번호 설정, 전역 로그아웃 경계를 분리했다.
- 계정 전환 시 Zustand·브라우저 캐시·커뮤니티 초안 등 사용자 범위 로컬 상태가
  다음 사용자에게 남지 않도록 정리했다.

핵심 파일:

- `apps/web/src/lib/auth/adminStepUp.ts`
- `apps/web/src/lib/admin/adminReadBoundary.ts`
- `apps/web/src/lib/auth/supabaseBrowserSession.ts`
- `apps/web/src/lib/auth/userScopedClientState.ts`
- `apps/web/src/app/api/auth/callback/route.ts`
- `apps/web/src/app/auth/mobile-callback/page.tsx`

### 공개 API 남용·본문 크기·오류 노출

- 공개·인증 API에 PostgreSQL 기반 영속 rate limit을 적용하고 다중 인스턴스에서
  메모리 limiter로 우회되지 않도록 했다.
- JSON, multipart, 이미지, 채팅 요청의 본문 상한을 스트리밍 파싱 전에 검사한다.
- `/api/chat` ingress limiter를 최대 16 MiB 본문 파싱과 위기 응답 분기보다 앞에
  두었고, 인증 사용자가 남은 demo 쿠키로 demo 경계를 선택하지 못하게 했다.
- provider/DB 예외를 고정 진단 코드로 바꾸고 로그·응답에서 원문, 이메일, UUID,
  query string, 파일 경로와 토큰을 제거했다.

핵심 파일:

- `apps/web/src/utils/rateLimit.ts`
- `apps/web/src/utils/requestValidation.ts`
- `apps/web/src/utils/safeErrorDiagnostic.ts`
- `apps/web/src/utils/sensitiveLoggingBoundary.test.ts`
- `apps/web/src/app/api/chat/route.ts`
- `packages/shared/src/security/serverSecretPolicy.mjs`

### 개인정보 동의·사전등록·분석

- 사전등록을 Turnstile, 현재 개인정보 처리 버전 동의, 이메일 double opt-in으로
  전환했다.
- 확인 전 데이터는 AES-256-GCM 암호문과 keyed digest로 30분만 보관하며, 확인
  GET 요청은 상태를 바꾸지 않는다.
- 고객 설문과 vendor staff 공개 정보에 동의 증거·버전·시각을 요구한다.
- PostHog와 사용자 식별 분석은 명시적 opt-in 전에는 초기화하거나 식별하지 않는다.
- 개인정보 처리방침의 실제 기능 상태와 source gate가 어긋나지 않도록 truthfulness
  테스트를 추가했다.

운영 문서:

- `docs/operations/PREREGISTRATION_DOUBLE_OPT_IN_2026-08-03.md`
- `docs/operations/PASSWORD_CHANGE_SECURITY_GATE.md`

### AI 사용·비용·로그

- AI 호출을 사용자·커플·demo·release-eval 경계로 분리하고, 커플별·전역 일일
  quota와 비용 원장을 적용했다.
- tool mutation을 현재 사용자와 커플에 묶고 원자적 RPC 또는 명시적 서버 경계를
  거치게 했다.
- `ai_interactions_log`에 FORCE RLS를 적용하고 client role의 테이블·컬럼·sequence
  권한을 제거했다. service role은 필요한 `SELECT`와 `INSERT`만 갖는다.
- 로그에는 프롬프트·응답 원문 대신 제한된 분류, 비용, 모델, 상태와 가명 식별자를
  남긴다.

핵심 파일:

- `apps/web/src/lib/ai/auditedOpenAI.ts`
- `apps/web/src/lib/ai/costGuard.ts`
- `supabase/migrations/20260803113000_harden_ai_interactions_log_acl.sql`

### 커뮤니티·RLS·IDOR

- 프로필, 게시물, 댓글, 투표, 북마크, 설문, cohort, vendor 메시지 등 직접 mutation
  우회와 과도한 SELECT 정책을 닫았다.
- 게시물·댓글·투표·평판 카운터를 DB 트랜잭션에서 원자적으로 관리한다.
- 정지 사용자는 모든 활성 커뮤니티 쓰기 경로에서 transaction-local actor gate로
  차단한다.
- UUID에서 결정적으로 파생된 기존 시스템 닉네임을 무작위 공개 닉네임으로
  교체한다.
- 공개 응답용 `community_public_id`를 도입했지만 기존 모바일 호환성을 위해 Auth
  UUID 권한 제거는 수동 후속 작업으로 남겼다.

핵심 파일:

- `apps/web/src/lib/community/actorFence.ts`
- `apps/web/src/lib/community/actorWriteGate.ts`
- `apps/web/src/lib/community/publicIdentity.ts`
- `supabase/migrations/20260803103000_add_community_public_identities.sql`
- `supabase/migrations/20260803112000_enforce_community_suspended_actor_write_fence.sql`
- `docs/operations/COMMUNITY_PUBLIC_IDENTITY_ROLLOUT_2026-08-03.md`

### 이미지·Storage

- 커뮤니티 업로드 경로는 서버가 생성하며 MIME 문자열이 아니라 실제 바이트를
  디코딩한다.
- 새 채팅 이미지는 서버가 크기·픽셀·프레임 수를 제한하고 EXIF/GPS/ICC/IPTC/XMP
  metadata가 없는 새 이미지로 재인코딩한 뒤 Storage와 AI provider에 같은 정제
  바이트를 보낸다.
- PDF와 지원하지 않는 포맷은 reviewed sanitizer가 생길 때까지 fail-closed다.
- 브라우저의 `chat-image` 직접 업로드 정책을 0개로 만드는 수동 Supabase Storage
  작업과 검증·rollback SQL을 릴리스 매니페스트에 고정했다.

핵심 파일:

- `apps/web/src/lib/community/imageSanitizer.ts`
- `apps/web/src/lib/ai/amoraImageAttachments.ts`
- `supabase/platform-operations/storage/20260802159000_chat_image_server_upload_fence_apply.sql`
- `docs/operations/CHAT_IMAGE_SERVER_UPLOAD_FENCE_2026-08-03.md`

### 모바일

- Supabase 인증 세션은 SecureStore에만 저장하고 AsyncStorage fallback을 금지했다.
- 이전 앱 버전이 원래 Supabase key 아래 AsyncStorage에 남긴 평문 세션을 최초
  접근 전에 삭제한다. 삭제 실패 시 인증 저장소 접근도 실패하도록 했다.
- Android 앱 데이터 backup/restore를 비활성화했다.
- Sentry의 기본 PII, request, user, breadcrumb, span, component context를 제거하고
  보수적인 production sampling을 적용했다.
- 미서명 OTA update는 code signing이 준비될 때까지 비활성화했다.
- 커뮤니티 투표·북마크·cohort mutation을 모바일의 직접 service-only RPC 호출이
  아니라 인증된 웹 API 경계로 보낸다.

핵심 파일:

- `apps/mobile/src/lib/supabase.ts`
- `apps/mobile/src/lib/sentryPrivacy.ts`
- `apps/mobile/app.json`
- `apps/mobile/src/__tests__/secureStoreSession.test.mjs`

### 공급망·CI·브라우저 경계

- 알려진 취약점이 있던 직접·전이 의존성을 업데이트하고 lockfile을 동기화했다.
- Dependabot과 CI 보안 계약을 보강했다.
- production CSP에서 `unsafe-eval`을 제거하고 Supabase·Sentry·Turnstile 등 실제
  허용 origin만 조립한다.
- 외부 URL, WebView, 공유 URL, redirect는 HTTPS·동일 출처·허용 scheme 규칙을
  통과해야 한다.
- 모바일의 associated domain과 Android intent filter는 `hanbang.ai`의 HTTPS 링크로
  제한했다. 서버의 AASA와 `assetlinks.json` 검증 파일은 아직 없으며 P2 후속
  작업으로 남아 있다.

## 4. DB와 릴리스 매니페스트

`supabase/release-manifests/vendor-disclosure-v2-20260718.json`이 이 브랜치의
후속 릴리스 계약이다. 다음을 포함해 총 82개 migration을 해시로 고정한다.

현재 read-only validator 결과는 `migrationCount=82`, forward-only 보안 작업 1개,
`deploymentBlocked=true`, `releaseCommit=null`이다. hosted staging, backup, hosted
restore, Storage, finalizer evidence는 모두 `missing`이며 이번 릴리스의 공개 가능한
receipt도 아직 없다.

- `20260802120000`부터 시작하는 trusted-field, 직접 mutation, 커뮤니티·vendor,
  Auth, push, 계정 삭제, Storage 관련 hardening
- `20260803100000` 이후 event trust, 설문 동의, preregistration, 공개 identity,
  media path, direct chat/couple rate limit, 원자적 커뮤니티 쓰기, vote RPC,
  vendor photo like, 정지 사용자, AI 로그 ACL hardening
- chat-image Storage 수동 작업과 rollback/verify artifact
- 공개 community identity 권한 cutover용 forward-only 수동 작업

정적 검증은 다음 명령으로 실행한다.

```powershell
corepack pnpm supabase:release:fence
corepack pnpm supabase:release:test
```

`corepack pnpm supabase:push`는 직접 push를 거부한다. 현재
`supabase:release:apply`도 후속 manifest의 릴리스 본체가 controller에 배선되지 않아
의도적으로 실패한다. 백업, isolated restore, staging RLS probe, write fence, exact
pending set, 수동 작업 receipt와 canary를 준비하고, reviewed successor controller를
구현·검증한 뒤에만 이 명령을 운영 반영에 사용한다.

## 5. 마지막 로컬 검증 결과

2026-08-02~03 KST에 격리 worktree에서 직접 확인한 결과다.

| 검증 | 결과 |
|---|---|
| 최초 실패 회귀 묶음 | 12 files, 66 tests 통과 |
| 웹 전체 Vitest | 509 files, 4,075 tests 통과 |
| 모바일 전체 Node tests | 175 tests 통과 |
| 루트 `corepack pnpm test` | 통과 |
| `corepack pnpm typecheck` | 4 packages 통과 |
| `corepack pnpm lint` | 오류 0, 기존 비보안 경고 8 |
| preview stub 웹 빌드 | Next.js 컴파일·TypeScript·116개 정적 페이지 생성 통과 |
| production dependency audit | 알려진 취약점 0 |
| 전체 dependency audit | 알려진 취약점 0 |
| `corepack pnpm mobile:release-check` | 109/109 통과 |
| `corepack pnpm supabase:release:test` | 188/188 통과 |
| static release fence | predecessor 27 migrations, successor 82 migrations 검증 |
| `git diff --check` | 통과 |
| production build probe | 의도대로 `PRIVACY_CROSS_BORDER_NOTICE_NOT_APPROVED`에서 차단 |

production build 실패는 현재 결함이 아니라 릴리스 안전장치다. 국외이전 고지와
처리자 보관 계약 승인 없이 성공하도록 우회하면 안 된다. vendor disclosure도
외부의 짧은 수명 서명 승인이 구현되기 전까지 별도 gate로 차단된다.

preview 빌드는 `VERCEL_ENV=preview`, `NEXT_PUBLIC_PREVIEW_STUB_MODE=true`와 저장소의
합성 public Supabase 값으로 수행했다. 코드 컴파일과 정적 생성 증거이며 hosted
카탈로그, production 환경변수, production 배포 성공 증거는 아니다.

다른 컴퓨터에서 변경 후 공유하기 전 최소 재검증:

```powershell
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm audit --prod --audit-level low
corepack pnpm audit --audit-level low
corepack pnpm mobile:release-check
corepack pnpm supabase:release:test
corepack pnpm supabase:release:fence
git diff --check
```

## 6. 아직 닫히지 않은 운영 차단 항목

### P1: 배포 전에 반드시 처리

1. **운영 미반영**
   - 이 브랜치의 코드·DB·Storage·Auth 설정은 아직 production에 적용되지 않았다.
   - 현재 운영 CSP와 API 동작을 이 소스와 같다고 가정하지 않는다.

2. **채팅 이미지 Storage cutover**
   - `20260802159000` 수동 작업을 적용하기 전에 전역 Storage write fence를 열면,
     같은 커플의 인증 사용자가 직접 업로드 후 `metadata.imagePaths`를 넣어 서버
     재인코딩을 우회할 수 있다.
   - 정책 0개, authenticated mutation 0개 receipt와 실제 direct-upload 실패
     canary가 없으면 배포하지 않는다.
   - 기존 객체는 자동 정제되지 않는다. 별도 inventory, quarantine, re-encode,
     DB rewrite, 지연 삭제 작업이 필요하다.

3. **공개 Auth UUID cutover**
   - 웹·모바일 최소 지원 버전을 먼저 강제한다.
   - 공개 응답·로그·Realtime에 Auth UUID가 없는지 staging에서 검증한다.
   - 그 뒤에만 `20260803104500_community_public_identity_contract_apply.sql`을
     실행한다. 이 작업은 forward-only이며 Auth UUID 공개 권한을 되살리는 rollback은
     허용하지 않는다.

4. **개인정보·국외이전 승인**
   - 실제 처리자, 이전 국가, 이전 시점·방법, 보유기간, 문의처, 거부 방법과 효과를
     법무·개인정보 담당자가 확인하고 공개 문구와 계약을 승인해야 한다.
   - 코드의 production build fence는 이 승인 자체를 환경변수로 대체하지 않는다.

5. **업체 공시 외부 서명 승인 검증기**
   - `apps/web/vendorDisclosureProductionBuildFence.ts`는 정적 릴리스 계약을
     통과해도 production 빌드를 항상 차단한다.
   - 릴리스 controller와 빌드가 함께 검증하는 외부의 짧은 수명·재사용 방지
     서명 승인을 구현하고, 만료·대상 브랜치/커밋·릴리스 digest·nonce 소비를
     검증하기 전에는 이 차단을 해제하지 않는다.

6. **후속 Supabase 릴리스 controller**
   - 현재 `scripts/lib/supabase-production-release-controller.mjs`는 후속 manifest를
     감지하지만 실제 릴리스 본체는 이전 manifest를 대상으로 하므로
     `SUCCESSOR_RELEASE_CONTROLLER_NOT_IMPLEMENTED`로 항상 차단한다.
   - 후속 migration·수동 작업·receipt·rollback 계약을 controller에 배선하고 전체
     릴리스 테스트를 통과시키기 전에는 `supabase:release:apply`를 실행 경로로
     간주하지 않는다.

7. **모바일 production 릴리스 승인**
   - `scripts/mobile-eas-release-gate.mjs`는 production profile에서 현재
     `MOBILE_PRODUCTION_RELEASE_AUTHORIZATION_NOT_IMPLEMENTED`로 provider 실행 전에
     항상 차단한다.
   - 외부 서명 승인, credential freeze와 정확한 commit/release binding을 구현·검증한
     뒤에만 production EAS build를 허용한다. `mobile:release-check` 통과는 이
     fail-closed 계약의 검증이지 production build 성공 증거가 아니다.

8. **Hosted Supabase 설정**
   - Auth 가입 전 동의 hook, 비밀번호 정책, secure password change, SMTP 알림,
     redirect allowlist를 실제 hosted project에 적용하고 별도 계정으로 검증한다.
   - DB network CIDR, SSL 강제, PITR, 데이터가 있는 shadow branch 상태를 다시
     점검하고 운영 기준에 맞게 닫는다.

9. **운영 worker와 보존 정책**
   - 계정 삭제 intake/worker와 AI 로그 retention cron은 staging 검증과 운영
     모니터링 준비 전까지 비활성 상태다.
   - preregistration pending purge도 배포 후 확인 전에는 활성화하지 않는다.

10. **GitHub·Vercel 릴리스 통제**
   - secret/code scanning, Dependabot alerts, branch protection, CODEOWNERS, required
     checks, environment approval, CI 실패 시 Vercel 후보 배포 차단을 repository
     settings에서 확인한다.

### P2: 출시 전 제품·호환성 결정

- cohort 멤버·메시지·타임라인 일부는 호환성 때문에 같은 cohort 안에 raw Auth
  UUID를 아직 전달한다. 웹·모바일·Realtime·mention/report를 함께 바꾸어야 한다.
- 기존 `community-images/<auth-uuid>/...` 객체는 새 random v2 path로 안전하게
  옮기는 별도 운영 작업이 필요하다.
- 2026-08-02 라이브 점검에서는 AASA와 `assetlinks.json`이 404였고, 이 브랜치에도
  서버 검증 파일이 아직 없다. 실제 Team ID·bundle ID·Android signing fingerprint를
  확인해 두 파일을 생성·검토·배포한 뒤 iOS/Android verified link를 실제 기기에서
  다시 확인한다.
- 기존 설치 앱의 OTA 상태, 잠금화면 push payload, 화면 캡처·앱 전환기 미리보기의
  개인정보 노출 정책을 실제 기기에서 확인한다.
- 기존 사전등록 행은 동의 증거가 없으므로 자동 verified 처리하지 않는다. 보존,
  재동의, 삭제와 self-service 철회 절차를 운영 정책으로 정해야 한다.
- vendor staff 공개 동의의 실제 수집·철회 운영 흐름을 마련해야 한다.

## 7. 권장 릴리스 순서

1. Draft PR에서 전체 diff와 이 문서를 검토하고 required checks를 통과시킨다.
2. 후속 Supabase 릴리스 controller와 웹·업체 공시·모바일의 외부 단기 서명 승인
   검증을 별도 reviewed 변경으로 구현하고 전체 릴리스 테스트를 통과시킨다.
3. production과 분리된 hosted staging/clone을 준비한다.
4. DB와 Storage 원본을 각각 백업하고 isolated restore를 실제로 검증한다.
5. 새 controller의 check-only, exact pending migration, 수동 작업과 rollback 계약을
   검증한다.
6. 전역 write fence를 닫은 상태에서 자동 migration을 적용하고 웹·모바일 후보를
   staging에 배포해 인증, 관리자, 커뮤니티, AI, 탈퇴, preregistration, 이미지,
   push를 canary한다.
7. 국외이전·처리방침, hosted Auth, cron·보존, CI·Vercel 승인을 끝내고 정확한
   commit/release에 묶인 외부 서명 승인을 받은 production-compatible 웹·모바일
   후보만 배포한다.
8. public identity의 `1030/1040` 계약과 호환되는 웹·모바일 production 배포 후 최소
   지원 앱 버전을 강제한다. 실제 production 트래픽에서 Auth UUID가 공개 응답·로그·
   Realtime에 없는지 확인하고 inventory를 완료한 뒤에만 forward-only `1045`를
   apply·verify한다.
9. 전역 write fence를 유지한 채 chat-image legacy 객체 inventory와 clone canary를
   끝내고 Storage 정책 0개 작업을 apply·verify한다. hosted direct upload 거부와 서버
   재인코딩을 확인한다.
10. Auth·worker·보존·CI·Vercel·실기기 증거와 최종 canary receipt를 수집한다.
11. 릴리스 finalizer와 모든 post-push 검증이 성공한 경우에만 전역 write fence를
    연다.

## 8. 다음 작업자가 지켜야 할 것

- `git reset --hard`, 운영 `db push`, 수동 정책 복붙, receipt 없는 배포를 하지 않는다.
- release manifest가 고정한 migration·SQL·문서의 바이트를 바꾸면 해시도 reviewed
  절차로 다시 계산하고 전체 release test를 실행한다.
- 테스트 fixture가 새 보안 경계를 실패하면 production 경계를 약하게 되돌리지 말고
  fixture가 실제 인증·step-up·same-origin·rate limit 계약을 통과하게 고친다.
- 운영 상태를 직접 확인하지 않은 숫자나 설정은 `UNVERIFIED`로 남긴다.
- 로그와 PR에 사용자 원문, 이메일, UUID, object path, signed URL, access token,
  service-role key, 백업 payload를 붙이지 않는다.
- 이 감사는 정적 분석과 자동 테스트다. 외부 침투 테스트와 법률 검토를 대체하지
  않는다.

## 9. 빠른 파일 지도

| 목적 | 경로 |
|---|---|
| 저장소 원칙 | `PRINCIPLES.md`, `AGENTS.md` |
| 웹 보안 환경 예시 | `apps/web/.env.example` |
| 모바일 보안 환경 예시 | `apps/mobile/.env.example` |
| 공개 API 남용 경계 | `apps/web/src/utils/rateLimit.ts`, `apps/web/src/utils/requestValidation.ts` |
| 관리자 step-up | `apps/web/src/lib/auth/adminStepUp.ts` |
| 계정 삭제 | `apps/web/src/lib/accountDeletion/`, `docs/operations/ACCOUNT_DELETION_STORAGE_SAGA.md` |
| AI 감사·비용 | `apps/web/src/lib/ai/auditedOpenAI.ts`, `apps/web/src/lib/ai/costGuard.ts` |
| 커뮤니티 공개 identity | `apps/web/src/lib/community/publicIdentity.ts` |
| 모바일 세션 | `apps/mobile/src/lib/supabase.ts` |
| DB 변경 | `supabase/migrations/` |
| 수동 플랫폼 작업 | `supabase/platform-operations/` |
| 릴리스 계약 | `supabase/release-manifests/vendor-disclosure-v2-20260718.json` |
| 릴리스 controller | `scripts/supabase-production-release.mjs` |
| 모바일 출시 gate | `scripts/mobile-release-readiness.mjs` |
