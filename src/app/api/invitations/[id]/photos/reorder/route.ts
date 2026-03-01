import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { photoIds } = await request.json();

  // 각 사진의 sort_order를 순서대로 업데이트
  const updates = (photoIds as string[]).map((photoId, index) =>
    supabase
      .from("invitation_photos")
      .update({ sort_order: index })
      .eq("id", photoId)
      .eq("invitation_id", id)
  );

  await Promise.all(updates);
  return NextResponse.json({ success: true });
}
