import { createClientFromRequest } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { recordDecision } from "@/lib/memory/record-decision";
import { hasSignedDemoSessionFromCookieHeader } from "@/lib/demoSession";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";

const MAX_BODY_BYTES = 4 * 1024;
const MUTATION_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site",
};

function withPrivateNoStore(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(MUTATION_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function isSameOriginMutation(req: Request): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === new URL(req.url).origin;
    } catch {
      return false;
    }
  }

  return fetchSite === "same-origin";
}

async function readVendorId(req: Request): Promise<string | NextResponse> {
  if (isBodyTooLarge(req, MAX_BODY_BYTES)) {
    return NextResponse.json(
      { error: "요청 본문이 너무 큽니다." },
      { status: 413, headers: MUTATION_RESPONSE_HEADERS },
    );
  }

  const bodyResult = await readBoundedUtf8Text(req, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json(
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
    return NextResponse.json(
      { error: "유효한 vendorId가 필요합니다." },
      { status: 400, headers: MUTATION_RESPONSE_HEADERS },
    );
  }
  return body.vendorId;
}

// Canonical official-price wishlist addition. POST sets the desired state to
// present; DELETE below sets it to absent. Both operations are retry-safe.
export async function POST(req: Request) {
  if (!isSameOriginMutation(req)) {
    return NextResponse.json(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: MUTATION_RESPONSE_HEADERS },
    );
  }

  try {
    if (isBodyTooLarge(req, MAX_BODY_BYTES)) {
      return NextResponse.json(
        { error: "요청 본문이 너무 큽니다." },
        { status: 413, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      if (hasSignedDemoSessionFromCookieHeader(req.headers.get("cookie"))) {
        return NextResponse.json(
          { isFavorite: false },
          { headers: MUTATION_RESPONSE_HEADERS },
        );
      }
      return NextResponse.json(
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

    const { data: vendorForFavorite } = await createAdminClient()
      .from("vendors")
      .select("id, name, category")
      .eq("id", vendorId)
      .eq("status", "approved")
      .maybeSingle();
    if (!vendorForFavorite) {
      return NextResponse.json(
        { error: "업체를 찾을 수 없습니다." },
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
      return NextResponse.json(
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
          title: `찜: ${vendorForFavorite.name}`,
          chosenValue: {
            vendor_id: vendorForFavorite.id,
            vendor_name: vendorForFavorite.name,
            vendor_category: vendorForFavorite.category,
          },
          decisionType: "considering",
          source: "manual",
          sourceRefId: vendorForFavorite.id,
          metadata: { hook: "favorites" },
          dedupeKey: {
            sourceRefId: vendorForFavorite.id,
            source: "manual",
            decisionType: "considering",
          },
        });
      } catch (err) {
        console.error("[favorites recordDecision] 실패 (무시):", err);
      }
    })();

    return NextResponse.json(
      { isFavorite: true },
      { headers: MUTATION_RESPONSE_HEADERS },
    );
  } catch (err) {
    console.error("Favorite add error:", err);
    return NextResponse.json(
      { error: "서버 오류" },
      { status: 500, headers: MUTATION_RESPONSE_HEADERS },
    );
  }
}

// Canonical official-price wishlist removal. This endpoint sets the desired
// state and is safe to repeat concurrently with another removal.
export async function DELETE(req: Request) {
  if (!isSameOriginMutation(req)) {
    return NextResponse.json(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: MUTATION_RESPONSE_HEADERS },
    );
  }

  try {
    if (isBodyTooLarge(req, MAX_BODY_BYTES)) {
      return NextResponse.json(
        { error: "요청 본문이 너무 큽니다." },
        { status: 413, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      if (hasSignedDemoSessionFromCookieHeader(req.headers.get("cookie"))) {
        return NextResponse.json(
          { isFavorite: false },
          { headers: MUTATION_RESPONSE_HEADERS },
        );
      }
      return NextResponse.json(
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
      return NextResponse.json(
        { error: "즐겨찾기를 해제하지 못했습니다." },
        { status: 500, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    return NextResponse.json(
      { isFavorite: false },
      { headers: MUTATION_RESPONSE_HEADERS },
    );
  } catch (err) {
    console.error("Favorite remove error:", err);
    return NextResponse.json(
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
        return NextResponse.json(
          { vendorIds: [], favorites: [] },
          { headers: MUTATION_RESPONSE_HEADERS },
        );
      }
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    const { data: favorites, error } = await supabase
      .from("vendor_favorites")
      .select("vendor_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: "즐겨찾기 목록을 불러오지 못했습니다." },
        { status: 503, headers: MUTATION_RESPONSE_HEADERS },
      );
    }

    const vendorIds = (favorites ?? []).map(f => f.vendor_id);

    return NextResponse.json(
      { vendorIds, favorites: favorites ?? [] },
      { headers: MUTATION_RESPONSE_HEADERS },
    );
  } catch (err) {
    console.error("Favorites list error:", err);
    return NextResponse.json(
      { error: "서버 오류" },
      { status: 500, headers: MUTATION_RESPONSE_HEADERS },
    );
  }
}
