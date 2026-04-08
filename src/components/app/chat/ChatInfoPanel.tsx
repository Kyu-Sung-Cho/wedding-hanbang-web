"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Wallet, CheckCircle2, CalendarClock } from "lucide-react";
import BudgetTab from "./panel/BudgetTab";
import ChecklistTab from "./panel/ChecklistTab";
import UpcomingTab from "./panel/UpcomingTab";

type Tab = "budget" | "checklist" | "upcoming";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "budget", label: "예산", icon: Wallet },
  { key: "checklist", label: "체크리스트", icon: CheckCircle2 },
  { key: "upcoming", label: "임박 일정", icon: CalendarClock },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChatInfoPanel({ isOpen, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("checklist");

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 배경 오버레이 (모바일만) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/20 z-40 md:hidden"
            onClick={onClose}
          />

          {/* 데스크톱: 오른쪽 슬라이드 */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed right-0 top-[77px] w-[405px] h-[calc(100vh-77px)] bg-white border-l border-black/[0.06] shadow-[-8px_0_40px_rgba(0,0,0,0.06)] z-50 flex flex-col max-md:hidden"
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-black/[0.04]">
              <h3 className="text-[21px] font-medium text-noir-800">결혼 준비 현황</h3>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-taupe-400 hover:bg-ivory-50 hover:text-noir-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 탭 바 */}
            <div className="flex border-b border-black/[0.04]">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[21px] font-medium transition-colors relative ${
                    activeTab === tab.key
                      ? "text-rose-500"
                      : "text-taupe-400 hover:text-taupe-500"
                  }`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {activeTab === tab.key && (
                    <motion.div
                      layoutId="panel-tab-indicator"
                      className="absolute bottom-0 left-2 right-2 h-0.5 bg-rose-500 rounded-full"
                    />
                  )}
                </button>
              ))}
            </div>

            {/* 탭 내용 */}
            <div className="flex-1 overflow-hidden">
              {activeTab === "budget" && <BudgetTab />}
              {activeTab === "checklist" && <ChecklistTab />}
              {activeTab === "upcoming" && <UpcomingTab />}
            </div>
          </motion.div>

          {/* 모바일: 하단 시트 */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 h-[85vh] bg-white rounded-t-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.08)] z-50 flex flex-col md:hidden"
          >
            {/* 핸들 바 */}
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-taupe-400/30" />
            </div>

            {/* 헤더 */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-black/[0.04]">
              <h3 className="text-[21px] font-medium text-noir-800">결혼 준비 현황</h3>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-taupe-400 hover:bg-ivory-50 hover:text-noir-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 탭 바 */}
            <div className="flex border-b border-black/[0.04]">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[21px] font-medium transition-colors relative ${
                    activeTab === tab.key
                      ? "text-rose-500"
                      : "text-taupe-400 hover:text-taupe-500"
                  }`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {activeTab === tab.key && (
                    <motion.div
                      layoutId="panel-tab-indicator-mobile"
                      className="absolute bottom-0 left-2 right-2 h-0.5 bg-rose-500 rounded-full"
                    />
                  )}
                </button>
              ))}
            </div>

            {/* 탭 내용 */}
            <div className="flex-1 overflow-hidden">
              {activeTab === "budget" && <BudgetTab />}
              {activeTab === "checklist" && <ChecklistTab />}
              {activeTab === "upcoming" && <UpcomingTab />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
