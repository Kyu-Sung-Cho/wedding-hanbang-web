import {
  buildPublicCourtSnapshot,
  hashPublicCourtSnapshot,
} from "@/lib/coupleCourt/privacy";
import {
  getCourtCaseForUser,
  getCourtParticipantNamesForPrivacy,
  prepareCourtPublicSnapshotForUser,
} from "@/lib/coupleCourt/repository";
import { validateCourtVerdict } from "@/lib/coupleCourt/schema";
import { isCourtCategory, isCourtMode, isCourtTone } from "@/lib/coupleCourt/types";
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
      rateLimitKey("couple-court:public:preview", request, user.id),
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
    const mode = current.case.mode;
    const category = current.case.category;
    const tone = current.case.tone;
    if (!isCourtMode(mode) || !isCourtCategory(category) || !isCourtTone(tone)) {
      throw new CourtApiError(409, "COURT_CASE_INVALID", "사건 분류를 확인하지 못했어요.");
    }
    if (current.case.safety_level !== "normal") {
      throw new CourtApiError(
        409,
        "COURT_PUBLIC_SNAPSHOT_BLOCKED",
        "안전 또는 개인정보 기준 때문에 공개 미리보기를 만들 수 없어요.",
      );
    }
    const resultJson = current.verdict?.result_json;
    const verdict = validateCourtVerdict(resultJson, { mode, category, tone });
    const knownEntities = await getCourtParticipantNamesForPrivacy(caseId, user.id);
    const snapshot = buildPublicCourtSnapshot({ mode, category, tone, verdict, knownEntities });
    if (!snapshot) {
      throw new CourtApiError(
        409,
        "COURT_PUBLIC_SNAPSHOT_BLOCKED",
        "안전 또는 개인정보 기준 때문에 공개 미리보기를 만들 수 없어요.",
      );
    }
    const snapshotHash = hashPublicCourtSnapshot(snapshot);
    const existingStatus = typeof current.publicPost?.status === "string"
      ? current.publicPost.status
      : null;
    const existingHash = typeof current.publicPost?.snapshot_hash === "string"
      ? current.publicPost.snapshot_hash
      : null;
    const existingVersion = Number(current.publicPost?.snapshot_version);
    // A couple must consent to one immutable snapshot. Returning the active
    // identical snapshot is intentionally idempotent: a partner opening the
    // preview cannot silently create v+1 and invalidate the first consent.
    if (
      existingHash === snapshotHash
      && Number.isInteger(existingVersion)
      && existingVersion > 0
      && existingStatus !== null
      && ["awaiting_consents", "pending_review", "published"].includes(existingStatus)
    ) {
      return noStoreJson({
        public_post: current.publicPost,
        snapshot,
        snapshot_hash: snapshotHash,
        snapshot_version: existingVersion,
      });
    }
    const previousVersion = Number(current.publicPost?.snapshot_version ?? 0);
    const snapshotVersion = Number.isInteger(previousVersion) && previousVersion >= 0
      ? previousVersion + 1
      : 1;
    const publicPost = await prepareCourtPublicSnapshotForUser({
      caseId,
      userId: user.id,
      snapshot: snapshot as unknown as Record<string, unknown>,
      snapshotHash,
      snapshotVersion,
    });
    return noStoreJson({
      public_post: publicPost,
      snapshot,
      snapshot_hash: snapshotHash,
      snapshot_version: snapshotVersion,
    }, { status: 201 });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
