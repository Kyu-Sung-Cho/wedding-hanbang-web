"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Store,
  Package,
  Clock,
  CalendarCheck,
  MessageSquare,
  BarChart3,
  Users,
  Settings,
  X,
  LogOut,
} from "lucide-react";
import Logo from "@/components/ui/Logo";
import { useVendorStore } from "@/stores/vendorStore";

import { Shield } from "lucide-react";

const menuItems = [
  { href: "/vendor/dashboard", icon: LayoutDashboard, label: "대시보드" },
  { href: "/vendor/profile", icon: Store, label: "업체 프로필" },
  { href: "/vendor/products", icon: Package, label: "상품 관리" },
  { href: "/vendor/timeslots", icon: Clock, label: "타임슬롯 관리" },
  { href: "/vendor/bookings", icon: CalendarCheck, label: "예약 현황" },
  { href: "/vendor/messages", icon: MessageSquare, label: "메시지" },
  { href: "/vendor/staff", icon: Users, label: "스태프" },
  { href: "/vendor/analytics", icon: BarChart3, label: "분석" },
  { href: "/vendor/settings", icon: Settings, label: "설정" },
];

interface VendorSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function VendorSidebar({ isOpen, onClose }: VendorSidebarProps) {
  const pathname = usePathname();
  const { vendor } = useVendorStore();

  return (
    <>
      {/* 모바일 오버레이 */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 bottom-0 w-[260px] bg-white border-r border-black/[0.06] z-50 flex flex-col transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "max-md:-translate-x-full"
        }`}
      >
        {/* 로고 & 닫기 */}
        <div className="h-[72px] flex items-center justify-between px-6 border-b border-black/[0.04]">
          <Link href="/vendor/dashboard" className="flex items-center gap-2.5">
            <Logo size="sm" showText={false} />
            <div>
              <span className="font-serif-kr text-[15px] font-medium text-noir-800">웨딩한방</span>
              <span className="block text-[10px] text-rose-500 font-medium tracking-wider">PARTNER</span>
            </div>
          </Link>
          <button onClick={onClose} className="md:hidden p-1.5 rounded-lg hover:bg-ivory-warm transition-colors">
            <X className="w-5 h-5 text-taupe-400" />
          </button>
        </div>

        {/* 메뉴 */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {/* 관리자 모드 링크 */}
          {vendor?.id === "admin" && (
            <Link
              href="/admin"
              onClick={onClose}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-[14px] transition-colors bg-rose-500/10 text-rose-600 hover:bg-rose-500/15 font-medium mb-2"
            >
              <Shield className="w-[18px] h-[18px] text-rose-500" />
              관리자 대시보드
            </Link>
          )}
          {menuItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-[14px] transition-colors ${
                  isActive
                    ? "bg-noir-800 text-white font-medium"
                    : "text-charcoal hover:bg-ivory-warm"
                }`}
              >
                <item.icon className={`w-[18px] h-[18px] ${isActive ? "text-rose-light" : "text-taupe-400"}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* 업체 정보 */}
        <div className="border-t border-black/[0.04] p-4">
          <div className="flex items-center gap-3 px-2 mb-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-500 to-gold flex items-center justify-center flex-shrink-0">
              <Store className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-noir-800 truncate">{vendor?.name ?? "업체"}</p>
              <p className="text-[11px] text-taupe-400">{vendor?.category ?? ""} · {vendor?.location ?? ""}</p>
            </div>
          </div>
          <button className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] text-taupe-400 hover:text-red-400 hover:bg-red-50 transition-colors">
            <LogOut className="w-3.5 h-3.5" />
            로그아웃
          </button>
        </div>
      </aside>
    </>
  );
}
