import { createOpenAIStructuredResponseWithAudit } from "@/lib/ai/auditedOpenAI";
import { AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL } from "@/lib/ai/amoraRequestPolicy";
import { MOMENTS } from "@/constants/moments";

export type AmoraMemoryVisibility = "shared" | "bride_private" | "groom_private";
export type AmoraMemoryActorRole = "bride" | "groom";
export const AMORA_MEMORY_CURSOR_SUMMARY = "[AMORA_MEMORY_CURSOR_ONLY]";
export const AMORA_MEMORY_CURSOR_SUMMARY_TYPE = "cursor";

export type MemoryCompilerMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sourceActorRole: AmoraMemoryActorRole | null;
  /**
   * Server-validated catalog topics attached to an Amora care message.
   * These are taxonomy hints only: they can never be a factual source or
   * evidence for a stored value.
   */
  trustedMomentMemoryKeys?: string[];
};

export type AmoraMemorySource = {
  content: string;
  actorRole: AmoraMemoryActorRole;
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
  sourceActorRole: AmoraMemoryActorRole;
};

export type AmoraMemoryCompilation = {
  summary: string | null;
  memories: CompiledAmoraMemory[];
};

const MAX_MESSAGES = 40;
// A durable chat message is bounded to 20k characters at the request edge.
// Consume it whole before advancing the message-level memory cursor; evidence
// returned by the model stays short and must be an exact source substring.
const MAX_SOURCE_MESSAGE_CHARS = 20_000;
const MAX_EVIDENCE_CHARS = 900;
export const AMORA_MEMORY_MAX_INPUT_CHARS = 24_000;
const MIN_BATCH_MESSAGES = 10;
const MAX_MEMORIES = 8;
const MAX_SUMMARY_CHARS = 600;
const MAX_TRUSTED_MOMENT_KEYS = 8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMORY_KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}:[a-z0-9_]{2,48}$/;
const CATEGORY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
const MEMORY_KINDS = new Set(["decision", "preference", "constraint", "relationship", "fact"]);
const TRUSTED_MOMENT_MEMORY_KEYS = new Set(
  Object.values(MOMENTS).flatMap((moment) => moment.memoryKeys),
);
const ACKNOWLEDGEMENT_TOKENS = new Set([
  "응", "응응", "웅", "네", "넹", "예", "넵", "그래", "맞아", "맞아요",
  "좋아", "좋아요", "오케이", "ㅇ", "ㅇㅇ", "어", "알겠어", "알겠어요", "ok", "okay", "yes",
]);
const GENERIC_EVIDENCE_GRAMS = new Set([
  "선호", "희망", "좋아", "원해", "결정", "확정", "검토", "사용", "직접",
]);
const HTML_NUMERIC_ENTITY_PATTERN =
  /&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?/giu;
const UNICODE_FORMAT_PATTERN = /\p{Cf}/gu;
const SENSITIVE_COMPACT_SEPARATOR_PATTERN =
  /[\s._·•/\\|()[\]{}'":;,~\-]+/gu;
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
  "(?:난임|불임|시험관|인공\\s*수정|유산|낙태|배란|생리|피임|산부인과|출산|태아)\\s*[^,.\\n]{0,80}",
  "(?:병원|정신과|산부인과)\\s*(?:진료|치료|상담|예약|통원)\\s*[^,.\\n]{0,80}",
  "(?:질병|질환|진단|임신|알레르기|성\\s*생활|성\\s*관계|성기능|당뇨|인슐린|암|투병|수술|복용|처방|우울증|공황\\s*장애|조현병|정신과|혈압|HIV|\\bmedical\\b|\\bhealth\\b|diagnos(?:is|ed)?|pregnan(?:t|cy)?|fertility|infertility|reproductive|sexual\\s*health|\\bdisease\\b)\\s*[^,.\\n]{0,80}",
] as const;

const SENSITIVE_SEMANTIC_PATTERNS = [
  "(?:^|\\n)\\s*(?:health|medical|diagnosis|pregnancy|mental_health|reproductive(?:_health)?|fertility|infertility|sexual_health|sex_life|medication|allergy|disability|treatment|hospital)(?::|\\s*(?:\\n|$))",
  "(?:^|\\n)\\s*(?:identity:(?:birth(?:_date)?|passport|rrn|ssn|national_id)|travel:passport)(?:\\s|$)",
  "(?:^|\\n)\\s*family:(?:baby|pregnan(?:cy|t)|gestation|fertility|infertility|reproductive|childbirth|miscarriage)[a-z0-9_]*(?:\\s|$)",
  "(?:\\uC0DD\\uB144\\uC6D4\\uC77C|\\uCD9C\\uC0DD\\uC77C|date\\s*of\\s*birth|dob)\\s*[:=\\uC740\\uB294]?\\s*(?:19|20)\\d{2}\\s*(?:[-./]|\\uB144\\s*)\\s*(?:0?[1-9]|1[0-2])\\s*(?:[-./]|\\uC6D4\\s*)\\s*(?:0?[1-9]|[12]\\d|3[01])(?:\\s*\\uC77C)?",
  "(?:\\uC5EC\\uAD8C(?:\\uBC88\\uD638)?|passport(?:\\s*(?:no\\.?|number))?)\\s*[:=\\uC740\\uB294]?\\s*[A-Z]{1,2}[- ]?\\d{7,8}\\b",
  "(?:family:(?:baby|pregnan(?:cy|t)|gestation)[a-z0-9_]*|baby_timing|pregnan(?:t|cy)?|gestation|\\uC784\\uC2E0|\\uD0DC\\uC544|\\uCD9C\\uC0B0)[\\s\\S]{0,120}(?:[1-9]|[1-3]\\d|4[0-5])\\s*(?:\\uC8FC\\uCC28|weeks?)",
] as const;

const SENSITIVE_PATTERNS = [
  ...SENSITIVE_TOKEN_PATTERNS,
  ...SENSITIVE_SEMANTIC_PATTERNS,
] as const;

const SENSITIVE_COMPACT_PATTERNS = [
  "(?:임신|난임|불임|시험관|인공수정|유산|낙태|배란|생리|피임|산부인과|출산|태아)",
  "(?:성생활|성관계|성기능|성적취향|성적지향|성적문제|섹스)",
  "(?:당뇨|고혈압|저혈압|hiv|aids|우울증|공황장애|조현병|양극성장애|adhd|자폐|알레르기|질환|질병|병력|진단명|복용약|처방약|인슐린)",
  "(?:병원|정신과|산부인과)(?:진료|치료|상담|예약|통원)",
  "(?:reproductive|fertility|infertility|sexualhealth|sexlife|mentalhealth|health(?:care|data|condition|status|diagnosis))",
  "(?:family)(?:baby|pregnancy|pregnant|gestation|fertility|infertility|reproductive|childbirth|miscarriage)",
] as const;

function sensitivePattern(source: string, global = false): RegExp {
  return new RegExp(source, global ? "giu" : "iu");
}

function decodeNumericCharacterReferences(value: string): string {
  return value.replace(
    HTML_NUMERIC_ENTITY_PATTERN,
    (match, hexadecimal: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hexadecimal ?? decimal ?? "", hexadecimal ? 16 : 10);
      if (
        !Number.isInteger(codePoint)
        || codePoint < 0
        || codePoint > 0x10ffff
        || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return match;
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

export function canonicalizeAmoraMemoryText(value: string): string {
  return decodeNumericCharacterReferences(value)
    .normalize("NFKC")
    .replace(UNICODE_FORMAT_PATTERN, "")
    .trim();
}

export function containsPotentialSensitiveData(value: string): boolean {
  const canonical = canonicalizeAmoraMemoryText(value);
  const compact = canonical.replace(SENSITIVE_COMPACT_SEPARATOR_PATTERN, "");
  return SENSITIVE_PATTERNS.some((source) => sensitivePattern(source).test(canonical))
    || SENSITIVE_COMPACT_PATTERNS.some(
      (source) => sensitivePattern(source).test(compact),
    );
}

export function redactPotentialSensitiveData(value: string): string {
  const redacted = SENSITIVE_PATTERNS.reduce(
    (result, source) => result.replace(sensitivePattern(source, true), "[민감정보 제외]"),
    canonicalizeAmoraMemoryText(value),
  );
  const compactRedacted = redacted.replace(SENSITIVE_COMPACT_SEPARATOR_PATTERN, "");
  if (
    SENSITIVE_COMPACT_PATTERNS.some(
      (source) => sensitivePattern(source).test(compactRedacted),
    )
  ) {
    return "[민감정보 제외]";
  }
  return redacted;
}

function isAcknowledgementOnly(value: string): boolean {
  if (/^ㅇ+$/u.test(value.trim())) return true;
  const canonical = canonicalizeAmoraMemoryText(value).toLocaleLowerCase("ko-KR");
  if (ACKNOWLEDGEMENT_TOKENS.has(canonical)) return true;
  const tokens = canonical
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.length > 0 && tokens.every((token) => ACKNOWLEDGEMENT_TOKENS.has(token));
}

function evidenceGrams(value: string): Set<string> {
  const tokens = canonicalizeAmoraMemoryText(value)
    .toLocaleLowerCase("ko-KR")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  const grams = new Set<string>();
  for (const token of tokens) {
    const characters = Array.from(token);
    if (characters.length === 1) {
      if (/^\d$/u.test(token)) grams.add(token);
      continue;
    }
    for (let index = 0; index < characters.length - 1; index += 1) {
      const gram = `${characters[index]}${characters[index + 1]}`;
      if (!GENERIC_EVIDENCE_GRAMS.has(gram)) grams.add(gram);
    }
  }
  return grams;
}

function evidenceSupportsMemory(value: string, evidence: string): boolean {
  const evidenceUnits = evidenceGrams(evidence);
  if (evidenceUnits.size === 0) return false;
  // The display title is model-authored taxonomy and therefore cannot prove
  // that the user's quote supports the actual remembered value. Require at
  // least half of the value's meaningful bigrams to appear in the evidence.
  // A two-character value has exactly one bigram, so it must match exactly.
  const valueUnits = evidenceGrams(value);
  if (valueUnits.size === 0) return false;
  const supportedUnits = [...valueUnits]
    .filter((unit) => evidenceUnits.has(unit))
    .length;
  return supportedUnits / valueUnits.size >= 0.5;
}

const COMPILER_PROMPT = `당신은 아모라의 장기기억 정리기입니다. 제공된 사용자 발화에 명시된 사실만 정리합니다.

목표:
1. 다음 상담에서 다시 묻지 않아도 될 확정 선택, 선호, 제약, 관계 맥락, 사실만 기억 후보로 만듭니다.

안전 규칙:
- 입력에는 사용자 발화만 있습니다. 이전 아모라 답변이나 파생 요약을 추측해 복원하지 않습니다.
- 후보 기억 주제는 서버의 모멘트 카탈로그가 붙인 분류 힌트일 뿐이며 사실 근거가 아닙니다. 값과 evidence는 반드시 같은 source_message_id의 사용자 발화에서만 가져옵니다.
- 사용자 발화에 직접 근거가 있는 내용만 저장합니다.
- 성격, 심리, 성별, 관계의 숨은 동기를 진단하지 않습니다.
- 주민번호, 계좌, 주소, 건강, 임신·난임 등 생식 정보, 성생활, 비밀번호 등 민감정보는 저장하지 않습니다.
- 일시적인 감정, 단순 질문, 농담은 기억으로 만들지 않습니다.
- 응, 네, 그래, 맞아, 좋아, 오케이 같은 단순 동의만으로 앞선 제안을 사용자 사실로 만들지 않습니다.
- confidence가 0.80 미만이면 버립니다.
- source_message_id는 반드시 근거가 된 사용자 메시지의 제공된 UUID 중 하나입니다.
- evidence는 source_message_id 메시지에서 그대로 복사한 짧은 연속 문자열이어야 합니다. 바꾸어 쓰거나 새 사실을 넣지 않습니다.
- value는 가능하면 사용자가 직접 말한 표현의 짧은 구절을 그대로 유지합니다. 일반화하거나 새 고유명사·수치·장소를 보태지 않습니다.
- memory_key는 같은 주제가 바뀌었을 때 이전 값을 대체할 안정적인 영문 키입니다. 예: budget:total, venue:preferred_area, style:wedding_mood, family:gift_preference.
- 사용자가 바꾼 값은 같은 memory_key를 사용합니다.
- 출력은 스키마에 맞는 JSON만 반환합니다.`;

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["memories"],
  properties: {
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
          "evidence",
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
          evidence: { type: "string", minLength: 1, maxLength: MAX_EVIDENCE_CHARS },
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

function formatUserMessage(message: MemoryCompilerMessage): string {
  const content = message.content.trim().slice(0, MAX_SOURCE_MESSAGE_CHARS);
  const actorLabel = message.sourceActorRole === "bride" ? "신부" : "신랑";
  const topics = (message.trustedMomentMemoryKeys ?? [])
    .filter((key) => MEMORY_KEY_PATTERN.test(key))
    .slice(0, MAX_TRUSTED_MOMENT_KEYS);
  const topicContext = topics.length > 0
    ? ` [후보 기억 주제: ${topics.join(", ")}]`
    : "";
  return `[${message.id}] [${actorLabel}]${topicContext} ${content}`;
}

/**
 * Converts an allow-listed, server-authored care envelope into namespaced
 * compiler hints. A caller must still attach the result only to an assistant
 * row. The value/evidence validator continues to accept user source text only.
 */
export function extractTrustedMomentMemoryKeys(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const record = metadata as Record<string, unknown>;
  if (typeof record.client_request_id !== "string"
    || !record.client_request_id.startsWith("moment:")) {
    return [];
  }
  if (!record.moment || typeof record.moment !== "object" || Array.isArray(record.moment)) {
    return [];
  }
  const keys = (record.moment as Record<string, unknown>).memoryKeys;
  if (!Array.isArray(keys)) return [];

  const unique = new Set<string>();
  for (const value of keys) {
    if (typeof value !== "string" || !TRUSTED_MOMENT_MEMORY_KEYS.has(value)) continue;
    unique.add(`moment:${value}`);
    if (unique.size >= MAX_TRUSTED_MOMENT_KEYS) break;
  }
  return [...unique];
}

export type PreparedAmoraMemoryBatch = {
  messages: MemoryCompilerMessage[];
  input: string;
};

export function prepareAmoraMemoryBatch(
  messages: readonly MemoryCompilerMessage[],
): PreparedAmoraMemoryBatch {
  // Cursor progression is chronological. Never keep a suffix or slice the
  // joined text: both would advance past source messages the model never saw.
  const bounded = messages.slice(0, MAX_MESSAGES);
  const lines: string[] = [];
  let inputLength = 0;
  let consumedCount = 0;
  let pendingMomentMemoryKeys: string[] = [];
  let pendingMomentStartIndex: number | null = null;
  for (let index = 0; index < bounded.length; index += 1) {
    const message = bounded[index];
    if (message.role === "assistant") {
      // A later assistant turn supersedes an older care question. Never carry
      // a moment topic across unrelated Amora replies.
      pendingMomentMemoryKeys = (message.trustedMomentMemoryKeys ?? [])
        .filter((key) => MEMORY_KEY_PATTERN.test(key))
        .slice(0, MAX_TRUSTED_MOMENT_KEYS);
      pendingMomentStartIndex = pendingMomentMemoryKeys.length > 0 ? index : null;
    }
    if (message.role === "user" && message.sourceActorRole !== null) {
      const line = formatUserMessage({
        ...message,
        trustedMomentMemoryKeys: pendingMomentMemoryKeys,
      });
      const nextLength = inputLength + (lines.length > 0 ? 1 : 0) + line.length;
      if (nextLength > AMORA_MEMORY_MAX_INPUT_CHARS) {
        // Keep the trusted care envelope and its first reply on the same side
        // of the durable cursor. Otherwise a full batch could consume only the
        // care question and permanently lose its catalog topic on continuation.
        if (pendingMomentStartIndex !== null) {
          consumedCount = Math.min(consumedCount, pendingMomentStartIndex);
        }
        break;
      }
      lines.push(line);
      inputLength = nextLength;
      pendingMomentMemoryKeys = [];
      pendingMomentStartIndex = null;
    }
    consumedCount += 1;
  }
  return {
    messages: bounded.slice(0, consumedCount),
    input: lines.join("\n"),
  };
}

export function shouldDeferAmoraMemoryBatch(
  messageCount: number,
  continuationCount: number,
): boolean {
  return messageCount < MIN_BATCH_MESSAGES && continuationCount === 0;
}

export function isFactualAmoraMemorySummary(row: {
  summary?: unknown;
  summary_type?: unknown;
}): row is { summary: string; summary_type?: unknown } {
  return row.summary_type !== AMORA_MEMORY_CURSOR_SUMMARY_TYPE
    && typeof row.summary === "string"
    && row.summary !== AMORA_MEMORY_CURSOR_SUMMARY;
}

export function buildDeterministicAmoraMemorySummary(
  memories: readonly CompiledAmoraMemory[],
): string | null {
  const lines: string[] = [];
  let summaryLength = 0;
  for (const memory of memories) {
    const actorLabel = memory.sourceActorRole === "bride" ? "신부" : "신랑";
    const line = `- ${actorLabel} · ${memory.title}: ${memory.value}`;
    const nextLength = summaryLength + (lines.length > 0 ? 1 : 0) + line.length;
    if (nextLength > MAX_SUMMARY_CHARS) break;
    lines.push(line);
    summaryLength = nextLength;
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export function validateAmoraMemoryCompilation(
  value: unknown,
  allowedUserMessages: ReadonlyMap<string, AmoraMemorySource>,
): AmoraMemoryCompilation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid memory compilation");
  }
  const record = value as Record<string, unknown>;
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
    const evidence = typeof memory.evidence === "string"
      ? memory.evidence.trim()
      : null;

    if (!sourceMessageId || !UUID_PATTERN.test(sourceMessageId)) {
      throw new Error("invalid memory source");
    }
    const source = allowedUserMessages.get(sourceMessageId);
    if (source === undefined) {
      throw new Error("memory source is not a user message in this batch");
    }
    if (!evidence || evidence.length > MAX_EVIDENCE_CHARS) {
      throw new Error("invalid memory evidence");
    }
    const canonicalEvidence = canonicalizeAmoraMemoryText(evidence);
    const canonicalSource = canonicalizeAmoraMemoryText(source.content);
    if (!canonicalSource.includes(canonicalEvidence)) continue;
    if (isAcknowledgementOnly(source.content)) continue;
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
    if (!evidenceSupportsMemory(memoryValue, canonicalEvidence)) continue;
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
      canonicalEvidence,
      reasoning ?? "",
    ].join("\n");
    if (containsPotentialSensitiveData(sensitiveCandidate)) {
      continue;
    }
    const actorScopedKey = `${source.actorRole}:${memoryKey}`;
    if (seenKeys.has(actorScopedKey)) throw new Error("duplicate memory key");
    seenKeys.add(actorScopedKey);
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
      sourceActorRole: source.actorRole,
    });
  }

  return {
    summary: buildDeterministicAmoraMemorySummary(memories),
    memories,
  };
}

export async function compileAmoraMemory(input: {
  coupleId: string;
  userId?: string | null;
  visibility: AmoraMemoryVisibility;
  messages: MemoryCompilerMessage[];
  /** Atomic provider-budget gate, executed after exact token counting. */
  beforeGeneration: () => void | Promise<void>;
}): Promise<AmoraMemoryCompilation> {
  const batch = prepareAmoraMemoryBatch(input.messages);
  if (batch.input.length === 0) {
    return { summary: null, memories: [] };
  }
  const allowedUserMessages = new Map<string, AmoraMemorySource>(
    batch.messages
      .filter((message): message is MemoryCompilerMessage & {
        sourceActorRole: AmoraMemoryActorRole;
      } => message.role === "user" && message.sourceActorRole !== null)
      .map((message) => [
        message.id,
        {
          content: message.content.trim().slice(0, MAX_SOURCE_MESSAGE_CHARS),
          actorRole: message.sourceActorRole,
        },
      ] as const),
  );
  const response = await createOpenAIStructuredResponseWithAudit({
    modelRole: "fast",
    maxInputTokens: AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL,
    maxOutputTokens: 800,
    beforeGeneration: input.beforeGeneration,
    instructions: COMPILER_PROMPT,
    input: batch.input,
    responseFormat: {
      name: "amora_memory_compilation_v2",
      description: "명시적 사용자 근거만 포함하는 아모라 장기기억 묶음",
      schema: RESPONSE_SCHEMA,
    },
    validate: (value) => validateAmoraMemoryCompilation(value, allowedUserMessages),
    audit: {
      userId: input.userId ?? null,
      coupleId: input.coupleId,
      interactionType: "amora_director",
      userInput: null,
      metadata: {
        endpoint: "cron/amora-memory",
        visibility: input.visibility,
        message_count: batch.messages.length,
      },
    },
  });
  return response.data;
}

export const AMORA_MEMORY_BATCH_THRESHOLD = MIN_BATCH_MESSAGES;
export const AMORA_MEMORY_MAX_BATCH = MAX_MESSAGES;
