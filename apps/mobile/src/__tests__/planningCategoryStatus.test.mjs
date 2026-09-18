import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 체크리스트 분야 상태를 웹과 같은 규칙으로 읽는다.
 *
 * 온보딩·라운지·아모라는 항목을 건드리지 않고 **분야 상태만** "완료"로 저장할 수 있다
 * (`isPlanningChecklistStatusDeclared` 의 주석). 웹 체크리스트와 앱 라운지는 공유 규칙
 * (`resolvePlanningChecklistStatus`)으로 그 선언을 존중했는데, 앱 체크리스트 화면만 항목을
 * 다시 세어 상태를 만들었다. 그래서 다른 곳에서 "완료"라고 한 분야가 이 화면에서만
 * **`0/9 완료 · 아직`** 으로 보였다.
 *
 * 이제 같은 규칙으로 읽고, 웹 카드처럼 말한다.
 *   - 선언만 있는 분야: 「완료로 표시함 · 항목은 확인 전」
 *   - 안 하는 분야: 「진행률과 알림에서 제외됨」
 *   - 나머지: 「3/9개 완료 · 준비 중」과 분야별 진행 막대
 * 머리 요약에는 웹과 같은 「N개 완료 · M개 남음」과 「N개 분야는 진행률에서 제외했어요」.
 */
function compile(relative, deps = {}, { jsx = false } = {}) {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
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
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const planningChecklist = compile("../../../../packages/shared/src/utils/planningChecklist.ts");
const { CHECKLIST_MAP } = compile("../../../../packages/shared/src/constants/weddingPlanning.ts");
const { PREPARATION_PROGRESS_STATUS_LABELS } = compile(
  "../../../../packages/shared/src/constants/preparationProgress.ts",
  { "./weddingPlanning": { PLANNING_CATEGORY_LABELS: {} } },
);
const view = compile("../lib/planningCategoryView.ts", {
  "@hanbang/shared/utils": planningChecklist,
  "@hanbang/shared/constants": { PREPARATION_PROGRESS_STATUS_LABELS },
});
const webParticles = compile("../../../web/src/lib/korean/particles.ts");

const venue = CHECKLIST_MAP.venue;
const withDone = (template, doneCount) => template.items.map((item, index) => ({ id: item.id, label: item.label, done: index < doneCount }));

test("다른 곳에서 완료라고 한 분야는 완료로 읽고, 선언이라고 표시한다", () => {
  const read = view.readPlanningCategoryView(venue.items, { category: "venue", status: "completed" });
  assert.equal(read.status, "completed", "0개 체크라고 '아직'으로 되돌리면 안 된다");
  assert.equal(read.declared, true);
  assert.equal(read.items.length, venue.items.length);
  assert.equal(read.items.filter((item) => item.done).length, 0, "선언이 항목 체크를 지어내지 않는다");

  const inProgress = view.readPlanningCategoryView(venue.items, { status: "in_progress", checklist: [] });
  assert.equal(inProgress.status, "in_progress");
  assert.equal(inProgress.declared, true);
});

test("항목 기록이 있으면 항목에서 상태를 만든다 — 낡은 완료도 고친다", () => {
  const partial = view.readPlanningCategoryView(venue.items, { status: "not_started", checklist: withDone(venue, 3) });
  assert.equal(partial.status, "in_progress");
  assert.equal(partial.declared, false);

  // 템플릿에 항목이 늘었는데 저장값은 예전 항목을 다 끝낸 '완료'다.
  const stale = view.readPlanningCategoryView(venue.items, {
    status: "completed",
    checklist: withDone(venue, venue.items.length).slice(0, -1),
  });
  assert.equal(stale.status, "in_progress");
  assert.equal(stale.declared, false);
});

test("안 하는 분야는 언제나 안 하는 분야다", () => {
  const skipped = view.readPlanningCategoryView(venue.items, { status: "not_applicable", checklist: withDone(venue, 2) });
  assert.equal(skipped.status, "not_applicable");
  assert.equal(skipped.declared, false);
  assert.equal(skipped.items.filter((item) => item.done).length, 2, "이전 체크는 남아 있다");
});

test("옛 플랫 불리언 모양도 항목으로 읽는다", () => {
  const [first, second] = venue.items;
  const flat = view.readPlanningCategoryView(venue.items, { [first.id]: true, [second.id]: false, budget: 1000 });
  assert.equal(flat.status, "in_progress");
  assert.equal(flat.declared, false);
  assert.equal(flat.items.find((item) => item.id === first.id)?.done, true);
});

test("저장값이 이상해도 항목 템플릿과 '아직'으로 읽는다", () => {
  for (const saved of [undefined, null, "completed", 3, [], { status: "bogus" }, { checklist: "x" }]) {
    const read = view.readPlanningCategoryView(venue.items, saved);
    assert.equal(read.status, "not_started", JSON.stringify(saved));
    assert.equal(read.declared, false);
    assert.equal(read.items.length, venue.items.length);
  }
  const partlyBroken = view.readPlanningCategoryView(venue.items, {
    checklist: [null, { id: 3 }, { id: venue.items[0].id, done: true }],
  });
  assert.equal(partlyBroken.items.find((item) => item.id === venue.items[0].id)?.done, true);
  assert.equal(partlyBroken.items.length, venue.items.length, "id 없는 항목을 목록에 끼워 넣지 않는다");
});

test("선언 문구의 조사는 웹과 같다", () => {
  for (const status of ["completed", "in_progress"]) {
    const label = PREPARATION_PROGRESS_STATUS_LABELS[status];
    assert.equal(view.declaredStatusNote(status), `${label}${webParticles.directionParticle(label)} 표시함`);
  }
  assert.equal(view.declaredStatusNote("completed"), "완료로 표시함");
  assert.equal(view.declaredStatusNote("in_progress"), "준비 중으로 표시함");
});

test("머리 요약은 웹과 같은 말이다", () => {
  const web = read("../../../web/src/components/app/checklist/ChecklistContent.tsx");
  assert.match(web, /\{summary\.done\}개 완료 · \{remaining\}개 남음/);
  assert.match(web, /\{summary\.skippedCategories\}개 분야는 진행률에서 제외했어요/);

  assert.deepEqual(view.planningChecklistSummaryLines({ done: 12, total: 180, skippedCategories: 2 }), {
    counts: "12개 완료 · 168개 남음",
    skipped: "2개 분야는 진행률에서 제외했어요",
  });
  assert.deepEqual(view.planningChecklistSummaryLines({ done: 0, total: 0, skippedCategories: 0 }), {
    counts: "0개 완료 · 0개 남음",
    skipped: null,
  });
});

function renderCard(stats) {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const token = new Proxy({}, { get: (_target, key) => (typeof key === "string" ? new Proxy({}, { get: () => "#000000" }) : undefined) });
  const card = compile("../components/checklist/ChecklistCategoryCard.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { View: "View", Pressable: "Pressable", StyleSheet: { create: (value) => value } },
    "@/components/ui/AppText": { Text: "Text" },
    "@hanbang/design-tokens": { colors: token },
    "@hanbang/shared/constants": { PREPARATION_PROGRESS_STATUS_LABELS },
    "@/lib/planningCategoryView": view,
  }, { jsx: true });
  const tree = card.default({ label: venue.label, stats, onPress: () => {} });
  const texts = [];
  const nodes = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === "string") return void texts.push(node);
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    walk(node.props.children);
  })(tree);
  return { texts, nodes, tree };
}

const statsFor = (template, saved) => {
  const read = view.readPlanningCategoryView(template.items, saved);
  const done = read.items.filter((item) => item.done).length;
  const total = read.items.length;
  const skipped = read.status === "not_applicable";
  return {
    done,
    total,
    skipped,
    declared: read.declared,
    status: read.status,
    percent: skipped || total === 0 ? 0 : Math.round((done / total) * 100),
  };
};

test("카드: 선언만 있는 완료는 '0/N · 아직'이 아니라 '완료로 표시함 · 항목은 확인 전'", () => {
  const { texts } = renderCard(statsFor(venue, { status: "completed" }));
  assert.ok(texts.includes("완료로 표시함"), texts.join(" / "));
  assert.ok(texts.includes("항목은 확인 전"), texts.join(" / "));
  assert.ok(!texts.some((text) => /^0\/\d+/.test(text)), texts.join(" / "));
  assert.ok(!texts.includes(PREPARATION_PROGRESS_STATUS_LABELS.not_started), texts.join(" / "));
});

test("카드: 안 하는 분야는 진행률과 알림에서 빠졌다고 말한다", () => {
  const { texts } = renderCard(statsFor(venue, { status: "not_applicable" }));
  assert.ok(texts.includes("진행률과 알림에서 제외됨"), texts.join(" / "));
  assert.ok(texts.includes(PREPARATION_PROGRESS_STATUS_LABELS.not_applicable), texts.join(" / "));
});

test("카드: 항목 기록이 있으면 개수·상태·진행 막대를 그린다", () => {
  const stats = statsFor(venue, { checklist: withDone(venue, 3) });
  const { texts, nodes } = renderCard(stats);
  assert.ok(texts.includes(`3/${venue.items.length}개 완료`), texts.join(" / "));
  assert.ok(texts.includes(PREPARATION_PROGRESS_STATUS_LABELS.in_progress), texts.join(" / "));
  const bar = nodes.find((node) => node.props.accessibilityRole === "progressbar");
  assert.ok(bar, "분야별 진행 막대가 없다");
  assert.deepEqual(bar.props.accessibilityValue, { min: 0, max: 100, now: stats.percent });
  const fill = nodes.find((node) => node.props.testID === "checklist-category-progress-fill");
  const fillStyle = Object.assign({}, ...[fill.props.style].flat().filter(Boolean));
  assert.equal(fillStyle.width, `${stats.percent}%`);
});

test("카드: 선언·제외 분야는 퍼센트 막대를 그리지 않는다", () => {
  for (const saved of [{ status: "completed" }, { status: "not_applicable" }]) {
    const { nodes } = renderCard(statsFor(venue, saved));
    assert.equal(nodes.find((node) => node.props.accessibilityRole === "progressbar"), undefined, JSON.stringify(saved));
  }
});

test("카드를 누르면 분야 시트가 열리고, 이름과 상태를 함께 읽어 준다", () => {
  let opened = 0;
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const card = compile("../components/checklist/ChecklistCategoryCard.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { View: "View", Pressable: "Pressable", StyleSheet: { create: (value) => value } },
    "@/components/ui/AppText": { Text: "Text" },
    "@hanbang/design-tokens": { colors: new Proxy({}, { get: () => new Proxy({}, { get: () => "#000000" }) }) },
    "@hanbang/shared/constants": { PREPARATION_PROGRESS_STATUS_LABELS },
    "@/lib/planningCategoryView": view,
  }, { jsx: true });
  const tree = card.default({ label: venue.label, stats: statsFor(venue, { status: "completed" }), onPress: () => { opened += 1; } });
  const pressables = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (node.type === "Pressable") pressables.push(node);
    walk(node.props.children);
  })(tree);
  assert.equal(pressables.length, 1);
  assert.equal(pressables[0].props.accessibilityLabel, `${venue.label} 체크리스트 열기`);
  assert.equal(pressables[0].props.accessibilityValue?.text, "완료로 표시함 · 항목은 확인 전");
  pressables[0].props.onPress();
  assert.equal(opened, 1);
});

test("체크리스트 화면이 공유 규칙으로 읽고 카드와 요약을 그린다", () => {
  const schedule = read("../../app/schedule/index.tsx");
  const loadData = /const loadData = useCallback\([\s\S]*?\n {2}\}, \[/.exec(schedule)?.[0] ?? "";
  assert.ok(loadData, "loadData 를 찾지 못했다");
  assert.match(loadData, /readPlanningCategoryView\(cat\.items, prog\[cat\.key\]\)/);
  assert.doesNotMatch(loadData, /calculatePlanningChecklistStatus\(checkItems\)/, "항목만 다시 세면 선언이 '아직'으로 뒤집힌다");
  assert.match(schedule, /<ChecklistCategoryCard/);
  assert.match(schedule, /planningChecklistSummaryLines\(/);
  // 카드와 시트가 같은 선언 판정을 받는다 — 카드만 고치면 시트가 「0/9 완료 · 0%」를 말한다.
  assert.match(schedule, /declared: categories\.find\(\(category\) => category\.key === key\)\?\.declared === true/);
});

test("시트: 선언만 있는 분야는 개수·퍼센트 대신 '분야 상태로 표시함'을 말한다(웹 모달과 같다)", () => {
  const webModal = read("../../../web/src/components/app/schedule/CategoryChecklistModal.tsx");
  const webLine = /declared \? "(분야 상태로 표시함 · 항목은 확인 전)"/.exec(webModal)?.[1];
  assert.ok(webLine, "웹 모달의 선언 문구를 찾지 못했다");

  const jsx = (type, props) => ({ type, props: props ?? {} });
  const token = new Proxy({}, { get: (_target, key) => (key === "radius" ? 12 : typeof key === "string" ? new Proxy({}, { get: () => "#000000" }) : undefined) });
  const sheet = compile("../components/checklist/CategoryChecklistSheet.tsx", {
    react: { useMemo: (factory) => factory() },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { Modal: "Modal", View: "View", ScrollView: "ScrollView", Pressable: "Pressable", StyleSheet: { create: (value) => value } },
    "@/components/ui/AppText": { Text: "Text" },
    "lucide-react-native": { Check: "Check", Ban: "Ban", Sparkle: "Sparkle", BookOpen: "BookOpen" },
    "@hanbang/design-tokens": { amoraIdentity: token, colors: token },
    "@hanbang/shared/constants": {
      CHECKLIST_MAP,
      checklistItemTag: () => undefined,
      checklistNoteSourceChip: () => undefined,
      groupChecklistItems: (_key, list) => [{ title: "", items: list }],
      labelWithoutConditionSuffix: (label) => label,
      mannersGuideForCategory: () => undefined,
      PREPARATION_PROGRESS_STATUS_LABELS,
    },
    "@/components/ui/AmoraMark": { default: "AmoraMark" },
    "./ChecklistProgressRing": { default: "ChecklistProgressRing" },
    "./ChecklistItemTag": { default: "ChecklistItemTag" },
  }, { jsx: true });

  const render = (stats) => {
    const read = view.readPlanningCategoryView(venue.items, stats.saved);
    const tree = sheet.default({
      visible: true,
      categoryKey: "venue",
      label: venue.label,
      items: read.items,
      tip: "",
      stats: stats.value,
      onClose: () => {},
      onToggleItem: () => {},
      onToggleApplicability: () => {},
      onOpenGuide: () => {},
      onOpenSource: () => {},
      onAskAmora: () => {},
    });
    const texts = [];
    const nodes = [];
    (function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node === "string") return void texts.push(node);
      if (!node || typeof node !== "object") return;
      nodes.push(node);
      walk(node.props.children);
    })(tree);
    return { texts, nodes };
  };

  const counted = () => render({ saved: { checklist: withDone(venue, 3) }, value: statsFor(venue, { checklist: withDone(venue, 3) }) });
  const declared = render({ saved: { status: "completed" }, value: statsFor(venue, { status: "completed" }) });
  assert.ok(declared.texts.includes(webLine), declared.texts.join(" / "));
  assert.ok(declared.texts.includes(PREPARATION_PROGRESS_STATUS_LABELS.completed));
  assert.ok(!declared.texts.some((text) => /^0\/\d+ 완료/.test(text)), declared.texts.join(" / "));
  const ring = declared.nodes.find((node) => typeof node.props.centerText === "string");
  assert.equal(ring.props.centerText, "—", "선언만 있는 분야의 고리는 0%가 아니라 줄표다");
  assert.ok(!declared.nodes.some((node) => node.props.kind === "다음 할 일"), "완료로 표시한 분야에 다음 할 일을 가리키지 않는다");
  assert.ok(counted().nodes.some((node) => node.props.kind === "다음 할 일"), "항목을 세는 분야는 다음 할 일을 가리킨다 — 위 단언이 헛돌지 않는지");

  const countedView = counted();
  assert.ok(countedView.texts.some((text) => text.startsWith(`3/${venue.items.length} 완료 · `)), countedView.texts.join(" / "));
  assert.ok(!countedView.texts.includes(webLine));
});

test("완료로 표시한 분야는 「이번 주 확인 제안」에 올리지 않는다(웹 임박 알림과 같다)", () => {
  // 웹 임박 알림(`imminentChecklist.ts`)은 공유 규칙으로 읽은 상태가 완료면 건너뛴다. 앱 제안은
  // 퍼센트만 봐서, 카드는 「완료로 표시함」인데 바로 위 제안은 같은 분야를 「기본 확인 시점 지남」이라고 했다.
  const web = read("../../../web/src/utils/imminentChecklist.ts");
  assert.match(web, /if \(status === "completed" \|\| status === "not_applicable"\) continue;/);

  const due = compile("../../../../packages/shared/src/utils/checklistItemDue.ts");
  const { CATEGORY_CHECKLISTS } = compile("../../../../packages/shared/src/constants/weddingPlanning.ts");
  const { buildWeeklyChecklistActions } = compile("../lib/checklistWeeklyActions.ts", { "@hanbang/shared/utils": due });
  const declared = statsFor(venue, { status: "completed" });
  const actionsFor = (state) => buildWeeklyChecklistActions(
    CATEGORY_CHECKLISTS,
    (key) => (key === "venue" ? state : { items: [], skipped: true, percent: 0 }),
    venue.ddayDeadline - 30,
    CATEGORY_CHECKLISTS.length,
  );
  const items = view.readPlanningCategoryView(venue.items, { status: "completed" }).items;
  assert.equal(actionsFor({ items, skipped: false, percent: declared.percent }).length, 1, "전제: 퍼센트만 보면 제안에 오른다");
  assert.deepEqual(actionsFor({ items, skipped: false, percent: declared.percent, completed: true }), []);

  const schedule = read("../../app/schedule/index.tsx");
  assert.match(schedule, /completed: stats\.status === "completed"/);
});
