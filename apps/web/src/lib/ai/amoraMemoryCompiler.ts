import { createOpenAIStructuredResponseWithAudit } from "@/lib/ai/auditedOpenAI";

export type AmoraMemoryVisibility = "shared" | "bride_private" | "groom_private";

export type MemoryCompilerMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  momentMemoryKeys?: string[];
};

export type CompiledAmoraMemory = {
  sourceMessageId: string;
  memoryKey: string;
  kind: "decision" | "preference" | "constraint" | "relationship" | "fact";
  category: string;
  title: string;
  value: string;
  reasoning: string | null;
  confidence: number;
  explicit: true;
};

export type AmoraMemoryCompilation = {
  summary: string;
  memories: CompiledAmoraMemory[];
};

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 900;
const MAX_INPUT_CHARS = 14_000;
const MAX_MEMORIES = 8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMORY_KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}:[a-z0-9_]{2,48}$/;
const CATEGORY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
const MEMORY_KINDS = new Set(["decision", "preference", "constraint", "relationship", "fact"]);
const REDACTED_MEMORY_SUMMARY = "[민감정보 제외]";
const UNICODE_FORMAT_PATTERN = /\p{Cf}/gu;
const SENSITIVE_TOKEN_PATTERNS = [
  "\\b\\d{6}[- .]?[1-8]\\d{6}\\b", // Korean resident/foreigner registration number
  "\\b01[016789][- ./]?\\d{3,4}[- ./]?\\d{4}\\b", // Korean mobile number
  "\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b", // email
  "\\b(?:\\d[- .]?){9,18}\\d\\b", // unlabeled account/card/phone-like long number
  "(?:계좌(?:번호)?|account)\\s*[:=은는]?\\s*[\\d -]{8,}",
  "(?:카드(?:번호)?|card)\\s*[:=은는]?\\s*[\\d -]{12,}",
  "(?:비밀번호|비번|패스워드|password|pwd)\\s*[:=은는]?\\s*\\S+",
  "(?:집|자택|거주지)?주소\\s*[:=은는]?\\s*[^,\\n]{3,100}",
  "(?:[가-힣A-Za-z0-9]+(?:로|길)\\s*\\d{1,5}(?:[- ]\\d{1,5})?)", // street-level address
  "(?:(?:[가-힣]{1,20}(?:시|군|구))\\s+)?[가-힣]{1,20}(?:읍|면|동|리)\\s+\\d{1,5}(?:-\\d{1,5})?", // parcel-level address
  "(?:현재(?:\\s+임신)?|임신|아기|태아)\\s*(?:상태(?:는|가)?\\s*)?(?:[1-9]|[1-3]\\d|4[0-5])\\s*주차", // pregnancy week without a semantic key
  "(?:질병|진단|임신|알레르기|성생활|성관계|당뇨|인슐린|암|투병|수술|복용|우울증|정신과|혈압|HIV|medical|health|diagnos(?:is|ed)?|pregnan(?:t|cy)?|disease)\\s*[^,.\\n]{0,80}",
] as const;

const SENSITIVE_SEMANTIC_PATTERNS = [
  "(?:^|\\n)\\s*(?:health|medical|diagnosis|pregnancy|mental_health)(?::|\\s*(?:\\n|$))",
  "(?:^|\\n)\\s*(?:identity:(?:birth(?:_date)?|passport|rrn|ssn|national_id)|travel:passport)(?:\\s|$)",
  "(?:\\uC0DD\\uB144\\uC6D4\\uC77C|\\uCD9C\\uC0DD\\uC77C|date\\s*of\\s*birth|dob)\\s*[:=\\uC740\\uB294]?\\s*(?:19|20)\\d{2}\\s*(?:[-./]|\\uB144\\s*)\\s*(?:0?[1-9]|1[0-2])\\s*(?:[-./]|\\uC6D4\\s*)\\s*(?:0?[1-9]|[12]\\d|3[01])(?:\\s*\\uC77C)?",
  "(?:\\uC5EC\\uAD8C(?:\\uBC88\\uD638)?|passport(?:\\s*(?:no\\.?|number))?)\\s*[:=\\uC740\\uB294]?\\s*[A-Z]{1,2}[- ]?\\d{7,8}\\b",
  "(?:family:(?:baby|pregnan(?:cy|t)|gestation)[a-z0-9_]*|baby_timing|pregnan(?:t|cy)?|gestation|\\uC784\\uC2E0|\\uD0DC\\uC544|\\uCD9C\\uC0B0)[\\s\\S]{0,120}(?:[1-9]|[1-3]\\d|4[0-5])\\s*(?:\\uC8FC\\uCC28|weeks?)",
] as const;

const SENSITIVE_PATTERNS = [
  ...SENSITIVE_TOKEN_PATTERNS,
  ...SENSITIVE_SEMANTIC_PATTERNS,
] as const;

function sensitivePattern(source: string, global = false): RegExp {
  return new RegExp(source, global ? "giu" : "iu");
}

export function canonicalizeAmoraMemoryText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(UNICODE_FORMAT_PATTERN, "")
    .trim();
}

export function containsPotentialSensitiveData(value: string): boolean {
  const canonical = canonicalizeAmoraMemoryText(value);
  return SENSITIVE_PATTERNS.some((source) => sensitivePattern(source).test(canonical));
}

function containsPotentialSemanticSensitiveData(value: string): boolean {
  const canonical = canonicalizeAmoraMemoryText(value);
  return SENSITIVE_SEMANTIC_PATTERNS.some((source) => sensitivePattern(source).test(canonical));
}

export function redactPotentialSensitiveData(value: string): string {
  return SENSITIVE_PATTERNS.reduce(
    (result, source) => result.replace(sensitivePattern(source, true), "[민감정보 제외]"),
    canonicalizeAmoraMemoryText(value),
  );
}

const COMPILER_PROMPT = `당신은 아모라의 장기기억 정리기입니다. 대화에 명시된 사용자 사실만 정리합니다.

목표:
1. 최근 대화를 1~3문장으로 요약합니다.
2. 다음 상담에서 다시 묻지 않아도 될 확정 선택, 선호, 제약, 관계 맥락, 사실만 기억 후보로 만듭니다.

안전 규칙:
- 사용자 발화에 직접 근거가 있는 내용만 저장합니다. 아모라의 제안이나 추측은 저장하지 않습니다.
- 성격, 심리, 성별, 관계의 숨은 동기를 진단하지 않습니다.
- 주민번호, 계좌, 주소, 건강, 성생활, 비밀번호 등 상담에 불필요한 민감정보는 저장하지 않습니다.
- 일시적인 감정, 단순 질문, 농담은 기억으로 만들지 않습니다.
- confidence가 0.80 미만이면 버립니다.
- source_message_id는 반드시 근거가 된 사용자 메시지의 제공된 UUID 중 하나입니다.
- memory_key는 같은 주제가 바뀌었을 때 이전 값을 대체할 안정적인 영문 키입니다. 예: budget:total, venue:preferred_area, style:wedding_mood, family:gift_preference.
- 사용자가 바꾼 값은 같은 memory_key를 사용합니다.
- 출력은 스키마에 맞는 JSON만 반환합니다.`;

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "memories"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 600 },
    memories: {
      type: "array",
      maxItems: MAX_MEMORIES,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "source_message_id",
          "memory_key",
          "kind",
          "category",
          "title",
          "value",
          "reasoning",
          "confidence",
          "explicit",
        ],
        properties: {
          source_message_id: {
            type: "string",
            pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
          },
          memory_key: { type: "string", pattern: "^[a-z][a-z0-9_]{1,31}:[a-z0-9_]{2,48}$" },
          kind: { type: "string", enum: ["decision", "preference", "constraint", "relationship", "fact"] },
          category: { type: "string", pattern: "^[a-z][a-z0-9_]{1,31}$" },
          title: { type: "string", minLength: 1, maxLength: 60 },
          value: { type: "string", minLength: 1, maxLength: 160 },
          reasoning: {
            anyOf: [{ type: "string", maxLength: 240 }, { type: "null" }],
          },
          confidence: { type: "number", minimum: 0.8, maximum: 1 },
          explicit: { type: "boolean", const: true },
        },
      },
    },
  },
};

function formatMessages(messages: MemoryCompilerMessage[]): string {
  const bounded = messages.slice(-MAX_MESSAGES).map((message) => {
    const content = message.content.trim().slice(0, MAX_MESSAGE_CHARS);
    const momentKeys = (message.momentMemoryKeys ?? [])
      .filter((key) => MEMORY_KEY_PATTERN.test(key))
      .slice(0, 8);
    const momentSuffix = momentKeys.length > 0
      ? ` [D+1 기억 후보 키: ${momentKeys.join(", ")}]`
      : "";
    return `[${message.id}] [${message.role === "user" ? "사용자" : "아모라"}] ${content}${momentSuffix}`;
  });
  const joined = bounded.join("\n");
  return joined.length <= MAX_INPUT_CHARS ? joined : joined.slice(-MAX_INPUT_CHARS);
}

export function validateAmoraMemoryCompilation(
  value: unknown,
  allowedUserMessageIds?: ReadonlySet<string>,
): AmoraMemoryCompilation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid memory compilation");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== "string") {
    throw new Error("invalid memory summary");
  }
  const canonicalSummary = canonicalizeAmoraMemoryText(record.summary);
  if (canonicalSummary.length === 0 || canonicalSummary.length > 600) {
    throw new Error("invalid memory summary");
  }
  if (!Array.isArray(record.memories) || record.memories.length > MAX_MEMORIES) {
    throw new Error("invalid memory list");
  }

  const seenKeys = new Set<string>();
  const memories: CompiledAmoraMemory[] = [];
  let droppedSemanticSensitiveMemory = false;
  for (const item of record.memories) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("invalid memory item");
    }
    const memory = item as Record<string, unknown>;
    const sourceMessageId = typeof memory.source_message_id === "string"
      ? canonicalizeAmoraMemoryText(memory.source_message_id)
      : null;
    const memoryKey = typeof memory.memory_key === "string"
      ? canonicalizeAmoraMemoryText(memory.memory_key)
      : null;
    const category = typeof memory.category === "string"
      ? canonicalizeAmoraMemoryText(memory.category)
      : null;
    const title = typeof memory.title === "string"
      ? canonicalizeAmoraMemoryText(memory.title)
      : null;
    const memoryValue = typeof memory.value === "string"
      ? canonicalizeAmoraMemoryText(memory.value)
      : null;
    const reasoning = typeof memory.reasoning === "string"
      ? canonicalizeAmoraMemoryText(memory.reasoning) || null
      : memory.reasoning;

    if (!sourceMessageId || !UUID_PATTERN.test(sourceMessageId)) {
      throw new Error("invalid memory source");
    }
    if (allowedUserMessageIds && !allowedUserMessageIds.has(sourceMessageId)) {
      throw new Error("memory source is not a user message in this batch");
    }
    if (!memoryKey || !MEMORY_KEY_PATTERN.test(memoryKey)) {
      throw new Error("invalid memory key");
    }
    if (typeof memory.kind !== "string" || !MEMORY_KINDS.has(memory.kind)) {
      throw new Error("invalid memory kind");
    }
    if (!category || !CATEGORY_PATTERN.test(category)) {
      throw new Error("invalid memory category");
    }
    if (!title || title.length > 60) {
      throw new Error("invalid memory title");
    }
    if (!memoryValue || memoryValue.length > 160) {
      throw new Error("invalid memory value");
    }
    if (reasoning !== null && (typeof reasoning !== "string" || reasoning.length > 240)) {
      throw new Error("invalid memory reasoning");
    }
    if (typeof memory.confidence !== "number" || !Number.isFinite(memory.confidence) || memory.confidence < 0.8 || memory.confidence > 1) {
      throw new Error("invalid memory confidence");
    }
    if (memory.explicit !== true) throw new Error("memory must be explicit");
    const sensitiveCandidate = [
      memoryKey,
      category,
      title,
      memoryValue,
      reasoning ?? "",
    ].join("\n");
    if (containsPotentialSensitiveData(sensitiveCandidate)) {
      droppedSemanticSensitiveMemory ||= containsPotentialSemanticSensitiveData(sensitiveCandidate);
      continue;
    }
    if (seenKeys.has(memoryKey)) throw new Error("duplicate memory key");
    seenKeys.add(memoryKey);
    memories.push({
      sourceMessageId,
      memoryKey,
      kind: memory.kind as CompiledAmoraMemory["kind"],
      category,
      title,
      value: memoryValue,
      reasoning: typeof reasoning === "string" ? reasoning : null,
      confidence: memory.confidence,
      explicit: true as const,
    });
  }

  // A terse summary such as "현재 12주차" can lose the semantic label that
  // made its source memory sensitive. If any candidate was dropped by DLP,
  // fail the whole summary closed instead of persisting an ambiguous fragment.
  return {
    summary: droppedSemanticSensitiveMemory
      ? REDACTED_MEMORY_SUMMARY
      : redactPotentialSensitiveData(canonicalSummary),
    memories,
  };
}

export async function compileAmoraMemory(input: {
  coupleId: string;
  userId?: string | null;
  visibility: AmoraMemoryVisibility;
  messages: MemoryCompilerMessage[];
}): Promise<AmoraMemoryCompilation> {
  const allowedUserMessageIds = new Set(
    input.messages.filter((message) => message.role === "user").map((message) => message.id),
  );
  const response = await createOpenAIStructuredResponseWithAudit({
    modelRole: "fast",
    maxOutputTokens: 800,
    instructions: COMPILER_PROMPT,
    input: formatMessages(input.messages),
    responseFormat: {
      name: "amora_memory_compilation_v2",
      description: "명시적 사용자 근거만 포함하는 아모라 장기기억 묶음",
      schema: RESPONSE_SCHEMA,
    },
    validate: (value) => validateAmoraMemoryCompilation(value, allowedUserMessageIds),
    audit: {
      userId: input.userId ?? null,
      coupleId: input.coupleId,
      interactionType: "chat_turn",
      userInput: null,
      metadata: {
        endpoint: "cron/amora-memory",
        visibility: input.visibility,
        message_count: input.messages.length,
      },
    },
  });
  return response.data;
}

export const AMORA_MEMORY_BATCH_THRESHOLD = 10;
export const AMORA_MEMORY_MAX_BATCH = MAX_MESSAGES;
