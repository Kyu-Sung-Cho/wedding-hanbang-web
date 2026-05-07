import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * DELETE: 결혼식 사진 삭제 (오너만)
 * Storage 파일도 함께 정리.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; photoId: string }> }
) {
  try {
    const { slug, photoId } = await params;
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const service = getServiceClient();

    const { data: gb } = await service
      .from("guestbooks")
      .select("id, owner_id")
      .eq("slug", slug)
      .maybeSingle();

    if (!gb) {
      return NextResponse.json({ error: "방명록을 찾을 수 없습니다." }, { status: 404 });
    }
    if (gb.owner_id !== user.id) {
      return NextResponse.json(
        { error: "본인 방명록만 사진을 삭제할 수 있습니다." },
        { status: 403 }
      );
    }

    const { data: photo } = await service
      .from("guestbook_photos")
      .select("id, url, guestbook_id")
      .eq("id", photoId)
      .maybeSingle();

    if (!photo || photo.guestbook_id !== gb.id) {
      return NextResponse.json({ error: "사진을 찾을 수 없습니다." }, { status: 404 });
    }

    // Storage path 추출
    const storagePath = (() => {
      try {
        const u = new URL(photo.url);
        const idx = u.pathname.indexOf("/guestbook-uploads/");
        if (idx === -1) return null;
        return u.pathname.slice(idx + "/guestbook-uploads/".length);
      } catch {
        return null;
      }
    })();

    const { error: deleteError } = await service
      .from("guestbook_photos")
      .delete()
      .eq("id", photoId);

    if (deleteError) {
      console.error("[guestbook photo delete] db error:", deleteError);
      return NextResponse.json(
        { error: "사진 삭제에 실패했습니다." },
        { status: 500 }
      );
    }

    // Storage cleanup (best effort, 실패해도 DB 삭제는 성공)
    if (storagePath) {
      void service.storage.from("guestbook-uploads").remove([storagePath]);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[guestbook photo DELETE] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
