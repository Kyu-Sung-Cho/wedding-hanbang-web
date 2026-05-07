"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { X, Maximize2, Wallet } from "lucide-react";
import BudgetContent from "@/components/app/budget/BudgetContent";

interface BudgetSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 커뮤니티 위에 떠 있는 예산 관리 오버레이.
 * BudgetContent를 embedded 모드로 렌더 — 풀페이지와 같은 컴포넌트, 같은 데이터.
 */
export default function BudgetSidePanel({ isOpen, onClose }: BudgetSidePanelProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // body 스크롤 잠금
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  // ESC 닫기
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex justify-end animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="예산 관리"
    >
      {/* 배경 디머 */}
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 bg-black/35 backdrop-blur-sm"
      />

      {/* 패널 */}
      <div className="relative w-full max-w-4xl bg-[#fcf9f8] shadow-2xl flex flex-col h-full">
        {/* 헤더 */}
        <header className="shrink-0 flex items-center justify-between px-4 sm:px-5 py-3 border-b border-[#F0EFED] bg-white">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center text-white shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
            <h2 className="font-serif-kr text-lg sm:text-xl text-[#1A1A1F] truncate">
              예산 관리
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/budget"
              onClick={onClose}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#795252] bg-[#fcf9f8] border border-[#F0EFED] hover:border-[#795252] hover:bg-white transition-colors"
              title="전체 페이지로 열기"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              전체 페이지
            </Link>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-[#928980] hover:text-[#1A1A1F] hover:bg-[#F6F3F2] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* 콘텐츠 */}
        <div className="flex-1 overflow-y-auto">
          <BudgetContent embedded />
        </div>
      </div>
    </div>,
    document.body
  );
}
