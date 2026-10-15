import { NextRequest } from "next/server";
import { presentComparison, validateSubmission } from "@/lib/weddingCode36";
import { limitRequest, ownerCredentials, privateJson, rpcFailure, rpcObject, serverFailure, serviceClient } from "@/lib/weddingCode36Server/api";
import { isUuid } from "@/utils/requestValidation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const limited = await limitRequest(request, "report", 720);
    if (limited) return limited;
    const credentials = ownerCredentials({ response_id: request.nextUrl.searchParams.get("response_id"), access_token: request.headers.get("x-wedding-code-access-token") });
    if (!credentials) return privateJson({ error: "본인의 결과에서 비교를 열어 주세요." }, 403);
    const { data, error } = await serviceClient().rpc("wc36_read_report", { p_response_id: credentials.responseId, p_access_hash: credentials.hash });
    const row = rpcObject(data);
    if (error || !row) return privateJson({ error: "비교 결과를 불러오지 못했어요." }, 503);
    if (row.error) return rpcFailure(row);
    if (row.status === "unpaired") return privateJson({ status: "unpaired" });
    if (row.status === "waiting" && isUuid(row.invite_token)) return privateJson({ status: "waiting", coupleToken: row.invite_token });
    if (row.status !== "ready") return privateJson({ error: "비교 결과를 확인하지 못했어요." }, 503);
    let report;
    try { report = presentComparison(validateSubmission(row.own_submission), validateSubmission(row.partner_submission)); }
    catch { return privateJson({ error: "두 결과의 문항 버전을 확인하지 못했어요." }, 503); }
    // 원본 submission, 비밀키, 미공유 문항·이름은 HTTP 응답에 포함하지 않는다.
    return privateJson({ status: "ready", viewer: "a", report });
  } catch (error) { return serverFailure(error); }
}
