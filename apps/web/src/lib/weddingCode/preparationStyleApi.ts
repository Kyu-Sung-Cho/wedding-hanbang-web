import { NextResponse } from "next/server";

import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isBodyTooLarge, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import {
  PREPARATION_STYLE_OWNER_HEADER, PREPARATION_STYLE_SAVE_CONSENT_VERSION, PREPARATION_STYLE_SHARE_CONSENT_VERSION,
  hasPreparationStyleKeys, isPreparationStyleAnswer, isPreparationStyleId, isPreparationStyleRecord,
  isPreparationStyleRevision, parsePreparationStyleSnapshot, type PreparationStyleSnapshot,
} from "./preparationStyle";

type Operation = "read" | "save" | "clear" | "share" | "unshare";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization, Origin, Sec-Fetch-Site" };
const MAX_BODY_BYTES = 2048;
const BODY_KEYS: Record<Exclude<Operation, "read">, readonly string[]> = {
  save: ["expectedOwnerUserId", "expectedRevision", "sceneVersion", "answerCode", "saveConsentVersion"],
  clear: ["expectedOwnerUserId", "expectedRevision"],
  share: ["expectedOwnerUserId", "expectedRevision", "expectedCoupleId", "expectedPartnerUserId", "shareConsentVersion"],
  unshare: ["expectedOwnerUserId", "expectedRevision"],
};
function respond(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}
async function readBody(request: Request): Promise<Record<string, unknown> | NextResponse> {
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) return respond({ error: "요청 내용이 너무 큽니다." }, 413);
  const bounded = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!bounded.ok) return respond({ error: "요청 내용을 확인할 수 없습니다." }, bounded.reason === "too_large" ? 413 : 400);
  try {
    const parsed: unknown = JSON.parse(bounded.text);
    if (isPreparationStyleRecord(parsed)) return parsed;
  } catch { /* 잘못된 본문은 저장하지 않는다. */ }
  return respond({ error: "요청 형식이 올바르지 않습니다." }, 400);
}
function rpcFailure(error: { code?: string; message?: string }): NextResponse {
  if (error.code === "40001") return respond({ code: "PREPARATION_STYLE_CONFLICT", error: "답변이나 연결 정보가 바뀌었어요. 새로 불러온 뒤 확인해 주세요." }, 409);
  if (error.code === "22023") return respond({ error: "저장할 답변과 확인 내용을 다시 확인해 주세요." }, 400);
  if (error.code === "28000") return respond({ error: "로그인이 필요합니다." }, 401);
  if (error.message?.includes("PREPARATION_STYLE_ACCOUNT_UNAVAILABLE")) return respond({ code: "PREPARATION_STYLE_ACCOUNT_UNAVAILABLE", error: "현재 계정에서 준비 스타일을 이용할 수 없어요." }, 409);
  console.error("[wedding-preparation-style] RPC failed", { code: error.code });
  return respond({ error: "준비 스타일을 처리하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
}
function acknowledged(operation: Operation, snapshot: PreparationStyleSnapshot, body: Record<string, unknown>): boolean {
  const expectedRevision = isPreparationStyleRevision(body.expectedRevision) ? body.expectedRevision : 0;
  if (operation === "save") return snapshot.own !== null && snapshot.own.sceneVersion === body.sceneVersion && snapshot.own.answerCode === body.answerCode;
  if (operation === "clear") return snapshot.stateRevision !== null && snapshot.stateRevision > expectedRevision && snapshot.own === null && snapshot.sharing === null && snapshot.partner === null;
  if (operation === "share") return snapshot.own !== null && snapshot.own.revision > expectedRevision && snapshot.sharing?.responseRevision === snapshot.own.revision
    && snapshot.coupleId === body.expectedCoupleId && snapshot.partnerUserId === body.expectedPartnerUserId;
  if (operation === "unshare") return snapshot.stateRevision !== null && snapshot.stateRevision > expectedRevision && snapshot.sharing === null && snapshot.partner === null;
  return true;
}
export async function handlePreparationStyleRequest(request: Request, operation: Operation): Promise<NextResponse> {
  try {
    const supabase = await createClientFromRequest(request);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return respond({ error: "로그인이 필요합니다." }, 401);
    if (operation !== "read" && !isTrustedMutationRequest(request)) return respond({ error: "잘못된 요청 출처입니다." }, 403);
    const limited = checkRateLimit(rateLimitKey(`wedding-preparation-style:${operation === "read" ? "read" : "write"}`, request, user.id), {
      maxRequests: operation === "read" ? 120 : 30, windowMs: 60_000,
    });
    if (limited) {
      for (const [key, value] of Object.entries(PRIVATE_HEADERS)) limited.headers.set(key, value);
      return limited;
    }
    let body: Record<string, unknown> = {};
    if (operation !== "read") {
      const parsed = await readBody(request);
      if (parsed instanceof NextResponse) return parsed;
      body = parsed;
      if (!hasPreparationStyleKeys(body, BODY_KEYS[operation])) return respond({ error: "허용되지 않은 요청 항목입니다." }, 400);
    }
    const owner = operation === "read" ? request.headers.get(PREPARATION_STYLE_OWNER_HEADER) : body.expectedOwnerUserId;
    if (!isPreparationStyleId(owner)) return respond({ error: "현재 계정 정보를 확인해 주세요." }, 400);
    if (owner !== user.id) return respond({ code: "PREPARATION_STYLE_OWNER_MISMATCH", error: "로그인 계정이 바뀌었어요. 현재 계정을 확인해 주세요." }, 409);
    if (operation !== "read" && !(operation === "save" && body.expectedRevision === null) && !isPreparationStyleRevision(body.expectedRevision)) {
      return respond({ error: "변경할 답변의 버전을 확인해 주세요." }, 400);
    }
    if (operation === "save" && (body.saveConsentVersion !== PREPARATION_STYLE_SAVE_CONSENT_VERSION || !isPreparationStyleAnswer(body.sceneVersion, body.answerCode))) {
      return respond({ error: "저장할 답변과 계정 저장 확인이 올바르지 않습니다." }, 400);
    }
    if (operation === "share" && (body.shareConsentVersion !== PREPARATION_STYLE_SHARE_CONSENT_VERSION || !isPreparationStyleId(body.expectedCoupleId)
      || !isPreparationStyleId(body.expectedPartnerUserId) || body.expectedPartnerUserId === user.id)) {
      return respond({ error: "공유할 상대와 공유 확인을 다시 확인해 주세요." }, 400);
    }
    const names: Record<Operation, string> = {
      read: "get_own_wedding_preparation_style", save: "set_own_wedding_preparation_style", clear: "clear_own_wedding_preparation_style",
      share: "share_own_wedding_preparation_style", unshare: "unshare_own_wedding_preparation_style",
    };
    const params = operation === "read" ? {} : { p_expected_revision: body.expectedRevision,
      ...(operation === "save" ? { p_scene_version: body.sceneVersion, p_answer_code: body.answerCode, p_save_consent_version: body.saveConsentVersion } : {}),
      ...(operation === "share" ? { p_expected_couple_id: body.expectedCoupleId, p_expected_partner_user_id: body.expectedPartnerUserId, p_share_consent_version: body.shareConsentVersion } : {}),
    };
    const { data, error } = await supabase.rpc(names[operation], params);
    if (error) return rpcFailure(error);
    const snapshot = parsePreparationStyleSnapshot(data);
    if (!snapshot || snapshot.ownerUserId !== user.id || !acknowledged(operation, snapshot, body)) {
      console.error("[wedding-preparation-style] unverified RPC acknowledgement", { operation });
      return respond({ error: "처리 결과를 확인하지 못했어요. 다시 불러와 확인해 주세요." }, 503);
    }
    return respond({ snapshot });
  } catch {
    console.error("[wedding-preparation-style] request failed", { operation });
    return respond({ error: "준비 스타일을 처리하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
  }
}
