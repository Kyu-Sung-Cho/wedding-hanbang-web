// 라운지 할 일에서 아모라에게 묻기 (2026-11-13 파운더 결정: 메인은 웨딩 라운지와 아모라 둘,
// 나머지 기능은 아모라 뒤로).
//
// 지키는 것 네 가지:
//   1. 넣는 질문은 웹 라운지가 넣는 문장과 같다(같은 할 일에 같은 말).
//   2. 질문 문장은 주소에 싣지 않는다. 주소에는 번호만 가고 문장은 앱 안에서 건넨다.
//   3. 건넨 질문은 한 번만, 같은 사람에게만, 그 번호로만 받는다.
//   4. 대화 화면은 질문을 입력칸에 넣어 둘 뿐 보내지 않는다. 쓰던 글은 덮지 않는다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

function compile(source, modules = {}) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", outputText)(module.exports, module, (specifier) => {
    if (Object.hasOwn(modules, specifier)) return modules[specifier];
    throw new Error(`unexpected dependency ${specifier}`);
  });
  return module.exports;
}

const entry = compile(read("../lib/amoraChatEntry.ts"));
// 모듈 안에 건넬 질문 한 칸이 있어서, 시험마다 새로 올려 서로 섞이지 않게 한다.
const freshAsk = () => compile(read("../lib/loungeAmoraAsk.ts"), { "./amoraChatEntry": entry });

const chatSource = read("../../app/(tabs)/chat.tsx");
const loungeSource = read("../../app/(tabs)/lounge.tsx");
const homeSource = read("../components/dashboard/WeddingHomeExperience.tsx");
const webLoungeSource = read("../../../web/src/app/(app)/lounge/LoungeHubSections.tsx");

/* ─────────────────────────────────────────────
   1. 웹 라운지와 같은 말
   ───────────────────────────────────────────── */

/** 웹 파일에서 `loungeAmoraPrompt` 를 그대로 꺼내 돌린다. 못 찾으면 실패한다(조용히 넘어가지 않는다). */
function loadWebLoungePrompt() {
  const file = ts.createSourceFile("LoungeHubSections.tsx", webLoungeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = null;
  file.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "loungeAmoraPrompt") found = node;
  });
  assert.ok(found, "웹 라운지에서 loungeAmoraPrompt 를 찾지 못했다. 이름이 바뀌었으면 이 대조도 옮겨야 한다");
  const declaration = found.getText(file).replace(/^export\s+/, "");
  const { outputText } = ts.transpileModule(`${declaration}\nmodule.exports = loungeAmoraPrompt;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("module", outputText)(module);
  assert.equal(typeof module.exports, "function");
  return module.exports;
}

test("the app puts the same question in the box as the web lounge does for the same task", () => {
  const webPrompt = loadWebLoungePrompt();
  const { buildLoungeAmoraPrompt } = freshAsk();
  const categories = ["웨딩홀", "스튜디오·드레스·메이크업", "상견례", "신혼집 & 가전"];
  const events = ["드레스 투어", "양가 상견례 (토) 12:30", "본식 리허설", "\"웨딩홀\" 2차 방문"];
  for (const label of categories) {
    assert.equal(
      buildLoungeAmoraPrompt({ kind: "checklist", categoryLabel: label }),
      webPrompt({ kind: "checklist", category: { label } }),
      label,
    );
  }
  for (const title of events) {
    assert.equal(
      buildLoungeAmoraPrompt({ kind: "event", title }),
      webPrompt({ kind: "event", event: { title } }),
      title,
    );
  }
});

test("the question is written in the person's own words and judges nothing", () => {
  const { buildLoungeAmoraPrompt } = freshAsk();
  for (const prompt of [
    buildLoungeAmoraPrompt({ kind: "checklist", categoryLabel: "웨딩홀" }),
    buildLoungeAmoraPrompt({ kind: "event", title: "드레스 투어" }),
  ]) {
    // 사람이 보낼 말이다. 늦었다고 단정하거나 업체·가격을 먼저 꺼내지 않는다(진입 초안과 같은 선).
    for (const banned of ["늦", "업체", "가격", "추천", "플래너", "%", "—"]) {
      assert.ok(!prompt.includes(banned), `"${prompt}" 에 "${banned}" 가 있다`);
    }
    assert.match(prompt, /\?$/);
  }
});

/* ─────────────────────────────────────────────
   2. 주소에는 번호만
   ───────────────────────────────────────────── */

test("the route to Amora carries a number and the task entry, never the sentence", () => {
  const ask = freshAsk();
  assert.equal(entry.AMORA_CHAT_TASK_ENTRY, "lounge_task");
  assert.equal(ask.LOUNGE_AMORA_ASK_PARAM, "ask");
  assert.equal(ask.buildLoungeAmoraAskHref(7), "/(tabs)/chat?entry=lounge_task&ask=7");
  // 고정 문구 진입구와 섞이지 않는다. 섞이면 그 진입구의 고정 초안이 먼저 들어가 질문을 막는다.
  assert.ok(!entry.AMORA_CHAT_ENTRY_VALUES.includes(entry.AMORA_CHAT_TASK_ENTRY));
  assert.equal(entry.getAmoraChatEntryPrefill(entry.AMORA_CHAT_TASK_ENTRY), null);

  const id = ask.stageLoungeAmoraAsk({ ownerId: "user-a", task: { kind: "event", title: "엄마랑 한복 보러 가기" } });
  const href = ask.buildLoungeAmoraAskHref(id);
  assert.doesNotMatch(href, /[가-힣]/u, "사람이 적은 일정 이름이 주소에 실리면 이동 기록에 남는다");
  // 한글만 보면 퍼센트 인코딩한 문장은 지나간다. 주소 모양 전체를 못박는다.
  assert.match(href, /^\/\(tabs\)\/chat\?entry=lounge_task&ask=[1-9]\d*$/u);
});

test("ask numbers from the route are read strictly", () => {
  const { readLoungeAmoraAskId } = freshAsk();
  assert.equal(readLoungeAmoraAskId("12"), 12);
  assert.equal(readLoungeAmoraAskId(["3", "4"]), 3);
  for (const bad of ["0", "-1", "1e3", "01", "abc", "", " 5", "5 ", "1234567890", undefined, null, 5, {}, []]) {
    assert.equal(readLoungeAmoraAskId(bad), null, JSON.stringify(bad));
  }
});

/* ─────────────────────────────────────────────
   3. 한 번만, 같은 사람에게만, 그 번호로만
   ───────────────────────────────────────────── */

test("a staged question is handed over once, to the same person, for its own number", () => {
  const ask = freshAsk();
  const task = { kind: "checklist", categoryLabel: "웨딩홀" };

  const first = ask.stageLoungeAmoraAsk({ ownerId: "user-a", task });
  assert.equal(typeof first, "number");
  assert.equal(ask.takeLoungeAmoraAsk({ ownerId: "user-a", id: first }), "웨딩홀 준비, 지금 뭐부터 하면 될까?");
  assert.equal(ask.takeLoungeAmoraAsk({ ownerId: "user-a", id: first }), null, "두 번 받지 않는다");

  // 계정이 바뀐 사이에 남은 질문은 다른 사람의 입력칸에 들어가지 않고 버려진다.
  const second = ask.stageLoungeAmoraAsk({ ownerId: "user-a", task });
  assert.equal(ask.takeLoungeAmoraAsk({ ownerId: "user-b", id: second }), null);
  assert.equal(ask.takeLoungeAmoraAsk({ ownerId: "user-a", id: second }), null, "다른 사람이 연 순간 버린다");

  // 연달아 누르면 마지막 것만 남는다. 앞 번호로는 받을 수 없다.
  const third = ask.stageLoungeAmoraAsk({ ownerId: "user-a", task });
  const fourth = ask.stageLoungeAmoraAsk({ ownerId: "user-a", task: { kind: "event", title: "드레스 투어" } });
  assert.ok(fourth > third);
  assert.equal(ask.takeLoungeAmoraAsk({ ownerId: "user-a", id: third }), null);
  assert.equal(ask.takeLoungeAmoraAsk({ ownerId: "user-a", id: fourth }), "드레스 투어 앞두고 뭘 챙기면 될까?");
});

test("nothing is staged without an owner or without a task name, and long names are cut like the web", () => {
  const ask = freshAsk();
  assert.equal(ask.stageLoungeAmoraAsk({ ownerId: "", task: { kind: "checklist", categoryLabel: "웨딩홀" } }), null);
  assert.equal(ask.stageLoungeAmoraAsk({ ownerId: "user-a", task: { kind: "checklist", categoryLabel: "  " } }), null);
  assert.equal(ask.stageLoungeAmoraAsk({ ownerId: "user-a", task: { kind: "event", title: "" } }), null);

  const id = ask.stageLoungeAmoraAsk({ ownerId: "user-a", task: { kind: "event", title: "가".repeat(3000) } });
  const text = ask.takeLoungeAmoraAsk({ ownerId: "user-a", id });
  // 웹 `normalizeAmoraPrefill` 이 자르는 길이와 같다.
  assert.equal(ask.LOUNGE_AMORA_ASK_MAX_LENGTH, 2000);
  assert.equal(text.length, 2000);
});

/* ─────────────────────────────────────────────
   4. 대화 화면은 넣어 두기만 한다
   ───────────────────────────────────────────── */

/** 라운지 질문을 받는 효과 본문. 못 찾으면 실패한다. */
function loungeAskEffect() {
  const tree = ts.createSourceFile("chat.tsx", chatSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && node.expression.getText(tree) === "useEffect"
      && node.arguments[0]?.getText(tree).includes("takeLoungeAmoraAsk(")
    ) effects.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.equal(effects.length, 1, "라운지 질문을 받는 효과가 정확히 하나여야 한다");
  return {
    body: effects[0].arguments[0].getText(tree),
    deps: effects[0].arguments[1]?.getText(tree) ?? "",
  };
}

test("the chat waits until the lane is decided, then takes the question by number for this person", () => {
  const { body, deps } = loungeAskEffect();
  assert.match(chatSource, /import \{[^}]*takeLoungeAmoraAsk[^}]*\} from "@\/lib\/loungeAmoraAsk"/u);
  assert.match(body, /laneOpening !== "decided"/u);
  assert.match(body, /!initialLoaded/u);
  assert.match(body, /chatLoadError/u);
  assert.match(body, /AMORA_CHAT_TASK_ENTRY/u);
  assert.match(body, /readLoungeAmoraAskId\(askParam\)/u);
  assert.match(body, /takeLoungeAmoraAsk\(\{ ownerId: userId, id \}\)/u);
  // 같은 번호는 한 번만 놓는다. 화면이 다시 그려질 때마다 사람이 지운 질문이 되살아나지 않게.
  assert.match(body, /appliedLoungeAskRef\.current\?\.id === id/u);
  for (const dep of ["askParam", "entryParam", "laneOpening", "userId", "activeScope", "streaming"]) {
    assert.ok(deps.includes(dep), `효과가 ${dep} 바뀜을 따라가지 않는다`);
  }
  // 보내는 중에는 받지 않고 미룬다. 보낸 글은 답이 끝날 때까지 입력칸에 남아 있어 "쓰던 글"로 잘못 읽히고
  // 질문이 버려진다. 상대에게 보내는 중이면 칸을 아모라로 바꿔 실패 안내가 가려진다(2026-11-13 검토).
  const busy = body.indexOf("if (streaming || sendingRef.current) {");
  assert.ok(busy > 0, "보내는 중에 질문을 받지 않는 문이 없다");
  assert.ok(busy < body.indexOf("takeLoungeAmoraAsk("), "보내는 중인지 질문을 받은 뒤에야 본다(질문이 버려진다)");
});

test("the chat puts the question in the open Amora box, keeps what the person wrote, and never sends", () => {
  const { body } = loungeAskEffect();
  // 고른 칸의 아모라 입력칸에만 놓는다. 상대에게 쓰는 칸에 들어가면 사람은 자기가 쓰지 않은 말을
  // 상대에게 보낼 뻔한다.
  assert.match(body, /const lane = activeScope === "private" \? "private_ai" : "shared_ai";/u);
  assert.doesNotMatch(body, /shared_partner/u);
  assert.match(body, /setTarget\("ai"\)/u);
  // 쓰던 글은 덮지 않는다. 라운지가 앞서 넣고 손대지 않은 질문만 새 질문으로 바꾼다.
  assert.match(body, /existing\.trim\(\) && existing !== previous/u);
  // 앞 질문은 **같은 칸에 넣은 것**만 손대지 않은 질문으로 본다.
  assert.match(body, /const previous = last && last\.lane === lane \? last\.text : null;/u);
  // 실제로 넣은 질문만 기억한다. 거절한 질문을 기억하면 다음에 손대지 않은 앞 질문을 바꾸지 못한다.
  assert.ok(
    body.indexOf("appliedLoungeAskRef.current = {") > body.indexOf("existing !== previous"),
    "넣지 못한 질문까지 기억한다",
  );
  assert.match(body, /setPreparationNotice\(/u);
  // 넣기만 한다.
  for (const send of [/sendMessage/u, /handleSend/u, /requestAiMessageIngest/u, /\bfetch\(/u, /apiFetch/u]) {
    assert.doesNotMatch(body, send);
  }
});

/* ─────────────────────────────────────────────
   라운지 쪽 배선
   ───────────────────────────────────────────── */

/** "아모라에게 묻기" 글을 가진 Pressable 들과, 그 위에 다른 Pressable 이 있는지. */
function askButtons() {
  const tree = ts.createSourceFile("WeddingHomeExperience.tsx", homeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const visit = (node, pressableAncestors) => {
    let next = pressableAncestors;
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "Pressable") {
      const text = node.getText(tree);
      if (text.includes("아모라에게 묻기") && !node.children.some((child) => ts.isJsxElement(child) && child.openingElement.tagName.getText(tree) === "Pressable" && child.getText(tree).includes("아모라에게 묻기"))) {
        found.push({ text, nestedInPressable: pressableAncestors > 0 });
      }
      next = pressableAncestors + 1;
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(tree, 0);
  return found;
}

test("the lounge has an ask button for the hero task and for each upcoming task, outside the task's own button", () => {
  const buttons = askButtons();
  assert.equal(buttons.length, 2, "히어로 할 일과 다가오는 준비 줄, 두 자리에 있어야 한다");
  for (const button of buttons) {
    // VoiceOver 는 버튼 안의 버튼에 갈 수 없다. 할 일 버튼의 형제로 둔다.
    assert.equal(button.nestedInPressable, false, "아모라에게 묻기 버튼이 다른 버튼 안에 들어가 있다");
    assert.match(button.text, /accessibilityRole="button"/u);
    assert.match(button.text, /accessibilityLabel=\{/u);
    assert.match(button.text, /accessibilityHint=\{LOUNGE_AMORA_ASK_HINT\}/u);
  }
  assert.ok(buttons.some((button) => /onAskAmora\(focus\.amoraTask\)/u.test(button.text)));
  assert.ok(buttons.some((button) => /onAskAmora\(\{ kind: "checklist", categoryLabel: task\.categoryLabel \}\)/u.test(button.text)));
  // 할 일 자체를 누르면 지금처럼 체크리스트가 열린다(파운더 선택: 버튼 따로 두기).
  assert.match(homeSource, /onPress=\{\(\) => router\.push\("\/checklist"\)\}/u);
});

test("the lounge stages the question for this person and opens Amora by number", () => {
  assert.match(loungeSource, /stageLoungeAmoraAsk\(\{\s*ownerId,\s*task,?\s*\}\)/u);
  assert.match(loungeSource, /router\.push\(buildLoungeAmoraAskHref\(id\)/u);
  assert.match(loungeSource, /onAskAmora=\{handleAskAmora\}/u);
  // 라운지는 묻는 말을 보내지 않는다.
  assert.doesNotMatch(loungeSource, /\/api\/chat/u);
});
