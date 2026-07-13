import { setCourtMissionStatusForUser } from "@/lib/coupleCourt/repository";
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
  params: Promise<{ missionId: string }>;
}
export async function POST(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:mission:accept", request, user.id),
      { maxRequests: 30, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    await readCourtJson(request, 1024);
    const { missionId } = await context.params;
    if (!isUuid(missionId)) {
      throw new CourtApiError(404, "COURT_MISSION_NOT_FOUND", "화해 처방을 찾을 수 없어요.");
    }
    const completion = await setCourtMissionStatusForUser({
      missionId,
      userId: user.id,
      status: "accepted",
    });
    return noStoreJson({ completion });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
