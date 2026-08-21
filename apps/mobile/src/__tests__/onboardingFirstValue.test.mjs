import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  buildNeutralPreparationSpaceSubmissionPayload,
  buildOnboardingSubmissionPayload,
  getOnboardingCoupleStepActions,
  resolveNeutralPreparationSpaceCompletion,
  resolveOnboardingCompletion,
} from "../lib/onboardingFirstValue.mjs";

const onboardingSource = readFileSync(
  fileURLToPath(new URL("../../app/onboarding/index.tsx", import.meta.url)),
  "utf8",
);

const detailedInput = {
  role: "bride",
  coupleAction: "join",
  inviteCode: "WH-ABC123",
  weddingDate: "2027-05-01",
  weddingDateUndecided: false,
  venue: "숨겨진 예식장 초안",
  totalBudget: { amount: 4_000, unit: "manwon" },
  weddingStyle: "classic",
  priorities: ["venue"],
  budgetTendency: "balanced",
  guestCount: "100-199",
};

test("the couple step makes immediate private Amora guidance the primary choice", () => {
  assert.deepEqual(getOnboardingCoupleStepActions(), {
    primary: {
      intent: "quick_start",
      label: "아모라와 지금 시작하기",
      accessibilityHint:
        "예식일·장소·예산·취향은 나중에 채우고, 나만 상담에서 지금 상황부터 정리합니다.",
    },
    secondary: {
      intent: "continue_details",
      label: "정보를 먼저 입력할게요",
    },
  });
});

test("quick start submits the required couple choice but none of the hidden optional drafts", () => {
  assert.deepEqual(buildOnboardingSubmissionPayload(detailedInput, "quick_start"), {
    role: "bride",
    coupleAction: "join",
    partnerInviteCode: "WH-ABC123",
    weddingDate: null,
    venue: null,
    totalBudget: null,
    progress: {},
  });
});

test("quick start continues into the private Amora first-value entry", () => {
  assert.deepEqual(resolveOnboardingCompletion({
    mode: "quick_start",
    coupleAction: "create",
    inviteCode: "WH-ABC123",
  }), {
    kind: "route",
    pathname: "/(tabs)/chat",
    params: { entry: "first_use" },
  });

  assert.deepEqual(resolveOnboardingCompletion({
    mode: "detailed",
    coupleAction: "create",
    inviteCode: "WH-ABC123",
  }), {
    kind: "invite_code",
    inviteCode: "WH-ABC123",
  });

  assert.deepEqual(resolveOnboardingCompletion({
    mode: "detailed",
    coupleAction: "join",
    inviteCode: null,
  }), {
    kind: "route",
    pathname: "/(tabs)/dashboard",
  });
});

test("the existing detailed path keeps every explicitly entered optional answer", () => {
  assert.deepEqual(buildOnboardingSubmissionPayload(detailedInput, "detailed"), {
    role: "bride",
    coupleAction: "join",
    partnerInviteCode: "WH-ABC123",
    weddingDate: "2027-05-01",
    venue: "숨겨진 예식장 초안",
    totalBudget: { amount: 4_000, unit: "manwon" },
    progress: {
      __preferences: {
        weddingStyle: "classic",
        priorities: ["venue"],
        budgetTendency: "balanced",
        guestCount: "100-199",
      },
    },
  });
});

test("after role and couple choice, the member can start before answering optional pages", () => {
  const coupleStepStart = onboardingSource.indexOf("{/* Step 2: 커플 연결 */}");
  const detailsStepStart = onboardingSource.indexOf("{/* Step 3: 결혼 상세 */}");
  assert.ok(coupleStepStart > 0 && detailsStepStart > coupleStepStart);

  const coupleStep = onboardingSource.slice(coupleStepStart, detailsStepStart);
  assert.match(coupleStep, /예식일·장소·예산·취향은 나중에/);
  assert.match(
    onboardingSource,
    /handleSubmit\(coupleStepActions\.primary\.intent\)/,
  );
  assert.match(onboardingSource, /buildOnboardingSubmissionPayload/);
});

test("the couple step wires quick start to the primary button and details to the secondary choice", () => {
  assert.match(onboardingSource, /getOnboardingCoupleStepActions/);
  assert.match(
    onboardingSource,
    /function handlePrimaryFooterAction\(\)[\s\S]{0,180}step === 2[\s\S]{0,180}handleSubmit\(coupleStepActions\.primary\.intent\)[\s\S]{0,180}handleNext\(\)/,
  );
  assert.match(onboardingSource, /onPress=\{handlePrimaryFooterAction\}/);
  assert.match(
    onboardingSource,
    /step === 2\s*\? coupleStepActions\.primary\.label/,
  );
  assert.match(
    onboardingSource,
    /step === 2[\s\S]{0,320}onPress=\{handleNext\}[\s\S]{0,320}coupleStepActions\.secondary\.label/,
  );
});

test("the quick-start response is routed through the first-value completion contract", () => {
  assert.match(onboardingSource, /resolveOnboardingCompletion/);
  assert.match(
    onboardingSource,
    /mode,\s*coupleAction,\s*inviteCode:\s*data\.inviteCode/,
  );
  assert.match(
    onboardingSource,
    /completion\.pathname === "\/\(tabs\)\/chat"[\s\S]{0,260}router\.replace\(\{[\s\S]{0,160}params: completion\.params/,
  );
});

test("quick start promises the immediate private Amora entry, not another setup page", () => {
  const actions = getOnboardingCoupleStepActions();
  assert.equal(actions.primary.label, "아모라와 지금 시작하기");
  assert.equal(actions.secondary.label, "정보를 먼저 입력할게요");
  assert.match(actions.primary.accessibilityHint, /나만 상담에서 지금 상황부터/);
  assert.match(onboardingSource, /나머지는 준비하면서 하나씩 맞춰갈 수 있어요/);
  assert.doesNotMatch(
    onboardingSource,
    /빈 선택 정보로 시작하고 파트너 초대 코드를 확인합니다/,
  );
});

test("press events never become a submission mode", () => {
  assert.doesNotMatch(onboardingSource, /onPress=\{handleSubmit\}/);
});

test("neutral first value creates a preparation space without role or optional facts", () => {
  const createPayload = buildNeutralPreparationSpaceSubmissionPayload({
    coupleAction: "create",
    inviteCode: "",
  });

  assert.deepEqual(createPayload, {
    membershipMode: "neutral_preparation_space",
    coupleAction: "create",
    weddingDate: null,
    venue: null,
    totalBudget: null,
    progress: {},
  });
  assert.equal(Object.hasOwn(createPayload, "role"), false);

  assert.deepEqual(buildNeutralPreparationSpaceSubmissionPayload({
    coupleAction: "join",
    inviteCode: "WH-ABC123",
  }), {
    membershipMode: "neutral_preparation_space",
    coupleAction: "join",
    partnerInviteCode: "WH-ABC123",
    weddingDate: null,
    venue: null,
    totalBudget: null,
    progress: {},
  });
});

test("already-preparing onboarding submits only the explicit bounded catch-up preview", () => {
  const preparationCatchUp = {
    version: 1,
    requestId: "30000000-0000-4000-8000-000000000001",
    items: [
      { topicKey: "venue", state: "completed", scope: "owner_private" },
    ],
  };
  assert.deepEqual(buildNeutralPreparationSpaceSubmissionPayload({
    coupleAction: "create",
    inviteCode: "",
    preparationCatchUp,
  }), {
    membershipMode: "neutral_preparation_space",
    coupleAction: "create",
    weddingDate: null,
    venue: null,
    totalBudget: null,
    progress: {},
    preparationCatchUp,
  });
  assert.throws(() => buildNeutralPreparationSpaceSubmissionPayload({
    coupleAction: "create",
    inviteCode: "",
    preparationCatchUp: { ...preparationCatchUp, importedFrom: "messenger" },
  }), /Invalid preparation catch-up/);
});

test("neutral first value routes the self report only into an explicit private draft", () => {
  assert.deepEqual(resolveNeutralPreparationSpaceCompletion({
    foundationStage: "already_preparing",
  }), {
    kind: "route",
    pathname: "/(tabs)/chat",
    params: {
      entry: "first_use",
      foundationStage: "already_preparing",
    },
  });

  assert.throws(
    () => resolveNeutralPreparationSpaceCompletion({ foundationStage: "completed" }),
    /Unsupported planning foundation stage/,
  );
});

test("the neutral first-value surface is server-capability gated and never asks for a role", () => {
  assert.match(
    onboardingSource,
    /parseNeutralPreparationSpaceCapability/,
  );
  // 앱이 자기 환경변수로 정하면 서버 판정과 어긋난다
  assert.ok(
    !/EXPO_PUBLIC_AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED/.test(onboardingSource),
    "온보딩이 중립 여부를 클라이언트 플래그로 정하고 있다",
  );
  assert.match(
    onboardingSource,
    /resolvePlanningFoundationFirstValue/,
  );
  assert.match(
    onboardingSource,
    /buildNeutralPreparationSpaceSubmissionPayload/,
  );
  assert.match(
    onboardingSource,
    /resolveNeutralPreparationSpaceCompletion/,
  );
  assert.match(
    onboardingSource,
    /neutralEnabled[\s\S]{0,120}NeutralPlanningFoundation/,
  );
});

test("neutral onboarding durably stages only the owner-bound self report before opening chat", () => {
  assert.match(onboardingSource, /stagePlanningFoundationDraftHandoff/u);
  const successStart = onboardingSource.indexOf("const data = await res.json()");
  const navigationEnd = onboardingSource.indexOf("router.replace(completion.pathname)", successStart);
  assert.ok(successStart > 0 && navigationEnd > successStart);
  const success = onboardingSource.slice(successStart, navigationEnd);
  assert.match(
    success,
    /mode === "neutral_first_value"[\s\S]*await stagePlanningFoundationDraftHandoff\(\{[\s\S]*ownerUserId: expectedActorUserId,[\s\S]*coupleId: data\.coupleId,[\s\S]*stage: requestedFoundationStage!/u,
  );
  assert.ok(
    success.indexOf("stagePlanningFoundationDraftHandoff")
      < success.indexOf(
        "router.replace({",
        success.indexOf("stagePlanningFoundationDraftHandoff"),
      ),
  );
});

test("already-preparing catch-up previews once, reuses the request, and waits for a canonical receipt", () => {
  assert.match(onboardingSource, /AmoraPreparationCatchUp/u);
  assert.match(onboardingSource, /buildAmoraPreparationCatchUpPreview/u);
  assert.match(onboardingSource, /validateAmoraPreparationCatchUpReceipt/u);
  assert.match(onboardingSource, /const requestId = catchUpRequestId \?\? Crypto\.randomUUID\(\)/u);
  assert.match(onboardingSource, /setCatchUpRequestId\(requestId\)/u);
  assert.match(
    onboardingSource,
    /const catchUpSubmission:[\s\S]{0,220}requestId: catchUpRequestId[\s\S]{0,720}handleSubmit\("neutral_first_value", foundationStage, catchUpSubmission\)/u,
  );
  assert.match(
    onboardingSource,
    /validateAmoraPreparationCatchUpReceipt\([\s\S]{0,320}data\.coupleId[\s\S]{0,220}catchUpSubmission\.requestId/u,
  );
  assert.match(
    onboardingSource,
    /validatedCatchUpReceipt\.ok[\s\S]{0,260}setCatchUpReceipt\(validatedCatchUpReceipt\.value\)[\s\S]{0,200}return;/u,
  );
  assert.match(onboardingSource, /pathname: "\/schedule"/u);
  assert.match(onboardingSource, /catchUpReceiptId: catchUpReceipt\.receiptId/u);
  assert.match(onboardingSource, /category: catchUpReceipt\.items\[0\]\?\.topicKey/u);
});

test("catch-up skip keeps the existing private first-value handoff", () => {
  assert.match(
    onboardingSource,
    /onSkip=\{onSkipCatchUp\}[\s\S]*onSkipCatchUp=\{\(\) => void handleCatchUpSkip\(\)\}/u,
  );
  assert.match(
    onboardingSource,
    /if \(mode === "neutral_first_value" && catchUpSubmission === undefined\)[\s\S]{0,240}stagePlanningFoundationDraftHandoff/u,
  );
});

test("catch-up drafts restore by owner and are durably locked before network submission", () => {
  assert.match(onboardingSource, /readPreparationCatchUpDraft\(\{ ownerUserId: user\.id \}\)/u);
  const confirmStart = onboardingSource.indexOf("async function handleCatchUpConfirm()");
  const confirmEnd = onboardingSource.indexOf("async function handleCatchUpSkip()", confirmStart);
  const confirmHandler = onboardingSource.slice(confirmStart, confirmEnd);
  const durableLock = confirmHandler.indexOf("await persistCatchUpDraft({");
  const localLock = confirmHandler.indexOf("setCatchUpRequestLocked(true)");
  const networkSubmit = confirmHandler.indexOf(
    'handleSubmit("neutral_first_value", foundationStage, catchUpSubmission)',
  );
  assert.ok(confirmStart > 0 && confirmEnd > confirmStart);
  assert.ok(durableLock >= 0 && durableLock < localLock && localLock < networkSubmit);
  assert.match(confirmHandler, /requestLocked: true/u);
  assert.match(
    onboardingSource,
    /setCatchUpReceipt\(validatedCatchUpReceipt\.value\)[\s\S]{0,180}clearPreparationCatchUpDraft/u,
  );
});

test("a concurrent canonical journey bypasses reconstruction without inventing a receipt", () => {
  assert.match(onboardingSource, /parseAmoraPreparationCatchUpCanonicalExisting/u);
  assert.match(
    onboardingSource,
    /const canonicalExisting = parseAmoraPreparationCatchUpCanonicalExisting\([\s\S]{0,180}data\.preparationCatchUp[\s\S]{0,240}pathname: "\/schedule"[\s\S]{0,120}catchUpSource: "canonical_existing"/u,
  );
});
