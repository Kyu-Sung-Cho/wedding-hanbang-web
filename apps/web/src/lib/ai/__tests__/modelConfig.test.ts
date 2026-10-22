import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertAmoraOutputTokenLimit,
  chooseAmoraChatModelRole,
  getAmoraModelConfig,
  hasOpenAIConfig,
  isAmoraOpenAIEnabled,
} from "../modelConfig";

const ENV_KEYS = [
  "AMORA_OPENAI_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_AMORA_PRIMARY_MODEL",
  "OPENAI_AMORA_FAST_MODEL",
  "OPENAI_AMORA_PRIMARY_REASONING_EFFORT",
  "OPENAI_AMORA_FAST_REASONING_EFFORT",
] as const;
const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

describe("Amora GPT-5.6 model policy", () => {
  beforeEach(() => {
    process.env.AMORA_OPENAI_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-unit-fixture-not-a-secret-0000000000000000";
    process.env.OPENAI_AMORA_PRIMARY_MODEL = "gpt-5.6-terra";
    process.env.OPENAI_AMORA_FAST_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_AMORA_PRIMARY_REASONING_EFFORT = "none";
    process.env.OPENAI_AMORA_FAST_REASONING_EFFORT = "none";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("requires an explicit production kill switch in addition to the API key", () => {
    expect(isAmoraOpenAIEnabled()).toBe(true);
    expect(hasOpenAIConfig()).toBe(true);

    process.env.AMORA_OPENAI_ENABLED = "false";
    expect(isAmoraOpenAIEnabled()).toBe(false);
    expect(hasOpenAIConfig()).toBe(false);
  });

  it("rejects placeholders and model drift", () => {
    process.env.OPENAI_API_KEY = "sk-placeholder";
    expect(hasOpenAIConfig()).toBe(false);

    process.env.OPENAI_API_KEY = "sk-unit-fixture-not-a-secret-0000000000000000";
    process.env.OPENAI_AMORA_FAST_MODEL = "gpt-5.6-sol";
    expect(() => getAmoraModelConfig("fast")).toThrow("gpt-5.6-luna");
    expect(hasOpenAIConfig("fast")).toBe(false);
  });

  it("keeps reasoning disabled until a measured quality gate changes policy", () => {
    expect(getAmoraModelConfig("primary")).toEqual({
      model: "gpt-5.6-terra",
      reasoningEffort: "none",
      verbosity: "low",
    });
    process.env.OPENAI_AMORA_PRIMARY_REASONING_EFFORT = "low";
    expect(() => getAmoraModelConfig("primary")).toThrow("허용되지 않습니다");
  });

  it("routes ordinary turns to Luna and high-consequence turns to Terra", () => {
    expect(chooseAmoraChatModelRole({
      specialistType: "general",
      userText: "이번 주 준비할 일 알려줘",
      correctionCount: 0,
    })).toBe("fast");
    // 계약 개입 금지(2026-08-18): 은퇴한 전문분야는 더 이상 승급 사유가 아니다.
    expect(chooseAmoraChatModelRole({
      specialistType: "contract_reviewer",
      userText: "이 계약 어때?",
      correctionCount: 0,
    })).toBe("fast");
    expect(chooseAmoraChatModelRole({
      specialistType: "general",
      userText: "상대가 협박하고 있어",
      correctionCount: 0,
    })).toBe("primary");
    expect(chooseAmoraChatModelRole({
      specialistType: "general",
      userText: "아니, 또 틀렸어",
      correctionCount: 2,
    })).toBe("primary");
    expect(chooseAmoraChatModelRole({
      specialistType: "general",
      userText: "시댁에서 예단 문제로 서운하게 말씀하셔서 고민이야",
      correctionCount: 0,
    })).toBe("primary");
    expect(chooseAmoraChatModelRole({
      specialistType: "general",
      userText: "강남역 근처 상견례 식당 룸 있는 곳 알려줘",
      correctionCount: 0,
    })).toBe("primary");
  });

  it.each([
    "자\u200B살하고 싶어",
    "협\u200B박받고 있어",
    "성\u200B폭력을 당했어",
  ])("normalizes invisible characters before high-risk routing: %s", (userText) => {
    expect(chooseAmoraChatModelRole({
      specialistType: "general",
      userText,
      correctionCount: 0,
    })).toBe("primary");
  });

  it.each([
    "목숨을 끊고 싶어",
    "죽어버릴래",
    "협박하고 있어",
    "계속 협박하고 있어",
    "성범죄를 당하고 있어",
    "나 그냥 죽을래",
    "죽어야겠어",
    "죽어 버리고 싶어",
    "목숨을 끊어버리고 싶어",
    "법적 도움 받고 싶은데 남편이 지금 나를 때리고 있어",
    "예방 교육도 들었는데 오늘 남편이 나를 때리고 있어",
    "자살 예방 글을 읽다가 오히려 죽고 싶어졌어",
    "성범죄 피해를 입었어",
    "남편이 위협 중이야",
    "친구가 지금 죽으려고 약을 먹었어. 어떻게 도와?",
    "친구가 목숨을 끊고 싶어해. 어떻게 도와야 할까?",
    "제가 방금 수면제를 한 통 먹었어요",
    "친구가 방금 수면제를 한 통 먹었어요",
    "목을 맸다가 풀었어",
    "죽고 싶지 않지만 자해할 생각이 들어",
    "남편이 협박하고 있지 않지만 폭력을 쓰고 있어",
    "그만 살고 싶어",
    "약을 잔뜩 털어 넣었어",
    "남편이 내 목을 졸랐어",
    "나를 발로 찼어",
    "강제로 관계를 맺었어",
    "칼 들고 집 앞에 찾아왔어",
    "내 위치를 추적해서 집 앞에서 기다리고 있어",
  ])("routes every deterministically classified crisis to Terra: %s", (userText) => {
    expect(chooseAmoraChatModelRole({
      specialistType: "general",
      userText,
      correctionCount: 0,
    })).toBe("primary");
  });

  it.each([
    "협\u2066박당하고 있어",
    "갈\u034F등이 너무 심해",
  ])("uses the full safety normalizer for Terra risk routing: %s", (userText) => {
    expect(chooseAmoraChatModelRole({
      specialistType: "general",
      userText,
      correctionCount: 0,
    })).toBe("primary");
  });

  it("enforces the shared 1,400-token output ceiling", () => {
    expect(() => assertAmoraOutputTokenLimit(1_400)).not.toThrow();
    expect(() => assertAmoraOutputTokenLimit(1_401)).toThrow("between 1 and 1400");
  });
});
