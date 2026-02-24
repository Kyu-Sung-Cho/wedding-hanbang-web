import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    // 내가 업체 소유자인지 확인
    const { data: myVendor } = await supabase
      .from("vendors")
      .select("id, name")
      .eq("owner_id", user.id)
      .single();

    let threads: Array<{
      vendorId: string;
      customerId: string;
      vendorName: string;
      customerName: string;
      lastMessage: string;
      lastMessageAt: string;
      unreadCount: number;
    }> = [];

    if (myVendor) {
      // 업체 소유자: 내 업체에 온 모든 대화
      const { data: messages } = await supabase
        .from("vendor_messages")
        .select("*")
        .eq("vendor_id", myVendor.id)
        .order("created_at", { ascending: false });

      // 고객별로 그룹핑
      type Msg = NonNullable<typeof messages>[number];
      const customerMap = new Map<string, Msg[]>();
      for (const msg of messages ?? []) {
        if (!customerMap.has(msg.customer_id)) {
          customerMap.set(msg.customer_id, []);
        }
        customerMap.get(msg.customer_id)!.push(msg);
      }

      // 고객 이름 조회
      const customerIds = [...customerMap.keys()];
      const { data: profiles } = customerIds.length > 0
        ? await supabase.from("profiles").select("id, name").in("id", customerIds)
        : { data: [] };

      const profileMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.name]));

      for (const [customerId, msgs] of customerMap) {
        const last = msgs[0];
        const unread = msgs.filter((m) => !m.is_read && m.sender_type === "customer").length;

        threads.push({
          vendorId: myVendor.id,
          customerId,
          vendorName: myVendor.name,
          customerName: profileMap[customerId] ?? "고객",
          lastMessage: last.content,
          lastMessageAt: last.created_at,
          unreadCount: unread,
        });
      }
    } else {
      // 일반 고객: 내가 보낸/받은 모든 대화
      const { data: messages } = await supabase
        .from("vendor_messages")
        .select("*")
        .eq("customer_id", user.id)
        .order("created_at", { ascending: false });

      // 업체별로 그룹핑
      type Msg2 = NonNullable<typeof messages>[number];
      const vendorMap = new Map<string, Msg2[]>();
      for (const msg of messages ?? []) {
        if (!vendorMap.has(msg.vendor_id)) {
          vendorMap.set(msg.vendor_id, []);
        }
        vendorMap.get(msg.vendor_id)!.push(msg);
      }

      // 업체명 조회
      const vendorIds = [...vendorMap.keys()];
      const { data: vendors } = vendorIds.length > 0
        ? await supabase.from("vendors").select("id, name").in("id", vendorIds)
        : { data: [] };

      const vendorNameMap = Object.fromEntries((vendors ?? []).map((v) => [v.id, v.name]));

      for (const [vendorId, msgs] of vendorMap) {
        const last = msgs[0];
        const unread = msgs.filter((m) => !m.is_read && m.sender_type === "vendor").length;

        threads.push({
          vendorId,
          customerId: user.id,
          vendorName: vendorNameMap[vendorId] ?? "업체",
          customerName: "",
          lastMessage: last.content,
          lastMessageAt: last.created_at,
          unreadCount: unread,
        });
      }
    }

    // 최신 메시지 순 정렬
    threads.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

    return NextResponse.json({ threads, isVendor: !!myVendor });
  } catch (err) {
    console.error("Message threads error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
