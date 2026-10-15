import { NextRequest } from "next/server";
import { limitRequest, ownerCredentials, privateJson, readSmallJson, rpcFailure, rpcObject, serverFailure, serviceClient } from "@/lib/weddingCode36Server/api";
import { isRecord, isUuid } from "@/utils/requestValidation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const limited = await limitRequest(request, "pair", 60);
    if (limited) return limited;
    const body = await readSmallJson(request, 4 * 1024);
    const credentials = ownerCredentials(body);
    if (!isRecord(body) || !credentials || (body.invite_token != null && !isUuid(body.invite_token))) return privateJson({ error: "연결 요청을 확인해 주세요." }, 400);
    const { data, error } = await serviceClient().rpc("wc36_pair", { p_response_id: credentials.responseId, p_access_hash: credentials.hash, p_invite_token: body.invite_token ?? null });
    const row = rpcObject(data);
    if (error || !row) return privateJson({ error: "연결하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
    if (row.error) return rpcFailure(row);
    if (row.pairing_status === "full" && row.invite_token === null) return privateJson({ error: "이 링크는 이미 두 분이 사용했어요.", pairingStatus: "full" }, 409);
    if (!["waiting", "paired"].includes(String(row.pairing_status)) || !isUuid(row.invite_token)) return privateJson({ error: "연결 결과를 확인하지 못했어요." }, 503);
    return privateJson({ success: true, id: credentials.responseId, pairingStatus: row.pairing_status, coupleToken: row.invite_token });
  } catch (error) { return serverFailure(error); }
}
