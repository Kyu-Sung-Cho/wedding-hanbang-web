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
  // 화면의 「대화 화면 정리」 잠금(진행 중인 정리 없음)이 기본값이다 — 그 잠금은 chatViewClearScreen.test.mjs 가 잰다.
  // 새 객체로 펼치지 않는다 — 몇몇 하네스는 함수를 만든 뒤에 bindings 에 값을 더 붙인다.
  if (!Object.hasOwn(bindings, "viewClearInFlightRef")) bindings.viewClearInFlightRef = { current: null };
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
    setLaneFailure: () => {}, setColdStartAiRecoveryByLane: () => {}, setFollowUpSuggestions: () => {}, Crypto: { randomUUID: () => "synthetic-request" },
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

/*
 * 리뷰(2026-09-18) — 칩이 지금 대화와 어긋나 남는 두 경우와, 칩 전송이 실패했을 때 초안을 지우는 경우.
 *
 * 웹 `chatStore` 는 보내기를 시작할 때마다(상대에게 보낼 때·안전 안내로 멈출 때 포함) 칩을 비우고, 실시간으로
 * 아모라 답이 아니고 상대에게 보낸 말도 아닌 새 메시지가 같은 칸에 오면 칩을 비운다. 앱은 자기 기기에서 새 답을
 * 받을 때만 비웠다 — 상대가 웹에서 함께 대화에 새 질문을 해도 내 옛 칩이 남아, 누르면 맥락 밖 질문이 나갔다.
 */
test("실시간으로 같은 칸에 새 메시지가 오면 칩을 거둔다 — 아모라 답·상대에게 보낸 말·다른 칸·이 칩의 질문은 그대로 둔다", () => {
  assert.equal(typeof lib.followUpsAfterIncomingMessage, "function", "칩을 거둘지 정하는 함수가 없다");
  const state = { lane: "shared_ai", items: ["다음 질문"], answersMessageId: "question-1" };
  const incoming = (over = {}) => ({ id: "question-2", senderType: "groom", target: undefined, lane: "shared_ai", ...over });
  assert.equal(lib.followUpsAfterIncomingMessage(state, incoming()), null, "상대가 웹에서 함께 대화로 아모라에게 새 질문을 했다");
  assert.equal(lib.followUpsAfterIncomingMessage(state, incoming({ senderType: "bride" })), null, "내가 다른 기기에서 새 질문을 했다");
  assert.equal(lib.followUpsAfterIncomingMessage(state, incoming({ senderType: "ai" })), state, "아모라 답은 칩을 거두지 않는다");
  assert.equal(lib.followUpsAfterIncomingMessage(state, incoming({ target: "partner" })), state, "두 사람끼리 나눈 말은 아모라 대화가 아니다");
  assert.equal(lib.followUpsAfterIncomingMessage(state, incoming({ lane: "private_ai" })), state, "다른 칸의 메시지");
  assert.equal(lib.followUpsAfterIncomingMessage(state, incoming({ id: "question-1", senderType: "bride" })), state, "이 칩을 만든 질문의 도착 알림이 늦게 와도 새 대화가 아니다");
  assert.equal(lib.followUpsAfterIncomingMessage({ lane: "shared_ai", items: ["다음 질문"] }, incoming()), null);
  assert.equal(lib.followUpsAfterIncomingMessage(null, incoming()), null);
});

test("실시간 INSERT 처리가 칩을 거두고, 칩은 그 답이 응답한 질문을 기억한다", () => {
  const insertStart = chatSource.indexOf('{ event: "INSERT", schema: "public", table: "chat_messages"');
  const insertEnd = chatSource.indexOf('{ event: "UPDATE", schema: "public", table: "chat_messages"', insertStart);
  assert.ok(insertStart >= 0 && insertEnd > insertStart, "채팅 실시간 INSERT 처리를 찾지 못했다");
  const handler = chatSource.slice(insertStart, insertEnd);
  const clear = handler.indexOf("setFollowUpSuggestions((current) => followUpsAfterIncomingMessage(current, {");
  assert.ok(clear >= 0, "실시간 INSERT 가 칩을 거두지 않는다");
  assert.ok(handler.indexOf("canViewerSeeChatMessage(incoming, viewerRole)") < clear, "볼 수 없는 메시지로 칩을 건드리지 않는다");
  const call = handler.slice(clear, handler.indexOf("}));", clear));
  assert.match(call, /id: incoming\.id,/);
  assert.match(call, /senderType: incoming\.sender_type,/);
  assert.match(call, /target: incomingMetadata\?\.target,/);
  assert.match(call, /lane: aiLaneForVisibility\(incoming\.visibility\),/);
  assert.match(chatFunction("streamAiRequest"), /\{ lane: request\.lane, items: followUps, answersMessageId: request\.body\.userMessageId \}/);
});

function sendBindings(over = {}) {
  return {
    ...lib,
    input: "", activeScope: "shared", userRole: "bride", chatVisibilityForScope: () => "shared",
    streaming: false, sendingRef: { current: false }, initialLoaded: true, chatLoadError: null,
    coupleId: "couple-a", userId: "actor-a", userName: "합성", activeLane: "shared_ai", target: "ai",
    planAmoraCrisisDelivery: () => ({ effectiveVisibility: "shared", disposition: "allow" }),
    linkedPartnerIdRef: { current: null }, hasLinkedPartnerRef: { current: false },
    chatSessionGenerationRef: { current: { current: () => 1 } }, isCurrentChatSession: () => true,
    setColdStartAiRecoveryByLane: () => {}, Crypto: { randomUUID: () => "synthetic-request" },
    preparationDraft: null, preparationContextRef: { current: null }, preparationContextMatches: () => false,
    updateAmoraChatLaneRecord: (values, lane, text) => ({ ...values, [lane]: text }),
    NEW_CHAT_MESSAGE_REQUIRED_NOTICE: "같은 요청을 다시 보내도 해결되지 않아요. 내용을 확인한 뒤 새 메시지로 보내주세요.",
    ...over,
  };
}

test("보내기를 시작하면 칩을 먼저 거둔다 — 상대에게 보낼 때·안전 안내로 멈출 때도(웹과 같다)", async () => {
  for (const scenario of ["ai", "partner", "safety_hold"]) {
    let chips = { lane: "shared_ai", items: ["다음 질문"] };
    const sent = [];
    const bindings = sendBindings({
      input: "입력창 질문",
      target: scenario === "partner" ? "partner" : "ai",
      activeLane: scenario === "partner" ? "shared_partner" : "shared_ai",
      linkedPartnerIdRef: { current: "partner-b" }, hasLinkedPartnerRef: { current: true },
      planAmoraCrisisDelivery: () => (scenario === "safety_hold"
        ? { disposition: "local_safety_hold", effectiveVisibility: "bride_private", partnerDeliveryHeld: false, safetyResolution: "non_immediate_safety", response: "안전 안내", classification: null }
        : { effectiveVisibility: "shared", disposition: "allow" }),
      safetyHoldLockRef: { current: false },
      setMessages: () => {}, setInputByLane: () => {}, moveHeldDraftToPrivateLane: (current) => current,
      setLaneFailure: () => {}, setPartnerSafetyNotice: () => {}, setActiveScope: () => {}, setTarget: () => {},
      setFollowUpSuggestions: (next) => { chips = typeof next === "function" ? next(chips) : next; },
      sendAiDraft: async () => { sent.push(["ai", chips]); },
      sendPartnerDraft: async () => { sent.push(["partner", chips]); },
    });
    const { handleSend } = loadChatFunctions(["aiLaneForVisibility", "handleSend"], bindings);
    await handleSend();
    assert.equal(chips, null, `${scenario}: 보낸 뒤에도 옛 칩이 남는다`);
    assert.deepEqual(sent, scenario === "safety_hold" ? [] : [[scenario, null]], `${scenario}: 칩은 보내기 전에 거둔다`);
  }
});

/**
 * 칩 전송이 저장(ingest)에서 실패한 뒤 「다시 보내기」를 누른 경우. 고치기 전에는 handleRetry 가 입력창에
 * 칩 문장을 덮어쓰고, 다시 보내기가 성공하면 sendAiDraft 가 (칩 문장과 같아진) 입력창을 비워 쓰던 초안이
 * 사라졌다. 실제 handleSend·sendAiDraft·handleRetry 를 한 상태 위에서 돌린다.
 */
function chipSendHarness(typed) {
  const state = {
    input: { shared_ai: typed, private_ai: "", shared_partner: "" },
    failures: { shared_ai: null, private_ai: null, shared_partner: null },
    ingest: "fail", streamed: [],
  };
  const bindings = sendBindings({
    input: typed,
    setLaneFailure: (lane, failure) => { state.failures[lane] = failure; },
    setInputByLane: (update) => { state.input = update(state.input); },
    setFollowUpSuggestions: () => {}, setStreaming: () => {}, setMessages: () => {},
    setActiveScope: () => {}, setTarget: () => {}, messages: [], isMessageInAiContext: () => true,
    findDurableUserMessage: async () => null,
    streamAiRequest: async (request) => { state.streamed.push(request); },
  });
  const loaded = loadChatFunctions(["AiMessageIngestError", "aiLaneForVisibility", "getAiMessageIngestFailureMessage", "sendAiDraft", "handleSend", "handleRetry"], bindings);
  bindings.requestAiMessageIngest = async (draft) => {
    if (state.ingest === "fail") throw new loaded.AiMessageIngestError(503, "CHAT_INGEST_UNAVAILABLE", "same_request");
    return {
      outcome: "persisted", reused: false, effectiveVisibility: "shared", safetyPrivacyRedirected: false, safetyResolution: null,
      message: { id: "question-1", couple_id: "couple-a", sender_id: "actor-a", role: "user", sender_type: "bride", content: draft.text, metadata: { client_request_id: draft.clientRequestId }, visibility: "shared" },
    };
  };
  return {
    state,
    sendChip: (text) => loaded.handleSend(text),
    retry: async () => {
      bindings.activeSendFailure = state.failures.shared_ai;
      bindings.input = state.input.shared_ai;
      state.ingest = "ok";
      await loaded.handleRetry();
    },
  };
}

test("칩 전송이 저장에서 실패한 뒤 다시 보내도 입력창에 쓰던 초안은 그대로 남는다", async () => {
  const typed = "내가 쓰던 초안";
  const chip = "드레스 투어는 언제?";
  const harness = chipSendHarness(typed);
  await harness.sendChip(chip);
  assert.equal(harness.state.failures.shared_ai?.kind, "ai_insert", "저장 실패가 그 칸에 남아야 한다");
  assert.equal(harness.state.failures.shared_ai.canRetry, true);
  assert.equal(harness.state.input.shared_ai, typed, "실패해도 초안을 덮지 않는다");
  await harness.retry();
  assert.equal(harness.state.streamed.length, 1, "다시 보내기가 칩 문장을 보낸다");
  assert.equal(harness.state.streamed[0].body.messages.at(-1).content, chip);
  assert.equal(harness.state.input.shared_ai, typed, "다시 보내기가 성공해도 초안은 그대로다");
});

test("입력창이 비어 있을 때 칩 전송이 실패하면 그 문장을 입력창에 두고, 다시 보내기가 성공하면 비운다", async () => {
  const chip = "드레스 투어는 언제?";
  const harness = chipSendHarness("");
  await harness.sendChip(chip);
  assert.equal(harness.state.failures.shared_ai?.kind, "ai_insert");
  assert.equal(harness.state.input.shared_ai, chip, "실패한 문장을 볼 수 있어야 「내용을 확인한 뒤 새 메시지로」 안내가 참이다");
  await harness.retry();
  assert.equal(harness.state.streamed.length, 1);
  assert.equal(harness.state.input.shared_ai, "", "보낸 문장은 입력창에서 비운다");
});

test("다시 보낼 때 입력창은 비어 있거나 같은 문장일 때만 그 문장으로 채운다", () => {
  assert.equal(typeof lib.laneInputForRetry, "function");
  assert.equal(lib.laneInputForRetry("", "보낸 문장"), "보낸 문장");
  assert.equal(lib.laneInputForRetry("  ", "보낸 문장"), "보낸 문장");
  assert.equal(lib.laneInputForRetry("보낸 문장 ", "보낸 문장"), "보낸 문장");
  assert.equal(lib.laneInputForRetry("쓰던 초안", "보낸 문장"), "쓰던 초안");
  assert.equal(typeof lib.laneInputAfterFailedSend, "function");
  assert.equal(lib.laneInputAfterFailedSend("", { text: "칩", origin: "follow_up" }), "칩");
  assert.equal(lib.laneInputAfterFailedSend("쓰던 초안", { text: "칩", origin: "follow_up" }), "쓰던 초안");
  assert.equal(lib.laneInputAfterFailedSend("", { text: "입력창 문장", origin: "composer" }), "", "입력창에서 보낸 문장은 원래 입력창에 있다 — 건드리지 않는다");
  assert.equal(lib.laneInputAfterFailedSend("", { text: "입력창 문장" }), "");
});
