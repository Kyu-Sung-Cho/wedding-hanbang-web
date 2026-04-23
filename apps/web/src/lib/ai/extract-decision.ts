// =============================================
// Decision Extractor — Memory Step B
// =============================================
// 목적: /api/chat 턴 종료 후 Haiku로 "사용자가 결정/선호를 표현했나?" 분류
//       → decision_nodes INSERT (recordDecision 헬퍼 경유)
// 특징:
//   - Fire-and-forget (main chat flow 비차단)
//   - 매 턴 트리거 (사람은 턴마다 결정/선호를 표현할 수 있음)
//   - INITIAL_GREETING / MEDIATION_REQUEST 스킵
//   - JSON 실패 시 silent drop
//   - 예외 전부 내부 삼킴
// =============================================

import Anthropic from "@anthropic-ai/sdk";
import { recordDecision } from "@/lib/memory/record-decision";
import { logAIInteraction, startLatencyClock, elapsedMs } from "@/lib/compliance/ai-log";
import type { StageTag, DecisionType } from "@/types/moat.types";

const EXTRACT_MODEL = "claude-haiku-4-5-20251001";
const CONTEXT_WINDOW_MESSAGES = 6;   // Haiku에 보낼 최근 메시지 수
const MAX_MESSAGE_CHARS = 600;       // 메시지 개별 truncate 길이
const MAX_INPUT_CHARS = 6_000;       // 전체 프롬프트 input 상한

// decision_nodes.category로 허용되는 범주
const ALLOWED_CATEGORIES = [
  "studio", "dress", "makeup", "venue", "hanbok", "ring", "honeymoon",
  "budget", "timeline", "style", "guestcount", "preference", "other",
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
// Haiku 분류기
// -------------------------------------------
const EXTRACT_SYSTEM_PROMPT = `당신은 웨딩 대화에서 사용자의 [의사결정] 또는 [선호]를 추출하는 JSON 분류기입니다.

아래 대화의 마지막 사용자 발언(필요하면 직전 맥락 포함)을 분석하여:

[decision] — 구체적 선택/확정:
예: "그거로 할게", "A 예식장 예약했어", "1500만원으로 정했어", "신혼여행은 제주"
[preference] — 드러난 취향/우선순위/가치관 (구체 선택 아님):
예: "화려한 스타일 좋아", "신랑은 전통적인 걸 원해", "신중한 편이야", "예산보다 분위기 우선"
[none] — 단순 질문, 정보 요청, 감정 표현, 중재 요청, 일반 대화

JSON으로만 응답 (설명·코드블록 금지):
{
  "type": "decision" | "preference" | "none",
  "category": "studio"|"dress"|"makeup"|"venue"|"hanbok"|"ring"|"honeymoon"|"budget"|"timeline"|"style"|"guestcount"|"preference"|"other",
  "title": "짧은 한국어 제목 (최대 30자)",
  "value": "내용 (간결히, 50자 이내)",
  "reasoning": "이유 (없으면 null)",
  "confidence": 0.0
}

규칙:
- type="none"이면 나머지 필드는 무시되지만 빈 문자열로 채우세요.
- category는 결정 주제에 가장 맞는 것. 모호하면 "other".
- preference 타입은 category="preference"로 명시.
- confidence는 0.0~1.0. 애매하면 0.5 이하.`;

interface ExtractionResult {
  type: "decision" | "preference" | "none";
  category: string;
  title: string;
  value: string;
  reasoning: string | null;
  confidence: number;
}

async function extractWithHaiku(
  conversation: string
): Promise<{ result: ExtractionResult; usage?: { input_tokens: number; output_tokens: number } } | null> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const response = await anthropic.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 300,
      system: EXTRACT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: conversation }],
    });
    const firstBlock = response.content[0];
    const text = firstBlock && firstBlock.type === "text" ? firstBlock.text.trim() : "";
    if (!text) return null;

    // JSON 추출 (혹시 코드블록으로 감쌌을 경우 대비)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as Partial<ExtractionResult>;
    if (!parsed.type) return null;

    const result: ExtractionResult = {
      type: parsed.type,
      category: (parsed.category ?? "other") as string,
      title: parsed.title ?? "",
      value: parsed.value ?? "",
      reasoning: parsed.reasoning ?? null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };

    return {
      result,
      usage: response.usage
        ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
        : undefined,
    };
  } catch (err) {
    console.error("[extract-decision] Haiku 호출 실패:", err);
    return null;
  }
}

// -------------------------------------------
// 공개 헬퍼: maybeExtractDecision
// -------------------------------------------
export interface MaybeExtractDecisionInput {
  coupleId: string;
  userId?: string | null;
  /** 이번 턴까지 전체 메시지 배열 (마지막은 이번 턴 AI 응답) */
  messages: MessageInput[];
  stageTag?: StageTag | null;
  /** 이번 턴의 사용자 발언 — 스킵 판단용 */
  lastUserText: string;
}

/**
 * 턴 종료 후 Haiku로 decision/preference 추출 → decision_nodes INSERT.
 * fire-and-forget 패턴. 예외 전부 내부 삼킴.
 */
export async function maybeExtractDecision(input: MaybeExtractDecisionInput): Promise<void> {
  try {
    // 1. 시스템 메시지 스킵
    const userText = input.lastUserText.trim();
    if (!userText) return;
    if (userText.includes("[INITIAL_GREETING]")) return;
    if (userText.includes("[MEDIATION_REQUEST]")) return;
    if (userText.includes("[quote_analysis]")) return;

    // 2. 메시지가 너무 적으면 스킵 (최소 2턴 필요)
    if (input.messages.length < 2) return;

    // 3. 최근 N개 메시지만 Haiku에 전달
    const recent = input.messages.slice(-CONTEXT_WINDOW_MESSAGES);
    const conversation = formatMessagesForExtraction(recent);
    if (!conversation) return;

    // 4. Haiku 분류
    const startedAt = startLatencyClock();
    const extraction = await extractWithHaiku(conversation);
    if (!extraction) return;

    const { result, usage } = extraction;

    // 5. "none"이면 로그만, decision_nodes INSERT 스킵
    if (result.type === "none") {
      void logAIInteraction({
        userId: input.userId ?? null,
        coupleId: input.coupleId,
        interactionType: "chat_turn",
        userInput: null,
        aiOutput: "none",
        latencyMs: elapsedMs(startedAt),
        success: true,
        model: EXTRACT_MODEL,
        tokensInput: usage?.input_tokens,
        tokensOutput: usage?.output_tokens,
        metadata: { endpoint: "chat/extract-decision", extraction_type: "none" },
      });
      return;
    }

    // 6. category 정규화 (allowed list 체크)
    const category = (ALLOWED_CATEGORIES as readonly string[]).includes(result.category)
      ? result.category
      : result.type === "preference"
        ? "preference"
        : "other";

    // preference 타입이면 category도 'preference'로 강제 (스키마 정합성)
    const finalCategory: AllowedCategory =
      result.type === "preference" ? "preference" : (category as AllowedCategory);

    // decision_type: decision → 'decided' / preference → 'considering'
    const decisionType: DecisionType = result.type === "decision" ? "decided" : "considering";

    // confidence 0.0~1.0 clamp
    const confidence = Math.min(1, Math.max(0, result.confidence));

    // 7. recordDecision 호출
    const { nodeId } = await recordDecision({
      coupleId: input.coupleId,
      userId: input.userId,
      category: finalCategory,
      title: result.title || `${result.type === "decision" ? "결정" : "선호"} 추출`,
      chosenValue: { value: result.value, raw: result },
      decisionType,
      stageTag: input.stageTag ?? null,
      source: "chat",
      reasoning: result.reasoning,
      confidence,
      metadata: {
        extracted_by: "haiku",
        extraction_type: result.type,
      },
    });

    // 8. D1 로깅
    void logAIInteraction({
      userId: input.userId ?? null,
      coupleId: input.coupleId,
      interactionType: "chat_turn",
      userInput: null, // 민감정보 — raw 대화는 chat_messages에 이미 있음
      aiOutput: JSON.stringify(result),
      latencyMs: elapsedMs(startedAt),
      success: Boolean(nodeId),
      model: EXTRACT_MODEL,
      tokensInput: usage?.input_tokens,
      tokensOutput: usage?.output_tokens,
      metadata: {
        endpoint: "chat/extract-decision",
        extraction_type: result.type,
        category: finalCategory,
        decision_node_id: nodeId,
        confidence,
      },
    });
  } catch (err) {
    console.error("[extract-decision] 예외 (무시):", err);
  }
}
