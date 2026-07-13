import {
  castCourtPublicVoteForUser,
  getCourtPublicPost,
} from "@/lib/coupleCourt/repository";
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

const VOTE_CHOICES = [
  "applicant_more_at_fault",
  "partner_more_at_fault",
  "both_need_change",
  "need_more_info",
] as const;

interface RouteContext {
  params: Promise<{ postId: string }>;
}
export async function POST(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtPublicEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:public:vote", request, user.id),
      { maxRequests: 80, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    const body = await readCourtJson(request, 2048);
    const { postId } = await context.params;
    const choice = cleanOptionalEnum(body.choice, VOTE_CHOICES);
    if (!isUuid(postId) || !choice) {
      throw new CourtApiError(400, "COURT_VOTE_INVALID", "공감 선택지를 확인해 주세요.");
    }
    const vote = await castCourtPublicVoteForUser({
      publicPostId: postId,
      userId: user.id,
      choice,
    });
    const post = await getCourtPublicPost(postId);
    return noStoreJson({ vote, post });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
