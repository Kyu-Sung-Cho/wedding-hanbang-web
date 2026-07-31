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

  assert.match(published, /결혼 준비, 아모라와 정리하세요/);
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

test("legacy booking screens do not claim that private outcomes improve recommendations", () => {
  const bookings = readFileSync(
    fileURLToPath(new URL("../../app/bookings/index.tsx", import.meta.url)),
    "utf8",
  );

  assert.doesNotMatch(bookings, /다음 업체 추천|추천 정확도|추천 개선용/);
  assert.match(bookings, /내 예약 기록과 예산에 반영돼요/);
  assert.match(bookings, /내 예약 기록에만 저장되고 공개 목록에는 보이지 않아요/);
});
