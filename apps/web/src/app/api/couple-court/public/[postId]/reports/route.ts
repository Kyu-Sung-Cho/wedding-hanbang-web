import { createCourtPublicReportForUser } from "@/lib/coupleCourt/repository";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { cleanOptionalEnum, isUuid } from "@/utils/requestValidation";
import {
  CourtApiError,
  courtErrorResponse,
  noStoreJson,
  readCourtJson,
  requireCoupleCourtPublicEnabled,
  requireCourtUser,
} from "../../../_shared";

export const dynamic = "force-dynamic";

const REPORT_REASONS = ["harassment", "pii", "threat", "hate", "spam", "minor_safety", "other"] as const;

interface RouteContext {
  params: Promise<{ postId: string }>;
}
export async function POST(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtPublicEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:public:report", request, user.id),
      { maxRequests: 12, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    const body = await readCourtJson(request, 4 * 1024);
    const { postId } = await context.params;
    const reasonCode = cleanOptionalEnum(body.reason_code ?? body.reason, REPORT_REASONS);
    const commentId = body.comment_id === null || body.commentId === null
      ? null
      : typeof (body.comment_id ?? body.commentId) === "string"
        ? String(body.comment_id ?? body.commentId)
        : null;
    if (!isUuid(postId) || !reasonCode || (commentId !== null && !isUuid(commentId))) {
      throw new CourtApiError(400, "COURT_REPORT_INVALID", "신고 대상과 사유를 확인해 주세요.");
    }
    const report = await createCourtPublicReportForUser({
      publicPostId: postId,
      commentId,
      userId: user.id,
      targetType: commentId ? "comment" : "post",
      reasonCode,
    });
    return noStoreJson({ report }, { status: 201 });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
