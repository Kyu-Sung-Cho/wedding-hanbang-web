import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// 특정 roomId의 메시지 일괄 삭제
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const cookieHeader = request.headers.get("cookie") || "";
    const isDemo = cookieHeader.includes("demo_mode=true");

    if (!user && !isDemo) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    if (isDemo) {
      return NextResponse.json({ success: true, deleted: 0 });
    }

    const { coupleId, roomId } = await request.json();

    if (!coupleId) {
      return NextResponse.json({ error: "coupleId가 필요합니다." }, { status: 400 });
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // roomId 기준 삭제
    if (roomId && roomId !== "default") {
      // metadata.roomId가 일치하는 메시지 삭제
      const { data: messages } = await admin
        .from("chat_messages")
        .select("id, metadata")
        .eq("couple_id", coupleId);

      const idsToDelete = (messages ?? [])
        .filter((m) => {
          const meta = m.metadata as { roomId?: string } | null;
          return meta?.roomId === roomId;
        })
        .map((m) => m.id);

      if (idsToDelete.length > 0) {
        await admin
          .from("chat_messages")
          .delete()
          .in("id", idsToDelete);
      }

      return NextResponse.json({ success: true, deleted: idsToDelete.length });
    } else {
      // default room: metadata에 roomId가 없거나 "default"인 메시지
      const { data: messages } = await admin
        .from("chat_messages")
        .select("id, metadata")
        .eq("couple_id", coupleId);

      const idsToDelete = (messages ?? [])
        .filter((m) => {
          const meta = m.metadata as { roomId?: string } | null;
          return !meta?.roomId || meta.roomId === "default";
        })
        .map((m) => m.id);

      if (idsToDelete.length > 0) {
        await admin
          .from("chat_messages")
          .delete()
          .in("id", idsToDelete);
      }

      return NextResponse.json({ success: true, deleted: idsToDelete.length });
    }
  } catch (err) {
    console.error("메시지 삭제 에러:", err);
    return NextResponse.json(
      { error: "메시지 삭제에 실패했습니다." },
      { status: 500 }
    );
  }
}
