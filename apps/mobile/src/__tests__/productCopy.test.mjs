import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const ACTIVE_PRODUCT_SOURCES = [
  "app/(auth)/login.tsx",
  "app/(tabs)/dashboard.tsx",
  "app/(tabs)/chat.tsx",
  "app/budget/index.tsx",
  "src/components/AppGuide.tsx",
  "src/components/dashboard/WeddingHomeExperience.tsx",
  "src/lib/dashboardExperience.mjs",
  "src/lib/weddingSettings.ts",
  "app/onboarding/index.tsx",
  "app/settings/index.tsx",
  "app/schedule/index.tsx",
  "app/community/cohort-discovery.tsx",
  "app/community/quick-review.tsx",
  "app/bookings/index.tsx",
  "app/webview.tsx",
].map((relativePath) => readFileSync(
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
  "utf8",
));
ACTIVE_PRODUCT_SOURCES.push(readFileSync(
  fileURLToPath(new URL(
    "../../../../packages/shared/src/constants/weddingPreferences.ts",
    import.meta.url,
  )),
  "utf8",
));
ACTIVE_PRODUCT_SOURCES.push(readFileSync(
  fileURLToPath(new URL(
    "../../../../packages/shared/src/constants/weddingPlanning.ts",
    import.meta.url,
  )),
  "utf8",
));

test("active mobile journeys avoid perfection promises", () => {
  const published = ACTIVE_PRODUCT_SOURCES.join("\n");

  assert.doesNotMatch(published, /완벽한\s*(결혼|준비)/);
  assert.match(published, /우리답게 결혼을 준비하세요/);
  assert.match(published, /막막한 결혼 준비, 함께 풀어가요/);
});

test("mobile onboarding keeps the Amora-led MVP promise in plain language", () => {
  const published = ACTIVE_PRODUCT_SOURCES.join("\n");

  assert.match(published, /결혼 준비, 아모라와 처음부터 끝까지/);
  assert.match(published, /해야 할 일과 날짜/);
  assert.match(published, /예상 금액과 실제로 쓴 금액/);
  assert.doesNotMatch(
    published,
    /스드메|예식장|예물|예단|혼수|본식|청첩장|부케|스냅|피팅|상견례|스몰웨딩|가성비|프리미엄|절약형|최고의 퀄리티|원본·보정본|무료로 모든 기능|결혼 준비의 모든 것/,
  );
  assert.match(published, /사진 촬영·드레스·헤어·메이크업/);
  assert.match(published, /50명 미만/);
  assert.match(published, /50~99명/);
});

test("mobile uses the shared wedding checklist instead of maintaining a second copy", () => {
  const checklistModule = readFileSync(
    fileURLToPath(new URL("../constants/checklists.ts", import.meta.url)),
    "utf8",
  );

  assert.match(checklistModule, /from "@hanbang\/shared\/constants"/);
  assert.doesNotMatch(checklistModule, /CATEGORY_CHECKLISTS\s*=\s*\[/);
});

test("default planning order is not presented as a real deadline", () => {
  const published = ACTIVE_PRODUCT_SOURCES.join("\n");

  assert.doesNotMatch(
    published,
    /권장 마감|마감 지남|마감이 계산|마감이 가까운 항목/,
  );
  assert.match(published, /실제 계약·업체·가족 일정이 우선/);
  assert.match(published, /기본 확인 시점/);
});

test("empty mobile states scope reassurance to the data Amora can actually see", () => {
  const published = ACTIVE_PRODUCT_SOURCES.join("\n");

  assert.doesNotMatch(published, /이번 주에 급한 준비가 없어요/);
  assert.doesNotMatch(published, /오늘은 준비가 잘 흘러가고 있어요/);
  assert.match(published, /현재 저장된 일정 기준/);
  assert.match(published, /등록하지 않은 일정/);
});

test("mobile settings only offers a notification control that actually works", () => {
  const settings = readFileSync(
    fileURLToPath(new URL("../../app/settings/index.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(settings, /Linking\.openSettings\(\)/);
  assert.match(settings, /알림 허용 여부는 휴대폰 설정에서 바꿀 수 있어요/);
  assert.doesNotMatch(
    settings,
    /@hanbang\/notif_|아모라 먼저 챙기기|careNotificationsEnabled|추천 개선용/,
  );
});

test("mobile cohort discovery exposes only working filters and honest assignment copy", () => {
  const discovery = readFileSync(
    fileURLToPath(new URL("../../app/community/cohort-discovery.tsx", import.meta.url)),
    "utf8",
  );

  assert.doesNotMatch(discovery, /같은 지역 동기방|같은 예산대 동기방|자동 배정돼요/);
  assert.match(discovery, /if \(error\) throw error/);
  assert.match(discovery, /동기방을 열지 못했어요/);
  assert.match(discovery, /다시 시도/);
  assert.match(discovery, /같은 분기의 방을 골라 입장하세요/);
});

test("mobile booking records stay inside the Amora execution and evidence boundary", () => {
  const bookings = readFileSync(
    fileURLToPath(new URL("../../app/bookings/index.tsx", import.meta.url)),
    "utf8",
  );

  assert.doesNotMatch(bookings, /다음 업체 추천|추천 정확도|추천 개선용/);
  assert.match(bookings, /title="예약 요청 기록"/);
  assert.match(bookings, /아모라 내부 기록 · 업체 전달·확정은 별도 확인/);
  assert.match(bookings, /업체 취소·환불을 뜻하지 않아요/);
  assert.match(bookings, /사용자가 입력한 지출이 아모라 기록과 예산에 반영돼요/);
  assert.match(bookings, /기록 지출\(사용자 입력 · 결제 증빙 아님\)/);
  assert.match(bookings, /아모라 예약 요청 기록에만 저장되고 공개 목록에는 보이지 않아요/);
  assert.doesNotMatch(bookings, /title="내 예약"|업체 예약 상태와 다음 행동|실제 결제금액|취소된 예약/);
  assert.match(ACTIVE_PRODUCT_SOURCES.join("\n"), /상담 요청 기록/);
  assert.match(
    ACTIVE_PRODUCT_SOURCES.join("\n"),
    /실제 진행 여부를 직접 확인한 뒤, 사용자가 입력한 기록 지출.*결제 증빙이 아니에요/,
  );
  assert.doesNotMatch(ACTIVE_PRODUCT_SOURCES.join("\n"), /실제 결제금액/);
  assert.doesNotMatch(ACTIVE_PRODUCT_SOURCES.join("\n"), /title: "상담 예약"/);
});

test("mobile booking amounts identify user-entered records without claiming payment evidence", () => {
  const bookings = readFileSync(
    fileURLToPath(new URL("../../app/bookings/index.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(bookings, /기록 지출.*사용자 입력.*결제 증빙 아님/);
  assert.match(bookings, /계약 참고액.*증빙 미확인/);
  assert.match(bookings, /요청 참고액.*견적·결제 증빙 아님/);
  assert.doesNotMatch(bookings, /실결제|결제 완료|실제 결제 완료/);
});

test("mobile cancellation marks stay separate from vendor cancellation and refunds", () => {
  const bookings = readFileSync(
    fileURLToPath(new URL("../../app/bookings/index.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(bookings, /취소 표시는 아모라 기록에만 적용돼요/);
  assert.match(bookings, /업체 취소·환불을 뜻하지 않아요/);
  assert.doesNotMatch(bookings, /취소 완료|환불 완료|업체 취소됨/);
});

test("mobile preserves legacy booking statuses while marking vendor evidence unverified", () => {
  const bookings = readFileSync(
    fileURLToPath(new URL("../../app/bookings/index.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(bookings, /pending: \{ label: "요청 상태 기록"/);
  assert.match(bookings, /confirmed: \{ label: "확정 상태 기록"/);
  assert.match(bookings, /completed: \{ label: "완료 상태 기록"/);
  assert.match(bookings, /cancelled: \{ label: "취소 표시 기록"/);
  assert.match(bookings, /기존 확정 상태 기록은 유지했어요/);
  assert.match(bookings, /업체 전달·확정 근거는 확인되지 않았어요/);
  assert.doesNotMatch(bookings, /내부 확인됨|업체 확정됨/);
});

test("mobile outcome and review copy identifies unverified user records", () => {
  const bookings = readFileSync(
    fileURLToPath(new URL("../../app/bookings/index.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(bookings, /사용자 입력 지출·후기 기록/);
  assert.match(bookings, /기록 지출\(사용자 입력 · 결제 증빙 아님\)/);
  assert.match(bookings, /사용자 입력 후기\(이용·결제 확인 증빙 아님\)/);
  assert.match(bookings, /아모라가 이용·결제를 검증한 후기가 아니에요/);
  assert.match(bookings, /입력 기준 추가 지출/);
  assert.doesNotMatch(bookings, /공개 후기로 공유|실제 결과 저장|실제 금액과 만족도/);
});
