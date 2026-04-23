// =============================================
// Conversation Summarizer — Memory Step A
// =============================================
// 목적: /api/chat 턴 종료 후 대화를 Haiku로 1-3문장 요약 → chat_summaries INSERT
// 특징:
//   - Fire-and-forget (main chat flow 막지 않음)
//   - Trigger: 마지막 요약 이후 10 메시지+ 누적 시
//   - 중복 방지: message_count 기반 watermark
//   - 예외 전부 내부 삼킴
// =============================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logAIInteraction, startLatencyClock, elapsedMs } from "@/lib/compliance/ai-log";

const SUMMARY_TRIGGER_THRESHOLD = 10; // 마지막 요약 이후 새 메시지 N개 이상이면 요약
const SUMMARY_MODEL = "claude-haiku-4-5-20251001";
const MAX_INPUT_CHARS = 12_000; // Haiku에 보낼 대화 전문 상한 (토큰 절약)
const MAX_MESSAGE_CHARS = 800;  // 개별 메시지 truncate 길이

// -------------------------------------------
// Service role client (lazy)
// -------------------------------------------
let _admin: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY 미설정");
  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}

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
    // multimodal content blocks — text 블록만 추출
    return content
      .filter((b): b is { type: string; text?: string } => typeof b === "object" && b !== null && "type" in b)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(" ");
  }
  return "";
}

function formatMessagesForSummary(messages: MessageInput[]): string {
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
// Haiku 요약 생성
// -------------------------------------------
const SUMMARY_SYSTEM_PROMPT = `당신은 웨딩 준비 대화의 요약 생성기입니다.

아래 대화에서 다음 3가지를 1~3문장으로 압축하세요:
1. 핵심 사실 (확정된 날짜/예산/장소/업체/인원 등)
2. 결정된 사항 (선택했거나 확정한 것)
3. 드러난 선호 (명시적이지 않아도 나타난 취향·가치관·우려)

규칙:
- 평서문 1~3문장. 번호나 bullet 금지.
- 시간 경과 후 읽어도 맥락 회복 가능하게.
- "사용자가 X를 고려 중" 보다는 "X를 고려 중" 처럼 주어 생략 OK.
- 아모라의 추천/제안은 요약하지 않음. 커플 쪽 정보만.
- 이모지 금지. 한국어 존댓말 필요 없음 (압축 위주).`;

async function generateSummary(
  formattedConversation: string
): Promise<{ summary: string; usage?: { input_tokens: number; output_tokens: number } } | null> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const response = await anthropic.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 200,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: formattedConversation }],
    });
    const firstBlock = response.content[0];
    const text = firstBlock && firstBlock.type === "text" ? firstBlock.text.trim() : "";
    if (!text) return null;
    return {
      summary: text,
      usage: response.usage
        ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
        : undefined,
    };
  } catch (err) {
    console.error("[summarize] Haiku 호출 실패:", err);
    return null;
  }
}

// -------------------------------------------
// 공개 헬퍼: maybeSummarize
// -------------------------------------------
export interface MaybeSummarizeInput {
  coupleId: string;
  userId?: string | null;
  /** 이번 턴 종료 시 클라이언트가 보낸 전체 메시지 배열 */
  messages: MessageInput[];
  /** 마지막 요약이 커버한 메시지 수 (chat_summaries.message_count 최대값). 없으면 0. */
  lastCoveredCount: number;
  /** 마지막 요약의 to_message_id — 새 요약의 from_message_id로 사용 */
  lastToMessageId?: string | null;
}

/**
 * 대화 길이가 threshold 넘었으면 Haiku로 요약 → chat_summaries INSERT.
 * fire-and-forget 패턴:
 *   void maybeSummarize({ ... });
 */
export async function maybeSummarize(input: MaybeSummarizeInput): Promise<void> {
  try {
    const totalCount = input.messages.length;
    const newMessages = totalCount - input.lastCoveredCount;

    // Threshold 미달이면 skip
    if (newMessages < SUMMARY_TRIGGER_THRESHOLD) return;

    // 새로 커버할 구간만 Haiku로 요약
    const uncoveredSlice = input.messages.slice(input.lastCoveredCount);
    const conversation = formatMessagesForSummary(uncoveredSlice);
    if (!conversation) return;

    const startedAt = startLatencyClock();
    const result = await generateSummary(conversation);
    if (!result) return;

    // INSERT
    const admin = getAdminClient();
    const fromMsgId = input.lastToMessageId ?? null;
    const toMsgId = input.messages[input.messages.length - 1]?.id ?? null;

    const { error } = await admin.from("chat_summaries").insert({
      couple_id: input.coupleId,
      user_id: input.userId ?? null,
      summary: result.summary,
      message_count: totalCount,
      from_message_id: fromMsgId,
      to_message_id: toMsgId,
    });

    if (error) {
      console.error("[summarize] INSERT 실패:", error.message);
      return;
    }

    // D1 로깅 — 요약 호출도 기록
    void logAIInteraction({
      userId: input.userId ?? null,
      coupleId: input.coupleId,
      interactionType: "chat_turn",
      userInput: null,   // 민감정보 — 원문 저장 X
      aiOutput: result.summary,
      latencyMs: elapsedMs(startedAt),
      success: true,
      model: SUMMARY_MODEL,
      tokensInput: result.usage?.input_tokens,
      tokensOutput: result.usage?.output_tokens,
      metadata: {
        endpoint: "chat/summarize",
        message_count: totalCount,
        covered_range: `${input.lastCoveredCount}-${totalCount}`,
      },
    });
  } catch (err) {
    console.error("[summarize] 예외 (무시):", err);
  }
}
