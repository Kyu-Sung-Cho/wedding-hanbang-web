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
const SENSITIVE_TOKEN_PATTERNS = [
  "\\b\\d{6}[- ]?[1-4]\\d{6}\\b", // Korean resident registration number
  "\\b01[016789][- ]?\\d{3,4}[- ]?\\d{4}\\b", // Korean mobile number
  "\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b", // email
  "(?:계좌(?:번호)?|account)\\s*[:=은는]?\\s*[\\d -]{8,}",
  "(?:카드(?:번호)?|card)\\s*[:=은는]?\\s*[\\d -]{12,}",
  "(?:비밀번호|패스워드|password|pwd)\\s*[:=은는]?\\s*\\S+",
  "(?:집|자택|거주지)?주소\\s*[:=은는]?\\s*[^,\\n]{3,100}",
  "(?:질병|진단|임신|알레르기|성생활|성관계)\\s*[^,.\\n]{0,80}",
] as const;

function sensitivePattern(source: string, global = false): RegExp {
  return new RegExp(source, global ? "giu" : "iu");
}

export function containsPotentialSensitiveData(value: string): boolean {
  return SENSITIVE_TOKEN_PATTERNS.some((source) => sensitivePattern(source).test(value));
}

export function redactPotentialSensitiveData(value: string): string {
  return SENSITIVE_TOKEN_PATTERNS.reduce(
    (result, source) => result.replace(sensitivePattern(source, true), "[민감정보 제외]"),
    value,
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
  if (typeof record.summary !== "string" || record.summary.trim().length === 0 || record.summary.length > 600) {
    throw new Error("invalid memory summary");
  }
  if (!Array.isArray(record.memories) || record.memories.length > MAX_MEMORIES) {
    throw new Error("invalid memory list");
  }

  const seenKeys = new Set<string>();
  const memories: CompiledAmoraMemory[] = [];
  for (const item of record.memories) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("invalid memory item");
    }
    const memory = item as Record<string, unknown>;
    if (typeof memory.source_message_id !== "string" || !UUID_PATTERN.test(memory.source_message_id)) {
      throw new Error("invalid memory source");
    }
    if (allowedUserMessageIds && !allowedUserMessageIds.has(memory.source_message_id)) {
      throw new Error("memory source is not a user message in this batch");
    }
    if (typeof memory.memory_key !== "string" || !MEMORY_KEY_PATTERN.test(memory.memory_key)) {
      throw new Error("invalid memory key");
    }
    if (typeof memory.kind !== "string" || !MEMORY_KINDS.has(memory.kind)) {
      throw new Error("invalid memory kind");
    }
    if (typeof memory.category !== "string" || !CATEGORY_PATTERN.test(memory.category)) {
      throw new Error("invalid memory category");
    }
    if (typeof memory.title !== "string" || memory.title.trim().length === 0 || memory.title.length > 60) {
      throw new Error("invalid memory title");
    }
    if (typeof memory.value !== "string" || memory.value.trim().length === 0 || memory.value.length > 160) {
      throw new Error("invalid memory value");
    }
    if (memory.reasoning !== null && (typeof memory.reasoning !== "string" || memory.reasoning.length > 240)) {
      throw new Error("invalid memory reasoning");
    }
    if (typeof memory.confidence !== "number" || !Number.isFinite(memory.confidence) || memory.confidence < 0.8 || memory.confidence > 1) {
      throw new Error("invalid memory confidence");
    }
    if (memory.explicit !== true) throw new Error("memory must be explicit");
    const sensitiveCandidate = [memory.title, memory.value, memory.reasoning ?? ""].join("\n");
    if (containsPotentialSensitiveData(sensitiveCandidate)) continue;
    if (seenKeys.has(memory.memory_key)) throw new Error("duplicate memory key");
    seenKeys.add(memory.memory_key);
    memories.push({
      sourceMessageId: memory.source_message_id,
      memoryKey: memory.memory_key,
      kind: memory.kind as CompiledAmoraMemory["kind"],
      category: memory.category,
      title: memory.title.trim(),
      value: memory.value.trim(),
      reasoning: typeof memory.reasoning === "string" ? memory.reasoning.trim() || null : null,
      confidence: memory.confidence,
      explicit: true as const,
    });
  }

  return { summary: redactPotentialSensitiveData(record.summary.trim()), memories };
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
