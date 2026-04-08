"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useInvitationStore } from "@/stores/invitationStore";
import { ArrowLeft, Eye, Users, UserCheck, UserX, MessageSquare, TrendingUp } from "lucide-react";

export default function InvitationStatsPage() {
  const { id } = useParams<{ id: string }>();
  const { current, currentLoading, stats, rsvpList, guestbook, loadInvitation, loadStats, loadRsvp, loadGuestbook } =
    useInvitationStore();

  useEffect(() => {
    if (id) {
      loadInvitation(id);
      loadStats(id);
      loadRsvp(id);
      loadGuestbook(id);
    }
  }, [id, loadInvitation, loadStats, loadRsvp, loadGuestbook]);

  if (currentLoading || !current || !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[700px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/invitations"
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-ivory-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-noir-800" />
        </Link>
        <div>
          <h1 className="text-[20px] font-semibold text-noir-800">{current.title}</h1>
          <p className="text-[13px] text-taupe-500">청첩장 통계</p>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
        {[
          { icon: Eye, label: "총 조회수", value: stats.totalViews, color: "text-blue-500" },
          { icon: Users, label: "RSVP 응답", value: stats.totalRsvp, color: "text-rose-500" },
          { icon: UserCheck, label: "참석 예정", value: `${stats.attendingCount}명 (${stats.totalGuests}인)`, color: "text-green-500" },
          { icon: UserX, label: "불참", value: stats.notAttendingCount, color: "text-taupe-500" },
          { icon: MessageSquare, label: "방명록", value: stats.guestbookCount, color: "text-gold" },
          { icon: TrendingUp, label: "예상 하객", value: `${stats.totalGuests}명`, color: "text-purple-500" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl border border-black/[0.06] p-4">
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <div className="text-[18px] font-semibold text-noir-800">{stat.value}</div>
            <div className="text-[11px] text-taupe-500">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* 일별 조회수 차트 (간단한 바 차트) */}
      <div className="bg-white rounded-2xl border border-black/[0.06] p-5 mb-6">
        <h2 className="text-[15px] font-medium text-noir-800 mb-4">일별 조회수 (최근 30일)</h2>
        <div className="flex items-end gap-[2px] h-[80px]">
          {stats.dailyViews.map((d) => {
            const max = Math.max(...stats.dailyViews.map((v) => v.count), 1);
            const height = (d.count / max) * 100;
            return (
              <div
                key={d.date}
                className="flex-1 bg-rose-500/20 hover:bg-rose-500/40 rounded-t transition-colors group relative"
                style={{ height: `${Math.max(height, 2)}%` }}
                title={`${d.date}: ${d.count}회`}
              />
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-taupe-400">
          <span>{stats.dailyViews[0]?.date?.slice(5)}</span>
          <span>{stats.dailyViews[stats.dailyViews.length - 1]?.date?.slice(5)}</span>
        </div>
      </div>

      {/* RSVP 목록 */}
      <div className="bg-white rounded-2xl border border-black/[0.06] p-5 mb-6">
        <h2 className="text-[15px] font-medium text-noir-800 mb-4">참석 여부 응답 ({rsvpList.length}건)</h2>
        {rsvpList.length === 0 ? (
          <p className="text-[13px] text-taupe-500 text-center py-6">아직 응답이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rsvpList.map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl bg-ivory-50">
                <div className={`w-2 h-2 rounded-full ${r.attending ? "bg-green-500" : "bg-taupe-400"}`} />
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-noir-800">{r.guest_name}</span>
                  <span className="text-[11px] text-taupe-500 ml-2">
                    {r.attending ? `참석 (${r.guest_count}명)` : "불참"}
                  </span>
                </div>
                {r.side && (
                  <span className="text-[11px] text-taupe-400">
                    {r.side === "groom" ? "신랑측" : r.side === "bride" ? "신부측" : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 방명록 */}
      <div className="bg-white rounded-2xl border border-black/[0.06] p-5">
        <h2 className="text-[15px] font-medium text-noir-800 mb-4">방명록 ({guestbook.length}건)</h2>
        {guestbook.length === 0 ? (
          <p className="text-[13px] text-taupe-500 text-center py-6">아직 축하 메시지가 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {guestbook.map((g) => (
              <div key={g.id} className="p-3 rounded-xl bg-ivory-50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-medium text-noir-800">{g.guest_name}</span>
                  <span className="text-[10px] text-taupe-400">
                    {new Date(g.created_at).toLocaleDateString("ko-KR")}
                  </span>
                </div>
                <p className="text-[13px] text-charcoal leading-relaxed">{g.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
