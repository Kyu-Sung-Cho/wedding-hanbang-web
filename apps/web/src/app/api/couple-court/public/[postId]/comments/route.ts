import { redactCourtText } from "@/lib/coupleCourt/privacy";
import {
  createCourtPublicCommentForUser,
  listCourtPublicComments,
} from "@/lib/coupleCourt/repository";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { cleanOptionalEnum, isUuid } from "@/utils/requestValidation";
import {
  cleanCourtText,
  CourtApiError,
  courtErrorResponse,
  noStoreJson,
  readCourtJson,
  requireCoupleCourtPublicEnabled,
  requireCourtUser,
} from "../../../_shared";

export const dynamic = "force-dynamic";

const COMMENT_TYPES = ["empathy", "experience", "practical_advice", "question"] as const;

interface RouteContext {
  params: Promise<{ postId: string }>;
}

async function postIdFromContext(context: RouteContext): Promise<string> {
  const { postId } = await context.params;
  if (!isUuid(postId)) {
    throw new CourtApiError(404, "COURT_PUBLIC_NOT_FOUND", "공개 사건을 찾을 수 없어요.");
  }
  return postId;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtPublicEnabled();
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:public:comments:list", request),
      { maxRequests: 180, windowMs: 60 * 60 * 1000 },
    );
    if (limited) return limited;
    const postId = await postIdFromContext(context);
    return noStoreJson({ comments: await listCourtPublicComments(postId, 80) });
  } catch (error) {
    return courtErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtPublicEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:public:comment", request, user.id),
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    const body = await readCourtJson(request, 8 * 1024);
    const postId = await postIdFromContext(context);
    const commentType = cleanOptionalEnum(body.comment_type ?? body.commentType, COMMENT_TYPES);
    const rawBody = cleanCourtText(body.body, 500, "댓글");
    if (!commentType || !rawBody || rawBody.length < 2) {
      throw new CourtApiError(400, "COURT_COMMENT_INVALID", "댓글 종류와 내용을 확인해 주세요.");
    }
    const privacy = redactCourtText(rawBody);
    if (privacy.blocked) {
      throw new CourtApiError(
        400,
        "COURT_COMMENT_PII_BLOCKED",
        "연락처, 주소, 계정 등 개인을 알아볼 수 있는 정보는 댓글에 적을 수 없어요.",
      );
    }
    const comment = await createCourtPublicCommentForUser({
      publicPostId: postId,
      userId: user.id,
      commentType,
      body: privacy.text,
    });
    return noStoreJson({ comment }, { status: 201 });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
