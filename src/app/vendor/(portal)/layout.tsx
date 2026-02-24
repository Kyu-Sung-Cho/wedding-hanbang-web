"use client";

import { useState, useEffect } from "react";
import { useVendorStore } from "@/stores/vendorStore";
import VendorSidebar from "@/components/vendor/VendorSidebar";
import VendorTopNav from "@/components/vendor/VendorTopNav";

export default function VendorPortalLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { vendor, isLoading, isInitialized, initialize } = useVendorStore();

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
