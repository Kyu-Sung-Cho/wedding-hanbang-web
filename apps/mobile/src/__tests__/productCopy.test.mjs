import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const ACTIVE_PRODUCT_SOURCES = [
  "app/(auth)/login.tsx",
  "app/(tabs)/lounge.tsx",
  "app/(tabs)/chat.tsx",
  "app/budget/index.tsx",
  "src/components/AppGuide.tsx",
  "src/components/dashboard/WeddingHomeExperience.tsx",
  "src/lib/dashboardExperience.mjs",
  "src/lib/weddingSettings.ts",
  "app/onboarding/index.tsx",
  "src/components/onboarding/PreparationProgressList.tsx",
  // 온보딩에서 사람에게 보이는 문구 일부가 이 모듈로 옮겨졌다(저장되지 않은 입력 알림).
  "src/lib/onboardingFlow.mjs",
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

test("amora is never introduced as a planner on any active mobile screen", () => {
  // 제품 계약(CLAUDE.md)의 정본 호칭은 "AI 웨딩 비서"다(2026-11-16). 대행하는 플래너가 아니고,
  // 이 제품에서 "파트너"는 배우자될 사람을 가리키므로 아모라의 호칭으로 쓰지 않는다.
  //
  // 웹에는 같은 금지가 amoraVoiceReach.test.ts:28에 이미 있었는데 모바일은 그 테스트
  // 밖이라, 채팅 헤더가 "AI 웨딩 플래너"인 채로 계속 배포되고 있었다.
  const published = ACTIVE_PRODUCT_SOURCES.join("\n");
  // 영문 표기도 막는다. 한글만 막아뒀더니 라운지 전폭 카드의 eyebrow가
  // "AI WEDDING PLANNER"인 채로 이 가드를 그대로 지나갔다 — 대문자 장식 문구라
  // 눈에도 덜 띄고, 사용자에게는 똑같이 보이는 자리다.
  for (const banned of [
    "웨딩 플래너",
    "웨딩플래너",
    "AI 플래너",
    "WEDDING PLANNER",
    "Wedding Planner",
    "wedding planner",
    "AI PLANNER",
  ]) {
    assert.ok(
      !published.includes(banned),
      `아모라를 "${banned}"로 소개하는 문구가 남아 있습니다`,
    );
  }
});

test("amora is called by the 2026-11-16 title on active mobile screens", () => {
  // 2026-11-16 파운더 결정: 정본 호칭은 "AI 웨딩 비서"다(그 전 "결혼 준비 동반자").
  // 웹의 같은 금지는 apps/web/src/lib/ai/__tests__/amoraVoiceReach.test.ts 가 진다.
  // 옛 이름은 원문에서 본다. 주석에 남은 이름도 다음 사람이 되살릴 재료가 된다.
  const published = ACTIVE_PRODUCT_SOURCES.join("\n");
  for (const oldTitle of ["결혼 준비 동반자", "AI 동반자"]) {
    assert.ok(
      !published.includes(oldTitle),
      `아모라를 옛 호칭 "${oldTitle}"로 부르는 문구가 남아 있습니다`,
    );
  }
  // 대화 머리줄에 그리는 글자와 머리줄 폭을 어림할 때 쓰는 글자가 같아야 한다. 하나만
  // 바뀌면 320pt 화면에서 머리줄이 넘치는지 재는 숫자가 실제 글자와 어긋난다.
  const header = readFileSync(
    fileURLToPath(new URL("../lib/amoraChatHeader.ts", import.meta.url)),
    "utf8",
  );
  assert.match(header, /const HEADER_SUBTITLE = "AI 웨딩 비서";/);
  assert.match(published, /numberOfLines=\{1\}>AI 웨딩 비서<\/Text>/);
});
