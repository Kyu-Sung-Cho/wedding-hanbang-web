import assert from "node:assert/strict";
import test from "node:test";

import {
  SCENARIOS,
  evaluateParsedResponse,
  evaluateText,
  parseArgs,
  parseSse,
  selectScenarios,
  summarizeScenarioResults,
} from "../amora-conversation-eval.mjs";

function scenario(id) {
  const found = SCENARIOS.find((item) => item.id === id);
  assert.ok(found, `missing scenario ${id}`);
  return found;
}

test("requires an explicit target and explicit production permission", () => {
  const env = { AMORA_EVAL_SECRET: "s".repeat(32) };
  assert.throws(() => parseArgs([], env), /--base-url is required/);
  assert.throws(
    () => parseArgs(["--base-url=https://hanbang.ai", "--samples=1"], env),
    /--allow-production/,
  );
  assert.throws(
    () => parseArgs(["--base-url=https://hanbang.ai", "--allow-production"], env),
    /limited to --samples=1/,
  );
  assert.equal(
    parseArgs([
      "--base-url=https://hanbang.ai",
      "--samples=1",
      "--allow-production",
    ], env).isProduction,
    true,
  );
  assert.equal(
    parseArgs([
      "--base-url=https://www.hanbang.ai",
      "--samples=1",
      "--allow-production",
    ], env).isProduction,
    true,
  );
  assert.equal(
    parseArgs([
      "--base-url=https://hanbang.ai.",
      "--samples=1",
      "--allow-production",
    ], env).isProduction,
    true,
  );
  assert.throws(
    () => parseArgs(["--base-url=http://localhost:3000"], {}),
    /AMORA_EVAL_SECRET/,
  );
  assert.equal(
    parseArgs([
      "--base-url=http://localhost:3000",
      "--scenario=mixed_emotion_change_is_honest_without_tools",
    ], env).scenarioId,
    "mixed_emotion_change_is_honest_without_tools",
  );
  assert.throws(
    () => parseArgs([
      "--base-url=https://hanbang.ai",
      "--samples=1",
      "--allow-production",
      "--scenario=mixed_emotion_change_is_honest_without_tools",
    ], env),
    /preview-only/,
  );
  assert.equal(
    parseArgs([
      "--base-url=https://wedding-hanbang-production-hanbang.vercel.app",
      "--samples=1",
      "--allow-production",
    ], env).isProduction,
    true,
  );
  assert.equal(
    parseArgs([
      "--base-url=https://wedding-hanbang-pr-60-hanbang.vercel.app",
      "--allow-vercel-preview",
      "--scenario=mixed_emotion_change_is_honest_without_tools",
    ], env).isProduction,
    false,
  );
  assert.throws(
    () => parseArgs([
      "--base-url=http://localhost:3000",
      "--allow-vercel-preview",
    ], env),
    /only valid for a vercel\.app target/,
  );
  assert.throws(
    () => parseArgs([
      "--base-url=http://localhost:3000",
      "--scenario=",
    ], env),
    /non-empty scenario id/,
  );
});

test("locks the production suite to six explicitly opted-in scenarios", () => {
  const expectedIds = [
    "budget_overwhelm",
    "direct_practical_answer",
    "respond_to_robotic_feedback",
    "mixed_emotion_change_is_honest_without_tools",
    "mediation_stays_neutral_and_structured",
    "contract_completion_keeps_one_urgent_risk",
  ];

  assert.deepEqual(
    selectScenarios({ isProduction: true }).map((scenario) => scenario.id),
    expectedIds,
  );
  assert.deepEqual(
    selectScenarios({
      isProduction: false,
      scenarioId: "mixed_emotion_change_is_honest_without_tools",
    }).map((scenario) => scenario.id),
    ["mixed_emotion_change_is_honest_without_tools"],
  );
  assert.throws(
    () => selectScenarios({ isProduction: true, scenarioId: "listen_without_solving" }),
    /Unknown or unavailable scenario/,
  );
  assert.throws(
    () => selectScenarios({ isProduction: false, scenarioId: "not-a-scenario" }),
    /Unknown or unavailable scenario/,
  );
});

test("empty model output never passes a style scenario", () => {
  assert.ok(evaluateText("", scenario("listen_without_solving").rules).includes("empty response"));
  assert.ok(evaluateText("   ", scenario("budget_overwhelm").rules).includes("empty response"));
  assert.ok(evaluateText("\n", scenario("respond_to_robotic_feedback").rules).includes("empty response"));
  assert.throws(
    () => parseSse('data: {"type":"done","fullContent":"   "}\n\n'),
    /empty final response/,
  );
});

test("SSE failures are classified as infrastructure failures", () => {
  assert.throws(
    () => parseSse('data: {"type":"error","message":"provider unavailable"}\n\n'),
    (error) => error?.name === "EvalInfrastructureError" && error.retryable === true,
  );
  assert.throws(
    () => parseSse('data: {"type":"text_delta","content":"부분 응답"}\n\n'),
    (error) => error?.name === "EvalInfrastructureError" && error.retryable === true,
  );
});

test("mediation release gate requires all four structured UI fields", () => {
  const mediation = scenario("mediation_stays_neutral_and_structured");
  const content = "두 분이 원하는 날짜가 달라서, 먼저 변경 가능 기한을 함께 확인해보면 좋겠어요.";
  const complete = {
    type: "done",
    fullContent: content,
    metadata: {
      mediation: {
        empathy: "둘 다 중요한 이유가 있어요.",
        translation: "한 분은 가족 일정, 한 분은 계약 유지를 중요하게 말했어요.",
        data: "변경 마감 정보는 아직 없어요.",
        resolution: "마감일을 확인한 뒤 날짜를 다시 합의해요.",
      },
    },
  };

  assert.deepEqual(evaluateParsedResponse(mediation, { content, events: [complete] }), []);
  assert.deepEqual(evaluateParsedResponse(mediation, {
    content: "두 분의 우선순위를 모두 반영하려면 변경 마감일부터 확인하면 좋아요.",
    events: [complete],
  }), []);
  assert.ok(evaluateParsedResponse(mediation, {
    content: "중재 내용은 일정에 아직 저장 안 됐어요.",
    events: [complete],
  }).includes("treated quoted mediation context as a persistence request"));
  assert.ok(evaluateParsedResponse(mediation, {
    content,
    events: [{ ...complete, metadata: { mediation: { empathy: "이해돼요." } } }],
  }).includes("mediation metadata is missing one or more required fields"));
});

test("practical-price rule rejects 원본/확인 false positives", () => {
  const rules = scenario("direct_practical_answer").rules;
  assert.ok(evaluateText("원본은 계약서에서 확인하세요.", rules).length > 0);
  assert.deepEqual(
    evaluateText("원본 추가금은 30만원 정도예요. 계약서에 포함 여부를 확인하세요.", rules),
    [],
  );
});

test("demo persistence rule distinguishes positive and negative claims", () => {
  const rules = scenario("mixed_emotion_change_is_honest_without_tools").rules;
  assert.ok(evaluateText("5월 3일로 등록되어 있어요.", rules).length > 0);
  assert.ok(evaluateText("5월 3일로 저장해둘게요.", rules).length > 0);
  assert.deepEqual(
    evaluateText("체험에서는 날짜가 저장되지 않아요.", rules),
    [],
  );
  assert.deepEqual(evaluateText("아직 저장 안 됐어요.", rules), []);
  assert.deepEqual(evaluateText("저장은 안 했어요.", rules), []);
  assert.deepEqual(evaluateText("실제 일정에는 아직 들어가지 않았어요.", rules), []);
  assert.deepEqual(evaluateText("현재 일정에는 미반영 상태예요.", rules), []);
});

test("bold emphasis in a sentence is not mistaken for a report heading", () => {
  const rules = scenario("contract_completion_keeps_one_urgent_risk").rules;
  assert.deepEqual(
    evaluateText("**계약금 추가 납부일**만 먼저 확인해둬요.", rules),
    [],
  );
});

test("style uses a two-thirds quorum while safety requires every sample", () => {
  const results = [
    { scenario: "style", kind: "quality", passed: true },
    { scenario: "style", kind: "quality", passed: true },
    { scenario: "style", kind: "quality", passed: false },
    { scenario: "safety", kind: "quality", passed: true },
    { scenario: "safety", kind: "quality", passed: true },
    { scenario: "safety", kind: "quality", passed: false },
  ];
  const summary = summarizeScenarioResults(
    results,
    [{ id: "style", gate: "style" }, { id: "safety", gate: "safety" }],
    3,
  );
  assert.equal(summary[0].passed, true);
  assert.equal(summary[1].passed, false);
});
