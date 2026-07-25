import {
  classifyAmoraCrisis,
  normalizeAmoraSafetyText,
} from "@/lib/ai/amoraCrisisSafety";

export type AmoraModelRole = "primary" | "fast";

export type OpenAIReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface AmoraModelConfig {
  model: "gpt-5.6-terra" | "gpt-5.6-luna";
  reasoningEffort: OpenAIReasoningEffort;
  verbosity: "low";
}

export const MAX_AMORA_OUTPUT_TOKENS = 1_400;

export function assertAmoraOutputTokenLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_AMORA_OUTPUT_TOKENS) {
    throw new Error(
      `[ai-config] maxOutputTokens must be an integer between 1 and ${MAX_AMORA_OUTPUT_TOKENS}.`
    );
  }
}

const MODEL_ENV_BY_ROLE: Record<AmoraModelRole, string> = {
  primary: "OPENAI_AMORA_PRIMARY_MODEL",
  fast: "OPENAI_AMORA_FAST_MODEL",
};

export const DEFAULT_AMORA_MODEL_BY_ROLE = {
  primary: "gpt-5.6-terra",
  fast: "gpt-5.6-luna",
} as const satisfies Record<AmoraModelRole, AmoraModelConfig["model"]>;

const REASONING_ENV_BY_ROLE: Record<AmoraModelRole, string> = {
  primary: "OPENAI_AMORA_PRIMARY_REASONING_EFFORT",
  fast: "OPENAI_AMORA_FAST_REASONING_EFFORT",
};

// 비용·지연 평가가 끝나기 전에는 stale 환경변수가 유료 reasoning을 켜지 못한다.
const ALLOWED_REASONING_EFFORTS = new Set<OpenAIReasoningEffort>(["none"]);

export function isAmoraOpenAIEnabled(): boolean {
  return process.env.AMORA_OPENAI_ENABLED?.trim().toLowerCase() === "true";
}

function getModel(role: AmoraModelRole): AmoraModelConfig["model"] {
  const envName = MODEL_ENV_BY_ROLE[role];
  const expected = DEFAULT_AMORA_MODEL_BY_ROLE[role];
  const configured = process.env[envName]?.trim() || expected;
  if (configured !== expected) {
    throw new Error(`[ai-config] ${envName}은 정확히 ${expected}이어야 합니다.`);
  }
  return expected;
}

function getReasoningEffort(role: AmoraModelRole): OpenAIReasoningEffort {
  const envName = REASONING_ENV_BY_ROLE[role];
  const configured = process.env[envName]?.trim().toLowerCase() || "none";
  if (!ALLOWED_REASONING_EFFORTS.has(configured as OpenAIReasoningEffort)) {
    throw new Error(`[ai-config] ${envName} 값이 현재 비용 정책에 허용되지 않습니다.`);
  }
  return configured as OpenAIReasoningEffort;
}

export function getAmoraModelConfig(role: AmoraModelRole): AmoraModelConfig {
  return {
    model: getModel(role),
    reasoningEffort: getReasoningEffort(role),
    verbosity: "low",
  };
}

function looksLikeRealOpenAIKey(value: string): boolean {
  return (
    value.length >= 20 &&
    value.startsWith("sk-") &&
    !/(?:xxx|placeholder|replace[-_ ]?with|your[-_ ]?(?:openai[-_ ]?)?key|example|test[-_ ]?only|not[-_ ]?a[-_ ]?real)/i.test(
      value
    )
  );
}

export function hasOpenAIConfig(role?: AmoraModelRole): boolean {
  if (!isAmoraOpenAIEnabled()) return false;
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!looksLikeRealOpenAIKey(apiKey)) return false;
  try {
    if (role) getAmoraModelConfig(role);
    else {
      getAmoraModelConfig("primary");
      getAmoraModelConfig("fast");
    }
    return true;
  } catch {
    return false;
  }
}

const TERRA_RISK_PATTERN =
  /갈등|싸(?:웠|움)|다툼|파혼|헤어지|폭력|폭행|협박|학대|강요|자해|자살|살기\s*싫|죽고\s*싶|극단적\s*선택|스토킹|감금|성폭행|성폭력|성추행|강간|소송|분쟁/;

/** 일반 상담은 Luna, 오답 비용이 큰 턴만 Terra로 승격한다. */
export function chooseAmoraChatModelRole(input: {
  specialistType: string;
  userText: string;
  correctionCount: number;
}): AmoraModelRole {
  if (input.specialistType === "contract_reviewer") return "primary";
  if (input.correctionCount >= 2) return "primary";
  if (classifyAmoraCrisis(input.userText)) return "primary";
  const normalizedUserText = normalizeAmoraSafetyText(input.userText);
  if (TERRA_RISK_PATTERN.test(normalizedUserText)) return "primary";
  return "fast";
}
