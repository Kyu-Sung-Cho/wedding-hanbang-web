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

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });

  // 파일 크기 제한 (10MB)
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "파일 크기는 10MB 이하만 가능합니다" }, { status: 400 });
  }

  // 이미지 타입 확인
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "이미지 파일만 업로드 가능합니다" }, { status: 400 });
  }

  // 고유 파일명 생성
  const ext = file.name.split(".").pop() || "jpg";
  const fileName = `${id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  // Supabase Storage에 업로드
  const { error: uploadError } = await supabase.storage
    .from("invitation-photos")
    .upload(fileName, file, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: `업로드 실패: ${uploadError.message}` }, { status: 500 });
  }

  // 공개 URL 가져오기
  const { data: urlData } = supabase.storage
    .from("invitation-photos")
    .getPublicUrl(fileName);

  const publicUrl = urlData.publicUrl;

  // DB에 사진 레코드 추가
  const { data: existing } = await supabase
    .from("invitation_photos")
    .select("sort_order")
    .eq("invitation_id", id)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { data: photo, error: dbError } = await supabase
    .from("invitation_photos")
    .insert({ invitation_id: id, url: publicUrl, sort_order: nextOrder })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ photo }, { status: 201 });
}
