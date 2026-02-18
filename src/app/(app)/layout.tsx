"use client";

import { useState } from "react";
import Sidebar from "@/components/app/Sidebar";
import TopNav from "@/components/app/TopNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-ivory-50">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="md:ml-[260px]">
        <TopNav onMenuToggle={() => setSidebarOpen(true)} />
        <main className="p-8 max-md:p-5">{children}</main>
      </div>
    </div>
  );
}
