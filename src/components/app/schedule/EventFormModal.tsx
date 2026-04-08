"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, CalendarDays } from "lucide-react";
import type { ScheduleEvent } from "@/types/database.types";

const CATEGORY_OPTIONS = [
  { key: "", label: "카테고리 선택 (선택사항)" },
  { key: "general", label: "일반 (모임, 상담 등)" },
  { key: "meeting", label: "상견례" },
  { key: "venue", label: "예식장" },
  { key: "studio", label: "스튜디오" },
  { key: "dress", label: "드레스/턱시도" },
  { key: "makeup", label: "메이크업" },
  { key: "ring", label: "예물(반지)" },
  { key: "hanbok", label: "한복" },
  { key: "yedan", label: "예단" },
  { key: "honeymoon", label: "신혼여행" },
  { key: "houseware", label: "혼수(가전/가구)" },
  { key: "housing", label: "신혼집" },
  { key: "invitation", label: "청첩장" },
  { key: "snap", label: "본식 스냅/영상" },
  { key: "shoes", label: "웨딩 구두" },
  { key: "bouquet", label: "부케/꽃장식" },
  { key: "gift", label: "답례품" },
  { key: "mc", label: "사회/축가" },
  { key: "ham", label: "함" },
  { key: "pyebaek", label: "폐백" },
];

interface Props {
  isOpen: boolean;
  mode: "add" | "edit";
  event: ScheduleEvent | null;
  defaultDate: string | null;
  onSave: (data: {
    date: string;
    title: string;
    memo?: string;
    categoryKey?: string;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export default function EventFormModal({
  isOpen,
  mode,
  event,
  defaultDate,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [memo, setMemo] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (!isOpen) return;
    if (mode === "edit" && event) {
      setTitle(event.title);
      setDate(event.date);
      setMemo(event.memo ?? "");
      setCategoryKey(event.categoryKey ?? "");
    } else {
      setTitle("");
      setDate(defaultDate ?? "");
      setMemo("");
      setCategoryKey("");
    }
  }, [isOpen, mode, event, defaultDate]);

  const handleSubmit = async () => {
    if (!title.trim() || !date) return;
    setSaving(true);
    try {
      await onSave({
        date,
        title: title.trim(),
        memo: memo.trim() || undefined,
        categoryKey: categoryKey || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 z-50"
          />

          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.97 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-x-4 top-[15%] max-w-[540px] mx-auto bg-white rounded-2xl shadow-xl z-50 overflow-hidden"
          >
            {/* 헤더 */}
            <div className="px-6 pt-6 pb-4 border-b border-black/[0.04]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#C9A96E]/20 to-[#C4967E]/20 flex items-center justify-center">
                    <CalendarDays className="w-5 h-5 text-[#C9A96E]" />
                  </div>
                  <h3 className="text-[23px] font-medium text-[#1A1A1F]">
                    {mode === "edit" ? "일정 수정" : "일정 추가"}
                  </h3>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-[#FAF8F5] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 폼 */}
            <div className="px-6 py-5 flex flex-col gap-4">
              {/* 제목 */}
              <div>
                <label className="block text-[23px] text-[#928980] mb-1.5">
                  제목 <span className="text-[#C4967E]">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 드레스 피팅, 친구들과 청첩장 모임, 혼수 쇼핑"
                  className="w-full px-4 py-3 rounded-xl border border-black/[0.08] text-[21px] text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#C4967E] focus:ring-1 focus:ring-[#C4967E]/30 transition-colors"
                />
              </div>

              {/* 날짜 */}
              <div>
                <label className="block text-[23px] text-[#928980] mb-1.5">
                  날짜 <span className="text-[#C4967E]">*</span>
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-black/[0.08] text-[21px] text-[#1A1A1F] focus:outline-none focus:border-[#C4967E] focus:ring-1 focus:ring-[#C4967E]/30 transition-colors"
                />
              </div>

              {/* 메모 */}
              <div>
                <label className="block text-[23px] text-[#928980] mb-1.5">
                  메모
                </label>
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="예: 강남 드레스샵 오후 2시, 참석자: 지은, 수현"
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl border border-black/[0.08] text-[21px] text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#C4967E] focus:ring-1 focus:ring-[#C4967E]/30 transition-colors resize-none"
                />
              </div>

              {/* 카테고리 */}
              <div>
                <label className="block text-[23px] text-[#928980] mb-1.5">
                  관련 카테고리
                </label>
                <select
                  value={categoryKey}
                  onChange={(e) => setCategoryKey(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-black/[0.08] text-[21px] text-[#1A1A1F] focus:outline-none focus:border-[#C4967E] focus:ring-1 focus:ring-[#C4967E]/30 transition-colors bg-white"
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 하단 버튼 */}
            <div className="px-6 py-4 border-t border-black/[0.04] bg-[#FDFCFA] flex items-center justify-between">
              {mode === "edit" && onDelete ? (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-1.5 text-[23px] text-red-400 hover:text-red-500 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {deleting ? "삭제중..." : "삭제"}
                </button>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl text-[21px] text-[#928980] hover:bg-[#FAF8F5] transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving || !title.trim() || !date}
                  className="px-5 py-2.5 rounded-xl text-[21px] font-medium text-white bg-gradient-to-r from-[#C4967E] to-[#C9A96E] hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving
                    ? "저장중..."
                    : mode === "edit"
                    ? "수정"
                    : "추가"}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
