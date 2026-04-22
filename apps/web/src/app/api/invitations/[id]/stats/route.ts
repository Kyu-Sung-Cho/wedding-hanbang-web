import { createClientFromRequest } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClientFromRequest(_request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

    const [visitsRes, rsvpRes, guestbookRes, invitationRes] = await Promise.all([
      supabase.from("invitation_visits").select("visited_at").eq("invitation_id", id),
      supabase.from("invitation_rsvp").select("attending, guest_count").eq("invitation_id", id),
      supabase.from("invitation_guestbook").select("id").eq("invitation_id", id),
      supabase.from("invitations").select("view_count").eq("id", id).single(),
    ]);

    const visits = visitsRes.data ?? [];
    const rsvps = rsvpRes.data ?? [];
    const guestbookCount = guestbookRes.data?.length ?? 0;
    const totalViews = invitationRes.data?.view_count ?? visits.length;

    const attendingRsvps = rsvps.filter((r) => r.attending);
    const notAttendingRsvps = rsvps.filter((r) => !r.attending);
    const totalGuests = attendingRsvps.reduce((sum, r) => sum + (r.guest_count || 1), 0);

    const dailyMap = new Map<string, number>();
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dailyMap.set(d.toISOString().slice(0, 10), 0);
    }
    visits.forEach((v) => {
      const date = v.visited_at?.slice(0, 10);
      if (date && dailyMap.has(date)) {
        dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1);
      }
    });

    const dailyViews = Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count }));

    return NextResponse.json({
      stats: {
        totalViews,
        totalRsvp: rsvps.length,
        attendingCount: attendingRsvps.length,
        notAttendingCount: notAttendingRsvps.length,
        totalGuests,
        guestbookCount,
        dailyViews,
      },
    });
  } catch (err) {
    console.error("[invitation stats GET]", err);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
