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
    expect(chooseAmoraChatModelRole({
      specialistType: "contract_reviewer",
      userText: "이 계약 어때?",
      correctionCount: 0,
    })).toBe("primary");
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

  it("enforces the shared 800-token output ceiling", () => {
    expect(() => assertAmoraOutputTokenLimit(800)).not.toThrow();
    expect(() => assertAmoraOutputTokenLimit(801)).toThrow("between 1 and 800");
  });
});
