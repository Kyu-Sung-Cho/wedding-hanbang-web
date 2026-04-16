import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { messageRowToMessage } from "@/lib/utils/vendorMapper";

export async function GET(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const vendorId = searchParams.get("vendorId");
    const customerId = searchParams.get("customerId");

    if (!vendorId) {
      return NextResponse.json({ error: "vendorId는 필수입니다." }, { status: 400 });
    }

    let query = supabase
      .from("vendor_messages")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: true });

    if (customerId) {
      // customerId 지정 시 해당 vendor의 owner만 조회 가능
      const { data: vendorOwner } = await supabase
        .from("vendors")
        .select("id")
        .eq("id", vendorId)
        .eq("owner_id", user.id)
        .single();

      if (!vendorOwner) {
        return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
      }
      query = query.eq("customer_id", customerId);
    } else {
      query = query.eq("customer_id", user.id);
    }

    const { data: messageRows, error } = await query;

    if (error) {
      return NextResponse.json({ error: "메시지를 불러올 수 없습니다." }, { status: 500 });
    }

    // 읽음 처리
    const unreadIds = (messageRows ?? [])
      .filter((m) => !m.is_read && m.sender_type !== (customerId ? "vendor" : "customer"))
      .map((m) => m.id);

    if (unreadIds.length > 0) {
      await supabase
        .from("vendor_messages")
        .update({ is_read: true })
        .in("id", unreadIds);
    }

    const messages = (messageRows ?? []).map(messageRowToMessage);

    return NextResponse.json({ messages });
  } catch (err) {
    console.error("Messages GET error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClientFromRequest(req);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { vendorId, customerId, content, senderType } = await req.json();

    if (!vendorId || !content) {
      return NextResponse.json({ error: "vendorId와 content는 필수입니다." }, { status: 400 });
    }

    // senderType 결정: 서버에서 항상 vendor ownership으로 판단 (클라이언트 값 무시)
    const { data: vendorOwnership } = await supabase
      .from("vendors")
      .select("id")
      .eq("id", vendorId)
      .eq("owner_id", user.id)
      .single();

    const resolvedSenderType = vendorOwnership ? "vendor" : "customer";
    const resolvedCustomerId = vendorOwnership && customerId ? customerId : user.id;

    const { data: message, error } = await supabase
      .from("vendor_messages")
      .insert({
        vendor_id: vendorId,
        customer_id: resolvedCustomerId,
        sender_type: resolvedSenderType,
        content,
        is_read: false,
      })
      .select()
      .single();

    if (error) {
      console.error("Message send error:", error);
      return NextResponse.json({ error: "메시지 전송에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ message: messageRowToMessage(message) });
  } catch (err) {
    console.error("Message send error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
