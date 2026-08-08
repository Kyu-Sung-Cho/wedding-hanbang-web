import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  HOME_SERVICES,
  buildDashboardFocus,
  calculateChecklistProgress,
  formatLocalDateKey,
  getWeddingMomentMessage,
} from "../lib/dashboardExperience.mjs";

const emptyInput = {
  weddingDate: "2027-05-15",
  todayTasks: [],
  urgentTasks: [],
  bookingOutcomeTasks: [],
};

test("a missing wedding date becomes the first useful setup action", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    weddingDate: null,
  });

  assert.equal(focus.kind, "setup");
  assert.equal(focus.route, "/onboarding");
  assert.match(focus.title, /결혼식 날짜/);
});

test("an overdue preparation item takes priority over lower-risk work", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    todayTasks: [{ title: "청첩장 문구 정하기", categoryKey: "invitation" }],
    urgentTasks: [
      {
        categoryKey: "venue",
        categoryLabel: "결혼식장",
        remainingDays: -4,
        urgency: "overdue",
      },
    ],
    bookingOutcomeTasks: [
      {
        id: "booking-1",
        vendorName: "샘플 업체",
        categoryLabel: "스튜디오",
        bookingDate: "2026-07-29",
        isPast: true,
      },
    ],
  });

  assert.equal(focus.kind, "urgent");
  assert.equal(focus.route, "/schedule");
  assert.equal(focus.title, "결혼식장 준비를 먼저 확인해요");
  assert.match(focus.description, /4일/);
  assert.match(focus.description, /기본 확인 시점/);
  assert.match(focus.description, /실제 계약·업체 일정이 우선/);
});

test("a task saved for today becomes the focus when nothing is urgent", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    todayTasks: [{ title: "양가에 예식 시간 알리기", categoryKey: "family" }],
  });

  assert.equal(focus.kind, "today");
  assert.equal(focus.route, "/schedule");
  assert.equal(focus.title, "양가에 예식 시간 알리기");
});

test("a completed visit asks for the factual booking outcome before generic planning", () => {
  const focus = buildDashboardFocus({
    ...emptyInput,
    bookingOutcomeTasks: [
      {
        id: "booking-7",
        vendorName: "라온 스튜디오",
        categoryLabel: "스튜디오",
        bookingDate: "2026-07-29",
        isPast: true,
      },
    ],
  });

  assert.equal(focus.kind, "booking");
  assert.equal(focus.route, "/bookings");
  assert.equal(focus.bookingId, "booking-7");
  assert.match(focus.title, /라온 스튜디오/);
  assert.match(focus.description, /실제 진행 여부를 직접 확인/);
  assert.match(focus.description, /사용자가 입력한 기록 지출/);
  assert.match(focus.description, /결제 증빙이 아니에요/);
  assert.doesNotMatch(focus.description, /실제 결제금액/);
});

test("the wedding moment copy celebrates the day without hiding the practical next step", () => {
  assert.match(getWeddingMomentMessage(null), /오늘부터/);
  assert.match(getWeddingMomentMessage(120), /한 걸음/);
  assert.match(getWeddingMomentMessage(0), /축하/);
  assert.match(getWeddingMomentMessage(-10), /그날 이후/);
});

test("today uses the device calendar date instead of a UTC date slice", () => {
  const localHalfPastMidnight = new Date(2026, 6, 30, 0, 30, 0);
  assert.equal(formatLocalDateKey(localHalfPastMidnight), "2026-07-30");
});

test("home progress follows canonical checklist arrays and legacy booleans", () => {
  const categories = [
    { key: "venue", items: [{ id: "visit" }, { id: "contract" }] },
    { key: "photo", items: [{ id: "shoot" }] },
  ];
  const progress = {
    venue: {
      status: "in_progress",
      checklist: [
        { id: "visit", done: true },
        { id: "contract", done: false },
      ],
    },
    photo: { shoot: true },
    __events: [{ date: "2026-07-30", title: "ignored metadata" }],
  };

  assert.equal(calculateChecklistProgress(progress, categories), 75);
});

test("the home service map keeps every live consumer workflow within reach", () => {
  assert.deepEqual(
    HOME_SERVICES.map((service) => service.route),
    [
      "/schedule",
      "/budget",
      "/market-prices",
      "/quote-check",
      "/bookings",
      "/(tabs)/community",
    ],
  );
  assert.equal(new Set(HOME_SERVICES.map((service) => service.key)).size, 6);
});

test("the quote check service opens the current non-storing consumer workflow", () => {
  const routeUrl = new URL("../../app/quote-check/index.tsx", import.meta.url);
  assert.equal(existsSync(routeUrl), true);

  const source = readFileSync(fileURLToPath(routeUrl), "utf8");
  assert.match(
    source,
    /buildMobileSiteUrl\(\s*"\/wedding\/community\/quote-check",\s*siteOrigin,\s*\)/,
  );
  assert.match(source, /pathname:\s*"\/webview"/);
});

test("login returns through the shared onboarding gate before opening home", () => {
  const loginUrl = new URL("../../app/(auth)/login.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(loginUrl), "utf8");

  assert.equal(
    source.includes('router.replace("/(tabs)/dashboard")'),
    false,
  );
  assert.ok(
    source.match(/router\.replace\("\/"\)/g)?.length >= 2,
    "email and social login should both return through app/index.tsx",
  );
});

test("community prefetch waits until the home transition has finished", () => {
  const tabsUrl = new URL("../../app/(tabs)/_layout.tsx", import.meta.url);
  const source = readFileSync(fileURLToPath(tabsUrl), "utf8");

  assert.match(source, /InteractionManager\.runAfterInteractions/);
  assert.match(source, /warmTask\.cancel\(\)/);
});

test("the documented mobile dev command resolves Expo from the direct dependency", () => {
  const scriptUrl = new URL("../../scripts/start-expo-dev.mjs", import.meta.url);
  const source = readFileSync(fileURLToPath(scriptUrl), "utf8");

  assert.match(source, /require\.resolve\("expo\/bin\/cli"\)/);
  assert.doesNotMatch(source, /require\.resolve\("@expo\/cli/);
});

test("the Expo launcher selects the SDK 54 runtime and cleans up its child", () => {
  const scriptUrl = new URL("../../scripts/start-expo-dev.mjs", import.meta.url);
  const source = readFileSync(fileURLToPath(scriptUrl), "utf8");

  assert.match(source, /HANBANG_MOBILE_NODE/);
  assert.match(source, /node-v20\.19\.6-win-x64/);
  assert.match(source, /SIGINT/);
  assert.match(source, /SIGTERM/);
  assert.match(source, /\.once\("error"/);
});

test("mobile dev commands preserve the Metro cache between launches", () => {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(packageUrl), "utf8"),
  );

  for (const scriptName of ["dev", "dev:ios", "dev:android"]) {
    assert.doesNotMatch(
      packageJson.scripts[scriptName],
      /(?:^|\s)--clear(?:\s|$)/,
      `${scriptName} must not force a full monorepo cache rebuild`,
    );
  }
});

test("mobile development has a reproducible tunnel fallback", () => {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(packageUrl), "utf8"),
  );

  assert.match(packageJson.scripts["dev:tunnel"], /--tunnel/);
  assert.match(packageJson.devDependencies["@expo/ngrok"], /^\^?4\.1\./);
});

test("Expo automatic monorepo discovery owns Metro watch folders", () => {
  const metroConfigUrl = new URL("../../metro.config.js", import.meta.url);
  const source = readFileSync(fileURLToPath(metroConfigUrl), "utf8");

  assert.doesNotMatch(source, /config\.watchFolders\s*=/);
  assert.doesNotMatch(source, /config\.resolver\.nodeModulesPaths\s*=/);
  assert.doesNotMatch(source, /workspaceRoot/);
  assert.match(source, /getSentryExpoConfig/);
});

test("the mobile workspace exposes Expo's Babel preset to Metro", () => {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(packageUrl), "utf8"),
  );

  assert.match(
    packageJson.devDependencies["babel-preset-expo"],
    /^54\./,
    "pnpm strict resolution requires the SDK 54 preset at the mobile boundary",
  );
});
