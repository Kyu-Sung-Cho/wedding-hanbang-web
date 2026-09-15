import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";
import { getAmoraVisibleText } from "@hanbang/shared/amora-visible-text";
import { parseAmoraCitations, describeAmoraCitations } from "../lib/amoraCitations.mjs";
import * as chatParticipantPresentationModule from "../lib/chatParticipantPresentation.mjs";

const helperPath = fileURLToPath(new URL("../lib/pendingAmoraAction.ts", import.meta.url));
const sharedSchedulePath = fileURLToPath(new URL(
  "../../../../packages/shared/src/contracts/sharedSchedule.ts",
  import.meta.url,
));
const budgetImpactPath = fileURLToPath(new URL(
  "../../../../packages/shared/src/contracts/budgetImpactPreview.ts",
  import.meta.url,
));
// 2026-09-03: 지난 날짜 판정이 shared 의 todayYmdInKst 를 쓴다 — 루트 "@hanbang/shared" 로 이어 준다
const kstDayPath = fileURLToPath(new URL(
  "../../../../packages/shared/src/utils/kstDay.ts",
  import.meta.url,
));
const actionApprovalPath = fileURLToPath(new URL(
  "../../../../packages/shared/src/contracts/amoraActionApproval.ts",
  import.meta.url,
));

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

const sharedScheduleModule = compileCommonJs(
  readFileSync(sharedSchedulePath, "utf8"),
);
const sharedModule = {
  ...sharedScheduleModule,
  ...compileCommonJs(readFileSync(new URL(
    "../../../../packages/shared/src/contracts/amoraPendingActionApplication.ts", import.meta.url,
  ), "utf8")),
  ...compileCommonJs(readFileSync(budgetImpactPath, "utf8")),
  ...compileCommonJs(readFileSync(kstDayPath, "utf8")),
  ...compileCommonJs(
    readFileSync(actionApprovalPath, "utf8"),
    (specifier) => {
      if (specifier === "./sharedSchedule") return sharedScheduleModule;
      throw new Error(`unexpected dependency: ${specifier}`);
    },
  ),
};
const helperSource = readFileSync(helperPath, "utf8");
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const helperModule = { exports: {} };
new Function("exports", "module", "require", compiled.outputText)(
  helperModule.exports,
  helperModule,
  (specifier) => {
    if (specifier === "@hanbang/shared") return sharedModule;
    throw new Error(`unexpected dependency: ${specifier}`);
  },
);
const {
  getAmoraActionApprovalPolicy,
  getAmoraPendingActionTtlMs,
  getPendingAmoraAction,
  getPendingAmoraActionCarryCount,
  getPendingAmoraBudgetImpactPreview,
  getPendingActionDisabledReason,
  isPendingAmoraActionExpired,
  getSharedActionApprovalPresentation,
  parseSharedActionApprovalStatus,
} = helperModule.exports;

const chatPath = fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url));
const chatSource = readFileSync(chatPath, "utf8");
const toolResultCardModule = compileCommonJs(readFileSync(new URL(
  "../components/chat/toolResultCardModel.ts", import.meta.url,
), "utf8"));

const action = {
  version: 2,
  actionId: "33333333-3333-4333-8333-333333333333",
  tool: "add_schedule_event",
  input: {
    date: "2026-08-01",
    title: "드레스 피팅",
    schedule_scope: "confirmed_fact",
  },
  inputDigest: "a".repeat(64),
  operationKey: "b".repeat(64),
  confirmation: "드레스 피팅 일정을 추가할까요?",
  issuedAt: Date.parse("2026-07-17T00:00:00.000Z"),
  // `add_schedule_event` 는 공유 계획 도구라 창이 24시간이다(2026-08-23).
  expiresAt: Date.parse("2026-07-18T00:00:00.000Z"),
};

function renderProposal(receipts, {
  nowMs = action.expiresAt - 1,
  streaming = false,
  itemOverrides = {},
  participantPresentation = chatParticipantPresentationModule.EMPTY_CHAT_PARTICIPANT_PRESENTATION,
  linkedPartnerId = null,
} = {}) {
  const applicationModule = compileCommonJs(readFileSync(new URL(
    "../../../web/src/components/app/chat/amoraPendingActionApplication.ts", import.meta.url,
  ), "utf8"), (specifier) => {
    if (specifier === "./PendingAmoraActionCard") return { getPendingActionDisabledReason };
    if (specifier === "@hanbang/shared") return sharedModule;
    throw new Error(`unexpected receipt dependency: ${specifier}`);
  });
  const tree = ts.createSourceFile("chat.tsx", chatSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  const components = {};
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "renderMessage") declaration = node;
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName)) {
      components[node.tagName.getText(tree)] = node.tagName.getText(tree);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const item = { id: "proposal", sender_id: null, content: "제안", ...message(), ...itemOverrides };
  const messages = [item, ...receipts];
  const bindings = {
    ...components, ...sharedModule, ...helperModule.exports, ...applicationModule,
    React: { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: "Fragment" },
    messages, userRole: "bride", userId: "user-1", dismissedPendingActionIds: new Set(),
    userName: "나", partnerName: "파트너",
    ...chatParticipantPresentationModule, participantPresentation,
    hasLinkedPartner: linkedPartnerId !== null, linkedPartnerIdRef: { current: linkedPartnerId },
    ...compileCommonJs(readFileSync(new URL("../../../../packages/design-tokens/src/chat.ts", import.meta.url), "utf8")),
    nowMs, streaming, latestSharedMessageId: messages.at(-1).id,
    latestPendingAction: getPendingAmoraAction(messages.at(-1)),
    actionConfirmationOutcomes: applicationModule.buildAmoraActionConfirmationOutcomes(messages),
    pendingActionApproval: null, pendingActionNotice: null, applyingPendingActionId: null,
    parseAmoraCitations, describeAmoraCitations, getAmoraVisibleText,
    normalizeMediationBlock: () => null, ...toolResultCardModule,
    colors: { noir: { 800: "black", soft: "gray" }, gold: { DEFAULT: "gold" }, ivory: { warm: "ivory" } }, st: {},
  };
  const compiledRender = ts.transpileModule(declaration.getText(tree), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const render = new Function(...Object.keys(bindings), `${compiledRender}\nreturn renderMessage;`)(...Object.values(bindings));
  const rendered = render({ item });
  const nodes = [];
  const flatten = (node) => {
    if (node && typeof node === "object") {
      nodes.push(node);
      for (const child of node.children ?? []) {
        if (Array.isArray(child)) child.forEach(flatten);
        else flatten(child);
      }
    }
  };
  flatten(rendered);
  const text = JSON.stringify(rendered);
  return { text, nodes, buttons: nodes.filter((node) => node.type === "Pressable") };
}

const confirmationReceipt = {
  id: "confirm", sender_type: "bride", visibility: "shared",
  metadata: { confirmed_amora_action_id: action.actionId },
};
const successReceipt = {
  id: "result", sender_type: "ai", visibility: "shared",
  metadata: { in_reply_to_user_message_id: "confirm", toolResults: [{ toolName: action.tool, success: true }] },
};

test("mobile renders a successful proposal as applied even after a newer reply and expiry", () => {
  const rendered = renderProposal([confirmationReceipt, successReceipt], { nowMs: action.expiresAt + 1 });
  assert.match(rendered.text, /이 제안은 적용됐어요/);
  assert.doesNotMatch(rendered.text, /확인 시간이 지났어요|새 대화가 이어져/);
  assert.equal(rendered.buttons[0].props.disabled, true);
});

test("mobile does not call confirmation alone, failed or unrelated tool receipts applied", () => {
  for (const receipts of [
    [confirmationReceipt],
    [confirmationReceipt, { ...successReceipt, metadata: { in_reply_to_user_message_id: "confirm", toolResults: [{ toolName: action.tool, success: false }] } }],
    [confirmationReceipt, { ...successReceipt, metadata: { in_reply_to_user_message_id: "confirm", toolResults: [{ toolName: "update_budget", success: true }] } }],
    [confirmationReceipt, { ...successReceipt, metadata: { ...successReceipt.metadata, in_reply_to_user_message_id: "different-confirmation" } }],
    [successReceipt],
  ]) {
    const rendered = renderProposal(receipts);
    assert.doesNotMatch(rendered.text, /이 제안은 적용됐어요/);
    assert.match(rendered.text, /새 대화가 이어져/);
    assert.equal(rendered.buttons[0].props.disabled, true);
  }
});

test("mobile waits for a pending result without presenting it as success or expiry", () => {
  const rendered = renderProposal([confirmationReceipt], { streaming: true, nowMs: action.expiresAt + 1 });
  assert.match(rendered.text, /현재 답변이 끝나면 다시 확인할 수 있어요/);
  assert.doesNotMatch(rendered.text, /이 제안은 적용됐어요|확인 시간이 지났어요|새 대화가 이어져/);
});

// 2026-09-15: 카드에 "응 적용해줘" 라고 치면 서버가 같은 제안을 최신 답변 아래에 다시 붙인다.
// 옛 카드가 "새 대화가 이어져 이 제안은 적용할 수 없어요" 라고 하면 같은 제안이 한쪽에서는 되고
// 다른 쪽에서는 안 된다고 말하게 된다.
const typedAcceptance = { id: "typed", sender_type: "bride", visibility: "shared", content: "응 적용해줘", metadata: {} };
const carriedReply = (pending = action) => ({
  id: "carried", sender_id: null, sender_type: "ai", visibility: "shared", content: "아래 카드에서 확인해 주세요.",
  metadata: { pending_amora_action: pending, pending_amora_action_carry_count: 1 },
});

test("mobile points an old card at the same proposal carried to the newest reply and removes its buttons", () => {
  const rendered = renderProposal([typedAcceptance, carriedReply()]);
  assert.match(rendered.text, /같은 제안이 아래 최신 답변으로 옮겨졌어요\. 그 카드에서 확인할 수 있어요\./);
  assert.doesNotMatch(rendered.text, /새 대화가 이어져/);
  // 누를 곳은 최신 카드 한 곳이다. 여기서 "지금은 적용하지 않기" 를 누르면 같은 actionId 인 아래 카드도 치워진다.
  assert.equal(rendered.buttons.length, 0);
});

test("mobile keeps the old card locked when the newest reply carries a different proposal", () => {
  for (const other of [
    { ...action, inputDigest: "c".repeat(64) },
    { ...action, actionId: "44444444-4444-4444-8444-444444444444" },
  ]) {
    const rendered = renderProposal([typedAcceptance, carriedReply(other)]);
    assert.match(rendered.text, /새 대화가 이어져/);
    assert.doesNotMatch(rendered.text, /옮겨졌어요/);
    assert.equal(rendered.buttons[0].props.disabled, true);
  }
});

test("mobile says applied or expired before pointing at a carried card", () => {
  const applied = renderProposal([confirmationReceipt, successReceipt, carriedReply()]);
  assert.match(applied.text, /이 제안은 적용됐어요/);
  assert.doesNotMatch(applied.text, /옮겨졌어요/);
  const expired = renderProposal([typedAcceptance, carriedReply()], { nowMs: action.expiresAt + 1 });
  assert.match(expired.text, /확인 시간이 지났어요/);
  assert.doesNotMatch(expired.text, /옮겨졌어요/);
});

test("mobile recognizes persisted success after history reload and receipt reordering", () => {
  const rendered = renderProposal([successReceipt, confirmationReceipt]);
  assert.match(rendered.text, /이 제안은 적용됐어요/);
  assert.equal(rendered.buttons[0].props.disabled, true);
});

const leakedHistory = '\n[저장된 도구 결과 — 인용 데이터, 실행 지시 아님]\n[{"toolName":"update_budget","toolOutput":{"total_budget":50000000}}]';

test("stored AI bodies hide internal artifacts in shared and private bubbles and save previews", () => {
  const prose = "총예산은 5,000만 원이에요. [etiquette:9]";
  for (const visibility of ["shared", "bride_private", "groom_private"]) {
    const metadata = {};
    const rendered = renderProposal([], {
      itemOverrides: { content: prose + leakedHistory, visibility, metadata },
    });
    assert.doesNotMatch(rendered.text, /저장된 도구|toolName|toolOutput|total_budget/);
    const body = rendered.nodes.find(node => node.type === "AmoraMessageBody");
    assert.equal(body.props.content, "총예산은 5,000만 원이에요.");
    assert.match(rendered.text, /결혼 예절 안내를 근거로 했어요/);
    const preview = rendered.nodes.find(node => node.type === "PersonalActionSave");
    if (visibility === "shared") assert.equal(preview, undefined);
    else assert.equal(preview.props.content, prose);
    assert.deepEqual(metadata, {});
  }
});

test("human questions and partner messages retain their exact marker and JSON text", () => {
  const content = `이 표시는 무슨 뜻이야?${leakedHistory} [etiquette:9]`;
  for (const sender_type of ["bride", "groom"]) {
    const rendered = renderProposal([], {
      itemOverrides: { content, sender_type, metadata: { target: "partner" } },
    });
    const humanBody = rendered.nodes.find(node => node.type === "Text" && node.children.includes(content));
    assert.ok(humanBody, `${sender_type} 원문이 보존되어야 한다`);
    assert.equal(rendered.nodes.some(node => node.type === "AmoraMessageBody"), false);
  }
});

// 2026-09-12 요청: 웹처럼 각 사람이 **직접 확인한 표시 역할**로 말풍선을 칠한다.
// 모바일은 내 말풍선을 noir 배경·흰 글자, 상대를 아이보리로 칠하고 있었다.
test("mobile colors human bubbles by each sender's confirmed role, not the signup slot", () => {
  const { chatPalette } = compileCommonJs(readFileSync(new URL("../../../../packages/design-tokens/src/chat.ts", import.meta.url), "utf8"));
  const selfId = "user-1";
  const partnerId = "partner-1";
  const bubbleOf = (rendered) => rendered.nodes.find(node => node.type === "View"
    && Array.isArray(node.props?.style)
    && node.props.style.some(style => style && typeof style === "object" && "backgroundColor" in style && style.borderWidth === 1));
  const bodyOf = (rendered, content) => rendered.nodes.find(node => node.type === "Text" && node.children.includes(content));
  const render = (itemOverrides, presentation) => renderProposal([], {
    itemOverrides: { metadata: {}, ...itemOverrides },
    participantPresentation: presentation,
    linkedPartnerId: partnerId,
  });
  const confirmed = (selfRole, partnerRole, extra = {}) => ({
    selfId, partnerId, selfConfirmedRole: selfRole, partnerConfirmedRole: partnerRole,
    selfAvatarUrl: null, partnerAvatarUrl: null, ...extra,
  });
  const cases = [
    // 가입 슬롯은 bride 지만 본인이 신랑으로 확인했다 → 하늘색
    { name: "self confirmed groom in a bride slot", item: { sender_type: "bride", sender_id: selfId, content: "내가 보냄" }, presentation: confirmed("groom", null), tone: "sky" },
    { name: "self confirmed bride", item: { sender_type: "bride", sender_id: selfId, content: "내가 보냄" }, presentation: confirmed("bride", "groom"), tone: "rose" },
    { name: "partner confirmed groom", item: { sender_type: "groom", sender_id: partnerId, content: "상대가 보냄" }, presentation: confirmed("bride", "groom"), tone: "sky" },
    { name: "partner not confirmed", item: { sender_type: "groom", sender_id: partnerId, content: "상대가 보냄" }, presentation: confirmed("bride", null), tone: "neutral" },
    { name: "roles not loaded", item: { sender_type: "bride", sender_id: selfId, content: "내가 보냄" }, presentation: chatParticipantPresentationModule.EMPTY_CHAT_PARTICIPANT_PRESENTATION, tone: "neutral" },
    { name: "legacy message without sender_id", item: { sender_type: "groom", sender_id: null, content: "예전 메시지" }, presentation: confirmed("bride", "groom"), tone: "neutral" },
    { name: "amora", item: { sender_type: "ai", sender_id: null, content: "아모라 답변" }, presentation: confirmed("bride", "groom"), tone: "amora" },
  ];
  for (const scenario of cases) {
    const rendered = render(scenario.item, scenario.presentation);
    const bubble = bubbleOf(rendered);
    assert.ok(bubble, `${scenario.name}: 말풍선이 있어야 한다`);
    const toneStyle = bubble.props.style.find(style => style && typeof style === "object" && "backgroundColor" in style);
    assert.equal(toneStyle.backgroundColor, chatPalette[scenario.tone].surface, scenario.name);
    assert.equal(toneStyle.borderColor, chatPalette[scenario.tone].line, scenario.name);
    if (scenario.tone !== "amora") {
      const body = bodyOf(rendered, scenario.item.content);
      assert.equal(body.props.style.find(style => style && typeof style === "object" && "color" in style).color, chatPalette[scenario.tone].ink, scenario.name);
    }
    assert.doesNotMatch(JSON.stringify(bubble.props.style), /"#FFF"|"black"/u, `${scenario.name}: 예전 noir/흰 글자 말풍선이 남으면 안 된다`);
  }
});

test("mobile shows the partner's initial or chosen emoji instead of a generic person icon", () => {
  const selfId = "user-1";
  const partnerId = "partner-1";
  const presentation = {
    selfId, partnerId, selfConfirmedRole: null, partnerConfirmedRole: null,
    selfAvatarUrl: null, partnerAvatarUrl: "🐻",
  };
  const partnerMessage = renderProposal([], {
    itemOverrides: { sender_type: "groom", sender_id: partnerId, content: "안녕", metadata: {} },
    participantPresentation: presentation,
    linkedPartnerId: partnerId,
  });
  const avatar = partnerMessage.nodes.find(node => node.type === "ProfileAvatar");
  assert.ok(avatar, "상대 메시지 옆에 프로필 아바타가 있어야 한다");
  assert.equal(avatar.props.name, "파트너");
  assert.equal(avatar.props.avatarUrl, "🐻");
  assert.equal(avatar.props.ownerId, partnerId);
  assert.equal(partnerMessage.nodes.some(node => node.type === "User"), false);

  // 누구인지 확인할 수 없는 과거 메시지에는 지금 상대의 이름·사진을 붙이지 않는다.
  const legacy = renderProposal([], {
    itemOverrides: { sender_type: "groom", sender_id: null, content: "예전", metadata: {} },
    participantPresentation: presentation,
    linkedPartnerId: partnerId,
  });
  const legacyAvatar = legacy.nodes.find(node => node.type === "ProfileAvatar");
  assert.equal(legacyAvatar.props.name, null);
  assert.equal(legacyAvatar.props.avatarUrl, null);
});

test("internal-only native streaming waits while completed internal-only answers remain readable", () => {
  const streaming = renderProposal([], {
    streaming: true,
    itemOverrides: { id: "temp_answer", content: leakedHistory, metadata: {} },
  });
  assert.equal(streaming.nodes.some(node => node.type === "ThinkingDots"), true);
  assert.doesNotMatch(streaming.text, /저장된 도구|toolName|total_budget/);
  const completed = renderProposal([], {
    itemOverrides: { content: leakedHistory, metadata: {} },
  });
  const body = completed.nodes.find(node => node.type === "AmoraMessageBody");
  assert.ok(body.props.content.trim());
  assert.doesNotMatch(completed.text, /저장된 도구|toolName|total_budget/);
});

test("sanitized AI display preserves pending approval, budget receipt and safety accessibility", () => {
  const metadata = {
    pending_amora_action: action,
    toolResults: [{ toolName: "update_budget", success: true, displayMessage: "총예산 5,000만 원을 반영했어요." }],
  };
  const snapshot = globalThis.structuredClone(metadata);
  const rendered = renderProposal([], {
    itemOverrides: { content: "내용을 확인해 주세요." + leakedHistory, metadata },
  });
  assert.match(rendered.text, /적용하기 전에 확인해 주세요|확인한 내용을 이대로 적용/);
  assert.match(rendered.text, /드레스 피팅 일정을 추가할까요/);
  const receipt = rendered.nodes.find(node => node.type === "ToolResultCard");
  assert.equal(receipt.props.model.message, "총예산 5,000만 원을 반영했어요.");
  assert.deepEqual(metadata, snapshot);
  const safety = renderProposal([], {
    itemOverrides: { content: "위험한 상황이면 112에 연락해 주세요." + leakedHistory, metadata: { pinned_safety_card: true } },
  });
  const alert = safety.nodes.find(node => node.props?.accessibilityRole === "alert");
  assert.equal(alert.props.accessibilityLabel, "긴급 안전 안내. 위험한 상황이면 112에 연락해 주세요.");
  assert.doesNotMatch(safety.text, /저장된 도구|toolName|total_budget/);
});

test("모바일도 웹과 같은 승인 정책을 쓴다 — 전부 한 사람 확인", () => {
  // 2026-08-23 파운더 결정. 두 사람 승인을 없애고 상대에게는 알림을 준다.
  // 입력값에 따라 갈리던 것(카테고리 예산에 금액이 있으면 두 사람)도 없어졌다.
  for (const input of [{}, { schedule_scope: "confirmed_fact" }, { schedule_scope: "shared_commitment" }]) {
    assert.equal(getAmoraActionApprovalPolicy("add_schedule_event", input), "single");
  }
  assert.equal(getAmoraActionApprovalPolicy("update_schedule_event", {}), "single");
  assert.equal(getAmoraActionApprovalPolicy("update_category_budget", {}), "single");
  assert.equal(
    getAmoraActionApprovalPolicy("update_category_budget", { budget: 30_000_000 }),
    "single",
  );
  assert.equal(getAmoraActionApprovalPolicy("add_custom_category", {}), "single");
  assert.equal(
    getAmoraActionApprovalPolicy("add_custom_category", { budget: 3_000_000 }),
    "single",
  );
  assert.equal(getAmoraActionApprovalPolicy("update_budget", {}), "single");

  // 막힌 것은 그대로 막혀 있다 — 이 단언은 이번 변경으로 약해지지 않는다.
  assert.equal(getAmoraActionApprovalPolicy("unknown_tool", {}), "blocked");
  assert.equal(getAmoraActionApprovalPolicy("delete_schedule_event", {}), "blocked");
  assert.equal(getAmoraActionApprovalPolicy("create_booking", {}), "blocked");
});

test("모바일 TTL이 도구별 창과 정확히 맞는다", () => {
  // 2026-08-23: TTL을 승인 정책이 아니라 **도구**로 정한다. 공유 계획 변경은
  // 금액을 한 번 더 생각할 시간이 필요하고, 바로 눌러 끝내는 것은 10분이면 된다.
  // 정책에서 파생시키면 정책이 전부 single이 된 순간 이미 발급된 24시간 카드가
  // 모두 만료로 죽는다.
  for (const input of [{ schedule_scope: "confirmed_fact" }, {}]) {
    assert.equal(
      getAmoraPendingActionTtlMs("add_schedule_event", input),
      24 * 60 * 60 * 1_000,
    );
  }
  assert.equal(
    getAmoraPendingActionTtlMs("update_schedule_event", {}),
    24 * 60 * 60 * 1_000,
  );
  assert.equal(
    getAmoraPendingActionTtlMs("toggle_checklist_item", {}),
    10 * 60 * 1_000,
  );

  // 저장된 카드의 만료 시각이 그 도구의 창과 다르면 읽지 않는다.
  const sharedPlanCard = {
    ...action,
    input: { date: "2026-08-02", title: "상담" },
    expiresAt: action.issuedAt + 24 * 60 * 60 * 1_000,
  };
  assert.deepEqual(getPendingAmoraAction(message({
    metadata: { pending_amora_action: sharedPlanCard },
  })), sharedPlanCard);
  assert.equal(getPendingAmoraAction(message({
    metadata: {
      pending_amora_action: {
        ...sharedPlanCard,
        expiresAt: action.issuedAt + 10 * 60 * 1_000,
      },
    },
  })), null);
});

test("mobile presents every couple approval state truthfully", () => {
  const zero = parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: false,
    acceptedCount: 0,
    requiredCount: 2,
    partnerLinked: true,
    ready: false,
  });
  assert.equal(
    getSharedActionApprovalPresentation(zero).copy,
    "두 분이 각각 확인해야 반영돼요 · 현재 0/2",
  );

  const mine = parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: true,
    acceptedCount: 1,
    requiredCount: 2,
    partnerLinked: true,
    ready: false,
  });
  assert.deepEqual(
    getSharedActionApprovalPresentation(mine),
    {
      copy: "내 확인 1/2 · 아직 반영되지 않았어요. 적용 요청 전까지 취소할 수 있어요.",
      applyLabel: "상대방 확인 기다리는 중",
      waitingForPartner: true,
      canWithdraw: true,
    },
  );

  const partner = parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: false,
    acceptedCount: 1,
    requiredCount: 2,
    partnerLinked: true,
    ready: false,
  });
  assert.equal(
    getSharedActionApprovalPresentation(partner).copy,
    "상대방 확인 1/2 · 내 확인을 누르면 바로 반영을 시작해요.",
  );
  assert.equal(
    getSharedActionApprovalPresentation(partner).applyLabel,
    "확인하고 바로 반영",
  );

  const ready = parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: true,
    acceptedCount: 2,
    requiredCount: 2,
    partnerLinked: true,
    ready: true,
  });
  assert.equal(
    getSharedActionApprovalPresentation(ready).copy,
    "두 분 확인 완료 · 반영하기를 누르면 바로 적용 요청이 시작돼요.",
  );
  assert.equal(
    getSharedActionApprovalPresentation(ready).applyLabel,
    "두 분 확인 완료 · 반영하기",
  );

  const unlinked = parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: false,
    acceptedCount: 0,
    requiredCount: 1,
    partnerLinked: false,
    ready: false,
  });
  assert.equal(
    getSharedActionApprovalPresentation(unlinked).copy,
    "파트너 연결 전이라 내 확인으로 반영돼요.",
  );
  assert.equal(
    getSharedActionApprovalPresentation(unlinked).applyLabel,
    "확인하고 반영",
  );
  assert.equal(parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: true,
    acceptedCount: 2,
    requiredCount: 2,
    partnerLinked: true,
    ready: false,
  }), null);
  assert.equal(parseSharedActionApprovalStatus({
    approvalMode: "couple",
    accepted: false,
    acceptedCount: 0,
    requiredCount: 1,
    partnerLinked: true,
    ready: false,
  }), null);
});

test("mobile fails closed unless the budget preview matches action digest and journey revision", () => {
  const budgetAction = {
    ...action,
    tool: "update_budget",
    input: { budget: 50_000_000 },
    expiresAt: action.issuedAt + 24 * 60 * 60 * 1_000,
  };
  const preview = {
    version: 1,
    kind: "budget_change",
    tool: "update_budget",
    inputDigest: budgetAction.inputDigest,
    sourceRevision: 7,
    recordedSpendBasis: "explicit_spent_only",
    current: {
      totalBudget: 40_000_000,
      allocatedBudget: 30_000_000,
      recordedSpend: 5_000_000,
      unallocatedBudget: 10_000_000,
    },
    proposed: {
      totalBudget: 50_000_000,
      allocatedBudget: 30_000_000,
      recordedSpend: 5_000_000,
      unallocatedBudget: 20_000_000,
    },
    delta: {
      totalBudget: 10_000_000,
      allocatedBudget: 0,
      recordedSpend: 0,
      unallocatedBudget: 10_000_000,
    },
    categories: [],
    warnings: [],
  };
  const budgetMessage = message({
    metadata: {
      pending_amora_action: budgetAction,
      pending_amora_action_journey_revision: 7,
      pending_amora_action_impact_preview: preview,
    },
  });

  assert.deepEqual(
    getPendingAmoraBudgetImpactPreview(budgetMessage, budgetAction),
    preview,
  );
  assert.equal(getPendingAmoraBudgetImpactPreview({
    ...budgetMessage,
    metadata: {
      ...budgetMessage.metadata,
      pending_amora_action_journey_revision: 8,
    },
  }, budgetAction), null);
  assert.equal(getPendingAmoraBudgetImpactPreview({
    ...budgetMessage,
    metadata: {
      ...budgetMessage.metadata,
      pending_amora_action_impact_preview: {
        ...preview,
        inputDigest: "c".repeat(64),
      },
    },
  }, budgetAction), null);
  assert.equal(getPendingAmoraBudgetImpactPreview(
    budgetMessage,
    {
      ...budgetAction,
      actionId: "44444444-4444-4444-8444-444444444444",
    },
  ), null);
});

function message(overrides = {}) {
  return {
    sender_type: "ai",
    visibility: "shared",
    metadata: { pending_amora_action: action },
    ...overrides,
  };
}

test("mobile accepts pending actions only from structurally valid shared AI metadata", () => {
  assert.deepEqual(getPendingAmoraAction(message()), action);
  assert.equal(getPendingAmoraAction(message({ visibility: "bride_private" })), null);
  assert.equal(getPendingAmoraAction(message({ sender_type: "bride" })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, actionId: "not-a-uuid" } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, input: [] } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, issuedAt: "2026-07-17T00:00:00.000Z" } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, expiresAt: action.expiresAt + 1 } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, inputDigest: "wrong" } },
  })), null);
  assert.equal(getPendingAmoraAction(message({
    metadata: { pending_amora_action: { ...action, operationKey: "wrong" } },
  })), null);
  const blocked = getPendingAmoraAction(message({
    metadata: {
      pending_amora_action: {
        ...action,
        tool: "update_amora_action",
        // 공유 계획 도구가 아니므로 창이 10분이다. 만료 시각이 도구와 맞아야
        // 파싱된다 — 막힌 도구도 "막혔다"고 보여주려면 읽히긴 해야 한다.
        expiresAt: action.issuedAt + 10 * 60 * 1_000,
      },
    },
  }));
  assert.equal(blocked?.tool, "update_amora_action");
  assert.equal(
    getAmoraActionApprovalPolicy(blocked?.tool ?? "", blocked?.input),
    "blocked",
  );
});

test("mobile disables expired, superseded, and in-flight actions", () => {
  const beforeExpiry = action.expiresAt - 1;
  assert.equal(getPendingActionDisabledReason(action, beforeExpiry, true, false), null);
  assert.equal(getPendingActionDisabledReason(action, action.expiresAt, true, false), "expired");
  assert.equal(getPendingActionDisabledReason(action, beforeExpiry, false, false), "not_latest");
  assert.equal(getPendingActionDisabledReason(action, beforeExpiry, true, true), "busy");
});

// 휴대폰은 시계가 어긋나 있는 일이 흔하다. 그때 방금 받은 제안이 만료로 보이면
// 그 사람은 아모라가 제안한 어떤 변경도 확인할 수 없다. 진짜 만료는 서버가 막는다.
test("mobile does not call a fresh proposal expired when the phone clock lags the server", () => {
  const laggingClock = action.issuedAt - 1_500;
  assert.ok(laggingClock < action.expiresAt);
  assert.equal(isPendingAmoraActionExpired(action, laggingClock), false);
  assert.equal(getPendingActionDisabledReason(action, laggingClock, true, false), null);
});

test("mobile does not call a proposal expired before the clock has been read", () => {
  assert.equal(isPendingAmoraActionExpired(action, 0), false);
  assert.equal(isPendingAmoraActionExpired(action, Number.NaN), false);
  assert.equal(getPendingActionDisabledReason(action, 0, true, false), null);
});

test("mobile still expires once the clock is usable and the server instant has passed", () => {
  assert.equal(isPendingAmoraActionExpired(action, action.expiresAt), true);
  assert.equal(isPendingAmoraActionExpired(action, action.expiresAt + 60_000), true);
  assert.equal(getPendingActionDisabledReason(action, action.expiresAt, true, false), "expired");
});

test("mobile confirmation button sends and retries the exact server action id", () => {
  assert.match(chatSource, /confirmedActionId\?: string/);
  assert.match(chatSource, /confirmedActionId: draft\.confirmedActionId/);
  assert.match(chatSource, /async function handleApplyPendingAction\(actionId: string\)/);
  assert.match(chatSource, /const content = "좋아요\. 제안한 변경을 적용해 주세요\."/);
  assert.match(chatSource, /text: content/);
  assert.match(chatSource, /confirmedActionId: actionId/);
  assert.match(chatSource, /await streamAiRequest\(failure\.request\)/);
});

test("mobile obtains the single application lease before sending a confirmation", () => {
  const handlerStart = chatSource.indexOf(
    "async function handleApplyPendingAction(actionId: string)",
  );
  const handlerEnd = chatSource.indexOf(
    "function handleScopeChange",
    handlerStart,
  );
  const handler = chatSource.slice(handlerStart, handlerEnd);

  assert.match(
    chatSource,
    // P0-2 이후 이 요청은 누른 사람에 결박된다. lease를 얻는다는 원래 의도에
    // 더해 결박까지 함께 고정한다.
    /requestAmoraSharedAction\(actionId, messageId, "PUT", expectedUserId\)/,
  );
  assert.match(chatSource, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(
    handler,
    /await requestAmoraApplicationClaim\(\s*actionId,\s*latestSharedMessage\.id,\s*sessionUserIdRef\.current,\s*\)/,
  );
  assert.ok(
    handler.indexOf("await requestAmoraApplicationClaim(")
      < handler.indexOf("await sendAiDraft("),
  );
  assert.match(handler, /if \(!claim\.applicationGranted\)/);
  assert.match(
    chatSource,
    /confirmed_amora_action_id: draft\.confirmedActionId[\s\S]*client_request_id: draft\.clientRequestId/,
  );
});

test("mobile retry reconciles a durable confirmation before reacquiring its lease", () => {
  const senderStart = chatSource.indexOf(
    "async function sendAiDraft(draft: AiDraft, reconcileFirst: boolean)",
  );
  const senderEnd = chatSource.indexOf(
    "async function handleRetry()",
    senderStart,
  );
  const sender = chatSource.slice(senderStart, senderEnd);

  assert.match(chatSource, /amoraSourceMessageId\?: string/);
  assert.match(
    sender,
    /let durableMessage = reconcileFirst\s*\?\s*await findDurableUserMessage\(draft, "ai"\)/,
  );
  assert.match(
    sender,
    /await requestAmoraApplicationClaim\(\s*draft\.confirmedActionId,\s*draft\.amoraSourceMessageId,\s*sessionUserIdRef\.current,\s*\)/,
  );
  assert.ok(
    sender.indexOf('findDurableUserMessage(draft, "ai")')
      < sender.indexOf("requestAmoraApplicationClaim("),
  );
  assert.match(
    chatSource,
    /amoraSourceMessageId: latestSharedMessage\.id/,
  );
  assert.match(
    chatSource,
    /draft\.confirmedActionId[\s\S]*confirmed_amora_action_id: draft\.confirmedActionId[\s\S]*client_request_id: draft\.clientRequestId/,
  );
  assert.doesNotMatch(chatSource, /draft\.startedAt/);
});

test("mobile restores an owned durable confirmation and ignores direct partner chat for freshness", () => {
  assert.match(
    chatSource,
    /\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)\s*\.limit\(200\)/,
  );
  assert.match(
    chatSource,
    /\.or\("metadata->>target\.is\.null,metadata->>target\.neq\.partner"\), viewCursors\.shared\)\s*\.order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)\s*\.limit\(1\)\s*\.maybeSingle\(\)/,
  );
  assert.match(chatSource, /const historyMessages = boundedHistory\s*\.sort\(/);
  assert.match(
    chatSource,
    /const durableConfirmation = canonicalShared\[canonicalShared\.length - 1\]/,
  );
  assert.match(
    chatSource,
    /message\.visibility === "shared"\s*&& message\.metadata\?\.target !== "partner"/,
  );
  assert.match(
    chatSource,
    /message: "확인은 안전하게 저장됐어요\. 반영을 이어서 완료해 주세요\."/,
  );
  assert.match(chatSource, /"반영 계속하기"/);
});

test("mobile exposes explicit 44-point apply and dismiss controls", () => {
  assert.match(chatSource, /: "확인한 내용을 이대로 적용"/);
  assert.match(chatSource, /accessibilityLabel=\{applyAccessibilityLabel\}/);
  assert.match(chatSource, /accessibilityLabel="지금은 적용하지 않기"/);
  assert.match(chatSource, /pendingActionButton: \{[^}]*minHeight: 44/);
  assert.match(chatSource, /pendingActionDismiss: \{[^}]*minHeight: 44/);
});

test("mobile uses Bearer-authenticated GET, POST, DELETE, and PUT shared-action flows", () => {
  assert.match(
    chatSource,
    /type AmoraSharedActionMethod = "GET" \| "POST" \| "DELETE" \| "PUT"/,
  );
  assert.match(
    chatSource,
    /Authorization: `Bearer \$\{accessToken\}`/,
  );
  assert.match(chatSource, /requestAmoraSharedActionStatus\(/);
  assert.match(chatSource, /requestAmoraSharedActionApproval\([^)]*"POST"/s);
  assert.match(chatSource, /requestAmoraSharedActionApproval\([^)]*"DELETE"/s);
  assert.match(chatSource, /requestAmoraApplicationClaim\(/);
  assert.match(chatSource, /async function handleWithdrawPendingAction\(actionId: string\)/);
});

test("mobile renders truthful couple progress and bound budget impact copy", () => {
  assert.match(chatSource, /getAmoraActionApprovalPolicy\(pendingAction\.tool, pendingAction\.input\)/);
  assert.match(chatSource, /getSharedActionApprovalPresentation\(/);
  assert.match(chatSource, /두 분 확인이 필요한 변경이에요/);
  assert.match(chatSource, /내 공동 변경 확인 취소/);
  assert.match(chatSource, /getPendingAmoraBudgetImpactPreview\(item, pendingAction\)/);
  assert.match(chatSource, /총예산/);
  assert.match(chatSource, /배분 합계/);
  assert.match(chatSource, /기록 지출/);
  assert.match(
    chatSource,
    /기록 지출은 사용자가 명시적으로 입력한 금액이며, 결제 증거나 결제 완료를 뜻하지 않아요\./,
  );
});

/**
 * 이월된 카드는 이월됐다고 말한다 (2026-09-04).
 *
 * 확인하지 않은 카드는 다음 답변으로 따라간다. 그래서 새 문장 아래에 직전 턴의 다른
 * 카드가 붙는 일이 생기고, 사용자는 방금 읽은 문장이 곧 이 버튼이라고 읽고 누른다.
 * 판정은 **서버 metadata 값**으로만 한다 — 화면이 직전 행을 뒤져 추측하지 않는다.
 */
const carryCases = [
  { name: "값이 없으면 0", metadata: { pending_amora_action: action }, expected: 0 },
  { name: "1이면 1", metadata: { pending_amora_action: action, pending_amora_action_carry_count: 1 }, expected: 1 },
  { name: "2면 2", metadata: { pending_amora_action: action, pending_amora_action_carry_count: 2 }, expected: 2 },
  { name: "0은 원본 턴", metadata: { pending_amora_action: action, pending_amora_action_carry_count: 0 }, expected: 0 },
  { name: "문자열은 안 믿는다", metadata: { pending_amora_action_carry_count: "2" }, expected: 0 },
  { name: "소수는 안 믿는다", metadata: { pending_amora_action_carry_count: 1.5 }, expected: 0 },
  { name: "음수는 안 믿는다", metadata: { pending_amora_action_carry_count: -1 }, expected: 0 },
];

test("이월 횟수는 서버가 찍은 값으로만 정한다", () => {
  for (const { name, metadata, expected } of carryCases) {
    assert.equal(
      getPendingAmoraActionCarryCount({ sender_type: "ai", visibility: "shared", metadata }),
      expected,
      name,
    );
  }

  // 사람이 쓴 행·비공개 행·metadata 없는 행에서는 읽지 않는다.
  assert.equal(
    getPendingAmoraActionCarryCount({
      sender_type: "bride",
      visibility: "shared",
      metadata: { pending_amora_action_carry_count: 2 },
    }),
    0,
  );
  assert.equal(
    getPendingAmoraActionCarryCount({
      sender_type: "ai",
      visibility: "bride_private",
      metadata: { pending_amora_action_carry_count: 2 },
    }),
    0,
  );
  assert.equal(
    getPendingAmoraActionCarryCount({ sender_type: "ai", visibility: "shared", metadata: null }),
    0,
  );
});

test("모바일 카드가 이월 라벨을 그리고 확인문을 제목 자리에 올린다", () => {
  // 판정을 서버 값에서만 가져온다 — 직전 행을 뒤지지 않는다.
  assert.match(chatSource, /getPendingAmoraActionCarryCount\(item\) >= 1/);
  // 라벨과 모양이 함께 붙는다.
  assert.match(chatSource, /\{CARRIED_PENDING_ACTION_LABEL\}/);
  assert.match(chatSource, /pendingActionIsCarriedForward && st\.pendingActionCarriedCard/);
  assert.match(chatSource, /pendingActionCarriedCard: \{[^}]*borderStyle: "dashed"/);
  // 이월이면 확인문이 제목 자리에 온다(무엇을 바꾸는지가 먼저).
  assert.match(
    chatSource,
    /pendingActionIsCarriedForward\s*\?\s*pendingAction\.confirmation/,
  );
  // 확인 버튼 문구는 그대로다.
  assert.match(chatSource, /: "확인한 내용을 이대로 적용"/);
});
