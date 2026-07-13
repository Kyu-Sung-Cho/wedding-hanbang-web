import {
  getCourtCaseForUser,
  publishCourtPublicPostForUser,
  withdrawCourtPublicPostForUser,
} from "@/lib/coupleCourt/repository";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isUuid } from "@/utils/requestValidation";
import {
  CourtApiError,
  courtErrorResponse,
  noStoreJson,
  readCourtJson,
  requireCoupleCourtPublicEnabled,
  requireCourtUser,
} from "../../../_shared";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}
async function validatedTarget(
  request: Request,
  context: RouteContext,
  userId: string,
): Promise<string> {
  const body = await readCourtJson(request, 4 * 1024);
  const { caseId } = await context.params;
  const publicPostId = typeof body.public_post_id === "string" ? body.public_post_id : "";
  if (!isUuid(caseId) || !isUuid(publicPostId)) {
    throw new CourtApiError(400, "COURT_PUBLIC_TARGET_INVALID", "공개 대상을 확인해 주세요.");
  }
  const current = await getCourtCaseForUser(caseId, userId);
  if (current.publicPost?.id !== publicPostId) {
    throw new CourtApiError(409, "COURT_PUBLIC_SNAPSHOT_CHANGED", "공개 미리보기가 바뀌었어요. 다시 확인해 주세요.");
  }
  return publicPostId;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtPublicEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:public:publish", request, user.id),
      { maxRequests: 8, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    const publicPostId = await validatedTarget(request, context, user.id);
    const publicPost = await publishCourtPublicPostForUser(publicPostId, user.id);
    return noStoreJson({ public_post: publicPost });
  } catch (error) {
    return courtErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtPublicEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:public:withdraw", request, user.id),
      { maxRequests: 8, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    const publicPostId = await validatedTarget(request, context, user.id);
    await withdrawCourtPublicPostForUser(publicPostId, user.id);
    return noStoreJson({ hidden: true });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
