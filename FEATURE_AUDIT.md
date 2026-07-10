# Feature Audit Report

> ⚠️ **경고 (2026-07-03 감사)**: 이 감사는 2026-06-11 "Week 1 수술" **이전** 코드 기준입니다.
> 현재 상태는 `CLAUDE.md`, 최신 대조 결과는 `docs/DOC_VS_CODE_AUDIT_2026-07-03.md` 참고.
> **AI 공급자 주의 (2026-07-10)**: 아래 Claude/Anthropic 항목은 당시 스냅샷이며, 현재 아모라 런타임은 OpenAI GPT-5.6 Terra/Luna입니다.

**작성일**: 2026-04-23
**방법**: 코드 정적 분석 + 파일 존재 + schema 참조 (런타임 테스트 없음)
**범위**: `apps/web` (모바일 앱 미포함)

---

## Executive Summary

| 분류 | 개수 |
|------|------|
| ✅ 완전 작동 | 7 |
| ⚠️ 부분 작동 | 9 |
| ❌ 안 됨 | 1 |

**가장 심각한 Top 3 문제**:

1. **`chat_feedback` 테이블 migration 부재** — AI 피드백 학습 시스템 전체가 스키마 누락으로 작동 불가. `POST /api/chat/feedback`, `GET /api/chat/feedback` 둘 다 서버 오류 발생 예상.
2. **Schedule/Money/Bookings에 의존하는 `schedules`, `budget_items`, `fitting_requests` 테이블 migration 부재** — PROJECT_STATUS.md에서 언급되지만 실제 migration에는 정의 없음. `schedules`는 코드가 `from("schedules")`를 호출하지 않으니 문제 없음. `budget_items`는 journey.progress JSONB 쓰므로 무관. 단 **`fitting_requests`는 /fitting 페이지가 coming-soon 상태라 비활성**.
3. **커뮤니티 검색 API가 `community_posts.search_vector` 컬럼 전제** — migration에 선언되어 있지만, tsvector를 채우는 trigger/update 로직이 schema에서 확인되지 않음. 검색 결과가 항상 비어있을 위험.

---

## Phase 1 — 프로젝트 구조

### Monorepo
- **Root**: `pnpm@9.15.0` + `turbo@^2.3.0`, Node >= 20
- **Apps**: `@hanbang/web` (Next.js), `@hanbang/mobile` (Expo)
- **Packages**: `@hanbang/shared`, `@hanbang/design-tokens`

### 웹 주요 dependency (apps/web/package.json)
| Package | Version |
|---------|---------|
| next | **16.1.6** |
| react | 19.2.3 |
| @supabase/ssr | ^0.8.0 |
| @supabase/supabase-js | ^2.95.3 |
| @anthropic-ai/sdk | **^0.74.0** |
| @tosspayments/tosspayments-sdk | ^2.5.0 |
| resend | ^6.9.1 |
| framer-motion | ^12.34.0 |
| lucide-react | ^0.563.0 |
| zustand | ^5.0.11 |
| tailwindcss | ^4 |
| typescript | 5.9.3 |
| @sentry/nextjs | ^10.47.0 (devDependency로 등록되어있음 — 의심스러움) |

### 모바일 주요 dependency
| Package | Version |
|---------|---------|
| expo | ~54.0.0 |
| expo-router | ~6.0.0 |
| expo-apple-authentication | ^55.0.13 |
| react-native | 0.81.4 |
| nativewind | ^4.1.23 (실제 미사용이라 메모) |
| @react-native-async-storage/async-storage | 2.2.0 |

### 웹 route 구조 (17 상위 디렉토리)

**(admin)**:
- `/admin`, `/admin/login`

**(app)**: 로그인 후 서비스 페이지
- `/bookings`, `/bookings/[id]`
- `/budget`, `/chat`, `/dashboard`, `/etiquette`, `/fitting`
- `/invitations`, `/invitations/[id]`, `/invitations/[id]/edit`, `/invitations/[id]/stats`, `/invitations/templates`
- `/market-prices`, `/money`, `/schedule`, `/scripts`, `/settings`
- `/vendors`, `/vendors/[id]`, `/vendors/favorites`

**(auth)**:
- `/login`, `/onboarding`

**(community)**:
- `/community`, `/community/[category]`
- `/community/cohort`, `/community/cohort/[id]`
- `/community/guestbook`, `/community/guestbook/new`
- `/community/my/bookmarks`, `/community/my/posts`, `/community/my/upvoted`
- `/community/post/[id]`, `/community/post/write`
- `/community/quick-review`
- `/community/vendor/[name]`

**public / 기타**:
- `/`, `/auth/mobile-callback`, `/business`, `/business_dress`, `/business_makeup`, `/business_studio`
- `/customer`, `/customersurvey`, `/demo/login`
- `/guestbook/[slug]`, `/invite/[slug]`, `/reset-password`

**vendor B2B**:
- `/vendor/login`, `/vendor/register`, `/vendor/privacy`, `/vendor/terms`, `/vendor/service`
- `/vendor/(portal)/{analytics,bookings,contracts,contracts/templates,dashboard,messages,products,profile,settings,settlements,staff,timeslots}`

### API endpoint (총 ~120개)

**핵심 카테고리 숫자**:
- `/api/admin/*` — 11개
- `/api/auth/*` — 5개
- `/api/community/*` — 22개
- `/api/chat/*` — 4개
- `/api/invitations/*` — 11개
- `/api/vendor/*` — 16개 (B2B)
- `/api/vendors/*` — 4개 (B2C)
- `/api/contracts/*`, `/api/payments/*` — 각 3~4개

전체 route 목록은 `apps/web/src/app/api/**/route.ts` 88개 파일에 정의.

### Supabase migrations (16개)
```
20260201000000_preregistrations.sql
20260205000000_vendor_portal_system.sql
20260210000000_onboarding_couple_chat.sql
20260215000000_fix_rls_recursion.sql
20260218000000_fix_signup_trigger.sql
20260220000000_vendor_system.sql
20260224000000_customer_tracking.sql
20260225000000_admin_role.sql
20260301000000_contract_payment_system.sql
20260301000001_fix_rls_and_seed.sql
20260301000002_schema_improvements.sql
20260301100000_portone_to_toss.sql
20260302000000_phase3_invitation_ai_script.sql
20260325_community.sql
20260325_gamification.sql
20260408_community_v2.sql
```

### 환경 변수 (전체 15개 사용)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `[과거 환경변수] ANTHROPIC_API_KEY` — 현재 런타임은 `OPENAI_API_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_LAUNCH_MODE` (coming_soon 모드 제어)
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (장소 검색)
- `RESEND_API_KEY` (이메일)
- `TOSS_SECRET_KEY`, `NEXT_PUBLIC_TOSS_CLIENT_KEY`
- `ADMIN_PASSWORD` (간이 admin 인증)
- `AMORA_SERVICE_USER_ID`, `NEXT_PUBLIC_AMORA_USER_ID`
- `NODE_ENV`

`.env.local`은 존재하지만 `.env.example`은 확인 안 됨.

### CLAUDE.md 요약
- 프로젝트: hanbang.ai 웹 + 마케팅 랜딩
- 기술스택: Next.js 14 (실제 배포는 16), Supabase, Claude API, Zustand
- 기존 문서는 **Next.js 14** 기준이지만 실제는 **Next.js 16.1.6**. 구 CLAUDE.md는 monorepo 구조 이전 — 실제 현황과 불일치.

---

## Phase 2 — 웹 페이지 상세

### 1. `/chat` — AI 아모라
**판정**: ⚠️ 부분 작동

**이유**: 핵심 플로우(메시지 전송/스트리밍/도구 호출/mediation) 완전 구현. 단 피드백 시스템은 스키마 부재로 작동 불가.

**문제**:
- `chat_feedback` 테이블 migration 없음 → `/api/chat/feedback` POST/GET 호출 시 500 예상 (`feedbackLessons.ts`도 실패해서 `[]` 반환)
- `chat_summaries` 테이블 migration 없음. 본문 chat route (`app/api/chat/route.ts:272`)가 해당 테이블 SELECT. 현재 빈 결과로 fallthrough 할 것으로 예상 (치명적이진 않음)
- 파일 첨부는 UI는 준비되어 있으나 실제 업로드 API 연결 경로는 `/api/chat` 내부에서 base64로 처리 (문서화 필요)

**수정 난이도**: **S** — `chat_feedback`, `chat_summaries` 테이블 CREATE + RLS 추가 SQL 작성 (30분)

---

### 2. `/dashboard`
**판정**: ✅ 완전 작동

**이유**: `useAuthStore`만 사용, 단일 API `/api/couple/code`만 참조 (존재함). 카테고리 체크리스트/URGENT_TASKS/파트너 활동 피드 모두 클라이언트 계산.

**문제**:
- `ServiceGuide` 컴포넌트 첫 방문 시 노출. localStorage 체크 로직 OK.
- 실제 공용 이미지 `/images/dashboard-hero.jpg` 사용하지 않음 (그라디언트 fallback). 문제 없음.

**수정 난이도**: — (없음)

---

### 3. `/vendors`
**판정**: ⚠️ 부분 작동

**이유**: API 체인 `/api/vendors`, `/api/favorites`, `/api/events` 모두 존재. 단 업체 시드가 적으면 UX 빈약.

**문제**:
- `vendors` 테이블은 `CREATE TABLE` migration이 확인되지 않고 `ALTER TABLE vendors …`만 존재 → 테이블은 이미 존재한다고 가정되지만 baseline schema가 별도. **초기 DB 구축 시 재현성 리스크**.
- `vendors.aiRecommend`(코드에서 camelCase)와 `vendors.ai_recommend`(SQL) 매핑은 `vendorMapper.ts`에서 수행. 정상.
- `AmoraDirector`의 `hasPreferences` 판단이 `aiRecommendedIds.size > 0`에 의존 → 매칭된 업체가 우연히 0일 때도 “선호도 없음” 배너 노출 가능 (로직 결함)

**수정 난이도**: **S** — 선호도 체크 로직을 `journey.progress.__preferences`에서 직접 확인으로 변경

---

### 4. `/vendors/[id]`
**판정**: ⚠️ 부분 작동

**이유**: 핵심 API 7개 중 4개 GET만 경로 일치 확인. 예약 POST, 메시지 POST, 사진 좋아요 POST, 사진 GET 모두 실제 존재.

**문제**:
- `/api/vendors/[id]/photos` (GET/POST) 존재 확인됨
- `/api/messages` 존재 확인됨 — 단 대화 상대 스키마(`messages` 테이블)의 migration이 확인되지 않음. `messages` 테이블 CREATE가 migrations에 없음 → **500 예상**
- 업체에 상품/타임슬롯/스태프가 없으면 예약 UI 빈 상태 핸들링은 `NoAvailabilityPanel`로 처리

**수정 난이도**: **M** — `messages` 테이블 추가 또는 기존 `vendor_messages` 재사용하도록 API 수정 (2-3시간)

---

### 5. `/budget`
**판정**: ✅ 완전 작동

**이유**: 데이터는 `useAuthStore.journey.progress` JSONB. `/api/bookings/mine`만 외부 호출이고 존재. 서버 왕복 없음.

**문제**: 없음. **단** market-comparison 버튼이 `/market-prices`로 연결되는데 해당 페이지는 작동 OK.

**수정 난이도**: — (없음)

---

### 6. `/schedule`
**판정**: ✅ 완전 작동

**이유**: 전부 클라이언트 계산 + `useAuthStore.updateJourney` (authStore 내부에서 `/api/journey` POST). API 존재.

**문제**:
- `schedules` 테이블이 migrations에 없음 — **단 코드가 이 테이블을 쿼리하지 않음**. 모든 이벤트는 `progress.__events` JSONB에 저장됨. 실제 문제 없음.
- `TimelineView`, `CalendarView`, `ImminentAlerts`, `CategoryChecklistModal`, `EventFormModal` 파일 모두 존재 확인.

**수정 난이도**: — (없음)

---

### 7. `/community` (메인 피드)
**판정**: ⚠️ 부분 작동

**이유**: UI는 풍부하지만 데이터 의존성 중 일부가 의심스러움.

**문제**:
- `/api/community/search` 엔드포인트는 존재하지만 `community_posts.search_vector` tsvector의 UPDATE trigger가 migrations에서 확인되지 않음 → **FTS 검색 결과가 비어있을 가능성 매우 높음**. `community_posts` CREATE문에 `search_vector tsvector` 컬럼 선언은 있지만 자동 갱신 trigger는 확인 안 됨.
- `useCommunityRealtime` 훅이 존재하고 Realtime subscription 사용. Realtime publication이 Supabase 쪽에서 활성화되어 있어야 함 (런타임 전제, 여기선 확인 불가)
- `CommunityGuide`, `ServiceBanner`, `TrendingPosts`, `RightSidebar`, `GamificationWidget`, `CohortCardContainer` 전부 import 유효

**수정 난이도**: **M** — search_vector UPDATE trigger 추가 SQL + 기존 데이터 재색인 (2-3시간)

---

### 8. `/community/post/[id]`
**판정**: ⚠️ 부분 작동

**이유**: 투표/북마크/댓글/신고 전부 API 존재.

**문제**:
- `community_reports` 테이블은 `20260325_community.sql`에 존재 ✓
- 직접 Supabase 클라이언트 생성 (`createBrowserClient`) 하면서 RLS에 의존 → `community_bookmarks`, `community_votes` RLS 정책 유효성은 런타임에서만 확인 가능
- `useCommentsRealtime` 훅 사용 — Supabase Realtime publication 전제

**수정 난이도**: **S** — 문서화만 필요 (공식 Realtime publication 체크리스트)

---

### 9. `/community/post/write`
**판정**: ✅ 완전 작동

**이유**: Supabase 직접 INSERT + `/api/community/upload` (이미지) + 자동 저장 localStorage.

**문제**:
- 저장 타임아웃 없음 — 큰 이미지 업로드 시 UX 체감 느릴 수 있음
- `autoResize` 함수는 존재

**수정 난이도**: — (없음)

---

### 10. `/community/cohort/[id]`
**판정**: ⚠️ 부분 작동

**이유**: 스키마는 모두 존재 (`cohort_rooms`, `cohort_members`, `cohort_messages`, `cohort_contracts`, `cohort_timeline_events`, `cohort_stats` VIEW). 채팅/정보판/타임라인 3탭 로직 완전.

**문제**:
- 메시지 API가 FK 조인 우회해서 `community_profiles` 별도 쿼리로 author 붙이는 방식 — 이건 fix된 상태 (커밋 `12fca13`). 현재 안정.
- `insertPostTag`, `insertImageTag`, mention(@) 패턴이 `renderMessageContent`에서 regex 파싱 — 확인됨
- `PostPickerModal` 내부 `/api/community/search` 호출 — search_vector 이슈와 동일

**수정 난이도**: **M** — search_vector 이슈 해결되면 전체 작동

---

### 11. `/market-prices`
**판정**: ✅ 완전 작동

**이유**: 순수 정적 데이터 (`constants/marketPrices.ts`). API 없음.

**문제**: 없음.

**수정 난이도**: — (없음)

---

### 12. `/invitations`
**판정**: ⚠️ 부분 작동

**이유**: `useInvitationStore`가 14개 API 호출. `invitations`, `invitation_photos`, `invitation_accounts`, `invitation_rsvp`, `invitation_guestbook`, `invitation_templates` 테이블 모두 migrations에 존재.

**문제**:
- `/api/invitations/route.ts`, `/[id]/accounts`, `/[id]/photos`, `/[id]/rsvp`, `/[id]/stats` 파일 **대부분 try/catch 없음** (grep `-rL "try\|catch"` 결과). Supabase 에러가 unhandled 500으로 뜰 위험.
- `invitation_templates` 데이터가 시드되지 않으면 `/invitations/templates` 페이지는 비어있음. 시드 SQL 확인 필요.

**수정 난이도**: **M** — try/catch wrapping + 템플릿 시드 (2-3시간)

---

### 13. `/money`
**판정**: ⚠️ 부분 작동

**이유**: `congratulatory_money` 테이블은 migrations에 존재 ✓. API `/api/money`, `/api/money/[id]` 존재.

**문제**:
- money API 2개 파일 모두 **try/catch 없음**
- `/api/money/route.ts`에서 Supabase error만 체크 후 직접 반환. 권한 검증은 RLS에 의존 — OK
- 인증 없을 때 fast return ✓

**수정 난이도**: **S** — try/catch 추가

---

### 14. `/etiquette`
**판정**: ✅ 완전 작동

**이유**: 순수 정적 데이터 + `useAuthStore`만 사용. API 호출 없음.

**문제**:
- `NEXT_PUBLIC_LAUNCH_MODE === "coming_soon"` 모드일 때 비인증 사용자는 안 보임 — 기대된 동작

**수정 난이도**: — (없음)

---

### 15. `/scripts`
**판정**: ⚠️ 부분 작동

**이유**: `ai_scripts` 테이블 존재. store에서 `/api/scripts`, `/api/scripts/generate` 호출.

**문제**:
- `/api/scripts/*`의 3개 route 모두 **try/catch 없음**
- `ai_scripts` 테이블이 `/api/scripts/generate`에서 Claude API 호출로 생성 후 INSERT — 성공 시 OK
- `scriptStreaming` 상태 관리 존재

**수정 난이도**: **S** — try/catch 추가

---

### 16. `/bookings`
**판정**: ✅ 완전 작동

**이유**: `/api/bookings/mine` 호출. `vendor_bookings` 테이블은 baseline schema 가정 (`ALTER TABLE vendor_bookings` 여러 개 존재 → 기존 테이블). 관련 모든 참조 유효.

**문제**:
- `bookings` 목록 페이지는 OK. 취소/상세 흐름은 `/bookings/[id]` 서브 페이지 필요 여부 확인
- `vendor_bookings.staff_id` 컬럼이 한 migration에서 추가 — 마이그레이션 순서 맞으면 OK

**수정 난이도**: — (없음)

---

### 17. `/settings`
**판정**: ✅ 완전 작동

**이유**: `/api/couple/code`, `/api/auth/delete` 두 API만 사용. 둘 다 존재.

**문제**:
- `account_deletions` 테이블이 `/api/auth/delete`에서 사용되는지 확인 필요 — migration에 없음. 하지만 현재 로직 확인 결과 직접 `auth.admin.deleteUser` 호출로 대체될 수 있음.
- 알림 설정은 UI만 존재, 실제 저장 로직 미확인

**수정 난이도**: **S** — 알림 설정 실제 저장 연결 (30분)

---

## Phase 3 — Backend

### 3.1 Supabase 테이블 현황

**Migrations에 정의된 테이블 (44개)**:
```
ai_scripts, chat_messages
cohort_contracts, cohort_members, cohort_messages, cohort_rooms, cohort_timeline_events
community_achievements, community_bookmarks, community_comments, community_posts,
community_profiles, community_reports, community_streaks, community_vendor_tags,
community_votes, community_xp_log
congratulatory_money
contract_templates, contracts, couples
customer_events
guestbook_messages, guestbooks
invitation_accounts, invitation_guestbook, invitation_photos,
invitation_rsvp, invitation_templates, invitation_visits, invitations
payments, preregistrations, product_timeslots
search_logs, settlements, staff_timeslots
vendor_contract_templates, vendor_daily_stats, vendor_messages,
vendor_reviews, vendor_staff, vendor_timeslots, vendor_views
wedding_journeys
```

**Migrations에 `ALTER TABLE`만 있고 `CREATE TABLE` 없는 테이블 (baseline schema 가정)**:
```
profiles, vendors, vendor_products, vendor_bookings,
vendor_images, vendor_favorites
```
→ **초기 DB setup 시 migrations만으로는 전체 schema 재현 불가**. 별도 baseline SQL 필요.

**코드가 참조하지만 migrations 어디에도 없는 테이블 (누락)**:

| 테이블 | 참조 위치 | 영향 |
|--------|-----------|------|
| `chat_feedback` | `/api/chat/feedback/route.ts`, `lib/ai/feedbackLessons.ts` | AI 피드백 시스템 전체 비작동 |
| `chat_summaries` | `/api/auth/delete/route.ts`, `/api/chat/route.ts:272` | 대화 요약 SELECT 실패 |
| `account_deletions` | 없음 (기존 정보와 다름) | 미확인 |
| `vendor_photo_likes` | 코드에서 직접 `.from("vendor_photo_likes")` | 사진 좋아요 기능 실패 |
| `customer_survey_responses` | `/customersurvey` 기능 | 고객 설문 기능 실패 |
| `messages` (단일형) | `/api/messages/route.ts`에서 참조 | 고객-업체 메시지 DM 실패 |

**View로 정의된 것**:
- `cohort_stats` → `20260408_community_v2.sql` ✓ 정상

### 3.2 API route 현황

**총 88개 route.ts 파일**, 모두 `createClientFromRequest` 또는 `getServiceClient` 사용 패턴 일관.

**에러 처리 누락 route (`try`/`catch` 없음)**: 18개
```
admin/registrations, admin/seed-vendors, admin/vendors
invitations/photos/[photoId], invitations
invitations/templates, invitations/[id]/accounts
invitations/[id]/guestbook, invitations/[id]/photos/reorder
invitations/[id]/photos, invitations/[id]/photos/upload
invitations/[id], invitations/[id]/rsvp, invitations/[id]/stats
money, money/[id]
scripts, scripts/[id]
```

→ Supabase error를 그대로 반환하는 패턴이 많음. `error.message`가 클라이언트에 노출되는 보안/UX 이슈 있음.

**Auth helper 일관성**: 양호. 85% 이상이 `createClientFromRequest(req)` 사용 → 모바일 Bearer 토큰 호환.

### 3.3 RLS 정책

**RLS ENABLE된 테이블 확인** (grep `ENABLE ROW LEVEL SECURITY`):
```
preregistrations, profiles, couples, wedding_journeys, chat_messages,
vendor_timeslots, product_timeslots, vendor_reviews,
customer_events, search_logs, vendor_daily_stats, vendor_staff, staff_timeslots,
vendors, vendor_products, vendor_bookings, vendor_messages, vendor_views, vendor_favorites
contract_templates, vendor_contract_templates, contracts, payments, settlements
invitation_templates, invitations, invitation_photos, invitation_accounts,
invitation_rsvp, invitation_guestbook, invitation_visits, congratulatory_money, ai_scripts
community_profiles, community_posts, community_comments, community_votes,
community_bookmarks, community_reports
cohort_rooms, cohort_members, cohort_messages, cohort_contracts, cohort_timeline_events,
community_vendor_tags, guestbooks, guestbook_messages
community_xp_log, community_streaks, community_achievements
```

**주요 테이블 정책 점검**:
- `profiles` — RLS enabled (ALTER 구문 존재, 실제 정책은 baseline에 있다고 가정)
- `couples` — `20260210`에 정책 추가됨
- `community_posts` — 정책 있음
- `vendors` — 정책 있음
- `20260215_fix_rls_recursion.sql` 존재 → 초기 RLS recursion 버그 패치 이력 있음 → **RLS 디자인 복잡** 주의

### 3.4 환경 변수 리스트

**필수**:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `[과거 환경변수] ANTHROPIC_API_KEY` — 현재 AI 채팅은 `OPENAI_API_KEY`

**기능 제공자용**:
- `RESEND_API_KEY` (없으면 이메일 silent skip)
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (장소 검색 tool)
- `TOSS_SECRET_KEY`, `NEXT_PUBLIC_TOSS_CLIENT_KEY` (결제)
- `ADMIN_PASSWORD` (admin 페이지 간이 인증)
- `AMORA_SERVICE_USER_ID`, `NEXT_PUBLIC_AMORA_USER_ID` (AI 댓글 작성자)
- `NEXT_PUBLIC_LAUNCH_MODE` (coming_soon/live 스위치)
- `NEXT_PUBLIC_SITE_URL`

**미확인**:
- `.env.example` 파일 존재 여부 — 팀원 온보딩 어려움

---

## Phase 4 — Vendor 포털 (B2B)

**17개 페이지** (로그인/회원가입/약관 + 12개 포털 페이지)

### 전체 판정

**판정 요약**:
- `/vendor/login`, `/vendor/register` — API `/api/vendor/register`, `/api/vendor/me` 존재 → ✅ 구조 OK
- `/vendor/(portal)/dashboard` — `useVendorStore.loadDashboard()` → `/api/vendor/me` → ✅
- `/vendor/(portal)/products` — `/api/vendor/products` CRUD 완비 → ✅
- `/vendor/(portal)/bookings` — `/api/vendor/bookings` 완비 → ✅
- `/vendor/(portal)/contracts` + `/templates` — 전 API 존재 → ✅
- `/vendor/(portal)/profile` — `/api/vendor/profile` 존재 → ✅
- `/vendor/(portal)/settings` — `/api/vendor/settings` 존재 → ✅
- `/vendor/(portal)/analytics` — `/api/vendor/analytics` 존재. `vendor_daily_stats`, `search_logs`, `customer_events` 모두 migrations에 있음 → ✅
- `/vendor/(portal)/messages` — `vendor_messages` 테이블 있음 → ✅
- `/vendor/(portal)/settlements` — `/api/vendor/settlements`, `settlements` 테이블 있음 → ✅
- `/vendor/(portal)/staff` — `/api/vendor/staff`, `vendor_staff` 테이블 있음 → ✅
- `/vendor/(portal)/timeslots` — `/api/vendor/timeslots`, `vendor_timeslots` 있음 → ✅

### Vendor 시드 데이터 현황
- `/api/admin/seed-vendors` route 존재 → 테스트 시드 가능
- 실제 production seed 데이터는 **비어있을 가능성 높음** (시드 SQL 없음)
- 빈 DB에서도 `/vendors` 페이지는 작동하지만 "등록된 업체가 없습니다" empty state

### B2B 기능 Gap
1. **Vendor가 가입 후 접근할 수 있는 교육/온보딩 튜토리얼 없음**
2. **업체 프로필 완성도 진행률 표시 없음** (어디까지 입력했는지 가시화 부족)
3. **Contract 서명 flow** — 고객이 `/api/contracts/[id]/sign` 접근 경로는 있으나 실제 고객측 UI 진입점 미확인
4. **결제 → 정산 자동화** — `payments` → `settlements` 트리거 확인 필요
5. **Vendor 다크모드 유지** — 의도된 결정, 디자인 일관성 문제 아님

---

## Phase 5 — 공통 패턴

여러 페이지에서 반복되는 문제:

1. **`try/catch` 누락** — 18개 API route. 대부분 invitation/money/scripts 계열. Supabase 에러가 unhandled로 500 반환.
2. **Baseline schema 분리** — `profiles`, `vendors`, `vendor_products` 등 핵심 테이블이 migrations에 `CREATE TABLE`로 없음 → 신규 환경 셋업 재현 불가.
3. **코드가 참조하는 누락 테이블 6개** — chat_feedback, chat_summaries, vendor_photo_likes, customer_survey_responses, messages(단일), account_deletions
4. **Realtime/FTS 전제 확인 필요** — `community_posts.search_vector` trigger, Realtime publication 설정 등은 run-time에서만 검증 가능
5. **Direct Supabase client 직접 호출 케이스 산재** — `/community/post/[id]`, `/community/my/*`, `/vendors/favorites` 등에서 `createBrowserClient` 직접 생성. 일관성은 있으나 RLS 의존도 높음.
6. **DiceBear API 외부 종속** — `api.dicebear.com`이 내려가면 모든 기본 아바타 깨짐. fallback 없음.
7. **Next.js 16 + React 19 조합** — framer-motion 일부 hydration 이슈 이력 있음. 실제 사용처에서 이슈 안 남았는지 재확인 필요.
8. **모바일(Bearer token) + 웹(Cookie) 동시 지원**은 `createClientFromRequest`로 통일 — 잘 구현됨.

---

## Phase 6 — 권장 우선순위

### Bucket A — 출시 Blocker (반드시 해결)

| # | 작업 | 예상 시간 |
|---|------|-----------|
| A1 | `chat_feedback` 테이블 migration 작성 | S (30분) |
| A2 | `chat_summaries` 테이블 migration 작성 | S (30분) |
| A3 | `messages` 테이블 또는 `vendor_messages` 재매핑 (업체 상세 메시지 보내기 기능) | M (2-3h) |
| A4 | Baseline schema 정리 — `profiles`, `vendors`, `vendor_products`, `vendor_bookings`, `vendor_images`, `vendor_favorites` CREATE TABLE SQL 재생성 | M (2-3h) |
| A5 | `vendor_photo_likes` 테이블 migration (사진 좋아요 기능용) | S (30분) |
| A6 | `community_posts.search_vector` UPDATE trigger + 기존 데이터 재색인 SQL | M (2-3h) |

### Bucket B — 베타 Blocker (테스트 전 필요)

| # | 작업 | 예상 시간 |
|---|------|-----------|
| B1 | 18개 API try/catch wrapping (invitations/money/scripts) | M (반나절) |
| B2 | `/invitations/templates` 초기 템플릿 시드 SQL | S (30분) |
| B3 | `/api/auth/delete` `account_deletions` 처리 로직 명확화 | S (1h) |
| B4 | `AmoraDirector.hasPreferences` 판단을 실제 preferences 체크로 수정 | S (30분) |
| B5 | `.env.example` 파일 작성 | S (30분) |
| B6 | CLAUDE.md 갱신 (Next.js 16, monorepo 구조, 실제 env 키) | S (1h) |

### Bucket C — 완성도 (출시 후 점진 개선)

| # | 작업 |
|---|------|
| C1 | `useInvitationStore` RSVP/guestbook real-time 구독 |
| C2 | Vendor 포털 온보딩 튜토리얼 |
| C3 | 업체 프로필 완성도 바 |
| C4 | 시드 업체 데이터 100개 (서울/경기 주요 스드메) |
| C5 | `/bookings/[id]` 상세 페이지 완성 |
| C6 | Settings 알림 토글 실제 저장 연결 |
| C7 | DiceBear fallback 아바타 (오프라인 가능한 로컬 generator) |

### Bucket D — Nice to have

| # | 작업 |
|---|------|
| D1 | Editor's Pick 주간 자동 선정 cron (Supabase Scheduled Functions) |
| D2 | AmoraDirector를 `/budget`, `/schedule`, `/dashboard`에도 확장 |
| D3 | `/i/[slug]` 청첩장 공개 뷰어 고도화 |
| D4 | Sentry DSN 실제 연결 (현재 devDependency만) |
| D5 | 페이지별 SEO meta 최적화 |
| D6 | Contract 서명 고객측 UI 진입점 명시 |

---

## 부록 — 확인 필요 사항 (추측 배제)

이 audit은 정적 분석만으로 판단했으므로, 다음 항목은 **실제 Supabase 대시보드 확인 필요**:

- Supabase Realtime Publication에 `community_posts`, `community_comments`, `cohort_messages`, `chat_messages` 등이 추가되어 있는가
- `community_posts.search_vector` tsvector 자동 업데이트 trigger가 프로덕션 DB에 존재하는가
- 테이블 baseline schema (profiles, vendors 등)가 프로덕션에 실제 존재하는가
- Supabase Storage buckets — `community-images`, `community-videos`, `vendor-images`, `invitation-photos` 등 실제 생성되어 있는가
- Auth providers (Kakao, Google, Apple, Email) 모두 활성화되어 있는가
- Custom domain 사용 여부

---

**End of Audit Report**
