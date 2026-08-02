import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const onboardingSource = readFileSync(
  fileURLToPath(new URL("../../app/onboarding/index.tsx", import.meta.url)),
  "utf8",
);

test("mobile onboarding states the current role limit and privacy-safe expansion direction", () => {
  assert.match(
    onboardingSource,
    /현재 베타 커플 연결은 신부 1명·신랑 1명 구성부터 지원해요\./,
  );
  assert.match(
    onboardingSource,
    /다양한 커플 형태도 개인정보와 대화 기록을 안전하게 지킬 수 있는 구조로 준비하고 있어요\./,
  );
});

test("mobile role choices expose labels and selected state to assistive technology", () => {
  assert.match(
    onboardingSource,
    /accessibilityRole="button"[\s\S]{0,240}accessibilityLabel="신부 역할 선택"[\s\S]{0,240}accessibilityState=\{\{ selected: role === "bride" \}\}/,
  );
  assert.match(
    onboardingSource,
    /accessibilityRole="button"[\s\S]{0,240}accessibilityLabel="신랑 역할 선택"[\s\S]{0,240}accessibilityState=\{\{ selected: role === "groom" \}\}/,
  );
});
