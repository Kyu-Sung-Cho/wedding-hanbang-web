"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Check, X, Eye, Store, Users, Shield, ShieldCheck, ShieldX,
  Loader2, LogOut, LayoutDashboard, Building2, CalendarCheck,
  UserCheck, Phone, UserPlus, BarChart3, Heart, TrendingUp, MousePointerClick, RotateCcw,
  Banknote, Flag,
} from "lucide-react";

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

interface AdminCustomer {
  id: string;
  name: string;
  email: string;
  role: string | null;
  coupleId: string | null;
  onboardingCompleted: boolean;
  onboardingStep: number;
  hasPartner: boolean;
  weddingDate: string | null;
  totalBudget: number | null;
  venue: string | null;
  createdAt: string;
}

interface AdminBooking {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorCategory: string;
  productName: string | null;
  coupleId: string | null;
  brideName: string | null;
  groomName: string | null;
  contactPhone: string | null;
  bookingDate: string;
  bookingTime: string;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  amount: number | null;
  isPaid: boolean;
  memo: string | null;
  createdAt: string;
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface InsightsData {
  overview: {
    totalViews: number;
    totalFavorites: number;
    newFavorites: number;
    totalBookings: number;
    confirmedBookings: number;
    activeUsers: number;
    totalUsers: number;
    totalVendors: number;
  };
  topVendors: { id: string; name: string; category: string; views: number; favorites: number; bookings: number }[];
  categoryStats: { category: string; vendorCount: number; bookingCount: number; avgRating: number }[];
  customerActivity: {
    dailyActiveUsers: { date: string; count: number }[];
    eventBreakdown: { event_type: string; count: number }[];
    topPages: { path: string; count: number }[];
  };
  favoriteInsights: {
    trend: { date: string; count: number }[];
  };
}

interface AdminSettlement {
  id: string;
  paymentId: string;
  vendorId: string;
  bookingId: string;
  totalAmount: number;
  commissionRate: number;
  commissionAmount: number;
  settleAmount: number;
  status: string;
  settledAt: string | null;
  bankName: string | null;
  accountNumber: string | null;
  accountHolder: string | null;
  memo: string | null;
  createdAt: string;
  vendorName?: string;
}

type TabKey = "registrations" | "vendors" | "customers" | "bookings" | "insights" | "reports" | "settlements" | "admins";

type ReportStatus = "pending" | "reviewed" | "resolved" | "dismissed";

interface AdminReport {
  id: string;
  reporter_id: string;
  reporter_nickname: string;
  post_id: string | null;
  comment_id: string | null;
  reason: string;
  description: string | null;
  status: ReportStatus;
  created_at: string;
  post: {
    id: string;
    title: string;
    content: string;
    author_id: string;
    category: string;
    visibility: string;
    under_review: boolean;
  } | null;
  comment: {
    id: string;
    content: string;
    author_id: string;
    post_id: string;
  } | null;
}

const REPORT_REASON_LABEL: Record<string, string> = {
  spam: "스팸/도배",
  abuse: "욕설/비하",
  ad: "광고/홍보",
  inappropriate: "부적절한 내용",
  other: "기타",
};

const REPORT_STATUS_LABEL: Record<ReportStatus, { text: string; cls: string }> = {
  pending: { text: "대기", cls: "bg-gold/10 text-gold" },
  reviewed: { text: "검토 중", cls: "bg-rose-500/10 text-rose-500" },
  resolved: { text: "처리됨", cls: "bg-[#2E7D5A]/10 text-[#2E7D5A]" },
  dismissed: { text: "기각", cls: "bg-noir-800/10 text-noir-800" },
};
type AuthState = "loading" | "not_authenticated" | "admin";

const BOOKING_STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  pending: { text: "대기", cls: "bg-gold/10 text-gold" },
  confirmed: { text: "확정", cls: "bg-[#2E7D5A]/10 text-[#2E7D5A]" },
  completed: { text: "완료", cls: "bg-noir-800/10 text-noir-800" },
  cancelled: { text: "취소", cls: "bg-red-500/10 text-red-500" },
};

export default function AdminPage() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [adminEmail, setAdminEmail] = useState("");

  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [dailyCounts, setDailyCounts] = useState<DailyCount[]>([]);

  const [activeTab, setActiveTab] = useState<TabKey>("registrations");

  // 업체
  const [vendors, setVendors] = useState<AdminVendor[]>([]);
  const [vendorFilter, setVendorFilter] = useState<AdminVendor["status"] | "all">("all");
  const [selectedVendor, setSelectedVendor] = useState<AdminVendor | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [vendorLoading, setVendorLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // 고객
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [customerStats, setCustomerStats] = useState({ total: 0, onboarded: 0, coupled: 0, todayCount: 0 });
  const [customerLoading, setCustomerLoading] = useState(false);

  // 예약
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [bookingStats, setBookingStats] = useState({ total: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0 });
  const [bookingFilter, setBookingFilter] = useState<AdminBooking["status"] | "all">("all");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<AdminBooking | null>(null);

  // 인사이트
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [insightsPeriod, setInsightsPeriod] = useState<"7d" | "30d" | "90d">("30d");
  const [insightsLoading, setInsightsLoading] = useState(false);

  // 관리자 관리
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminListLoading, setAdminListLoading] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [newAdminName, setNewAdminName] = useState("");
  const [adminSetupPw, setAdminSetupPw] = useState("");
  const [createAdminLoading, setCreateAdminLoading] = useState(false);
  const [createAdminError, setCreateAdminError] = useState("");
  const [createAdminSuccess, setCreateAdminSuccess] = useState("");

  // 정산
  const [settlements, setSettlements] = useState<AdminSettlement[]>([]);
  const [settlementFilter, setSettlementFilter] = useState<string>("all");
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // 신고 관리
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [reportCounts, setReportCounts] = useState<Record<ReportStatus, number>>({
    pending: 0,
    reviewed: 0,
    resolved: 0,
    dismissed: 0,
  });
  const [reportFilter, setReportFilter] = useState<ReportStatus | "all">("pending");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportActionId, setReportActionId] = useState<string | null>(null);

  const loadReports = useCallback(async (filter: ReportStatus | "all" = "pending") => {
    setReportLoading(true);
    try {
      const res = await fetch(`/api/admin/reports?status=${filter}`);
      const data = await res.json();
      if (res.ok) {
        setReports(data.reports ?? []);
        if (data.counts) setReportCounts(data.counts);
      }
    } finally {
      setReportLoading(false);
    }
  }, []);

  async function updateReportStatus(reportId: string, status: ReportStatus) {
    setReportActionId(reportId);
    try {
      const res = await fetch(`/api/admin/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        await loadReports(reportFilter);
      }
    } finally {
      setReportActionId(null);
    }
  }

  // 신고된 글에 직접 조치 — 숨김 / 복원 / 강제 삭제
  async function moderatePost(
    reportId: string,
    postId: string,
    action: "hide" | "unhide" | "delete"
  ) {
    if (action === "delete") {
      const ok = window.confirm(
        "이 게시글을 영구 삭제하시겠어요?\n댓글, 투표, 북마크, 폴까지 모두 함께 삭제되며 복구 불가합니다."
      );
      if (!ok) return;
    }
    setReportActionId(reportId);
    try {
      const res = await fetch(`/api/admin/posts/${postId}/moderate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        await loadReports(reportFilter);
      } else {
        const data = await res.json().catch(() => ({}));
        window.alert(data?.error ?? "조치 실패");
      }
    } finally {
      setReportActionId(null);
    }
  }

  // 관리자 인증
  useEffect(() => {
    async function checkAdmin() {
      try {
        const res = await fetch("/api/admin/auth");
        const data = await res.json();
        if (res.status === 401 || !data.isAdmin) {
          window.location.href = "/admin/login";
          return;
        }
        setAuthState("admin");
        setAdminEmail(data.email || "");
      } catch {
        window.location.href = "/admin/login";
      }
    }
    checkAdmin();
  }, []);

  const fetchRegistrations = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/registrations");
      if (res.ok) {
        const data = await res.json();
        setRegistrations(data.registrations);
        setTotalCount(data.total);
        setDailyCounts(data.dailyCounts);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchVendors = useCallback(async () => {
    setVendorLoading(true);
    try {
      const res = await fetch("/api/admin/vendors");
      if (res.ok) {
        const data = await res.json();
        setVendors(data.vendors);
      }
    } catch { /* ignore */ }
    setVendorLoading(false);
  }, []);

  const fetchCustomers = useCallback(async () => {
    setCustomerLoading(true);
    try {
      const res = await fetch("/api/admin/customers");
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.customers);
        setCustomerStats(data.stats);
      }
    } catch { /* ignore */ }
    setCustomerLoading(false);
  }, []);

  const fetchBookings = useCallback(async () => {
    setBookingLoading(true);
    try {
      const res = await fetch("/api/admin/bookings");
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings);
        setBookingStats(data.stats);
      }
    } catch { /* ignore */ }
    setBookingLoading(false);
  }, []);

  const fetchAdminUsers = useCallback(async () => {
    setAdminListLoading(true);
    try {
      const res = await fetch("/api/admin/admins");
      if (res.ok) {
        const data = await res.json();
        setAdminUsers(data.admins);
      }
    } catch { /* ignore */ }
    setAdminListLoading(false);
  }, []);

  const fetchInsights = useCallback(async (p?: string) => {
    setInsightsLoading(true);
    try {
      const res = await fetch(`/api/admin/insights?period=${p || insightsPeriod}`);
      if (res.ok) {
        setInsights(await res.json());
      }
    } catch { /* ignore */ }
    setInsightsLoading(false);
  }, [insightsPeriod]);

  const fetchSettlements = useCallback(async () => {
    setSettlementLoading(true);
    try {
      const res = await fetch("/api/admin/settlements");
      if (res.ok) {
        const data = await res.json();
        setSettlements(data.settlements ?? []);
      }
    } catch { /* ignore */ }
    setSettlementLoading(false);
  }, []);

  const handleProcessSettlement = async (id: string) => {
    if (!confirm("이 정산을 실행하시겠습니까? 업체에 금액이 지급됩니다.")) return;
    setProcessingId(id);
    try {
      const res = await fetch(`/api/admin/settlements/${id}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await fetchSettlements();
      } else {
        const data = await res.json();
        alert(data.error || "정산 처리에 실패했습니다.");
      }
    } catch {
      alert("서버 오류가 발생했습니다.");
    }
    setProcessingId(null);
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminEmail || !newAdminPassword || !adminSetupPw) {
      setCreateAdminError("모든 필드를 입력해주세요.");
      return;
    }
    if (newAdminPassword.length < 6) {
      setCreateAdminError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    setCreateAdminLoading(true);
    setCreateAdminError("");
    setCreateAdminSuccess("");
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-admin",
          email: newAdminEmail,
          password: newAdminPassword,
          name: newAdminName || "관리자",
          setupPassword: adminSetupPw,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateAdminError(data.error || "관리자 생성에 실패했습니다.");
      } else {
        setCreateAdminSuccess("새 관리자 계정이 생성되었습니다.");
        setNewAdminEmail("");
        setNewAdminPassword("");
        setNewAdminName("");
        setAdminSetupPw("");
        fetchAdminUsers();
      }
    } catch {
      setCreateAdminError("서버 오류가 발생했습니다.");
    }
    setCreateAdminLoading(false);
  };

  useEffect(() => {
    if (authState === "admin") {
      fetchRegistrations();
      fetchVendors();
      fetchCustomers();
      fetchBookings();
      fetchAdminUsers();
      fetchInsights();
      fetchSettlements();
      void loadReports("pending");
    }
  }, [authState, fetchRegistrations, fetchVendors, fetchCustomers, fetchBookings, fetchAdminUsers, fetchInsights, fetchSettlements, loadReports]);

  const handleApprove = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/vendors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (res.ok) {
        await fetchVendors();
        setSelectedVendor(null);
      } else { alert("승인 처리에 실패했습니다."); }
    } catch { alert("서버 오류가 발생했습니다."); }
    setActionLoading(false);
  };

  const handleReject = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/vendors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reason: rejectReason }),
      });
      if (res.ok) {
        await fetchVendors();
        setSelectedVendor(null);
        setRejectReason("");
      } else { alert("반려 처리에 실패했습니다."); }
    } catch { alert("서버 오류가 발생했습니다."); }
    setActionLoading(false);
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("이 업체의 승인을 취소하시겠습니까? 고객에게 더 이상 노출되지 않습니다.")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/vendors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      if (res.ok) {
        await fetchVendors();
        setSelectedVendor(null);
      } else { alert("승인 취소에 실패했습니다."); }
    } catch { alert("서버 오류가 발생했습니다."); }
    setActionLoading(false);
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const filteredVendors = vendorFilter === "all" ? vendors : vendors.filter((v) => v.status === vendorFilter);
  const pendingVendors = vendors.filter((v) => v.status === "pending").length;
  const approvedVendors = vendors.filter((v) => v.status === "approved").length;
  const rejectedVendors = vendors.filter((v) => v.status === "rejected").length;

  const filteredBookings = bookingFilter === "all" ? bookings : bookings.filter((b) => b.status === bookingFilter);

  if (authState !== "admin") {
    return (
      <div className="min-h-screen bg-ivory-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[14px] text-taupe-500">인증 확인 중...</p>
        </div>
      </div>
    );
  }

  const maxDailyCount = Math.max(...dailyCounts.map((d) => d.count), 1);

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString("ko-KR") : "-";
  const formatBudget = (b: number | null) =>
    b ? `${(b / 10000).toLocaleString()}만원` : "-";

  const TAB_ITEMS: { key: TabKey; label: string; icon: typeof Users; badge?: number }[] = [
    { key: "registrations", label: "사전등록", icon: Users, badge: totalCount },
    { key: "vendors", label: "업체 심사", icon: Store, badge: pendingVendors || undefined },
    { key: "customers", label: "고객 현황", icon: UserCheck, badge: customerStats.total },
    { key: "bookings", label: "예약 현황", icon: CalendarCheck, badge: bookingStats.total },
    { key: "insights", label: "인사이트", icon: BarChart3 },
    { key: "reports", label: "신고 관리", icon: Flag, badge: reportCounts.pending || undefined },
    { key: "settlements", label: "정산 관리", icon: Banknote, badge: settlements.filter((s) => s.status === "pending").length || undefined },
    { key: "admins", label: "관리자 관리", icon: UserPlus, badge: adminUsers.length || undefined },
  ];

  return (
    <div className="min-h-screen bg-ivory-50 p-8 max-md:p-4">
      <div className="max-w-[1200px] mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8 max-md:flex-col max-md:gap-4">
          <div>
            <h1 className="font-serif-kr text-2xl font-light">관리자 대시보드</h1>
            <p className="text-sm text-taupe-500 mt-1">{adminEmail}</p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="flex items-center gap-1.5 px-4 py-2 text-sm text-taupe-500 border border-platinum rounded-lg hover:border-rose-500 hover:text-rose-500 transition-colors">
              <LayoutDashboard className="w-3.5 h-3.5" /> 고객 대시보드
            </a>
            <a href="/vendor/dashboard" className="flex items-center gap-1.5 px-4 py-2 text-sm text-taupe-500 border border-platinum rounded-lg hover:border-rose-500 hover:text-rose-500 transition-colors">
              <Building2 className="w-3.5 h-3.5" /> 업체 포털
            </a>
            <button onClick={handleLogout} className="flex items-center gap-1.5 px-4 py-2 text-sm text-taupe-500 border border-platinum rounded-lg hover:border-rose-500 hover:text-rose-500 transition-colors">
              <LogOut className="w-3.5 h-3.5" /> 로그아웃
            </button>
          </div>
        </div>

        {/* 탭 */}
        <div className="flex gap-2 mb-8 flex-wrap">
          {TAB_ITEMS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-noir-800 text-white"
                  : "bg-white text-charcoal border border-black/[0.04] hover:border-noir-800"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[11px] ${
                  activeTab === tab.key ? "bg-white/20" : "bg-noir-800/10"
                }`}>{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* ===== 사전등록 탭 ===== */}
        {activeTab === "registrations" && (
          <>
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
                    <span className="text-[10px] text-taupe-400 -rotate-45 origin-top-left whitespace-nowrap">{day.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden">
              <div className="p-8 pb-4"><h2 className="font-serif-kr text-lg font-normal">등록자 목록</h2></div>
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
                        <td className="px-8 py-4 text-sm text-taupe-500">{formatDate(reg.created_at)}</td>
                      </tr>
                    ))}
                    {registrations.length === 0 && (
                      <tr><td colSpan={4} className="px-8 py-12 text-center text-taupe-400 text-sm">아직 등록된 사용자가 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ===== 업체 심사 탭 ===== */}
        {activeTab === "vendors" && (
          <>
            <div className="grid grid-cols-3 gap-6 mb-8 max-md:grid-cols-1">
              <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
                <div className="flex items-center gap-2 mb-2"><Shield className="w-4 h-4 text-taupe-400" /><p className="text-sm text-taupe-500">대기중</p></div>
                <p className="font-display text-4xl font-light text-gold">{pendingVendors}</p>
              </div>
              <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
                <div className="flex items-center gap-2 mb-2"><ShieldCheck className="w-4 h-4 text-[#2E7D5A]" /><p className="text-sm text-taupe-500">승인됨</p></div>
                <p className="font-display text-4xl font-light text-[#2E7D5A]">{approvedVendors}</p>
              </div>
              <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
                <div className="flex items-center gap-2 mb-2"><ShieldX className="w-4 h-4 text-red-500" /><p className="text-sm text-taupe-500">반려됨</p></div>
                <p className="font-display text-4xl font-light text-red-500">{rejectedVendors}</p>
              </div>
            </div>

            <div className="flex gap-2 mb-6">
              {([
                { key: "all" as const, label: "전체" },
                { key: "pending" as const, label: "대기중" },
                { key: "approved" as const, label: "승인됨" },
                { key: "rejected" as const, label: "반려됨" },
              ]).map((f) => (
                <button key={f.key} onClick={() => setVendorFilter(f.key)}
                  className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                    vendorFilter === f.key ? "bg-noir-800 text-white" : "bg-white text-charcoal border border-black/[0.04] hover:border-noir-800"
                  }`}>{f.label}</button>
              ))}
            </div>

            <div className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden">
              {vendorLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 text-taupe-400 animate-spin" />
                  <span className="ml-2 text-[14px] text-taupe-400">로딩 중...</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-platinum">
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">업체명</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">업종</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">대표자</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">연락처</th>
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
                          <td className="px-6 py-4 text-sm text-taupe-500">
                            {v.phone && (
                              <a href={`tel:${v.phone}`} className="flex items-center gap-1 text-rose-500 hover:underline">
                                <Phone className="w-3 h-3" />{v.phone}
                              </a>
                            )}
                          </td>
                          <td className="px-6 py-4 text-sm text-taupe-500 font-mono">{v.businessNumber}</td>
                          <td className="px-6 py-4 text-sm text-taupe-500">{formatDate(v.createdAt)}</td>
                          <td className="px-6 py-4">
                            <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${
                              v.status === "approved" ? "bg-[#2E7D5A]/10 text-[#2E7D5A]" :
                              v.status === "pending" ? "bg-gold/10 text-gold" : "bg-red-500/10 text-red-500"
                            }`}>{v.status === "approved" ? "승인" : v.status === "pending" ? "대기" : "반려"}</span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <button onClick={() => setSelectedVendor(v)} className="p-1.5 rounded-lg hover:bg-ivory-warm transition-colors" title="상세 보기">
                                <Eye className="w-4 h-4 text-taupe-400" />
                              </button>
                              {v.status === "pending" && (
                                <>
                                  <button onClick={() => handleApprove(v.id)} disabled={actionLoading} className="p-1.5 rounded-lg hover:bg-[#2E7D5A]/10 transition-colors disabled:opacity-50" title="승인">
                                    <Check className="w-4 h-4 text-[#2E7D5A]" />
                                  </button>
                                  <button onClick={() => setSelectedVendor(v)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors" title="반려">
                                    <X className="w-4 h-4 text-red-500" />
                                  </button>
                                </>
                              )}
                              {v.status === "approved" && (
                                <button onClick={() => handleRevoke(v.id)} disabled={actionLoading} className="p-1.5 rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-50" title="승인 취소">
                                  <RotateCcw className="w-4 h-4 text-amber-600" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredVendors.length === 0 && !vendorLoading && (
                        <tr><td colSpan={8} className="px-6 py-12 text-center text-taupe-400 text-sm">등록된 업체가 없습니다.</td></tr>
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
                      { label: "등록일", value: formatDate(selectedVendor.createdAt) },
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
                    {selectedVendor.tags?.length > 0 && (
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
                        <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="반려 사유를 입력해주세요..." rows={2}
                          className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors resize-none" />
                      </div>
                      <div className="flex gap-3">
                        <button onClick={() => handleApprove(selectedVendor.id)} disabled={actionLoading}
                          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#2E7D5A] text-white text-[14px] font-medium hover:bg-[#246B4C] transition-colors disabled:opacity-50">
                          {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} 승인
                        </button>
                        <button onClick={() => handleReject(selectedVendor.id)} disabled={actionLoading}
                          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 text-white text-[14px] font-medium hover:bg-red-600 transition-colors disabled:opacity-50">
                          {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} 반려
                        </button>
                      </div>
                    </div>
                  )}
                  {selectedVendor.status === "approved" && (
                    <div className="mt-6 pt-6 border-t border-black/[0.04]">
                      <button onClick={() => handleRevoke(selectedVendor.id)} disabled={actionLoading}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 text-white text-[14px] font-medium hover:bg-amber-600 transition-colors disabled:opacity-50">
                        {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} 승인 취소
                      </button>
                      <p className="mt-2 text-[12px] text-taupe-400 text-center">승인 취소 시 고객에게 더 이상 노출되지 않으며, 대기 상태로 변경됩니다.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== 고객 현황 탭 ===== */}
        {activeTab === "customers" && (
          <>
            <div className="grid grid-cols-4 gap-6 mb-8 max-md:grid-cols-2">
              <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
                <p className="text-sm text-taupe-500 mb-2">전체 고객</p>
                <p className="font-display text-4xl font-light text-noir-800">{customerStats.total}</p>
              </div>
              <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
                <p className="text-sm text-taupe-500 mb-2">온보딩 완료</p>
                <p className="font-display text-4xl font-light text-[#2E7D5A]">{customerStats.onboarded}</p>
              </div>
              <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
                <p className="text-sm text-taupe-500 mb-2">커플 연동</p>
                <p className="font-display text-4xl font-light text-rose-500">{customerStats.coupled}</p>
              </div>
              <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
                <p className="text-sm text-taupe-500 mb-2">오늘 가입</p>
                <p className="font-display text-4xl font-light text-gold">{customerStats.todayCount}</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden">
              <div className="p-8 pb-4"><h2 className="font-serif-kr text-lg font-normal">고객 목록</h2></div>
              {customerLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 text-taupe-400 animate-spin" />
                  <span className="ml-2 text-[14px] text-taupe-400">로딩 중...</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-platinum">
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">이름</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">이메일</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">역할</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">온보딩</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">커플</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">결혼일</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">예산</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">가입일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((c) => (
                        <tr key={c.id} className="border-b border-black/[0.02] hover:bg-ivory-warm/50 transition-colors">
                          <td className="px-6 py-4 text-sm text-noir-800 font-medium">{c.name || "-"}</td>
                          <td className="px-6 py-4 text-sm text-taupe-500">{c.email || "-"}</td>
                          <td className="px-6 py-4">
                            {c.role && (
                              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                                c.role === "bride" ? "bg-rose-500/10 text-rose-500" : "bg-blue-500/10 text-blue-500"
                              }`}>{c.role === "bride" ? "신부" : "신랑"}</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                              c.onboardingCompleted ? "bg-[#2E7D5A]/10 text-[#2E7D5A]" : "bg-gold/10 text-gold"
                            }`}>{c.onboardingCompleted ? "완료" : `${c.onboardingStep}/4`}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                              c.hasPartner ? "bg-rose-500/10 text-rose-500" : c.coupleId ? "bg-gold/10 text-gold" : "bg-black/[0.04] text-taupe-400"
                            }`}>{c.hasPartner ? "연동됨" : c.coupleId ? "대기중" : "미연동"}</span>
                          </td>
                          <td className="px-6 py-4 text-sm text-taupe-500">{formatDate(c.weddingDate)}</td>
                          <td className="px-6 py-4 text-sm text-taupe-500">{formatBudget(c.totalBudget)}</td>
                          <td className="px-6 py-4 text-sm text-taupe-500">{formatDate(c.createdAt)}</td>
                        </tr>
                      ))}
                      {customers.length === 0 && !customerLoading && (
                        <tr><td colSpan={8} className="px-6 py-12 text-center text-taupe-400 text-sm">가입된 고객이 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ===== 예약 현황 탭 ===== */}
        {activeTab === "bookings" && (
          <>
            <div className="grid grid-cols-5 gap-4 mb-8 max-md:grid-cols-2">
              {[
                { label: "전체", value: bookingStats.total, cls: "text-noir-800" },
                { label: "대기", value: bookingStats.pending, cls: "text-gold" },
                { label: "확정", value: bookingStats.confirmed, cls: "text-[#2E7D5A]" },
                { label: "완료", value: bookingStats.completed, cls: "text-noir-800" },
                { label: "취소", value: bookingStats.cancelled, cls: "text-red-500" },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-2xl p-6 border border-black/[0.04]">
                  <p className="text-sm text-taupe-500 mb-2">{s.label}</p>
                  <p className={`font-display text-3xl font-light ${s.cls}`}>{s.value}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mb-6">
              {([
                { key: "all" as const, label: "전체" },
                { key: "pending" as const, label: "대기" },
                { key: "confirmed" as const, label: "확정" },
                { key: "completed" as const, label: "완료" },
                { key: "cancelled" as const, label: "취소" },
              ]).map((f) => (
                <button key={f.key} onClick={() => setBookingFilter(f.key)}
                  className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                    bookingFilter === f.key ? "bg-noir-800 text-white" : "bg-white text-charcoal border border-black/[0.04] hover:border-noir-800"
                  }`}>{f.label}</button>
              ))}
            </div>

            <div className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden">
              {bookingLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 text-taupe-400 animate-spin" />
                  <span className="ml-2 text-[14px] text-taupe-400">로딩 중...</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-platinum">
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">업체</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">상품</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">고객</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">연락처</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">예약일</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">시간</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">금액</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">상태</th>
                        <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">신청일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBookings.map((b) => {
                        const st = BOOKING_STATUS_LABEL[b.status] ?? BOOKING_STATUS_LABEL.pending;
                        const customerName = [b.brideName, b.groomName].filter(Boolean).join(" & ") || "-";
                        return (
                          <tr key={b.id} className="border-b border-black/[0.02] hover:bg-ivory-warm/50 transition-colors cursor-pointer" onClick={() => setSelectedBooking(b)}>
                            <td className="px-6 py-4 text-sm text-noir-800 font-medium">{b.vendorName}</td>
                            <td className="px-6 py-4 text-sm text-taupe-500">{b.productName || "-"}</td>
                            <td className="px-6 py-4 text-sm text-taupe-500">{customerName}</td>
                            <td className="px-6 py-4 text-sm text-taupe-500">
                              {b.contactPhone ? (
                                <a href={`tel:${b.contactPhone}`} className="flex items-center gap-1 text-rose-500 hover:underline">
                                  <Phone className="w-3 h-3" />{b.contactPhone}
                                </a>
                              ) : "-"}
                            </td>
                            <td className="px-6 py-4 text-sm text-taupe-500">{formatDate(b.bookingDate)}</td>
                            <td className="px-6 py-4 text-sm text-taupe-500">{b.bookingTime || "-"}</td>
                            <td className="px-6 py-4 text-sm text-taupe-500">{b.amount ? `${b.amount.toLocaleString()}원` : "-"}</td>
                            <td className="px-6 py-4">
                              <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${st.cls}`}>{st.text}</span>
                            </td>
                            <td className="px-6 py-4 text-sm text-taupe-500">{formatDate(b.createdAt)}</td>
                          </tr>
                        );
                      })}
                      {filteredBookings.length === 0 && !bookingLoading && (
                        <tr><td colSpan={9} className="px-6 py-12 text-center text-taupe-400 text-sm">예약 내역이 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 예약 상세 모달 */}
            {selectedBooking && (
              <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-5" onClick={() => setSelectedBooking(null)}>
                <div className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-8" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-serif-kr text-[20px] font-normal text-noir-800">예약 상세</h3>
                    <button onClick={() => setSelectedBooking(null)} className="p-1.5 rounded-lg hover:bg-ivory-warm transition-colors">
                      <X className="w-5 h-5 text-taupe-400" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    {[
                      { label: "업체", value: selectedBooking.vendorName },
                      { label: "업종", value: selectedBooking.vendorCategory },
                      { label: "상품", value: selectedBooking.productName },
                      { label: "신부", value: selectedBooking.brideName },
                      { label: "신랑", value: selectedBooking.groomName },
                      { label: "연락처", value: selectedBooking.contactPhone },
                      { label: "예약일", value: formatDate(selectedBooking.bookingDate) },
                      { label: "시간", value: selectedBooking.bookingTime },
                      { label: "금액", value: selectedBooking.amount ? `${selectedBooking.amount.toLocaleString()}원` : null },
                      { label: "결제", value: selectedBooking.isPaid ? "완료" : "미결제" },
                      { label: "신청일", value: formatDate(selectedBooking.createdAt) },
                    ].map((item) => (
                      <div key={item.label} className="flex items-start gap-3">
                        <span className="text-[12px] text-taupe-400 w-[60px] flex-shrink-0 pt-0.5">{item.label}</span>
                        <span className="text-[14px] text-noir-800">{item.value || "-"}</span>
                      </div>
                    ))}
                    <div className="flex items-start gap-3">
                      <span className="text-[12px] text-taupe-400 w-[60px] flex-shrink-0 pt-0.5">상태</span>
                      <span className={`text-[12px] px-2.5 py-1 rounded-full font-medium ${
                        (BOOKING_STATUS_LABEL[selectedBooking.status] ?? BOOKING_STATUS_LABEL.pending).cls
                      }`}>{(BOOKING_STATUS_LABEL[selectedBooking.status] ?? BOOKING_STATUS_LABEL.pending).text}</span>
                    </div>
                    {selectedBooking.memo && (
                      <div>
                        <span className="text-[12px] text-taupe-400 block mb-1">메모</span>
                        <p className="text-[13px] text-charcoal font-light leading-relaxed bg-ivory-50 rounded-xl p-3">{selectedBooking.memo}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== 인사이트 탭 ===== */}
        {activeTab === "insights" && (
          <>
            {/* 기간 선택 */}
            <div className="flex gap-1 bg-white rounded-lg p-1 border border-black/[0.04] w-fit mb-6">
              {(["7d", "30d", "90d"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => { setInsightsPeriod(p); fetchInsights(p); }}
                  className={`px-4 py-2 rounded-md text-[13px] font-medium transition-colors ${
                    insightsPeriod === p ? "bg-noir-800 text-white" : "text-taupe-400 hover:text-charcoal"
                  }`}
                >
                  {p === "7d" ? "7일" : p === "30d" ? "30일" : "90일"}
                </button>
              ))}
            </div>

            {insightsLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 text-taupe-400 animate-spin" />
                <span className="ml-2 text-[14px] text-taupe-400">인사이트 로딩 중...</span>
              </div>
            ) : insights ? (
              <>
                {/* 핵심 KPI */}
                <div className="grid grid-cols-4 gap-4 mb-8 max-md:grid-cols-2">
                  {[
                    { label: "총 조회수", value: insights.overview.totalViews.toLocaleString(), icon: Eye, color: "text-rose-500" },
                    { label: "활성 사용자", value: insights.overview.activeUsers.toLocaleString(), icon: Users, color: "text-[#2E7D5A]" },
                    { label: "총 즐겨찾기", value: insights.overview.totalFavorites.toLocaleString(), icon: Heart, color: "text-rose-500" },
                    { label: "기간 예약", value: insights.overview.totalBookings.toLocaleString(), icon: CalendarCheck, color: "text-gold" },
                  ].map((kpi) => (
                    <div key={kpi.label} className="bg-white rounded-2xl p-6 border border-black/[0.04]">
                      <div className="flex items-center gap-2 mb-2">
                        <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                        <p className="text-sm text-taupe-500">{kpi.label}</p>
                      </div>
                      <p className="font-display text-3xl font-light text-noir-800">{kpi.value}</p>
                    </div>
                  ))}
                </div>

                {/* 플랫폼 현황 요약 */}
                <div className="grid grid-cols-4 gap-4 mb-8 max-md:grid-cols-2">
                  {[
                    { label: "전체 사용자", value: insights.overview.totalUsers },
                    { label: "승인 업체", value: insights.overview.totalVendors },
                    { label: "신규 찜", value: insights.overview.newFavorites },
                    { label: "확정 예약", value: insights.overview.confirmedBookings },
                  ].map((s) => (
                    <div key={s.label} className="bg-white rounded-2xl p-5 border border-black/[0.04]">
                      <p className="text-[12px] text-taupe-400 mb-1">{s.label}</p>
                      <p className="font-display text-2xl font-light text-noir-800">{s.value}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-6 mb-8 max-lg:grid-cols-1">
                  {/* 인기 업체 */}
                  <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <TrendingUp className="w-4 h-4 text-rose-500" />
                      <h2 className="font-serif-kr text-[16px] font-normal">인기 업체 TOP 10</h2>
                    </div>
                    <div className="space-y-2">
                      <div className="grid grid-cols-5 gap-2 px-3 text-[11px] text-taupe-400 font-medium">
                        <span className="col-span-2">업체명</span>
                        <span className="text-center">조회</span>
                        <span className="text-center">찜</span>
                        <span className="text-center">예약</span>
                      </div>
                      {insights.topVendors.map((v, i) => (
                        <div key={v.id} className="grid grid-cols-5 gap-2 px-3 py-2 rounded-lg bg-ivory-50/50 items-center">
                          <div className="col-span-2 flex items-center gap-2 min-w-0">
                            <span className="text-[11px] text-taupe-400 font-medium w-4 flex-shrink-0">{i + 1}</span>
                            <div className="min-w-0">
                              <p className="text-[13px] text-noir-800 font-medium truncate">{v.name}</p>
                              <p className="text-[10px] text-taupe-400">{v.category}</p>
                            </div>
                          </div>
                          <span className="text-[13px] text-charcoal text-center">{v.views}</span>
                          <span className="text-[13px] text-rose-500 text-center">{v.favorites}</span>
                          <span className="text-[13px] text-[#2E7D5A] text-center font-medium">{v.bookings}</span>
                        </div>
                      ))}
                      {insights.topVendors.length === 0 && (
                        <p className="text-[13px] text-taupe-400 text-center py-6">데이터가 없습니다</p>
                      )}
                    </div>
                  </div>

                  {/* 카테고리별 통계 */}
                  <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Store className="w-4 h-4 text-gold" />
                      <h2 className="font-serif-kr text-[16px] font-normal">카테고리별 현황</h2>
                    </div>
                    <div className="space-y-2">
                      <div className="grid grid-cols-4 gap-2 px-3 text-[11px] text-taupe-400 font-medium">
                        <span>카테고리</span>
                        <span className="text-center">업체 수</span>
                        <span className="text-center">예약</span>
                        <span className="text-center">평점</span>
                      </div>
                      {insights.categoryStats.map((c) => (
                        <div key={c.category} className="grid grid-cols-4 gap-2 px-3 py-2 rounded-lg bg-ivory-50/50 items-center">
                          <span className="text-[13px] text-noir-800 font-medium">{c.category}</span>
                          <span className="text-[13px] text-charcoal text-center">{c.vendorCount}</span>
                          <span className="text-[13px] text-charcoal text-center">{c.bookingCount}</span>
                          <span className="text-[13px] text-gold text-center">{c.avgRating > 0 ? `${c.avgRating}점` : "-"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-6 mb-8 max-lg:grid-cols-1">
                  {/* 일별 활성 사용자 */}
                  <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="w-4 h-4 text-[#2E7D5A]" />
                      <h2 className="text-[15px] font-medium text-noir-800">일별 활성 사용자</h2>
                    </div>
                    <p className="text-[12px] text-taupe-400 font-light mb-4">DAU 추이</p>
                    {(() => {
                      const dau = insights.customerActivity.dailyActiveUsers;
                      const display = dau.length <= 14 ? dau : dau.filter((_, i) => i % Math.ceil(dau.length / 14) === 0 || i === dau.length - 1);
                      const maxVal = Math.max(...display.map((d) => d.count), 1);
                      return (
                        <div className="flex items-end gap-[2px]" style={{ height: 60 }}>
                          {display.map((d, i) => (
                            <div key={i} className="flex flex-col items-center flex-1 gap-0.5 group relative">
                              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-noir-800 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                                {d.date.slice(5)}: {d.count}명
                              </div>
                              <div
                                className="w-full rounded-t-sm bg-[#2E7D5A]/50 group-hover:bg-[#2E7D5A] transition-colors"
                                style={{ height: Math.max(2, (d.count / maxVal) * 50) }}
                              />
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* 이벤트 유형 분석 */}
                  <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <MousePointerClick className="w-4 h-4 text-rose-500" />
                      <h2 className="text-[15px] font-medium text-noir-800">이벤트 분석</h2>
                    </div>
                    <div className="space-y-2">
                      {insights.customerActivity.eventBreakdown.slice(0, 8).map((e) => {
                        const total = insights.customerActivity.eventBreakdown.reduce((s, ev) => s + ev.count, 0);
                        const pct = total > 0 ? ((e.count / total) * 100) : 0;
                        const labels: Record<string, string> = {
                          page_view: "페이지 조회",
                          vendor_view: "업체 조회",
                          product_view: "상품 조회",
                          favorite_add: "즐겨찾기 추가",
                          favorite_remove: "즐겨찾기 삭제",
                          view_duration: "체류 시간",
                          click: "클릭",
                          booking_complete: "예약 완료",
                        };
                        return (
                          <div key={e.event_type}>
                            <div className="flex justify-between mb-1">
                              <span className="text-[12px] text-charcoal">{labels[e.event_type] ?? e.event_type}</span>
                              <span className="text-[11px] text-taupe-400">{e.count}건</span>
                            </div>
                            <div className="h-1.5 bg-ivory-warm rounded-full overflow-hidden">
                              <div className="h-full bg-rose-500/60 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 인기 페이지 */}
                  <div className="bg-white rounded-2xl border border-black/[0.04] p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Eye className="w-4 h-4 text-gold" />
                      <h2 className="text-[15px] font-medium text-noir-800">인기 페이지</h2>
                    </div>
                    <div className="space-y-2">
                      {insights.customerActivity.topPages.slice(0, 10).map((p, i) => {
                        return (
                          <div key={i} className="flex items-center justify-between py-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[11px] text-taupe-400 w-4 flex-shrink-0">{i + 1}</span>
                              <span className="text-[12px] text-noir-800 truncate">{p.path}</span>
                            </div>
                            <span className="text-[12px] text-taupe-400 flex-shrink-0 ml-2">{p.count}회</span>
                          </div>
                        );
                      })}
                      {insights.customerActivity.topPages.length === 0 && (
                        <p className="text-[13px] text-taupe-400 text-center py-4">페이지 데이터가 없습니다</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* 즐겨찾기 트렌드 */}
                <div className="bg-white rounded-2xl border border-black/[0.04] p-6 mb-8">
                  <div className="flex items-center gap-2 mb-1">
                    <Heart className="w-4 h-4 text-rose-500" />
                    <h2 className="text-[15px] font-medium text-noir-800">즐겨찾기 트렌드</h2>
                  </div>
                  <p className="text-[12px] text-taupe-400 font-light mb-4">일별 신규 즐겨찾기 추이</p>
                  {(() => {
                    const trend = insights.favoriteInsights.trend;
                    const display = trend.length <= 30 ? trend : trend.filter((_, i) => i % Math.ceil(trend.length / 30) === 0 || i === trend.length - 1);
                    const maxVal = Math.max(...display.map((d) => d.count), 1);
                    const total = trend.reduce((s, d) => s + d.count, 0);
                    return (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-[20px] font-semibold text-noir-800 font-display">{total}</span>
                          <span className="text-[12px] text-taupe-400">건 (기간 내)</span>
                        </div>
                        <div className="flex items-end gap-[2px]" style={{ height: 60 }}>
                          {display.map((d, i) => (
                            <div key={i} className="flex flex-col items-center flex-1 gap-0.5 group relative">
                              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-noir-800 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                                {d.date.slice(5)}: {d.count}건
                              </div>
                              <div
                                className={`w-full rounded-t-sm transition-colors ${d.count > 0 ? "bg-rose-500 group-hover:bg-rose-600" : "bg-rose-500/10"}`}
                                style={{ height: Math.max(2, (d.count / maxVal) * 50) }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </>
            ) : (
              <div className="text-center py-16">
                <p className="text-[14px] text-taupe-400">인사이트 데이터를 불러올 수 없습니다.</p>
              </div>
            )}
          </>
        )}

        {/* ===== 신고 관리 탭 ===== */}
        {activeTab === "reports" && (
          <>
            {/* 상단 카운트 */}
            <div className="grid grid-cols-4 gap-4 mb-6 max-md:grid-cols-2">
              {([
                { key: "pending" as const, label: "대기", cls: "text-gold" },
                { key: "reviewed" as const, label: "검토 중", cls: "text-rose-500" },
                { key: "resolved" as const, label: "처리됨", cls: "text-[#2E7D5A]" },
                { key: "dismissed" as const, label: "기각", cls: "text-noir-800" },
              ]).map((s) => (
                <div key={s.key} className="bg-white rounded-2xl p-6 border border-black/[0.04]">
                  <p className="text-sm text-taupe-500 mb-2">{s.label}</p>
                  <p className={`font-display text-3xl font-light ${s.cls}`}>
                    {reportCounts[s.key] ?? 0}
                  </p>
                </div>
              ))}
            </div>

            {/* 필터 */}
            <div className="flex gap-2 mb-6 flex-wrap">
              {([
                { key: "pending" as const, label: "대기" },
                { key: "reviewed" as const, label: "검토 중" },
                { key: "resolved" as const, label: "처리됨" },
                { key: "dismissed" as const, label: "기각" },
                { key: "all" as const, label: "전체" },
              ]).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => {
                    setReportFilter(f.key);
                    void loadReports(f.key);
                  }}
                  className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
                    reportFilter === f.key
                      ? "border-rose-500 bg-rose-500 text-white"
                      : "border-platinum text-taupe-500 hover:border-rose-500"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {reportLoading ? (
              <div className="bg-white rounded-2xl p-16 text-center">
                <Loader2 className="w-6 h-6 text-rose-500 animate-spin mx-auto" />
              </div>
            ) : reports.length === 0 ? (
              <div className="bg-white rounded-2xl p-16 text-center">
                <Flag className="w-10 h-10 text-taupe-400 mx-auto mb-3" />
                <p className="text-sm text-taupe-500">
                  {reportFilter === "pending"
                    ? "대기 중인 신고가 없습니다."
                    : "해당 상태의 신고가 없습니다."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {reports.map((r) => {
                  const isPost = !!r.post;
                  const isComment = !!r.comment;
                  const target = r.post ?? r.comment;
                  const targetTitle = r.post?.title ?? "댓글";
                  const targetPreview = (target?.content ?? "")
                    .replace(/<[^>]*>/g, "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 200);
                  const statusInfo = REPORT_STATUS_LABEL[r.status];
                  const linkHref = r.post
                    ? `/community/post/${r.post.id}`
                    : r.comment
                      ? `/community/post/${r.comment.post_id}#comment-${r.comment.id}`
                      : null;

                  return (
                    <div
                      key={r.id}
                      className="bg-white rounded-2xl p-5 border border-black/[0.04]"
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.cls}`}>
                            {statusInfo.text}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-noir-800/8 text-noir-800 font-medium">
                            {REPORT_REASON_LABEL[r.reason] ?? r.reason}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 font-medium">
                            {isPost ? "게시글" : isComment ? "댓글" : "—"}
                          </span>
                          {r.post?.under_review && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gold/15 text-gold font-medium">
                              자동 검토
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-taupe-400 shrink-0">
                          {new Date(r.created_at).toLocaleString("ko-KR")}
                        </span>
                      </div>

                      <div className="mb-3">
                        <p className="text-xs text-taupe-500 mb-1">
                          신고자: <span className="text-noir-800 font-medium">{r.reporter_nickname}</span>
                        </p>
                        {target ? (
                          <>
                            <p className="text-sm font-medium text-noir-800 mb-1 truncate">
                              {targetTitle}
                            </p>
                            <p className="text-xs text-taupe-500 line-clamp-2">
                              {targetPreview || "(내용 없음)"}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-taupe-400">
                            (대상이 삭제됐거나 접근 불가)
                          </p>
                        )}
                        {r.description && (
                          <p className="mt-2 text-xs text-taupe-500 italic">
                            추가 설명: {r.description}
                          </p>
                        )}
                      </div>

                      {/* 액션 그룹 1 — 신고 자체 처리 (보기 / 검토 / 처리 / 기각) */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {linkHref && (
                          <a
                            href={linkHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-platinum rounded-lg hover:border-rose-500 hover:text-rose-500 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            원본 보기
                          </a>
                        )}
                        {r.status !== "reviewed" && r.status !== "resolved" && (
                          <button
                            type="button"
                            onClick={() => updateReportStatus(r.id, "reviewed")}
                            disabled={reportActionId === r.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-rose-500 text-rose-500 rounded-lg hover:bg-rose-500 hover:text-white transition-colors disabled:opacity-50"
                          >
                            검토 중으로 표시
                          </button>
                        )}
                        {r.status !== "resolved" && (
                          <button
                            type="button"
                            onClick={() => updateReportStatus(r.id, "resolved")}
                            disabled={reportActionId === r.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#2E7D5A] text-white rounded-lg hover:bg-[#246548] transition-colors disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" />
                            처리됨으로 표시
                          </button>
                        )}
                        {r.status !== "dismissed" && (
                          <button
                            type="button"
                            onClick={() => updateReportStatus(r.id, "dismissed")}
                            disabled={reportActionId === r.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-platinum text-taupe-500 rounded-lg hover:border-noir-800 hover:text-noir-800 transition-colors disabled:opacity-50"
                          >
                            <X className="w-3.5 h-3.5" />
                            기각
                          </button>
                        )}
                      </div>

                      {/* 액션 그룹 2 — 게시글 자체 조치 (글이 살아있을 때만) */}
                      {r.post && (
                        <div className="mt-2 pt-2 border-t border-black/[0.04] flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] uppercase tracking-widest text-taupe-400 mr-1">
                            게시글 조치
                          </span>
                          {r.post.visibility !== "draft" && (
                            <button
                              type="button"
                              onClick={() => moderatePost(r.id, r.post!.id, "hide")}
                              disabled={reportActionId === r.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gold/40 text-gold rounded-lg hover:bg-gold hover:text-white hover:border-gold transition-colors disabled:opacity-50"
                              title="visibility를 draft로 변경 — 작성자 외 모두에게 숨김"
                            >
                              숨김 처리
                            </button>
                          )}
                          {r.post.visibility === "draft" && (
                            <button
                              type="button"
                              onClick={() => moderatePost(r.id, r.post!.id, "unhide")}
                              disabled={reportActionId === r.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#2E7D5A] text-[#2E7D5A] rounded-lg hover:bg-[#2E7D5A] hover:text-white transition-colors disabled:opacity-50"
                            >
                              공개 복원
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => moderatePost(r.id, r.post!.id, "delete")}
                            disabled={reportActionId === r.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-red-500 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition-colors disabled:opacity-50"
                          >
                            강제 삭제
                          </button>
                          <span className="text-[11px] text-taupe-400">
                            현재: {r.post.visibility === "draft" ? "숨김" : r.post.visibility}
                          </span>
                        </div>
                      )}

                      {reportActionId === r.id && (
                        <div className="mt-2">
                          <Loader2 className="w-4 h-4 text-rose-500 animate-spin" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ===== 정산 관리 탭 ===== */}
        {activeTab === "settlements" && (
          <>
            {(() => {
              const pendingCount = settlements.filter((s) => s.status === "pending").length;
              const completedCount = settlements.filter((s) => s.status === "completed").length;
              const totalAmount = settlements.filter((s) => s.status === "completed").reduce((sum, s) => sum + s.settleAmount, 0);
              const pendingAmount = settlements.filter((s) => s.status === "pending").reduce((sum, s) => sum + s.settleAmount, 0);
              const totalCommission = settlements.filter((s) => s.status === "completed").reduce((sum, s) => sum + s.commissionAmount, 0);

              const filteredSettlements = settlementFilter === "all" ? settlements : settlements.filter((s) => s.status === settlementFilter);

              const SETTLEMENT_STATUS: Record<string, { text: string; cls: string }> = {
                pending: { text: "대기", cls: "bg-gold/10 text-gold" },
                processing: { text: "처리 중", cls: "bg-blue-500/10 text-blue-600" },
                completed: { text: "완료", cls: "bg-[#2E7D5A]/10 text-[#2E7D5A]" },
                failed: { text: "실패", cls: "bg-red-500/10 text-red-500" },
              };

              return (
                <>
                  <div className="grid grid-cols-5 gap-4 mb-8 max-md:grid-cols-2">
                    {[
                      { label: "전체 정산", value: settlements.length, cls: "text-noir-800" },
                      { label: "대기 중", value: pendingCount, cls: "text-gold" },
                      { label: "완료", value: completedCount, cls: "text-[#2E7D5A]" },
                      { label: "정산 대기 금액", value: `${(pendingAmount / 10000).toFixed(0)}만원`, cls: "text-rose-500" },
                      { label: "총 수수료", value: `${(totalCommission / 10000).toFixed(0)}만원`, cls: "text-gold" },
                    ].map((s) => (
                      <div key={s.label} className="bg-white rounded-2xl p-6 border border-black/[0.04]">
                        <p className="text-sm text-taupe-500 mb-2">{s.label}</p>
                        <p className={`font-display text-2xl font-light ${s.cls}`}>{s.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2 mb-6">
                    {([
                      { key: "all", label: "전체" },
                      { key: "pending", label: "대기" },
                      { key: "completed", label: "완료" },
                    ]).map((f) => (
                      <button key={f.key} onClick={() => setSettlementFilter(f.key)}
                        className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                          settlementFilter === f.key ? "bg-noir-800 text-white" : "bg-white text-charcoal border border-black/[0.04] hover:border-noir-800"
                        }`}>{f.label}</button>
                    ))}
                  </div>

                  <div className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden">
                    {settlementLoading ? (
                      <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-6 h-6 text-taupe-400 animate-spin" />
                        <span className="ml-2 text-[14px] text-taupe-400">로딩 중...</span>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-platinum">
                              <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">업체</th>
                              <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">결제 금액</th>
                              <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">수수료</th>
                              <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">정산 금액</th>
                              <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">계좌</th>
                              <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">상태</th>
                              <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">생성일</th>
                              <th className="px-6 py-3 text-[12px] text-taupe-500 font-medium tracking-wider uppercase">액션</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredSettlements.map((s) => {
                              const st = SETTLEMENT_STATUS[s.status] ?? SETTLEMENT_STATUS.pending;
                              return (
                                <tr key={s.id} className="border-b border-black/[0.02] hover:bg-ivory-warm/50 transition-colors">
                                  <td className="px-6 py-4 text-sm text-noir-800 font-medium">{s.vendorName || "-"}</td>
                                  <td className="px-6 py-4 text-sm text-taupe-500">{s.totalAmount.toLocaleString()}원</td>
                                  <td className="px-6 py-4 text-sm text-rose-500">{s.commissionAmount.toLocaleString()}원 ({Math.round(s.commissionRate * 100)}%)</td>
                                  <td className="px-6 py-4 text-sm text-noir-800 font-medium">{s.settleAmount.toLocaleString()}원</td>
                                  <td className="px-6 py-4 text-sm text-taupe-500">
                                    {s.bankName ? `${s.bankName} ${s.accountNumber}` : <span className="text-taupe-400">미등록</span>}
                                  </td>
                                  <td className="px-6 py-4">
                                    <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${st.cls}`}>{st.text}</span>
                                  </td>
                                  <td className="px-6 py-4 text-sm text-taupe-500">{new Date(s.createdAt).toLocaleDateString("ko-KR")}</td>
                                  <td className="px-6 py-4">
                                    {(s.status === "pending" || s.status === "processing") && (
                                      <button
                                        onClick={() => handleProcessSettlement(s.id)}
                                        disabled={processingId === s.id}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#2E7D5A] text-white text-[12px] font-medium hover:bg-[#246B4C] transition-colors disabled:opacity-50"
                                      >
                                        {processingId === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                        정산 실행
                                      </button>
                                    )}
                                    {s.status === "completed" && (
                                      <span className="text-[12px] text-[#2E7D5A]">{s.settledAt ? new Date(s.settledAt).toLocaleDateString("ko-KR") : "완료"}</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {filteredSettlements.length === 0 && !settlementLoading && (
                              <tr><td colSpan={8} className="px-6 py-12 text-center text-taupe-400 text-sm">정산 내역이 없습니다.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </>
        )}

        {/* ===== 관리자 관리 탭 ===== */}
        {activeTab === "admins" && (
          <>
            <div className="grid grid-cols-2 gap-6 max-md:grid-cols-1">
              {/* 관리자 추가 폼 */}
              <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
                <h2 className="font-serif-kr text-lg font-normal mb-1">새 관리자 추가</h2>
                <p className="text-[12px] text-taupe-400 mb-6">기존 관리자만 새 관리자 계정을 생성할 수 있습니다.</p>
                <form onSubmit={handleCreateAdmin} className="space-y-4">
                  <div>
                    <label className="block text-[12px] text-taupe-500 mb-1.5">이름</label>
                    <input
                      type="text"
                      value={newAdminName}
                      onChange={(e) => { setNewAdminName(e.target.value); setCreateAdminError(""); }}
                      placeholder="관리자 이름"
                      className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] text-taupe-500 mb-1.5">이메일 <span className="text-rose-500">*</span></label>
                    <input
                      type="email"
                      value={newAdminEmail}
                      onChange={(e) => { setNewAdminEmail(e.target.value); setCreateAdminError(""); }}
                      placeholder="admin@hanbang.ai"
                      className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] text-taupe-500 mb-1.5">비밀번호 <span className="text-rose-500">*</span></label>
                    <input
                      type="password"
                      value={newAdminPassword}
                      onChange={(e) => { setNewAdminPassword(e.target.value); setCreateAdminError(""); }}
                      placeholder="6자 이상"
                      className="w-full px-4 py-3 border border-platinum rounded-xl text-[14px] outline-none focus:border-rose-500 transition-colors"
                      required
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-[12px] text-gold font-medium mb-1.5">
                      <Shield className="w-3.5 h-3.5" /> 관리자 인증 비밀번호 <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="password"
                      value={adminSetupPw}
                      onChange={(e) => { setAdminSetupPw(e.target.value); setCreateAdminError(""); }}
                      placeholder="ADMIN_PASSWORD"
                      className="w-full px-4 py-3 border border-gold/30 bg-gold/[0.02] rounded-xl text-[14px] outline-none focus:border-gold transition-colors"
                      required
                    />
                  </div>

                  {createAdminError && (
                    <p className="text-[12px] text-red-500 px-1">{createAdminError}</p>
                  )}
                  {createAdminSuccess && (
                    <p className="text-[12px] text-[#2E7D5A] px-1">{createAdminSuccess}</p>
                  )}

                  <button
                    type="submit"
                    disabled={createAdminLoading}
                    className="w-full py-3 rounded-xl bg-noir-800 text-white text-[14px] font-medium hover:bg-noir-900 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {createAdminLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    {createAdminLoading ? "생성 중..." : "관리자 계정 생성"}
                  </button>
                </form>
              </div>

              {/* 관리자 목록 */}
              <div className="bg-white rounded-2xl p-8 border border-black/[0.04]">
                <h2 className="font-serif-kr text-lg font-normal mb-1">관리자 목록</h2>
                <p className="text-[12px] text-taupe-400 mb-6">현재 등록된 관리자 계정입니다.</p>
                {adminListLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 text-taupe-400 animate-spin" />
                    <span className="ml-2 text-[14px] text-taupe-400">로딩 중...</span>
                  </div>
                ) : adminUsers.length === 0 ? (
                  <p className="text-center text-taupe-400 text-sm py-12">등록된 관리자가 없습니다.</p>
                ) : (
                  <div className="space-y-3">
                    {adminUsers.map((admin) => (
                      <div key={admin.id} className="flex items-center gap-4 p-4 rounded-xl bg-ivory-50 border border-black/[0.02]">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gold to-rose-500 flex items-center justify-center flex-shrink-0">
                          <Shield className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] text-noir-800 font-medium truncate">{admin.name || "관리자"}</p>
                          <p className="text-[12px] text-taupe-400 truncate">{admin.email}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[11px] text-taupe-400">{formatDate(admin.createdAt)}</p>
                          {admin.email === adminEmail && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gold/10 text-gold font-medium">나</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
