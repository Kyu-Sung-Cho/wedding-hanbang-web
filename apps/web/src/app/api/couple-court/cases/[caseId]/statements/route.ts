import { assessCourtSafety } from "@/lib/coupleCourt/safety";
import { COURT_IMMEDIATE_SAFETY_MESSAGE } from "@/lib/coupleCourt/support";
import {
  submitCourtStatementForUser,
} from "@/lib/coupleCourt/repository";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isUuid } from "@/utils/requestValidation";
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

function requiredText(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string {
  const cleaned = cleanCourtText(value, maximum, label);
  if (!cleaned || cleaned.length < minimum) {
    throw new CourtApiError(
      400,
      "COURT_STATEMENT_INCOMPLETE",
      `${label}을(를) ${minimum}자 이상 적어 주세요.`,
    );
  }
  return cleaned;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:statement:submit", request, user.id),
      { maxRequests: 12, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    const body = await readCourtJson(request, 24 * 1024);

    const { caseId } = await context.params;
    const submissionRequestId = body.submission_request_id ?? body.submissionRequestId;
    if (!isUuid(caseId)) {
      throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
    }
    if (!isUuid(submissionRequestId)) {
      throw new CourtApiError(400, "COURT_STATEMENT_REQUEST_INVALID", "진술 제출 요청을 다시 시작해 주세요.");
    }

    const statement = {
      submissionRequestId,
      facts: requiredText(body.facts, "확인할 수 있는 사실", 20, 2_000),
      feelings: requiredText(body.feelings, "내가 느낀 감정", 5, 1_000),
      expectations: requiredText(body.expectations, "기대했던 점", 5, 1_000),
      attempts: cleanCourtText(body.attempts, 1_000, "이미 해 본 대화나 시도"),
      desiredAgreement: requiredText(
        body.desired_agreement ?? body.desiredAgreement,
        "원하는 합의",
        5,
        1_000,
      ),
      safetyLevel: "normal" as "normal" | "sensitive" | "high_risk",
      safetyCategories: [] as string[],
    };
    const detectedSafety = assessCourtSafety([
      statement.facts,
      statement.feelings,
      statement.expectations,
      statement.attempts ?? "",
      statement.desiredAgreement,
    ].join("\n"));
    const safety = body.safetyLevel === "high_risk"
      ? {
          level: "high_risk" as const,
          categories: detectedSafety.categories,
          resourceMessage: detectedSafety.resourceMessage
            ?? `안전 확인이 필요한 상황에서는 책임 비율이나 공개보다 안전이 먼저예요. ${COURT_IMMEDIATE_SAFETY_MESSAGE}`,
        }
      : detectedSafety;
    statement.safetyLevel = safety.level;
    statement.safetyCategories = safety.categories;

    // The statement and monotonic case-safety escalation commit in one RPC.
    // Neither write can be left behind if the other fails.
    const submitted = await submitCourtStatementForUser(caseId, user.id, statement);
    const recordedSafety = submitted.safety;
    const effectiveLevel = recordedSafety.safety_level === "high_risk"
      ? "high_risk"
      : recordedSafety.safety_level === "sensitive" ? "sensitive" : "normal";
    const effectiveCategories = Array.isArray(recordedSafety.safety_categories)
      ? recordedSafety.safety_categories.filter(
          (category): category is string => typeof category === "string",
        )
      : safety.categories;
    return noStoreJson({
      ...submitted.courtCase,
      verdict: submitted.courtCase.verdict ? { generation_status: "ready" } : null,
      missions: [],
      safety: {
        level: effectiveLevel,
        categories: effectiveCategories,
        requires_immediate_help: effectiveLevel === "high_risk",
        resource_message: effectiveLevel === "high_risk"
          ? safety.resourceMessage ?? COURT_IMMEDIATE_SAFETY_MESSAGE
          : null,
      },
    }, { status: 201 });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
