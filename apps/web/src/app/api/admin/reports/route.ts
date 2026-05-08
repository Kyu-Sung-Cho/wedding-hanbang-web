import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";

/**
 * GET /api/admin/reports?status=pending|reviewed|resolved|dismissed|all
 * 관리자만 — 신고 목록 + 신고 대상 게시글/댓글/신고자 정보 hydrate.
 */
export async function GET(request: NextRequest) {
  try {
    const { authorized } = await verifyAdmin(request);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status") ?? "pending";

    const supabase = getServiceClient();

    let query = supabase
      .from("community_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data: reports, error } = await query;
    if (error) {
      console.error("[admin/reports] reports query error:", error);
      return NextResponse.json({ error: "신고 목록을 불러오지 못했습니다." }, { status: 500 });
    }

    const reportRows = (reports ?? []) as Array<{
      id: string;
      reporter_id: string;
      post_id: string | null;
      comment_id: string | null;
      reason: string;
      description: string | null;
      status: string;
      created_at: string;
    }>;

    // 관련 데이터 hydrate
    const postIds = [...new Set(reportRows.map((r) => r.post_id).filter(Boolean) as string[])];
    const commentIds = [...new Set(reportRows.map((r) => r.comment_id).filter(Boolean) as string[])];
    const reporterIds = [...new Set(reportRows.map((r) => r.reporter_id))];

    const [postsRes, commentsRes, reportersRes] = await Promise.all([
      postIds.length
        ? supabase
            .from("community_posts")
            .select("id, title, content, author_id, category, visibility, under_review")
            .in("id", postIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      commentIds.length
        ? supabase
            .from("community_comments")
            .select("id, content, author_id, post_id")
            .in("id", commentIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      reporterIds.length
        ? supabase
            .from("community_profiles")
            .select("user_id, nickname")
            .in("user_id", reporterIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);

    const postMap: Record<string, Record<string, unknown>> = {};
    (postsRes.data ?? []).forEach((p) => {
      postMap[p.id as string] = p;
    });
    const commentMap: Record<string, Record<string, unknown>> = {};
    (commentsRes.data ?? []).forEach((c) => {
      commentMap[c.id as string] = c;
    });
    const reporterMap: Record<string, string> = {};
    (reportersRes.data ?? []).forEach((u) => {
      reporterMap[u.user_id as string] = (u.nickname as string) ?? "익명";
    });

    const enriched = reportRows.map((r) => ({
      ...r,
      reporter_nickname: reporterMap[r.reporter_id] ?? "알 수 없음",
      post: r.post_id ? postMap[r.post_id] ?? null : null,
      comment: r.comment_id ? commentMap[r.comment_id] ?? null : null,
    }));

    // 카운트 by status (탭 뱃지용)
    const { data: countsRaw } = await supabase
      .from("community_reports")
      .select("status");
    const counts: Record<string, number> = { pending: 0, reviewed: 0, resolved: 0, dismissed: 0 };
    (countsRaw ?? []).forEach((row) => {
      const s = (row as { status: string }).status;
      if (s in counts) counts[s] += 1;
    });

    return NextResponse.json({ reports: enriched, counts });
  } catch (err) {
    console.error("[admin/reports] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
