"use client";

import { useState } from "react";
import VendorSidebar from "@/components/vendor/VendorSidebar";
import VendorTopNav from "@/components/vendor/VendorTopNav";

export default function VendorPortalLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-ivory-50">
      <VendorSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="md:ml-[260px]">
        <VendorTopNav onMenuToggle={() => setSidebarOpen(true)} status="approved" />
        <main className="p-8 max-md:p-5">{children}</main>
      </div>
    </div>
  );
}
