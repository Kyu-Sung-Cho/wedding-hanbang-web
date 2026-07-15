# 보안 감사 2.1 — 관리자·인증·프로필·온보딩 API (2026-07-03)

> **폐기된 역사 문서 — 현재 구현·로드맵·마케팅·세일즈 근거로 사용 금지.** 아래 보안 등급, 안전 확인과 취약점 수는 당시 코드 감사 기록이며 현재 안전성이나 출시 승인을 증명하지 않는다. 현재 제공 범위는 [`WEDDINGHANBANG_SERVICE_DOC.md`](../WEDDINGHANBANG_SERVICE_DOC.md), 현재 상태는 [`PROJECT_STATUS.md`](../PROJECT_STATUS.md), 제품 판단 원칙은 [`CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md`](./CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md)만 따른다.

> [!WARNING]
> **역사 감사 스냅샷입니다.** 아래 발견은 당시 코드 기준이며 현재 실행 지침이 아닙니다. 최신 판정은 `CONSUMER_JOURNEY_AND_RELEASE_AUDIT_2026-07-11.md`와 실제 코드를 따릅니다. 프로덕션 가짜 시드는 현재 환경변수 우회 없이 하드 차단됩니다.

> 대상: `api/admin/*`(16), `api/auth/*`(5), `api/profile`, `api/onboarding` = 23개 라우트.
> 방법: 그룹별 탐지 에이전트 → 취약점 주장별 반박 에이전트(오탐 제거) → **확정 3건은 감사자(Claude)가 직접 재검증**.
> 관점: 자사 코드 방어 감사. 심각도는 보수적으로.

## 결론: ⚠️ 취약 (그러나 심각한 구멍은 없음)

- **critical/high 확정 0건** — 인증/인가 기반은 견고
- **medium 확정 3건** (전부 "인증된 관리자/사용자" 전제의 내부 결함, 외부 무인증 공격로 아님)
- 저심각도 21건(주로 에러 원문 노출·rate limit 부재), 안전 확인 38건

### 잘 되어 있는 것 (직접 확인)
- `verifyAdmin`(adminAuth.ts:12-34): JWT를 `getUser()`로 검증 후 service client로 `is_admin` 재확인, 예외 시 fail-closed. **관리자 API 16개 전부 핸들러 첫 줄에서 이 게이트를 통과**
- `is_admin` 자기승격은 DB 트리거로 차단(migrations 20260612120000) — 애플리케이션+DB 이중 방어
- 미들웨어가 `/api/admin/*`를 안 덮지만, 각 라우트가 자체 `verifyAdmin`으로 방어 (설계상 일관됨)
- admin 라우트 대부분 action allowlist·파라미터화 쿼리·mass-assignment 차단·감사 로그까지 갖춤

## 확정 취약점 3건 (medium) — 전부 감사자 직접 재검증 완료

### C1. 시드 라우트 4개: 프로덕션 환경 게이트 + 멱등성 부재
**파일**: `api/admin/seed-{vendors,studios,makeup,venues}/route.ts`
**직접 확인한 사실**:
- 네 라우트 모두 `verifyAdmin` 게이트는 있음(seed-vendors:240 등) — **인증은 안전**
- 그러나 `NODE_ENV`/`VERCEL_ENV`/`ALLOW_SEED` 환경 게이트가 **네 라우트 전부 0건** → 프로덕션에서도 호출 가능
- 멱등성 없음: `vendors.name` UNIQUE 제약 없음 + plain insert → 재호출마다 가짜 업체(30+20+15+12) + 상품 + 타임슬롯 중복 생성
- 생성 데이터가 `ai_recommend:true, status:"approved"` → 검수 없이 실사용자·AI 추천 표면에 즉시 노출

> ⚠️ **감사 과정 주의점 (투명 기록)**: 워크플로는 seed-vendors만 CONFIRMED, 나머지 3개를 REFUTED로 판정했으나, 이는 **탐지 에이전트가 vendors 건은 "환경게이트 부재"로, 나머지는 "인증 부재"로 잘못 표현**했기 때문. 감사자 직접 확인 결과 **네 라우트는 동일한 실제 결함(환경게이트+멱등성 부재)을 공유**한다. REFUTED는 "인증은 있다"가 맞을 뿐, 결함이 없다는 뜻이 아님.

**리스크**: 관리자 세션 탈취 1회 또는 운영자 실수 재호출 1번 → 프로덕션 DB 오염. 현재 실업체 기능이 숨김 상태라 즉시 피해는 시드 데이터에 국한되나, 실업체 온보딩 시작되면 C2가 현실화.

### C2. seed-vendors PUT: 실제 입점 업체 타임슬롯 무차별 개방
**파일**: `api/admin/seed-vendors/route.ts:327-408`
**확인**: `category=dress AND status=approved` **전체** 벤더의 `vendor_timeslots`/`product_timeslots`를 시드 필터 없이 조회 → 전량 `available:true`, `max_bookings 3/2/1` 강제. 스키마에 "시드 여부" 마커가 없어 실업체와 구분 불가. 실입점 업체가 생기면 그들의 예약 가용성 데이터를 이 라우트가 덮어씀.

### C3. onboarding create: 기존 커플 소속 미검사 → 커플 고아화
**파일**: `api/onboarding/route.ts:106-178`
**직접 확인한 사실**:
- create 경로가 `profiles`에서 `id`만 조회(`select("id")`), **couple_id를 안 봄** → 기존 커플 소속 검사 전무
- 소속 검사 없이 새 `couples` insert 후, service role(`getAdmin`, RLS 우회)로 `profiles.couple_id`를 무조건 덮어씀
- **비대칭**: join 경로는 `join_couple` RPC가 'already linked'를 검사하는데, create 경로엔 동등 가드 없음
- DB 자가변경 잠금(20260612130000)은 `role IN (authenticated, anon)`일 때만 작동 → service role 쓰기는 통과(설계상 면제)

**리스크**: 커플 A에 연동된 사용자가 `coupleAction=create`를 호출하면 → 새 커플 B 생성 + A의 슬롯 점유 잔존(파트너가 대체 불가) + wedding_journeys 중복. 데이터 정합성 파손. 무인증 공격은 아니고 "본인 계정 오작동" 수준이지만, 온보딩 재실행 UX로 우발 발생 가능.

## 저심각도 21건 (요약, 미개별검증)
- **에러 원문 노출** (admin/vendors GET, auth/delete, auth/callback, onboarding, seed 4종): Supabase/PostgREST 내부 에러 메시지를 응답에 그대로 반환 — 프로젝트 "내부 원문 노출 금지" 컨벤션 위반. 다른 5개 admin 라우트는 마스킹하고 있어 일관성 결여
- **rate limit 부재** (admin 6종, seed 4종, onboarding create): 대부분 admin 인증 뒤라 낮음. 단 seed는 요청당 수천 행 insert
- **auth/delete rate limit이 인메모리 Map** — Vercel 인스턴스별이라 사실상 우회 가능(signup/forgot는 persistent 사용 — 불일치)
- **auth/signup 타이밍 기반 enumeration 잔여** — 응답 본문은 동일하나 미가입 이메일은 Resend 외부 호출로 응답 지연차 발생
- **admin/auth?check=exists** 무인증으로 admin 계정 존재 여부 노출
- **demoSession HMAC 시크릿이 SERVICE_ROLE_KEY→ADMIN_PASSWORD로 폴백** — 최고권한 키를 HMAC 용도로 재사용(키 분리 원칙 위반)
- **onboarding progress JSONB 무검증 저장** (깊이/크기 캡 없음), **초대코드 폴백이 Math.random 2^24** (RPC 정상 시엔 2^48이라 폴백 경로 한정)

## 권고 우선순위
1. **C1 즉시**: seed 라우트 4개에 `if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_SEED) return 403` 한 줄씩 (5분, 격리 변경)
2. **C3**: onboarding create 시작부에 기존 couple_id 검사 → 있으면 409 (join과 대칭)
3. **C2**: seed PUT을 시드 벤더로 한정하거나 라우트 제거 (실업체 온보딩 전 필수)
4. 저심각도: 에러 마스킹 일관화 + auth/delete rate limit을 persistent로 통일 (묶어서 처리 가능)
