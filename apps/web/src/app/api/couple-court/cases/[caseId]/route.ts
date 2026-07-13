import { NextResponse } from "next/server";
import {
  archiveCourtCaseForUser,
  deleteCourtCaseForUser,
  getCourtCaseForUser,
} from "@/lib/coupleCourt/repository";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isUuid } from "@/utils/requestValidation";
import {
  CourtApiError,
  courtErrorResponse,
  noStoreJson,
  readCourtJson,
  requireCoupleCourtEnabled,
  requireCourtUser,
} from "../../_shared";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

async function validCaseId(context: RouteContext): Promise<string> {
  const { caseId } = await context.params;
  if (!isUuid(caseId)) {
    throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
  }
  return caseId;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const caseId = await validCaseId(context);
    const courtCase = await getCourtCaseForUser(caseId, user.id);
    return noStoreJson({
      ...courtCase,
      verdict: courtCase.verdict ? { generation_status: "ready" } : null,
      missions: [],
    });
  } catch (error) {
    return courtErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const body = await readCourtJson(request, 1_024);
    const action = body.action === "delete" ? "delete" : "archive";
    if (body.action !== undefined && body.action !== "archive" && body.action !== "delete") {
      throw new CourtApiError(400, "COURT_CASE_ACTION_INVALID", "사건 처리 방식을 확인해 주세요.");
    }
    if (action === "delete" && body.confirmation !== "영구삭제") {
      throw new CourtApiError(
        400,
        "COURT_DELETE_CONFIRMATION_REQUIRED",
        "영구 삭제 확인 문구를 입력해 주세요.",
      );
    }
    const limited = await checkRateLimitPersistent(
      rateLimitKey(`couple-court:case:${action}`, request, user.id),
      { maxRequests: 10, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    const caseId = await validCaseId(context);
    if (action === "delete") {
      await deleteCourtCaseForUser(caseId, user.id);
    } else {
      await archiveCourtCaseForUser(caseId, user.id);
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
