import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const service = getServiceClient();

    const { data: guestbook, error } = await service
      .from("guestbooks")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !guestbook) {
      return NextResponse.json(
        { error: "방명록을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 조회수 증가 (비차단)
    void service
      .from("guestbooks")
      .update({ view_count: (guestbook.view_count ?? 0) + 1 })
      .eq("id", guestbook.id)
      .then(() => {}, () => {});

    const { data: messages } = await service
      .from("guestbook_messages")
      .select("*")
      .eq("guestbook_id", guestbook.id)
      .eq("is_approved", true)
      .order("created_at", { ascending: false })
      .limit(100);

    return NextResponse.json({ guestbook, messages: messages ?? [] });
  } catch (err) {
    console.error("Guestbook GET error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
