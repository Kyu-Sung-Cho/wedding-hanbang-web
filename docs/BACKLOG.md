# 백로그 — 후속 작업 메모

> [!CAUTION]
> **폐기된 역사 문서 — 현재 구현·로드맵·마케팅·세일즈 근거로 사용 금지.** 아래 항목은 작업 지시나 승인된 백로그가 아니며 현재 제품 경계와 충돌하면 재개하지 않는다. 현재 제공 범위는 [`WEDDINGHANBANG_SERVICE_DOC.md`](../WEDDINGHANBANG_SERVICE_DOC.md), 현재 상태는 [`PROJECT_STATUS.md`](../PROJECT_STATUS.md), 제품 판단 원칙은 [`CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md`](./CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md)만 따른다.

> [!WARNING]
> **2026-05-18 백로그 스냅샷입니다.** 항목의 “현재 상태”, 파일 경로와 재개 조건은 이후 코드 변경으로 달라졌을 수 있습니다. 작업을 집기 전에 실제 코드와 [`../WEDDINGHANBANG_SERVICE_DOC.md`](../WEDDINGHANBANG_SERVICE_DOC.md)의 비활성 기능·출시 경계를 다시 확인합니다.

> 2026-05-18 팀 이슈 #1~#12 정리 시 발생한 미실행 항목.
> 진행 조건이 충족되면 해당 라인의 "트리거"를 기준으로 재개.

---

## 1. 업체 사진 "좋아요" 기능 (원본 #1, 우선순위: 하)

**원본 요청**: 업체가 올리는 사진마다 고객이 "좋아요"할 수 있게. 고객 취향 분석 + 업체 인사이트.

**보류 사유**: 사이드바 `/vendors` 메뉴 숨김(이슈 #12) 상태라 메인 동선에서 사진 좋아요 누를 면이 없음. 등록 업체 수도 부족.

**트리거 (재개 조건)**:
- 사이드바 `/vendors` 노출이 복원될 때 (등록 업체 충분, 캐치테이블 흐름 안정)
- 또는 AI 추천 카드(`VendorToolCard`)에서 좋아요 누르는 형태로 분리 구현 결정 시

**작업 범위 (추정)**:
- 신규 테이블 `vendor_photo_likes (user_id, vendor_id, photo_id, created_at)` + RLS
- `/vendors/[id]` 페이지의 갤러리 컴포넌트에 좋아요 버튼 + 카운트
- `customer_insights` 또는 `couple_preferences`로 취향 시그널 누적

---

## 2. 업체 페이지 항목 추가 (원본 #2, 우선순위: 중)

**원본 요청**: 각 업체 페이지 — 할인/이벤트 정보, 화보 사진, 상품 소개, 부가상품(추가비용) 소개, 고객 후기, 유사 업체/상품 추천.

**보류 사유**: 이슈 #1과 같음 (`/vendors` 메인 동선 숨김). 등록 업체에 채울 컨텐츠가 없으면 빈 섹션만 늘어남.

**트리거**: `/vendors` 노출 복원 시점.

**작업 범위 (추정)**:
- `vendors` 테이블 스키마 확장 (`promotions`, `portfolio_photos`, `addons` JSONB) 또는 별도 테이블 분리
- 부가상품 정보는 P4 (Vendor 자격 — 가격 공개 동의)와 직결 → 추가금 명시 동의서 양식 업데이트 필요
- 후기는 기존 `community` 게시글 중 vendor 태그된 것 집계 가능 (재사용)
- 유사 업체 추천: AI 임베딩 기반 또는 카테고리/지역 기반 단순 추천

---

## 3. 광고 시스템 (원본 #3, 우선순위: 중)

**원본 요청**: 광고 종류, 위치, 크기 추후 같이 고민.

**보류 사유**: 원본 이슈에서 "추후 같이 고민 필요" 명시. 비즈니스 결정 선행 필요.

**트리거**: 비즈니스 측 광고 정책 결정. P1 (Trust > 매출) 위반 가능성 검토 필수.

---

## 4. Favorites 직접 입력 강화 (이슈 #12 후속, 우선순위: 중)

**원본 요청**: 사용자가 원하는 업체를 저장해두는 공간으로. ex. 스튜디오 칸에 원하는 스튜디오명, 링크 저장.

**현재 상태**: `/favorites`는 `vendors` 테이블에 등록된 업체만 즐겨찾기 가능 (`vendor_id` FK). 사용자가 인스타에서 찾은 등록 외 업체는 저장 불가.

**트리거**: 본격적 베타 단계 진입 (현 시점에서 가장 영향력 있는 #12 후속).

**작업 범위 (추정)**:
- Schema migration:
  - 옵션 A: 새 테이블 `user_vendor_memos (id, user_id, category, name, link, notes, created_at)` + RLS
  - 옵션 B: 기존 `favorites`에 nullable column 추가 (`custom_name`, `custom_link`) + `vendor_id` nullable 허용 (제약 조건 풀어야 함, 위험)
- 옵션 A 권장 (격리).
- `/favorites` UI에 "직접 추가" 버튼 + 폼 (스튜디오명/링크/카테고리 선택)
- 모바일 앱 영향 검토 (`packages/shared`가 favorites 타입 공유하는지 확인 필요)

**위험도**: 중간. DB migration + 모바일 앱과 schema 충돌 가능성 → 별도 PR로 격리.

---

## 5. Amora Action ↔ Booking 메타데이터 링크 (후속 robust 해법, 우선순위: 중)

**배경**: 2026-05-18 사용자 보고 — `/bookings/[id]` 환불 페이지에서 취소했을 때 대시보드 "아모라가 기억하는 다음 행동"에 카드가 남는 문제.

**1차 처리(2026-05-18)**: 
- refund route에 progress.__events·spent 역동기화 추가 (대시보드 "다가오는 일정"·예산은 해결)
- AI 시스템 프롬프트에 "cancel_booking 후 amora_action 도 정리하라" 지시 추가 — **AI 매칭에 의존**, 100% 보장 아님

**미해결 부분**: amora_action(progress.__amora_actions JSON)과 vendor_bookings 간 명시적 link가 없어, 채팅 외 경로(/bookings/[id] 환불 버튼, vendor portal)에서 booking이 cancelled 처리될 때 amora_action을 자동 정리 불가.

**트리거**: AI 매칭으로 처리 안 되는 케이스 보고가 들어오면 즉시 진행.

**작업 범위 (추정)**:
- `AmoraActionItem` interface에 optional `relatedBookingId?: string` 필드 추가 (TypeScript만, DB는 JSON이라 schema migration 불필요)
- `executeCreateBooking`(toolExecutor.ts:1888)이 자동으로 `add_amora_action` 호출 시 `relatedBookingId` 포함 — 또는 AI 프롬프트로 description에 `[booking:ID]` 태그 강제
- cancel 경로 3곳(`executeCancelBooking`, `/api/vendor/bookings/[id]` PATCH, `/api/payments/[id]/refund`)에서 `progress.__amora_actions` 중 `relatedBookingId === bookingId`인 항목을 status="dismissed"로 자동 변경
- 기존 데이터(메타 없음)는 영향 없음 — 사용자가 UI의 "완료"/"숨김" 버튼으로 수동 정리

**위험도**: 낮음 (DB schema 변경 없음, 새 booking 부터만 적용, 기존 데이터 backward compat).

---

## 변경 이력

| 일자 | 작업 | 결과 |
|---|---|---|
| 2026-05-18 | 팀 이슈 #1~#12 1차 처리 | #4·#6·#7-A·#8 이미 구현 / #5·#7-B·#9·#10·#11·#12 부분 구현 / #1·#2·#12 favorites 강화·#3 백로그 이동 |
| 2026-05-18 | 예약 취소 역동기화 버그 1차 fix | refund route에 sync 추가 + AI 프롬프트에 amora_action 정리 지시 추가. amora_action ↔ booking 메타데이터 링크는 후속 항목 5로 이동 |
