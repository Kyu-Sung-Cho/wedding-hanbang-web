"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Registration {
  id: string;
  email: string;
  name: string | null;
  wedding_date: string | null;
  source: string;
  created_at: string;
}

export default function AdminPage() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    if (password === (process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "admin1234")) {
      setIsAuthed(true);
      loadData();
    }
  };

  const loadData = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, count } = await supabase
      .from("preregistrations")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });

    setRegistrations(data || []);
    setTotal(count || 0);
    setLoading(false);
  };

  useEffect(() => {
    if (isAuthed) loadData();
  }, [isAuthed]);

  if (!isAuthed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ivory-50">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
          <h1 className="mb-6 text-center font-serif text-2xl font-light text-noir-800">
            관리자 로그인
          </h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="비밀번호"
            className="mb-4 w-full rounded-xl border border-platinum bg-ivory-50 px-4 py-3 text-sm outline-none focus:border-rose-500"
          />
          <button
            onClick={handleLogin}
            className="w-full rounded-xl bg-noir-800 py-3 text-sm font-medium text-white transition-colors hover:bg-noir-soft"
          >
            로그인
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ivory-50 p-6 md:p-10">
      <div className="mx-auto max-w-[1200px]">
        <h1 className="mb-8 font-serif text-3xl font-light text-noir-800">
          사전등록 관리
        </h1>

        {/* 통계 */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="text-sm text-taupe-500">총 등록 수</div>
            <div className="mt-2 font-display text-4xl font-light text-noir-800">
              {total}
            </div>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="text-sm text-taupe-500">오늘 등록</div>
            <div className="mt-2 font-display text-4xl font-light text-noir-800">
              {
                registrations.filter(
                  (r) =>
                    new Date(r.created_at).toDateString() ===
                    new Date().toDateString()
                ).length
              }
            </div>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="text-sm text-taupe-500">이번 주 등록</div>
            <div className="mt-2 font-display text-4xl font-light text-noir-800">
              {
                registrations.filter((r) => {
                  const d = new Date(r.created_at);
                  const now = new Date();
                  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                  return d >= weekAgo;
                }).length
              }
            </div>
          </div>
        </div>

        {/* 등록자 목록 */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="border-b border-platinum px-6 py-4">
            <h2 className="text-lg font-medium text-noir-800">등록자 목록</h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-taupe-500">로딩 중...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-platinum bg-ivory-50">
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-taupe-500">
                      이메일
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-taupe-500">
                      이름
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-taupe-500">
                      결혼 예정일
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-taupe-500">
                      소스
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-taupe-500">
                      등록일
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {registrations.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-platinum/50 transition-colors hover:bg-ivory-50"
                    >
                      <td className="px-6 py-4 text-sm text-noir-800">{r.email}</td>
                      <td className="px-6 py-4 text-sm text-charcoal">
                        {r.name || "-"}
                      </td>
                      <td className="px-6 py-4 text-sm text-charcoal">
                        {r.wedding_date || "-"}
                      </td>
                      <td className="px-6 py-4">
                        <span className="rounded-full bg-rose-glow px-2.5 py-1 text-xs font-medium text-rose-500">
                          {r.source}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-taupe-500">
                        {new Date(r.created_at).toLocaleDateString("ko-KR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
