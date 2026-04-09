import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// 사진 좋아요 토글
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id: vendorId } = await params;
    const { photoUrl } = await req.json();
    if (!photoUrl) {
      return NextResponse.json({ error: "photoUrl이 필요합니다." }, { status: 400 });
    }

    // 이미 좋아요했는지 확인
    const { data: existing } = await supabase
      .from("vendor_photo_likes")
      .select("id")
      .eq("user_id", user.id)
      .eq("vendor_id", vendorId)
      .eq("photo_url", photoUrl)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("vendor_photo_likes")
        .delete()
        .eq("id", existing.id);
      return NextResponse.json({ liked: false });
    } else {
      await supabase
        .from("vendor_photo_likes")
        .insert({ user_id: user.id, vendor_id: vendorId, photo_url: photoUrl });
      return NextResponse.json({ liked: true });
    }
  } catch (err) {
    console.error("Photo like toggle error:", err);
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

// 내 좋아요 목록 조회 (특정 업체)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ likedPhotos: [] });
    }

    const { id: vendorId } = await params;

    const { data: likes } = await supabase
      .from("vendor_photo_likes")
      .select("photo_url")
      .eq("user_id", user.id)
      .eq("vendor_id", vendorId);

    const likedPhotos = (likes ?? []).map((l) => l.photo_url);
    return NextResponse.json({ likedPhotos });
  } catch (err) {
    console.error("Photo likes list error:", err);
    return NextResponse.json({ likedPhotos: [] });
  }
}
