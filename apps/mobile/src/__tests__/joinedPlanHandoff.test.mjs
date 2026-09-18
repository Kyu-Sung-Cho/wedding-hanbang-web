// 파트너 합류 직후 라운지의 "이제 이 계획을 함께 봐요" 안내.
//
// 웹은 코드로 합류한 사람을 `/wedding/lounge?joined=1`로 보내고, 라운지가 그 표시를 보고
// 지금 함께 보게 된 계획(날짜·장소·총 예산·준비 진행)을 한 장으로 보여준다. 앱은 합류가
// 끝나면 표시 없이 라운지로 보냈고, 라운지에는 그 카드가 없었다 — 앱으로 합류한 사람은
// 방금 무엇을 함께 보게 됐는지 한 번도 듣지 못했다.
//
// 이 파일이 지키는 것:
//   1) 합류한 사람만 표시를 들고 라운지에 온다. 표시는 내비게이션 파라미터일 뿐 어디에도
//      저장하지 않는다.
//   2) 카드는 상대가 실제로 들어와 있을 때만 뜬다(웹과 같은 조건).
//   3) 문구·숫자 모양이 웹 카드와 같다. 저장·변경을 주장하지 않는다.
//   4) "함께 확인할 내용 찾기"는 아모라 입력창에 웹과 같은 초안만 놓는다.
//   5) "이 내용 확인했어요"는 표시를 지우는 것 말고는 아무것도 하지 않는다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function compile(relativePath, deps = {}, { jsx = false } = {}) {
  const compiled = ts.transpileModule(readSource(relativePath), {
    fileName: jsx ? "module.tsx" : "module.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(deps, specifier)) return deps[specifier];
    throw new Error(`unmocked dependency: ${specifier}`);
  });
  return module.exports;
}

const handoff = compile("../lib/joinedPlanHandoff.ts");
const entry = compile("../lib/amoraChatEntry.ts");
const webCompanion = compile("../../../web/src/lib/amora/dashboardCompanion.ts");
const webSummary = compile("../../../web/src/lib/amora/loungeSummary.ts", {
  "@/utils/scheduleEvents": { isValidScheduleYmd: () => true },
});
const webLounge = readSource("../../../web/src/app/(app)/lounge/page.tsx");
const loungeSource = readSource("../../app/(tabs)/lounge.tsx");
const onboardingSource = readSource("../../app/onboarding/index.tsx");
const componentSource = readSource("../components/lounge/JoinedPlanHandoff.tsx");
const handoffLibSource = readSource("../lib/joinedPlanHandoff.ts");

const JUST_JOINED = {
  weddingDate: "2027-05-15",
  venue: "라온 웨딩홀",
  totalBudget: 35_000_000,
  checklistDone: 12,
  checklistTotal: 40,
};

/* ─────────────────────────────────────────────
   (1) 합류한 사람만 표시를 들고 온다
   ───────────────────────────────────────────── */

test("only a couple join lands on the lounge with the joined marker", () => {
  assert.equal(handoff.loungeHrefAfterOnboarding("join"), "/(tabs)/lounge?joined=1");
  // 새로 만든 사람·아직 고르지 않은 값은 표시 없이 간다 — 합류하지 않았는데 "함께 봐요"를 들으면 안 된다.
  for (const action of ["create", null, undefined, "JOIN", ""]) {
    assert.equal(handoff.loungeHrefAfterOnboarding(action), "/(tabs)/lounge", String(action));
  }
  // 웹과 같은 이름·같은 값이다(`?joined=1`).
  const webRedirect = new URL(webCompanion.buildJoinedDashboardRedirect(), "https://hanbang.ai");
  assert.equal(webRedirect.searchParams.get(handoff.JOINED_PLAN_PARAM), "1");
  const nativeRedirect = new URL(handoff.loungeHrefAfterOnboarding("join"), "https://hanbang.ai");
  assert.equal(nativeRedirect.search, webRedirect.search);
});

test("the marker is read strictly — anything else is no marker", () => {
  assert.equal(handoff.hasJoinedPlanMarker("1"), true);
  // expo-router는 같은 이름이 여러 번 오면 배열을 준다. 첫 값만 본다.
  assert.equal(handoff.hasJoinedPlanMarker(["1", "0"]), true);
  for (const value of [undefined, null, "", "0", "true", 1, true, [], ["0"], {}]) {
    assert.equal(handoff.hasJoinedPlanMarker(value), false, JSON.stringify(value));
  }
});

test("onboarding sends the marker only through navigation, never through storage", () => {
  assert.match(onboardingSource, /router\.replace\(loungeHrefAfterOnboarding\(coupleAction\)\)/);
  // 합류 표시를 기기에 남기면 다음 실행에도 "방금 합류했어요"가 뜬다.
  for (const source of [handoffLibSource, componentSource]) {
    assert.doesNotMatch(source, /AsyncStorage|SecureStore|localStorage/);
  }
  assert.doesNotMatch(loungeSource, /(AsyncStorage|SecureStore)\.[a-zA-Z]+\([^)]*joined/i);
  assert.doesNotMatch(onboardingSource, /(AsyncStorage|SecureStore)\.[a-zA-Z]+\([^)]*joined/i);
});

/* ─────────────────────────────────────────────
   (2) 상대가 실제로 들어와 있을 때만
   ───────────────────────────────────────────── */

test("the card needs the marker and a partner that is confirmed to be there", () => {
  assert.equal(handoff.shouldShowJoinedPlanHandoff({ marker: true, partnerLinked: true }), true);
  // 확인하지 못했거나(undefined) 상대가 없으면 "함께 봐요"는 틀린 말이다.
  assert.equal(handoff.shouldShowJoinedPlanHandoff({ marker: true, partnerLinked: undefined }), false);
  assert.equal(handoff.shouldShowJoinedPlanHandoff({ marker: true, partnerLinked: false }), false);
  assert.equal(handoff.shouldShowJoinedPlanHandoff({ marker: false, partnerLinked: true }), false);
});

/* ─────────────────────────────────────────────
   (3) 웹 카드와 같은 문구, 저장 주장 없음
   ───────────────────────────────────────────── */

test("four cells in the web's order with the web's placeholders", () => {
  const view = handoff.buildJoinedPlanHandoffView(JUST_JOINED);
  assert.deepEqual(view.cells.map((cell) => cell.label), ["결혼식 날짜", "장소", "총 예산", "준비 진행"]);
  assert.deepEqual(view.cells.map((cell) => cell.value), [
    "2027년 5월 15일",
    "라온 웨딩홀",
    webSummary.formatLoungeWon(35_000_000),
    "30%",
  ]);
  assert.equal(view.cells[3].note, "12/40개 체크");

  const empty = handoff.buildJoinedPlanHandoffView({
    weddingDate: null,
    venue: "  ",
    totalBudget: 0,
    checklistDone: 0,
    checklistTotal: 0,
  });
  assert.deepEqual(empty.cells.map((cell) => cell.value), ["날짜 미정", "장소 미정", "미입력", "0%"]);
  assert.equal(empty.cells[3].note, "0/0개 체크");
  // 알아볼 수 없는 날짜를 지어내지 않는다.
  assert.equal(handoff.buildJoinedPlanHandoffView({ ...JUST_JOINED, weddingDate: "언젠가" }).cells[0].value, "날짜 미정");
});

test("budget amounts read exactly like the web lounge", () => {
  for (const amount of [1, 9_999, 10_000, 35_000_000, 35_005_000, 123_456_789, 1.5, -1, Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal(handoff.formatHandoffWon(amount), webSummary.formatLoungeWon(amount), String(amount));
  }
});

test("every visible sentence is the web card's sentence", () => {
  const view = handoff.buildJoinedPlanHandoffView(JUST_JOINED);
  const visible = [
    view.eyebrow,
    view.title,
    view.body,
    view.reviewLabel,
    view.dismissLabel,
    ...view.cells.map((cell) => cell.label),
    "날짜 미정",
    "장소 미정",
    "미입력",
    "개 체크",
  ];
  for (const sentence of visible) {
    assert.ok(webLounge.includes(sentence), `웹 라운지 카드에 «${sentence}» 가 없다`);
  }
  assert.equal(view.title, "이제 이 계획을 함께 봐요");
  assert.equal(view.dismissLabel, "이 내용 확인했어요");
});

test("the card never claims anything was saved or changed", () => {
  const view = handoff.buildJoinedPlanHandoffView(JUST_JOINED);
  assert.match(view.body, /새로 저장하거나 변경한 내용은 없어요/);
  const text = [view.eyebrow, view.title, view.body, view.reviewLabel, view.dismissLabel].join(" ");
  assert.doesNotMatch(text, /저장했|저장됐|반영했|반영됐|변경했어요|적용했|적용됐|바꿨어요/);
  // 아모라를 플래너·파트너로 부르지 않는다.
  assert.doesNotMatch(`${text} ${componentSource}`, /플래너|베타|미리 체험하기/);
});

/* ─────────────────────────────────────────────
   (4) 아모라로 가는 문
   ───────────────────────────────────────────── */

test("the review door drafts exactly the web's review question, into the shared Amora lane only", () => {
  assert.ok(entry.AMORA_CHAT_ENTRY_VALUES.includes("joined_plan_review"));
  assert.equal(entry.getAmoraChatEntryPrefill("joined_plan_review"), webCompanion.JOINED_PLAN_REVIEW_PROMPT);
  // 웹 문장 자체가 "변경하거나 담당자를 정하지 말고"를 요구한다 — 초안이 계획을 바꾸라고 하지 않는다.
  assert.match(entry.getAmoraChatEntryPrefill("joined_plan_review"), /계획을 변경하거나 담당자를 정하지 말고/);
});

/* ─────────────────────────────────────────────
   (5) 카드 렌더와 라운지 배선
   ───────────────────────────────────────────── */

function renderCard(view) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const token = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? new Proxy({}, { get: () => "#000000" }) : undefined) });
  const calls = [];
  const component = compile("../components/lounge/JoinedPlanHandoff.tsx", {
    react: {},
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Pressable: "Pressable", View: "View", StyleSheet: { create: (value) => value } },
    "@/components/ui/AppText": { Text: "Text" },
    "@/components/ui/AppUI": { AppText: "AppText", PrimaryButton: "PrimaryButton" },
    "@/components/ui/AmoraMark": { default: "AmoraMark" },
    "lucide-react-native": { HeartHandshake: "HeartHandshake" },
    "@hanbang/design-tokens": { colors: token, radius: token, spacing: new Proxy({}, { get: () => 8 }), amoraIdentity: token },
  }, { jsx: true });
  const tree = component.default({
    view,
    onReview: () => calls.push("review"),
    onDismiss: () => calls.push("dismiss"),
  });
  const nodes = [];
  const texts = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === "string" || typeof node === "number") return void texts.push(String(node));
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    walk(node.props.children);
  })(tree);
  return { nodes, texts, calls };
}

function flatStyle(style) {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatStyle));
  if (typeof style === "function") return flatStyle(style({ pressed: false }));
  return style ?? {};
}

test("the card shows the four cells and two actions that each do one thing", () => {
  const view = handoff.buildJoinedPlanHandoffView(JUST_JOINED);
  const { nodes, texts, calls } = renderCard(view);
  for (const expected of [view.title, view.body, ...view.cells.flatMap((cell) => [cell.label, cell.value]), "12/40개 체크"]) {
    assert.ok(texts.includes(expected), `카드에 «${expected}» 가 보이지 않는다`);
  }

  const review = nodes.find((node) => node.type === "PrimaryButton");
  assert.ok(review, "아모라로 가는 주 행동이 없다");
  assert.equal(review.props.tone, "rose");
  assert.ok(texts.includes(view.reviewLabel));
  assert.match(review.props.accessibilityHint ?? "", /아모라/);
  review.props.onPress();

  const dismiss = nodes.find((node) => node.type === "Pressable");
  assert.ok(dismiss, "확인 버튼이 없다");
  assert.equal(dismiss.props.accessibilityRole, "button");
  assert.ok(flatStyle(dismiss.props.style).minHeight >= 44, "확인 버튼 누를 자리가 44보다 작다");
  dismiss.props.onPress();

  assert.deepEqual(calls, ["review", "dismiss"]);
  // 새 색을 지어내지 않는다 — 토큰만 쓴다.
  assert.doesNotMatch(componentSource, /#[0-9A-Fa-f]{3,8}\b/);
});

function extractCallback(source, name) {
  const tree = ts.createSourceFile("lounge.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer
      && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(tree) === "useCallback") {
      found = node.initializer.arguments[0].getText(tree);
    }
    ts.forEachChild(node, visit);
  })(tree);
  assert.ok(found, `${name} 를 찾지 못했다`);
  return ts.transpileModule(`const run = ${found};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

function runCallback(name) {
  const events = [];
  const router = {
    push: (route) => events.push(["push", route]),
    replace: (route) => events.push(["replace", route]),
    navigate: (route) => events.push(["navigate", route]),
    setParams: (params) => events.push(["setParams", params]),
  };
  const bindings = { router, JOINED_PLAN_PARAM: handoff.JOINED_PLAN_PARAM };
  const run = new Function("bindings", `with (bindings) { ${extractCallback(loungeSource, name)} return run; }`)(bindings);
  run();
  return events;
}

test("the lounge wires the card to the marker, the partner check and the web's review door", () => {
  assert.match(loungeSource, /useLocalSearchParams/);
  assert.match(loungeSource, /hasJoinedPlanMarker\(routeParams\[JOINED_PLAN_PARAM\]\)/);
  assert.match(loungeSource, /shouldShowJoinedPlanHandoff\(\{/);
  assert.match(loungeSource, /partnerLinked: data\.partnerLinked/);
  // 장소 칸을 채우려면 장소를 읽어야 한다.
  assert.match(loungeSource, /\.select\("wedding_date, venue, total_budget, progress"\)/);
  // 합류 안내가 떠 있으면 첫 도착 카드는 접는다 — 환영 카드 두 장이 겹치지 않게(웹과 같다).
  assert.match(loungeSource, /firstArrival=\{\s*joinedPlanHandoffView \? null/);

  assert.deepEqual(runCallback("handleReviewJoinedPlan"), [["push", "/(tabs)/chat?entry=joined_plan_review"]]);
  // 확인은 표시만 지운다. 아무것도 저장하지 않고 어디로도 보내지 않는다.
  assert.deepEqual(runCallback("handleDismissJoinedPlan"), [["setParams", { [handoff.JOINED_PLAN_PARAM]: undefined }]]);
});
