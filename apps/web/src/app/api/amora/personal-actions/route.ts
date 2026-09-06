import { NextResponse } from "next/server";
import { isPersonalActionId, normalizePersonalActionDraft, parsePersonalAction, parsePersonalActionPage, parsePersonalActionReceipt } from "@hanbang/shared/amora-personal-actions";
import { createClientFromRequest } from "@/lib/supabase/server";
import { mobileBridgeJson } from "@/lib/mobile/boundedJsonResponse";
import { isBodyTooLarge, isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { log } from "@/utils/log";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Origin, Sec-Fetch-Site, Authorization" };
const COLUMNS = "id, owner_user_id, source_message_id, title, description, due_date, status, revision, created_at, updated_at";
const json = (body: unknown, status = 200) => mobileBridgeJson(body, { status, headers: HEADERS });
const unavailable = () => json({ error: "개인 할 일을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
const denied = () => json({ error: "로그인 계정이 바뀌었어요. 화면을 다시 열어 주세요." }, 403);

async function context(req: Request) {
  const client = await createClientFromRequest(req);
  const { data: { user }, error } = await client.auth.getUser();
  if (error && (!error.status || error.status >= 500)) return unavailable();
  if (!user) return json({ error: "로그인이 필요합니다." }, 401);
  return { client, user };
}

async function body(req: Request, keys: string[]) {
  if (isBodyTooLarge(req, 8 * 1024)) return json({ error: "요청이 너무 큽니다." }, 413);
  const result = await readBoundedUtf8Text(req, 8 * 1024);
  if (!result.ok) return json({ error: "요청을 읽을 수 없습니다." }, result.reason === "too_large" ? 413 : 400);
  let value: unknown;
  try { value = JSON.parse(result.text); } catch { value = null; }
  if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key))) return json({ error: "요청 형식을 확인해 주세요." }, 400);
  return value;
}

function toAction(row: unknown, ownerId: string) {
  if (!isRecord(row)) return null;
  return parsePersonalAction({ id: row.id, ownerUserId: row.owner_user_id, sourceMessageId: row.source_message_id,
    title: row.title, description: row.description, dueDate: row.due_date, status: row.status,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }, ownerId);
}

function failure(code?: string) {
  if (code === "P0002") return json({ code: "PERSONAL_ACTION_SOURCE_PROVENANCE_UNAVAILABLE", error: "이전 답변의 연결 정보를 확인할 수 없어요. 새 개인 상담에서 답변을 받은 뒤 다시 담아 주세요." }, 409);
  if (code === "42501") return json({ error: "지금 로그인한 본인의 개인 상담 답변만 담을 수 있어요. 새 개인 상담에서 다시 시도해 주세요." }, 403);
  if (code === "23505") return json({ code: "PERSONAL_ACTION_REQUEST_CONFLICT", error: "이 저장 요청의 내용이 바뀌었어요. 내용을 다시 확인해 주세요." }, 409);
  if (code === "54000") return json({ code: "PERSONAL_ACTION_LIMIT_REACHED", error: "개인 할 일은 300개까지 보관할 수 있어요. 기존 할 일을 삭제한 뒤 다시 시도해 주세요." }, 409);
  if (["22023", "22007", "22008", "23514"].includes(code ?? "")) return json({ error: "제목·메모·날짜를 다시 확인해 주세요." }, 400);
  return unavailable();
}

function limited(req: Request, userId: string) {
  const result = checkRateLimit(rateLimitKey("amora-personal-actions", req, userId), { maxRequests: 60, windowMs: 60_000 });
  if (result) for (const [key,value] of Object.entries(HEADERS)) result.headers.set(key, value);
  return result;
}

type Cursor = { ownerId: string; status: string; createdAt: string; id: string };
function readCursor(raw: string | null, ownerId: string, status: string): Cursor | null | NextResponse {
  if (raw === null) return null;
  try {
    if (raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!isRecord(value) || value.ownerId !== ownerId || value.status !== status || !isPersonalActionId(value.id)
      || typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.createdAt)
      || !Number.isFinite(Date.parse(value.createdAt))) throw new Error();
    return { ownerId, status, id: value.id, createdAt: value.createdAt };
  } catch { return json({ error: "목록을 처음부터 다시 불러와 주세요." }, 400); }
}

export async function GET(req: Request) {
  try {
    const auth = await context(req); if (auth instanceof NextResponse) return auth;
    const params = new URL(req.url).searchParams;
    const status = params.get("status") ?? "all";
    const rawLimit = params.get("limit") ?? "30";
    if (!["all","open","done"].includes(status) || !/^\d{1,2}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 30) return json({ error: "목록 조건을 확인해 주세요." }, 400);
    const limit = Number(rawLimit);
    const cursor = readCursor(params.get("cursor"), auth.user.id, status); if (cursor instanceof NextResponse) return cursor;
    let query = auth.client.from("amora_personal_actions").select(COLUMNS).eq("owner_user_id", auth.user.id)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    let countQuery = auth.client.from("amora_personal_actions").select("id", { head: true, count: "exact" }).eq("owner_user_id", auth.user.id);
    if (status !== "all") { query = query.eq("status", status); countQuery = countQuery.eq("status", status); }
    if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    const [{ data, error }, totals] = await Promise.all([query, countQuery]);
    if (error || totals.error || !Array.isArray(data)) return unavailable();
    const actions = data.slice(0, limit).map(row => toAction(row, auth.user.id));
    if (actions.some(row => row === null)) return unavailable();
    const last = actions.at(-1);
    const nextCursor = data.length > limit && last ? Buffer.from(JSON.stringify({ ownerId: auth.user.id, status, createdAt: last.createdAt, id: last.id })).toString("base64url") : null;
    const payload = { actions, count: totals.count, next_cursor: nextCursor };
    if (!parsePersonalActionPage(payload, auth.user.id)) return unavailable();
    return json(payload);
  } catch {
    log.error("api/amora/personal-actions GET", new Error("PERSONAL_ACTION_READ_UNAVAILABLE"));
    return unavailable();
  }
}

export async function POST(req: Request) {
  if (!isTrustedMutationRequest(req)) return json({ error: "요청 출처를 확인해 주세요." }, 403);
  try {
    const auth = await context(req); if (auth instanceof NextResponse) return auth;
    const limit = limited(req, auth.user.id); if (limit) return limit;
    const value = await body(req, ["messageId","requestId","expectedOwnerId","expectedCoupleId","title","description","dueDate"]); if (value instanceof NextResponse) return value;
    if (value.expectedOwnerId !== auth.user.id) return denied();
    const draft = normalizePersonalActionDraft(value);
    if (!draft || !isPersonalActionId(value.messageId) || !isPersonalActionId(value.requestId) || !isPersonalActionId(value.expectedCoupleId)) return json({ error: "개인 할 일 내용을 확인해 주세요." }, 400);
    const { data, error } = await auth.client.rpc("save_own_amora_personal_action", {
      p_owner_id: auth.user.id, p_couple_id: value.expectedCoupleId, p_message_id: value.messageId,
      p_request_id: value.requestId, p_title: draft.title, p_description: draft.description, p_due_date: draft.dueDate,
    });
    if (error) return failure(error.code);
    const action = toAction(data, auth.user.id);
    const payload = { saved: true, action };
    if (!parsePersonalActionReceipt(payload, auth.user.id, { kind: "save", sourceMessageId: value.messageId, draft })) return unavailable();
    return json(payload);
  } catch {
    log.error("api/amora/personal-actions POST", new Error("PERSONAL_ACTION_SAVE_UNAVAILABLE"));
    return unavailable();
  }
}

async function mutate(req: Request, operation: "update" | "delete") {
  if (!isTrustedMutationRequest(req)) return json({ error: "요청 출처를 확인해 주세요." }, 403);
  try {
    const auth = await context(req); if (auth instanceof NextResponse) return auth;
    const limit = limited(req, auth.user.id); if (limit) return limit;
    const value = await body(req, operation === "update" ? ["id","status","expectedRevision","expectedOwnerId"] : ["id","expectedRevision","expectedOwnerId"]); if (value instanceof NextResponse) return value;
    if (value.expectedOwnerId !== auth.user.id) return denied();
    if (!isPersonalActionId(value.id) || typeof value.expectedRevision !== "number" || !Number.isInteger(value.expectedRevision) || value.expectedRevision < 1 || value.expectedRevision >= 2_147_483_647
      || (operation === "update" && value.status !== "open" && value.status !== "done")) return json({ error: "변경할 개인 할 일을 다시 확인해 주세요." }, 400);
    const query = operation === "update" ? auth.client.from("amora_personal_actions").update({ status: value.status }) : auth.client.from("amora_personal_actions").delete();
    const { data, error } = await query.eq("owner_user_id", auth.user.id).eq("id", value.id).eq("revision", value.expectedRevision).select(operation === "update" ? COLUMNS : "id").maybeSingle();
    if (error) return failure(error.code);
    if (!data) {
      const existing = await auth.client.from("amora_personal_actions").select("id").eq("owner_user_id", auth.user.id).eq("id", value.id).maybeSingle();
      if (existing.error) return unavailable();
      if (existing.data) return json({ error: "다른 변경이 먼저 반영됐어요. 목록을 다시 불러와 주세요." }, 409);
      return operation === "delete" ? json({ deleted: true, id: value.id }) : json({ error: "개인 할 일을 찾지 못했어요." }, 404);
    }
    if (operation === "delete") return isRecord(data) && data.id === value.id ? json({ deleted: true, id: value.id }) : unavailable();
    const action = toAction(data, auth.user.id);
    const payload = { updated: true, action };
    if (!parsePersonalActionReceipt(payload, auth.user.id, { kind: "update", id: value.id, status: value.status as "open" | "done", revision: value.expectedRevision })) return unavailable();
    return json(payload);
  } catch {
    log.error("api/amora/personal-actions mutation", new Error("PERSONAL_ACTION_MUTATION_UNAVAILABLE"));
    return unavailable();
  }
}
export const PATCH = (req: Request) => mutate(req, "update");
export const DELETE = (req: Request) => mutate(req, "delete");
