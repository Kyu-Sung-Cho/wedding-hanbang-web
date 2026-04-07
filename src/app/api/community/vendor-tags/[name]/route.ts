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
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name: rawName } = await params;
    const name = decodeURIComponent(rawName);
    const service = getServiceClient();

    const { data: tag } = await service
      .from("community_vendor_tags")
      .select("*")
      .eq("vendor_name", name)
      .maybeSingle();

    const { data: posts } = await service
      .from("community_posts")
      .select(
        "*, author:community_profiles!community_posts_author_id_fkey(*)"
      )
      .or(`title.ilike.%${name}%,content.ilike.%${name}%`)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(50);

    return NextResponse.json({ tag: tag ?? null, posts: posts ?? [] });
  } catch (err) {
    console.error("Vendor tag detail error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
