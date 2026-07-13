import { leaveCourtCaseForUser } from "@/lib/coupleCourt/repository";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isUuid } from "@/utils/requestValidation";
import {
  CourtApiError,
  courtErrorResponse,
  noStoreJson,
  readCourtJson,
  requireCoupleCourtEnabled,
  requireCourtUser,
} from "../../../_shared";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:participation:leave", request, user.id),
      { maxRequests: 6, windowMs: 60 * 60 * 1_000 },
      user.id,
    );
    if (limited) return limited;
    await readCourtJson(request, 1_024);
    const { caseId } = await context.params;
    if (!isUuid(caseId)) {
      throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
    }
    const result = await leaveCourtCaseForUser(caseId, user.id);
    return noStoreJson({ participation: result });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
