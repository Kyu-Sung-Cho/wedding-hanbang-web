"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ban, Check, RotateCcw } from "lucide-react";

import { CHECKLIST_MAP } from "@/constants/checklists";
import { useAuthStore } from "@/stores/authStore";
import type { ChecklistItem, ProgressItem } from "@/types/database.types";
import { calculateStatus, getChecklistCounts, mergeChecklist } from "@/utils/checklist";

export default function ChecklistCategoryTasks({ categoryKey }: { categoryKey: string }) {
  const { journey, updateJourney } = useAuthStore();
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const savingRef = useRef(false);

  const template = CHECKLIST_MAP[categoryKey];
  const progress = useMemo(
    () => (journey?.progress ?? {}) as Record<string, ProgressItem>,
    [journey?.progress],
  );
  const existing = progress[categoryKey];
  const mergedChecklist = useMemo(
    () => template
      ? mergeChecklist(template.items, existing?.checklist, existing?.status)
      : [],
    [existing?.checklist, existing?.status, template],
  );
  const [checklist, setChecklist] = useState<ChecklistItem[]>(mergedChecklist);
  const canonicalChecklistRef = useRef(mergedChecklist);
  useEffect(() => {
    canonicalChecklistRef.current = mergedChecklist;
    setChecklist(mergedChecklist);
  }, [mergedChecklist]);
  const isNotApplicable = existing?.status === "not_applicable";
  const { done, total } = getChecklistCounts(checklist);
  const percent = !isNotApplicable && total > 0 ? Math.round((done / total) * 100) : 0;
  const isSaving = savingCategory || savingItemId !== null;

  const saveChecklist = useCallback(async (
    nextChecklist: ChecklistItem[],
    itemId: string,
  ) => {
    if (savingRef.current || !template || isNotApplicable) return;
    savingRef.current = true;
    setChecklist(nextChecklist);

    const nextProgress: Record<string, ProgressItem> = {
      ...progress,
      [categoryKey]: {
        ...(existing ?? { category: categoryKey }),
        category: categoryKey,
        status: calculateStatus(nextChecklist),
        checklist: nextChecklist,
      },
    };

    setSavingItemId(itemId);
    setError("");
    setNotice("");
    try {
      const result = await updateJourney({ progress: nextProgress });
      if (result.status === "pending_partner") {
        setChecklist(canonicalChecklistRef.current);
        setNotice("상대방에게 확인 요청을 보냈어요. 두 분이 확인하면 체크 상태가 반영돼요.");
      } else {
        setNotice("체크 상태를 저장했어요.");
      }
    } catch (saveError) {
      // 요청 중 파트너·아모라가 같은 분야를 갱신했을 수 있다. 요청 시작 시점의
      // 스냅샷이 아니라 가장 최근 store 정본으로 돌아가야 다음 저장이 최신 체크를 보존한다.
      setChecklist(canonicalChecklistRef.current);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "체크 상태를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      savingRef.current = false;
      setSavingItemId(null);
    }
  }, [categoryKey, existing, isNotApplicable, progress, template, updateJourney]);

  const toggleItem = useCallback((itemId: string) => {
    const nextChecklist = checklist.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item,
    );
    void saveChecklist(nextChecklist, itemId);
  }, [checklist, saveChecklist]);

  const toggleNotApplicable = useCallback(async () => {
    if (savingRef.current || !template) return;
    savingRef.current = true;
    const nextStatus = isNotApplicable ? calculateStatus(checklist) : "not_applicable";
    const nextProgress: Record<string, ProgressItem> = {
      ...progress,
      [categoryKey]: {
        ...(existing ?? { category: categoryKey }),
        category: categoryKey,
        status: nextStatus,
        checklist,
      },
    };

    setSavingCategory(true);
    setError("");
    setNotice("");
    try {
      const result = await updateJourney({ progress: nextProgress });
      if (result.status === "pending_partner") {
        setNotice("상대방에게 확인 요청을 보냈어요. 승인 전에는 현재 상태가 유지돼요.");
      } else {
        setNotice(
          isNotApplicable
            ? "다시 준비 목록에 넣었어요. 이전 체크 상태도 그대로 남아 있어요."
            : "이 분야를 전체 진행률과 기본 일정 알림에서 제외했어요.",
        );
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "분야 상태를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      savingRef.current = false;
      setSavingCategory(false);
    }
  }, [categoryKey, checklist, existing, isNotApplicable, progress, template, updateJourney]);

  if (!template) return null;

  return (
    <section id="checklist-tasks" aria-labelledby="checklist-tasks-heading" className="scroll-mt-24">
      <div className="flex flex-col gap-4 border-b border-[#e5dece] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.12em] text-[#9d6f36]">SAVE YOUR PROGRESS</p>
          <h2 id="checklist-tasks-heading" className="mt-1.5 text-[23px] font-semibold text-[#172a27]">
            실제로 확인할 것
          </h2>
          <p className="mt-1 text-[13px] leading-6 text-[#65706d]">
            {isNotApplicable ? "우리 준비에서는 제외한 분야예요." : `${done}/${total}개 완료`}
          </p>
        </div>
        <strong className="text-[30px] font-semibold leading-none text-[#36534e]">
          {isNotApplicable ? "제외됨" : `${percent}%`}
        </strong>
      </div>

      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-[#eee8dc]"
        role="progressbar"
        aria-label={`${template.label} 완료율`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className="h-full rounded-full bg-[#36534e] transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      {isNotApplicable && (
        <div className="mt-5 flex gap-3 rounded-[16px] border border-[#d9d4ca] bg-[#f7f5f0] px-4 py-3.5">
          <Ban className="mt-0.5 h-5 w-5 shrink-0 text-[#77736b]" />
          <p className="text-[13px] leading-6 text-[#5f625f]">
            진행률과 기본 일정 알림에서만 제외했어요. 이전에 체크한 내용은 지우지 않았습니다.
          </p>
        </div>
      )}

      <ul className="mt-5 divide-y divide-[#e9e3d8] border-y border-[#e9e3d8]">
        {checklist.map((item) => (
          <li key={item.id}>
            <label className={`group flex min-h-[62px] items-start gap-3 px-1 py-3.5 ${
              isNotApplicable ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            }`}>
              <input
                type="checkbox"
                checked={item.done}
                disabled={isSaving || isNotApplicable}
                onChange={() => toggleItem(item.id)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[#c9a96e]/60 peer-focus-visible:ring-offset-2 ${
                  item.done
                    ? "border-[#36534e] bg-[#36534e] text-white"
                    : "border-[#aaa497] bg-white text-transparent group-hover:border-[#36534e]"
                }`}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
              <span className={`min-w-0 flex-1 text-[15px] leading-6 ${
                item.done ? "text-[#8b8d88] line-through" : "text-[#243832]"
              }`}>
                {item.label}
              </span>
              {savingItemId === item.id && (
                <span className="shrink-0 pt-0.5 text-[11px] font-medium text-[#8f857b]">저장 중</span>
              )}
            </label>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => void toggleNotApplicable()}
        disabled={isSaving}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-[#d9d1c2] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#5f625f] transition-colors hover:border-[#8d877c] hover:bg-[#f8f6f0] disabled:cursor-wait disabled:opacity-50"
      >
        {isNotApplicable ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
        {isNotApplicable ? "다시 준비 목록에 넣기" : "우리에게는 필요 없는 준비예요"}
      </button>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-[#e3bcbc] bg-[#fff7f6] px-4 py-3 text-[13px] leading-6 text-[#8c3e3e]">
          {error}
        </p>
      )}
      <p className="mt-4 min-h-6 text-[12.5px] leading-6 text-[#5d746d]" role="status" aria-live="polite">
        {notice || (isSaving ? "변경 내용을 안전하게 저장하고 있어요." : "")}
      </p>
    </section>
  );
}
