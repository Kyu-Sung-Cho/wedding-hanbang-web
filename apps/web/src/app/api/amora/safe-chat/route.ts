import { NextResponse } from "next/server";
import {
  AMORA_MAX_HISTORY_TURNS,
  AMORA_SAFE_MAX_INPUT_CHARS,
  evaluateDeterministicModerationCategories,
  inspectAmoraAdversarialBypass,
  inspectAmoraSafeOutputPostCheck,
  runAmoraSafeGuardrailPipeline,
  type AmoraConversationHistoryTurn,
} from "@/lib/ai/amoraSafeGuardrailPipeline";
import { createClientFromRequest } from "@/lib/supabase/server";
import { isBodyTooLarge, isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 64 * 1024;
const MAX_RAW_HISTORY_ITEMS = AMORA_MAX_HISTORY_TURNS * 2;
const MAX_ASSISTANT_HISTORY_CHARS = 2_000;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

function isUntrustedHistoryContent(role: "user" | "assistant", content: string): boolean {
  if (evaluateDeterministicModerationCategories(content).flagged) {
    return true;
  }
  if (inspectAmoraSafeOutputPostCheck(content).leaked) {
    return true;
  }
  const bypass = inspectAmoraAdversarialBypass(
    role === "user"
      ? { userText: content, outputText: "" }
      : { outputText: content },
  );
  return bypass.blocked;
}

function parseHistory(raw: unknown): AmoraConversationHistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const boundedRaw = raw.slice(-MAX_RAW_HISTORY_ITEMS);
  const turns: AmoraConversationHistoryTurn[] = [];
  for (const item of boundedRaw) {
    if (!isRecord(item)) continue;
    if (item.role !== "user" && item.role !== "assistant") continue;
    if (typeof item.content !== "string") continue;
    const trimmed = item.content.trim();
    if (trimmed.length === 0) continue;
    const maxChars =
      item.role === "user" ? AMORA_SAFE_MAX_INPUT_CHARS : MAX_ASSISTANT_HISTORY_CHARS;
    const content = trimmed.slice(0, maxChars);
    const serverBlocked =
      trimmed.length > maxChars || isUntrustedHistoryContent(item.role, content);
    turns.push({
      role: item.role,
      content,
      blocked: item.blocked === true || serverBlocked,
      action:
        serverBlocked || item.action === "BLOCK"
          ? "BLOCK"
          : item.action === "CRISIS"
            ? "CRISIS"
            : undefined,
      category: typeof item.category === "string" ? item.category.slice(0, 64) : undefined,
    });
  }
  return turns;
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: PRIVATE_HEADERS },
    );
  }

  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return NextResponse.json(
      { error: "요청 본문이 너무 큽니다." },
      { status: 413, headers: PRIVATE_HEADERS },
    );
  }

  const bodyResult = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json(
      {
        error:
          bodyResult.reason === "too_large"
            ? "요청 본문이 너무 큽니다."
            : "요청을 읽을 수 없습니다.",
      },
      { status: bodyResult.reason === "too_large" ? 413 : 400, headers: PRIVATE_HEADERS },
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyResult.text);
  } catch {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  if (
    !isRecord(parsedBody)
    || typeof parsedBody.userMessage !== "string"
    || parsedBody.userMessage.trim().length === 0
  ) {
    return NextResponse.json(
      { error: "userMessage 문자열이 필요합니다." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const supabase = await createClientFromRequest(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "인증이 필요합니다." },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  const history = parseHistory(parsedBody.history);
  const pipelineResult = await runAmoraSafeGuardrailPipeline({
    userId: user.id,
    userMessage: parsedBody.userMessage,
    history,
    beforeProviderEgress: () => {
      if (!user.id) {
        throw new Error("[amora-safe-chat] authenticated user required");
      }
    },
    beforeGeneration: () => {
      if (!user.id) {
        throw new Error("[amora-safe-chat] authenticated user required");
      }
    },
  });

  // safety_audit는 서버 내부 점검용이므로 유저 응답 JSON에서는 제외하고 reply_to_user 및 추천 칩만 노출
  return NextResponse.json(
    {
      reply_to_user: pipelineResult.reply_to_user,
      suggested_follow_ups: pipelineResult.suggested_follow_ups,
      stageReached: pipelineResult.stageReached,
      blocked: pipelineResult.blocked,
      rateLimited: pipelineResult.rateLimited,
      target_model: pipelineResult.target_model,
      selected_model: pipelineResult.selected_model,
    },
    {
      status: pipelineResult.rateLimited ? 429 : 200,
      headers: PRIVATE_HEADERS,
    },
  );
}
