import {
  getCourtCaseForUser,
  setCourtPublicConsentForUser,
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
export async function POST(request: Request, context: RouteContext) {
  try {
    requireCoupleCourtPublicEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:public:consent", request, user.id),
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;
    const body = await readCourtJson(request, 4 * 1024);
    const { caseId } = await context.params;
    const publicPostId = typeof body.public_post_id === "string" ? body.public_post_id : "";
    const snapshotHash = typeof body.snapshot_hash === "string" ? body.snapshot_hash : "";
    if (
      !isUuid(caseId)
      || !isUuid(publicPostId)
      || !/^[a-f0-9]{64}$/.test(snapshotHash)
      || typeof body.consented !== "boolean"
    ) {
      throw new CourtApiError(400, "COURT_PUBLIC_CONSENT_INVALID", "공개 동의 대상을 확인해 주세요.");
    }
    const current = await getCourtCaseForUser(caseId, user.id);
    if (current.publicPost?.id !== publicPostId) {
      throw new CourtApiError(409, "COURT_PUBLIC_SNAPSHOT_CHANGED", "공개 미리보기가 바뀌었어요. 다시 확인해 주세요.");
    }
    const consent = await setCourtPublicConsentForUser({
      publicPostId,
      userId: user.id,
      snapshotHash,
      consented: body.consented,
    });
    return noStoreJson({ consent });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
