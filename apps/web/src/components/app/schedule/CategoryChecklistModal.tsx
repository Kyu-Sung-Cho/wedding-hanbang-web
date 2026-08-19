"use client";

import { useState, useEffect, useCallback, useMemo, useId, useRef } from "react";
import {
  X,
  Check,
  Circle,
  Lightbulb,
  Building2,
  Camera,
  Shirt,
  Palette,
  Gem,
  Flower2,
  Plane,
  Home,
  Mail,
  Gift,
  Users,
  Video,
  Package,
  Sparkles,
  Flower,
  Heart,
  Mic,
  Box,
  Key,
  BookOpen,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { mergeChecklist, calculateStatus, getChecklistCounts } from "@/utils/checklist";
import { stripPlanningChecklistNotes } from "@hanbang/shared/utils";
import { useAuthStore } from "@/stores/authStore";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { guideLinkForCategory } from "@/lib/etiquette/guideLink";
import ChecklistItemText from "@/components/app/checklist/ChecklistItemText";
import type { ChecklistItem, ProgressItem } from "@/types/database.types";

const ICON_MAP: Record<string, React.ElementType> = {
  Building2,
  Camera,
  Shirt,
  Palette,
  Gem,
  Flower2,
  Plane,
  Home,
  Mail,
  Gift,
  Users,
  Video,
  Package,
  Sparkles,
  Flower,
  Heart,
  Mic,
  Box,
  Key,
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-sage-500",
  in_progress: "bg-[#795252]",
  not_started: "bg-[#B5ADA3]",
  not_applicable: "bg-[#8b857c]",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "완료",
  in_progress: "진행중",
  not_started: "시작전",
  not_applicable: "해당 없음",
};

interface Props {
  categoryKey: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function CategoryChecklistModal({ categoryKey, isOpen, onClose }: Props) {
  const { journey, updateJourney } = useAuthStore();
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const template = CHECKLIST_MAP[categoryKey];
  const progress = useMemo(() => journey?.progress ?? {}, [journey?.progress]);
  const existing = progress[categoryKey] as ProgressItem | undefined;

  useEffect(() => {
    if (!isOpen || !template) return;
    const timer = window.setTimeout(() => {
      const merged = mergeChecklist(template.items, existing?.checklist, existing?.status);
      setChecklist(merged);
      setError("");
      setNotice("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, categoryKey, template, existing?.checklist, existing?.status]);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen]);

  const toggleItem = useCallback(
    async (itemId: string) => {
      if (saving) return;

      const updated = checklist.map((c) =>
        c.id === itemId ? { ...c, done: !c.done } : c
      );
      setChecklist(updated);

      const newStatus = calculateStatus(updated);
      const newProgress: Record<string, ProgressItem> = {
        ...progress,
        [categoryKey]: {
          ...(existing ?? { category: categoryKey }),
          category: categoryKey,
          status: newStatus,
          checklist: stripPlanningChecklistNotes(updated),
        },
      };

      setSaving(true);
      setError("");
      setNotice("");
      try {
        const result = await updateJourney({ progress: newProgress });
        if (result.status === "pending_partner") {
          setChecklist(checklist);
          setNotice("상대방에게 확인을 요청했어요. 두 분이 확인하면 체크 상태에 반영돼요.");
        } else {
          setNotice("체크 상태를 저장했어요.");
        }
      } catch (saveError) {
        setChecklist(checklist);
        setError(
          saveError instanceof Error
            ? saveError.message
            : "체크리스트를 저장하지 못했습니다.",
        );
      } finally {
        setSaving(false);
      }
    },
    [checklist, saving, progress, categoryKey, existing, updateJourney]
  );

  const isNotApplicable = existing?.status === "not_applicable";

  // 우리 결혼에는 해당 없는 항목(함·폐백·예단 등)을 끄고 켠다.
  // 끄면 진행률 분모와 마감 알림에서 빠져 "영구 미완료"로 남지 않는다.
  const toggleNotApplicable = async () => {
    if (saving) return;
    const nextStatus = isNotApplicable ? calculateStatus(checklist) : "not_applicable";
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateJourney({
        progress: {
          ...progress,
          [categoryKey]: {
            ...(existing ?? { category: categoryKey }),
            category: categoryKey,
            status: nextStatus,
            checklist: stripPlanningChecklistNotes(checklist),
          },
        } as Record<string, ProgressItem>,
      });
      setNotice(
        result.status === "pending_partner"
          ? "상대방에게 확인을 요청했어요. 두 분이 확인하면 상태가 바뀌어요."
          : isNotApplicable
            ? "다시 준비 목록에 넣었어요. 이전 체크 상태는 그대로 남아 있어요."
            : "이 분야를 진행률과 마감 알림에서 제외했어요.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "체크리스트 상태를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!template || !isOpen) return null;

  const Icon = ICON_MAP[template.icon] ?? Circle;
  const { done, total } = getChecklistCounts(checklist);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const status = calculateStatus(checklist);
  // 출처 계약을 통과한 /manners를 먼저 쓰고, 없으면 레거시 25파트로 내려간다.
  // 이 폴백으로 19개 카테고리가 전부 안내를 갖게 됐다(이전에는 10개).
  const relatedGuide = guideLinkForCategory(categoryKey);

  return (
    <>
      {/* 오버레이 */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 bg-[#1A1A1F]/40 backdrop-blur-sm z-50 animate-fade-in"
      />

      {/* 모달 */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed inset-x-4 top-[8%] max-w-[520px] mx-auto bg-white rounded-xl shadow-[0_20px_60px_rgb(0,0,0,0.15)] z-50 max-h-[84vh] flex flex-col overflow-hidden animate-fade-in"
      >
        {/* 헤더 */}
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#795252]/10 flex items-center justify-center">
                <Icon className="w-5 h-5 text-[#795252]" />
              </div>
              <div>
                <h3 id={titleId} className="text-2xl font-semibold text-[#1A1A1F]">{template.label}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-sm px-2 py-0.5 rounded-full text-white font-medium ${STATUS_COLORS[isNotApplicable ? "not_applicable" : status]}`}>
                    {STATUS_LABELS[isNotApplicable ? "not_applicable" : status]}
                  </span>
                  <span className="text-sm text-[#B5ADA3]">
                    {isNotApplicable ? "진행률에서 제외됨" : `${done}/${total} 완료`}
                  </span>
                </div>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label={`${template.label} 체크리스트 닫기`}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-[#F6F3F2] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 진행률 바 */}
          <div
            className="w-full h-2 bg-[#F6F3F2] rounded-full overflow-hidden"
            role="progressbar"
            aria-label={`${template.label} 완료율`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={isNotApplicable ? 0 : percent}
          >
            <div
              className="h-full bg-gradient-to-r from-[#795252] to-[#946a6a] rounded-full transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-sm text-[#B5ADA3] mt-1.5 text-right">{percent}% 달성</p>

          {/* 가족·지역마다 하는 항목이 달라서, 안 하는 건 안 한다고 말할 수 있어야 한다. */}
          <button
            type="button"
            onClick={toggleNotApplicable}
            disabled={saving}
            className="mt-4 w-full rounded-xl border border-[#EDEAE4] bg-white px-4 py-3 text-left text-sm text-[#5f5a52] transition-colors hover:bg-[#FAF8F5] disabled:opacity-50"
          >
            {isNotApplicable ? (
              <>
                <span className="font-medium text-[#1A1A1F]">다시 준비 목록에 넣기</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-[#8b857c]">
                  지금은 진행률과 마감 알림에서 빠져 있어요.
                </span>
              </>
            ) : (
              <>
                <span className="font-medium text-[#1A1A1F]">우리는 이건 안 해요</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-[#8b857c]">
                  진행률과 마감 알림에서 빼드릴게요. 언제든 되돌릴 수 있어요.
                </span>
              </>
            )}
          </button>
        </div>

        {/* 체크리스트 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 bg-[#FAFAF8]">
          <div className="flex flex-col gap-1">
            {checklist.map((item) => (
              <button
                type="button"
                role="checkbox"
                aria-checked={item.done}
                aria-labelledby={`${titleId}-${item.id}-label`}
                aria-describedby={item.note ? `${titleId}-${item.id}-note` : undefined}
                disabled={saving || isNotApplicable}
                key={item.id}
                onClick={() => toggleItem(item.id)}
                className="flex w-full items-center gap-3 rounded-xl bg-white px-3 py-3 text-left transition-colors hover:bg-[#F6F3F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A96E]/50 disabled:cursor-not-allowed disabled:opacity-55 group"
              >
                <div className="flex-shrink-0">
                  {item.done ? (
                    <div className="w-6 h-6 rounded-full bg-[#795252] flex items-center justify-center">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full border-2 border-[#B5ADA3] group-hover:border-[#795252] transition-colors" />
                  )}
                </div>
                {/*
                  항목이 무엇을 할지(label)와 그 일에서 놓치기 쉬운 것(note)을 함께 보인다.
                  note가 없는 항목이 대부분이라 있을 때만 그린다 — 빈 줄을 만들지 않는다.
                  완료한 항목에서도 note는 지우지 않는다. 체크를 되돌릴지 판단할 때 필요하다.

                  note를 체크박스 이름에 섞으면 스크린 리더가 항목마다 두 문장을 읽는다.
                  이름은 label로 못박고 note는 설명(aria-describedby)으로 넘긴다.
                */}
                <ChecklistItemText
                  item={item}
                  idPrefix={`${titleId}-${item.id}`}
                  labelClassName={`text-[17px] leading-snug ${
                    item.done ? "text-[#B5ADA3] line-through" : "text-[#504444]"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* 팁 */}
        <div className="px-6 py-4 bg-white border-t border-[#F6F3F2]">
          {error && (
            <p
              role="alert"
              className="mb-3 rounded-lg border border-[#E5B8B8] bg-[#FFF6F6] px-3 py-2 text-sm leading-5 text-[#8C3E3E]"
            >
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="mb-3 rounded-lg border border-[#d9e2d3] bg-[#f6faf4] px-3 py-2 text-sm leading-5 text-[#506747]">
              {notice}
            </p>
          )}
          <div className="flex items-start gap-2.5">
            <Lightbulb className="w-5 h-5 text-[#C9A96E] flex-shrink-0 mt-0.5" />
            <p className="text-base text-[#504444] font-light leading-relaxed">
              {template.tip}
            </p>
          </div>

          <Link
            {...weddingLinkProps(relatedGuide ? relatedGuide.href : "/chat")}
            className="mt-3 flex items-center gap-2.5 rounded-xl bg-[#F6F3F2] px-3 py-3 transition-colors hover:bg-[#795252]/5 group"
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#36534E]">
              <BookOpen className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-[#1A1A1F]">
                {relatedGuide ? relatedGuide.title : "아모라에게 물어보기"}
              </p>
              <p className="text-sm text-[#B5ADA3]">
                {relatedGuide ? "관련 예절 가이드를 읽고 준비 기준 맞추기" : "우리 상황에 맞는 준비 순서 정리하기"}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-[#B5ADA3] transition-colors group-hover:text-[#795252]" />
          </Link>
          <p className="sr-only" aria-live="polite">{saving ? "체크리스트 저장 중" : ""}</p>
        </div>
      </div>
    </>
  );
}
