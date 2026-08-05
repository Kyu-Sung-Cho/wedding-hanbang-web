import { NextRequest, NextResponse } from "next/server";
import { evaluateSavedNoteSource } from "@/lib/amora/savedNoteSource";

import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { mobileBridgeJson } from "@/lib/mobile/boundedJsonResponse";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

// 원문 스냅샷 + 메모까지 담기므로 즐겨찾기보다는 넉넉하게 잡는다.
const MAX_BODY_BYTES = 16 * 1024;
const MAX_CONTENT_LENGTH = 4_000;
const MAX_MEMO_LENGTH = 500;
const MAX_NOTES = 300;

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

type SavedNoteRow = {
  id: string;
  message_id: string | null;
  content: string;
  memo: string | null;
  saved_by: string;
  created_at: string;
};

function withPrivateNoStore(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function unauthenticated(req: Request, emptyPayload: unknown) {
  // 데모 세션은 저장 공간이 없다 — 조용히 빈 상태로 답해 화면이 깨지지 않게 한다.
  if (hasSignedDemoSessionFromCookieHeader(req.headers.get("cookie"))) {
    return mobileBridgeJson(emptyPayload, { headers: RESPONSE_HEADERS });
  }
  return mobileBridgeJson(
    { error: "인증이 필요합니다." },
    { status: 401, headers: RESPONSE_HEADERS },
  );
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | NextResponse> {
  if (isBodyTooLarge(req, MAX_BODY_BYTES)) {
    return mobileBridgeJson(
      { error: "요청 본문이 너무 큽니다." },
      { status: 413, headers: RESPONSE_HEADERS },
    );
  }
  const bodyResult = await readBoundedUtf8Text(req, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return mobileBridgeJson(
      {
        error: bodyResult.reason === "too_large"
          ? "요청 본문이 너무 큽니다."
          : "요청을 읽을 수 없습니다.",
      },
      {
        status: bodyResult.reason === "too_large" ? 413 : 400,
        headers: RESPONSE_HEADERS,
      },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyResult.text) as unknown;
  } catch {
    body = null;
  }
  if (!isRecord(body)) {
    return mobileBridgeJson(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }
  return body;
}

/** 저장은 커플 단위다 — 커플이 없으면 저장할 곳도 없다. */
async function resolveCoupleId(
  supabase: Awaited<ReturnType<typeof createClientFromRequest>>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .maybeSingle();
  const coupleId = (data as { couple_id?: string | null } | null)?.couple_id;
  return typeof coupleId === "string" && coupleId.length > 0 ? coupleId : null;
}

function optionalMemo(value: unknown): string | null | NextResponse {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    return mobileBridgeJson(
      { error: "메모 형식이 올바르지 않습니다." },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_MEMO_LENGTH) {
    return mobileBridgeJson(
      { error: `메모는 ${MAX_MEMO_LENGTH}자까지 쓸 수 있어요.` },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }
  return trimmed;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return unauthenticated(req, { notes: [] });

    const { data, error } = await supabase
      .from("amora_saved_notes")
      .select("id, message_id, content, memo, saved_by, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_NOTES);
    if (error) {
      return mobileBridgeJson(
        { error: "저장한 내용을 불러오지 못했습니다." },
        { status: 503, headers: RESPONSE_HEADERS },
      );
    }

    const notes = ((data ?? []) as SavedNoteRow[]).map((row) => ({
      id: row.id,
      messageId: row.message_id,
      content: row.content,
      memo: row.memo,
      savedByMe: row.saved_by === user.id,
      createdAt: row.created_at,
    }));
    return mobileBridgeJson({ notes }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    console.error("[amora notes] list failed:", error);
    return mobileBridgeJson(
      { error: "서버 오류" },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}

export async function POST(req: Request) {
  if (!isTrustedMutationRequest(req)) {
    return mobileBridgeJson(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: RESPONSE_HEADERS },
    );
  }
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return unauthenticated(req, { saved: false });

    const limited = checkRateLimit(rateLimitKey("amora-notes:save", req, user.id), {
      maxRequests: 60,
      windowMs: 60 * 1000,
    });
    if (limited) return withPrivateNoStore(limited);

    const body = await readJsonBody(req);
    if (body instanceof NextResponse) return body;

    // 저장 노트는 커플 전체가 읽는다. 그래서 본문은 클라이언트가 보낸 문자열이 아니라
    // 서버가 canonical 메시지에서 읽은 원문이어야 하고, 출처 없는 노트는 만들지 않는다.
    // 목표 아키텍처 §6 불변식 5·6 참고.
    if (!isUuid(body.messageId)) {
      return mobileBridgeJson(
        { error: "메시지 정보가 올바르지 않습니다." },
        { status: 400, headers: RESPONSE_HEADERS },
      );
    }
    const sourceMessageId = body.messageId as string;
    const memo = optionalMemo(body.memo);
    if (memo instanceof NextResponse) return memo;

    const coupleId = await resolveCoupleId(supabase, user.id);
    if (!coupleId) {
      return mobileBridgeJson(
        { error: "커플 연결 후에 저장할 수 있어요." },
        { status: 409, headers: RESPONSE_HEADERS },
      );
    }

    // RLS 아래에서 읽으므로 다른 사람의 개인 상담은 애초에 보이지 않는다. 본인의 개인
    // 상담은 보이지만, 공유 범위로 넓히는 declassification 경로가 아직 없으므로 거부한다.
    const { data: sourceMessage } = await supabase
      .from("chat_messages")
      .select("couple_id, visibility, content")
      .eq("id", sourceMessageId)
      .maybeSingle();
    const sourceDecision = evaluateSavedNoteSource({
      message: sourceMessage,
      requestCoupleId: coupleId,
    });
    if (!sourceDecision.ok) {
      const refusal = sourceDecision.reason === "private_source_needs_declassification"
        ? {
            status: 403,
            error: "개인 상담 내용은 두 분이 함께 보는 저장에 담을 수 없어요.",
          }
        : { status: 404, error: "저장할 메시지를 찾지 못했어요." };
      return mobileBridgeJson(
        { error: refusal.error },
        { status: refusal.status, headers: RESPONSE_HEADERS },
      );
    }
    const content = sourceDecision.content.slice(0, MAX_CONTENT_LENGTH);

    const { count } = await supabase
      .from("amora_saved_notes")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) >= MAX_NOTES) {
      return mobileBridgeJson(
        {
          error: `저장은 ${MAX_NOTES}개까지 할 수 있어요. 오래된 것을 지우고 다시 시도해 주세요.`,
          code: "SAVED_NOTES_LIMIT",
        },
        { status: 409, headers: RESPONSE_HEADERS },
      );
    }

    const { data, error } = await supabase
      .from("amora_saved_notes")
      .insert({
        couple_id: coupleId,
        saved_by: user.id,
        message_id: sourceMessageId,
        content,
        memo,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      // 같은 메시지를 두 번 저장한 경우 — 이미 원하는 상태이므로 성공으로 답한다.
      if ((error as { code?: string }).code === "23505") {
        return mobileBridgeJson({ saved: true }, { headers: RESPONSE_HEADERS });
      }
      return mobileBridgeJson(
        { error: "저장하지 못했습니다." },
        { status: 500, headers: RESPONSE_HEADERS },
      );
    }

    return mobileBridgeJson(
      { saved: true, id: data?.id ?? null },
      { headers: RESPONSE_HEADERS },
    );
  } catch (error) {
    console.error("[amora notes] save failed:", error);
    return mobileBridgeJson(
      { error: "서버 오류" },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}

export async function PATCH(req: Request) {
  if (!isTrustedMutationRequest(req)) {
    return mobileBridgeJson(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: RESPONSE_HEADERS },
    );
  }
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return unauthenticated(req, { updated: false });

    const limited = checkRateLimit(rateLimitKey("amora-notes:memo", req, user.id), {
      maxRequests: 60,
      windowMs: 60 * 1000,
    });
    if (limited) return withPrivateNoStore(limited);

    const body = await readJsonBody(req);
    if (body instanceof NextResponse) return body;
    if (!isUuid(body.id)) {
      return mobileBridgeJson(
        { error: "저장 항목을 찾을 수 없습니다." },
        { status: 400, headers: RESPONSE_HEADERS },
      );
    }
    const memo = optionalMemo(body.memo);
    if (memo instanceof NextResponse) return memo;

    const { data, error } = await supabase
      .from("amora_saved_notes")
      .update({ memo })
      .eq("id", body.id)
      .select("id")
      .maybeSingle();
    if (error) {
      return mobileBridgeJson(
        { error: "메모를 저장하지 못했습니다." },
        { status: 500, headers: RESPONSE_HEADERS },
      );
    }
    if (!data) {
      return mobileBridgeJson(
        { error: "저장 항목을 찾을 수 없습니다." },
        { status: 404, headers: RESPONSE_HEADERS },
      );
    }
    return mobileBridgeJson({ updated: true }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    console.error("[amora notes] memo failed:", error);
    return mobileBridgeJson(
      { error: "서버 오류" },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}

export async function DELETE(req: Request) {
  if (!isTrustedMutationRequest(req)) {
    return mobileBridgeJson(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: RESPONSE_HEADERS },
    );
  }
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return unauthenticated(req, { deleted: false });

    const limited = checkRateLimit(rateLimitKey("amora-notes:delete", req, user.id), {
      maxRequests: 60,
      windowMs: 60 * 1000,
    });
    if (limited) return withPrivateNoStore(limited);

    const body = await readJsonBody(req);
    if (body instanceof NextResponse) return body;
    if (!isUuid(body.id)) {
      return mobileBridgeJson(
        { error: "저장 항목을 찾을 수 없습니다." },
        { status: 400, headers: RESPONSE_HEADERS },
      );
    }

    const { error } = await supabase
      .from("amora_saved_notes")
      .delete()
      .eq("id", body.id);
    if (error) {
      return mobileBridgeJson(
        { error: "삭제하지 못했습니다." },
        { status: 500, headers: RESPONSE_HEADERS },
      );
    }
    // 이미 없어도 원하는 상태이므로 성공으로 답한다(재시도 안전).
    return mobileBridgeJson({ deleted: true }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    console.error("[amora notes] delete failed:", error);
    return mobileBridgeJson(
      { error: "서버 오류" },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}
