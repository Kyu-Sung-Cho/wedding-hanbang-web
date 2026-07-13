import {
  createCourtCaseForUser,
  listCourtCasesForUser,
} from "@/lib/coupleCourt/repository";
import { COURT_CATEGORY_CATALOG } from "@/lib/coupleCourt/catalog";
import { COURT_CATEGORIES } from "@/lib/coupleCourt/types";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { cleanOptionalEnum, isUuid } from "@/utils/requestValidation";
import {
  CourtApiError,
  courtErrorResponse,
  noStoreJson,
  readCourtJson,
  requireCoupleCourtEnabled,
  requireCourtUser,
} from "../_shared";

export const dynamic = "force-dynamic";

const MODES = ["solo", "couple"] as const;
const TONES = ["gentle", "practical", "spicy"] as const;

export async function GET(request: Request) {
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const cases = await listCourtCasesForUser(user.id);
    return noStoreJson({ cases });
  } catch (error) {
    return courtErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireCoupleCourtEnabled();
    const user = await requireCourtUser(request);
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:case:create", request, user.id),
      { maxRequests: 12, windowMs: 60 * 60 * 1000 },
      user.id,
    );
    if (limited) return limited;

    const body = await readCourtJson(request);
    const mode = cleanOptionalEnum(body.mode, MODES);
    const tone = cleanOptionalEnum(body.tone, TONES);
    const category = cleanOptionalEnum(body.category, COURT_CATEGORIES);
    const creationRequestId = body.creation_request_id ?? body.creationRequestId;
    if (!mode || !tone || !category || !isUuid(creationRequestId)) {
      throw new CourtApiError(
        400,
        "COURT_CASE_INVALID",
        "진행 방식, 주제와 말투를 확인해 주세요.",
      );
    }

    // This title is visible to an invited partner before they submit. Never
    // accept applicant-authored framing here: it would bypass blind statements
    // and could disclose names, threats, or sensitive case details.
    const categoryLabel = COURT_CATEGORY_CATALOG.find(
      (definition) => definition.id === category,
    )?.label;
    if (!categoryLabel) {
      throw new CourtApiError(400, "COURT_CASE_INVALID", "사건 주제를 확인해 주세요.");
    }
    const title = `${categoryLabel} 의견 차이 사건`;

    const courtCase = await createCourtCaseForUser(user.id, {
      creationRequestId,
      mode,
      tone,
      category,
      title,
    });
    return noStoreJson(courtCase, { status: 201 });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
