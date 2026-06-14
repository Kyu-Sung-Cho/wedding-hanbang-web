import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  cleanIntegerInRange,
  cleanOptionalText,
  isBodyTooLarge,
  isRecord,
  isUuid,
  sanitizeJsonObject,
} from "@/utils/requestValidation";

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(req: Request) {
  try {
    if (isBodyTooLarge(req, MAX_BODY_BYTES)) {
      return NextResponse.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
    }

    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: true, skipped: "unauthenticated" });
    }

    const limited = checkRateLimit(rateLimitKey("events:write", req, user.id), {
      maxRequests: 120,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;

    const body = await req.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const { eventType, vendorId, productId, metadata, durationSeconds, sessionId } = body;

    const cleanEventType = cleanOptionalText(eventType, 40);
    if (!cleanEventType) {
      return NextResponse.json({ error: "eventType은 필수입니다." }, { status: 400 });
    }

    const validTypes = [
      "vendor_view", "product_view", "search", "favorite_add", "favorite_remove",
      "booking_start", "booking_complete", "message_send", "comparison", "view_duration",
      "page_view", "click",
    ];
    if (!validTypes.includes(cleanEventType)) {
      return NextResponse.json({ error: "유효하지 않은 이벤트 타입입니다." }, { status: 400 });
    }

    const cleanVendorId = vendorId == null || vendorId === "" ? null : vendorId;
    const cleanProductId = productId == null || productId === "" ? null : productId;
    if (cleanVendorId !== null && !isUuid(cleanVendorId)) {
      return NextResponse.json({ error: "vendorId가 올바르지 않습니다." }, { status: 400 });
    }
    if (cleanProductId !== null && !isUuid(cleanProductId)) {
      return NextResponse.json({ error: "productId가 올바르지 않습니다." }, { status: 400 });
    }

    // couple_id 조회
    const { data: profile } = await supabase
      .from("profiles")
      .select("couple_id")
      .eq("id", user.id)
      .single();

    const { error } = await supabase.from("customer_events").insert({
      user_id: user.id,
      couple_id: profile?.couple_id || null,
      event_type: cleanEventType,
      vendor_id: cleanVendorId,
      product_id: cleanProductId,
      metadata: sanitizeJsonObject(metadata, {
        maxDepth: 4,
        maxArrayLength: 20,
        maxObjectKeys: 50,
        maxStringLength: 300,
      }) ?? {},
      duration_seconds: cleanIntegerInRange(durationSeconds, 0, 24 * 60 * 60) ?? null,
      session_id: cleanOptionalText(sessionId, 128),
    });

    if (error) {
      console.error("Event insert error:", error);
      return NextResponse.json({ error: "이벤트 기록 실패" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Event API error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}
