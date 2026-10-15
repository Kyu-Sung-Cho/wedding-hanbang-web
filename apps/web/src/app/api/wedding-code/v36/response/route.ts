import { NextRequest } from "next/server";
import { validateSubmission } from "@/lib/weddingCode36";
import { accessHash, limitRequest, ownerCredentials, privateJson, readSmallJson, rpcFailure, rpcObject, serverFailure, serviceClient } from "@/lib/weddingCode36Server/api";
import { isRecord, isUuid } from "@/utils/requestValidation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const limited = await limitRequest(request, "submit", 30);
    if (limited) return limited;
    const body = await readSmallJson(request);
    if (!isRecord(body) || body.consent !== true || !isUuid(body.submission_id) || !isUuid(body.access_token) || (body.invite_token != null && !isUuid(body.invite_token))) {
      return privateJson({ error: "응답과 저장 동의를 확인해 주세요." }, 400);
    }
    let submission;
    try { submission = validateSubmission(body); } catch { return privateJson({ error: "문항 버전과 36개 응답을 확인해 주세요." }, 400); }
    const { data, error } = await serviceClient().rpc("wc36_submit", {
      p_submission_id: body.submission_id,
      p_access_hash: accessHash(body.access_token),
      p_submission: submission,
      p_invite_token: body.invite_token ?? null,
    });
    const row = rpcObject(data);
    if (error || !row) return privateJson({ error: "저장하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
    if (row.error) return rpcFailure(row);
    const status = row.pairing_status;
    if (!isUuid(row.response_id) || typeof row.recovered !== "boolean" || !["unpaired", "waiting", "paired", "full"].includes(String(status)) || ((status === "waiting" || status === "paired") ? !isUuid(row.invite_token) : row.invite_token !== null)) {
      return privateJson({ error: "저장 결과를 확인하지 못했어요." }, 503);
    }
    let canonical;
    try { canonical = validateSubmission(row.submission); } catch { return privateJson({ error: "저장 결과를 확인하지 못했어요." }, 503); }
    if (typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at))) return privateJson({ error: "결과 보관 기간을 확인하지 못했어요." }, 503);
    const pairingError = row.pairing_error === "invite_not_found" || row.pairing_error === "invite_expired" || row.pairing_error === "self_pair" ? row.pairing_error : undefined;
    return privateJson({ success: true, id: row.response_id, submission: canonical, expiresAt: row.expires_at, paired: status === "paired", pairingStatus: status, coupleToken: row.invite_token, recovered: row.recovered, ...(pairingError ? { pairingError } : {}) });
  } catch (error) { return serverFailure(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const limited = await limitRequest(request, "sharing", 60);
    if (limited) return limited;
    const body = await readSmallJson(request, 8 * 1024);
    const credentials = ownerCredentials(body);
    if (!isRecord(body) || !credentials || typeof body.allow_couple_comparison !== "boolean" || typeof body.share_alias !== "boolean" || !Array.isArray(body.share_item_ids)) return privateJson({ error: "공유 설정을 확인해 주세요." }, 400);
    const admin = serviceClient();
    // 문항 ID 검증은 개인 결과와 동일한 계약을 사용한다.
    const { ITEMS, FINGERPRINT, QUESTIONNAIRE_VERSION } = await import("@/constants/weddingCode36");
    try { validateSubmission({ questionnaire_version: QUESTIONNAIRE_VERSION, questionnaire_fingerprint: FINGERPRINT, answers: Object.fromEntries(ITEMS.map(item => [item.id, null])), missing_reasons: {}, allow_couple_comparison: body.allow_couple_comparison, share_alias: body.share_alias, share_item_ids: body.share_item_ids }); }
    catch { return privateJson({ error: "공유할 문항을 확인해 주세요." }, 400); }
    const { data, error } = await admin.rpc("wc36_update_sharing", {
      p_response_id: credentials.responseId, p_access_hash: credentials.hash,
      p_settings: { allow_couple_comparison: body.allow_couple_comparison, share_alias: body.share_alias, share_item_ids: body.share_item_ids },
    });
    const row = rpcObject(data);
    if (error || !row) return privateJson({ error: "공유 설정을 저장하지 못했어요." }, 503);
    if (row.error) return rpcFailure(row);
    if (typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at))) return privateJson({ error: "결과 보관 기간을 확인하지 못했어요." }, 503);
    try { return privateJson({ success: true, submission: validateSubmission(row.submission), expiresAt: row.expires_at }); }
    catch { return privateJson({ error: "저장 결과를 확인하지 못했어요." }, 503); }
  } catch (error) { return serverFailure(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const limited = await limitRequest(request, "delete", 30);
    if (limited) return limited;
    const credentials = ownerCredentials(await readSmallJson(request, 2 * 1024));
    if (!credentials) return privateJson({ error: "삭제할 본인 결과를 확인해 주세요." }, 400);
    const { data, error } = await serviceClient().rpc("wc36_delete", {
      p_response_id: credentials.responseId, p_access_hash: credentials.hash,
    });
    const row = rpcObject(data);
    if (error || !row) return privateJson({ error: "결과를 삭제하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
    if (row.error) return rpcFailure(row);
    if (row.deleted !== true) return privateJson({ error: "삭제 결과를 확인하지 못했어요." }, 503);
    return privateJson({ success: true, deleted: true });
  } catch (error) { return serverFailure(error); }
}
