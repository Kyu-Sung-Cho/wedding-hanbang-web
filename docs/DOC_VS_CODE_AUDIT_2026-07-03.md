# 문서 vs 실제 코드 대조 감사 (2026-07-03)

> **폐기된 역사 문서 — 현재 구현·로드맵·마케팅·세일즈 근거로 사용 금지.** 아래 기능 개수와 EXISTS/PARTIAL 판정은 2026-07-03 작업트리 스냅샷이며 현재 코드·출시 상태가 아니다. 현재 제공 범위는 [`WEDDINGHANBANG_SERVICE_DOC.md`](../WEDDINGHANBANG_SERVICE_DOC.md), 현재 상태는 [`PROJECT_STATUS.md`](../PROJECT_STATUS.md), 제품 판단 원칙은 [`CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md`](./CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md)만 따른다.

> **역사 문서**: AI 공급자 관련 판정은 2026-07-03 당시 기준입니다. 2026-07-10부터 아모라 런타임은 OpenAI GPT-5.6 Terra/Luna로 전환되었습니다.

> 평가 계획 0.2 산출물. 방법: FEATURES.md(3/1) + PROJECT_STATUS.md(4/22)의 기능 주장 119건을 추출해
> 실제 코드(페이지 51 / API 82 / 모바일 화면 41)에 하나씩 대조 검증 (에이전트 19개, 정적 분석).

## 결론 요약

| 판정 | 건수 | 비율 |
|------|------|------|
| EXISTS (실구현 확인) | 47 | 39% |
| PARTIAL (일부만 일치) | 43 | 36% |
| GONE_INTENTIONAL (6/11 수술로 삭제, 문서 미갱신) | 25 | 21% |
| GHOST (문서에만 존재) | 2 | 2% |
| UNCLEAR (판정 불가) | 2 | 2% |

**한줄평 (보수적)**: 코드는 문서 주장 대비 대체로 실재·실구현이지만(핵심 기능 거의 EXISTS),
"전체 기능 문서" 2개(FEATURES.md, PROJECT_STATUS.md)는 6/11 대수술 이전 스냅샷이라
**5건 중 1건은 이미 삭제된 기능을 현재형으로 설명하는 오도 문서** 상태. 경고 배너조차 없음.

## 1. 문서에만 있는 것 (GHOST — 둘 다 "예정" 표기라 거짓말은 아님)

- Custom Domain auth.hanbang.ai — 코드/설정 흔적 0
- 웹 푸시 알림 — 코드 흔적 0 (모바일 Expo 푸시는 별개로 존재)

## 2. 삭제됐는데 문서가 여전히 설명 중 (GONE_INTENTIONAL 25건)

청첩장 전체(/invitations, /i/[slug], API 6종), AI 대본(/scripts), 벤더 B2B 포털 전체(페이지+API 9종+vendorStore),
B2B 랜딩 4종, AI 드레스 피팅(/fitting), 토스페이먼츠 결제, 전자계약/서명, 정산 시스템, B2B 설문.
→ 전부 2026-06-11 수술로 의도적 삭제(`pre-surgery` 태그 복구 가능). 문서만 안 따라옴.

## 3. 주요 문서 드리프트 (PARTIAL 43건 중 실질적인 것)

**API 시그니처 불일치** (문서가 주장하는 메서드가 없음):
- `/api/journey` — 문서 GET/PUT, 실제 PATCH만
- `/api/events` — 문서 GET/POST, 실제 POST만 (조회는 journey progress `__events` 경유)
- `/api/profile` — 문서 GET/PUT, 실제 PATCH만
- `/api/admin/admins` — 문서 GET/POST, 실제 GET만
- `/api/schedules` — 라우트 자체가 없음

**스펙 수치/이름 불일치**:
- Claude 모델: 문서 "3.5 Sonnet" → 실제 `claude-sonnet-4-6` (lib/ai/claude.ts:115)
- 폰트: 문서 Noto Serif/Sans KR + Cormorant → 실제 전부 Paperlogy 알리아스 (globals.css:76-80), Noto 로딩 코드 없음
- 대시보드 카테고리: 문서 19개 → 실제 8개
- Avatar 3단 폴백: 문서 DiceBear → 실제 로컬 SVG 생성으로 교체 (next.config.ts에 dicebear 허용목록 잔재)
- 멀티 채팅방 5개: 근거 미확인 (스토어는 단일 스레드 구조)
- PROJECT_STATUS.md 내부 모순: 710행 "모바일 반응형 재검증 [ ]" vs 741행 "모바일 반응형 전체 수정 ✅"

**관리자 기능 과장**: 소스별 집계·UTM 분석·CSV 내보내기·탈퇴 로그·수수료 추적·상태 개입(쓰기)·여정 퍼널·예산/지역 분포 — 문서에 있으나 전부 미구현. 관리자 페이지(1,741줄)는 조회 중심.

**문서보다 코드가 앞선 것**: 업체 시드 77개 구현(문서는 TODO), 시세 데이터 13개월로 자동 갱신(문서 11개월), 사전등록 진입점이 CTA→/beta 폼으로 이동.

## 4. 코드에만 있고 "전체 기능 문서"에 없는 것 (역방향)

- **`/api/amora/actions`, `/api/amora/quote-check`** — 견적 진단(전략 쐐기 기능)과 아모라 액션. 최신 핵심 기능인데 FEATURES/PROJECT_STATUS에 부재 (docs/QUOTE_LEDGER_MASTERPLAN 등 신규 문서에는 있음)
- 페이지: `/about`, `/ai-policy`, `/privacy`, `/terms`, `/lounge`
- 스토어: communityStore, moneyStore

## 5. 이번 감사로 발견된 죽은 코드/고아 (Phase 6 정리 목록 후보)

| 항목 | 상태 |
|------|------|
| `components/landing/Hero.tsx` 외 문서에 언급된 랜딩 컴포넌트 9개 | 전부 import 0건 고아 (실사용은 ProblemReframe·NumbersAnchor·Footer 등) |
| `components/community/ServiceBanner.tsx` | import 0건 고아 |
| `apps/mobile/app/community/guestbook/[slug].tsx` | 웹 방명록 삭제로 죽은 화면 |
| `apps/web/src/app/customer/page.tsx` | 5줄 redirect 스텁 (유입 추적 기능 없음) |
| 게이미피케이션 (랭크/업적/XP) | 마이그레이션+타입+라벨만 존재, API 미구현 반쪽 |
| next.config.ts `api.dicebear.com` 허용목록 | 사용처 없는 잔재 |

## 6. 권고 (실행은 별도 승인)

1. FEATURES.md·PROJECT_STATUS.md·FEATURE_AUDIT.md 상단에 "⚠️ 2026-04 스냅샷 — 6/11 수술 이전. 현재 상태는 CLAUDE.md" 배너 추가 (또는 docs/archive/로 이동)
2. 위 §5 죽은 코드는 Phase 6 종합 때 일괄 정리 판단
3. 견적 진단·아모라 액션 등 현행 핵심 기능의 "현재 기준 기능 문서"가 없음 — CLAUDE.md가 유일한 최신 소스라 단일 실패점
