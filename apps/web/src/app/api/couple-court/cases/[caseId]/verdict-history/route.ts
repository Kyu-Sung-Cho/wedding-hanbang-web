import { getCourtVerdictHistoryForUser } from "@/lib/coupleCourt/repository";
import { isUuid } from "@/utils/requestValidation";
import {
  CourtApiError,
  courtErrorResponse,
  noStoreJson,
  requireCoupleCourtEnabled,
  requireCourtUser,
} from "../../../_shared";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const { caseId } = await context.params;
    if (!isUuid(caseId)) {
      throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
    }
    const history = await getCourtVerdictHistoryForUser(caseId, user.id);
    return noStoreJson({ history });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
