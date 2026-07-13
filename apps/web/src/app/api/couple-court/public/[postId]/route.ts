import {
  getCourtPublicPost,
  listCourtPublicComments,
} from "@/lib/coupleCourt/repository";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isUuid } from "@/utils/requestValidation";
import {
  CourtApiError,
  courtErrorResponse,
  noStoreJson,
  requireCoupleCourtPublicEnabled,
} from "../../_shared";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ postId: string }>;
}
export async function GET(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtPublicEnabled();
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:public:detail", request),
      { maxRequests: 180, windowMs: 60 * 60 * 1000 },
    );
    if (limited) return limited;
    const { postId } = await context.params;
    if (!isUuid(postId)) {
      throw new CourtApiError(404, "COURT_PUBLIC_NOT_FOUND", "공개 사건을 찾을 수 없어요.");
    }
    const post = await getCourtPublicPost(postId);
    if (!post) {
      throw new CourtApiError(404, "COURT_PUBLIC_NOT_FOUND", "공개 사건을 찾을 수 없어요.");
    }
    const comments = post.comments_enabled === true
      ? await listCourtPublicComments(postId, 80)
      : [];
    return noStoreJson({ post, comments });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
