import { redactCourtText } from "@/lib/coupleCourt/privacy";
import {
  createCourtPublicCommentForUser,
  listCourtPublicComments,
  replayCourtPublicCommentForUser,
} from "@/lib/coupleCourt/repository";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { cleanOptionalEnum, isUuid } from "@/utils/requestValidation";
import {
  cleanCourtText,
  CourtApiError,
  courtErrorResponse,
  encodeCourtCursor,
  noStoreJson,
  readCourtCursor,
  readCourtJson,
  requireCoupleCourtPublicEnabled,
  requireCourtUser,
} from "../../../_shared";

export const dynamic = "force-dynamic";

const COMMENT_TYPES = ["empathy", "experience", "practical_advice", "question"] as const;
const COMMENT_MODERATION_STATUSES = ["pending", "visible", "hidden", "rejected"] as const;

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
    const page = await listCourtPublicComments(
      postId,
      40,
      readCourtCursor(request, "comments"),
    );
    return noStoreJson({
      comments: page.items,
      nextCursor: page.nextCursor ? encodeCourtCursor("comments", page.nextCursor) : null,
    });
  } catch (error) {
    return courtErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtPublicEnabled();
    const user = await requireCourtUser(request);
    const body = await readCourtJson(request, 8 * 1024);
    const postId = await postIdFromContext(context);
    const snakeRequestId = body.submission_request_id;
    const camelRequestId = body.submissionRequestId;
    const conflictingRequestIds = snakeRequestId !== undefined
      && camelRequestId !== undefined
      && (!isUuid(snakeRequestId)
        || !isUuid(camelRequestId)
        || snakeRequestId.toLowerCase() !== camelRequestId.toLowerCase());
    const submissionRequestId = snakeRequestId ?? camelRequestId;
    if (conflictingRequestIds || !isUuid(submissionRequestId)) {
      throw new CourtApiError(
        400,
        "COURT_COMMENT_REQUEST_INVALID",
        "댓글 작성 요청을 다시 시작해 주세요.",
      );
    }
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
    const replay = await replayCourtPublicCommentForUser({
      publicPostId: postId,
      userId: user.id,
      submissionRequestId,
      commentType,
      body: privacy.text,
    });
    if (replay.found === true) {
      const replayCommentId = replay.comment_id;
      const replayModerationStatus = cleanOptionalEnum(
        replay.moderation_status,
        COMMENT_MODERATION_STATUSES,
      );
      if (
        !isUuid(replayCommentId)
        || !replayModerationStatus
        || replay.reused !== true
      ) {
        throw new CourtApiError(
          500,
          "COURT_COMMENT_RESULT_INVALID",
          "댓글 저장 결과를 확인하지 못했어요. 같은 내용으로 다시 시도해 주세요.",
        );
      }
      return noStoreJson({
        comment: {
          comment_id: replayCommentId,
          moderation_status: replayModerationStatus,
          reused: true,
        },
      });
    }
    if (replay.found !== false) {
      throw new CourtApiError(
        500,
        "COURT_COMMENT_RESULT_INVALID",
        "댓글 저장 여부를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:public:comment", request, user.id),
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    const comment = await createCourtPublicCommentForUser({
      publicPostId: postId,
      userId: user.id,
      submissionRequestId,
      commentType,
      body: privacy.text,
    });
    const commentId = comment.comment_id;
    const moderationStatus = cleanOptionalEnum(
      comment.moderation_status,
      COMMENT_MODERATION_STATUSES,
    );
    if (!isUuid(commentId) || !moderationStatus || typeof comment.reused !== "boolean") {
      throw new CourtApiError(
        500,
        "COURT_COMMENT_RESULT_INVALID",
        "댓글 저장 결과를 확인하지 못했어요. 같은 내용으로 다시 시도해 주세요.",
      );
    }
    const responseComment = {
      comment_id: commentId,
      moderation_status: moderationStatus,
      reused: comment.reused,
    };
    return noStoreJson(
      { comment: responseComment },
      { status: responseComment.reused ? 200 : 201 },
    );
  } catch (error) {
    return courtErrorResponse(error);
  }
}
