// =============================================
// Decision Extractor — Memory Step B (v2: multi-extraction)
// =============================================
// 목적: /api/chat 턴 종료 후 저비용 OpenAI 모델로 "사용자가 결정/선호를 표현했나?" 분류
//       → decision_nodes INSERT (recordDecision 헬퍼 경유)
// v2 변경:
//   - Array 반환 → 한 메시지에 복수 개념 있을 때 각각 row 생성
//     예: "1500만원으로 화려한 스타일" → budget decision + preference 2건
//   - max_tokens 500 (array 수용)
//   - 로그는 turn당 1건 (extraction_count 포함) + recordDecision 별 row 생성
// 특징:
//   - Fire-and-forget (main chat flow 비차단)
//   - INITIAL_GREETING / MEDIATION_REQUEST / [quote_analysis] 스킵
//   - JSON 실패 시 silent drop
//   - 예외 전부 내부 삼킴
// =============================================

import { recordDecision } from "@/lib/memory/record-decision";
import { createOpenAIStructuredResponseWithAudit } from "@/lib/ai/auditedOpenAI";
import type { StageTag, DecisionType } from "@/types/moat.types";

const CONTEXT_WINDOW_MESSAGES = 6;
const MAX_MESSAGE_CHARS = 600;
const MAX_INPUT_CHARS = 6_000;
const MAX_EXTRACTIONS_PER_TURN = 5; // 방어적 상한

// decision_nodes.category로 허용되는 범주
const ALLOWED_CATEGORIES = [
  "studio", "dress", "makeup", "venue", "hanbok", "ring", "honeymoon",
  "budget", "timeline", "style", "guestcount", "preference",
  "conflict_resolution", "other",
] as const;
type AllowedCategory = (typeof ALLOWED_CATEGORIES)[number];

// -------------------------------------------
// 메시지 포맷
// -------------------------------------------
interface MessageInput {
  role: "user" | "assistant";
  content: string | unknown;
  id?: string;
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text?: string } => typeof b === "object" && b !== null && "type" in b)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(" ");
  }
  return "";
}

function formatMessagesForExtraction(messages: MessageInput[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const text = stringifyContent(m.content).trim();
    if (!text) continue;
    const role = m.role === "assistant" ? "아모라" : "사용자";
    const truncated = text.length > MAX_MESSAGE_CHARS ? text.slice(0, MAX_MESSAGE_CHARS) + "…" : text;
    lines.push(`${role}: ${truncated}`);
  }
  const joined = lines.join("\n");
  return joined.length > MAX_INPUT_CHARS ? joined.slice(-MAX_INPUT_CHARS) : joined;
}

// -------------------------------------------
// 저비용 모델 분류기 (v2 — array)
// -------------------------------------------
const EXTRACT_SYSTEM_PROMPT = `당신은 웨딩 대화에서 사용자의 [의사결정] 또는 [선호]를 추출하는 JSON 분류기입니다.

아래 대화의 마지막 사용자 발언(필요하면 직전 맥락 포함)을 분석하여,
그 안에 담긴 **모든** 결정/선호를 각각 별도 항목으로 추출하세요.

[decision] — 구체적 선택/확정:
예: "그거로 할게", "A 예식장 예약했어", "1500만원으로 정했어"
[preference] — 드러난 취향/우선순위/가치관 (구체 선택 아님):
예: "화려한 스타일 좋아", "신랑은 전통적인 걸 원해", "가격보다 분위기 우선"

중요 — 한 메시지에 여러 개념이 섞일 수 있습니다:
예: "1500만원으로 화려한 스타일 예산 짜줘"
  → 2건: budget decision (1500만원) + preference (화려한 스타일)

**갈등 합의 (conflict_resolution) 감지:**
대화 맥락에서 두 사람이 의견 대립을 보이다가 합의·조정한 결정이면 category="conflict_resolution" 로 추출.
신호: 직전 맥락에 "비싸", "나는 X 좋은데 너는 Y", "양보", "그럼 이렇게 하자" 등 대립→조율 흐름.
예:
  - 신부 "호텔 가자" / 신랑 "비싸" → 합의 "호텔 평일 할인으로 하자"
    → conflict_resolution: "예식장 호텔 평일 할인 합의" (reasoning: 가격 vs 화려함 타협)
  - 부모님 호칭 갈등 → 합의 "양가 모두 OO님으로 통일"
    → conflict_resolution
category 선택 우선순위: 명확히 갈등 조율 맥락이면 conflict_resolution, 아니면 원래 도메인 카테고리(venue/budget 등).

없거나 일반 대화/질문/감정 표현이면 빈 배열 반환.

JSON으로만 응답 (설명·코드블록 금지):
{
  "extractions": [
    {
      "type": "decision" | "preference",
      "category": "studio"|"dress"|"makeup"|"venue"|"hanbok"|"ring"|"honeymoon"|"budget"|"timeline"|"style"|"guestcount"|"preference"|"conflict_resolution"|"other",
      "title": "짧은 한국어 제목 (최대 30자)",
      "value": "내용 (간결히, 50자 이내)",
      "reasoning": "이유 (없으면 null) — conflict_resolution이면 대립 축 요약",
      "confidence": 0.0
    }
  ]
}

규칙:
- 복수 추출: 각 개념을 분리하여 array에 나열. 최대 5개.
- 없으면 "extractions": []
- category는 가장 적합한 것. 모호하면 "other".
- preference 타입은 category="preference"로 명시.
- conflict_resolution은 type="decision" 과 함께 사용 (preference 아님).
- confidence는 0.0~1.0. 애매하면 0.5 이하.`;

interface ExtractionItem {
  type: "decision" | "preference";
  category: string;
  title: string;
  value: string;
  reasoning: string | null;
  confidence: number;
}

interface ExtractionResponse {
  extractions: ExtractionItem[];
}

const EXTRACTION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["extractions"],
  properties: {
    extractions: {
      type: "array",
      maxItems: MAX_EXTRACTIONS_PER_TURN,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "category", "title", "value", "reasoning", "confidence"],
        properties: {
          type: { type: "string", enum: ["decision", "preference"] },
          category: { type: "string", enum: [...ALLOWED_CATEGORIES] },
          title: { type: "string", minLength: 1, maxLength: 30 },
          value: { type: "string", maxLength: 80 },
          reasoning: {
            anyOf: [
              { type: "string", maxLength: 200 },
              { type: "null" },
            ],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

export function validateExtractionResponse(value: unknown): ExtractionResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid extraction response");
  }
  const extractions = (value as { extractions?: unknown }).extractions;
  if (!Array.isArray(extractions) || extractions.length > MAX_EXTRACTIONS_PER_TURN) {
    throw new Error("invalid extraction list");
  }

  return {
    extractions: extractions.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("invalid extraction item");
      }
      const record = item as Record<string, unknown>;
      const type = record.type;
      const category = record.category;
      const title = record.title;
      const extractedValue = record.value;
      const reasoning = record.reasoning;
      const confidence = record.confidence;
      if (type !== "decision" && type !== "preference") throw new Error("invalid extraction type");
      if (
        typeof category !== "string" ||
        !(ALLOWED_CATEGORIES as readonly string[]).includes(category)
      ) throw new Error("invalid extraction category");
      if (type === "preference" && category !== "preference") {
        throw new Error("invalid preference category");
      }
      if (category === "conflict_resolution" && type !== "decision") {
        throw new Error("invalid conflict resolution type");
      }
      if (typeof title !== "string" || title.trim().length === 0 || title.length > 30) {
        throw new Error("invalid extraction title");
      }
      if (typeof extractedValue !== "string" || extractedValue.length > 80) {
        throw new Error("invalid extraction value");
      }
      if (reasoning !== null && (typeof reasoning !== "string" || reasoning.length > 200)) {
        throw new Error("invalid extraction reasoning");
      }
      if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new Error("invalid extraction confidence");
      }
      return {
        type,
        category,
        title: title.trim(),
        value: extractedValue.trim(),
        reasoning: typeof reasoning === "string" ? reasoning.trim() || null : null,
        confidence,
      };
    }),
  };
}

async function extractWithOpenAI(
  conversation: string,
  audit: { userId?: string | null; coupleId: string; stageTag?: StageTag | null }
): Promise<{
  extractions: ExtractionItem[];
  usage?: { input_tokens: number; output_tokens: number };
} | null> {
  try {
    const response = await createOpenAIStructuredResponseWithAudit({
      modelRole: "fast",
      maxOutputTokens: 500,
      instructions: EXTRACT_SYSTEM_PROMPT,
      input: conversation,
      responseFormat: {
        name: "amora_decision_extractions",
        description: "웨딩 대화에서 확인된 결정과 선호 목록",
        schema: EXTRACTION_RESPONSE_SCHEMA,
      },
      validate: validateExtractionResponse,
      audit: {
        userId: audit.userId ?? null,
        coupleId: audit.coupleId,
        interactionType: "chat_turn",
        userInput: null,
        metadata: {
          endpoint: "chat/extract-decision",
          stage_tag: audit.stageTag ?? null,
        },
      },
    });
    return {
      extractions: response.data.extractions,
      usage: response.usage
        ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
        : undefined,
    };
  } catch (err) {
    console.error("[extract-decision] OpenAI 호출 실패:", err);
    return null;
  }
}

// -------------------------------------------
// 공개 헬퍼: maybeExtractDecision
// -------------------------------------------
export interface MaybeExtractDecisionInput {
  coupleId: string;
  userId?: string | null;
  messages: MessageInput[];
  stageTag?: StageTag | null;
  lastUserText: string;
  /** 추출된 결정의 visibility (현재 채팅 turn의 visibility와 동일) */
  visibility?: "shared" | "bride_private" | "groom_private";
}

export async function maybeExtractDecision(input: MaybeExtractDecisionInput): Promise<void> {
  try {
    const userText = input.lastUserText.trim();
    if (!userText) return;
    if (userText.includes("[INITIAL_GREETING]")) return;
    if (userText.includes("[MEDIATION_REQUEST]")) return;
    if (userText.includes("[quote_analysis]")) return;
    if (input.messages.length < 2) return;

    const recent = input.messages.slice(-CONTEXT_WINDOW_MESSAGES);
    const conversation = formatMessagesForExtraction(recent);
    if (!conversation) return;

    const result = await extractWithOpenAI(conversation, {
      userId: input.userId ?? null,
      coupleId: input.coupleId,
      stageTag: input.stageTag ?? null,
    });
    if (!result) return;

    const { extractions } = result;

    if (extractions.length === 0) {
      return;
    }

    // 각 extraction마다 decision_nodes INSERT
    for (const ext of extractions) {
      const category = (ALLOWED_CATEGORIES as readonly string[]).includes(ext.category)
        ? ext.category
        : ext.type === "preference"
          ? "preference"
          : "other";
      const finalCategory: AllowedCategory =
        ext.type === "preference" ? "preference" : (category as AllowedCategory);
      const decisionType: DecisionType = ext.type === "decision" ? "decided" : "considering";
      const confidence = Math.min(1, Math.max(0, ext.confidence));

      await recordDecision({
        coupleId: input.coupleId,
        userId: input.userId,
        category: finalCategory,
        title: ext.title || `${ext.type === "decision" ? "결정" : "선호"} 추출`,
        chosenValue: { value: ext.value },
        decisionType,
        stageTag: input.stageTag ?? null,
        source: "chat",
        reasoning: ext.reasoning,
        confidence,
        visibility: input.visibility ?? "shared",
        metadata: {
          extracted_by: "openai_luna",
          extraction_type: ext.type,
        },
      });
    }

  } catch (err) {
    console.error("[extract-decision] 예외 (무시):", err);
  }
}
