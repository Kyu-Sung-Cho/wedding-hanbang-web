import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import { getAmoraVisibleText } from "@hanbang/shared/amora-visible-text";

/**
 * 아모라 답 뒤의 후속 질문 칩 (2026-09-18).
 *
 * 서버는 답이 끝날 때 `{"type":"suggestions","suggestions":[…]}` 를 보내고, 웹은 그것을 입력창 위
 * 「추천 대화」 칩으로 그린다. 누르면 그 문장을 아모라에게 바로 보낸다(`sendToAmora`). 앱 스트림 파서는
 * 이 사건을 모르는 종류로 버리고 있었다 — 앱 사용자는 한 번도 칩을 못 봤다.
 *
 * 지키는 것:
 * - 칩은 아모라에게 말하는 칸에서만 — 상대에게 보내는 칸에서는 절대 보이지 않는다(웹과 같다).
 * - 누르면 그 문장만 보낸다. 입력창에 쓰던 초안은 건드리지 않는다(웹과 같다).
 * - 칩 문장에는 준비 안내 출처(preparationSource)를 붙이지 않는다 — 출처는 입력창의 그 초안에 묶여 있다.
 */
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const chatSource = read("../../app/(tabs)/chat.tsx");
const chatTree = ts.createSourceFile("chat.tsx", chatSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function chatFunction(name) {
  let found;
  const visit = (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name) found = node.getText(chatTree);
    ts.forEachChild(node, visit);
  };
  visit(chatTree);
  assert.ok(found, `chat.tsx 에 ${name} 이 없다`);
  return found;
}
function loadChatFunctions(names, bindings = {}) {
  const output = ts.transpileModule(names.map(chatFunction).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("bindings", `with(bindings){${output};return {${names.join(",")}};}`)(bindings);
}
function compileLib(relative) {
  const compiled = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", compiled.outputText)(module.exports, module, (specifier) => {
    throw new Error(`amoraFollowUpSuggestions 는 의존성이 없어야 한다: ${specifier}`);
  });
  return module.exports;
}

const lib = compileLib("../lib/amoraFollowUpSuggestions.ts");

test("서버가 보낸 후속 질문만 받는다 — 문자열·160자 이하·최대 4개, 빈 칸과 중복은 버린다", () => {
  for (const broken of [null, undefined, "칩", 3, { a: 1 }]) {
    assert.deepEqual(lib.normalizeAmoraFollowUpSuggestions(broken), []);
  }
  assert.deepEqual(
    lib.normalizeAmoraFollowUpSuggestions(["  예식장 계약금은 얼마가 적당해?  ", "", 3, null, "예식장 계약금은 얼마가 적당해?", "x".repeat(161), "드레스 투어는 언제?", "하객 수 먼저 정할까?", "스드메 순서는?", "다섯 번째"]),
    ["예식장 계약금은 얼마가 적당해?", "드레스 투어는 언제?", "하객 수 먼저 정할까?", "스드메 순서는?"],
  );
});

test("칩은 그 답이 나온 아모라 칸에서만, 답이 끝난 뒤에만 보인다", () => {
  const state = { lane: "shared_ai", items: ["다음 질문"] };
  assert.deepEqual(lib.visibleAmoraFollowUps(state, { activeLane: "shared_ai", streaming: false }), ["다음 질문"]);
  assert.deepEqual(lib.visibleAmoraFollowUps(state, { activeLane: "shared_partner", streaming: false }), [], "상대에게 보내는 칸에서는 절대 보이지 않는다");
  assert.deepEqual(lib.visibleAmoraFollowUps(state, { activeLane: "private_ai", streaming: false }), [], "다른 범위의 답 칩을 옮겨 보이지 않는다");
  assert.deepEqual(lib.visibleAmoraFollowUps(state, { activeLane: "shared_ai", streaming: true }), []);
  assert.deepEqual(lib.visibleAmoraFollowUps(state, { activeLane: null, streaming: false }), []);
  assert.deepEqual(lib.visibleAmoraFollowUps(null, { activeLane: "shared_ai", streaming: false }), []);
  assert.equal(lib.AMORA_FOLLOW_UP_LABEL, "추천 대화");
  assert.ok(read("../../../web/src/components/app/chat/SuggestionButtons.tsx").includes(lib.AMORA_FOLLOW_UP_LABEL), "웹 칩 묶음과 같은 이름");
});

test("스트림 파서가 suggestions 사건을 버리지 않고 답과 함께 넘긴다", () => {
  const names = ["nonEmptyString", "isRecord", "asToolExecutionResult", "mergeToolResults", "asChatMessageMetadata", "isPlaceSearchPlaceholder", "asChatStreamEvent", "applyChatEvent", "cleanAiText", "createChatStreamParser"];
  const { createChatStreamParser } = loadChatFunctions(names, { getAmoraVisibleText });
  const parser = createChatStreamParser(() => {});
  parser.push('data: {"type":"text_delta","content":"답"}\n\n');
  parser.push('data: {"type":"suggestions","suggestions":["드레스 투어는 언제?","예산부터 볼까?"]}\n\n');
  parser.push('data: {"type":"done","fullContent":"답"}\n\n');
  assert.equal(parser.finish(), "답");
  assert.deepEqual(parser.getSuggestions(), ["드레스 투어는 언제?", "예산부터 볼까?"]);

  const failed = createChatStreamParser(() => {});
  failed.push('data: {"type":"suggestions","suggestions":["실패한 답의 칩"]}\n\n');
  failed.push('data: {"type":"error","code":"X"}\n\n');
  assert.throws(() => failed.finish());
  assert.equal(failed.getSuggestions(), null, "실패한 답의 칩은 남기지 않는다");

  const xhr = chatFunction("streamChatWithXhr");
  assert.match(xhr, /suggestions: parser\.getSuggestions\(\)/);
});

test("답이 끝나면 그 칸의 칩을 두고, 새 답이 시작되면 지운다", () => {
  const stream = chatFunction("streamAiRequest");
  const start = stream.indexOf("setStreaming(true)");
  const clear = stream.indexOf("setFollowUpSuggestions(null)");
  assert.ok(clear >= 0 && clear < start, "새 답이 시작되기 전에 이전 칩을 지운다");
  assert.match(stream, /normalizeAmoraFollowUpSuggestions\(completion\.suggestions\)/);
  assert.match(stream, /lane: request\.lane/);
  const reset = chatSource.slice(chatSource.indexOf("const resetChatSessionState"), chatSource.indexOf("useEffect(() => {\n    const timer = setInterval"));
  assert.match(reset, /setFollowUpSuggestions\(null\)/);
  assert.match(chatSource, /visibleAmoraFollowUps\(followUpSuggestions, \{ activeLane, streaming \}\)/);
});

test("칩을 누르면 그 문장만 아모라에게 보내고, 상대 칸·답 대기 중에는 아무것도 보내지 않는다", async () => {
  for (const scenario of ["ai", "partner", "streaming", "sending"]) {
    const sent = [];
    const { handleFollowUpSuggestion } = loadChatFunctions(["handleFollowUpSuggestion"], {
      streaming: scenario === "streaming",
      sendingRef: { current: scenario === "sending" },
      target: scenario === "partner" ? "partner" : "ai",
      handleSend: async (text) => { sent.push(text); },
    });
    await handleFollowUpSuggestion("드레스 투어는 언제?");
    assert.deepEqual(sent, scenario === "ai" ? ["드레스 투어는 언제?"] : [], scenario);
  }
});

test("칩 문장은 입력창 초안과 준비 안내 출처를 건드리지 않고 그대로 보낸다", async () => {
  const calls = [];
  const context = { ownerId: "actor-a", coupleId: "couple-a", generation: 1, lane: "shared_ai", ready: true, busy: false, input: "안내에서 가져온 질문" };
  const bindings = {
    input: "안내에서 가져온 질문", activeScope: "shared", userRole: "bride",
    chatVisibilityForScope: () => "shared", streaming: false, sendingRef: { current: false }, initialLoaded: true, chatLoadError: null,
    coupleId: "couple-a", userId: "actor-a", userName: "합성", activeLane: "shared_ai", target: "ai",
    planAmoraCrisisDelivery: () => ({ effectiveVisibility: "shared", disposition: "allow" }),
    linkedPartnerIdRef: { current: null }, hasLinkedPartnerRef: { current: false },
    chatSessionGenerationRef: { current: { current: () => 1 } }, isCurrentChatSession: () => true,
    setLaneFailure: () => {}, setColdStartAiRecoveryByLane: () => {}, Crypto: { randomUUID: () => "synthetic-request" },
    preparationDraft: { source: "g.gift-money.section-2", text: "안내에서 가져온 질문", context },
    preparationContextRef: { current: context },
    preparationContextMatches: () => true,
    sendAiDraft: async (draft) => calls.push(draft), sendPartnerDraft: async (draft) => calls.push(draft),
  };
  const { handleSend } = loadChatFunctions(["aiLaneForVisibility", "handleSend"], bindings);
  await handleSend("드레스 투어는 언제?");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "드레스 투어는 언제?");
  assert.equal(calls[0].target, "ai");
  assert.equal(calls[0].preparationSource, undefined, "출처는 입력창의 그 초안에만 붙는다");
  // 입력창 그대로 보내면 출처가 붙는다 — 칩 경로만 다르다.
  await handleSend();
  assert.equal(calls[1].text, "안내에서 가져온 질문");
  assert.equal(calls[1].preparationSource, "g.gift-money.section-2");
});

test("칩 묶음은 상대에게 보내는 칸에서 그리지 않고, 누를 곳은 44 이상이다", () => {
  const render = chatSource.slice(chatSource.indexOf("const isP = activeScope"));
  const chips = render.slice(render.indexOf("visibleFollowUps.length > 0"), render.indexOf("<View style={[st.inputBar"));
  assert.ok(chips.length > 0, "칩 묶음을 찾지 못했다");
  assert.match(chips, /!isP/);
  assert.match(chips, /onPress=\{\(\) => \{ void handleFollowUpSuggestion\(suggestion\); \}\}/);
  assert.match(chatSource, /followUpChip: \{[^}]*minHeight: 44/);
  // 보내기 버튼은 누른 이벤트를 문장으로 넘기지 않는다.
  assert.match(chatSource, /onPress=\{\(\) => \{ void handleSend\(\); \}\}/);
});
