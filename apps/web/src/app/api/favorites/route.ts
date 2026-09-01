import { createClientFromRequest } from "@/lib/supabase/server";
import { log } from "@/utils/log";
import { NextRequest, NextResponse } from "next/server";
import { mobileBridgeJson } from "@/lib/mobile/boundedJsonResponse";
import { recordDecision } from "@/lib/memory/record-decision";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 4 * 1024;
const MAX_FAVORITES = 500;
const MUTATION_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

function withPrivateNoStore(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(MUTATION_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

async function readVendorId(req: Request): Promise<string | NextResponse> {
  if (isBodyTooLarge(req, MAX_BODY_BYTES)) {
    return mobileBridgeJson(
      { error: "요청 본문이 너무 큽니다." },
      { status: 413, headers: MUTATION_RESPONSE_HEADERS },
    );
  }

  const bodyResult = await readBoundedUtf8Text(req, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return mobileBridgeJson(
      {
        error: bodyResult.reason === "too_large"
          ? "요청 본문이 너무 큽니다."
          : "요청을 읽을 수 없습니다.",
      },
      {
        status: bodyResult.reason === "too_large" ? 413 : 400,
        headers: MUTATION_RESPONSE_HEADERS,
      },
    );
  }
  const rawBody = bodyResult.text;

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    body = null;
  }
  if (
    !isRecord(body)
    || Object.keys(body).length !== 1
    || !isUuid(body.vendorId)
  ) {
    return mobileBridgeJson(
      { error: "유효한 vendorId가 필요합니다." },
      { status: 400, headers: MUTATION_RESPONSE_HEADERS },
    );
  }
  return body.vendorId;
}

// Canonical official-price wishlist addition. POST sets the desired state to
// present; DELETE below sets it to absent. Both operations are retry-safe.
export async function POST(req: Request) {
  if (!isTrustedMutationRequest(req)) {
    return mobileBridgeJson(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: MUTATION_RESPONSE_HEADERS },
    );
  }

  try {
    if (isBodyTooLarge(req, MAX_BODY_BYTES)) {
      return mobileBridgeJson(
        { error: "요청 본문이 너무 큽니다." },
        { status: 413, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      if (hasSignedDemoSessionFromCookieHeader(req.headers.get("cookie"))) {
        return mobileBridgeJson(
          { isFavorite: false },
          { headers: MUTATION_RESPONSE_HEADERS },
        );
      }
      return mobileBridgeJson(
        { error: "인증이 필요합니다." },
        { status: 401, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    const limited = checkRateLimit(rateLimitKey("favorites:add", req, user.id), {
      maxRequests: 60,
      windowMs: 60 * 1000,
    });
    if (limited) return withPrivateNoStore(limited);

    const parsedVendorId = await readVendorId(req);
    if (parsedVendorId instanceof NextResponse) return parsedVendorId;
    const vendorId = parsedVendorId;

    const { data: vendorForFavorite, error: publicVendorError } = await supabase
      .from("v_public_prices")
      .select("vendor_id, vendor_name, category")
      .eq("vendor_id", vendorId)
      .eq("is_current", true)
      .order("official_price_id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (publicVendorError) {
      return mobileBridgeJson(
        { error: "공개 가격 정보를 확인하지 못했습니다." },
        { status: 503, headers: MUTATION_RESPONSE_HEADERS },
      );
    }
    if (!vendorForFavorite) {
      return mobileBridgeJson(
        { error: "현재 공개 가격이 있는 업체만 찜할 수 있습니다." },
        { status: 404, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    const { error } = await supabase
      .from("vendor_favorites")
      .upsert(
        { user_id: user.id, vendor_id: vendorId },
        { ignoreDuplicates: true, onConflict: "user_id,vendor_id" },
      );
    if (error) {
      return mobileBridgeJson(
        { error: "즐겨찾기에 실패했습니다." },
        { status: 500, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    // D2 Hook 1: decision_nodes에 '찜 = 고려 중' 기록 (fire-and-forget, dedupe)
    void (async () => {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("couple_id")
          .eq("id", user.id)
          .maybeSingle();
        const coupleId = (profile as { couple_id?: string } | null)?.couple_id;
        if (!coupleId) return;

        await recordDecision({
          coupleId,
          userId: user.id,
          category: vendorForFavorite.category ?? "vendor",
          title: `찜: ${vendorForFavorite.vendor_name}`,
          chosenValue: {
            vendor_id: vendorForFavorite.vendor_id,
            vendor_name: vendorForFavorite.vendor_name,
            vendor_category: vendorForFavorite.category,
          },
          decisionType: "considering",
          source: "manual",
          sourceRefId: vendorForFavorite.vendor_id,
          metadata: { hook: "favorites" },
          dedupeKey: {
            sourceRefId: vendorForFavorite.vendor_id,
            source: "manual",
            decisionType: "considering",
          },
        });
      } catch (err) {
        console.error("[favorites recordDecision] 실패 (무시):", err);
      }
    })();

    return mobileBridgeJson(
      { isFavorite: true },
      { headers: MUTATION_RESPONSE_HEADERS },
    );
  } catch (err) {
    log.error("api/favorites", err);
    console.error("Favorite add error:", err);
    return mobileBridgeJson(
      { error: "서버 오류" },
      { status: 500, headers: MUTATION_RESPONSE_HEADERS },
    );
  }
}

// Canonical official-price wishlist removal. This endpoint sets the desired
// state and is safe to repeat concurrently with another removal.
export async function DELETE(req: Request) {
  if (!isTrustedMutationRequest(req)) {
    return mobileBridgeJson(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: MUTATION_RESPONSE_HEADERS },
    );
  }

  try {
    if (isBodyTooLarge(req, MAX_BODY_BYTES)) {
      return mobileBridgeJson(
        { error: "요청 본문이 너무 큽니다." },
        { status: 413, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      if (hasSignedDemoSessionFromCookieHeader(req.headers.get("cookie"))) {
        return mobileBridgeJson(
          { isFavorite: false },
          { headers: MUTATION_RESPONSE_HEADERS },
        );
      }
      return mobileBridgeJson(
        { error: "인증이 필요합니다." },
        { status: 401, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    const limited = checkRateLimit(rateLimitKey("favorites:remove", req, user.id), {
      maxRequests: 60,
      windowMs: 60 * 1000,
    });
    if (limited) return withPrivateNoStore(limited);

    const parsedVendorId = await readVendorId(req);
    if (parsedVendorId instanceof NextResponse) return parsedVendorId;

    const { error } = await supabase
      .from("vendor_favorites")
      .delete()
      .eq("user_id", user.id)
      .eq("vendor_id", parsedVendorId);
    if (error) {
      return mobileBridgeJson(
        { error: "즐겨찾기를 해제하지 못했습니다." },
        { status: 500, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    return mobileBridgeJson(
      { isFavorite: false },
      { headers: MUTATION_RESPONSE_HEADERS },
    );
  } catch (err) {
    log.error("api/favorites", err);
    console.error("Favorite remove error:", err);
    return mobileBridgeJson(
      { error: "서버 오류" },
      { status: 500, headers: MUTATION_RESPONSE_HEADERS },
    );
  }
}

// 내 즐겨찾기 목록 조회
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      if (hasSignedDemoSessionFromCookieHeader(req.headers.get("cookie"))) {
        return mobileBridgeJson(
          { vendorIds: [] },
          { headers: MUTATION_RESPONSE_HEADERS },
        );
      }
      return mobileBridgeJson(
        { error: "인증이 필요합니다." },
        { status: 401, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    const { data: favorites, error } = await supabase
      .from("vendor_favorites")
      .select("vendor_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_FAVORITES + 1);

    if (error) {
      return mobileBridgeJson(
        { error: "즐겨찾기 목록을 불러오지 못했습니다." },
        { status: 503, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    if ((favorites ?? []).length > MAX_FAVORITES) {
      return mobileBridgeJson(
        {
          error: "찜 목록이 안전한 조회 한도를 초과했습니다. 고객센터에 문의해 주세요.",
          code: "FAVORITES_LIMIT_EXCEEDED",
        },
        { status: 409, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    const vendorIds = (favorites ?? []).map(f => f.vendor_id);

    return mobileBridgeJson(
      { vendorIds },
      { headers: MUTATION_RESPONSE_HEADERS },
    );
  } catch (err) {
    log.error("api/favorites", err);
    console.error("Favorites list error:", err);
    return mobileBridgeJson(
      { error: "서버 오류" },
      { status: 500, headers: MUTATION_RESPONSE_HEADERS },
    );
  }
}
