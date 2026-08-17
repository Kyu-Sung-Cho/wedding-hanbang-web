import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

import {
  buildPreparationTopicChatReturnDestination,
  createPreparationTopicChatComposerBinding,
  createPreparationTopicChatReturnReceipt,
  parsePreparationTopicChatHandoffBinding,
  reconcilePreparationTopicChatComposerBinding,
} from "../lib/preparationTopicChatRoundTrip.mjs";
import {
  consumeCompanionChatHandoff,
  stagePrivateChatHandoff,
} from "../lib/companionChatHandoff.mjs";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER_ID = "10000000-0000-4000-8000-000000000002";
const COUPLE_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const HANDOFF_ID = "30000000-0000-4000-8000-000000000001";
const ASSISTANT_MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const CLIENT_REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const PROMPT = "부모님 첫 만남 준비에서 참석자와 가능한 날짜부터 같이 정리해줘.";
const TOPIC = Object.freeze({
  topicKey: "meeting",
  topicLabel: "부모님 첫 만남",
  journeyRevision: 7,
  actionRef: Object.freeze({
    id: "act_meeting_next_step",
    revision: 3,
  }),
});

const chatSource = readFileSync(fileURLToPath(new URL(
  "../../app/(tabs)/chat.tsx",
  import.meta.url,
)), "utf8");
const scheduleSource = readFileSync(fileURLToPath(new URL(
  "../../app/schedule/index.tsx",
  import.meta.url,
)), "utf8");
const summarySource = readFileSync(fileURLToPath(new URL(
  "../components/planning/PreparationTopicSummary.tsx",
  import.meta.url,
)), "utf8");

test("a preparation-topic handoff survives only one exact owner and couple consume", () => {
  assert.deepEqual(parsePreparationTopicChatHandoffBinding(TOPIC), TOPIC);
  assert.equal(stagePrivateChatHandoff({
    handoffId: HANDOFF_ID,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    prompt: PROMPT,
    preparationTopic: TOPIC,
  }), HANDOFF_ID);
  assert.deepEqual(
    consumeCompanionChatHandoff(HANDOFF_ID, OWNER_ID, COUPLE_ID),
    { prompt: PROMPT, preparationTopic: TOPIC },
  );
  assert.equal(consumeCompanionChatHandoff(HANDOFF_ID, OWNER_ID, COUPLE_ID), null);

  stagePrivateChatHandoff({
    handoffId: HANDOFF_ID,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    prompt: PROMPT,
    preparationTopic: TOPIC,
  });
  assert.equal(consumeCompanionChatHandoff(HANDOFF_ID, OWNER_ID, OTHER_COUPLE_ID), null);
});

test("topic source bindings reject unknown topics, loose revisions, partial actions, and extra keys", () => {
  for (const value of [
    { ...TOPIC, topicKey: "other" },
    { ...TOPIC, journeyRevision: -1 },
    { ...TOPIC, actionRef: { id: TOPIC.actionRef.id } },
    { ...TOPIC, actionRef: { ...TOPIC.actionRef, revision: 0 } },
    { ...TOPIC, extra: true },
  ]) {
    assert.equal(parsePreparationTopicChatHandoffBinding(value), null);
  }
  assert.equal(stagePrivateChatHandoff({
    handoffId: HANDOFF_ID,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    prompt: PROMPT,
    preparationTopic: TOPIC,
    scheduleCareFollowUp: {},
  }), null);
});

test("editing the private draft or changing identity removes the exact topic binding", () => {
  const binding = createPreparationTopicChatComposerBinding({
    preparationTopic: TOPIC,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    prompt: PROMPT,
  });
  assert.ok(binding);
  assert.equal(reconcilePreparationTopicChatComposerBinding(binding, {
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    lane: "private_ai",
    privateText: PROMPT,
  }), binding);
  for (const context of [
    { ownerUserId: OWNER_ID, coupleId: COUPLE_ID, lane: "private_ai", privateText: `${PROMPT} 수정` },
    { ownerUserId: OTHER_OWNER_ID, coupleId: COUPLE_ID, lane: "private_ai", privateText: PROMPT },
    { ownerUserId: OWNER_ID, coupleId: OTHER_COUPLE_ID, lane: "private_ai", privateText: PROMPT },
    { ownerUserId: OWNER_ID, coupleId: COUPLE_ID, lane: "shared_ai", privateText: PROMPT },
  ]) {
    assert.equal(reconcilePreparationTopicChatComposerBinding(binding, context), null);
  }
});

test("only a persisted private Amora answer creates one exact topic return destination", () => {
  const binding = createPreparationTopicChatComposerBinding({
    preparationTopic: TOPIC,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    prompt: PROMPT,
  });
  const receipt = createPreparationTopicChatReturnReceipt({
    binding,
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    lane: "private_ai",
    visibility: "bride_private",
    requestText: PROMPT,
    responseText: "가능한 날짜 세 개를 먼저 적어볼까요?",
    serverMessageId: ASSISTANT_MESSAGE_ID,
    serverRequestKey: `chat:${OWNER_ID}:${CLIENT_REQUEST_ID}`,
  });
  assert.ok(receipt);
  assert.deepEqual(buildPreparationTopicChatReturnDestination(receipt, {
    ownerUserId: OWNER_ID,
    coupleId: COUPLE_ID,
  }), {
    pathname: "/checklist",
    params: {
      category: "meeting",
      action: "act_meeting_next_step",
      actionRevision: "3",
    },
  });

  for (const override of [
    { serverMessageId: null },
    { visibility: "shared" },
    { requestText: `${PROMPT} 수정` },
    { responseText: "" },
    { ownerUserId: OTHER_OWNER_ID },
  ]) {
    assert.equal(createPreparationTopicChatReturnReceipt({
      binding,
      ownerUserId: OWNER_ID,
      coupleId: COUPLE_ID,
      lane: "private_ai",
      visibility: "bride_private",
      requestText: PROMPT,
      responseText: "가능한 날짜 세 개를 먼저 적어볼까요?",
      serverMessageId: ASSISTANT_MESSAGE_ID,
      serverRequestKey: `chat:${OWNER_ID}:${CLIENT_REQUEST_ID}`,
      ...override,
    }), null);
  }
  assert.equal(buildPreparationTopicChatReturnDestination(receipt, {
    ownerUserId: OTHER_OWNER_ID,
    coupleId: COUPLE_ID,
  }), null);
});

test("the topic-chat round trip is explicit, private, receipt-bound, and write-free on return", () => {
  assert.match(summarySource, /onContinueWithAmora\?\.\(amoraHandoff\)/);
  assert.match(scheduleSource, /stagePrivateChatHandoff\(\{[\s\S]{0,300}preparationTopic:/);
  assert.match(scheduleSource, /topicKey:\s*cat\.key/);
  assert.match(scheduleSource, /journeyRevision:\s*topicJourneyRevision/);

  const consumeStart = chatSource.indexOf("const handoff = consumeCompanionChatHandoff(");
  const consumeEnd = chatSource.indexOf("useEffect(() =>", consumeStart + 1);
  const consumeEffect = chatSource.slice(consumeStart, consumeEnd);
  assert.match(consumeEffect, /createPreparationTopicChatComposerBinding/);
  assert.doesNotMatch(consumeEffect, /handleSend|sendAiDraft|requestAiMessageIngest|requestChatStream/);

  assert.match(chatSource, /interface AiRequest[\s\S]{0,500}preparationTopic\?: PreparationTopicChatComposerBinding/);
  assert.match(
    chatSource,
    /canonicalUserMessage\.content === draft\.preparationTopic\.prompt/,
  );
  assert.match(chatSource, /createPreparationTopicChatReturnReceipt\(\{/);
  assert.match(
    chatSource,
    /requestText:\s*request\.body\.messages\[request\.body\.messages\.length - 1\]\?\.content/,
  );
  assert.match(chatSource, /completion\.metadata\?\.serverMessageId/);
  assert.match(chatSource, /이 준비 주제로 돌아가기/);
  assert.match(
    chatSource,
    /나만 상담에 작성 중인 내용이 있어 준비 주제 질문을 덮어쓰지 않았어요/,
  );
  assert.match(
    chatSource,
    /질문을 수정해 일반 나만 상담으로 이어가요/,
  );
  assert.match(chatSource, /buildPreparationTopicChatReturnDestination/);

  const returnHandlerStart = chatSource.indexOf("function handlePreparationTopicReturn");
  const returnHandlerEnd = chatSource.indexOf("\n  function ", returnHandlerStart + 10);
  const returnHandler = chatSource.slice(returnHandlerStart, returnHandlerEnd);
  assert.match(returnHandler, /router\.push/);
  assert.doesNotMatch(
    returnHandler,
    /requestAiMessageIngest|requestChatStream|decision_nodes|amora_actions|\.insert\(|\.update\(/,
  );
});
