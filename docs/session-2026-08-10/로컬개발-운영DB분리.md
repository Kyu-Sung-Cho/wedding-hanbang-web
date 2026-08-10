# 로컬 개발이 운영 DB를 보는 문제 — 조사와 대응

> 2026-08-10 · 조사만 수행, 코드·git·DB 변경 없음
> 계기: 2차 감사에서 "로컬 `.env.local` 이 운영 Supabase 를 가리킨다"가 별건 티켓으로 나왔다.

---

## 0. 결론 먼저

**스테이징으로 옮기기 전에 할 일이 따로 있다. 그리고 그건 이미 만들어져 있다.**

```bash
node ./scripts/dev-web-local.mjs
```

이 런처가 합성 Supabase 환경을 주입해 띄운다. **어떤 실제 프로젝트에도 접근할 수 없는 상태**로 뜬다.
`package.json` 에 등록돼 있지 않아 `node` 로 직접 실행해야 한다.

| 단계 | 무엇 | 작업량 | 상태 |
|---|---|---|---|
| **0** | 운영 핀을 `.env.local` 밖으로 빼고 화면 작업은 위 런처로 | XS | **오늘 가능** |
| 1 | 스테이징 프로젝트가 살아 있는지 대시보드 확인 | XS | 사용자 작업 |
| 2-A | 살아 있으면 → 5핀 교체 | S | |
| 2-B | 죽었으면 → 새 프로젝트 (미검증 실패 지점 2개) | M~L | |

---

## 1. destination fence — 이미 스테이징을 전제로 설계돼 있다

`apps/web/src/lib/supabase/destinationFence.ts`

```ts
if (expectedProjectRef === productionProjectRef && input.access !== "read") {
  const expectedConfirmation = `${access === "runtime" ? "RUNTIME_WRITE" : "OPERATOR_WRITE"}:${expectedProjectRef}`;
  if (input.productionWriteConfirmation !== expectedConfirmation) {
    blocked("PRODUCTION_WRITE_CONFIRMATION_REQUIRED", ...);
  }
}
```

**EXPECTED ≠ PRODUCTION 이면 확인 토큰 분기 자체를 안 탄다.**

펜스가 요구하는 4가지:

| 검사 | 내용 |
|---|---|
| URL 형식 | `https://<20자ref>.supabase.co` 정확히. 포트·경로·쿼리 있으면 거부 |
| URL ↔ ref | 호스트가 `<EXPECTED_PROJECT_REF>.supabase.co` 여야 함 |
| service-role 키 | JWT면 `payload.ref === EXPECTED_PROJECT_REF` |
| 운영 쓰기 확인 | `EXPECTED === PRODUCTION` 일 때만 요구 |

같은 형태가 이미 저장소에 있다 — `scripts/lib/synthetic-supabase-environment.mjs` 가
EXPECTED / PRODUCTION 을 서로 다르게 두고 `WRITE_CONFIRM` 을 비운다.
웹 vitest 기본 환경(`apps/web/src/test/supabaseDestinationEnv.ts`)도 같은 모양이다.

### 펜스를 타는 곳 / 안 타는 곳

| 경로 | 파일 | 펜스 |
|---|---|---|
| 브라우저·SSR anon | `lib/supabase/{client,server,public,middleware}.ts` | **안 탐** |
| 서버 service-role | `lib/supabase/admin.ts` → `verifyRuntimeSupabaseServiceDestination()` | **매 호출마다 탐** |
| 부팅 | `instrumentation.ts` | 부팅 시 1회 — **조합이 틀리면 앱이 안 뜬다** |

⚠ URL 하나만 바꾸고 `EXPECTED_*` 를 안 바꾸면 **읽기는 스테이징, 쓰기는 부팅 실패**라는 혼종이 된다.

---

## 2. 바꿀 것 / 그대로 둘 것

```diff
# apps/web/.env.local
- NEXT_PUBLIC_SUPABASE_URL=https://<운영ref>.supabase.co
+ NEXT_PUBLIC_SUPABASE_URL=https://<스테이징ref>.supabase.co
- NEXT_PUBLIC_SUPABASE_ANON_KEY=<운영>
+ NEXT_PUBLIC_SUPABASE_ANON_KEY=<스테이징>
- SUPABASE_SERVICE_ROLE_KEY=<운영>
+ SUPABASE_SERVICE_ROLE_KEY=<스테이징>
- SUPABASE_EXPECTED_URL=https://<운영ref>.supabase.co
+ SUPABASE_EXPECTED_URL=https://<스테이징ref>.supabase.co
- SUPABASE_EXPECTED_PROJECT_REF=<운영ref>
+ SUPABASE_EXPECTED_PROJECT_REF=<스테이징ref>

  SUPABASE_PRODUCTION_PROJECT_REF=<운영ref>          ← 그대로 둔다
- SUPABASE_PRODUCTION_WRITE_CONFIRM=RUNTIME_WRITE:<운영ref>
+ SUPABASE_PRODUCTION_WRITE_CONFIRM=                 ← 비운다
```

### ⚠ `SUPABASE_PRODUCTION_PROJECT_REF` 를 스테이징으로 바꾸면 세 곳이 동시에 깨진다

1. **펜스가 `EXPECTED === PRODUCTION` 으로 판정** → 스테이징인데도 확인 토큰을 요구.
   `instrumentation.ts` 가 부팅 시 검사하므로 **앱이 아예 안 뜬다**
2. `scripts/ingest/destination.ts` 에 운영 ref 가 코드로 핀돼 있고
   `scripts/ingest/load.ts` 의 `assertRepositoryProductionProjectRef()` 가 대조 → ingest 경로 전체 실패
3. `scripts/vendor-public-rls-probe.mjs` → `PRODUCTION_TARGET_FORBIDDEN`

조사 중 `scripts/lib/supabase-service-destination.mjs`(펜스의 mjs 사본)를 직접 호출해 3케이스 실측했다.

### 같이 복사해 오면 안 되는 것

| 변수 | 왜 |
|---|---|
| `NEXT_PUBLIC_PREVIEW_STUB_MODE=true` | `/api/*` 전체가 503 |
| `PRODUCTION_WRITE_FENCE_ENABLED` | 순수 플래그(환경 무관). 운영 값 복사 금지 |
| `SUPABASE_ACCESS_TOKEN` | 앱 런타임은 안 씀. 운영 점검 스크립트 전용이라 그대로 두면 됨 |

`PRICE_CATALOG_EXPECTED_PUBLISHED_VENDOR_*` 와 `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` 은
`VERCEL_ENV=production` 일 때만 검사하므로 스테이징에서는 비워도 통과한다.

---

## 3. env 를 바꿔도 운영을 보는 스크립트들

**환경변수와 무관하게 운영 ref 를 하드코딩하거나 릴리스 매니페스트에서 읽는다.**

| 파일 | 출처 |
|---|---|
| `scripts/audit/production-readiness-audit.mjs` | 운영 ref 하드코딩 + `.env.local` 직접 파싱 |
| `scripts/audit/saved-notes-real-path-e2e.mjs` | 동일 |
| `apps/web/scripts/amora-engine-v2-hosted-integration.mjs` | 동일 |
| `apps/web/scripts/amora-preview-integration.mjs` | 동일 |
| `scripts/lib/{post-push-platform-evidence,production-write-fence-evidence,storage-signed-upload-drain-evidence}.mjs` | `supabase/release-manifests/*.json` |

⚠ `.env.local` 의 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 를 스테이징으로 바꾸면
위 audit 스크립트가 **운영 URL + 스테이징 키** 조합이 되어 깨진다. 이게 0단계에서 운영 핀을
별도 파일로 빼야 하는 이유다.

### 별도 변수군을 쓰는 것 (펜스를 아예 안 탐)

`scripts/ingest/*` — `INGEST_TARGET_ENV`(staging 만 허용), `SUPABASE_PROJECT_REF`,
`INGEST_STAGING_PROJECT_REF`, `SUPABASE_URL`(NEXT_PUBLIC_ 아님) 등 자체 계약.
`scripts/vendor-public-rls-probe.mjs` — `SUPABASE_STAGING_PROJECT_REF`. 스테이징 ref 는
`supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json` 에 핀돼 있다.

---

## 4. 스테이징 프로젝트는 이미 핀돼 있다 — 신설이 아니라 재사용

`supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json` 에
공시 v2 스테이징 프로젝트 ref 가 고정돼 있다. 2026-07 공시 적재·발행 리허설에 쓴 것이다.

**살아 있고 스키마가 서 있으면 난이도가 완전히 달라진다.**
아래 위험군은 **전부 "198개 마이그레이션을 새 프로젝트에 처음부터 올릴 때"만** 발생한다.

### 2-B(신설) 의 미검증 실패 지점 2개

1. **`pg_cron` 확장** — 대시보드에서 먼저 켜지 않으면 `20260718203000` 에서 죽는다
2. **`storage.objects` 소유권** — `20260429000001` 에서 `must be owner of relation objects` 가 날 수 있다.
   해소하려면 정책 DDL 6개 파일을 손봐야 하는데 **저장소 수정이라 별도 승인 사안**이다

그래서 2-B 는 시간이 아니라 **결론이 안 나는 지점이 실재해서** M~L 이다.

### 2-A(재사용) 절차

1. 대시보드에서 프로젝트 생존 + `v_public_prices` 뷰 확인
2. anon / service-role 키 복사
3. 위 §2 의 5핀 교체 (PRODUCTION_REF 는 건드리지 않음)
4. `NEXT_PUBLIC_SITE_URL=http://localhost:3000`
5. 대시보드 Auth → URL Configuration 에 Site URL / Redirect URLs 등록
6. Auth → Add user 로 Auto Confirm 계정 1개 생성 (스테이징엔 사용자가 0명이다)
7. `pnpm --filter @hanbang/web build` — **빌드가 `v_public_prices` 를 실제로 읽으므로 이게 스키마 유무의 리트머스다**

---

## 5. 로컬 도커(`supabase start`)는 앱 대체재가 못 된다

`destinationFence.ts` 의 `parseCanonicalHostedUrl` 이
포트가 있는 URL(`http://localhost:54321`)과 `*.supabase.co` 가 아닌 호스트를 **원천 차단**한다.
`instrumentation.ts` 가 부팅 시 검사하므로 앱이 안 뜬다.

스키마 replay 검증용 실험대로는 쓸 만하나 **선택지가 아니라 보조 도구**다.
(로컬도 `pg_cron` 게이트에서 같은 벽을 맞는다.)

---

## 6. 부수 발견 — 펜스에 구멍 하나

`destinationFence.ts` 의 `validateServiceRoleKey` 는 **키가 JWT 일 때만**
`payload.ref === expectedProjectRef` 를 검사한다.

신형 `sb_secret_...` 불투명 키는 **형식 정규식만** 통과하고 ref 바인딩이 없다.
URL 이 안 맞으면 실제 접속은 실패하겠지만, **펜스 통과 시점에서는 안 걸린다.**

별건 티켓으로 남긴다. (심각도 낮음 — URL 핀이 실질 방어를 하고 있다)

---

## 7. [미확인]

| 항목 | 왜 |
|---|---|
| 스테이징 프로젝트 생존 여부 | Supabase 대시보드 접근 필요. 이 조사는 네트워크 호출을 하지 않았다 |
| 스테이징에 앱 스키마가 서 있는지 | 위와 동일. 공시 적재용으로만 썼을 가능성 |
| 마이그레이션 198개의 새 프로젝트 replay 성공 여부 | 실행해야만 알 수 있다 |
| `storage.objects` 소유권 실패 여부 | 위와 동일 |

---

## 8. 조사 범위 고지

이 조사에서 **코드·git·DB 를 전혀 변경하지 않았고 네트워크 호출도 하지 않았다.**
위 절차는 전부 사용자 실행 대상이다. 4개 에이전트, 도구 호출 203회.
