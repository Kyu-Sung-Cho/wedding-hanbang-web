import { listCourtPublicFeed } from "@/lib/coupleCourt/repository";
import { isCourtCategory } from "@/lib/coupleCourt/types";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { cleanIntegerInRange } from "@/utils/requestValidation";
import {
  CourtApiError,
  courtErrorResponse,
  noStoreJson,
  requireCoupleCourtPublicEnabled,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireCoupleCourtPublicEnabled();
    const limited = await checkRateLimitPersistent(
      rateLimitKey("couple-court:public:list", request),
      { maxRequests: 120, windowMs: 60 * 60 * 1000 },
    );
    if (limited) return limited;

    const params = new URL(request.url).searchParams;
    const limit = cleanIntegerInRange(params.get("limit"), 1, 30) ?? 12;
    const requestedPage = cleanIntegerInRange(params.get("page"), 1, 10_000) ?? 1;
    const categoryValue = params.get("category");
    const modeValue = params.get("mode");
    const sortValue = params.get("sort");
    if (categoryValue !== null && !isCourtCategory(categoryValue)) {
      throw new CourtApiError(400, "COURT_PUBLIC_FILTER_INVALID", "공개재판 주제 필터를 확인해 주세요.");
    }
    if (modeValue !== null && modeValue !== "solo" && modeValue !== "couple") {
      throw new CourtApiError(400, "COURT_PUBLIC_FILTER_INVALID", "공개재판 방식 필터를 확인해 주세요.");
    }
    if (sortValue !== null && sortValue !== "latest" && sortValue !== "popular") {
      throw new CourtApiError(400, "COURT_PUBLIC_FILTER_INVALID", "공개재판 정렬 방식을 확인해 주세요.");
    }

    const query = {
      limit,
      category: categoryValue,
      mode: modeValue as "solo" | "couple" | null,
      sort: sortValue === "popular" ? "popular" as const : "latest" as const,
    };
    let page = requestedPage;
    let result = await listCourtPublicFeed({
      ...query,
      offset: (page - 1) * limit,
    });
    const totalPages = Math.max(1, Math.ceil(result.total / limit));
    if (page > totalPages) {
      page = totalPages;
      result = await listCourtPublicFeed({
        ...query,
        offset: (page - 1) * limit,
      });
    }

    return noStoreJson({
      posts: result.posts,
      total: result.total,
      page,
      limit,
      total_pages: totalPages,
      has_more: page < totalPages,
    });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
