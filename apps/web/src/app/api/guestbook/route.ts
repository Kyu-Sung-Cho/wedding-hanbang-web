import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 한글/영문 → slug
function toSlugPart(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9가-힣]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20) || "wedding"
  );
}

function randomId(len = 4): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await req.json();
    const {
      bride_name,
      groom_name,
      wedding_date,
      venue,
      our_story,
      proposal_story,
    } = body as {
      bride_name?: string;
      groom_name?: string;
      wedding_date?: string;
      venue?: string;
      our_story?: string;
      proposal_story?: string;
    };

    if (!bride_name?.trim() || !groom_name?.trim() || !wedding_date) {
      return NextResponse.json(
        { error: "신부/신랑 이름과 결혼 날짜는 필수입니다." },
        { status: 400 }
      );
    }

    const service = getServiceClient();

    // 유니크한 slug 생성 (최대 5회 재시도)
    let slug = "";
    for (let i = 0; i < 5; i++) {
      const candidate = `${toSlugPart(bride_name)}-${toSlugPart(groom_name)}-${randomId(4)}`;
      const { data: existing } = await service
        .from("guestbooks")
        .select("id")
        .eq("slug", candidate)
        .maybeSingle();
      if (!existing) {
        slug = candidate;
        break;
      }
    }
    if (!slug) {
      slug = `${toSlugPart(bride_name)}-${toSlugPart(groom_name)}-${randomId(8)}`;
    }

    const { data: guestbook, error } = await service
      .from("guestbooks")
      .insert({
        owner_id: user.id,
        slug,
        bride_name: bride_name.trim().slice(0, 60),
        groom_name: groom_name.trim().slice(0, 60),
        wedding_date,
        venue: venue?.trim().slice(0, 200) || null,
        our_story: our_story?.trim().slice(0, 5000) || null,
        proposal_story: proposal_story?.trim().slice(0, 5000) || null,
        is_active: true,
        message_count: 0,
        view_count: 0,
      })
      .select("id, slug")
      .single();

    if (error) {
      console.error("Create guestbook error:", error);
      return NextResponse.json(
        { error: "방명록 생성에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ slug: guestbook.slug, id: guestbook.id }, { status: 201 });
  } catch (err) {
    console.error("Guestbook POST error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const service = getServiceClient();
    const { data, error } = await service
      .from("guestbooks")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "불러올 수 없습니다." }, { status: 500 });
    }

    return NextResponse.json({ guestbooks: data ?? [] });
  } catch (err) {
    console.error("Guestbook list error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
