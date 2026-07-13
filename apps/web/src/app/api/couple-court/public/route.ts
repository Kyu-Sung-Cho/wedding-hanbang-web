import { listCourtPublicFeed } from "@/lib/coupleCourt/repository";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { cleanIntegerInRange } from "@/utils/requestValidation";
import {
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
    const beforeValue = params.get("before");
    const before = beforeValue && !Number.isNaN(Date.parse(beforeValue))
      ? new Date(beforeValue).toISOString()
      : null;
    const posts = await listCourtPublicFeed({ limit, before });
    return noStoreJson({ posts, has_more: posts.length === limit });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
