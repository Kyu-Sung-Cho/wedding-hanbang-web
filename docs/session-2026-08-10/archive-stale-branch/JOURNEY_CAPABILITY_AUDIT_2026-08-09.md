# 웨딩한방 역량 감사 — 한국 결혼준비 15단계 기준

> **이 문서를 읽는 AI에게**
> 이것은 **2026-08-09 시점 소스 코드 스냅샷**이다. 코드는 계속 바뀌므로 이 문서의 모든 주장은
> "그때 그 브랜치에서 그랬다"는 뜻이지 "지금도 그렇다"는 뜻이 아니다.
> 이 문서를 근거로 코드를 수정하기 전에 **인용된 파일:줄을 반드시 직접 열어 재확인하라.**
> 특히 줄번호는 소폭 어긋날 수 있다(감사 중 4건의 줄번호 오류가 실제로 발견되어 교정했다).

| 항목 | 값 |
|---|---|
| 감사일 | 2026-08-09 |
| 대상 | `C:\Users\kcho1\Desktop\workspace\hanbang\wedding` |
| 브랜치 | `feat/ux-polish-journey-audit` (HEAD `415c9bbd`) |
| 범위 | `apps/web` 소스 + `supabase/migrations`. **apps/mobile 미감사** |
| 방법 | 14개 에이전트 병렬 감사(기초조사 5 + 단계감사 6 + 적대적 반증 3), 도구 호출 836회 |
| 근거 원칙 | `.ts` / `.tsx` / `.sql` 실소스만. 기존 문서(SERVICE_DOC, FEATURES, AUDIT_*, PROJECT_STATUS 등)는 근거로 쓰지 않음 |
| 운영 DB / Vercel 환경변수 | **조회하지 않음** — 해당 부분은 전부 "미확인"으로 표기 |
| 코드 변경 | 없음 (읽기 전용 감사) |

**감사 목표**: 예비부부가 웨딩플래너 없이 웨딩한방만으로 결혼 준비를 처음부터 끝까지 할 수 있는가.
지금 무엇이 되고 무엇이 안 되는지의 정확한 지도.

---

## 0. 먼저 알아야 할 전제 정정

| 흔한 오해 | 사실 | 근거 |
|---|---|---|
| WEDDING_TOOLS는 36개 | **34개** | `apps/web/src/lib/ai/tools.ts` 최상위 `name:` 선언 34건, `toolExecutor.ts:64-130` case 34건 |
| 베타 도구 차단이 걸려 있다 | **차단 0건** | `tools.ts:937` `BETA_DISABLED_TOOL_NAMES = new Set([])` — 빈 Set이라 34개 전부 통과 |
| `(app)/budget`의 URL은 `/budget` | 공개 URL은 **`/wedding/budget`** | `next.config.ts:141-156` rewrites가 `/wedding/{route}/:path*`를 내부 라우트로 되돌림 |
| 계약 관련 테이블이 없다 | **있는데 안 쓴다** | `contracts`, `contract_templates`, `standard_contract_clauses`, `payments`, `settlements` 실재하나 `apps/web` 전체에서 `.from()` 참조 0건 |

---

## 1. 판정 요약

| 판정 | 개수 | 단계 |
|---|---|---|
| ✅ 완전 | 1 | 1 |
| 🟡 반쪽 | 10 | 2, 4, 5, 6, 9, 10, 11, 13, 14, 15 |
| 🔴 껍데기 | 2 | 8, 12 |
| ⚫ 없음 | 1 | 7 |
| 🚫 게이트 | 1 | 3 |

**한 문장 진단**: 준비 절차의 뼈대(예산 19카테고리 · 체크리스트 132항목 · 예절 25파트 46,257자 · 참가격 시세 실데이터)는
이미 서 있고 아모라도 5단계 여정을 전부 인식한다. 막힌 것은 두 가지다 —
**① 업체 공급(제휴)**, **② 완성된 엔진에 화면과 링크를 안 붙인 것**(계약점검·보증인원·잔금정산은 각각 S 규모).
반면 청첩장 · 하객 관리 · 본식 당일은 진짜로 없다.

---

## 2. 15단계 역량 지도

| 단계 | 판정 | 화면 경로 | 진입 링크 | 아모라 도구 | 데이터 상태 | 비고 |
|---|---|---|---|---|---|---|
| 1. 결심 직후 (예산·전체 순서) | ✅ 완전 | `/wedding/budget`, `/wedding/schedule` | 사이드바 상시 2곳 | update_budget, apply_budget_plan, get_budget_summary 등 14 | 실데이터 — 19카테고리 자동배분 + 132항목 체크리스트 | 화면↔아모라 기본비율표 20개 중 8개 불일치 |
| 2. 상견례 | 🟡 반쪽 | 전용 없음 → `/wedding/etiquette` P1·P2·P16 | 사이드바 '예절 가이드' + 체크리스트 모달 | log_wedding_event(`sanggyeonrye`) | 예법 실콘텐츠(P2 1,637자) / 날짜 배선 단절 | 일정화면 등록 시 momentType 미부여 → 챙김 영구 미발화 |
| 3. 예식장 | 🚫 게이트 | `/wedding/vendors`·`/[id]`·`/favorites`·`/bookings` | 사이드바 '업체 탐색' | search_vendors 외 7 (전부 빈값) | **approved 0 → 항상 0건** | 시세·보증인원·계약점검은 별개로 동작 |
| 4. 스드메 | 🟡 반쪽 | `/wedding/community/quote-check` (완전), `/quote/[id]`, `/wedding/vendors` | 커뮤니티 홈 최상단 히어로(무조건 렌더) | analyze_quote, get_market_price, analyze_contract_readiness | 견적점검 실데이터(숨은비용 48항목) / 업체 0 | **견적 점검만 오늘 완전히 쓸 수 있다. 비로그인 가능** |
| 5. 예물·예단·혼수 | 🟡 반쪽 | 전용 없음 → budget / schedule / etiquette P3·P8 | 사이드바 3곳 | 카테고리 enum만 (6개 도구) | 체크리스트 21항목 실데이터 / 시세·견적·계약 0건 | 분담(`payer`) 필드를 아모라가 읽지도 쓰지도 못함 |
| 6. 신혼집 | 🟡 반쪽 | 전용 없음 → `housing` 카테고리 | 사이드바 + 체크리스트→예절 P19 | 카테고리 enum만 | 체크리스트 7항목·예절 P19뿐 / 매물·대출·이사 0건 | 예산 0원(화면) vs 10%(아모라) 충돌 + 프롬프트가 신혼집 제외 지시 |
| 7. 청첩장 | ⚫ 없음 | 없음 | 없음 | 없음 (toggle_checklist_item 간접) | 테이블 8종 DROP됨 | 약관·개인정보방침엔 아직 "제공한다"고 고지 중 |
| 8. 하객 관리 | 🔴 껍데기 | 없음 (시뮬레이터는 채팅 카드로만) | **진입 없음** | simulate_guest_guarantee | 도구는 실계산 / RSVP·좌석 개념 0건 | 반증자는 '반쪽' 주장 — §7 참조 |
| 9. 신혼여행 | 🟡 반쪽 | 전용 없음 → schedule / budget / vendors 탭 | 사이드바 | toggle_checklist_item + 업체계열 | 일정 실동작(자동 모멘트) / 예약 0건 | 코드 완비, `status` 한 줄로 막힘 |
| 10. 본식 세부 | 🟡 반쪽 | 전용 없음 → schedule / budget / market-prices / etiquette | 사이드바 4곳 | toggle_checklist_item, get_market_price, analyze_contract_readiness(snap) | 체크리스트 26항목·옵션시세 실값 / 업체 0 | **주례는 카테고리 자체가 없음** |
| 11. 리허설·최종점검 | 🟡 반쪽 | 전용 없음 → `/wedding/chat` 자동발화 | 진입 없음(그날 채팅을 열어야) | log_wedding_event(`dress_fitting`), simulate_guest_guarantee | final_check 5항목 실재 / **D-31 하루만 발화** | D-6~D-0 체크리스트 항목 0개, 크론 비활성 |
| 12. 본식 당일 | 🔴 껍데기 | 없음 | 없음 | 타임라인/큐시트 도구 0개 | wedding_day 모멘트 3셀 실재 | **ScheduleEvent에 시각 필드 없음**, 담당자 연락처 필드 없음 |
| 13. 식후 정산 | 🟡 반쪽 | `/wedding/money` | 사이드바 1곳(플래그 의존) | 없음 | 축의금 실 CRUD / 답례 0 / 잔금 API 고아 | `/api/bookings/[id]/outcome` 호출부 앱 전체 0건 |
| 14. 혼인신고·행정 | 🟡 반쪽 | `/wedding/etiquette` P17 | 예절 화면 내 '결혼 후' 목록 (딥링크 매핑 없음) | 없음 | P17 본문 실콘텐츠 / **증여공제 소스 전체 0건** | 추적·리마인더·계산 전무. 세액공제는 본문 2줄 |
| 15. 신혼 정착 | 🟡 반쪽 | `/wedding/etiquette` P6·P10·P11·P18 | 예절 화면 내 목록 | log_wedding_event(`first_holiday`) | 모멘트 실동작(D+1·D+8 자동) / 앨범 수령 0건 | 첫 명절 자동산출 불가(음력 달력 상수 없음) |

---

## 3. 단계별 상세

### 1. 결심 직후 — 예산 정하기, 전체 순서 파악 ✅

- **화면**: `/wedding/budget` → `(app)/budget/page.tsx:5-7` → `components/app/budget/BudgetContent.tsx` (1,466줄).
  `/wedding/schedule` → `components/app/schedule/ScheduleContent.tsx` (720줄) + `TimelineView.tsx` (401줄, `buildPhases():59-92`가 4페이즈로 묶음).
- **로그인**: 필수. `(app)/layout.tsx:31-39`가 서버에서 `getUser` 실패 시 `redirect("/login")`.
  추가로 `middleware.ts:85-93`이 `onboarding_complete` 쿠키 없으면 온보딩으로 강제 → **"아무것도 입력하지 않아도"는 성립하지 않는다**(온보딩 5스텝 선행).
- **진입**: `Sidebar.tsx:29`(예산 관리) `:30`(일정 관리) `:31`(시세 정보) `:34`(예절 가이드) — 조건 없이 상시.
  `:37` 필터는 `/money`만 제거. 커뮤니티 푸터 `(community)/layout.tsx:83-84`.
- **데이터 (실측)**:
  - `BudgetContent.tsx:49-71` CATEGORY_RATIOS 20개, 합계 1.00. **단 `housing:63`의 ratio가 0.00이라 실제로 금액이 차는 건 19개.**
  - `constants/checklists.ts:13-343` = 19 카테고리 / **132 항목** (meeting6 venue8 studio8 dress8 makeup8 ring8 hanbok7 yedan6 honeymoon8 houseware7 housing7 invitation7 snap7 shoes6 bouquet6 gift7 mc6 ham6 pyebaek6). 각 카테고리에 tip · ddayStart · ddayDeadline 실재.
  - `constants/hiddenCosts.ts` 676줄, 숨은비용 48항목(studio 14 / dress 11 / makeup 11 / common 7), severity `critical` 8건.
  - `prompts.ts:779-1013` 예산 인터뷰 프로토콜 — 필수 5질문 + Step1~8 결정론 계산(호텔 +10%p, 야외 -8%p, 평일 -10%p, 비수기 -8%p, 하객 규모 보정, 1순위 +25%p, 예비비 8% 강제).
- **결함 2건**:
  1. **기본 비율표가 3벌이고 서로 다르다.** `BudgetContent.tsx:49-71`(화면) vs `planningConstants.ts:29-50`(아모라, `get_budget_summary`가 사용 — `toolExecutor.ts:573-576`) vs `prompts.ts:886-897`(인터뷰 베이스).
     20개 중 8개 불일치 — studio .10/.09, makeup .05/.04, ring .12/.10, yedan .05/.04, honeymoon .12/.10, houseware .07/.06, housing .00/.10, reserve .05/.03.
     총예산 2,000만 기준으로 **같은 커플이 같은 순간에 예물 240만(화면) vs 200만(아모라)** 을 본다. 프롬프트는 venue 38%로 화면 20%와 18%p 차이.
     추가로 `vendorTools.ts:30-45`에 제4의 표(ring 0.10, housing 0.20)가 있다.
  2. `BudgetContent.tsx:1103`이 "한국소비자원 데이터 기반 · 카테고리별 시세 배지 표시 중"이라 쓰지만
     `components/app/budget/` 전체에 marketPrice 관련 import·문자열 0건. 실제로는 `/market-prices`로 나가는 링크(`:1093`) 하나뿐.
- **판정 이견**: 반증 에이전트가 결함 1을 근거로 '반쪽' 강등을 주장했다. 화면·진입·데이터의 존재라는 기준으로는 완전이나, **결함 1은 실재하고 심각하다.**

### 2. 상견례 — 날짜 잡기, 예법, 양가 첫 대화 🟡

- **화면**: 전용 없음. 3곳 분산 —
  예법 `/wedding/etiquette` (`components/app/etiquette/EtiquetteClient.tsx` 1,307줄 + SSR `EtiquetteSeoContent.tsx`),
  날짜 입력 `/wedding/onboarding` Step3 (`components/onboarding/WeddingDetails.tsx:16-17,197-205` `sanggyeonryeDate`),
  체크리스트 `/wedding/schedule` (`checklists.ts:16-30` meeting 6항목).
- **로그인**: 예절만 불필요 — `lib/supabase/middleware.ts:13-15`가 SEO 유입 자산으로 의도적 공개. 나머지는 필수.
- **데이터**: `etiquetteData.ts` P2 상견례 1,637자 / P1 첫인사 2,674자 / P16 양가 호칭 2,504자. 25파트 합계 46,257자.
  `constants/moments.ts:86-114` sanggyeonrye 모멘트 — d3·d1 메시지 + 체크리스트 5항목(예약·상석·금지주제·계산 합의·건배사), 카톡 대본, dAfter 안부.
- **🔴 결정적 구멍 (반증 CONFIRMED)**:
  `components/app/schedule/EventFormModal.tsx:81-86`의 `onSave` 시그니처가 `{date,title,memo,categoryKey}` 4필드뿐이라
  momentType을 전달할 **타입 경로조차 없고**, `lib/amora/momentLoop.ts:127` `if (!event.momentType) continue;`가 그런 이벤트를 버린다.
  → **일정 관리 화면에서 상견례 날짜를 넣으면 캘린더엔 뜨지만 D-3/D-1/D+1 챙김은 절대 발화하지 않는다.**
  momentType이 붙는 경로는 온보딩 라우트 3곳(`api/onboarding/route.ts:96,280,426`)과 채팅 `log_wedding_event`뿐이다.
- **부수**: `onboarding/page.tsx:247-251`이 `coupleAction==="join"`이면 Step2 직후 제출 → 코드로 합류한 파트너에게는 상견례 날짜를 묻지 않는다.
- **작업량**: S~M. 전용 화면 신설 불필요. 필요한 건 배선 3건 — ① EventFormModal의 momentType 전달 ② 설정/일정에 상견례 날짜 수정 진입 ③ join 경로 스텝 분기.

### 3. 예식장 — 후보 비교, 견적, 계약, 보증인원 🚫

- **화면·진입**: 전부 살아 있다. `(app)/vendors/page.tsx:24` 카테고리 탭에 '예식장', `:223` 찜한 업체, `TopNav.tsx:121-123` 돋보기, `UserMenu.tsx:66,68`.
- **🚫 게이트 (핵심)**: `supabase/migrations/20260705090000_hide_seed_vendors.sql:16`
  ```sql
  UPDATE vendors SET status = 'pending' WHERE status = 'approved' AND owner_id IS NULL;
  ```
  같은 파일 주석 13-14행이 적용 결과를 **"pending 176 / rejected 1 / approved 0", "/api/vendors total=0"** 으로 기록.
  `:11` 복원 규칙 — "실업체 온보딩 시작 시 개별 재승인만 허용(일괄 re-approve 금지)".
  노출 경로 6곳이 전부 `.eq("status","approved")` — `vendorTools.ts:72,158,326,489` / `bookingTools.ts:238,586` / `api/vendors/route.ts:44`.
- **살아 있는 것 (제휴 무관)**:
  - `/wedding/market-prices` 예식장 탭 — 대관료·최소 보증인원·1인 식대·식대 총액 + 선택항목 6종. `marketPricesData.generated.ts` (price.go.kr 자동수집, 2026-07-06, 202504~202605 14기간).
  - `simulate_guest_guarantee` — `lib/amora/guestGuarantee.ts` 264줄. DB 접근 0, 노쇼율(기본 8%) 적용 참석 추정 → 빈자리·손실액·3시나리오·업체 문의 문구. **스텁 아님.**
  - `analyze_contract_readiness` — `lib/amora/contractShield.ts` 524줄. 예식장 전용 3조항(`:164` 보증인원·식대 단가 critical, `:174` 홀·대기실·폐백실·주차 범위, `:184` 외부 반입) + 공통 7조항. 등급·점수 같은 보증 표현은 의도적 제거(`:250-254`).
- **없는 것**: 예식장 견적 점검. `hiddenCosts.ts:25`의 category union이 `studio|dress|makeup|common`뿐이고 `analyze_quote` enum에도 venue 없음.
- **시드 라우트**: `api/admin/seed-venues/route.ts`는 창작 예식장 12곳을 `status:'approved'`로 넣는 코드다("더 프리미어 호텔" 등). `lib/utils/adminAuth.ts:16-26` seedGate가 **프로덕션에서 `ALLOW_SEED!=='true'`일 때만** 막는다 → 프리뷰·로컬에서는 admin 세션만 있으면 창작 업체 107건(venues 12 + studios 29 + makeup 24 + vendors 42)이 재삽입 가능하다.

### 4. 스드메 — 업체 비교, 견적 점검, 계약 🟡

- **✅ 견적 점검 = 이 제품에서 유일하게 오늘 완전히 쓸 수 있는 기능**
  - 화면 `/wedding/community/quote-check` (단축 `/check`), 결과 공유 `/quote/[id]`.
  - **비로그인 동작 확인**: `api/amora/quote-check/route.ts:114`가 `getUser` 결과와 무관하게 `analyzeAmoraQuoteCheck` 실행, `:116-169` 저장(`savedId`)만 로그인 시. 레이트리밋 비로그인 12/시간·로그인 40/시간.
  - 진입: `CommunityLandingClient.tsx:425-426` `<QuoteCheckHero />`가 커뮤니티 홈(=`/wedding`, 서비스 최상위 랜딩) 최상단에 **조건 없이** 렌더.
    라운지 `WeeklyCard.tsx:169-174` '조심할 함정' 카드도 상시(`:66-73` HIDDEN_COSTS critical 8건 폴백이라 항상 truthy).
  - 엔진 `lib/amora/quoteCheck.ts:207-256` — 숨은비용 48항목 + 지역별 참가격 중위가 4분법(서울/경기·인천/5대광역시/기타, `:113-128`) + 계약 전 질문 스크립트.
  - **단 '판정'은 하지 않는 설계** (`quoteCheck.ts:13-19`). "이 견적 비싼가요?"에 대한 답은 나오지 않고 중위가 대비 %만 참고 표시된다.
- **🔴 계약 점검 = 껍데기**: `contractShield.ts`의 스드메 6조항(원본 제공 critical, 수정본·납품, 헬퍼비·얼리스타트 critical, 드레스 변경·수선, 메이크업 담당자·시작시간, 사진 사용권)이 실제 분쟁 지점을 정확히 짚는데 **진입 링크가 앱 전체에 0건**이다.
  반증 결과: `ProtectionToolCard.tsx`에 `onSend` prop 자체가 없어(grep 0건) 카드에서 재트리거 불가. 제안 칩·prefill 2곳·AmoraDirector CTA 어디에도 없음.
  견적 결과 화면의 나가는 링크는 `/wedding`, 글쓰기, `/chat?prefill=견적프롬프트` 셋뿐(`quote-check/page.tsx:147-148,170-171,628-629,635-636`).
- **[quote_analysis] 게이트**: `api/chat/route.ts:943-949`가 태그 없으면 `included_items`를 강제로 `[]`로 비운다(의도된 추측 방지).

### 5. 예물·예단·혼수 🟡

- 전용 화면 0. 예산·일정·예절 3곳에 1급 카테고리로 내장.
- **살아 있는 것**: 체크리스트 21항목(`checklists.ts:106-122` ring 8 / `:142-157` yedan 6 / `:176-192` houseware 7 — 첫 항목이 전부 '양가 합의'로 시작),
  예절 P3(예물·예단·함) · P8(혼수 분담, 가전 1,000~1,500만·가구 400~1,000만 품목표),
  양가 분담 UI `BudgetContent.tsx:94-99` PAYER_OPTIONS(커플/신부측/신랑측/양가) + `:159-210` PayerSelector.
- **핵심 결손 3가지**:
  1. **금액 결정의 근거가 0.** `get_market_price`(`quoteMarketTools.ts:31-105` switch에 예물·예단·혼수 분기 없음), `analyze_quote`(`quoteCheck.ts:9` = sdm_package|studio|dress|makeup), `analyze_contract_readiness`(`contractShield.ts:1-8`) 세 축 모두 미지원. `prompts.ts:1219`가 '출처 없는 수치 금지'를 강제하므로 아모라는 사실상 답을 못 한다.
  2. **아모라가 `payer`를 못 읽고 못 쓴다.** `payer`는 `types/database.types.ts:88`에만 있고 `lib/ai/` 전체에 grep 0건. '양가 조율' 단계인데 조율 결과를 저장하는 유일한 필드가 AI 손에 닿지 않는다.
  3. 분담 현황 카드가 `totalSpent > 0`일 때만 렌더되고(`BudgetContent.tsx:1045`) **allocated가 아니라 spent 기준**으로 집계(`:805`) → 합의만 하고 지출이 없으면 화면에 안 뜬다.
- 부수: `extract-decision.ts:29-33` ALLOWED_CATEGORIES에 `ring`은 있으나 yedan·houseware 없음 → 'other'로 뭉개짐.
  `ActionCard.tsx:201` 진행 미니카드 8종에 yedan·housing 없음.
  `conflict-detector.ts:136-154,285-288`이 시어머니·친정 언급을 '회상'으로 판정해 무효화 → "어제 시어머니가 예단 얘기해서 답답해"는 중재 트리거되지 않는다.

### 6. 신혼집 🟡

- 전용 화면 0. 이름표(예산·일정·라운지·온보딩·설정·도구 enum·라이프사이클 phase)는 빠짐없이 붙어 있으나 알맹이는 체크리스트 7줄과 예절 P19 하나.
- **결손**:
  - 매물·대출·이사 코드 0건. **부동산이 vendor 카테고리에조차 없다** (`types/vendor.types.ts:3` = 스튜디오|드레스|메이크업|예식장|한복|예물|신혼여행|기타). 대출 관련 코드는 체크리스트 tip 문자열과 예절 본문이 전부.
  - **예산 값 4곳 충돌**: `BudgetContent.tsx:63` 0.00 / `planningConstants.ts:44` 0.10 / `vendorTools.ts:40` 0.20 / `prompts.ts:848` '기본 제외'. `get_budget_summary`가 두 번째를 쓰므로 **아모라는 "총예산의 10%"라 말하고 화면은 0원을 보여준다.**
  - **프롬프트가 신혼집을 밀어낸다** — `prompts.ts:848` "신혼집(전세금·매매·인테리어)은 기본적으로 제외", `:850` "그 외에는 절대 신혼집 질문 금지", `:903`. 버그가 아니라 의도된 설계지만, 결과적으로 이 단계에서 아모라가 먼저 도와주는 일은 일어나지 않는다.
  - `stage-router.ts:47`이 '신혼' 키워드를 `settlement_companion`(결혼 후 정착)으로 보내 **결혼 전 집 구하기 상담이 결혼 후 전문가에게 간다.**
  - `notifications.ts` 템플릿 15개에 housing 항목 0건(ring D-270, houseware D-180은 있음).
- **작업량**: 예산 정합성 수정 S / 대출·청약 정보 화면 M / **매물 탐색 L** (vendors 스키마 재사용 불가 + 현재 매물은 공공데이터로 안 나옴) / 이사 S~M.

### 7. 청첩장 ⚫

- **테이블 8종 DROP**: `supabase/migrations/20260704131000_drop_dead_invitation_tables.sql:16-23` —
  `invitation_visits`, `invitation_guestbook`, `invitation_rsvp`, `invitation_accounts`, `invitation_photos`, `invitations`, `invitation_templates`, `ai_scripts` 전부 CASCADE.
  삭제 사유(파일 주석 1-15행): Week1 수술로 코드 참조 0건, 외부 FK 0건, 실데이터 invitations 2행·ai_scripts 1행(테스트). `congratulatory_money`는 사용 중(참조 5곳)이라 명시적 유지.
- 화면·API·컴포넌트·전용 도구 전부 0건.
- **부분 커버 (감사 초안이 놓쳤던 것)**: `constants/notifications.ts:31-32` `n_invitation_start`(D-120, "디자인을 선택하고 하객 명단을 정리하세요")가 실재하고 `useNotifications.ts:93-119`가 계산해 TopNav 알림벨에 띄운다.
  그 외 `/wedding/schedule` 청첩장 체크리스트 7항목(`checklists.ts:212-228`, invitation_04 = '하객 명단 정리 및 수량 확정'), 예산 2%, 예절 P4(발송 예절), `moments.ts:223-249` invitation_meeting 모멘트.
- **⚠ 문서 불일치**: `app/terms/page.tsx:70` "모바일 청첩장, 축의금 관리, AI 대본 생성", `app/privacy/page.tsx:45` "청첩장 정보(인사말, 일시, 장소, 계좌번호)" — 청첩장·ai_scripts는 2026-07-04에 DROP됐고 코드도 0건이라 사실과 불일치(축의금 부분만 유효).
- **작업량 L**: 템플릿 스키마+에디터 / 공개 렌더+OG / 명단 CRUD / RSVP 집계 / 발송 채널 / 방문 로그 6개 서브시스템. RLS 난도 높음(과거 `INSERT WITH CHECK(true)` 과permissive가 DROP 사유 중 하나).

### 8. 하객 관리 🔴

- **명단**: 전용 없음. `/wedding/money` 축의금 장부가 하객명·관계·측을 행 단위로 다루지만 **사후 명부**이고 예식 전 명단 관리엔 못 쓴다.
- **참석 확인(RSVP)**: 전무. 유일했던 `invitation_rsvp`가 DROP됨. `simulate_guest_guarantee`의 `confirmed_rsvp_guests`는 **사용자가 손으로 세어 말해야 하는 숫자**이고 이를 채워줄 데이터 소스가 없다.
- **좌석**: 리포지토리 전체에 개념이 존재하지 않는다(`seat`/`좌석` grep 결과가 안내 문구·키워드 배열·본문 텍스트뿐).
- **껍데기 판정 근거**: `simulate_guest_guarantee`는 실계산 도구인데(`riskSupportTools.ts:99-123` + `guestGuarantee.ts` 264줄) **UI 버튼·링크가 0건**이라 아모라에게 말로 물어야만 발동한다.
- **죽어 있는 방명록 테이블 4종**: `guestbooks`, `guestbook_messages`, `guestbook_photos`, `guestbook_message_reactions` — 스키마만 남고 `.from()` 참조 0건.
- **판정 이견**: 반증 에이전트가 '반쪽' 상향을 주장했다(`/money`가 완전 동작하는 실 CRUD 화면이므로). money는 식후 축의금 장부이지 예식 전 하객 관리가 아니라 껍데기로 유지했다.

### 9. 신혼여행 🟡

- **일정 = 실동작**: `checklists.ts:158-175` 8항목(여행지·기간·항공권·숙소·보험·여권비자·투어·환전, D-180~D-30).
  `moments.ts:302-325` `honeymoon_departure`는 **예식일+1로 자동 산출**되어 사용자 입력 없이 D-1 체크리스트 5항목(여권 6개월·바우처·환전·보험·상비약)과 귀국일 질문을 띄운다.
  `:327-350` `family_visit_after`(예식+8일) 귀국 후 양가 인사.
- **예약 = 0**: 탭·API alias(`api/vendors/route.ts:16` '신혼여행'→['신혼여행','honeymoon','travel'])·데모 업체 2건('더 허니문','메리스 트래블')까지 전부 준비된 상태에서 `status` 한 줄로 막혀 있다.
  **공급만 확보되면 코드 변경 없이 살아나는 구조.**
- `search_nearby_places`는 네이버 **지역검색**이라 국내 전용이고 `tools.ts:882-884`가 상견례 식당 등 국내 장소용으로 한정 → 해외 허니문에는 못 쓴다.
- 주의: 예절 P6은 '신혼여행 **후 인사**'이지 여행 가이드가 아니다(`prompts.ts:1341`이 명시). 여행 준비 콘텐츠는 체크리스트 8항목이 전부.

### 10. 본식 세부 🟡

| 항목 | 상태 |
|---|---|
| 스냅 | 있음 — 체크리스트 7항목 · 예산 4% · 시세 '본식 촬영' 77만 · contractShield `snap` 카테고리 |
| 영상 | snap에 통합('본식 스냅/영상', snap_03 '영상 촬영팀 비교') |
| 부케 | 있음 — 6항목 · 예산 1% · 시세 25만 |
| 답례품 | 있음 — 7항목 · 예산 2% · D-90 알림 `n_gift_start`. **단 시세 데이터 없음** |
| 축가 | mc에 통합(mc_03) · 시세 25만 · 예절 P14 |
| 사회자 | mc 카테고리(mc_01·02) · 시세 30만 |
| **주례** | **전용 카테고리·체크리스트 항목 0건.** 소스 전체 4곳(예절 본문 2 · 시세 항목명 '주례비' · stage-router 키워드)뿐이고 `get_market_price`의 venue displayMessage에서도 빠져 있다 |

- 시세 실값: `marketPricesData.generated.ts` GEN_VENUE_OPT_NATIONAL '202605' 17개 값 전부 채워짐.
- **업체탐색 탭 8종에 snap/bouquet/gift/mc 없음** (`vendors/page.tsx:24`). vendors.category CHECK엔 'snap','dvd'가 있으나 도달 경로 0.
- 사회자 대본 저장소 `ai_scripts`(script_type에 `mc_script`·`vow`·`parents_letter` 포함)는 DROP됨 → 아모라가 대본을 만들어줘도 저장할 곳이 없다.

### 11. 리허설·최종점검 (D-30~D-1) 🟡

- **리허설 전용 카테고리 없음.** 관련 실재 항목은 makeup_04·05(리허설 메이크업), mc_06(리허설 일정 조율), dress_08(최종 피팅), `notifications.ts:39` `n_makeup_rehearsal`(D-60).
  `moments.ts:197-221` `dress_fitting`은 d3/d1/dAfter 3셀 완비이나 `trigger:"event"`라 **사용자가 날짜를 넣어야만 작동**한다.
- **최종점검**: `moments.ts:251-270` `final_check` 5항목(보증인원 확정 데드라인 / 사회자에게 식순 전달 / 잔금 일정표 / 축의대 담당 양가 1명씩 / 사례비 봉투 목록).
- **🔴 전달 3중 실패 (반증 CONFIRMED)**:
  1. `final_check`는 **d1 셀만 존재**하고 `momentDate = 예식일-30`, `dueCellForDate`가 `days===1`일 때만 발화 → **실제 발화일은 D-31 하루뿐**(`momentLoop.ts:80-86,99-111,136-144`).
  2. `/api/chat/proactive` 호출 지점이 `ChatContent.tsx:496`(채팅 진입 시 1회) **단 하나**. 나머지 하나(`dashboard/page.tsx:246`)는 도달 불가 페이지.
  3. `apps/web/vercel.json`의 `"crons": []` (직접 확인) → `api/cron/care-moments`가 자동 실행되지 않는다. 수동 호출도 `CRON_SECRET` 없으면 401 fail-closed.
- **체크리스트 커버리지 공백**: 132항목 중 ddayDeadline이 D-30 이내인 것은 9개이고 **가장 늦은 마감이 D-7. D-6~D-day 구간 항목은 0개.**
- **알림도 역효과**: `useNotifications.ts:101-119` 필터가 누적형이라 D-30 시점에 D-360짜리까지 15개가 동시에 떠 '최종점검' 신호가 파묻힌다. `dday<=0`이면 전부 반환 안 함.

### 12. 본식 당일 🔴

- 전용 화면 0. `(app)/dashboard/page.tsx`가 가장 근접하나 **도달 불가** — `proxy.ts:12-22`와 `next.config.ts:69-73,99-103`이 `/dashboard`·`/wedding/dashboard`를 무조건 `/wedding/lounge`로 리다이렉트. `weddingAppRoutes(:22-35)`에도 dashboard 없음.
- **살아 있는 것**: `moments.ts:272-300` `wedding_day` 3셀(d3 축의대·사례비·정산기준 / d1 체크리스트 4 + 사회자 카톡 대본 / dAfter 축의금 장부 사진),
  예절 P5(신랑 3시간 전·신부 4~5시간 전·혼주 2시간 전 도착 + 식 전/중/후 3단 체크리스트) · P21,
  `stage-router.ts:32,55,127-132` `ceremony_coordinator`.
- **없는 것 (전부 grep 0건)**:
  - **시간대별 진행표** — 큐시트/cue_sheet/runsheet/진행표 0건. 결정적으로 `ScheduleEvent` 타입(`database.types.ts:91-102`)에 **시각 필드가 없다** → 시간대별 항목을 일정으로 저장하는 것 자체가 불가능.
  - **담당자 연락처 필드** — `ProgressItem`은 `vendor?`·`notes?`뿐, `vendor_staff` 테이블에도 phone 컬럼 없음.
    아이러니하게 `prompts.ts:614`가 '담당자 연락처 없음'을 당일 리스크로 지적하게 시켜놓고 그 연락처를 받아 적을 필드를 제공하지 않는다.
- 실제로 동작하는 유일한 당일 자산은 `moments.ts:290-291`의 사회자 카톡 대본 1줄과 `/wedding/money` 축의금 장부다.

### 13. 식후 정산 🟡

- **축의금 = 실동작**: `/wedding/money` (403줄) — 하객별 이름·금액·측·관계·수단·메모·수령일 CRUD + 검색·필터 + 총액/인원/평균/측별 통계 + CSV 내보내기.
  API `api/money/route.ts:39-49,111-124` + `[id]/route.ts:126,168`, 소유권 검증 `:29-37`, 금액 0~1억 정수 검증.
  진입은 **`Sidebar.tsx:35` 단 1곳**이고 `LAUNCH_MODE==='coming_soon'`이면 `:23-24,37`이 제거한다.
- **답례 = 없음**: 프롬프트 문구뿐(`stage-router.ts:134-141` settlement_companion 애드온).
- **🔴 업체 잔금 = 고아 API**: `api/bookings/[id]/outcome/route.ts` 277줄이 실지출·계약가 기록 + `status='completed'` + vendor_reviews upsert + 예산 동기화 + decision_nodes 기록(`:215-255` 추가금 계산)까지 전부 구현돼 있는데
  **앱 전체에서 호출부가 0건**이다(grep `/outcome` = 자기 테스트 파일 2줄뿐). 예약 화면은 상태 배지만 표시한다.
  → **예비부부가 실제로 낸 잔금은 앱에 남을 방법이 없다.**
- **⚠ 링크가 아닌 href 주의**: `lifecycle.ts:359-367` `aftercare_money`가 `href=weddingPath('/money')`를 만들지만 링크가 되지 않는다.
  `plan.guardrails`의 유일한 소비처가 `api/chat/proactive/route.ts:163`이고 거기서 `item.cta` 문자열만 뽑아 채팅 제안 버튼으로 쓴다(클릭 시 메시지 전송).
  href가 실제 링크가 되는 것은 `plan.primaryAction`(=`orderedGuardrails[0]`) 하나뿐이고, severity 정렬(critical→warning→steady→celebrate)상 `steady`인 aftercare_money는 같은 분기의 `warning` aftercare_thanks를 앞설 수 없다.
  **같은 이유로 `lifecycle.ts:404-431`의 `quickActions` 배열은 소비처 0건인 죽은 코드다.**

### 14. 혼인신고·행정 🟡

- 유일한 커버는 예절 P17 (`etiquetteData.ts:158-166`) — 준비물 체크리스트(혼인신고서·신분증·증인 2명), 절차, 시기, 주의사항, '세액공제 확인(2024년 이후 혼인신고 시 부부 합산 최대 100만원)'.
- **딥링크 사각지대**: `CATEGORY_ETIQUETTE_MAP`(`etiquetteData.ts:250-269`) 19개 키의 값 집합은 `{1,2,3,4,5,6,7,8,12,14,15,19,22}`로 **17이 없다.**
  → `?part=N` 딥링크를 만드는 세 경로(`ChatBubble.tsx:514`, `CategoryChecklistModal.tsx:231`, `WeeklyCard.tsx:154`)가 혼인신고를 절대 가리키지 않는다. 가이드를 직접 뒤져야만 도달.
- **기능 공백 4가지**: ① 혼인신고 '했다/안 했다' 추적 수단 0 (준비 카테고리 19개가 전부 본식 이전) ② 일정으로 잡을 수 없음(`log_wedding_event` moment_type 8종·`add_schedule_event` 카테고리 enum 어디에도 없음) ③ 알림 0(`notifications.ts`에 ddayTrigger 음수 항목 0건) ④ **증여공제는 `apps/web/src`·`apps/mobile/src` 전역 grep 0건**.
- **작업량 S~M**: 콘텐츠는 이미 있음. `checklists.ts`에 post-wedding 카테고리 1개 + MOMENTS에 `marriage_registration` 타입 추가면 발화 파이프는 그대로 동작.

### 15. 신혼 정착 🟡

- 예절 '결혼 후' 카테고리 5파트(`etiquetteData.ts:244` parts:[6,10,11,17,18,24]) — P10 첫 명절, P11 집들이, P16 양가 호칭, P18 경조사.
  **단 P10·16·18이 `CATEGORY_ETIQUETTE_MAP`에 없어 정황 딥링크로 도달하지 않는다.**
- **실동작 모멘트**: `moments.ts:350-374` `first_holiday`(d1 체크리스트 4 — 방문 순서·양가 동일 선물·용돈 봉투·세배), `:327-348` `family_visit_after`(예식+8일 자동).
  **단 `first_holiday`는 `trigger:"event"`라 사용자가 채팅에서 명절 날짜를 직접 말해야 발화한다 — 음력 설·추석 달력 상수가 없어 자동 산출 불가.**
- **앨범 수령 = 0**: '앨범'은 `lifecycle.ts:119,353`, `stage-router.ts:137`, `prompts.ts:599`의 안내 문장과 스튜디오 추가금 경고에만 존재. 수령 일정·상태를 담는 moment/카테고리/컬럼 0.
- **사후 단계 인식은 두 계층에 모두 있다**:
  - `stage-router.ts:29-33` StageTag 5단계 — `planning_0`(D-180 초과) → `preparation_1`(D-180~D-31) → `execution_2`(D-30~D-1) → `ceremony_3`(당일) → `settlement_4`(다음날부터, 상한 없음)
  - `lifecycle.ts:6-13,138-146` 7단계 — setup / foundation / core_contracts / detail_planning / final_countdown / wedding_day / aftercare
  - 그러나 그 인식이 도달하는 곳은 **전부 대화·문구 레이어**다(프롬프트 애드온 / 라운지 stageLabel / 가드레일 2장 / 모멘트 발화). 신혼 정착을 관리하는 화면·체크리스트·테이블은 하나도 없다.

---

## 4. 🔴 껍데기 목록 — 도구·테이블은 있는데 화면이 없는 것

| 항목 | 이미 있는 것 | 없는 것 | 작업량 |
|---|---|---|---|
| **계약 점검** `analyze_contract_readiness` | 규칙엔진 `lib/amora/contractShield.ts` 524줄(예식장 3 · 스드메 6 · 공통 7 조항), 결과카드 `ProtectionToolCard.tsx` ContractReadinessCard | 입력 폼 화면, 진입 링크 | **S** — quote-check 화면 패턴 복제 + 라우트 + 사이드바 링크 |
| **보증인원 시뮬레이터** `simulate_guest_guarantee` | 계산엔진 `lib/amora/guestGuarantee.ts` 264줄, GuestGuaranteeCard | 입력 폼 화면, 진입 링크 | **S** |
| **업체 잔금 정산** | `api/bookings/[id]/outcome/route.ts` 277줄 완성 | 호출 UI 0건 | **S** — 예약 상세에 완료처리 모달 5필드. 단 approved 0이라 실사용은 공급 종속 |
| **본식 당일 타임라인** | wedding_day 모멘트 3셀, 예절 P5·P21 | 시각 필드(`ScheduleEvent`), 진행표 테이블, 큐시트 개념 전부 | **M~L** — 타임라인 M · 담당자 연락처 S · 통합 당일 모드 L (D-6~D-0 체크리스트 신규 작성 포함) |
| **하객 명단·RSVP** | `confirmed_rsvp_guests` 입력구, `congratulatory_money`의 커플-스코프 하객 행 패턴 | 테이블·화면·수집 표면 | **M** — RSVP는 anon INSERT RLS 재설계 필요 |
| **좌석 배치** | 없음 | 전부 | **M~L** — 참조 구현이 리포에 없음 |
| **온라인 방명록** | 테이블 4종 생존 | `.from()` 참조 0건, 화면 0건 | 사문화 스키마 |
| **계약·결제 스키마** | `contracts` · `contract_templates` · `standard_contract_clauses` · `payments` · `settlements` | `.from()` 참조 0건 | 사문화 스키마 |

---

## 5. 🟡 반쪽 목록 — 무엇이 빠져서 반쪽인가

| 단계 | 빠진 것 | 구체 근거 |
|---|---|---|
| 2. 상견례 | **배선** | `EventFormModal.tsx:81-86` ↔ `momentLoop.ts:127` 단절. 온보딩 join 경로 Step3~5 스킵(`onboarding/page.tsx:247-251`) |
| 4. 스드메 | **데이터**(업체) + **진입**(계약점검) | approved 0 / 계약 점검 링크 0건, 견적 결과 → 계약 점검 CTA 없음 |
| 5. 예물·예단·혼수 | **데이터** | 시세·견적·계약 3축 모두 카테고리 미지원. `payer`가 `lib/ai/`에 grep 0건 |
| 6. 신혼집 | **데이터 + 설계 의도** | 매물·대출·이사 0건, 부동산이 vendor 카테고리에 없음. `prompts.ts:848-850`이 제외 지시 |
| 9. 신혼여행 | **데이터**(예약만) | `status` 한 줄. 코드 변경 없이 복구 가능 |
| 10. 본식 세부 | **데이터**(업체) | 업체탐색 탭 8종에 snap/bouquet/gift/mc 없음 + approved 0 |
| 11. 리허설·최종점검 | **전달** | final_check d1 셀만 → D-31 하루. proactive 호출 1곳. `vercel.json` crons=[] |
| 13. 식후 정산 | **진입 + 플래그** | `/money` 링크 1곳이고 `LAUNCH_MODE=coming_soon`이면 소실. 잔금 API 호출부 0건 |
| 14. 혼인신고 | **기능** | 읽을거리만 완전. 추적·일정등록·알림 0. `CATEGORY_ETIQUETTE_MAP`에 P17 없음 |
| 15. 신혼 정착 | **화면 + 데이터** | 앨범 수령 0. `first_holiday` 자동 산출 불가 |

---

## 6. ⚫ 없음 목록 — 업체 제휴 필요 여부

### 제휴 없이 지금 만들 수 있는 것
- **모바일 청첩장 · 하객 명단 · RSVP** — 전부 자체 렌더·자체 DB. 종이 인쇄·배송만 제휴 필요이고, `vendors.category` CHECK에 `invitation` 값이 이미 열려 있다(`20260513999000_extend_vendors_category_enum.sql:25`)
- **좌석 배치** — 순수 커플 데이터
- **본식 당일 타임라인 · 담당자 연락처** — 원자재(예식일, wedding_day 문안, 예절 P5·P21, 축의금 장부)가 전부 리포 안에 있음
- **혼인신고 추적 · 세액공제 리마인더** — 콘텐츠는 `etiquetteData.ts:158-166`에 이미 있음. 증여공제만 세무 문구 검토 필요
- **앨범 수령 추적** — MOMENTS에 타입 1개 추가 시 예식일 상대 오프셋으로 자동 발화(엔진 수정 불필요)
- **주례** — 카테고리·체크리스트 항목 추가만
- **이사 체크리스트 확장** — 일정 템플릿 재사용
- **대출·청약 정보** — 주택도시기금·LH는 공공데이터, `scripts/update-market-prices.mjs` 패턴 복제 가능. 다만 금리 변동·금융조언 리스크로 출처·시점 표기 설계가 작업의 절반

### 공급 / 제휴가 반드시 필요한 것
- **예식장 · 스드메 · 신혼여행 · 예물 업체 탐색과 예약** — `hide_seed_vendors.sql:11` 복원 규칙이 "실업체 온보딩 시작 시 개별 재승인만 허용". 코드가 아니라 공급 문제
- **매물 탐색 (L)** — 국토부 공공데이터는 '과거 거래'만 나오고 '현재 매물'은 안 나온다. 별도 공급원 필수. vendors 스키마도 재사용 불가(면적·층·보증금/월세·좌표)
- **예물 · 예단 · 혼수 시세** — 참가격(price.go.kr)에 없어 기존 수집 파이프라인을 못 쓴다. 제휴는 아니지만 별도 출처 확보가 작업의 대부분

---

## 7. 진입 링크가 없는 화면 전체 (18건)

### A. 진짜 고아 — 완성된 기능인데 앱 안에서 못 들어감
| 경로 | 파일 | 상태 |
|---|---|---|
| `/customersurvey` | `app/customersurvey/**` (+ hooks/ components/ 서브트리) | `customersurvey` 문자열 전역 0건. Turnstile까지 붙은 완성된 설문 앱. 백엔드 생존 — `api/survey/route.ts:142`가 `customer_survey_responses`에 실제 INSERT |
| `/wedding-code` | `app/wedding-code/page.tsx` | 인바운드가 자기 결과화면(`ResultClient.tsx:414,430,599,818,837`)뿐. `robots.ts:26` disallow. **최초 진입로가 앱에 없다** — 이미 진단한 사람이 `?ct=` 초대 링크를 공유해야만 두 번째 사람이 들어옴 |
| `/wedding-code/result` | `.../result/page.tsx` | 인바운드 1건(`WeddingCodeClient.tsx:226` router.replace). 부모가 고아라 연쇄 고아. noindex |
| `/wedding/community/about` | `(community)/community/about/page.tsx` | `community/about` 문자열 0건. 신규 방문자용 소개인데 커뮤니티 홈·네비·푸터 어디에도 없음. 나가는 링크만 있음 |
| `/wedding/community/vendor/[name]` | `.../vendor/[name]/page.tsx` | `community/vendor/` 문자열 0건. 글 상세의 업체 태그는 `/wedding/vendors/{id}`로 감(`post/[id]:765`) |
| `/landing` | `app/landing/page.tsx` | `/landing` 문자열 1건, 자기 로고 링크(`:134`)뿐. sitemap에도 없음 |
| `/about`, `/beta`, `/demo`, `/demo/login` | 각 page.tsx | 링크가 전부 `/landing` 클러스터 내부에서만. 클러스터 루트가 고아라 연쇄. `/demo`는 `robots.ts:25` 크롤 차단 |
| `/wedding/community/quick-review` | `.../quick-review/page.tsx` | 링크 2건 중 `MyToolsWidget.tsx:16`은 **import 0건 죽은 컴포넌트**, 나머지 `EmptyFeedStarter.tsx:21`은 `posts.length===0 && !isSearching`일 때만 렌더 → 정상 운영 시 도달 불가 |
| `/quote/[id]` | `app/quote/[id]/page.tsx` | 공유용이라 제3자는 도달. **만든 본인이 자기 결과를 다시 찾아가는 앱 내 경로가 없다**(내 견적 목록 화면 부재) |

### B. 리다이렉트로 소진되는 사문화 파일 (6건)
`/wedding/dashboard`(`proxy.ts:12-22` — 그런데 파일엔 카테고리 UI·proactive 호출이 살아 있어 검색에 잡힌다),
`community/budget`·`community/chat`·`community/schedule`(`next.config.ts:118-133` redirect가 항상 선행),
`/wedding/wedding/**`(`proxy.ts:7-11`), `/customer`(이중 리다이렉트 스텁), `/`(루트, config와 파일에 규칙 이중 정의), `/wedding/community/[category]`

### C. 외부 진입 전용 — 설계 의도로 판단 (4건)
`/reset-password`(Supabase 메일 링크), `/auth/mobile-callback`(OAuth 콜백), `/admin`·`/admin/login`(운영자, `robots.ts:11` disallow)

---

## 8. 데이터가 빈 채로 살아 있는 도구 전체 (34개 중 14개)

### 항상 빈값 — vendors approved=0 봉인 (8개)
`search_vendors` · `recommend_vendors` · `get_vendor_detail` · `check_vendor_availability` · `get_available_slots` · `create_booking` · `get_my_bookings` · `cancel_booking`

입력이 무엇이든 같은 응답이다. 슬롯 병합·잔여석 차감·예산 추정 로직이 완성돼 있으나 진입부의 `.eq("status","approved")`에서 먼저 끝난다.
- `search_vendors` — `vendorTools.ts:70-72,135-142`. 빈 배열도 `success:true` + 고정 문구 "조건에 맞는 업체가 없습니다."
- `check_vendor_availability` — `:153-168`에서 종료, 계산부 `:186-281`은 도달 불가
- `cancel_booking` — `bookingTools.ts:847-865`. booking_id가 UUID 형식이 아니면 `success:true` + **빈 문자열 displayMessage**로 조용히 끝나 모델에게 아무 신호도 주지 않는다

### 조건부 빈값 (4개)
- `search_nearby_places` — `placeSearchTools.ts:69-80`. NAVER 키 미설정이면 fetch 전 `success:false`. **운영 키 설정 여부 미확인**
- `analyze_quote` (1단계) — `api/chat/route.ts:943-949`가 `[quote_analysis]` 태그 없으면 `included_items`를 강제로 `[]`로 비움(의도된 추측 방지 설계)
- `get_amora_actions` — `amoraActionTools.ts:169-190`. 시드 없음. 테이블 미배포 시 `:64-81`이 조용히 legacy JSONB 폴백으로 넘어가 실패가 드러나지 않음
- `get_schedule_events` — `scheduleTools.ts:285-315`. `progress.__events`만 읽는데 일정화면 등록분은 momentType이 안 붙음

### 상수만 반환 (2개)
- `get_budget_summary` — `toolExecutor.ts:566-612`. 미설정 시 19항목 전부 하드코딩 비율 곱셈(`allocated_is_estimate:true`로 표시는 함). **그 상수가 화면과 다름**
- `get_schedule_summary` — `scheduleTools.ts:14-40`. progress가 비면 CATEGORY_LABELS 19개를 전부 `not_started`로 나열. 예식일·D-day·마감 임박이 판단에 안 들어감

### 조용한 실패 폴백 (도구 아님, 분기)
`get_market_price`의 venue/dress/makeup 분기 — 해당 기간·scope 행을 못 찾으면 `success:true` + 빈 `toolOutput` + "시세 정보를 조회했습니다."를 반환한다(`quoteMarketTools.ts:40-48,64-84,104-114`).
**조회 실패가 성공으로 위장된다.** 시세 최신 기간은 `202605`로 감사일 기준 약 3개월 지연.

---

## 9. 부수 발견

1. **`POST /api/bookings`에 approved 게이트가 없다** — 파일 전체에 vendors status 검사가 없고 RPC `create_booking_atomic`(`20260605000000_harden_booking_rpc.sql`)에도 조건이 없다.
   "모든 노출 경로가 approved 필터"라는 대전제의 예외다. 목록 API가 막혀 있어 vendor UUID 노출 경로는 없지만 이 엔드포인트만 열려 있다.
2. **`data/raw/`의 공시 원본이 앱에 배선되지 않았다** — 총 253개 파일(xlsx 219개), `data/raw/예식장/` 14개 지역 디렉터리 + `data/raw/결혼준비대행서비스/`.
   `git ls-files data/` = 0건, `.git/info/exclude:11`에 등록, `apps/`·`scripts/` 어디에도 `data/raw` 참조 없음.
3. **약관·개인정보처리방침이 없는 기능을 고지 중** — `terms/page.tsx:70`, `privacy/page.tsx:45`. §3-7 참조.
4. **죽은 코드 3건** — `components/community/MyToolsWidget.tsx`·`RightSidebar.tsx`(import 0건), `lib/amora/lifecycle.ts:404-431 quickActions`(소비처 0건).
5. **중복 화면** — `/wedding/favorites`와 `/wedding/vendors/favorites`가 둘 다 `vendor_favorites`를 읽는 사실상 같은 화면.

---

## 10. 미확인 — 이 감사가 확인하지 못한 것

| 항목 | 왜 미확인인가 | 영향 |
|---|---|---|
| **운영 DB의 `vendors.status` 실제 분포** | 읽기 전용 소스 감사라 원격 DB 미조회 | `approved 0`은 `hide_seed_vendors.sql:13-17` 주석에 기록된 **2026-07-05 적용 시점 값**이다. 이후 관리자 API(`api/admin/vendors/[id]/route.ts`)로 개별 재승인이 있었는지 알 수 없다. 이 문서에서 "항상 0건"이라 쓴 서술은 전부 소스 기준 추정이다 |
| `NEXT_PUBLIC_LAUNCH_MODE` 운영값 | `.env.example:40` 빈 값, `.env.local` 미선언 | 비로그인 예절 잠금(FREE_PART_LIMIT=2)과 `/money` 사이드바 메뉴 노출 여부가 갈린다 |
| `CRON_SECRET` · `RESEND_API_KEY` | 리포에 없음 | `vercel.json` crons=[]는 확인했으나 **Vercel 대시보드 수동 등록 크론은 볼 수 없다.** 케어 이메일 실제 발송 여부는 소스 기준 추정 |
| `NAVER_CLIENT_ID` / `SECRET` | `.env.example:57-58` 빈 템플릿 | `search_nearby_places` 프로덕션 동작 여부 |
| `congratulatory_money` RLS 정책 본문 | `20260302000000` 파일의 RLS 블록 미독 | API가 사용자 세션 클라이언트를 쓰므로 RLS가 실제 접근을 좌우한다. '실 CRUD' 판정의 전제가 미검증 |
| `apply_journey_progress_patch` RPC 프로덕션 배포 여부 | DB 미조회 | 미배포여도 `progressTools.ts:29-40` 폴백으로 동작하므로 판정에는 영향 없음 |
| `apps/mobile` 전체 | 웹 소스로 범위 한정 | 모바일 25개 라우트의 화면 내부 로직 미확인 |
| 운영 데이터 실적 | DB 미조회 | `wedding_journeys.progress` 사용 실적, `congratulatory_money` 행 수, `chat_messages`의 모멘트 발화 이력 |

---

## 부록 A. 참조 파일 지도 (재확인용)

| 영역 | 핵심 파일 |
|---|---|
| 아모라 도구 선언 | `apps/web/src/lib/ai/tools.ts` (34개) |
| 도구 실행 | `apps/web/src/lib/ai/toolExecutor.ts` + `lib/ai/tools/{vendorTools,bookingTools,scheduleTools,quoteMarketTools,riskSupportTools,amoraActionTools,progressTools,placeSearchTools,planningConstants}.ts` |
| 프롬프트 | `apps/web/src/lib/ai/prompts.ts`, `stage-router.ts`, `amora-profile.ts`, `mediation.ts`, `conflict-detector.ts` |
| 여정 상태 | `apps/web/src/types/moat.types.ts` (StageTag 5), `lib/amora/lifecycle.ts` (7단계), `lib/amora/momentLoop.ts` |
| 콘텐츠 상수 | `constants/{checklists,etiquetteData,moments,notifications,hiddenCosts,marketPrices,marketPricesData.generated,planningConstants,communityCategories}.ts` |
| 계산 엔진 | `lib/amora/{quoteCheck,contractShield,guestGuarantee}.ts` |
| 라우팅·가드 | `apps/web/next.config.ts`, `src/proxy.ts`, `src/middleware.ts`, `src/lib/supabase/middleware.ts`, `(app)/layout.tsx` |
| 네비게이션 | `components/app/Sidebar.tsx`, `TopNav.tsx`, `components/community/{CommunityNav,CategoryTabs,UserMenu}.tsx`, `(community)/layout.tsx` |
| 봉인 마이그레이션 | `supabase/migrations/20260705090000_hide_seed_vendors.sql`, `20260704131000_drop_dead_invitation_tables.sql` |

## 부록 B. 감사 방법 재현

```
Phase 1 Foundation (병렬 5) — 라우트+인증 / 진입링크 그래프 / 34개 도구 데이터추적 / DB 테이블 / 게이트·플래그
Phase 2 StageAudit (병렬 6) — 15단계를 6클러스터로 분할, 기초조사 결과를 힌트로 주되 실소스 재확인 강제
Phase 3 Verify  (병렬 3) — 진입링크 주장 반증 / 데이터·판정 낙관 반증 / 완결성 비평(고아화면·빈도구·매핑누락)
```
반증 단계에서 REFUTED 3건 · PARTIAL 7건이 나와 본문에 반영했다(1단계 비율표 불일치, 2단계 비로그인 예절 진입, 8단계 판정, 3단계 시드 복원 경로, 7단계 D-120 알림 등).
