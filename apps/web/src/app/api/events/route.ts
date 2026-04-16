import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const { eventType, vendorId, productId, metadata, durationSeconds, sessionId } = body;

    if (!eventType) {
      return NextResponse.json({ error: "eventType은 필수입니다." }, { status: 400 });
    }

    const validTypes = [
      "vendor_view", "product_view", "search", "favorite_add", "favorite_remove",
      "booking_start", "booking_complete", "message_send", "comparison", "view_duration",
      "page_view", "click",
    ];
    if (!validTypes.includes(eventType)) {
      return NextResponse.json({ error: "유효하지 않은 이벤트 타입입니다." }, { status: 400 });
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
      event_type: eventType,
      vendor_id: vendorId || null,
      product_id: productId || null,
      metadata: metadata || {},
      duration_seconds: durationSeconds || null,
      session_id: sessionId || null,
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
