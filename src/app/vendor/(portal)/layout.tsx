"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useVendorStore } from "@/stores/vendorStore";
import VendorSidebar from "@/components/vendor/VendorSidebar";
import VendorTopNav from "@/components/vendor/VendorTopNav";
import { Clock, XCircle, FileEdit } from "lucide-react";

export default function VendorPortalLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { vendor, isLoading, isInitialized, initialize } = useVendorStore();
  const pathname = usePathname();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!isInitialized || isLoading) {
    return (
      <div className="min-h-screen bg-ivory-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[14px] text-taupe-500">업체 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="min-h-screen bg-ivory-50 flex items-center justify-center px-5">
        <div className="bg-white rounded-2xl p-10 max-w-md w-full text-center border border-black/[0.04]">
          <h2 className="font-serif-kr text-[20px] text-noir-800 mb-3">등록된 업체가 없습니다</h2>
          <p className="text-[14px] text-taupe-500 mb-6">업체를 먼저 등록해주세요.</p>
          <a href="/vendor/register" className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-noir-800 text-white text-[14px] font-medium hover:bg-noir-soft transition-colors">
            업체 등록하기
          </a>
        </div>
      </div>
    );
  }

  // 프로필 페이지는 모든 상태에서 접근 허용 (정보 수정 가능)
  const isProfilePage = pathname === "/vendor/profile";

  // 심사 대기 중
  if (vendor.status === "pending" && !isProfilePage) {
    return (
      <div className="min-h-screen bg-ivory-50 flex items-center justify-center px-5">
        <div className="bg-white rounded-2xl p-10 max-w-md w-full text-center border border-black/[0.04]">
          <div className="w-16 h-16 bg-gold/10 rounded-full flex items-center justify-center mx-auto mb-5">
            <Clock className="w-8 h-8 text-gold" />
          </div>
          <h2 className="font-serif-kr text-[20px] text-noir-800 mb-3">심사 진행 중입니다</h2>
          <p className="text-[14px] text-taupe-500 mb-2">업체 등록 신청이 접수되었습니다.</p>
          <p className="text-[13px] text-taupe-400 mb-8">
            심사는 영업일 기준 1~3일 소요됩니다.<br />
            승인되면 이메일로 안내드리겠습니다.
          </p>
          <div className="flex flex-col gap-3">
            <a
              href="/vendor/profile"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-noir-800 text-white text-[14px] font-medium hover:bg-noir-soft transition-colors"
            >
              <FileEdit className="w-4 h-4" />
              프로필 미리보기 / 수정
            </a>
            <a
              href="/"
              className="text-[13px] text-taupe-400 hover:text-rose-500 transition-colors"
            >
              ← 홈으로 돌아가기
            </a>
          </div>
        </div>
      </div>
    );
  }

  // 반려됨
  if (vendor.status === "rejected" && !isProfilePage) {
    return (
      <div className="min-h-screen bg-ivory-50 flex items-center justify-center px-5">
        <div className="bg-white rounded-2xl p-10 max-w-md w-full text-center border border-black/[0.04]">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="font-serif-kr text-[20px] text-noir-800 mb-3">업체 등록이 반려되었습니다</h2>
          {(() => {
            const reason = (vendor as unknown as Record<string, string>).rejectionReason;
            return reason ? (
              <div className="text-left bg-red-50 rounded-xl p-4 mb-4 border-l-3 border-red-400">
                <p className="text-[12px] text-taupe-400 mb-1">반려 사유</p>
                <p className="text-[13px] text-noir-800 leading-relaxed">{reason}</p>
              </div>
            ) : null;
          })()}
          <p className="text-[14px] text-taupe-500 mb-8">
            프로필 정보를 수정하신 후 다시 심사를 요청하실 수 있습니다.
          </p>
          <div className="flex flex-col gap-3">
            <a
              href="/vendor/profile"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-noir-800 text-white text-[14px] font-medium hover:bg-noir-soft transition-colors"
            >
              <FileEdit className="w-4 h-4" />
              프로필 수정하기
            </a>
            <a
              href="/"
              className="text-[13px] text-taupe-400 hover:text-rose-500 transition-colors"
            >
              ← 홈으로 돌아가기
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ivory-50">
      <VendorSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="md:ml-[260px]">
        <VendorTopNav onMenuToggle={() => setSidebarOpen(true)} status={vendor.status} />
        <main className="p-8 max-md:p-5">{children}</main>
      </div>
    </div>
  );
}
