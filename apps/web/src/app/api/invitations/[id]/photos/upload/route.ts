import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "파일 크기는 10MB 이하만 가능합니다" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "이미지 파일만 업로드 가능합니다" }, { status: 400 });
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const ext = file.name.split(".").pop() || "jpg";
    const fileName = `${id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await admin.storage
      .from("invitation-photos")
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: `업로드 실패: ${uploadError.message}` }, { status: 500 });
    }

    const { data: urlData } = admin.storage
      .from("invitation-photos")
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    const { data: existing } = await admin
      .from("invitation_photos")
      .select("sort_order")
      .eq("invitation_id", id)
      .order("sort_order", { ascending: false })
      .limit(1);

    const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const { data: photo, error: dbError } = await admin
      .from("invitation_photos")
      .insert({ invitation_id: id, url: publicUrl, sort_order: nextOrder })
      .select()
      .single();

    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
    return NextResponse.json({ photo }, { status: 201 });
  } catch (err) {
    console.error("[invitation photos upload POST]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
