import { NextRequest } from "next/server";
import { limitRequest, privateJson, rpcObject, serverFailure, serviceClient } from "@/lib/weddingCode36Server/api";
import { isUuid } from "@/utils/requestValidation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const limited = await limitRequest(request, "invite", 120);
    if (limited) return limited;
    const token = request.nextUrl.searchParams.get("token");
    if (!isUuid(token)) return privateJson({ error: "초대 링크를 확인해 주세요." }, 400);
    const { data, error } = await serviceClient().rpc("wc36_invite_status", { p_invite_token: token });
    const row = rpcObject(data);
    if (error || !row || !["waiting", "full", "not_found"].includes(String(row.status))) return privateJson({ error: "초대 링크를 확인하지 못했어요." }, 503);
    return privateJson({ status: row.status });
  } catch (error) { return serverFailure(error); }
}
