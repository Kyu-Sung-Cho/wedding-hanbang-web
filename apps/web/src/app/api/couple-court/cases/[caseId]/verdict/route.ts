import {
  getCourtCaseForUser,
  getCourtVerdictRecoveryDelaySeconds,
} from "@/lib/coupleCourt/repository";
import { buildCourtSafeShareCard } from "@/lib/coupleCourt/privacy";
import { COURT_IMMEDIATE_SAFETY_MESSAGE } from "@/lib/coupleCourt/support";
import {
  isCourtCategory,
  isCourtMode,
  isCourtVerdictStatus,
} from "@/lib/coupleCourt/types";
import { isUuid } from "@/utils/requestValidation";
import {
  CourtApiError,
  courtErrorResponse,
  noStoreJson,
  requireCoupleCourtEnabled,
  requireCourtUser,
} from "../../../_shared";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const { caseId } = await context.params;
    if (!isUuid(caseId)) {
      throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
    }
    const current = await getCourtCaseForUser(caseId, user.id);
    if (current.case.safety_level === "high_risk") {
      return noStoreJson({
        status: "safety_redirect",
        verdict: null,
        safety: {
          level: "high_risk",
          message: `합의나 판결보다 안전이 먼저예요. ${COURT_IMMEDIATE_SAFETY_MESSAGE}`,
        },
      }, { status: 409 });
    }
    if (!current.verdict) {
      const judging = current.case.workflow_status === "judging";
      if (!judging) {
        return noStoreJson({
          code: "COURT_VERDICT_NOT_READY",
          error: "필요한 진술이 모두 제출된 뒤 판결을 요청해 주세요.",
          status: "not_ready",
          verdict: null,
        }, { status: 409 });
      }
      const retryAfterSeconds = judging
        ? await getCourtVerdictRecoveryDelaySeconds(caseId, user.id)
        : 5;
      return noStoreJson({
        status: judging ? "judging" : "not_ready",
        verdict: null,
        retry_after_seconds: retryAfterSeconds,
      }, {
        status: 202,
        headers: { "Retry-After": String(retryAfterSeconds) },
      });
    }
    const result = current.verdict.result_json;
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new CourtApiError(500, "COURT_VERDICT_INVALID", "판결 결과를 안전하게 불러오지 못했어요.");
    }
    const resultRecord = result as Record<string, unknown>;
    const caseMeta = resultRecord.caseMeta;
    const verdictBlock = resultRecord.verdict;
    const category = current.case.category;
    const mode = current.case.mode;
    const provisional = Boolean(
      caseMeta && typeof caseMeta === "object" && !Array.isArray(caseMeta)
        ? (caseMeta as Record<string, unknown>).provisional
        : false,
    );
    const verdictStatus = verdictBlock
      && typeof verdictBlock === "object"
      && !Array.isArray(verdictBlock)
      ? (verdictBlock as Record<string, unknown>).status
      : null;
    const safeShareCard = current.case.safety_level === "normal"
      && isCourtCategory(category)
      && isCourtMode(mode)
      && isCourtVerdictStatus(verdictStatus)
      ? buildCourtSafeShareCard({ category, mode, provisional, verdictStatus })
      : undefined;
    // Never return provider-authored public copy to a client-side export path.
    const privateVerdict = { ...resultRecord };
    delete privateVerdict.publicCard;
    delete privateVerdict.public_card;
    const storedSafety = resultRecord.safety
      && typeof resultRecord.safety === "object"
      && !Array.isArray(resultRecord.safety)
      ? resultRecord.safety as Record<string, unknown>
      : {};
    const storedVerdictBlock = verdictBlock
      && typeof verdictBlock === "object"
      && !Array.isArray(verdictBlock)
      ? verdictBlock as Record<string, unknown>
      : {};
    const sensitive = current.case.safety_level === "sensitive";
    const effectiveSafety = sensitive
      ? {
          ...storedSafety,
          level: "sensitive",
          riskTypes: [],
          disablePlayfulVerdict: true,
          publicEligible: false,
          supportMessage: "서로 안전하다고 느끼는 환경에서 대화를 이어가 주세요.",
        }
      : storedSafety;
    const effectiveVerdictBlock = sensitive
      ? { ...storedVerdictBlock, judgeOneLiner: null }
      : storedVerdictBlock;
    return noStoreJson({
      status: "ready",
      verdict: {
        ...privateVerdict,
        safety: effectiveSafety,
        verdict: effectiveVerdictBlock,
        publicCard: safeShareCard,
        id: current.verdict.id,
        case_id: caseId,
        created_at: current.verdict.completed_at ?? current.verdict.created_at,
        missions: current.missions,
      },
    });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
