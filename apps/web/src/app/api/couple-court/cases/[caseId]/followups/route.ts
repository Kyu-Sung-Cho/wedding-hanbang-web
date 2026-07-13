import { assessCourtSafety } from "@/lib/coupleCourt/safety";
import { COURT_IMMEDIATE_SAFETY_MESSAGE } from "@/lib/coupleCourt/support";
import {
  createCourtFollowupForUser,
} from "@/lib/coupleCourt/repository";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { cleanOptionalEnum, isUuid } from "@/utils/requestValidation";
import {
  cleanCourtText,
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

const FOLLOWUP_OUTCOMES = ["resolved", "improved", "unchanged", "needs_more_talk"] as const;
const FOLLOWUP_SCORES: Record<(typeof FOLLOWUP_OUTCOMES)[number], number> = {
  resolved: 4,
  improved: 3,
  unchanged: 2,
  needs_more_talk: 1,
};

export async function POST(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:followup:create", request, user.id),
      { maxRequests: 10, windowMs: 24 * 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    const body = await readCourtJson(request, 12 * 1024);
    const { caseId } = await context.params;
    const outcome = cleanOptionalEnum(body.outcome, FOLLOWUP_OUTCOMES);
    const satisfaction = outcome ? FOLLOWUP_SCORES[outcome] : undefined;
    const remainingIssue = cleanCourtText(body.remaining_issue ?? body.remainingIssue, 1_000, "아직 남은 쟁점");
    const note = cleanCourtText(body.most_helpful_mission ?? body.mostHelpfulMission, 2_000, "가장 도움 된 처방");
    if (!isUuid(caseId) || satisfaction === undefined || !remainingIssue) {
      throw new CourtApiError(400, "COURT_FOLLOWUP_INVALID", "체크인 응답을 확인해 주세요.");
    }
    const safety = assessCourtSafety(`${remainingIssue}\n${note ?? ""}`);
    // Follow-up persistence and monotonic safety escalation are one
    // transaction. High-risk check-ins are retained for the viewer's safety
    // state without exposing or reviving an ordinary verdict.
    const followup = await createCourtFollowupForUser({
      caseId,
      userId: user.id,
      satisfaction,
      remainingIssue,
      note,
      safetyLevel: safety.level,
      safetyCategories: safety.categories,
    });
    const effectiveLevel = followup.safety_level === "high_risk"
      ? "high_risk"
      : followup.safety_level === "sensitive" ? "sensitive" : "normal";
    const effectiveCategories = Array.isArray(followup.safety_categories)
      ? followup.safety_categories.filter(
          (category): category is string => typeof category === "string",
        )
      : safety.categories;
    return noStoreJson({
      followup: effectiveLevel === "high_risk" ? null : followup,
      safety: {
        level: effectiveLevel,
        categories: effectiveCategories,
        resource_message: effectiveLevel === "high_risk"
          ? safety.resourceMessage ?? COURT_IMMEDIATE_SAFETY_MESSAGE
          : safety.resourceMessage ?? null,
      },
    }, { status: 201 });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
