import { NextResponse } from "next/server";

import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";

const MAX_BODY_BYTES = 4 * 1024;
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site",
};

function withPrivateNoStore(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function isSameOriginMutation(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  return fetchSite === "same-origin";
}

async function readVendorId(request: Request): Promise<string | NextResponse> {
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return NextResponse.json(
      { error: "요청 본문이 너무 큽니다." },
      { status: 413, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const bodyResult = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json(
      {
        error: bodyResult.reason === "too_large"
          ? "요청 본문이 너무 큽니다."
          : "요청을 읽을 수 없습니다.",
      },
      {
        status: bodyResult.reason === "too_large" ? 413 : 400,
        headers: PRIVATE_NO_STORE_HEADERS,
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
      { error: "업체 정보가 올바르지 않습니다." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return body.vendorId;
}

export async function GET(request: Request) {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "인증이 필요합니다." },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const { data, error } = await supabase
    .from("price_alerts")
    .select("vendor_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    return NextResponse.json(
      { error: "알림 목록을 불러오지 못했습니다." },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { vendorIds: (data ?? []).map(({ vendor_id }) => vendor_id) },
    { headers: PRIVATE_NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "인증이 필요합니다." },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const limited = checkRateLimit(rateLimitKey("price-alerts:add", request, user.id), {
    maxRequests: 30,
    windowMs: 60 * 1000,
  });
  if (limited) return withPrivateNoStore(limited);

  const parsedVendorId = await readVendorId(request);
  if (parsedVendorId instanceof NextResponse) return parsedVendorId;
  const vendorId = parsedVendorId;

  const { data: publicPrice, error: publicError } = await supabase
    .from("v_public_prices")
    .select("vendor_id")
    .eq("vendor_id", vendorId)
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();
  if (publicError || !publicPrice) {
    return NextResponse.json(
      { error: "현재 공개 가격이 있는 업체만 알림을 받을 수 있습니다." },
      { status: 404, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const { error } = await supabase.from("price_alerts").upsert(
    { user_id: user.id, vendor_id: vendorId },
    { ignoreDuplicates: true, onConflict: "user_id,vendor_id" },
  );
  if (error) {
    return NextResponse.json(
      { error: "알림 신청에 실패했습니다." },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { subscribed: true },
    { headers: PRIVATE_NO_STORE_HEADERS },
  );
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "인증이 필요합니다." },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const limited = checkRateLimit(rateLimitKey("price-alerts:remove", request, user.id), {
    maxRequests: 30,
    windowMs: 60 * 1000,
  });
  if (limited) return withPrivateNoStore(limited);

  const parsedVendorId = await readVendorId(request);
  if (parsedVendorId instanceof NextResponse) return parsedVendorId;
  const { error } = await supabase
    .from("price_alerts")
    .delete()
    .eq("user_id", user.id)
    .eq("vendor_id", parsedVendorId);
  if (error) {
    return NextResponse.json(
      { error: "알림 해제에 실패했습니다." },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { subscribed: false },
    { headers: PRIVATE_NO_STORE_HEADERS },
  );
}
