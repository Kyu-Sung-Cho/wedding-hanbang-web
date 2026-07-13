import { createOrLinkCourtMissionActionForUser } from "@/lib/coupleCourt/repository";
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
      rateLimitKey("couple-court:mission:save-action", request, user.id),
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;

    const body = await readCourtJson(request, 2_048);
    const { missionId } = await context.params;
    if (!isUuid(missionId)) {
      throw new CourtApiError(404, "COURT_MISSION_NOT_FOUND", "해당 처방을 찾을 수 없어요.");
    }

    // The RPC owns authorization, current-couple validation, idempotency,
    // action creation, and mission linking in one database transaction.
    const saved = await createOrLinkCourtMissionActionForUser({
      missionId,
      userId: user.id,
      confirmShared: body.confirm_shared === true,
    });
    const action = saved.action;
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      throw new CourtApiError(
        500,
        "COURT_ACTION_SAVE_FAILED",
        "저장된 할일 상태를 확인하지 못했어요.",
      );
    }

    return noStoreJson(
      { action },
      { status: saved.reused === true ? 200 : 201 },
    );
  } catch (error) {
    return courtErrorResponse(error);
  }
}
