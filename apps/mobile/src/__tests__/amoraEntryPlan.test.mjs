import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  buildFirstUseCriterionCorrectionDraft,
  buildFirstUseCorrectionDraft,
  buildFirstUseSharedActionDraft,
  buildAmoraEntryPlan,
  buildAmoraHomeDraft,
  extractFirstUseActionDraft,
  extractFirstUseActionNarrative,
  getReviewedActionContinuationPresentation,
  resolveFirstUseActionBubbleContent,
  resolveAmoraChatEntry,
  selectPrivateActionDraftForBridge,
  verifyFirstUseActionPromotion,
} from "../lib/amoraEntryPlan.mjs";
import {
  consumeCompanionChatHandoff,
  stageCompanionChatHandoff,
  stagePrivateChatHandoff,
} from "../lib/companionChatHandoff.mjs";

test("only the explicit first-use route opens the private personalization entry", () => {
  assert.equal(resolveAmoraChatEntry("first_use"), "first_use");
  assert.equal(resolveAmoraChatEntry(["first_use"]), "first_use");
  assert.equal(resolveAmoraChatEntry(["first_use", "unexpected"]), null);
  assert.equal(resolveAmoraChatEntry("FIRST_USE"), null);
  assert.equal(resolveAmoraChatEntry("shared"), null);
  assert.equal(resolveAmoraChatEntry(null), null);
});

test("the first-use chat route switches only a verified couple into a private AI draft", () => {
  const chatSource = readFileSync(
    fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(chatSource, /entry\?: string \| string\[\]/);
  assert.match(chatSource, /resolveAmoraChatEntry\(routeParams\.entry\)/);
  assert.match(chatSource, /const consumedFirstUseEntryRef = useRef<string \| null>\(null\)/);

  const effectStart = chatSource.indexOf('firstUseEntry !== "first_use"');
  const effectEnd = chatSource.indexOf("]);", effectStart);
  assert.ok(effectStart > 0 && effectEnd > effectStart);
  const entryEffect = chatSource.slice(effectStart, effectEnd);
  assert.match(entryEffect, /!initialLoaded/);
  assert.match(entryEffect, /!userId/);
  assert.match(entryEffect, /!userRole/);
  assert.match(entryEffect, /!coupleId/);
  assert.match(entryEffect, /setActiveScope\("private"\)/);
  assert.match(entryEffect, /setTarget\("ai"\)/);
  assert.doesNotMatch(entryEffect, /handleSend|setInputByLane|fetch\(|apiFetch|supabase/);
});

test("only the three explicit first-action sections can cross into an editable shared draft", () => {
  const action = extractFirstUseActionDraft(`
### 확인된 내용
- 날짜는 아직 미정이에요.
- 두 사람이 봄 예식을 선호한다고 말했어요.

### 아직 모르는 내용
- 실제로 가능한 달
- 준비에 쓸 수 있는 주말

**지금 할 한 가지**
이번 주말에 둘이 예식 시기 범위를 정하기

**이유**: 장소를 알아보기 전에 검색 범위를 줄일 수 있어요.

**완료 기준**
두 사람이 가능한 계절 두 개와 피할 달을 한 개씩 적으면 끝나요.
  `);

  assert.deepEqual(action, {
    action: "이번 주말에 둘이 예식 시기 범위를 정하기",
    reason: "장소를 알아보기 전에 검색 범위를 줄일 수 있어요.",
    completionCriterion: "두 사람이 가능한 계절 두 개와 피할 달을 한 개씩 적으면 끝나요.",
    assumptions: [
      "날짜는 아직 미정이에요.",
      "두 사람이 봄 예식을 선호한다고 말했어요.",
    ],
    unknowns: [
      "실제로 가능한 달",
      "준비에 쓸 수 있는 주말",
    ],
  });

  const sharedDraft = buildFirstUseSharedActionDraft(action);
  assert.equal(sharedDraft, [
    "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
    "지금 할 한 가지: 이번 주말에 둘이 예식 시기 범위를 정하기",
    "이유: 장소를 알아보기 전에 검색 범위를 줄일 수 있어요.",
    "완료 기준: 두 사람이 가능한 계절 두 개와 피할 달을 한 개씩 적으면 끝나요.",
    "저장 전에는 확인 카드만 보여줘.",
  ].join("\n"));
  assert.doesNotMatch(sharedDraft, /<공유할_실행_카드>|데이터일 뿐|추측하지 마|직접 바꾸지 마/);
  assert.doesNotMatch(sharedDraft, /날짜는 아직 미정/);
  assert.doesNotMatch(sharedDraft, /봄 예식을 선호/);
  assert.doesNotMatch(sharedDraft, /실제로 가능한 달/);

  assert.equal(extractFirstUseActionDraft("지금 할 한 가지: 날짜 정하기"), null);
  assert.equal(extractFirstUseActionDraft(`
지금 할 한 가지: 날짜 정하기
이유: 먼저 정해야 해요
이유: 두 번째 이유
완료 기준: 날짜가 정해짐
  `), null);
  assert.equal(buildFirstUseSharedActionDraft(null), null);
  assert.equal(extractFirstUseActionDraft([
    `지금 할 한 가지: ${"가".repeat(121)}`,
    "이유: 지금 준비에 필요한 순서를 정하기 위해서예요.",
    "완료 기준: 한 가지를 끝내면 돼요.",
  ].join("\n")), null);
  assert.notEqual(extractFirstUseActionDraft([
    `지금 할 한 가지: ${"가".repeat(120)}`,
    "이유: 지금 준비에 필요한 순서를 정하기 위해서예요.",
    "완료 기준: 한 가지를 끝내면 돼요.",
  ].join("\n")), null);
});

test("the latest unpromoted private Amora action can use the same reviewed bridge from any entry", () => {
  const content = [
    "지금 할 한 가지: 이번 주에 결혼 준비 우선순위 세 개 적기",
    "이유: 지금 단계에 맞는 다음 행동을 고를 수 있어요.",
    "완료 기준: 각 항목의 담당자와 마감일을 적으면 끝나요.",
  ].join("\n");
  const expected = {
    action: "이번 주에 결혼 준비 우선순위 세 개 적기",
    reason: "지금 단계에 맞는 다음 행동을 고를 수 있어요.",
    completionCriterion: "각 항목의 담당자와 마감일을 적으면 끝나요.",
    assumptions: [],
    unknowns: [],
    sourceRevision: 5,
  };
  const grounding = {
    version: 1,
    sourceRevision: 5,
    confirmed: [],
    unknowns: [],
  };

  assert.deepEqual(selectPrivateActionDraftForBridge({
    activeScope: "private",
    senderType: "ai",
    isLatestPrivateAiMessage: true,
    isAlreadyPromoted: false,
    content,
    sourceRevision: 5,
    grounding,
  }), expected);
  assert.equal(selectPrivateActionDraftForBridge({
    activeScope: "shared",
    senderType: "ai",
    isLatestPrivateAiMessage: true,
    isAlreadyPromoted: false,
    content,
    sourceRevision: 5,
    grounding,
  }), null);
  assert.equal(selectPrivateActionDraftForBridge({
    activeScope: "private",
    senderType: "ai",
    isLatestPrivateAiMessage: false,
    isAlreadyPromoted: false,
    content,
    sourceRevision: 5,
    grounding,
  }), null);
  assert.equal(selectPrivateActionDraftForBridge({
    activeScope: "private",
    senderType: "ai",
    isLatestPrivateAiMessage: true,
    isAlreadyPromoted: true,
    content,
    sourceRevision: 5,
    grounding,
  }), null);
});

test("the first action card shows canonical progress instead of model-written assumptions", () => {
  const content = [
    "확인된 내용",
    "- 모델이 추측한 진행 상황",
    "아직 모르는 내용",
    "- 모델이 추측한 미확인 내용",
    "지금 할 한 가지: 다음 준비 한 가지 고르기",
    "이유: 지금 상태에 맞는 순서로 이어가기 위해서예요.",
    "완료 기준: 한 가지를 고르면 끝나요.",
  ].join("\n");
  const grounding = {
    version: 1,
    sourceRevision: 7,
    confirmed: [
      { key: "wedding_date", label: "결혼식 날짜: 2027-05-22" },
    ],
    unknowns: [
      { key: "current_progress", label: "이미 마친 준비와 아직 남은 준비" },
    ],
  };

  assert.deepEqual(selectPrivateActionDraftForBridge({
    activeScope: "private",
    senderType: "ai",
    isLatestPrivateAiMessage: true,
    isAlreadyPromoted: false,
    content,
    sourceRevision: 7,
    grounding,
  }), {
    action: "다음 준비 한 가지 고르기",
    reason: "지금 상태에 맞는 순서로 이어가기 위해서예요.",
    completionCriterion: "한 가지를 고르면 끝나요.",
    assumptions: ["결혼식 날짜: 2027-05-22"],
    unknowns: ["이미 마친 준비와 아직 남은 준비"],
    sourceRevision: 7,
  });
});

test("a private action without a server-bound wedding revision never becomes promotable", () => {
  const content = [
    "지금 할 한 가지: 저장된 준비 목록에서 다음 한 가지 고르기",
    "이유: 지금 상태에 맞는 순서로 이어가기 위해서예요.",
    "완료 기준: 선택한 한 가지를 끝내면 돼요.",
  ].join("\n");
  const base = {
    activeScope: "private",
    senderType: "ai",
    isLatestPrivateAiMessage: true,
    isAlreadyPromoted: false,
    content,
  };

  assert.equal(selectPrivateActionDraftForBridge({
    ...base,
    sourceRevision: null,
  }), null);
  assert.equal(selectPrivateActionDraftForBridge({
    ...base,
    sourceRevision: "7",
  }), null);
  assert.equal(selectPrivateActionDraftForBridge({
    ...base,
    sourceRevision: 7,
  }), null);
  assert.equal(selectPrivateActionDraftForBridge({
    ...base,
    sourceRevision: 7,
    grounding: {
      version: 1,
      sourceRevision: 8,
      confirmed: [],
      unknowns: [],
    },
  }), null);
  assert.equal(selectPrivateActionDraftForBridge({
    ...base,
    sourceRevision: 7,
    grounding: {
      version: 1,
      sourceRevision: 7,
      confirmed: [],
      unknowns: [],
      privateNote: "should not cross",
    },
  }), null);
  assert.deepEqual(selectPrivateActionDraftForBridge({
    ...base,
    sourceRevision: 7,
    grounding: {
      version: 1,
      sourceRevision: 7,
      confirmed: [],
      unknowns: [
        { key: "current_progress", label: "이미 마친 준비와 아직 남은 준비" },
      ],
    },
  }), {
    action: "저장된 준비 목록에서 다음 한 가지 고르기",
    reason: "지금 상태에 맞는 순서로 이어가기 위해서예요.",
    completionCriterion: "선택한 한 가지를 끝내면 돼요.",
    assumptions: [],
    unknowns: ["이미 마친 준비와 아직 남은 준비"],
    sourceRevision: 7,
  });
});

test("a personalized action becomes stale when the wedding record changes before promotion", async () => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";

  const result = await verifyFirstUseActionPromotion({
    expectedOwnerUserId: ownerUserId,
    expectedCoupleId: coupleId,
    sourceRevision: 7,
    expectedCriterionDecisionId: null,
    readCurrentIdentity: async () => ({ ownerUserId, coupleId }),
    readCurrentJourneyRevision: async () => 8,
    readCurrentCriterionDecisionId: async () => ({ loaded: true, decisionId: null }),
  });

  assert.equal(result, "stale");
});

test("a personalized action is promoted only while owner, couple, and revision all stay exact", async () => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";
  let identityReadCount = 0;

  assert.equal(await verifyFirstUseActionPromotion({
    expectedOwnerUserId: ownerUserId,
    expectedCoupleId: coupleId,
    sourceRevision: 7,
    expectedCriterionDecisionId: null,
    readCurrentIdentity: async () => ({ ownerUserId, coupleId }),
    readCurrentJourneyRevision: async (requestedCoupleId) => {
      assert.equal(requestedCoupleId, coupleId);
      return 7;
    },
    readCurrentCriterionDecisionId: async () => ({ loaded: true, decisionId: null }),
  }), "ready");

  assert.equal(await verifyFirstUseActionPromotion({
    expectedOwnerUserId: ownerUserId,
    expectedCoupleId: coupleId,
    sourceRevision: 7,
    expectedCriterionDecisionId: null,
    readCurrentIdentity: async () => {
      identityReadCount += 1;
      return identityReadCount === 1
        ? { ownerUserId, coupleId }
        : {
            ownerUserId,
            coupleId: "33333333-3333-4333-8333-333333333333",
          };
    },
    readCurrentJourneyRevision: async () => 7,
    readCurrentCriterionDecisionId: async () => ({ loaded: true, decisionId: null }),
  }), "identity_changed");

  assert.equal(await verifyFirstUseActionPromotion({
    expectedOwnerUserId: ownerUserId,
    expectedCoupleId: coupleId,
    sourceRevision: 7,
    expectedCriterionDecisionId: null,
    readCurrentIdentity: async () => ({ ownerUserId, coupleId }),
    readCurrentJourneyRevision: async () => {
      throw new Error("offline");
    },
    readCurrentCriterionDecisionId: async () => ({ loaded: true, decisionId: null }),
  }), "unavailable");
});

test("a personalized action is bound to the exact current shared criterion", async () => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const criterionA = "33333333-3333-4333-8333-333333333333";
  const criterionB = "44444444-4444-4444-8444-444444444444";
  const verify = (currentDecisionId) => verifyFirstUseActionPromotion({
    expectedOwnerUserId: ownerUserId,
    expectedCoupleId: coupleId,
    sourceRevision: 7,
    expectedCriterionDecisionId: criterionA,
    readCurrentIdentity: async () => ({ ownerUserId, coupleId }),
    readCurrentJourneyRevision: async () => 7,
    readCurrentCriterionDecisionId: async (requestedOwnerUserId, requestedCoupleId) => {
      assert.equal(requestedOwnerUserId, ownerUserId);
      assert.equal(requestedCoupleId, coupleId);
      return { loaded: true, decisionId: currentDecisionId };
    },
  });

  const groundedDraft = selectPrivateActionDraftForBridge({
    activeScope: "private",
    senderType: "ai",
    isLatestPrivateAiMessage: true,
    isAlreadyPromoted: false,
    content: [
      "지금 할 한 가지: 이번 주 준비 한 가지 고르기",
      "이유: 우리 기준과 현재 준비 상태를 함께 보기 위해서예요.",
      "완료 기준: 담당자와 마감이 정해지면 끝나요.",
    ].join("\n"),
    sourceRevision: 7,
    grounding: {
      version: 1,
      sourceRevision: 7,
      confirmed: [],
      unknowns: [],
    },
    criterionDecisionId: criterionA,
  });
  assert.equal(groundedDraft?.criterionDecisionId, criterionA);
  assert.equal(selectPrivateActionDraftForBridge({
    activeScope: "private",
    senderType: "ai",
    isLatestPrivateAiMessage: true,
    isAlreadyPromoted: false,
    content: "지금 할 한 가지: 한 가지\n이유: 이유\n완료 기준: 완료",
    sourceRevision: 7,
    grounding: { version: 1, sourceRevision: 7, confirmed: [], unknowns: [] },
    criterionDecisionId: "not-a-uuid",
  }), null);

  assert.equal(await verify(criterionA), "ready");
  assert.equal(await verify(criterionB), "criterion_stale");
  assert.equal(await verify(null), "criterion_stale");
  assert.equal(await verifyFirstUseActionPromotion({
    expectedOwnerUserId: ownerUserId,
    expectedCoupleId: coupleId,
    sourceRevision: 7,
    expectedCriterionDecisionId: null,
    readCurrentIdentity: async () => ({ ownerUserId, coupleId }),
    readCurrentJourneyRevision: async () => 7,
    readCurrentCriterionDecisionId: async () => ({ loaded: true, decisionId: criterionA }),
  }), "criterion_stale");
  assert.equal(await verifyFirstUseActionPromotion({
    expectedOwnerUserId: ownerUserId,
    expectedCoupleId: coupleId,
    sourceRevision: 7,
    expectedCriterionDecisionId: criterionA,
    readCurrentIdentity: async () => ({ ownerUserId, coupleId }),
    readCurrentJourneyRevision: async () => 7,
    readCurrentCriterionDecisionId: async () => ({ loaded: false, decisionId: null }),
  }), "unavailable");
  assert.equal(
    buildFirstUseCriterionCorrectionDraft(),
    "우리 기준이 바뀌었어요. 현재 우리 기준과 준비 기록으로 다음 한 가지를 다시 맞춰줘.",
  );
});

test("personalization context is bounded, immutable, and never inferred from lookalike prose", () => {
  const draft = extractFirstUseActionDraft(`
확인된 내용
- 첫 번째 전제
- 두 번째 전제
- 세 번째 전제
- 화면에 넘기지 않을 네 번째 전제
아직 모르는 내용
- 첫 번째 미확인
- 두 번째 미확인
- 세 번째 미확인
- 화면에 넘기지 않을 네 번째 미확인
지금 할 한 가지: 둘이 이번 주 우선순위를 적기
이유: 현재 준비 단계에 맞는 순서를 고르기 위해서예요.
완료 기준: 우선순위 두 개와 담당자를 적으면 끝나요.
  `);

  assert.deepEqual(draft?.assumptions, [
    "첫 번째 전제",
    "두 번째 전제",
    "세 번째 전제",
  ]);
  assert.deepEqual(draft?.unknowns, [
    "첫 번째 미확인",
    "두 번째 미확인",
    "세 번째 미확인",
  ]);
  assert.equal(Object.isFrozen(draft), true);
  assert.equal(Object.isFrozen(draft?.assumptions), true);
  assert.equal(Object.isFrozen(draft?.unknowns), true);

  assert.equal(extractFirstUseActionDraft(`
이유는 먼저 날짜를 정해야 하기 때문이에요.
지금 할 한 가지: 날짜 범위 정하기
완료 기준: 가능한 달 두 개 적기
  `), null);
});

test("correcting a personalization premise starts one private editable sentence", () => {
  assert.equal(
    buildFirstUseCorrectionDraft(),
    "이 결혼 준비 실행 카드를 다시 맞춰줘. 틀리거나 바뀐 내용: ",
  );

  const bridgeSource = readFileSync(
    fileURLToPath(new URL("../components/chat/AmoraFirstUseActionCard.tsx", import.meta.url)),
    "utf8",
  );
  const chatSource = readFileSync(
    fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(bridgeSource, /이해한 내용 고치기/);
  assert.match(bridgeSource, /onCorrect/);
  assert.match(bridgeSource, /minHeight: 44/);
  assert.match(chatSource, /function handleCorrectFirstUseAction/);
  assert.match(chatSource, /buildFirstUseCorrectionDraft\(\)/);
  assert.match(chatSource, /current\.private_ai\.trim\(\)/);
  assert.match(chatSource, /updateAmoraChatLaneRecord\(current, "private_ai", correctionDraft\)/);
  assert.match(chatSource, /setActiveScope\("private"\)/);
  assert.match(chatSource, /setTarget\("ai"\)/);
  assert.match(chatSource, /chatInputRef\.current\?\.focus\(\)/);

  const handlerStart = chatSource.indexOf("function handleCorrectFirstUseAction");
  const handlerEnd = chatSource.indexOf("\n  }", handlerStart);
  assert.ok(handlerStart > 0 && handlerEnd > handlerStart);
  assert.doesNotMatch(
    chatSource.slice(handlerStart, handlerEnd),
    /handleSend|fetch\(|apiFetch|supabase|shared_ai/,
  );
});

test("the first action continuation explains the customer outcome without shared-draft jargon", () => {
  const presentation = getReviewedActionContinuationPresentation();

  assert.deepEqual(presentation, {
    label: "이 행동으로 준비 이어가기",
    accessibilityLabel: "확인한 행동으로 우리 준비 이어가기",
    accessibilityHint:
      "확인한 세 항목만 다음 화면에 채우며 자동으로 보내거나 저장하지 않습니다",
    scopeCopy:
      "확인한 행동·이유·완료 기준만 우리 준비로 가져가요. 나만 상담 내용은 가져가지 않고, 연결된 파트너와 함께 볼 수 있어요.",
    promise:
      "다음 화면에서 내용을 다시 확인하고 직접 보내야 추가돼요. 자동으로 보내거나 저장하지 않아요.",
  });
  assert.doesNotMatch(
    Object.values(presentation).join(" "),
    /공동 대화|공동 준비 초안|둘이 볼 초안/,
  );
  assert.equal(Object.isFrozen(presentation), true);
});

test("the personalized first action lets the user accept, revise, skip, and restore without hidden writes", () => {
  const bridgeSource = readFileSync(
    fileURLToPath(new URL("../components/chat/AmoraFirstUseActionCard.tsx", import.meta.url)),
    "utf8",
  );
  const chatSource = readFileSync(
    fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(bridgeSource, /getReviewedActionContinuationPresentation/);
  assert.match(bridgeSource, /continuationPresentation\.label/);
  assert.doesNotMatch(bridgeSource, /둘이 볼 초안 만들기/);
  assert.match(bridgeSource, /조금 바꿀래요/);
  assert.match(bridgeSource, /지금은 아니에요/);
  assert.match(bridgeSource, /이번 제안은 넘겼어요/);
  assert.match(bridgeSource, /저장하거나 공유한 내용은 없어요/);
  assert.match(bridgeSource, /다시 보기/);
  assert.match(bridgeSource, /onSkip/);
  assert.match(bridgeSource, /onRestore/);

  assert.match(
    chatSource,
    /const \[skippedFirstUseMessageIds, setSkippedFirstUseMessageIds\]/,
  );
  assert.match(chatSource, /function handleSkipFirstUseAction\(sourceMessageId: string\)/);
  assert.match(chatSource, /function handleRestoreFirstUseAction\(sourceMessageId: string\)/);
  assert.match(chatSource, /setSkippedFirstUseMessageIds\(new Set\(\)\)/);
  assert.match(chatSource, /skipped=\{skippedFirstUseMessageIds\.has\(item\.id\)\}/);
  assert.match(chatSource, /onSkip=\{\(\) => handleSkipFirstUseAction\(item\.id\)\}/);
  assert.match(chatSource, /onRestore=\{\(\) => handleRestoreFirstUseAction\(item\.id\)\}/);

  const skipStart = chatSource.indexOf("function handleSkipFirstUseAction");
  const skipEnd = chatSource.indexOf("\n  }", skipStart);
  assert.ok(skipStart > 0 && skipEnd > skipStart);
  assert.doesNotMatch(
    chatSource.slice(skipStart, skipEnd),
    /handleSend|fetch\(|apiFetch|supabase|setActiveScope|setTarget/,
  );
});

test("the structured action card removes duplicate sections without hiding surrounding guidance", () => {
  const response = `
지금 상황이라면 순서를 먼저 줄이는 게 좋아요.

확인된 내용
- 날짜는 아직 미정이에요.
아직 모르는 내용
- 가능한 계절
지금 할 한 가지: 이번 주말에 가능한 계절 정하기
이유: 장소 검색 범위를 줄일 수 있어요.
완료 기준: 가능한 계절 두 개를 적으면 끝나요.

급하게 확정하지 않아도 괜찮아요.
  `;

  assert.equal(
    extractFirstUseActionNarrative(response),
    "지금 상황이라면 순서를 먼저 줄이는 게 좋아요.\n\n급하게 확정하지 않아도 괜찮아요.",
  );
  assert.equal(extractFirstUseActionNarrative(`
확인된 내용
- 날짜는 아직 미정이에요.
지금 할 한 가지: 가능한 계절 정하기
이유: 검색 범위를 줄일 수 있어요.
완료 기준: 계절 두 개를 적으면 끝나요.
  `), null);
  assert.equal(
    extractFirstUseActionNarrative("그냥 자연스러운 답변이에요."),
    null,
  );

  const chatSource = readFileSync(
    fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(chatSource, /resolveFirstUseActionBubbleContent\(\{/);
  assert.match(chatSource, /groundedDraft: firstUseActionDraft/);
  assert.match(chatSource, /activeScope === "private" && isAi/);
  assert.match(chatSource, /Boolean\(visibleBubbleContent\?\.trim\(\)\)/);
  assert.match(chatSource, /getQuoteAnalysisMessagePresentation\(visibleBubbleContent \?\? ""\)/);
});

test("an ungrounded structured answer cannot bypass the hidden action card as plain text", () => {
  const response = [
    "저장된 상태에 맞춰 정리했어요.",
    "확인된 내용",
    "- 모델이 추측한 진행 상황",
    "아직 모르는 내용",
    "- 모델이 추측한 미확인 내용",
    "지금 할 한 가지: 계약금부터 보내기",
    "이유: 모델이 급하다고 추측했어요.",
    "완료 기준: 결제가 끝나면 돼요.",
  ].join("\n");

  const fallback = resolveFirstUseActionBubbleContent({
    content: response,
    groundedDraft: null,
  });
  assert.equal(
    fallback,
    "준비 기록을 다시 확인하지 못해 이 실행 카드는 숨겼어요. ‘지금 뭐부터 할까?’라고 다시 물어봐 주세요.",
  );
  assert.doesNotMatch(fallback, /계약금|모델이 추측/);

  assert.equal(resolveFirstUseActionBubbleContent({
    content: response,
    groundedDraft: { sourceRevision: 3 },
  }), "저장된 상태에 맞춰 정리했어요.");
  assert.equal(resolveFirstUseActionBubbleContent({
    content: "그냥 편하게 이야기해도 괜찮아요.",
    groundedDraft: null,
  }), "그냥 편하게 이야기해도 괜찮아요.");
});

test("the first action card replaces unsafe provider claims with a grounded confirmation action", () => {
  const criterionDecisionId = "44444444-4444-4444-8444-444444444444";
  const base = {
    activeScope: "private",
    senderType: "ai",
    isLatestPrivateAiMessage: true,
    isAlreadyPromoted: false,
    sourceRevision: 7,
    criterionDecisionId,
    grounding: {
      version: 1,
      sourceRevision: 7,
      confirmed: [{ key: "venue", label: "결혼식장: 라움" }],
      unknowns: [],
    },
  };

  assert.deepEqual(selectPrivateActionDraftForBridge({
    ...base,
    content: [
      "지금 할 한 가지: 라움 계약금 보내기",
      "이유: 둘이 이미 계약하기로 합의했어요.",
      "완료 기준: 결제가 완료되면 끝나요.",
    ].join("\n"),
  }), {
    action: "라움 계약·결제 상태 확인하기",
    reason: "저장된 준비 기록만으로 계약·결제 상태를 확정할 수 없어 먼저 확인이 필요해요.",
    completionCriterion: "계약서와 결제 내역에서 금액·상태·마감일을 확인해 둘이 볼 기록에 적으면 끝나요.",
    assumptions: ["결혼식장: 라움"],
    unknowns: [],
    sourceRevision: 7,
    criterionDecisionId,
  });

  assert.deepEqual(selectPrivateActionDraftForBridge({
    ...base,
    content: [
      "지금 할 한 가지: 예식장 후보 두 곳 비교하기",
      "이유: 저장한 장소 기준을 먼저 맞추면 선택지를 줄일 수 있어요.",
      "완료 기준: 둘이 확인할 후보 두 곳을 적으면 끝나요.",
    ].join("\n"),
  }), {
    action: "예식장 후보 두 곳 비교하기",
    reason: "저장한 장소 기준을 먼저 맞추면 선택지를 줄일 수 있어요.",
    completionCriterion: "둘이 확인할 후보 두 곳을 적으면 끝나요.",
    assumptions: ["결혼식장: 라움"],
    unknowns: [],
    sourceRevision: 7,
    criterionDecisionId,
  });
});

test("the private first-action bridge copies only the reviewed card into a shared unsent draft", () => {
  const bridgeSource = readFileSync(
    fileURLToPath(new URL("../components/chat/AmoraFirstUseActionCard.tsx", import.meta.url)),
    "utf8",
  );
  const chatSource = readFileSync(
    fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(bridgeSource, /지금 할 한 가지/);
  assert.match(bridgeSource, /완료 기준/);
  assert.match(bridgeSource, /아모라가 이렇게 이해했어요/);
  assert.match(bridgeSource, /아직 같이 확인할 것/);
  assert.match(bridgeSource, /다르거나 바뀐 내용이 있으면 바로 고쳐주세요/);
  assert.match(bridgeSource, /draft\.assumptions\.length > 0/);
  assert.match(bridgeSource, /draft\.unknowns\.length > 0/);
  assert.match(bridgeSource, /continuationPresentation\.scopeCopy/);
  assert.match(bridgeSource, /continuationPresentation\.accessibilityLabel/);
  assert.match(bridgeSource, /continuationPresentation\.accessibilityHint/);
  assert.match(bridgeSource, /continuationPresentation\.promise/);
  assert.doesNotMatch(bridgeSource, /둘이 볼 초안 만들기/);
  assert.doesNotMatch(bridgeSource, /둘이 볼 공동 준비 초안으로 옮기기/);
  assert.match(bridgeSource, /minHeight: 48/);
  assert.doesNotMatch(bridgeSource, /fetch\(|apiFetch|supabase|handleSend/);

  assert.match(chatSource, /selectPrivateActionDraftForBridge\(\{/);
  assert.match(chatSource, /activeScope,/);
  assert.match(chatSource, /isLatestPrivateAiMessage: item\.id === latestPrivateAiMessageId/);
  assert.match(
    chatSource,
    /sourceRevision: item\.metadata\?\.amora_wedding_context_revision/,
  );
  assert.match(
    chatSource,
    /grounding: item\.metadata\?\.amora_first_use_grounding/,
  );
  assert.match(chatSource, /loadAmoraFirstUsePromotionPreview\(\{/);
  assert.match(chatSource, /fetchForExpectedUser: apiFetchForExpectedUser/);
  assert.match(chatSource, /preview\.status !== "ready"/);
  assert.match(chatSource, /createFirstUseComposerBinding\(preview\)/);
  assert.match(chatSource, /preview\.draft\.sharedText/);
  assert.match(chatSource, /firstUseComposerBindingRef\.current = binding/);
  assert.match(chatSource, /current\.status === "criterion_stale"/);
  assert.match(chatSource, /buildFirstUseCriterionCorrectionDraft\(\)/);
  assert.match(
    chatSource,
    /criterionDecisionId:\s*item\.metadata\?\.amora_couple_criterion_decision_id/,
  );
  assert.match(chatSource, /setFirstUsePromotionUiState\(\{ sourceMessageId, status: "checking" \}\)/);
  assert.match(chatSource, /updateAmoraChatLaneRecord\([\s\S]{0,100}"shared_ai",[\s\S]{0,100}preview\.draft\.sharedText/);
  assert.match(chatSource, /setActiveScope\("shared"\)/);
  assert.match(chatSource, /setTarget\("ai"\)/);
  assert.match(chatSource, /<AmoraFirstUseActionCard/);
  assert.match(chatSource, /const \[promotedFirstUseMessageId, setPromotedFirstUseMessageId\]/);
  assert.match(chatSource, /isAlreadyPromoted: item\.id === promotedFirstUseMessageId/);
  assert.match(chatSource, /setPromotedFirstUseMessageId\(sourceMessageId\)/);
  assert.match(chatSource, /setPromotedFirstUseMessageId\(null\)/);
  assert.match(
    chatSource,
    /\(mediationBlock \|\| pendingAction \|\| firstUseActionDraft\) && st\.mediationMessageBody/,
  );

  const bridgeHandlerStart = chatSource.indexOf("function handleContinueFirstUseAction");
  const bridgeHandlerEnd = chatSource.indexOf("\n  }", bridgeHandlerStart);
  assert.ok(bridgeHandlerStart > 0 && bridgeHandlerEnd > bridgeHandlerStart);
  const bridgeHandler = chatSource.slice(bridgeHandlerStart, bridgeHandlerEnd);
  assert.doesNotMatch(bridgeHandler, /handleSend|fetch\(|supabase/);
});

test("a blank Amora conversation recommends one state review without making the user classify their progress", () => {
  const plan = buildAmoraEntryPlan({
    activeScope: "private",
    hasLinkedPartner: false,
  });

  assert.equal(plan.title, "지금 어디부터 같이 볼까요?");
  assert.match(plan.description, /정해진 게 거의 없어도 괜찮아요/);
  assert.match(plan.description, /나에게 맞는 첫 행동/);
  assert.match(plan.description, /나만 보는 초안/);
  assert.deepEqual(
    plan.starters.map(({ id, label, recommended }) => ({ id, label, recommended })),
    [
      {
        id: "review_current_state",
        label: "내 준비 상태부터 확인해줘",
        recommended: true,
      },
      {
        id: "plan_this_week",
        label: "이번 주에 할 일 하나 정해줘",
        recommended: false,
      },
      {
        id: "prepare_conversation",
        label: "둘이 먼저 맞춰볼 게 있어요",
        recommended: false,
      },
    ],
  );

  const recommended = plan.starters[0];
  assert.match(recommended.prompt, /저장된 일정·체크리스트·예산·결정/);
  assert.doesNotMatch(recommended.prompt, /아무것도 안|이미 준비 중|너무 복잡/);

  for (const starter of plan.starters) {
    assert.match(starter.prompt, /확인된 내용/);
    assert.match(starter.prompt, /아직 모르는 내용/);
    assert.match(starter.prompt, /질문 (?:최대 )?한(?: 개|개를|개를 해|개를 하고)|질문 하나/);
    assert.match(starter.prompt, /각각 최대 3개/);
    assert.match(starter.prompt, /지금 할 한 가지/);
    assert.match(starter.prompt, /이유/);
    assert.match(starter.prompt, /완료 기준/);
    assert.match(starter.prompt, /실행 카드/);
    assert.match(starter.prompt, /확인(?:하기)? 전에는/);
    assert.doesNotMatch(starter.prompt, /계약|위약금|해지|환불|법률/);
  }
});

test("a first-use choice fills one natural editable message instead of an internal prompt block", () => {
  const plan = buildAmoraEntryPlan({
    activeScope: "private",
    hasLinkedPartner: false,
  });

  for (const starter of plan.starters) {
    assert.equal(starter.prompt.includes("\n"), false);
    assert.ok(
      Array.from(starter.prompt).length <= 180,
      `${starter.id} should fit in a readable composer draft`,
    );
    assert.doesNotMatch(
      starter.prompt,
      /시스템|프롬프트|지시문|도구|pending_action|visibility|metadata/i,
    );
  }
});

test("a linked shared conversation starts from a mutual decision without importing private thoughts", () => {
  const plan = buildAmoraEntryPlan({
    activeScope: "shared",
    hasLinkedPartner: true,
  });
  const conversation = plan?.starters.at(-1);

  assert.equal(conversation?.label, "둘이 같이 정할 일을 정리하고 싶어요");
  assert.match(plan?.description ?? "", /두 사람이/);
  assert.match(conversation?.prompt ?? "", /저장된 공유 준비 기록만/);
  assert.match(conversation?.prompt ?? "", /누구 편도 들지 말고/);
  assert.match(conversation?.prompt ?? "", /두 사람이 확인하기 전에는/);
  assert.doesNotMatch(conversation?.prompt ?? "", /속마음|감정.*추측|private|비공개/);
});

test("every shared starter is explicit about shared records and never promises a private lane", () => {
  const plan = buildAmoraEntryPlan({
    activeScope: "shared",
    hasLinkedPartner: true,
  });

  for (const starter of plan?.starters ?? []) {
    assert.match(starter.prompt, /공유 준비 기록/);
    assert.match(
      starter.prompt,
      /저장 단계에서 필요한 확인을 거치면 공동 준비 기록에 남아 파트너에게 보여|두 사람이 확인하기 전에는/,
    );
    assert.doesNotMatch(starter.prompt, /상대에게 공유하지 마|나만 보는|비공개/);
  }
});

test("an unlinked shared conversation tells the truth about future partner visibility", () => {
  const plan = buildAmoraEntryPlan({
    activeScope: "shared",
    hasLinkedPartner: false,
  });
  const conversation = plan?.starters.at(-1);

  assert.match(conversation?.prompt ?? "", /저장된 공유 준비 기록만/);
  assert.match(conversation?.prompt ?? "", /파트너가 연결되면 볼 수/);
  assert.match(conversation?.prompt ?? "", /비공개.*가져오지/);
  assert.doesNotMatch(conversation?.prompt ?? "", /누구에게도 공유|상대에게 공유하지/);
});

test("the shared weekly starter asks for one editable action preview before any save", () => {
  const plan = buildAmoraEntryPlan({
    activeScope: "shared",
    hasLinkedPartner: true,
  });
  const weekly = plan?.starters.find((starter) => starter.id === "plan_this_week");

  assert.match(weekly?.prompt ?? "", /실행할 한 가지 카드 내용을 먼저 보여/);
  assert.match(weekly?.prompt ?? "", /저장 단계에서 필요한 확인을 거치면 공동 준비 기록에 남아 파트너에게 보여/);
  assert.match(weekly?.prompt ?? "", /필요한 확인 전에는 저장하지 마/);
  assert.doesNotMatch(weekly?.prompt ?? "", /두 사람이 별도로 확인/);
  assert.doesNotMatch(weekly?.prompt ?? "", /바로 저장|자동 저장|저장했/);
});

test("the mobile blank state renders the entry plan as draft-only choices", () => {
  const starterSource = readFileSync(
    fileURLToPath(new URL("../components/chat/AmoraStarterCard.tsx", import.meta.url)),
    "utf8",
  );
  const chatSource = readFileSync(
    fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(starterSource, /buildAmoraEntryPlan/);
  assert.match(starterSource, /starter\.recommended/);
  assert.match(starterSource, /추천 시작/);
  assert.match(starterSource, /onSelect\(starter\.prompt\)/);
  assert.doesNotMatch(starterSource, /handleSend|fetch\(|apiFetch|supabase/);
  assert.match(chatSource, /<AmoraStarterCard/);
  assert.match(chatSource, /onSelect=\{handleAiSuggestion\}/);
  assert.doesNotMatch(
    chatSource,
    /\["웨딩 사진 촬영 예산을 정리해줘"[\s\S]{0,260}"결혼식장 계약 전에 무엇을 확인해야 해\?"\]/,
  );
  assert.match(
    chatSource,
    /scopedMessages\.length === 0 \? \([\s\S]{0,160}<ScrollView[\s\S]{0,1200}<AmoraStarterCard/,
  );
  assert.match(chatSource, /keyboardShouldPersistTaps="handled"/);
});

test("a rejected home handoff still opens the safe blank Amora entry", () => {
  const experienceSource = readFileSync(
    fileURLToPath(new URL("../components/dashboard/WeddingHomeExperience.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(
    experienceSource,
    /if \(!companionHandoff\) \{\s*router\.push\("\/\(tabs\)\/chat"\);\s*return;\s*\}/,
  );
});

test("a direct chat entry without a canonical couple shows setup instead of a dead composer", () => {
  const chatSource = readFileSync(
    fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(
    chatSource,
    /const needsOnboarding = initialLoaded && userId !== null && coupleId === null/,
  );
  assert.match(chatSource, /if \(needsOnboarding\) \{[\s\S]{0,1800}router\.push\("\/onboarding"\)/);
  assert.match(chatSource, /먼저 기본 설정을 마쳐주세요/);
});

test("chat identity read failures show only a retryable error surface", () => {
  const chatSource = readFileSync(
    fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(chatSource, /const \[initialLoadError, setInitialLoadError\]/);
  assert.match(
    chatSource,
    /data: \{ user \},\s*error: authError[\s\S]{0,240}if \(authError\)/,
  );
  assert.match(
    chatSource,
    /data: profile,\s*error: profileError[\s\S]{0,620}if \(profileError \|\| !profile\)/,
  );
  const loadStart = chatSource.indexOf("async function loadChatSession()");
  const loadEnd = chatSource.indexOf("void loadChatSession();", loadStart);
  const loadBody = chatSource.slice(loadStart, loadEnd);
  assert.match(loadBody, /try \{[\s\S]*await supabase\.auth\.getUser\(\)/);
  assert.match(
    loadBody,
    /\} catch \{[\s\S]{0,260}setInitialLoadError[\s\S]{0,180}setInitialLoaded\(true\)/,
  );

  const errorGate = chatSource.indexOf("if (initialLoadError)");
  const onboardingGate = chatSource.indexOf("if (needsOnboarding)");
  const normalChat = chatSource.indexOf("<AmoraMediationConsentModal");
  assert.ok(errorGate > 0 && onboardingGate > errorGate && normalChat > onboardingGate);
  const errorSurface = chatSource.slice(errorGate, onboardingGate);
  assert.match(errorSurface, /대화를 불러오지 못했어요/);
  assert.match(errorSurface, /다시 불러오기/);
  assert.match(errorSurface, /setChatSessionRetryVersion/);
  assert.doesNotMatch(errorSurface, /설정 이어가기|<TextInput/);
});

test("a canonical no-couple profile opens chat onboarding", () => {
  const chatSource = readFileSync(
    fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(
    chatSource,
    /const needsOnboarding = initialLoaded && userId !== null && coupleId === null/,
  );
  assert.match(
    chatSource,
    /const viewerRole:[\s\S]{0,220}if \(!viewerRole\) \{[\s\S]{0,260}setInitialLoadError/,
  );

  const profileFailure = chatSource.indexOf("if (profileError || !profile)");
  const noCouple = chatSource.indexOf("if (!profile.couple_id)");
  const onboardingGate = chatSource.indexOf("if (needsOnboarding)");
  assert.ok(profileFailure > 0 && noCouple > profileFailure && onboardingGate > noCouple);
});

test("a canonically missing profile opens setup while transport failures stay retryable", () => {
  const chatSource = readFileSync(
    fileURLToPath(new URL("../../app/(tabs)/chat.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(
    chatSource,
    /if \(profileError\?\.code === "PGRST116"\) \{[\s\S]{0,240}setUserId\(user\.id\)[\s\S]{0,160}setInitialLoaded\(true\)/,
  );
  assert.match(
    chatSource,
    /if \(profileError \|\| !profile\) \{[\s\S]{0,240}setInitialLoadError/,
  );

  const missingProfile = chatSource.indexOf('if (profileError?.code === "PGRST116")');
  const retryableFailure = chatSource.indexOf("if (profileError || !profile)");
  const onboardingGate = chatSource.indexOf("if (needsOnboarding)");
  assert.ok(missingProfile > 0 && retryableFailure > missingProfile && onboardingGate > retryableFailure);
});

test("a quiet or setup home opens a grounded planning draft instead of contract intake", () => {
  const prompt = buildAmoraHomeDraft({
    intent: "intake",
    priorityTitle: "현재 저장된 일정 기준, 오늘 확인 항목이 없어요",
    whyNow: "필요하면 아모라와 다음 준비를 정리해 보세요.",
    evidenceLabel: "현재 저장된 일정과 체크리스트 기준",
  });

  assert.match(prompt ?? "", /무엇부터 물어봐야 할지 몰라도/);
  assert.match(prompt ?? "", /현재 저장된 일정과 체크리스트 기준/);
  assert.match(prompt ?? "", /한 번에 하나만/);
  assert.match(prompt ?? "", /확인하기 전에는/);
  assert.doesNotMatch(prompt ?? "", /계약|견적|추가금|위약금|해지|환불|법률/);
  assert.doesNotMatch(prompt ?? "", /�|\?[가-힣]/u);
});

test("a grounded home draft stays natural regardless of the Korean final consonant", () => {
  const prompt = buildAmoraHomeDraft({
    intent: "focus",
    priorityTitle: "이번 주 준비 한 가지",
    whyNow: "오늘 일정에 저장되어 있어요.",
    evidenceLabel: "현재 저장된 일정 기준",
  });

  assert.match(prompt ?? "", /“이번 주 준비 한 가지”부터 같이 보고 싶어/);
  assert.doesNotMatch(prompt ?? "", /”을 같이|”를 같이/);
});

test("a normal joined wedding emoji cannot turn the home handoff into a dead action", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const handoffId = "77777777-7777-4777-8777-777777777777";
  const staged = stageCompanionChatHandoff({
    handoffId,
    ownerUserId: userId,
    coupleId,
    brief: {
      priorityTitle: "👰‍♀️ 드레스 피팅",
      whyNow: "오늘 일정에 저장되어 있어요.",
      evidenceLabel: "현재 저장된 일정 기준",
      chatIntent: "focus",
    },
  });

  assert.equal(staged, handoffId);
  assert.match(
    consumeCompanionChatHandoff(handoffId, userId, coupleId)?.prompt ?? "",
    /👰‍♀️ 드레스 피팅/,
  );
});

test("invisible formatting controls outside an emoji join remain rejected", () => {
  const staged = stageCompanionChatHandoff({
    handoffId: "88888888-8888-4888-8888-888888888888",
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    coupleId: "22222222-2222-4222-8222-222222222222",
    brief: {
      priorityTitle: "드레스\u200d피팅",
      whyNow: "오늘 일정에 저장되어 있어요.",
      evidenceLabel: "현재 저장된 일정 기준",
      chatIntent: "focus",
    },
  });

  assert.equal(staged, null);
});

test("a canonical 500-character schedule title remains actionable", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const handoffId = "99999999-9999-4999-8999-999999999999";
  const priorityTitle = "드".repeat(500);
  const staged = stageCompanionChatHandoff({
    handoffId,
    ownerUserId: userId,
    coupleId,
    brief: {
      priorityTitle,
      whyNow: "오늘 일정에 저장되어 있어요",
      evidenceLabel: "현재 저장된 일정 기준",
      chatIntent: "focus",
    },
  });

  assert.equal(staged, handoffId);
  assert.match(
    consumeCompanionChatHandoff(handoffId, userId, coupleId)?.prompt ?? "",
    new RegExp(priorityTitle),
  );
});

test("a staged home draft cannot cross into another couple owned by the same account", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const coupleA = "22222222-2222-4222-8222-222222222222";
  const coupleB = "33333333-3333-4333-8333-333333333333";
  const handoffId = "44444444-4444-4444-8444-444444444444";
  const brief = {
    priorityTitle: "이번 주 준비 한 가지",
    whyNow: "저장된 체크리스트에 남아 있어요.",
    evidenceLabel: "현재 저장된 체크리스트 기준",
    chatIntent: "focus",
  };

  assert.equal(
    stageCompanionChatHandoff({
      handoffId,
      ownerUserId: userId,
      coupleId: coupleA,
      brief,
    }),
    handoffId,
  );
  assert.equal(
    consumeCompanionChatHandoff(handoffId, userId, coupleB),
    null,
  );
});

test("every private draft handoff is bound to an exact couple", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const coupleA = "22222222-2222-4222-8222-222222222222";
  const coupleB = "33333333-3333-4333-8333-333333333333";
  const handoffId = "66666666-6666-4666-8666-666666666666";

  assert.equal(
    stagePrivateChatHandoff({ handoffId, ownerUserId: userId, prompt: "초안" }),
    null,
  );
  assert.equal(
    stagePrivateChatHandoff({
      handoffId,
      ownerUserId: userId,
      coupleId: coupleA,
      prompt: "초안",
    }),
    handoffId,
  );
  assert.equal(consumeCompanionChatHandoff(handoffId, userId, coupleB), null);
});

test("an abandoned home draft expires before it can reappear later", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const coupleId = "22222222-2222-4222-8222-222222222222";
  const handoffId = "55555555-5555-4555-8555-555555555555";
  const originalNow = Date.now;
  let nowMs = 1_800_000_000_000;
  Date.now = () => nowMs;
  try {
    stageCompanionChatHandoff({
      handoffId,
      ownerUserId: userId,
      coupleId,
      brief: {
        priorityTitle: "이번 주 준비 한 가지",
        whyNow: "저장된 체크리스트에 남아 있어요.",
        evidenceLabel: "현재 저장된 체크리스트 기준",
        chatIntent: "focus",
      },
    });
    nowMs += 10 * 60 * 1000 + 1;
    assert.equal(
      consumeCompanionChatHandoff(handoffId, userId, coupleId),
      null,
    );
  } finally {
    Date.now = originalNow;
  }
});
