import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

import {
  buildOnboardingSubmissionPayload,
  getOnboardingCoupleStepActions,
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
