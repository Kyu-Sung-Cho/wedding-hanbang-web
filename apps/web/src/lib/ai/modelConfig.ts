export type AmoraModelRole = "primary" | "fast";

export type OpenAIReasoningEffort =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

interface AmoraModelConfig {
  model: string;
  reasoningEffort: OpenAIReasoningEffort;
  verbosity: "low" | "medium";
}

// Every Amora provider wrapper shares this ceiling. Keeping it at the common
// model boundary prevents a future internal caller from silently bypassing the
// chat route's 800-token cost policy.
export const MAX_AMORA_OUTPUT_TOKENS = 800;

export function assertAmoraOutputTokenLimit(value: number): void {
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_AMORA_OUTPUT_TOKENS
  ) {
    throw new Error(
      `[ai-config] maxOutputTokens must be an integer between 1 and ${MAX_AMORA_OUTPUT_TOKENS}.`
    );
  }
}

const MODEL_ENV_BY_ROLE: Record<AmoraModelRole, string> = {
  primary: "OPENAI_AMORA_PRIMARY_MODEL",
  fast: "OPENAI_AMORA_FAST_MODEL",
};

export const DEFAULT_AMORA_MODEL_BY_ROLE: Record<AmoraModelRole, string> = {
  primary: "gpt-5.6-terra",
  fast: "gpt-5.6-luna",
};

const REQUIRED_MODEL_PREFIX_BY_ROLE: Record<AmoraModelRole, string> = {
  primary: "gpt-5.6-terra",
  fast: "gpt-5.6-luna",
};

const REASONING_ENV_BY_ROLE: Record<AmoraModelRole, string> = {
  primary: "OPENAI_AMORA_PRIMARY_REASONING_EFFORT",
  fast: "OPENAI_AMORA_FAST_REASONING_EFFORT",
};

const DEFAULT_REASONING_BY_ROLE: Record<AmoraModelRole, OpenAIReasoningEffort> = {
  primary: "none",
  fast: "none",
};

// Cost policy is code-enforced. A stale deployment variable must not silently
// enable billable reasoning tokens.
const ALLOWED_REASONING_EFFORTS = new Set<OpenAIReasoningEffort>(["none"]);

function getModel(role: AmoraModelRole): string {
  const envName = MODEL_ENV_BY_ROLE[role];
  const model = process.env[envName]?.trim() || DEFAULT_AMORA_MODEL_BY_ROLE[role];
  if (model !== REQUIRED_MODEL_PREFIX_BY_ROLE[role]) {
    throw new Error(
      `[ai-config] ${envName}은 정확히 ${REQUIRED_MODEL_PREFIX_BY_ROLE[role]}이어야 합니다.`
    );
  }
  return model;
}

function getReasoningEffort(role: AmoraModelRole): OpenAIReasoningEffort {
  const envName = REASONING_ENV_BY_ROLE[role];
  const configured = process.env[envName]?.trim().toLowerCase();
  if (!configured) return DEFAULT_REASONING_BY_ROLE[role];
  if (!ALLOWED_REASONING_EFFORTS.has(configured as OpenAIReasoningEffort)) {
    throw new Error(`[ai-config] ${envName} 값이 올바르지 않습니다.`);
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

export function hasOpenAIConfig(role?: AmoraModelRole): boolean {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  // Keep example values and obvious placeholders from reaching a billable
  // provider boundary. Project and service-account keys still share sk-.
  if (
    apiKey.length < 20
    || !apiKey.startsWith("sk-")
    || /(?:xxx|replace[-_ ]?with|your[-_ ]?(?:openai[-_ ]?)?key|example)/i.test(apiKey)
  ) {
    return false;
  }
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
  /갈등|싸(?:웠|움)|다툼|파혼|헤어지|폭력|폭행|때렸|때려|협박|학대|강요|자해|자살|살기\s*싫|죽고\s*싶|극단적\s*선택|목숨을?\s*끊|스토킹|따라다(?:녀|니)|위치\s*추적|감금|가둬|못\s*나가게|성폭행|성폭력|성추행|강간|소송|분쟁/;
const PERSONAL_ASSAULT_PATTERN =
  /^(?:나|저|내가|제가)?\s*맞았어[.!?…]*$|(?:한테|에게)\s*맞(?:았|고|아서|는\s*중)/;
const EMERGENCY_112_PATTERN =
  /^(?:112)[.!?…]*$|112(?:에|로)?\s*(?:신고|전화|연락)|(?:신고|전화|연락).{0,8}112/;

function hasTerraRiskSignal(userText: string): boolean {
  return TERRA_RISK_PATTERN.test(userText)
    || PERSONAL_ASSAULT_PATTERN.test(userText)
    || EMERGENCY_112_PATTERN.test(userText);
}

/**
 * Luna가 기본 상담을 맡고, 계약/분쟁·안전 신호 또는 반복 수정처럼
 * 오답 비용이 큰 턴만 Terra로 승격한다. 모델 호출 없는 결정 함수다.
 */
export function chooseAmoraChatModelRole(input: {
  specialistType: string;
  userText: string;
  correctionCount: number;
}): AmoraModelRole {
  if (input.specialistType === "contract_reviewer") return "primary";
  if (input.correctionCount >= 2) return "primary";
  if (hasTerraRiskSignal(input.userText)) return "primary";
  return "fast";
}
