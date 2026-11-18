// 아모라로 가는 문 네 개 — 목적지가 같아도 들고 가는 것이 달라야 한다.
//
// 라운지에는 아모라로 가는 문이 네 개 있다: 우하단 버튼, 전폭 카드, 첫 도착 카드의 CTA,
// 하단 탭. 예전에는 전부 파라미터 없는 같은 push였고, 대화 화면에는 진입 파라미터를 읽는
// 코드가 아예 없었다. 방금 "이제 막 시작했어요"를 고르고 그 카드를 누른 사람과 무작정 탭을
// 누른 사람이 완전히 같은 빈 화면을 만났다는 뜻이다.
//
// 이 파일이 지키는 것은 문구가 아니라 **문마다 다른 것을 들고 간다**는 사실과,
// 그 값이 실제로 입력창까지 도착한다는 배선이다.
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

function compileCommonJs(source) {
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
    () => {
      throw new Error("unexpected dependency");
    },
  );
  return module.exports;
}

const entry = compileCommonJs(readSource("../lib/amoraChatEntry.ts"));

const loungeSource = readSource("../../app/(tabs)/lounge.tsx");
const chatSource = readSource("../../app/(tabs)/chat.tsx");
const arrivalSource = readSource("../components/lounge/LoungeFirstArrival.tsx");

/* ─────────────────────────────────────────────
   (a) 문마다 다른 초안
   ───────────────────────────────────────────── */

test("every entry carries its own draft, and no two doors carry the same one", () => {
  const prefills = entry.AMORA_CHAT_ENTRY_VALUES.map((value) =>
    entry.getAmoraChatEntryPrefill(value),
  );

  for (const prefill of prefills) {
    assert.equal(typeof prefill, "string");
    assert.ok(prefill.length > 0);
  }
  assert.equal(new Set(prefills).size, prefills.length);
  assert.ok(entry.AMORA_CHAT_ENTRY_VALUES.length >= 3);
});

test("the draft is the user's own words — it judges nothing and recommends no vendor", () => {
  for (const value of entry.AMORA_CHAT_ENTRY_VALUES) {
    const prefill = entry.getAmoraChatEntryPrefill(value);
    // 초안은 사람이 할 말이지 아모라의 판정이 아니다. 진척을 단정하거나 업체·가격을
    // 먼저 꺼내면, 사람이 쓴 적 없는 주장이 그 사람 이름으로 전송될 수 있다.
    for (const banned of ["늦", "업체", "가격", "계약", "추천", "플래너", "%"]) {
      assert.ok(
        !prefill.includes(banned),
        `진입 초안 "${value}"에 "${banned}"가 들어 있습니다`,
      );
    }
  }
});

/* ─────────────────────────────────────────────
   (b) 모르는 값은 아무 일도 하지 않는다
   ───────────────────────────────────────────── */

test("an entry the app does not know leaves the composer empty", () => {
  // 이 값은 앱 밖(딥링크·손으로 고친 주소·예전 판이 만든 링크)에서 온다.
  assert.equal(entry.resolveAmoraChatEntry("lounge_time_machine"), null);
  assert.equal(entry.resolveAmoraChatEntry(""), null);
  assert.equal(entry.resolveAmoraChatEntry(undefined), null);
  assert.equal(entry.resolveAmoraChatEntry(null), null);
  assert.equal(entry.resolveAmoraChatEntry(42), null);
  assert.equal(entry.resolveAmoraChatEntry({}), null);
  assert.equal(entry.getAmoraChatEntryPrefill("lounge_time_machine"), null);

  // expo-router는 같은 이름이 여러 번 오면 배열을 준다. 첫 값만 본다.
  assert.equal(entry.resolveAmoraChatEntry(["lounge_fab", "lounge_card"]), "lounge_fab");
  assert.equal(entry.resolveAmoraChatEntry([]), null);
});

/* ─────────────────────────────────────────────
   (c) 네 개의 문이 실제로 다른 것을 들고 간다
   ───────────────────────────────────────────── */

test("the doors into Amora no longer open the same empty screen", () => {
  // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 홈은 `InvitationHome` 이고 예전 라운지 본문의
  // 히어로 CTA(`WeddingHomeExperience`)를 그리지 않는다. 그리지 않는 문은 문이 아니라 세지 않는다.
  // 홈에 남은 문: 아모라 버튼(FAB)과 합류 직후 안내, 첫 도착 카드.
  assert.doesNotMatch(loungeSource, /<WeddingHomeExperience\b/);
  const doors = new Map([
    ["FAB·합류 안내", loungeSource],
    ["첫 도착 CTA", arrivalSource],
  ]);

  const used = [];
  for (const [name, source] of doors) {
    const matches = [...source.matchAll(/\/\(tabs\)\/chat\?entry=([a-z_]+)/g)].map(
      (match) => match[1],
    );
    assert.ok(matches.length > 0, `${name}가 아모라로 가는 문에 맥락이 없습니다`);
    for (const value of matches) {
      assert.ok(
        entry.AMORA_CHAT_ENTRY_VALUES.includes(value),
        `${name}가 대화 화면이 모르는 진입구 "${value}"를 씁니다`,
      );
      used.push(value);
    }
  }
  // 문이 여럿인데 같은 것을 들고 가면, 문을 여러 개 둔 값을 하나도 못 한다.
  assert.equal(new Set(used).size, used.length, "두 문이 같은 맥락을 들고 갑니다");
  // 상시로 겹치던 전폭 카드를 지운 뒤의 수다. 늘어나는 건 괜찮지만, 늘릴 때마다
  // 그 문이 무엇을 다르게 들고 가는지 답할 수 있어야 한다.
  assert.ok(used.length >= 3);

  // 파라미터 없는 예전 push가 남아 있으면 그 문은 다시 같은 빈 화면으로 떨어진다.
  for (const [name, source] of doors) {
    assert.doesNotMatch(
      source,
      /router\.push\("\/\(tabs\)\/chat"\)/,
      `${name}에 맥락 없는 옛 경로가 남아 있습니다`,
    );
  }

  // 네 번째 문인 하단 탭에는 일부러 키를 붙이지 않는다. "그냥 이야기하러 왔다"도 맥락이고,
  // 탭에 초안을 얹으면 대화를 열 때마다 남의 말이 입력창에 들어앉는다.
  assert.ok(!entry.AMORA_CHAT_ENTRY_VALUES.includes("tab"));
});

/* ─────────────────────────────────────────────
   (d) 대화 화면이 실제로 받아서 입력창에 놓는다
   ───────────────────────────────────────────── */

test("the conversation actually reads the entry and drafts it into the chosen Amora lane", () => {
  // 예전에는 useLocalSearchParams가 이 파일에 0건이었다 — 문이 무엇을 들고 오든 읽는
  // 쪽이 없으니 전부 같은 화면이었다.
  assert.match(chatSource, /useLocalSearchParams/);
  assert.match(chatSource, /getAmoraChatEntryPrefill\(entryParam\)/);
  assert.match(chatSource, /AMORA_CHAT_ENTRY_PARAM/);

  // 고른 칸의 아모라 입력칸에만 놓는다. 상대에게 쓰는 칸에 진입 문구가 섞이면 사람은 자기가
  // 쓰지 않은 말을 상대에게 보낼 뻔한다. 웹도 같은 규칙이다.
  // 2026-09-27: 예전에는 함께 대화 입력칸에만 놓았다. 진입구가 칸을 정하지 않게 되면서(처음 여는
  // 사람은 선택 카드, 기억이 있으면 그 칸) '나만 (상담)'으로 열린 사람의 초안이 보이지 않는 함께 대화
  // 입력칸에 남았다. 그래서 칸이 정해진 뒤 그 칸의 아모라 입력칸에 놓는다. 동작은 아래 효과 검사가 잰다.
  assert.match(
    chatSource,
    /const lane = activeScope === "private" \? "private_ai" : "shared_ai";\s*setInputByLane\(\(current\) =>\s*current\[lane\]\.trim\(\) \? current : updateAmoraChatLaneRecord\(current, lane, prefill\),/,
  );
  assert.doesNotMatch(
    chatSource,
    /updateAmoraChatLaneRecord\(current, "shared_partner", prefill\)/,
  );

  // 한 번만 놓는다. 다시 놓으면 사람이 지운 초안이 화면이 다시 그려질 때마다 되살아난다.
  assert.match(chatSource, /entryPrefillAppliedRef\.current = true;/);
  assert.match(chatSource, /if \(entryPrefillAppliedRef\.current\) return;/);

  // 초안은 입력창에 놓일 뿐, 사람 대신 전송되지 않는다.
  assert.doesNotMatch(chatSource, /getAmoraChatEntryPrefill[\s\S]{0,200}sendMessage/);
});

test("the entry adds no new dependency", () => {
  const packageJson = JSON.parse(readSource("../../package.json"));
  const declared = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);

  const specifiers = [...readSource("../lib/amoraChatEntry.ts").matchAll(/from "([^"]+)"/g)];
  // 이 모듈은 아무것도 import하지 않는다 — 문구와 키만 들고 있다.
  assert.equal(specifiers.length, 0);
  assert.ok(declared.has("expo-router"));
});

test("the actual entry effect waits until the session reset finishes and the lane is decided, and preserves an existing draft", () => {
  const tree = ts.createSourceFile("chat.tsx", chatSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect" && node.arguments[0]?.getText(tree).includes("entryPrefillAppliedRef.current")) effect = node.arguments[0].getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(effect);
  const compiledEffect = ts.transpileModule(`const run = ${effect};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const setup = ({ existingDraft = "", activeScope = "shared" } = {}) => {
    const other = activeScope === "private" ? "shared_ai" : "private_ai";
    const own = activeScope === "private" ? "private_ai" : "shared_ai";
    const state = { shared_ai: "", private_ai: "", shared_partner: "", [own]: existingDraft, [other]: "다른 칸의 초안" };
    const bindings = { initialLoaded: false, userId: null, coupleId: null, chatLoadError: null,
      laneOpening: "decided", activeScope,
      entryParam: "lounge_fab", entryPrefillAppliedRef: { current: false }, getAmoraChatEntryPrefill: entry.getAmoraChatEntryPrefill,
      updateAmoraChatLaneRecord: (current, lane, value) => ({ ...current, [lane]: value }),
      setInputByLane: update => Object.assign(state, update(state)),
    };
    const run = new Function("bindings", `with (bindings) { ${compiledEffect} return run; }`)(bindings);
    return { state, bindings, run, own, other };
  };
  for (const activeScope of ["shared", "private"]) {
    for (const existingDraft of ["", "이미 쓰고 있던 질문"]) {
      const { state, bindings, run, own, other } = setup({ existingDraft, activeScope });
      run();
      assert.equal(bindings.entryPrefillAppliedRef.current, false, "do not consume the entry before the loader clears screen state");
      bindings.initialLoaded = true; bindings.userId = "viewer"; bindings.coupleId = "couple";
      run();
      assert.equal(state[own], existingDraft || entry.getAmoraChatEntryPrefill("lounge_fab"), `${activeScope}: 고른 칸에 초안이 없다`);
      assert.equal(state[other], "다른 칸의 초안", `${activeScope}: 고르지 않은 칸을 건드렸다`);
      assert.equal(state.shared_partner, "", "상대에게 쓰는 칸에 진입 문구가 들어갔다");
    }
  }
  // 칸을 정하기 전(선택 카드가 떠 있거나 기억을 읽는 중)에는 놓지도 소비하지도 않는다.
  // 2026-09-27: 예전에는 칸과 상관없이 곧바로 함께 대화에 놓아, '나만 (상담)'을 고른 사람에게는 보이지 않았다.
  for (const laneOpening of ["choosing", "waiting"]) {
    const { state, bindings, run } = setup();
    state.private_ai = "";
    Object.assign(bindings, { initialLoaded: true, userId: "viewer", coupleId: "couple", laneOpening });
    run();
    assert.equal(bindings.entryPrefillAppliedRef.current, false, `${laneOpening}: 칸을 정하기 전에 소비했다`);
    assert.equal(state.shared_ai, "", `${laneOpening}: 칸을 정하기 전에 함께 대화에 놓았다`);
    bindings.laneOpening = "decided"; bindings.activeScope = "private";
    run();
    assert.equal(state.private_ai, entry.getAmoraChatEntryPrefill("lounge_fab"), `${laneOpening}: 고른 '나만' 칸에 초안이 없다`);
    assert.equal(state.shared_ai, "");
  }
});
