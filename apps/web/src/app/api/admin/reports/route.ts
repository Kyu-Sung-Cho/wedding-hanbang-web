import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin, getServiceClient } from "@/lib/utils/adminAuth";
import { monthToQuarter } from "@/utils/quarter";

function formatCohortRoomName(room: Record<string, unknown>) {
  const year = room.year as number | undefined;
  const month = room.month as number | undefined;
  const roomNumber = room.room_number as number | undefined;
  if (!year || !month) return (room.name as string | undefined) ?? "동기방";
  const suffix = roomNumber && roomNumber > 1 ? ` ${roomNumber}방` : "";
  return `${year}년 ${monthToQuarter(month)}분기 결혼 동기${suffix}`;
}

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

    let memberQuery = supabase
      .from("cohort_member_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (statusFilter !== "all") {
      memberQuery = memberQuery.eq("status", statusFilter);
    }

    const [{ data: reports, error }, { data: memberReports, error: memberError }] = await Promise.all([
      query,
      memberQuery,
    ]);
    if (error) {
      console.error("[admin/reports] reports query error:", error);
      return NextResponse.json({ error: "신고 목록을 불러오지 못했습니다." }, { status: 500 });
    }
    if (memberError && memberError.code !== "42P01") {
      console.error("[admin/reports] member reports query error:", memberError);
      return NextResponse.json({ error: "멤버 신고 목록을 불러오지 못했습니다." }, { status: 500 });
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
    const memberReportRows = (memberReports ?? []) as Array<{
      id: string;
      room_id: string;
      reporter_id: string;
      reported_user_id: string;
      reason: string;
      description: string | null;
      status: string;
      created_at: string;
    }>;

    // 관련 데이터 hydrate
    const postIds = [...new Set(reportRows.map((r) => r.post_id).filter(Boolean) as string[])];
    const commentIds = [...new Set(reportRows.map((r) => r.comment_id).filter(Boolean) as string[])];
    const reporterIds = [
      ...new Set([
        ...reportRows.map((r) => r.reporter_id),
        ...memberReportRows.map((r) => r.reporter_id),
        ...memberReportRows.map((r) => r.reported_user_id),
      ]),
    ];
    const roomIds = [...new Set(memberReportRows.map((r) => r.room_id))];

    const [postsRes, commentsRes, reportersRes, roomsRes] = await Promise.all([
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
            .select("user_id, nickname, avatar_url, rank, wedding_year, wedding_month, post_count, comment_count")
            .in("user_id", reporterIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      roomIds.length
        ? supabase
            .from("cohort_rooms")
            .select("id, name, year, month, room_number, member_count")
            .in("id", roomIds)
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
    const profileMap: Record<string, Record<string, unknown>> = {};
    (reportersRes.data ?? []).forEach((u) => {
      reporterMap[u.user_id as string] = (u.nickname as string) ?? "익명";
      profileMap[u.user_id as string] = u;
    });
    const roomMap: Record<string, Record<string, unknown>> = {};
    (roomsRes.data ?? []).forEach((room) => {
      roomMap[room.id as string] = {
        ...room,
        name: formatCohortRoomName(room),
      };
    });

    const contentReports = reportRows.map((r) => ({
      ...r,
      report_type: "content" as const,
      reporter_nickname: reporterMap[r.reporter_id] ?? "알 수 없음",
      post: r.post_id ? postMap[r.post_id] ?? null : null,
      comment: r.comment_id ? commentMap[r.comment_id] ?? null : null,
      target_user: null,
      room: null,
      report_count: null,
    }));

    const groupedMemberReportCounts = new Map<string, number>();
    memberReportRows.forEach((r) => {
      const key = `${r.room_id}:${r.reported_user_id}:${r.status}`;
      groupedMemberReportCounts.set(key, (groupedMemberReportCounts.get(key) ?? 0) + 1);
    });

    const memberReportsEnriched = memberReportRows.map((r) => ({
      id: `member:${r.id}`,
      reporter_id: r.reporter_id,
      reporter_nickname: reporterMap[r.reporter_id] ?? "알 수 없음",
      post_id: null,
      comment_id: null,
      reason: r.reason,
      description: r.description,
      status: r.status,
      created_at: r.created_at,
      report_type: "member" as const,
      post: null,
      comment: null,
      target_user: profileMap[r.reported_user_id] ?? {
        user_id: r.reported_user_id,
        nickname: "알 수 없음",
      },
      room: roomMap[r.room_id] ?? { id: r.room_id, name: "동기방" },
      report_count: groupedMemberReportCounts.get(`${r.room_id}:${r.reported_user_id}:${r.status}`) ?? 1,
    }));

    const enriched = [...contentReports, ...memberReportsEnriched].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // 카운트 by status (탭 뱃지용)
    const [{ data: countsRaw }, { data: memberCountsRaw }] = await Promise.all([
      supabase.from("community_reports").select("status"),
      supabase.from("cohort_member_reports").select("status"),
    ]);
    const counts: Record<string, number> = { pending: 0, reviewed: 0, resolved: 0, dismissed: 0 };
    [...(countsRaw ?? []), ...(memberCountsRaw ?? [])].forEach((row) => {
      const s = (row as { status: string }).status;
      if (s in counts) counts[s] += 1;
    });

    return NextResponse.json({ reports: enriched, counts });
  } catch (err) {
    console.error("[admin/reports] unexpected:", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
