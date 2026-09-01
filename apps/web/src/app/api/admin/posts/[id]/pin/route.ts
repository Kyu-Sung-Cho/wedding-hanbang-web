import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { log } from "@/utils/log";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

/**
 * 운영자 큐레이션 핀 API.
 * is_pinned / is_weekly_best 렌더는 글 상세·피드에 이미 구현돼 있으나
 * 토글 수단이 없어 죽어 있던 기능 — 운영자 1인 큐레이션(주 5장)의 전제.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { authorized } = await verifyAdmin(req);
    if (!authorized) {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    const { id } = await params;
    const body = (await req.json()) as {
      is_pinned?: boolean;
      is_weekly_best?: boolean;
    };

    const updates: Record<string, boolean> = {};
    if (typeof body.is_pinned === "boolean") updates.is_pinned = body.is_pinned;
    if (typeof body.is_weekly_best === "boolean") updates.is_weekly_best = body.is_weekly_best;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "is_pinned 또는 is_weekly_best 중 하나는 필요합니다." },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();
    const { data: post, error } = await supabase
      .from("community_posts")
      .update(updates)
      .eq("id", id)
      .select("id, title, is_pinned, is_weekly_best")
      .single();

    if (error || !post) {
      return NextResponse.json({ error: "글을 찾을 수 없습니다." }, { status: 404 });
    }

    try {
      revalidatePath("/");
      revalidatePath("/community");
    } catch {
      // 캐시 갱신 실패는 비치명 — 다음 ISR 주기에 반영
    }

    return NextResponse.json({ post });
  } catch (err) {
    log.error("api/admin/posts/[id]/pin", err);
    console.error("Pin toggle error:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
