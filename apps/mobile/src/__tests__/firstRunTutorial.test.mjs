// 첫 실행 안내와 아모라 첫마디 — 언제 뜨는지, 무엇을 적는지, 어디에 뜨는지.
//
// 이 파일이 지키는 것은 화면 모양이 아니라 **조건**이다. 예전 두 벌의 안내가 죽은 이유는
// 화면이 없어서가 아니라 "언제 뜨는가"를 아무도 소유하지 않았기 때문이다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

function readSource(relativePath) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

function compileCommonJs(source, resolveDependency = () => {
  throw new Error("unexpected dependency");
}) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", result.outputText)(
    module.exports,
    module,
    resolveDependency,
  );
  return module.exports;
}

const preparationStageModule = compileCommonJs(
  readSource("../../../../packages/shared/src/constants/preparationStage.ts"),
);
const firstRunContract = compileCommonJs(
  readSource("../../../../packages/shared/src/contracts/firstRunTutorial.ts"),
);
const amoraFirstHelloContract = compileCommonJs(
  readSource("../../../../packages/shared/src/contracts/amoraFirstHello.ts"),
  (specifier) => {
    if (specifier === "../constants/preparationStage") return preparationStageModule;
    throw new Error(`unexpected dependency: ${specifier}`);
  },
);
const sharedModule = {
  ...preparationStageModule,
  ...firstRunContract,
  ...amoraFirstHelloContract,
};

function requireShared(specifier) {
  if (specifier === "@hanbang/shared") return sharedModule;
  throw new Error(`unexpected dependency: ${specifier}`);
}

const firstRunTutorialSource = readSource("../lib/firstRunTutorial.ts");
const amoraFirstHelloSource = readSource("../lib/amoraFirstHello.ts");
const tutorial = compileCommonJs(firstRunTutorialSource, requireShared);
const firstHello = compileCommonJs(amoraFirstHelloSource, requireShared);

const loungeSource = readSource("../../app/(tabs)/lounge.tsx");
const tabsLayoutSource = readSource("../../app/(tabs)/_layout.tsx");
const chatSource = readSource("../../app/(tabs)/chat.tsx");
const coachMarksSource = readSource("../components/lounge/FirstRunCoachMarks.tsx");
const fabSource = readSource("../components/lounge/AmoraFab.tsx");
const homeExperienceSource = readSource(
  "../components/dashboard/WeddingHomeExperience.tsx",
);
const appGuideSource = readSource("../components/AppGuide.tsx");
const settingsSource = readSource("../../app/settings/index.tsx");

function createMemoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    async getItem(key) {
      return items.has(key) ? items.get(key) : null;
    },
    async setItem(key, value) {
      items.set(key, value);
    },
    async removeItem(key) {
      items.delete(key);
    },
  };
}

/* ─────────────────────────────────────────────
   (a) 온보딩을 마치지 않은 사람에게는 절대 뜨지 않는다
   ───────────────────────────────────────────── */

test("the first-run tutorial never opens before onboarding is finished", () => {
  const neverSeen = { completedAt: null, version: null };

  assert.equal(
    sharedModule.shouldShowFirstRunTutorial({
      onboardingCompleted: false,
      state: neverSeen,
    }),
    false,
  );
  assert.equal(
    sharedModule.shouldShowFirstRunTutorial({
      onboardingCompleted: true,
      state: neverSeen,
    }),
    true,
  );

  // 라운지가 프로필의 onboarding_completed를 실제로 읽고, 미완료면 프로필 조회조차 하지 않는다.
  assert.match(loungeSource, /select\("name, couple_id, onboarding_completed"\)/);
  // 성별(role)은 가져오지 않는다. 첫 실행 안내도 아모라 첫마디도 그 값을 읽지 않는데,
  // 안 쓰는 성별을 계속 실어 나르면 언젠가 누군가 그것을 화면에 쓴다. main의 #138이
  // 같은 이유로 채팅 말풍선에서 성별 명사를 걷어냈다("고르지도 않은 성별로 부르지 않기").
  assert.doesNotMatch(loungeSource, /\brole\b/);
  assert.match(loungeSource, /const onboardingCompleted = profile\.onboarding_completed === true/);
  assert.match(loungeSource, /if \(!onboardingCompleted\) return;/);
});

/* ─────────────────────────────────────────────
   (b) 이미 본 사람에게는 다시 뜨지 않는다
   ───────────────────────────────────────────── */

test("a recorded completion keeps the tutorial closed, and the record lives on the account", () => {
  const completed = {
    completedAt: "2026-08-19T02:00:00.000Z",
    version: sharedModule.FIRST_RUN_TUTORIAL_VERSION,
  };

  assert.equal(
    sharedModule.shouldShowFirstRunTutorial({
      onboardingCompleted: true,
      state: completed,
    }),
    false,
  );
  // 판이 올라가면 다시 볼 수 있다 — 기록을 지우는 대신 판을 비교한다.
  assert.equal(
    sharedModule.shouldShowFirstRunTutorial({
      onboardingCompleted: true,
      state: { ...completed, version: sharedModule.FIRST_RUN_TUTORIAL_VERSION - 1 },
    }),
    true,
  );
  // 기기 저장소는 "이번에 이미 띄웠다"만 담당한다.
  assert.equal(
    sharedModule.shouldShowFirstRunTutorial({
      onboardingCompleted: true,
      state: { completedAt: null, version: null },
      shownThisSession: true,
    }),
    false,
  );
});

test("the device flag only suppresses repeats; the account row stays the source of truth", async () => {
  tutorial.resetFirstRunTutorialRunState();
  const storage = createMemoryStorage();

  assert.equal(await tutorial.hasShownFirstRunTutorialOnDevice(storage), false);
  await tutorial.rememberFirstRunTutorialShown(storage, Date.parse("2026-08-19T02:00:00.000Z"));
  assert.equal(await tutorial.hasShownFirstRunTutorialOnDevice(storage), true);
  assert.equal(
    storage.items.get(sharedModule.FIRST_RUN_TUTORIAL_SESSION_KEY),
    "2026-08-19T02:00:00.000Z",
  );

  // 저장소가 통째로 실패해도 화면 판정은 멈추지 않는다.
  tutorial.resetFirstRunTutorialRunState();
  const brokenStorage = {
    async getItem() {
      throw new Error("storage unavailable");
    },
    async setItem() {
      throw new Error("storage unavailable");
    },
  };
  assert.equal(await tutorial.hasShownFirstRunTutorialOnDevice(brokenStorage), false);
  await tutorial.rememberFirstRunTutorialShown(brokenStorage);
  assert.equal(await tutorial.hasShownFirstRunTutorialOnDevice(brokenStorage), true);
  tutorial.resetFirstRunTutorialRunState();
});

test("leaving mid-tutorial does not burn the device flag for good", async () => {
  // 예전에는 안내를 **보여주기 전에** AsyncStorage에 영구 플래그를 적었다. 지우는 경로가
  // 저장소 전체에 0건이라, 안내 중 전화를 받거나 OS가 앱을 회수하면 프로필엔 완료가 없는데
  // 기기 플래그만 남아 그 사람은 다시는 안내도, 종료 핸들러가 만드는 아모라의 첫마디도
  // 받지 못했다.
  tutorial.resetFirstRunTutorialRunState();
  const storage = createMemoryStorage();

  // 여는 순간: 메모리에만 표식이 남는다. 같은 실행에서의 중복만 막으면 된다.
  tutorial.noteFirstRunTutorialOpened();
  assert.equal(await tutorial.hasShownFirstRunTutorialOnDevice(storage), true);
  assert.equal(storage.items.has(sharedModule.FIRST_RUN_TUTORIAL_SESSION_KEY), false);

  // 여기서 앱이 죽었다 = 메모리 표식도 같이 죽는다. 다음 실행에서 안내는 다시 뜬다.
  tutorial.resetFirstRunTutorialRunState();
  assert.equal(await tutorial.hasShownFirstRunTutorialOnDevice(storage), false);

  // 끝났을 때만 기기에 적는다.
  await tutorial.rememberFirstRunTutorialShown(storage, Date.parse("2026-08-19T02:00:00.000Z"));
  assert.equal(
    storage.items.get(sharedModule.FIRST_RUN_TUTORIAL_SESSION_KEY),
    "2026-08-19T02:00:00.000Z",
  );
  tutorial.resetFirstRunTutorialRunState();
});

test("the lounge writes the device flag when the tutorial closes, never when it opens", () => {
  const evaluate = loungeSource.slice(
    loungeSource.indexOf("const evaluateFirstRunTutorial"),
    loungeSource.indexOf("const loadData"),
  );
  assert.match(
    evaluate,
    /noteFirstRunTutorialOpened\(\);\s+setFirstRunTutorialOpen\(true\);/,
  );
  assert.doesNotMatch(evaluate, /rememberFirstRunTutorialShown/);

  const close = loungeSource.slice(
    loungeSource.indexOf("const handleFirstRunTutorialClose"),
  );
  // 짚을 요소가 하나도 없었으면(unavailable) 그 사람은 아무것도 못 봤다. 그때는 적지 않고
  // 다음 실행에서 한 번 더 시도한다.
  assert.match(
    close,
    /if \(outcome !== "unavailable"\) \{[\s\S]{0,240}void rememberFirstRunTutorialShown\(AsyncStorage\);/,
  );
});

test("the coach marks cover the tab bar and treat Android back as leaving", () => {
  // 오버레이를 화면 안에 그리면 탭바를 덮을 수 없다 — 탭바는 Tabs 네비게이터가 화면 밖에
  // 그린다. 마지막 단계에서 FAB만 밝히는데 바로 아래 "아모라" 탭이 똑같이 밝게 남아
  // 눌렸고, 그걸 눌러 라운지를 떠나면 종료 핸들러가 영영 호출되지 않았다.
  assert.match(coachMarksSource, /import \{ Modal, /);
  assert.match(coachMarksSource, /<Modal$/m);
  assert.match(coachMarksSource, /statusBarTranslucent/);
  assert.doesNotMatch(coachMarksSource, /style=\{StyleSheet\.absoluteFill\}/);
  // 뒤로가기도 종료다. 안내가 열린 채로 사람만 사라지면 완료도 첫마디도 없다.
  assert.match(coachMarksSource, /onRequestClose=\{skipAll\}/);

  // Modal은 react-native 코어다. 새 네이티브 의존성이 아니고 app.json도 건드리지 않는다.
  const packageJson = JSON.parse(readSource("../../package.json"));
  const declared = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
  for (const specifier of [...coachMarksSource.matchAll(/from "([^"]+)"/g)].map((m) => m[1])) {
    if (specifier.startsWith(".") || specifier.startsWith("@/")) continue;
    const packageName = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    assert.ok(declared.has(packageName), `안내가 package.json에 없는 "${packageName}"을 씁니다`);
  }
});

/* ─────────────────────────────────────────────
   (c) 컬럼이 아직 없는 배포(42703)에서 첫 화면이 죽지 않는다
   ───────────────────────────────────────────── */

test("a missing tutorial column reads as 'not seen yet' instead of breaking the lounge", async () => {
  const missingColumn = {
    code: "42703",
    message: 'column profiles.first_run_tutorial_completed_at does not exist',
  };
  assert.equal(sharedModule.isMissingFirstRunTutorialColumn(missingColumn), true);

  const read = await tutorial.loadFirstRunTutorialState({
    async readState() {
      return { data: null, error: missingColumn };
    },
    async writeCompletion() {
      return { error: missingColumn };
    },
  });

  assert.deepEqual(read.state, { completedAt: null, version: null });
  assert.equal(read.columnsMissing, true);
  assert.equal(
    sharedModule.shouldShowFirstRunTutorial({
      onboardingCompleted: true,
      state: read.state,
    }),
    true,
  );
});

test("any read failure — thrown or returned — still resolves to a usable state", async () => {
  const thrown = await tutorial.loadFirstRunTutorialState({
    async readState() {
      throw new Error("network down");
    },
    async writeCompletion() {
      return {};
    },
  });
  assert.deepEqual(thrown.state, { completedAt: null, version: null });
  assert.equal(thrown.columnsMissing, false);

  const transient = await tutorial.loadFirstRunTutorialState({
    async readState() {
      return { data: null, error: { code: "PGRST301", message: "JWT expired" } };
    },
    async writeCompletion() {
      return {};
    },
  });
  assert.deepEqual(transient.state, { completedAt: null, version: null });
  assert.equal(transient.columnsMissing, false);
});

test("a failed completion write never throws and never blocks the screen", async () => {
  assert.equal(
    await tutorial.markFirstRunTutorialCompleted({
      async readState() {
        return {};
      },
      async writeCompletion() {
        throw new Error("offline");
      },
    }),
    false,
  );
  assert.equal(
    await tutorial.markFirstRunTutorialCompleted({
      async readState() {
        return {};
      },
      async writeCompletion() {
        return { error: { code: "42703" } };
      },
    }),
    false,
  );

  // 라운지는 컬럼이 없다고 확인된 배포에서는 쓰기를 시도하지 않는다.
  assert.match(
    loungeSource,
    /if \(outcome !== "unavailable" && !firstRunColumnsMissingRef\.current\) \{\s*\/\/[^\n]*\n\s*void markFirstRunTutorialCompleted\(/,
  );
  // 안내 상태 select는 이름·couple_id select와 분리돼 있어야 한다.
  assert.match(
    loungeSource,
    /\.select\(FIRST_RUN_TUTORIAL_COLUMNS\)\s*\.eq\("id", userId\)\s*\.maybeSingle\(\)/,
  );
  // 새 RPC를 만들지 않고 본인 행 UPDATE 정책을 그대로 쓴다.
  assert.doesNotMatch(loungeSource, /\.rpc\(/);
});

/* ─────────────────────────────────────────────
   (d) 건너뛰기도 완료다
   ───────────────────────────────────────────── */

test("skipping records completion exactly like finishing does", async () => {
  const writes = [];
  const ok = await tutorial.markFirstRunTutorialCompleted(
    {
      async readState() {
        return {};
      },
      async writeCompletion(patch) {
        writes.push(patch);
        return {};
      },
    },
    Date.parse("2026-08-19T05:30:00.000Z"),
  );

  assert.equal(ok, true);
  assert.deepEqual(writes, [
    {
      first_run_tutorial_completed_at: "2026-08-19T05:30:00.000Z",
      first_run_tutorial_version: sharedModule.FIRST_RUN_TUTORIAL_VERSION,
    },
  ]);

  // 건너뛰기 버튼은 항상 보이고, 닫히는 이유를 "skipped"로 알린다.
  assert.match(coachMarksSource, /accessibilityLabel="안내 건너뛰기"/);
  assert.match(coachMarksSource, /onCloseRef\.current\("skipped"\)/);
  // 라운지는 "unavailable"(짚을 요소가 하나도 없었음)일 때만 기록하지 않는다.
  // 단 그때도 화면을 떠나보내지는 않는다 — 첫마디는 별도 테스트가 지킨다
  // ("a coach mark that finds no anchor still lets amora speak first").
  assert.match(
    loungeSource,
    /if \(outcome !== "unavailable" && !firstRunColumnsMissingRef\.current\) \{/,
  );
  assert.doesNotMatch(loungeSource, /outcome === "skipped"[\s\S]{0,40}return;/);
});

/* ─────────────────────────────────────────────
   앵커: 못 잡으면 조용히 건너뛴다
   ───────────────────────────────────────────── */

test("a step whose anchor cannot be resolved is skipped, required ones included", () => {
  // 규칙은 컴포넌트의 진행 경로에 있다: 앵커가 없으면, 혹은 화면 밖이라 자리를 못 잡으면
  // 다음 단계로 넘어간다. optional 여부를 보지 않는 것이 핵심이다 — 필수 단계라도 가리킬
  // 데가 없으면 가리키지 않는다.
  assert.match(
    coachMarksSource,
    /const anchor = registry\.getAnchor\(current\.id\);\s*if \(!anchor\) \{\s*if \(!cancelled\) setStepIndex\(\(index\) => index \+ 1\);/,
  );
  assert.match(
    coachMarksSource,
    /if \(!next\) \{\s*setStepIndex\(\(index\) => index \+ 1\);\s*return;/,
  );
  assert.doesNotMatch(coachMarksSource, /\.optional/);

  // 하나도 못 보여줬으면 완료로 기록하지 않는다.
  assert.match(
    coachMarksSource,
    /onCloseRef\.current\(shownCountRef\.current > 0 \? "finished" : "unavailable"\)/,
  );
});

test("every step the mobile lounge can point at is actually anchored in the tree", () => {
  const anchored = new Set(
    [...`${homeExperienceSource}\n${fabSource}\n${loungeSource}`.matchAll(
      /(?:FirstRunAnchor\s+id="([a-z-]+)"|anchorId = "([a-z-]+)")/g,
    )].map((match) => match[1] ?? match[2]),
  );

  assert.ok(anchored.has("lounge-focus"));
  assert.ok(anchored.has("lounge-tools"));
  // 마지막 단계는 FAB을 가리켜야 아모라 첫마디로 이어진다.
  assert.ok(anchored.has("amora-fab"));

  for (const step of sharedModule.FIRST_RUN_TUTORIAL_STEPS) {
    if (step.optional) continue;
    assert.ok(
      anchored.has(step.id),
      `필수 단계 "${step.id}"를 가리킬 앵커가 라운지에 없습니다`,
    );
  }
});

test("an anchor outside the visible viewport yields no coach mark", () => {
  const overlay = { x: 0, y: 60, width: 390, height: 700 };

  // 화면 아래로 완전히 벗어남
  assert.equal(
    tutorial.buildCoachMarkPlacement(
      { x: 20, y: 900, width: 350, height: 120 },
      overlay,
    ),
    null,
  );
  // 화면 위로 완전히 벗어남
  assert.equal(
    tutorial.buildCoachMarkPlacement(
      { x: 20, y: -400, width: 350, height: 120 },
      overlay,
    ),
    null,
  );
  // 크기가 0인 요소(아직 그려지지 않음)
  assert.equal(
    tutorial.buildCoachMarkPlacement({ x: 20, y: 200, width: 0, height: 0 }, overlay),
    null,
  );
});

test("the tooltip flips above the anchor when there is no room below", () => {
  const overlay = { x: 0, y: 60, width: 390, height: 700 };

  const nearTop = tutorial.buildCoachMarkPlacement(
    { x: 20, y: 100, width: 350, height: 200 },
    overlay,
  );
  assert.equal(nearTop.hole.left, 12);
  assert.equal(nearTop.hole.top, 32);
  assert.equal(typeof nearTop.tooltipTop, "number");
  assert.equal(nearTop.tooltipBottom, null);

  // FAB처럼 바닥에 붙은 요소는 말풍선이 위로 간다.
  const nearBottom = tutorial.buildCoachMarkPlacement(
    { x: 300, y: 640, width: 58, height: 58 },
    overlay,
  );
  assert.equal(nearBottom.tooltipTop, null);
  assert.equal(typeof nearBottom.tooltipBottom, "number");
});

/* ─────────────────────────────────────────────
   (e) FAB은 탭바 위로 뜬다
   ───────────────────────────────────────────── */

test("the Amora button sits just above the tab bar, not a second tab bar higher", () => {
  // 탭바는 position을 주지 않아 레이아웃 공간을 차지한다(static). 그래서 탭 화면
  // 컨테이너의 bottom은 **이미 탭바 위**이고, 홈 인디케이터도 탭바 높이 안에 들어 있다.
  // 여기에 탭바 높이나 인셋을 한 번 더 더하면 같은 값을 두 번 빼는 셈이라 FAB이 허공에
  // 뜬다 — 실제로 바닥에서 ~190px 떠 있었다.
  const tabBarStyle = tabsLayoutSource.slice(
    tabsLayoutSource.indexOf("tabBarStyle: {"),
  );
  assert.match(tabBarStyle.slice(0, 400), /height: 86,/);
  assert.match(tabBarStyle.slice(0, 400), /paddingBottom: 24,/);
  assert.equal(tutorial.LOUNGE_TAB_BAR_HEIGHT, 86);
  assert.equal(tutorial.LOUNGE_TAB_BAR_BOTTOM_PADDING, 24);

  // 이 셈 전체가 "탭바가 static"이라는 전제 위에 있다. absolute가 되면 화면이 탭바
  // 아래까지 뻗고 FAB은 탭바 뒤로 숨는다 — 전제를 바꾸려면 이 테스트를 먼저 만난다.
  assert.doesNotMatch(tabBarStyle.slice(0, 400), /position:/);

  assert.equal(tutorial.getAmoraFabBottomOffset(), tutorial.AMORA_FAB_GAP);
  assert.equal(tutorial.getAmoraFabBottomOffset(), 20);
  assert.ok(tutorial.getAmoraFabBottomOffset() < tutorial.LOUNGE_TAB_BAR_HEIGHT);
  // 인셋을 받지 않는다. 받으면 언젠가 다시 더해진다.
  assert.equal(tutorial.getAmoraFabBottomOffset.length, 0);

  assert.match(fabSource, /bottom: getAmoraFabBottomOffset\(\)/);
  assert.doesNotMatch(fabSource, /useSafeAreaInsets/);
  assert.match(fabSource, /accessibilityLabel="아모라와 대화하기"/);
  assert.match(fabSource, /accessibilityLabel="아모라 알림 닫기"/);
});

test("the lounge content ends above the button and its bubble, not behind them", () => {
  // 마지막 카드가 FAB이나 말풍선 뒤에 숨으면, 처음 온 사람은 자기가 눌러야 할 카드를
  // 못 본다. 여백은 리터럴이 아니라 실제 상수에서 셈해야 버튼이 커질 때 같이 움직인다.
  assert.equal(tutorial.AMORA_FAB_SIZE, 58);
  assert.match(fabSource, /width: AMORA_FAB_SIZE,\s*height: AMORA_FAB_SIZE,/);

  const occupied = tutorial.getAmoraFabBottomOffset() + tutorial.AMORA_FAB_SIZE;
  assert.ok(
    tutorial.LOUNGE_CONTENT_BOTTOM_PADDING >= occupied,
    "콘텐츠 여백이 FAB이 차지하는 높이보다 작습니다",
  );
  // 말풍선은 첫마디가 놓이는 자리다. 그 순간에만 가려지는 것이 가장 나쁜 가려짐이다.
  assert.ok(
    tutorial.LOUNGE_CONTENT_BOTTOM_PADDING
      >= occupied + tutorial.AMORA_FAB_BUBBLE_HEIGHT,
  );
  assert.match(homeExperienceSource, /paddingBottom: LOUNGE_CONTENT_BOTTOM_PADDING,/);
  assert.doesNotMatch(homeExperienceSource, /paddingBottom: 128,/);
});

test("the bubble Amora speaks through is a button, exactly like on the web", () => {
  // 말풍선이 읽기 전용이면, 아모라가 먼저 건넨 말을 눌러본 사람은 아무 일도 일어나지
  // 않는 화면을 만난다. 웹은 같은 말풍선이 버튼이라 눌러서 대화가 열린다.
  const bubble = fabSource.slice(
    fabSource.indexOf("{bubble ? ("),
    fabSource.indexOf("<Animated.View"),
  );
  assert.match(bubble, /<Pressable/);
  assert.match(bubble, /onPress=\{onPress\}/);
  assert.match(bubble, /accessibilityRole="button"/);
  assert.doesNotMatch(bubble, /accessibilityRole="text"/);
});

test("closing the bubble hides the bubble, not the fact that Amora spoke", () => {
  // X는 "알림 봤다"이지 "첫마디 필요 없다"가 아니다. 점까지 지우면 아모라가 남긴 말이
  // 기다린다는 표시가 화면에서 통째로 사라진다.
  assert.match(loungeSource, /const \[amoraUnread, setAmoraUnread\] = useState\(false\)/);
  assert.match(loungeSource, /unread=\{amoraUnread\}/);
  assert.doesNotMatch(loungeSource, /unread=\{amoraBubble !== null\}/);

  const dismiss = loungeSource.slice(
    loungeSource.indexOf("const handleDismissAmoraBubble"),
  ).slice(0, 400);
  assert.match(dismiss, /setAmoraBubble\(null\)/);
  assert.doesNotMatch(dismiss, /setAmoraUnread/);

  // 대화로 들어가는 순간이 읽는 순간이다.
  const press = loungeSource.slice(
    loungeSource.indexOf("const handleAmoraFabPress"),
  ).slice(0, 600);
  assert.match(press, /setAmoraUnread\(false\)/);

  // 앱을 다시 켰을 때도, 말풍선을 접었던 사람에게 점은 남아 있어야 한다.
  assert.match(
    loungeSource,
    /if \(!active \|\| !pending\) return;[\s\S]{0,200}setAmoraUnread\(true\);[\s\S]{0,200}if \(pending\.bubbleDismissed\) return;/,
  );
});

/* ─────────────────────────────────────────────
   (f) 첫마디는 모델이 쓰지 않는다
   ───────────────────────────────────────────── */

test("the first hello is built from onboarding input alone, with no model call", () => {
  const input = {
    role: "bride",
    weddingDate: "2026-11-14",
    preparationStage: "venue_booked",
    partnerLinked: false,
    now: Date.parse("2026-08-19T03:00:00.000Z"),
  };

  const first = sharedModule.buildAmoraFirstHello(input);
  const second = sharedModule.buildAmoraFirstHello(input);

  // 같은 상황이면 두 사람이 같은 말을 받는다.
  assert.deepEqual(first, second);
  assert.match(first.preview, /결혼식까지 87일 남았어요/);
  assert.match(first.body, /안녕하세요, 아모라예요/);
  assert.match(first.body, /초대 코드/);

  // 준비 진척을 판정하지 않고, 업체·가격·계약을 아모라가 먼저 꺼내지 않는다.
  //
  // 사용자가 고른 단계 문구("결혼식장을 계약했어요")는 그대로 되읽어 주는 것이 이 기능의
  // 요점이라 검사에서 뺀다 — 되읽기는 아모라의 주장이 아니라 사용자의 말이다.
  const stageLabel = sharedModule.findPreparationStageOption("venue_booked").label;
  assert.ok(first.body.includes(stageLabel));
  const amoraOwnWords = first.body.replace(stageLabel, "");
  for (const banned of [
    "늦",
    "잘하고",
    "잘 하고",
    "업체",
    "가격",
    "계약",
    "플래너",
    "파트너님",
  ]) {
    assert.ok(
      !amoraOwnWords.includes(banned),
      `첫마디에 "${banned}"가 들어 있습니다`,
    );
  }

  // 아는 것이 하나도 없어도 말은 건다 — 그게 이 기능의 요점이다.
  const unknown = sharedModule.buildAmoraFirstHello({ now: input.now });
  assert.ok(unknown.preview.length > 0);
  assert.ok(unknown.body.length > 0);
});

test("the hello path never touches the network or the proactive route", () => {
  // /api/chat/proactive는 환경변수 두 개 뒤에 있고 지금 꺼져 있다. 그 경로로 태우면
  // 아무 일도 일어나지 않는다.
  for (const [name, source] of [
    ["lounge.tsx", loungeSource],
    ["AmoraFab.tsx", fabSource],
    ["FirstRunCoachMarks.tsx", coachMarksSource],
    ["lib/amoraFirstHello.ts", amoraFirstHelloSource],
  ]) {
    assert.ok(!source.includes("proactive"), `${name}가 proactive 경로를 부릅니다`);
    assert.ok(!source.includes("apiFetch"), `${name}가 API를 부릅니다`);
    assert.ok(!source.includes("fetch("), `${name}가 네트워크를 부릅니다`);
  }
  assert.match(loungeSource, /buildAmoraFirstHello\(\{/);
});

test("the greeting survives the trip from the lounge to the conversation", async () => {
  firstHello.resetAmoraFirstHelloMemory();
  const storage = createMemoryStorage();
  const now = Date.parse("2026-08-19T03:00:00.000Z");
  const hello = sharedModule.buildAmoraFirstHello({
    weddingDate: "2026-11-14",
    preparationStage: "venue_booked",
    partnerLinked: true,
    now,
  });

  await firstHello.rememberPendingAmoraFirstHello(hello, { storage, now });

  // 라운지가 앱 재시작 뒤에도 말풍선을 되살릴 수 있어야 한다.
  firstHello.resetAmoraFirstHelloMemory();
  const restored = await firstHello.peekPendingAmoraFirstHello({ storage, now });
  assert.equal(restored.preview, hello.preview);
  assert.equal(restored.bubbleDismissed, false);

  // 말풍선을 닫아도 인사 자체는 남는다 — 닫기는 "알림 봤다"이지 "인사 필요 없다"가 아니다.
  await firstHello.dismissAmoraFirstHelloBubble({ storage, now });
  firstHello.resetAmoraFirstHelloMemory();
  assert.equal(
    (await firstHello.peekPendingAmoraFirstHello({ storage, now })).bubbleDismissed,
    true,
  );

  const delivered = await firstHello.consumePendingAmoraFirstHello({ storage, now });
  assert.equal(delivered.body, hello.body);
  assert.equal(storage.items.has(firstHello.PENDING_AMORA_FIRST_HELLO_KEY), false);
  // 두 번 열어도 같은 인사가 보인다(같은 실행 안에서는).
  assert.deepEqual(firstHello.getDeliveredAmoraFirstHello(), delivered);

  firstHello.resetAmoraFirstHelloMemory();
  assert.equal(await firstHello.consumePendingAmoraFirstHello({ storage, now }), null);
  assert.equal(firstHello.getDeliveredAmoraFirstHello(), null);
});

test("a stale or malformed stored greeting is treated as absent", async () => {
  firstHello.resetAmoraFirstHelloMemory();
  const now = Date.parse("2026-08-19T03:00:00.000Z");

  assert.equal(firstHello.parsePendingAmoraFirstHello("not json", now), null);
  assert.equal(firstHello.parsePendingAmoraFirstHello(JSON.stringify({}), now), null);
  assert.equal(
    firstHello.parsePendingAmoraFirstHello(
      JSON.stringify({ preview: "안녕", body: "안녕", savedAt: now - 100 * 24 * 3600_000 }),
      now,
    ),
    null,
  );
  // 기기 시계가 뒤로 돌아간 값(미래)도 버린다 — 아니면 영영 만료되지 않는다.
  assert.equal(
    firstHello.parsePendingAmoraFirstHello(
      JSON.stringify({ preview: "안녕", body: "안녕", savedAt: now + 60_000 }),
      now,
    ),
    null,
  );
  assert.equal(
    firstHello.parsePendingAmoraFirstHello(
      JSON.stringify({ preview: "안녕", body: "x".repeat(5000), savedAt: now }),
      now,
    ),
    null,
  );
});

test("the conversation places the greeting itself instead of waiting to be spoken to", () => {
  // 대화 화면이 첫마디를 아모라 메시지로 놓는다.
  assert.match(chatSource, /consumePendingAmoraFirstHello/);
  assert.match(chatSource, /sender_type: "ai"/);
  assert.match(chatSource, /role: "assistant"/);
  // 저장되지 않은 로컬 메시지라 서버로 보내는 맥락(messages)에는 넣지 않는다.
  assert.match(chatSource, /const AMORA_FIRST_HELLO_MESSAGE_ID = "amora_first_hello_local"/);
  assert.doesNotMatch(chatSource, /setMessages\(\[firstHello/);
  // 대화가 비어 있어도 첫마디가 있으면 빈 화면 대신 인사가 보인다.
  assert.match(chatSource, /displayedMessages\.length === 0 \? \(/);
  // 그래도 "무엇부터 물어보지"에 서 있는 사람이라 시작 칩은 남는다.
  assert.match(chatSource, /const AMORA_STARTER_PROMPTS = \[/);
  assert.match(
    chatSource,
    /scopedMessages\.length === 0 && firstHelloMessage && !isP/,
  );
});

/* ─────────────────────────────────────────────
   두 안내가 동시에 뜨지 않는다
   ───────────────────────────────────────────── */

test("the six-slide guide is reachable by hand and never auto-opens on first run", () => {
  // 예전에는 import하는 파일이 0개라 아무도 열 수 없었다.
  assert.match(settingsSource, /import AppGuide from "@\/components\/AppGuide"/);
  assert.match(settingsSource, /title="서비스 안내 다시 보기"/);
  assert.match(settingsSource, /onPress=\{\(\) => setGuideVisible\(true\)\}/);

  // 완주해도 플래그를 남긴다. 예전에는 "다시 보지 않기"를 누른 사람만 기록됐다.
  assert.match(appGuideSource, /export const APP_GUIDE_SEEN_KEY/);
  assert.match(appGuideSource, /await AsyncStorage\.setItem\(APP_GUIDE_SEEN_KEY, "true"\)/);
  assert.match(appGuideSource, /const finishGuide = useCallback\(async \(\) => \{\s*await rememberSeen\(\);/);
  assert.match(appGuideSource, /if \(isLastSlide\) \{\s*void finishGuide\(\);/);

  // 첫 실행에 자동으로 뜨는 것은 코치마크 하나뿐이다.
  assert.doesNotMatch(loungeSource, /AppGuide/);
  assert.match(loungeSource, /<FirstRunCoachMarks onClose=\{handleFirstRunTutorialClose\} \/>/);
});


test("a coach mark that finds no anchor still lets amora speak first", () => {
  // 앵커 측정은 스크롤 위치나 기기 사정으로도 실패한다. 그때 첫마디까지 같이 멈추면
  // 그 사람은 안내도 못 보고 아모라도 말을 걸지 않는, 가장 조용한 실패를 겪는다.
  // 웹은 같은 상황에서도 완료 이벤트를 쏴서 최소한 말풍선이 뜬다 — 실패 방향이
  // 두 플랫폼에서 반대여서는 안 된다.

  // 옛 코드처럼 "unavailable이면 즉시 반환"이 남아 있으면 안 된다.
  assert.doesNotMatch(loungeSource, /outcome === "unavailable"\) return;/);

  // 첫마디 생성과 말풍선은 완료 기록 가드보다 뒤, 그리고 가드 블록 **밖**에 있어야 한다.
  const handlerStart = loungeSource.indexOf(
    "const handleFirstRunTutorialClose",
  );
  assert.ok(handlerStart >= 0, "handleFirstRunTutorialClose를 찾지 못했습니다");

  const guardIndex = loungeSource.indexOf(
    'outcome !== "unavailable"',
    handlerStart,
  );
  const helloIndex = loungeSource.indexOf("buildAmoraFirstHello(", handlerStart);
  const bubbleIndex = loungeSource.indexOf("setAmoraBubble(", handlerStart);

  assert.ok(guardIndex > handlerStart, "완료 기록 가드를 찾지 못했습니다");
  assert.ok(helloIndex > guardIndex, "첫마디가 가드보다 앞에 있습니다");
  assert.ok(bubbleIndex > helloIndex, "말풍선이 첫마디보다 앞에 있습니다");

  // 가드는 완료 기록 한 줄만 감싼다 — 첫마디까지 삼키면 안 된다.
  const guardBlockEnd = loungeSource.indexOf("}", loungeSource.indexOf(
    "markFirstRunTutorialCompleted(",
    guardIndex,
  ));
  assert.ok(
    helloIndex > guardBlockEnd,
    "첫마디가 완료 기록 가드 블록 안에 갇혀 있습니다",
  );
});
