"use client";

import { useEffect, useState } from "react";

interface Registration {
  id: string;
  email: string;
  source: string;
  created_at: string;
}

interface DailyCount {
  date: string;
  count: number;
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [dailyCounts, setDailyCounts] = useState<DailyCount[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/admin/registrations", {
        headers: { "x-admin-password": password },
      });
      if (res.ok) {
        setAuthenticated(true);
        const data = await res.json();
        setRegistrations(data.registrations);
        setTotalCount(data.total);
        setDailyCounts(data.dailyCounts);
      } else {
        alert("비밀번호가 틀렸습니다.");
      }
    } catch {
      alert("서버 오류가 발생했습니다.");
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!authenticated) return;
    // 인증 후 자동 새로고침은 생략
  }, [authenticated]);

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-ivory-50 flex items-center justify-center px-5">
        <form onSubmit={handleLogin} className="bg-white rounded-3xl p-10 shadow-[0_8px_32px_rgba(0,0,0,0.06)] max-w-sm w-full">
          <div className="text-center mb-8">
            <div className="w-12 h-12 bg-gradient-to-br from-rose-500 to-gold rounded-xl flex items-center justify-center text-white font-bold text-lg font-display mx-auto mb-4">
              한
            </div>
            <h1 className="font-serif-kr text-xl font-normal">관리자 로그인</h1>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="관리자 비밀번호"
            className="w-full px-5 py-3.5 border border-platinum rounded-xl text-sm outline-none focus:border-rose-500 transition-colors mb-4"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-noir-800 text-white rounded-xl text-sm font-medium hover:bg-noir-soft transition-colors"
          >
            {loading ? "확인 중..." : "로그인"}
          </button>
        </form>
      </div>
    );
  }

  const maxDailyCount = Math.max(...dailyCounts.map((d) => d.count), 1);

  return (
    <div className="min-h-screen bg-ivory-50 p-8 max-md:p-4">
      <div className="max-w-[1200px] mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="font-serif-kr text-2xl font-light">사전등록 관리</h1>
            <p className="text-sm text-taupe-500 mt-1">웨딩한방 사전등록 현황</p>
          </div>
          <button
            onClick={() => setAuthenticated(false)}
            className="px-4 py-2 text-sm text-taupe-500 border border-platinum rounded-lg hover:border-rose-500 hover:text-rose-500 transition-colors"
          >
            로그아웃
          </button>
        </div>

        {/* 통계 카드 */}
        <div className="grid grid-cols-3 gap-6 mb-10 max-md:grid-cols-1">
          <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
            <p className="text-sm text-taupe-500 mb-2">총 사전등록</p>
            <p className="font-display text-4xl font-light text-noir-800">{totalCount}</p>
          </div>
          <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
            <p className="text-sm text-taupe-500 mb-2">오늘 등록</p>
            <p className="font-display text-4xl font-light text-noir-800">
              {dailyCounts.length > 0 ? dailyCounts[dailyCounts.length - 1]?.count || 0 : 0}
            </p>
          </div>
          <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
            <p className="text-sm text-taupe-500 mb-2">최근 7일 평균</p>
            <p className="font-display text-4xl font-light text-noir-800">
              {dailyCounts.length > 0
                ? Math.round(
                    dailyCounts.slice(-7).reduce((sum, d) => sum + d.count, 0) /
                      Math.min(dailyCounts.length, 7)
                  )
                : 0}
            </p>
          </div>
        </div>

        {/* 날짜별 차트 */}
        <div className="bg-white rounded-2xl p-8 border border-black/[0.04] mb-10">
          <h2 className="font-serif-kr text-lg font-normal mb-6">날짜별 등록 현황</h2>
          <div className="flex items-end gap-2 h-[200px]">
            {dailyCounts.slice(-14).map((day) => (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-2">
                <span className="text-[11px] text-taupe-500 font-medium">{day.count}</span>
                <div
                  className="w-full bg-gradient-to-t from-rose-500 to-rose-light rounded-t-md transition-all duration-500"
                  style={{ height: `${(day.count / maxDailyCount) * 160}px`, minHeight: day.count > 0 ? "4px" : "0" }}
                />
                <span className="text-[10px] text-taupe-400 -rotate-45 origin-top-left whitespace-nowrap">
                  {day.date.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 등록자 목록 */}
        <div className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden">
          <div className="p-8 pb-4">
            <h2 className="font-serif-kr text-lg font-normal">등록자 목록</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-platinum">
                  <th className="px-8 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">#</th>
                  <th className="px-8 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">이메일</th>
                  <th className="px-8 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">소스</th>
                  <th className="px-8 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">등록일</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((reg, i) => (
                  <tr key={reg.id} className="border-b border-black/[0.02] hover:bg-ivory-warm/50 transition-colors">
                    <td className="px-8 py-4 text-sm text-taupe-500">{i + 1}</td>
                    <td className="px-8 py-4 text-sm text-noir-800 font-medium">{reg.email}</td>
                    <td className="px-8 py-4 text-sm text-taupe-500">{reg.source}</td>
                    <td className="px-8 py-4 text-sm text-taupe-500">
                      {new Date(reg.created_at).toLocaleDateString("ko-KR")}
                    </td>
                  </tr>
                ))}
                {registrations.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-8 py-12 text-center text-taupe-400 text-sm">
                      아직 등록된 사용자가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
