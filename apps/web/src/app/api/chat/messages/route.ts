import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// 사용자가 해당 커플에 속하는지 검증
async function verifyCoupleOwnership(userId: string, coupleId: string): Promise<boolean> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile } = await admin
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .single();

  return profile?.couple_id === coupleId;
}

// 커플의 전체 채팅 메시지 삭제
export async function DELETE(request: Request) {
  try {
    const supabase = await createClientFromRequest(request);
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

    const { coupleId } = await request.json();

    if (!coupleId) {
      return NextResponse.json({ error: "coupleId가 필요합니다." }, { status: 400 });
    }

    // 해당 커플에 속하는지 검증
    const isOwner = await verifyCoupleOwnership(user!.id, coupleId);
    if (!isOwner) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { count } = await admin
      .from("chat_messages")
      .delete({ count: "exact" })
      .eq("couple_id", coupleId);

    return NextResponse.json({ success: true, deleted: count ?? 0 });
  } catch (err) {
    console.error("메시지 삭제 에러:", err);
    return NextResponse.json(
      { error: "메시지 삭제에 실패했습니다." },
      { status: 500 }
    );
  }
}
