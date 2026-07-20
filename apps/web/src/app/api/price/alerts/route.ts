import { NextResponse } from "next/server";

import { createClientFromRequest } from "@/lib/supabase/server";
import { mobileBridgeJson } from "@/lib/mobile/boundedJsonResponse";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  isBodyTooLarge,
  isRecord,
  isUuid,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MAX_BODY_BYTES = 4 * 1024;
const MAX_PRICE_ALERTS = 500;
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};

function withPrivateNoStore(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

async function readVendorId(request: Request): Promise<string | NextResponse> {
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return mobileBridgeJson(
      { error: "요청 본문이 너무 큽니다." },
      { status: 413, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const bodyResult = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return mobileBridgeJson(
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
    return mobileBridgeJson(
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
    return mobileBridgeJson(
      { error: "인증이 필요합니다." },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const { data, error } = await supabase
    .from("price_alerts")
    .select("vendor_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(MAX_PRICE_ALERTS + 1);
  if (error) {
    return mobileBridgeJson(
      { error: "알림 목록을 불러오지 못했습니다." },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  if ((data ?? []).length > MAX_PRICE_ALERTS) {
    return mobileBridgeJson(
      {
        error: "가격 알림 목록이 안전한 조회 한도를 초과했습니다. 고객센터에 문의해 주세요.",
        code: "PRICE_ALERTS_LIMIT_EXCEEDED",
      },
      { status: 409, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return mobileBridgeJson(
    { vendorIds: (data ?? []).map(({ vendor_id }) => vendor_id) },
    { headers: PRIVATE_NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return mobileBridgeJson(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return mobileBridgeJson(
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
    return mobileBridgeJson(
      { error: "현재 공개 가격이 있는 업체만 알림을 받을 수 있습니다." },
      { status: 404, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const { error } = await supabase.from("price_alerts").upsert(
    { user_id: user.id, vendor_id: vendorId },
    { ignoreDuplicates: true, onConflict: "user_id,vendor_id" },
  );
  if (error) {
    return mobileBridgeJson(
      { error: "알림 신청에 실패했습니다." },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return mobileBridgeJson(
    { subscribed: true },
    { headers: PRIVATE_NO_STORE_HEADERS },
  );
}

export async function DELETE(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return mobileBridgeJson(
      { error: "잘못된 요청 출처입니다." },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return mobileBridgeJson(
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
    return mobileBridgeJson(
      { error: "알림 해제에 실패했습니다." },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return mobileBridgeJson(
    { subscribed: false },
    { headers: PRIVATE_NO_STORE_HEADERS },
  );
}
