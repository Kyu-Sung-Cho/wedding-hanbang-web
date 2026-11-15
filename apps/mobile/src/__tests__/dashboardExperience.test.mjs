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

/** expo-router 경로가 가리키는 파일. 없으면 null. */
function resolveRoute(route) {
  const base = `../../app${route}`;
  for (const candidate of [`${base}.tsx`, `${base}/index.tsx`]) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(path)) return path;
  }
  return null;
}

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
  // 온보딩으로 보내면 안 된다. 이미 마친 사람에게 역할과 커플 연결을 처음부터 다시 묻는
  // 화면이라, 역할을 처음과 다르게 고르면 서버가 커플 구성이 어긋났다고 돌려주고 사람은
  // "고객 지원에 문의해주세요"에서 끝난다. 결혼 정보는 설정 화면에 이미 편집 필드로 있다.
  assert.equal(focus.route, "/settings");
  assert.notEqual(focus.route, "/onboarding");
  assert.match(focus.title, /결혼식 날짜/);
});

test("the date fix lands on a screen that can actually edit the wedding date", () => {
  const focus = buildDashboardFocus({ ...emptyInput, weddingDate: null });

  // 목적지 화면이 실재하고, 그 화면에 결혼 예정일 입력이 실제로 있어야 한다.
  // 없는 화면이나 못 고치는 화면으로 보내는 것은 버튼이 없는 것보다 나쁘다.
  const screen = resolveRoute(focus.route);
  assert.ok(screen, `${focus.route}에 해당하는 화면이 없습니다`);
  const source = readFileSync(screen, "utf8");
  assert.match(source, /결혼 예정일/);
  assert.match(source, /updateField\("weddingDate", v\)/);

  // 라운지 화면이 그 경로를 실제로 열 수 있어야 한다 — switch에 case가 없으면 버튼이
  // 아무 일도 하지 않는다.
  const homeExperience = readFileSync(
    fileURLToPath(new URL("../components/dashboard/WeddingHomeExperience.tsx", import.meta.url)),
    "utf8",
  );
  assert.ok(
    homeExperience.includes(`case "${focus.route}":`),
    `라운지 화면에 ${focus.route} case가 없습니다`,
  );
  assert.ok(
    homeExperience.includes(`router.push("${focus.route}")`),
    `라운지 화면이 ${focus.route}를 열지 않습니다`,
  );
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
  assert.equal(focus.route, "/checklist");
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

// 라운지 맨 위 카드 아래 「아모라에게 묻기」가 무엇을 묻는지(2026-11-13). 카드가 고른 할 일 그대로다.
// 카드와 버튼이 할 일을 따로 고르면 카드는 결혼식장을 말하는데 질문은 다른 분야를 묻는다.
test("the focus card names the task Amora would be asked about, and only for real tasks", () => {
  const urgent = buildDashboardFocus({
    ...emptyInput,
    todayTasks: [{ title: "청첩장 문구 정하기", categoryKey: "invitation" }],
    urgentTasks: [
      { categoryKey: "photo", categoryLabel: "스튜디오", remainingDays: 40, urgency: "ontrack" },
      { categoryKey: "venue", categoryLabel: "결혼식장", remainingDays: -4, urgency: "overdue" },
    ],
  });
  assert.equal(urgent.kind, "urgent");
  assert.deepEqual(urgent.amoraTask, { kind: "checklist", categoryLabel: "결혼식장" });

  const today = buildDashboardFocus({
    ...emptyInput,
    todayTasks: [{ title: "양가에 예식 시간 알리기", categoryKey: "family" }],
  });
  assert.deepEqual(today.amoraTask, { kind: "event", title: "양가에 예식 시간 알리기" });

  const next = buildDashboardFocus({
    ...emptyInput,
    urgentTasks: [{ categoryKey: "photo", categoryLabel: "스튜디오", remainingDays: 40, urgency: "ontrack" }],
  });
  assert.equal(next.kind, "next");
  assert.deepEqual(next.amoraTask, { kind: "checklist", categoryLabel: "스튜디오" });

  // 날짜 설정·다녀온 뒤 기록·오늘 할 일 없음은 물을 할 일이 없다. 마지막 것은 이미 아모라로 간다.
  assert.equal(buildDashboardFocus({ ...emptyInput, weddingDate: null }).amoraTask, undefined);
  assert.equal(buildDashboardFocus({
    ...emptyInput,
    bookingOutcomeTasks: [{ id: "b", vendorName: "라온", categoryLabel: "스튜디오", bookingDate: "2026-07-29", isPast: true }],
  }).amoraTask, undefined);
  assert.equal(buildDashboardFocus(emptyInput).amoraTask, undefined);
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

  assert.equal(calculateChecklistProgress(progress, categories), 67);
});

test("home progress excludes categories marked not applicable", () => {
  const categories = [
    { key: "venue", items: [{ id: "visit" }, { id: "contract" }] },
    { key: "pyebaek", items: [{ id: "greet" }] },
  ];
  const progress = {
    venue: { checklist: [{ id: "visit", done: true }, { id: "contract", done: false }] },
    pyebaek: { status: "not_applicable", checklist: [{ id: "greet", done: false }] },
  };

  assert.equal(calculateChecklistProgress(progress, categories), 50);
});

test("the home service map keeps every live consumer workflow within reach", () => {
  assert.deepEqual(
    HOME_SERVICES.map((service) => service.route),
    [
      "/checklist",
      "/schedule",
      "/budget",
      "/etiquette",
      "/market-prices",
      "/quote-check",
      "/bookings",
      // 2026-11-13: 커뮤니티는 하단 탭이 아니라 라운지 칸이 연다(뒤로 가기가 있는 화면).
      "/community",
    ],
  );
  assert.equal(new Set(HOME_SERVICES.map((service) => service.key)).size, 8);
  // 칸마다 실제 화면이 있어야 한다. 없는 화면을 여는 칸은 칸이 없는 것보다 나쁘다.
  for (const service of HOME_SERVICES) {
    assert.ok(resolveRoute(service.route), `${service.route}에 해당하는 화면이 없습니다`);
  }
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
    source.includes('router.replace("/(tabs)/lounge")'),
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
