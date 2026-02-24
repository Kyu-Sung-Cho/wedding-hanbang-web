"use client";

import { useEffect, useState, useCallback } from "react";
import { Check, X, Eye, Store, Users, Shield, ShieldCheck, ShieldX, Loader2 } from "lucide-react";

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

interface AdminVendor {
  id: string;
  name: string;
  category: string;
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  businessNumber: string;
  priceRange: string;
  description: string;
  tags: string[];
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [dailyCounts, setDailyCounts] = useState<DailyCount[]>([]);
  const [loading, setLoading] = useState(false);

  // 탭 상태
  const [activeTab, setActiveTab] = useState<"registrations" | "vendors">("registrations");

  // 업체 심사 상태
  const [vendors, setVendors] = useState<AdminVendor[]>([]);
  const [vendorFilter, setVendorFilter] = useState<AdminVendor["status"] | "all">("all");
  const [selectedVendor, setSelectedVendor] = useState<AdminVendor | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [vendorLoading, setVendorLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchVendors = useCallback(async () => {
    setVendorLoading(true);
    try {
      const res = await fetch("/api/admin/vendors", {
        headers: { "x-admin-password": password },
      });
      if (res.ok) {
        const data = await res.json();
        setVendors(data.vendors);
      }
    } catch {
      console.error("업체 목록 조회 실패");
    }
    setVendorLoading(false);
  }, [password]);

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

  // 인증 후 업체 데이터 로드
  useEffect(() => {
    if (authenticated) {
      fetchVendors();
    }
  }, [authenticated, fetchVendors]);

  const handleApprove = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/vendors/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify({ action: "approve" }),
      });
      if (res.ok) {
        await fetchVendors();
        setSelectedVendor(null);
      } else {
        alert("승인 처리에 실패했습니다.");
      }
    } catch {
      alert("서버 오류가 발생했습니다.");
    }
    setActionLoading(false);
  };

  const handleReject = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/vendors/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify({ action: "reject", reason: rejectReason }),
      });
      if (res.ok) {
        await fetchVendors();
        setSelectedVendor(null);
        setRejectReason("");
      } else {
        alert("반려 처리에 실패했습니다.");
      }
    } catch {
      alert("서버 오류가 발생했습니다.");
    }
    setActionLoading(false);
  };

  const filteredVendors = vendorFilter === "all" ? vendors : vendors.filter((v) => v.status === vendorFilter);
  const pendingVendors = vendors.filter((v) => v.status === "pending").length;
  const approvedVendors = vendors.filter((v) => v.status === "approved").length;
  const rejectedVendors = vendors.filter((v) => v.status === "rejected").length;

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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif-kr text-2xl font-light">관리자 대시보드</h1>
            <p className="text-sm text-taupe-500 mt-1">웨딩한방 관리 현황</p>
          </div>
          <button
            onClick={() => setAuthenticated(false)}
            className="px-4 py-2 text-sm text-taupe-500 border border-platinum rounded-lg hover:border-rose-500 hover:text-rose-500 transition-colors"
          >
            로그아웃
          </button>
        </div>

        {/* 탭 네비게이션 */}
        <div className="flex gap-2 mb-8">
          <button
            onClick={() => setActiveTab("registrations")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-medium transition-colors ${
              activeTab === "registrations"
                ? "bg-noir-800 text-white"
                : "bg-white text-charcoal border border-black/[0.04] hover:border-noir-800"
            }`}
          >
            <Users className="w-4 h-4" />
            사전등록
            <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[11px]">{totalCount}</span>
          </button>
          <button
            onClick={() => setActiveTab("vendors")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-medium transition-colors ${
              activeTab === "vendors"
                ? "bg-noir-800 text-white"
                : "bg-white text-charcoal border border-black/[0.04] hover:border-noir-800"
            }`}
          >
            <Store className="w-4 h-4" />
            업체 심사
            {pendingVendors > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-gold text-white text-[11px]">{pendingVendors}</span>
            )}
          </button>
        </div>

        {activeTab === "registrations" && (
          <>
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
                    ? Math.round(dailyCounts.slice(-7).reduce((sum, d) => sum + d.count, 0) / Math.min(dailyCounts.length, 7))
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
          </>
        )}

        {activeTab === "vendors" && (
          <>
            {/* 업체 통계 */}
            <div className="grid grid-cols-3 gap-6 mb-8 max-md:grid-cols-1">
              <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-taupe-400" />
                  <p className="text-sm text-taupe-500">대기중</p>
                </div>
                <p className="font-display text-4xl font-light text-gold">{pendingVendors}</p>
              </div>
              <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="w-4 h-4 text-[#2E7D5A]" />
                  <p className="text-sm text-taupe-500">승인됨</p>
                </div>
                <p className="font-display text-4xl font-light text-[#2E7D5A]">{approvedVendors}</p>
              </div>
              <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldX className="w-4 h-4 text-red-500" />
                  <p className="text-sm text-taupe-500">반려됨</p>
                </div>
                <p className="font-display text-4xl font-light text-red-500">{rejectedVendors}</p>
              </div>
            </div>

            {/* 필터 */}
            <div className="flex gap-2 mb-6">
              {[
                { key: "all" as const, label: "전체" },
                { key: "pending" as const, label: "대기중" },
                { key: "approved" as const, label: "승인됨" },
                { key: "rejected" as const, label: "반려됨" },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setVendorFilter(f.key)}
                  className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                    vendorFilter === f.key
                      ? "bg-noir-800 text-white"
                      : "bg-white text-charcoal border border-black/[0.04] hover:border-noir-800"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* 업체 리스트 */}
            <div className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden">
              {vendorLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 text-taupe-400 animate-spin" />
                  <span className="ml-2 text-[14px] text-taupe-400">업체 목록 로딩 중...</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-platinum">
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">업체명</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">업종</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">대표자</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">사업자번호</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">등록일</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">상태</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">액션</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredVendors.map((v) => (
                        <tr key={v.id} className="border-b border-black/[0.02] hover:bg-ivory-warm/50 transition-colors">
                          <td className="px-6 py-4 text-sm text-noir-800 font-medium">{v.name}</td>
                          <td className="px-6 py-4 text-sm text-taupe-500">{v.category}</td>
                          <td className="px-6 py-4 text-sm text-taupe-500">{v.ownerName}</td>
                          <td className="px-6 py-4 text-sm text-taupe-500 font-mono">{v.businessNumber}</td>
                          <td className="px-6 py-4 text-sm text-taupe-500">
                            {v.createdAt ? new Date(v.createdAt).toLocaleDateString("ko-KR") : "-"}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${
                              v.status === "approved" ? "bg-[#2E7D5A]/10 text-[#2E7D5A]" :
                              v.status === "pending" ? "bg-gold/10 text-gold" :
                              "bg-red-500/10 text-red-500"
                            }`}>
                              {v.status === "approved" ? "승인" : v.status === "pending" ? "대기" : "반려"}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setSelectedVendor(v)}
                                className="p-1.5 rounded-lg hover:bg-ivory-warm transition-colors"
                                title="상세 보기"
                              >
                                <Eye className="w-4 h-4 text-taupe-400" />
                              </button>
                              {v.status === "pending" && (
                                <>
                                  <button
                                    onClick={() => handleApprove(v.id)}
                                    disabled={actionLoading}
                                    className="p-1.5 rounded-lg hover:bg-[#2E7D5A]/10 transition-colors disabled:opacity-50"
                                    title="승인"
                                  >
                                    <Check className="w-4 h-4 text-[#2E7D5A]" />
                                  </button>
                                  <button
                                    onClick={() => setSelectedVendor(v)}
                                    className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                                    title="반려"
                                  >
                                    <X className="w-4 h-4 text-red-500" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredVendors.length === 0 && !vendorLoading && (
                        <tr>
                          <td colSpan={7} className="px-6 py-12 text-center text-taupe-400 text-sm">
                            등록된 업체가 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 업체 상세 모달 */}
            {selectedVendor && (
              <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-5" onClick={() => setSelectedVendor(null)}>
                <div className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-8" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-serif-kr text-[20px] font-normal text-noir-800">업체 상세 정보</h3>
                    <button onClick={() => setSelectedVendor(null)} className="p-1.5 rounded-lg hover:bg-ivory-warm transition-colors">
                      <X className="w-5 h-5 text-taupe-400" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    {[
                      { label: "업체명", value: selectedVendor.name },
                      { label: "업종", value: selectedVendor.category },
                      { label: "대표자", value: selectedVendor.ownerName },
                      { label: "연락처", value: selectedVendor.phone },
                      { label: "이메일", value: selectedVendor.email },
                      { label: "주소", value: selectedVendor.address },
                      { label: "사업자번호", value: selectedVendor.businessNumber },
                      { label: "가격대", value: selectedVendor.priceRange },
                      { label: "등록일", value: selectedVendor.createdAt ? new Date(selectedVendor.createdAt).toLocaleDateString("ko-KR") : "-" },
                    ].map((item) => (
                      <div key={item.label} className="flex items-start gap-3">
                        <span className="text-[12px] text-taupe-400 w-[80px] flex-shrink-0 pt-0.5">{item.label}</span>
                        <span className="text-[14px] text-noir-800">{item.value || "-"}</span>
                      </div>
                    ))}
                    {selectedVendor.description && (
                      <div>
                        <span className="text-[12px] text-taupe-400 block mb-1">소개</span>
                        <p className="text-[13px] text-charcoal font-light leading-relaxed">{selectedVendor.description}</p>
                      </div>
                    )}
                    {selectedVendor.tags && selectedVendor.tags.length > 0 && (
                      <div>
                        <span className="text-[12px] text-taupe-400 block mb-1">태그</span>
                        <div className="flex gap-1.5 flex-wrap">
                          {selectedVendor.tags.map((tag) => (
                            <span key={tag} className="px-2.5 py-1 rounded-full bg-ivory-warm text-[11px] text-charcoal font-medium">{tag}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {selectedVendor.status === "pending" && (
                    <div className="mt-6 pt-6 border-t border-black/[0.04]">
                      <div className="mb-4">
                        <label className="block text-[13px] font-medium text-noir-800 mb-2">반려 사유 (반려 시)</label>
                        <textarea
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="반려 사유를 입력해주세요..."
                          rows={2}
                          className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors resize-none"
                        />
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleApprove(selectedVendor.id)}
                          disabled={actionLoading}
                          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#2E7D5A] text-white text-[14px] font-medium hover:bg-[#246B4C] transition-colors disabled:opacity-50"
                        >
                          {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          승인
                        </button>
                        <button
                          onClick={() => handleReject(selectedVendor.id)}
                          disabled={actionLoading}
                          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 text-white text-[14px] font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                        >
                          {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                          반려
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
