import { afterEach, describe, expect, it } from "vitest";
import {
  getAmoraModelConfig,
  chooseAmoraChatModelRole,
  hasOpenAIConfig,
} from "@/lib/ai/modelConfig";

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_AMORA_PRIMARY_MODEL;
  delete process.env.OPENAI_AMORA_FAST_MODEL;
  delete process.env.OPENAI_AMORA_PRIMARY_REASONING_EFFORT;
  delete process.env.OPENAI_AMORA_FAST_REASONING_EFFORT;
});

describe("Amora GPT-5.6 model configuration", () => {
  it("defaults primary to Terra and fast workloads to Luna", () => {
    expect(getAmoraModelConfig("primary")).toMatchObject({
      model: "gpt-5.6-terra",
      reasoningEffort: "none",
    });
    expect(getAmoraModelConfig("fast")).toMatchObject({
      model: "gpt-5.6-luna",
      reasoningEffort: "none",
    });
  });

  it("rejects a costlier or mismatched model in either role", () => {
    process.env.OPENAI_AMORA_PRIMARY_MODEL = "gpt-5.6-sol";
    process.env.OPENAI_AMORA_FAST_MODEL = "gpt-5.6-terra";

    expect(() => getAmoraModelConfig("primary")).toThrow("gpt-5.6-terra");
    expect(() => getAmoraModelConfig("fast")).toThrow("gpt-5.6-luna");
  });

  it("requires an API key before reporting the provider as configured", () => {
    expect(hasOpenAIConfig()).toBe(false);
    process.env.OPENAI_API_KEY = ["sk", "test-only-openai-key-1234567890"].join("-");
    expect(hasOpenAIConfig()).toBe(true);
    process.env.OPENAI_API_KEY = "sk-proj-xxx...";
    expect(hasOpenAIConfig()).toBe(false);
  });

  it("rejects an invalid reasoning effort before a billable request is reserved", () => {
    process.env.OPENAI_API_KEY = ["sk", "test-only-openai-key-1234567890"].join("-");
    process.env.OPENAI_AMORA_PRIMARY_REASONING_EFFORT = "typo";

    expect(hasOpenAIConfig("primary")).toBe(false);
  });

  it("rejects model suffixes and non-none reasoning so env cannot raise cost", () => {
    process.env.OPENAI_AMORA_PRIMARY_MODEL = "gpt-5.6-terra-preview";
    process.env.OPENAI_AMORA_FAST_REASONING_EFFORT = "low";

    expect(() => getAmoraModelConfig("primary")).toThrow("gpt-5.6-terra");
    expect(() => getAmoraModelConfig("fast")).toThrow("OPENAI_AMORA_FAST_REASONING_EFFORT");
  });

  it("routes normal chat to Luna and escalates only high-consequence turns to Terra", () => {
    expect(chooseAmoraChatModelRole({
      specialistType: "budget_optimizer",
      userText: "예산표를 간단히 정리해줘",
      correctionCount: 0,
    })).toBe("fast");
    expect(chooseAmoraChatModelRole({
      specialistType: "contract_reviewer",
      userText: "이 조항 괜찮아?",
      correctionCount: 0,
    })).toBe("primary");
    expect(chooseAmoraChatModelRole({
      specialistType: "general",
      userText: "계속 다퉈서 파혼 이야기가 나왔어",
      correctionCount: 0,
    })).toBe("primary");
    expect(chooseAmoraChatModelRole({
      specialistType: "general",
      userText: "다시 알려줘",
      correctionCount: 2,
    })).toBe("primary");
  });

  it.each([
    "살기 싫어",
    "죽고 싶어",
    "극단적 선택을 생각하고 있어",
    "예비신랑한테 맞았어",
    "맞았어",
    "스토킹을 당하는 것 같아",
    "문을 잠그고 감금했어",
    "성폭행을 당했어",
    "112에 신고해야 할까",
    "112",
  ])("routes Korean safety phrase to Terra: %s", (userText) => {
    expect(chooseAmoraChatModelRole({
      specialistType: "general",
      userText,
      correctionCount: 0,
    })).toBe("primary");
  });

  it.each([
    "드레스가 몸에 잘 맞았어",
    "하객 112명 견적을 내줘",
    "계약했어, 다음 할 일은 뭐야?",
    "다시 알려줘",
  ])("keeps a non-risk phrase on Luna: %s", (userText) => {
    expect(chooseAmoraChatModelRole({
      specialistType: "general",
      userText,
      correctionCount: 0,
    })).toBe("fast");
  });
});
