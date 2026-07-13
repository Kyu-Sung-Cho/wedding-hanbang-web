import { createHash, randomBytes } from "node:crypto";
import {
  cancelCourtInviteForUser,
  getCourtCaseForUser,
  issueCourtInviteForUser,
} from "@/lib/coupleCourt/repository";
import { weddingPath } from "@/lib/weddingPaths";
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
  params: Promise<{ caseId: string }>;
}

function inviteTokenHash(token: string): string {
  return createHash("sha256")
    .update(`weddinghanbang-court-invite-v1\0${token}`)
    .digest("hex");
}

export async function POST(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:invite:issue", request, user.id),
      { maxRequests: 8, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    await readCourtJson(request, 1024);

    const { caseId } = await context.params;
    if (!isUuid(caseId)) {
      throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
    }
    const current = await getCourtCaseForUser(caseId, user.id);
    const workflowStatus = typeof current.case.workflow_status === "string"
      ? current.case.workflow_status
      : "";
    const canPromoteSolo = current.case.mode === "solo"
      && ["verdict_ready", "mission_active", "resolved"].includes(workflowStatus);
    if (
      current.participant.role !== "applicant"
      || (current.case.mode !== "couple" && !canPromoteSolo)
    ) {
      throw new CourtApiError(403, "COURT_INVITE_NOT_ALLOWED", "이 사건에서는 상대를 초대할 수 없어요.");
    }
    if (current.case.safety_level === "high_risk") {
      throw new CourtApiError(
        409,
        "COURT_SAFETY_ACTION_BLOCKED",
        "안전을 먼저 확인해야 해서 지금은 상대를 초대할 수 없어요.",
      );
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    await issueCourtInviteForUser({
      caseId,
      userId: user.id,
      tokenHash: inviteTokenHash(token),
      expiresAt,
    });

    // The fragment is intentionally never sent to Vercel/Supabase/logging.
    const inviteUrl = `${weddingPath("/couple-court/invite")}#token=${encodeURIComponent(token)}`;
    return noStoreJson({ invite_url: inviteUrl, expires_at: expiresAt }, { status: 201 });
  } catch (error) {
    return courtErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:invite:cancel", request, user.id),
      { maxRequests: 12, windowMs: 60 * 60 * 1_000 },
      user.id,
    );
    if (limited) return limited;
    await readCourtJson(request, 1_024);
    const { caseId } = await context.params;
    if (!isUuid(caseId)) {
      throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
    }
    const result = await cancelCourtInviteForUser({ caseId, userId: user.id });
    return noStoreJson({ invite: result });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
