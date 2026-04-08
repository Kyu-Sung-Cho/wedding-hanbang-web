"use client";

import { usePathname } from "next/navigation";
import { Menu, Bell, Shield, ShieldCheck, ShieldX } from "lucide-react";

const pageTitles: Record<string, string> = {
  "/vendor/dashboard": "대시보드",
  "/vendor/profile": "업체 프로필",
  "/vendor/products": "상품 관리",
  "/vendor/timeslots": "타임슬롯 관리",
  "/vendor/bookings": "예약 현황",
  "/vendor/settings": "설정",
};

interface VendorTopNavProps {
  onMenuToggle: () => void;
  status?: "pending" | "approved" | "rejected";
  isAdmin?: boolean;
}

export default function VendorTopNav({ onMenuToggle, status = "approved", isAdmin = false }: VendorTopNavProps) {
  const pathname = usePathname();
  const title = pageTitles[pathname] || "업체 포털";

  const statusConfig = {
    pending: { label: "심사중", icon: Shield, color: "bg-taupe-400/10 text-taupe-500", dot: "bg-taupe-400" },
    approved: { label: "승인됨", icon: ShieldCheck, color: "bg-[#2E7D5A]/10 text-[#2E7D5A]", dot: "bg-[#2E7D5A]" },
    rejected: { label: "반려됨", icon: ShieldX, color: "bg-red-500/10 text-red-500", dot: "bg-red-500" },
  };

  const s = statusConfig[status];

  return (
    <header className="sticky top-0 z-30 h-[81px] bg-white/90 backdrop-blur-[12px] border-b border-black/[0.04] flex items-center justify-between px-8 max-md:px-4">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuToggle}
          className="md:hidden p-2 rounded-lg hover:bg-ivory-warm transition-colors"
        >
          <Menu className="w-5 h-5 text-charcoal" />
        </button>
        <h1 className="font-serif-kr text-[23px] font-normal text-noir-800">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        {/* 관리자 모드 배지 */}
        {isAdmin ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[23px] font-medium bg-rose-500/10 text-rose-600">
            <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            <Shield className="w-3.5 h-3.5" />
            관리자
          </div>
        ) : (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[23px] font-medium ${s.color}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${s.dot} ${status === "pending" ? "animate-pulse" : ""}`} />
            <s.icon className="w-3.5 h-3.5" />
            {s.label}
          </div>
        )}

        {/* 알림 */}
        <button className="relative p-2 rounded-lg hover:bg-ivory-warm transition-colors">
          <Bell className="w-5 h-5 text-charcoal" />
          <div className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full" />
        </button>
      </div>
    </header>
  );
}
