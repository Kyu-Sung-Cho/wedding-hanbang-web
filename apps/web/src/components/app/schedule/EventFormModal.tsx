"use client";

import { useState, useEffect, useId } from "react";
import { X, Trash2, CalendarDays } from "lucide-react";
import { useAccessibleDialog } from "@/hooks/useAccessibleDialog";
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
  const [error, setError] = useState("");
  const titleId = useId();
  const titleInputId = useId();
  const dateInputId = useId();
  const memoInputId = useId();
  const categoryInputId = useId();
  const { dialogRef } = useAccessibleDialog({ isOpen, onClose });

  useEffect(() => {
    if (!isOpen) return;
    setError("");
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
    setError("");
    try {
      await onSave({
        date,
        title: title.trim(),
        memo: memo.trim() || undefined,
        categoryKey: categoryKey || undefined,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "일정을 저장하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    setError("");
    try {
      await onDelete();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "일정을 삭제하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 bg-[#1A1A1F]/40 backdrop-blur-sm z-50 animate-fade-in"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed inset-x-4 top-[12%] max-w-[480px] mx-auto bg-white rounded-xl shadow-[0_20px_60px_rgb(0,0,0,0.15)] z-50 overflow-hidden animate-fade-in"
      >
        {/* 헤더 */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#795252]/10 flex items-center justify-center">
                <CalendarDays className="w-5 h-5 text-[#795252]" />
              </div>
              <h3 id={titleId} className="font-serif-kr text-2xl font-light text-[#1A1A1F]">
                {mode === "edit" ? "일정 수정" : "일정 추가"}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="일정 창 닫기"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-[#F6F3F2] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 폼 */}
        <div className="px-6 py-4 flex flex-col gap-4">
          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          {/* 제목 */}
          <div>
            <label htmlFor={titleInputId} className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5">
              제목 <span className="text-[#795252]">*</span>
            </label>
            <input
              id={titleInputId}
              data-dialog-initial-focus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 드레스 피팅, 친구들과 청첩장 모임"
              className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
            />
          </div>

          {/* 날짜 */}
          <div>
            <label htmlFor={dateInputId} className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5">
              날짜 <span className="text-[#795252]">*</span>
            </label>
            <input
              id={dateInputId}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
            />
          </div>

          {/* 메모 */}
          <div>
            <label htmlFor={memoInputId} className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5">
              메모
            </label>
            <textarea
              id={memoInputId}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="예: 강남 드레스샵 오후 2시, 참석자 지은/수현"
              rows={2}
              className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all resize-none"
            />
          </div>

          {/* 카테고리 */}
          <div>
            <label htmlFor={categoryInputId} className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5">
              관련 카테고리
            </label>
            <select
              id={categoryInputId}
              value={categoryKey}
              onChange={(e) => setCategoryKey(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
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
        <div className="px-6 py-4 bg-[#FAFAF8] flex items-center justify-between">
          {mode === "edit" && onDelete ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-500 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              {deleting ? "삭제중..." : "삭제"}
            </button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-base text-[#504444] hover:bg-[#F6F3F2] transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving || !title.trim() || !date}
              className="px-5 py-2.5 rounded-xl text-base font-medium text-white bg-[#795252] hover:bg-[#946a6a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_16px_rgb(121,82,82,0.2)]"
            >
              {saving
                ? "저장중..."
                : mode === "edit"
                ? "수정"
                : "추가"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
