import { NextRequest, NextResponse } from "next/server";
import { log } from "@/utils/log";
import { evaluateSavedNoteSource } from "@/lib/amora/savedNoteSource";
import { getAmoraVisibleText } from "@hanbang/shared/amora-visible-text";

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
const NOTES_PAGE_SIZE = 16;

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
): Promise<string | null | NextResponse> {
  const { data, error } = await supabase
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) return noteUnavailable();
  const coupleId = (data as { couple_id?: string | null } | null)?.couple_id;
  return typeof coupleId === "string" && coupleId.length > 0 ? coupleId : null;
}

function noteUnavailable() {
  return mobileBridgeJson({ error: "저장 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }, {
    status: 503, headers: RESPONSE_HEADERS,
  });
}

function savedNoteReceipt(row: unknown, requestedMemo: string | null, alreadySaved: boolean, userId: string) {
  if (!isRecord(row) || !isUuid(row.id) || typeof row.content !== "string" || !row.content.trim()
      || row.content.length > MAX_CONTENT_LENGTH
      || !(row.memo === null || (typeof row.memo === "string" && row.memo.length <= MAX_MEMO_LENGTH))) return noteUnavailable();
  return mobileBridgeJson({
    saved: true, id: row.id, memo: row.memo, alreadySaved, memoApplied: row.memo === requestedMemo,
    savedByMe: row.saved_by === userId,
  }, { headers: RESPONSE_HEADERS });
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

function readNoteCursor(raw: string | null, coupleId: string, userId: string): { createdAt: string; id: string } | null | NextResponse {
  if (raw === null) return null;
  try {
    if (raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const cursor: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!isRecord(cursor) || cursor.coupleId !== coupleId || cursor.userId !== userId
        || !isUuid(cursor.id) || typeof cursor.createdAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.createdAt)
        || !Number.isFinite(Date.parse(cursor.createdAt))) throw new Error();
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch {
    return mobileBridgeJson({ error: "페이지 정보가 바뀌었어요. 처음부터 다시 불러와 주세요." }, { status: 400, headers: RESPONSE_HEADERS });
  }
}

export async function GET(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const rawIds = params.get("messageIds");
    const messageIds = rawIds?.split(",") ?? null;
    if (messageIds && (rawIds!.length > 3_699 || messageIds.length < 1 || messageIds.length > 100
      || messageIds.some(id => !isUuid(id)) || params.has("cursor"))) {
      return mobileBridgeJson({ error: "메시지 목록을 다시 불러와 주세요." }, { status: 400, headers: RESPONSE_HEADERS });
    }
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return unauthenticated(req, messageIds ? { savedNotes: [], userId: null, coupleId: null } : { notes: [], count: 0, next_cursor: null });
    const coupleId = await resolveCoupleId(supabase, user.id);
    if (coupleId instanceof NextResponse) return coupleId;
    if (!coupleId) return mobileBridgeJson(messageIds ? { savedNotes: [], userId: user.id, coupleId: null } : { notes: [], count: 0, next_cursor: null }, { headers: RESPONSE_HEADERS });
    if (messageIds) {
      // 원문이나 메모를 읽지 않는다. 현재 커플의 공유 원문이 확인된 ID만 조회한다.
      const { data: sources, error: sourceError } = await supabase.from("chat_messages")
        .select("id").eq("couple_id", coupleId).eq("visibility", "shared")
        .in("id", [...new Set(messageIds)]).limit(100);
      if (sourceError) return noteUnavailable();
      const ids = (sources ?? []).map(source => source.id);
      if (!ids.length) return mobileBridgeJson({ savedNotes: [], userId: user.id, coupleId }, { headers: RESPONSE_HEADERS });
      const { data: rows, error } = await supabase.from("amora_saved_notes")
        .select("id, message_id, saved_by").eq("couple_id", coupleId).in("message_id", ids).limit(100);
      if (error) return noteUnavailable();
      return mobileBridgeJson({ savedNotes: (rows ?? []).map(row => ({ id: row.id, messageId: row.message_id, savedByMe: row.saved_by === user.id })), userId: user.id, coupleId }, { headers: RESPONSE_HEADERS });
    }
    const cursor = readNoteCursor(new URL(req.url).searchParams.get("cursor"), coupleId, user.id);
    if (cursor instanceof NextResponse) return cursor;

    let query = supabase
      .from("amora_saved_notes")
      .select("id, message_id, content, memo, saved_by, created_at")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(NOTES_PAGE_SIZE + 1);
    if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    const [{ data, error }, totals] = await Promise.all([query,
      supabase.from("amora_saved_notes").select("id", { count: "exact", head: true }).eq("couple_id", coupleId),
    ]);
    if (error || totals.error || totals.count === null || !Number.isSafeInteger(totals.count) || totals.count < 0) {
      return mobileBridgeJson(
        { error: "저장한 내용을 불러오지 못했습니다." },
        { status: 503, headers: RESPONSE_HEADERS },
      );
    }

    const rows = (data ?? []) as SavedNoteRow[];
    const pageSourceIds = [...new Set(rows.slice(0, NOTES_PAGE_SIZE)
      .map(row => row.message_id).filter((id): id is string => typeof id === "string"))];
    const aiSourceIds = new Set<string>();
    if (pageSourceIds.length > 0) {
      // 사용자 원문이나 출처가 사라진 옛 노트를 AI 답변으로 추정하지 않는다.
      // 본문·메모는 추가로 읽지 않고 현재 페이지의 공유 출처 종류만 확인한다.
      const { data: sources, error: sourceError } = await supabase.from("chat_messages")
        .select("id, role, sender_type").eq("couple_id", coupleId).eq("visibility", "shared")
        .in("id", pageSourceIds).limit(NOTES_PAGE_SIZE);
      if (sourceError) return noteUnavailable();
      for (const source of sources ?? []) {
        if (source.role === "assistant" && source.sender_type === "ai") aiSourceIds.add(source.id);
      }
    }
    const notes = rows.slice(0, NOTES_PAGE_SIZE).map((row) => ({
      id: row.id,
      messageId: row.message_id,
      content: row.message_id && aiSourceIds.has(row.message_id) ? getAmoraVisibleText(row.content) : row.content,
      sourceIsAi: row.message_id !== null && aiSourceIds.has(row.message_id),
      memo: row.memo,
      savedByMe: row.saved_by === user.id,
      createdAt: row.created_at,
    }));
    // 제어문자는 JSON에서6bytes가 될 수 있다. 행 수 상한뿐 아니라 실제 전송
    // 상한도 지키고, 줄이지 못한 원문은 다음 cursor에서 그대로 읽게 한다.
    do {
      const last = notes.at(-1);
      const nextCursor = last && rows.length > notes.length
        ? Buffer.from(JSON.stringify({ coupleId, userId: user.id, createdAt: last.createdAt, id: last.id })).toString("base64url") : null;
      const response = mobileBridgeJson({ notes, count: totals.count, next_cursor: nextCursor }, { headers: RESPONSE_HEADERS });
      if (response.status !== 507) return response;
      notes.pop();
    } while (notes.length > 0);
    return noteUnavailable();
  } catch (error) {
    log.error("api/amora/notes", error);
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
    if (coupleId instanceof NextResponse) return coupleId;
    if (!coupleId) {
      return mobileBridgeJson(
        { error: "커플 연결 후에 저장할 수 있어요." },
        { status: 409, headers: RESPONSE_HEADERS },
      );
    }

    // RLS 아래에서 읽으므로 다른 사람의 개인 상담은 애초에 보이지 않는다. 본인의 개인
    // 상담은 보이지만, 공유 범위로 넓히는 declassification 경로가 아직 없으므로 거부한다.
    const { data: sourceMessage, error: sourceError } = await supabase
      .from("chat_messages")
      .select("couple_id, visibility, content")
      .eq("id", sourceMessageId)
      .maybeSingle();
    if (sourceError) return noteUnavailable();
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
    // DB가 현재 소속·공유 원문·한도·중복 영수증을 하나의 잠금 경계에서 검증한다.
    // 클라이언트 본문과 조회 직후 바뀔 수 있는 원문 사본은 저장 입력으로 보내지 않는다.
    const { data, error } = await supabase.rpc("save_own_amora_note", {
      p_couple_id: coupleId, p_message_id: sourceMessageId, p_memo: memo,
    });
    if (error) {
      if (error.code === "54000") return mobileBridgeJson({ error: `저장은 ${MAX_NOTES}개까지 할 수 있어요. 오래된 것을 지우고 다시 시도해 주세요.`, code: "SAVED_NOTES_LIMIT" }, { status: 409, headers: RESPONSE_HEADERS });
      if (error.code === "42501") return mobileBridgeJson({ error: "현재 커플의 공유 대화만 저장할 수 있어요. 화면을 다시 열어 주세요." }, { status: 403, headers: RESPONSE_HEADERS });
      if (error.code === "P0002") return mobileBridgeJson({ error: "저장할 메시지를 찾지 못했어요." }, { status: 404, headers: RESPONSE_HEADERS });
      if (error.code === "22023") return mobileBridgeJson({ error: "저장할 메모를 확인해 주세요." }, { status: 400, headers: RESPONSE_HEADERS });
      return noteUnavailable();
    }
    if (!isRecord(data) || typeof data.already_saved !== "boolean") return noteUnavailable();
    return savedNoteReceipt(data.note, memo, data.already_saved, user.id);
  } catch (error) {
    log.error("api/amora/notes", error);
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

    if (!Object.prototype.hasOwnProperty.call(body, "expectedMemo")
        || !(body.expectedMemo === null || (typeof body.expectedMemo === "string" && body.expectedMemo.length <= MAX_MEMO_LENGTH))) {
      return mobileBridgeJson({ error: "현재 메모를 다시 불러온 뒤 확인해 주세요.", code: "SAVED_NOTE_VERSION_REQUIRED" }, { status: 400, headers: RESPONSE_HEADERS });
    }
    // CAS는 원래 저장값 그대로 비교한다. 과거 메모의 공백을 정규화하면 현재값과
    // 같아도 충돌로 오판하므로 새 메모 정리 규칙과 비교값을 분리한다.
    const expectedMemo = typeof body.expectedMemo === "string" ? body.expectedMemo : null;

    const coupleId = await resolveCoupleId(supabase, user.id);
    if (coupleId instanceof NextResponse) return coupleId;
    if (!coupleId) {
      return mobileBridgeJson(
        { error: "내가 저장한 답변의 메모만 수정할 수 있어요.", code: "AMORA_NOTE_NOT_OWNER" },
        { status: 403, headers: RESPONSE_HEADERS },
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from("amora_saved_notes")
      .select("id, saved_by")
      .eq("id", body.id)
      .eq("couple_id", coupleId)
      .maybeSingle();
    if (existingError) return noteUnavailable();
    if (existing && existing.saved_by !== user.id) {
      return mobileBridgeJson(
        { error: "내가 저장한 답변의 메모만 수정할 수 있어요.", code: "AMORA_NOTE_NOT_OWNER" },
        { status: 403, headers: RESPONSE_HEADERS },
      );
    }

    let query = supabase
      .from("amora_saved_notes")
      .update({ memo })
      .eq("id", body.id)
      .eq("couple_id", coupleId)
      .eq("saved_by", user.id);
    query = expectedMemo === null ? query.is("memo", null) : query.eq("memo", expectedMemo);
    const { data, error } = await query.select("id, memo, saved_by").maybeSingle();
    if (error) {
      return mobileBridgeJson(
        { error: "메모를 저장하지 못했습니다." },
        { status: 500, headers: RESPONSE_HEADERS },
      );
    }
    if (!data) {
      const { data: latest, error: latestError } = await supabase
        .from("amora_saved_notes")
        .select("id, saved_by")
        .eq("id", body.id)
        .eq("couple_id", coupleId)
        .maybeSingle();
      if (latestError) return noteUnavailable();
      if (latest && latest.saved_by !== user.id) {
        return mobileBridgeJson(
          { error: "내가 저장한 답변의 메모만 수정할 수 있어요.", code: "AMORA_NOTE_NOT_OWNER" },
          { status: 403, headers: RESPONSE_HEADERS },
        );
      }
      return mobileBridgeJson(
        { error: "다른 변경과 겹쳤어요. 현재 메모를 다시 불러온 뒤 확인해 주세요." },
        { status: 409, headers: RESPONSE_HEADERS },
      );
    }
    if ("saved_by" in data && typeof data.saved_by === "string" && data.saved_by !== user.id) {
      return mobileBridgeJson(
        { error: "내가 저장한 답변의 메모만 수정할 수 있어요.", code: "AMORA_NOTE_NOT_OWNER" },
        { status: 403, headers: RESPONSE_HEADERS },
      );
    }
    if (!isUuid(data.id) || data.id !== body.id || data.memo !== memo) return noteUnavailable();
    return mobileBridgeJson({ updated: true, id: data.id, memo: data.memo }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    log.error("api/amora/notes", error);
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

    if (!Object.prototype.hasOwnProperty.call(body, "expectedMemo")
        || !(body.expectedMemo === null || (typeof body.expectedMemo === "string" && body.expectedMemo.length <= MAX_MEMO_LENGTH))) {
      return mobileBridgeJson({ error: "삭제할 저장본과 메모를 다시 확인해 주세요." }, { status: 400, headers: RESPONSE_HEADERS });
    }
    const expectedMemo = body.expectedMemo;
    const coupleId = await resolveCoupleId(supabase, user.id);
    if (coupleId instanceof NextResponse) return coupleId;
    if (!coupleId) return mobileBridgeJson({ error: "현재 커플의 저장만 취소할 수 있어요." }, { status: 403, headers: RESPONSE_HEADERS });
    let deleteQuery = supabase
      .from("amora_saved_notes")
      .delete()
      .eq("id", body.id).eq("couple_id", coupleId).eq("saved_by", user.id);
    // 조회-삭제 사이가 아니라 DELETE 자체의 조건으로 승인한 메모를 비교한다.
    deleteQuery = expectedMemo === null ? deleteQuery.is("memo", null) : deleteQuery.eq("memo", expectedMemo);
    const { data: deleted, error } = await deleteQuery.select("id").maybeSingle();
    if (error) {
      return mobileBridgeJson(
        { error: "삭제하지 못했습니다." },
        { status: 500, headers: RESPONSE_HEADERS },
      );
    }
    if (!deleted) {
      const { data: existing, error: existingError } = await supabase.from("amora_saved_notes")
        .select("id, saved_by").eq("id", body.id).eq("couple_id", coupleId).maybeSingle();
      if (existingError) return noteUnavailable();
      if (existing) return existing.saved_by === user.id
        ? mobileBridgeJson({ error: "저장된 메모가 바뀌었어요. 최신 저장본을 다시 확인한 뒤 삭제해 주세요.", code: "SAVED_NOTE_CHANGED" }, { status: 409, headers: RESPONSE_HEADERS })
        : mobileBridgeJson({ error: "파트너가 저장한 내용은 취소할 수 없어요." }, { status: 403, headers: RESPONSE_HEADERS });
    } else if (deleted.id !== body.id) return noteUnavailable();
    // 이미 없어도 원하는 상태이므로 성공으로 답한다(재시도 안전).
    return mobileBridgeJson({ deleted: true, id: body.id }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    log.error("api/amora/notes", error);
    return mobileBridgeJson(
      { error: "서버 오류" },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}
