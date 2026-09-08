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

const MULTI_PARTY_OPINION_REQUEST =
  /(?:^|\s)(?:두\s*(?:사람|분)|둘|각자|서로)(?:의)?\s*(?:의견|입장|조건)(?:을|를)\s*(?:(?:차례로|하나씩|각각|함께|먼저|지금|서로|좀)\s+)*(?:(?:전달|비교|정리|중재|조율)해\s*(?:줘(?:요)?|주세요|줄래(?:요)?)|전달(?:할게(?:요)?|합니다))\s*$/;

const NON_CURRENT_OPINION_TASK =
  /만약|가령|예를\s*들어|가정|면(?:\s|,)|나중에|다음에|언젠가|(?:예문|예시|문구|문장)(?:\s*[:：]|로\s)/;

const EXPLICIT_EXECUTION_REQUEST =
  /(?:저장|반영|승인|등록|추가|수정|삭제|배분|적용|실행|확정)\s*(?:좀\s*)?(?:해(?:\s*(?:줘(?:요)?|주세요|줄래(?:요)?|주실래(?:요)?|줄\s*수\s*있(?:어(?:요)?|나요)))?|부탁(?:해(?:요)?|합니다)|하자|할게(?:요)?|하고)(?=$|[\s.!?;,])/;

function isExplicitMultiPartyOpinionTurn(text: string): boolean {
  // 인용문의 의도를 현재 요청으로 읽지 않는다. 기존 위기 판별에는 적용하지 않는다.
  const unquotedText = text
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, "\n")
    .replace(/^\s*>[^\n]*/gm, "\n")
    .replace(/`[^`]*(?:`|$)|"[^"]*(?:"|$)|'[^']*(?:'|$)|“[^”]*(?:”|$)|‘[^’]*(?:’|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)/g, "\n");

  // Terra-none 저장 턴의 빈 본문 이력이 있어 혼합 실행 요청은 새 승격에서 뺀다.
  if (EXPLICIT_EXECUTION_REQUEST.test(unquotedText)) return false;

  return unquotedText.split(/[.!?;\n]/u).some((clause) => {
    const currentClause = clause.trim();
    return !NON_CURRENT_OPINION_TASK.test(currentClause)
      && MULTI_PARTY_OPINION_REQUEST.test(currentClause);
  });
}

/** 일반 상담은 Luna, 오답 비용이 큰 턴만 Terra로 승격한다. */
export function chooseAmoraChatModelRole(input: {
  specialistType: string;
  userText: string;
  correctionCount: number;
}): AmoraModelRole {
  if (input.correctionCount >= 2) return "primary";
  if (classifyAmoraCrisis(input.userText)) return "primary";
  const normalizedUserText = normalizeAmoraSafetyText(input.userText);
  if (TERRA_RISK_PATTERN.test(normalizedUserText)) return "primary";
  if (isExplicitMultiPartyOpinionTurn(normalizedUserText)) return "primary";
  return "fast";
}
