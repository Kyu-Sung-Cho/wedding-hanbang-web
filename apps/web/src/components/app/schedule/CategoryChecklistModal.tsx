"use client";

import { useState, useEffect, useCallback, useMemo, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X, Check, Sparkle, BookOpen } from "lucide-react";
import Link from "next/link";
import { CHECKLIST_MAP } from "@/constants/checklists";
import {
  checklistItemTag,
  groupChecklistItems,
  labelWithoutConditionSuffix,
  type ChecklistItemTag,
} from "@hanbang/shared/constants";
import { mergeChecklist, calculateStatus, getChecklistCounts, isStatusDeclared, resolveStatus } from "@/utils/checklist";
import { useAccessibleModal } from "@/hooks/useAccessibleModal";
import { stripPlanningChecklistNotes } from "@hanbang/shared/utils";
import { useAuthStore } from "@/stores/authStore";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { buildAmoraPreparationHref } from "@/lib/amora/preparationHandoff";
import { guideLinkForCategory } from "@/lib/etiquette/guideLink";
import ChecklistItemSource, { checklistSourceLabel } from "@/components/app/checklist/ChecklistItemSource";
import ChecklistItemText from "@/components/app/checklist/ChecklistItemText";
import AmoraMark from "@/components/ui/AmoraMark";
import { AMORA_ACTION_CLASS, AMORA_ICON_ACTION_CLASS } from "@/components/ui/amoraActionStyles";
import type { ChecklistItem, ProgressItem } from "@/types/database.types";

// ⚠️ 분야 아이콘 표를 2026-09-04에 지웠다. 시안 여덟 장의 모달 제목은 **글자뿐**이고,
// 아이콘 18px + 간격 8px 이 긴 분야 이름(「혼인신고와 주소·보험 신고」)의 자리를 먹었다.
// 목록도 분야명과 진행수로 구분하며, 아이콘은 예절·아모라 보조 행동에만 쓴다.

// ⚠️ 상태별 칩 색 표를 2026-09-04에 지웠다. 시안 네 장이 상태와 무관하게
// **같은 베이지 칩**을 쓴다 — 상태는 글자로만 말한다. 색을 되살리면 머리에
// 장미(고리)·초록(완료)·검정(진행 중)이 한꺼번에 서서 고리가 안 읽힌다.

const STATUS_LABELS: Record<string, string> = {
  completed: "완료",
  in_progress: "진행 중",
  not_started: "시작 전",
  not_applicable: "해당 없음",
};

/**
 * 항목 옆에 붙는 작은 표시. 세 가지뿐이고 **서로 달라 보여야 한다.**
 *
 * 시안은 셋에 같은 CSS 클래스(`must-tag`)를 썼지만 뜻은 갈린다 — 「다음 할 일」은
 * 진행 상태고 나머지 둘은 항목의 성격이다. 그래서 진행 상태만 채운 장미색으로
 * 두고, 성격 표시 둘은 연한 바탕에 글자색으로 구분한다.
 *
 * 「중요 확인」은 법적 의무 표시가 아니다. 항목의 성격은 정본
 * `CHECKLIST_ITEM_TAGS`에서만 읽고 여기서 조건이나 우선순위를 추가하지 않는다.
 */
function ItemTag({ kind }: { kind: ChecklistItemTag | "다음 할 일" }) {
  // 시안의 `.must-tag` 는 「중요 확인」과 「다음 할 일」이 같은 모양이고(연한 장미 바탕 +
  // 진한 장미 글자), 「해당 시」만 베이지다. 진행 상태를 채운 색으로 뒤집었더니
  // 목록에서 그 한 줄만 튀어 시안과 다르게 보였다.
  const style = kind === "해당 시"
    ? "bg-[var(--color-surface-low)] text-[var(--hb-text-body)]"
    : "bg-[var(--color-rose-pale)] text-[var(--color-rose-700)]";
  return (
    <span className={`flex-shrink-0 rounded-full px-[7px] py-[2px] text-[11px] font-bold ${style}`}>
      {kind}
    </span>
  );
}

interface Props {
  categoryKey: string;
  isOpen: boolean;
  onClose: () => void;
  presentation?: "default" | "planning";
}

function checklistOwnerKey() {
  const state = useAuthStore.getState();
  return JSON.stringify([
    state.isDemo, state.user?.id, state.profile?.id, state.profile?.couple_id, state.profile?.role,
    state.couple?.id, state.couple?.bride_id, state.couple?.groom_id,
    state.journey?.couple_id, state.journey?.id,
  ]);
}

export default function CategoryChecklistModal(props: Props) {
  // 예산 화면과 같은 관찰 방식으로, React가 한 번에 그린 A→B→A도 별도 세대로 구분한다.
  const [owner] = useState(() => {
    let snapshot = { key: checklistOwnerKey(), epoch: 0 };
    const getSnapshot = () => {
      const key = checklistOwnerKey();
      if (key !== snapshot.key) snapshot = { key, epoch: snapshot.epoch + 1 };
      return snapshot;
    };
    return {
      getSnapshot,
      subscribe: (notify: () => void) => useAuthStore.subscribe(() => {
        const previous = snapshot;
        if (getSnapshot() !== previous) notify();
      }),
    };
  });
  const binding = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const isCurrentOwner = useCallback(() => owner.getSnapshot() === binding, [owner, binding]);
  return <ScopedCategoryChecklistModal {...props} key={`${binding.key}:${binding.epoch}:${props.categoryKey}:${props.isOpen}`}
    isCurrentOwner={isCurrentOwner} />;
}

function ScopedCategoryChecklistModal({ categoryKey, isOpen, onClose, presentation = "default", isCurrentOwner }: Props & { isCurrentOwner: () => boolean }) {
  const isPlanning = presentation === "planning";
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);
  const planningDialogRef = useAccessibleModal({
    open: isPlanning && isOpen && portalReady,
    onClose,
    initialFocusSelector: "[data-planning-close]",
    respectExistingScrollLock: true,
  });
  const { journey, updateJourney } = useAuthStore();
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [listSource, setListSource] = useState<{ checklist: ChecklistItem[] | undefined; status: ProgressItem["status"] | undefined } | null>(null);
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
  const checklistReady = listSource !== null && listSource.checklist === existing?.checklist && listSource.status === existing?.status;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!isOpen || !template) return;
    const timer = window.setTimeout(() => {
      if (!mounted.current || !isCurrentOwner()) return;
      const merged = mergeChecklist(template.items, existing?.checklist, existing?.status);
      setChecklist(merged);
      setListSource({ checklist: existing?.checklist, status: existing?.status });
      setError("");
      setNotice("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, categoryKey, template, existing?.checklist, existing?.status, isCurrentOwner]);

  useEffect(() => {
    if (!isOpen || isPlanning) return;
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
  }, [isOpen, isPlanning]);

  const toggleItem = useCallback(
    async (itemId: string) => {
      if (saving || !checklistReady || !mounted.current || !isCurrentOwner()
        || useAuthStore.getState().journey?.progress !== progress) return;

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
        if (!mounted.current || !isCurrentOwner()) return;
        if (result.status === "pending_partner") {
          if (useAuthStore.getState().journey?.progress?.[categoryKey] !== existing) return;
          setChecklist(checklist);
          setNotice("상대방에게 확인을 요청했어요. 두 분이 확인하면 체크 상태에 반영돼요.");
        } else {
          setNotice("체크 상태를 저장했어요.");
        }
      } catch (saveError) {
        if (!mounted.current || !isCurrentOwner()
          || useAuthStore.getState().journey?.progress?.[categoryKey] !== existing) return;
        setChecklist(checklist);
        setError(
          saveError instanceof Error
            ? saveError.message
            : "체크리스트를 저장하지 못했습니다.",
        );
      } finally {
        if (mounted.current && isCurrentOwner()) setSaving(false);
      }
    },
    [checklist, checklistReady, saving, progress, categoryKey, existing, updateJourney, isCurrentOwner]
  );

  const isNotApplicable = existing?.status === "not_applicable";

  // 우리 결혼에는 해당 없는 항목(함·폐백·예단 등)을 끄고 켠다.
  // 끄면 진행률 분모와 마감 알림에서 빠져 "영구 미완료"로 남지 않는다.
  const toggleNotApplicable = async () => {
    if (saving || !checklistReady || !mounted.current || !isCurrentOwner()
      || useAuthStore.getState().journey?.progress !== progress) return;
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
      if (!mounted.current || !isCurrentOwner()) return;
      setNotice(
        result.status === "pending_partner"
          ? "상대방에게 확인을 요청했어요. 두 분이 확인하면 상태가 바뀌어요."
          : isNotApplicable
            ? "다시 준비 목록에 넣었어요. 이전 체크 상태는 그대로 남아 있어요."
            : "이 분야를 진행률과 마감 알림에서 제외했어요.",
      );
    } catch (saveError) {
      if (!mounted.current || !isCurrentOwner()) return;
      setError(
        saveError instanceof Error
          ? saveError.message
          : "체크리스트 상태를 저장하지 못했습니다.",
      );
    } finally {
      if (mounted.current && isCurrentOwner()) setSaving(false);
    }
  };

  if (!template || !isOpen) return null;

  const { done, total } = getChecklistCounts(checklist);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const declared = isPlanning && isStatusDeclared(existing);
  const status = declared ? resolveStatus(template.items, existing) : calculateStatus(checklist);
  // 출처 계약을 통과한 /manners를 먼저 쓰고, 없으면 레거시 25파트로 내려간다.
  // 이 폴백으로 19개 카테고리가 전부 안내를 갖게 됐다(이전에는 10개).
  const relatedGuide = guideLinkForCategory(categoryKey);

  /**
   * 항목을 단계로 묶는다. 묶는 규칙과 왜 정본 배열 순서와 다를 수 있는지는
   * `packages/shared/src/constants/checklistGroups.ts` 머리말에 있다.
   */
  const groups = groupChecklistItems(categoryKey, checklist);

  /**
   * 「다음 할 일」이 붙는 항목 — **단계 순서로** 처음 만나는 미완료 항목 하나.
   *
   * `checklist` 배열이 아니라 `groups` 를 훑는 이유는 결혼식장 때문이다. 그 분야는
   * 단계 순서와 배열 순서가 달라서, 배열에서 먼저 나오는 항목이 화면에서는 아래에
   * 있을 수 있다. 그러면 표식이 목록 중간에 뜬금없이 앉는다.
   *
   * 분야를 껐으면 아무것도 가리키지 않는다 — 진행률에서 뺀 분야에 다음 할 일이
   * 있다고 말하는 것은 앞뒤가 안 맞는다.
   */
  /**
   * 근거 칩을 그릴 항목 id.
   *
   * 같은 편을 가리키는 항목이 여럿이면 화면에 똑같은 줄이 여러 번 선다 — 결혼식장이
   * 셋이었고 시안은 한 번만 그린다. 자료(`noteSources`)를 지우면 그 항목의 근거가
   * 없어지므로 **자료는 두고 표시만** 첫 항목 하나로 줄인다.
   *
   * 그리면서 걸러내지 않고 **미리 계산한다.** 렌더 중에 그릇을 채우면 React 컴파일러가
   * 그 그릇을 캐시해 두 번째 렌더부터 전부 걸러 버린다(2026-09-04에 칩이 전멸했다).
   */
  const sourceChipItemIds = new Set<string>();
  {
    const seen = new Set<string>();
    for (const group of groups) {
      for (const item of group.items) {
        const label = checklistSourceLabel(item.id);
        if (!label || seen.has(label)) continue;
        seen.add(label);
        sourceChipItemIds.add(item.id);
      }
    }
  }

  const nextItemId = isNotApplicable || (declared && status === "completed")
    ? undefined
    : groups.flatMap((group) => group.items).find((item) => !item.done)?.id;
  const desktopHeight = categoryKey === "venue" || categoryKey === "greeting"
    ? "md:max-h-[min(760px,calc(100dvh-60px))]"
    : "md:max-h-[min(900px,calc(100dvh-60px))]";

  const amoraHref = buildAmoraPreparationHref({ kind: "checklist", categoryKey });
  const content = (
    <>
      {/* 오버레이 */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 z-50 bg-[rgba(38,37,31,0.55)] animate-fade-in"
      />

      {/* 모달 */}
      <div
        ref={isPlanning ? planningDialogRef : dialogRef}
        data-planning-sheet={isPlanning ? "" : undefined}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={isPlanning
          ? `fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] flex-col overflow-hidden rounded-t-[22px] bg-white shadow-[0_40px_80px_-20px_rgba(0,0,0,0.35)] md:inset-x-7 md:bottom-auto md:top-1/2 ${desktopHeight} md:w-[min(860px,calc(100vw-56px))] md:-translate-y-1/2 md:rounded-[20px]`
          : "fixed inset-x-4 top-1/2 z-50 mx-auto flex max-h-[84dvh] -translate-y-1/2 flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_40px_80px_-20px_rgba(0,0,0,0.35)] animate-fade-in sm:max-w-[860px]"}
      >
        {isPlanning && <div aria-hidden="true" className="mx-auto mt-[10px] mb-[14px] h-1 w-[38px] shrink-0 rounded-full bg-[var(--amora-line)] md:hidden" />}
        {/* 헤더 */}
        <div className={isPlanning ? "shrink-0 border-b border-[var(--amora-line)] px-5 pb-4 md:px-7 md:pt-6 md:pb-[18px]" : "border-b border-[#E5DDC9] px-7 pt-6 pb-[18px]"}>
          <div className={`flex items-center justify-between ${isPlanning ? "gap-1" : "mb-4"}`}>
            <div className={`flex min-w-0 items-center ${isPlanning ? "gap-[13px] md:gap-4" : "gap-4"}`}>
              {/*
                진행률 고리. 예전에는 제목 아래 가로 막대와 「N% 달성」 한 줄이었는데,
                시안은 그 둘을 제목 **왼쪽 고리 하나**로 합쳤다 — 머리에서 세로 두 줄이
                줄어 항목이 그만큼 먼저 보인다.

                SVG 고리에 실제 항목 완료율을 표시한다. 분야를 껐으면(`not_applicable`) 비율을
                0으로 그린다 — 진행률에서 빠져 있다는 말과 고리가 어긋나면 안 된다.

                `role="progressbar"` 는 막대에서 여기로 **옮겨온 것**이다. 지우면
                `CategoryChecklistModal.a11y.test.ts` 가 잡는다.
              */}
              <div
                role="progressbar"
                aria-label={`${template.label} 완료율`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={isNotApplicable || declared ? undefined : percent}
                aria-valuetext={isNotApplicable ? "진행률에서 제외됨" : declared ? "분야 상태로 표시함 · 항목은 확인 전" : undefined}
                className={`relative flex flex-shrink-0 items-center justify-center rounded-full ${isPlanning ? "h-[46px] w-[46px] md:h-[52px] md:w-[52px]" : "h-[52px] w-[52px]"}`}
              >
                <svg viewBox="0 0 52 52" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
                  <circle cx="26" cy="26" r="23" fill="none" stroke="var(--color-surface-low)" strokeWidth="6" />
                  <circle cx="26" cy="26" r="23" fill="none" stroke="var(--color-rose-500)" strokeWidth="6" pathLength="100" strokeDasharray={`${isNotApplicable || declared ? 0 : percent} 100`} />
                </svg>
                <span className={`relative flex items-center justify-center rounded-full bg-white text-[12px] font-bold text-[var(--hb-text-strong)] tabular-nums ${isPlanning ? "h-9 w-9 md:h-10 md:w-10" : "h-10 w-10"}`}>
                  {isNotApplicable || declared ? "—" : `${percent}%`}
                </span>
              </div>
              <div className="min-w-0">
                <h2 id={titleId} className={isPlanning ? `${categoryKey === "registration" ? "text-[16.5px] leading-[1.3]" : "text-[17px] leading-[1.4]"} font-semibold text-[var(--amora-ink)] md:text-[19px]` : "truncate text-[19px] font-semibold text-[var(--hb-text-strong)]"}>
                  {template.label}
                </h2>
                <div className={`mt-1 flex flex-wrap items-center gap-2 text-[var(--hb-text-muted)] ${isPlanning ? "text-[11.5px] md:text-[12.5px]" : "text-[12.5px]"}`}>
                  <span className="rounded-full bg-[var(--color-surface-low)] px-[9px] py-[3px] text-[11px] font-semibold text-[var(--hb-text-body)]">
                    {STATUS_LABELS[isNotApplicable ? "not_applicable" : status]}
                  </span>
                  <span>
                    {isNotApplicable ? "진행률에서 제외됨" : declared ? "분야 상태로 표시함 · 항목은 확인 전" : `${done}/${total} 완료 · ${percent}%`}
                  </span>
                </div>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              data-planning-close={isPlanning ? "" : undefined}
              type="button"
              onClick={onClose}
              aria-label={`${template.label} 체크리스트 닫기`}
              className={isPlanning ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--amora-muted)] transition-colors hover:bg-[var(--amora-low)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--amora-accent)]" : "flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-low)] text-[var(--hb-text-muted)] transition-colors hover:bg-[#E5DDC9]"}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>


        </div>

        {/* 체크리스트 */}
        <div data-planning-body={isPlanning ? "" : undefined} className={isPlanning ? "min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-5 pt-1 pb-5 md:px-7 md:pt-1.5" : "flex-1 overflow-y-auto bg-white px-7 pt-1.5 pb-5"}>
          {groups.map((group) => {
            const groupDone = group.items.filter((item) => item.done).length;
            return (
              <section key={group.title || "all"} className={isPlanning ? "mt-4 md:mt-[18px]" : "mt-[18px]"}>
                {/*
                  단계 머리. 「01 · 예약 전에」와 그 단계의 개수만 있다.

                  이름이 빈 분야는 머리를 아예 안 그린다 — `groupChecklistItems` 가
                  단계 정의가 없을 때 이름 없는 한 덩어리를 돌려준다. 그때 빈 줄이
                  생기면 그 분야만 위가 벌어진 것처럼 보인다.
                */}
                {group.title ? (
                  <div className="flex items-center justify-between gap-3 py-1.5">
                    <h3 className={`font-bold text-[var(--color-rose-700)] ${isPlanning ? "text-[12px] md:text-[12.5px]" : "text-[12.5px]"}`}>
                      {group.title}
                    </h3>
                    <span className={`shrink-0 text-[var(--hb-text-muted)] tabular-nums ${isPlanning ? "text-[12px]" : "text-[11.5px]"}`}>
                      {groupDone}/{group.items.length}
                    </span>
                  </div>
                ) : null}

                {group.items.map((item, index) => {
                  const tag = checklistItemTag(item.id);
                  const itemAmoraHref = template.items.some(canonical => canonical.id === item.id)
                    ? buildAmoraPreparationHref({ kind: "checklist", categoryKey, itemId: item.id })
                    : null;
                  const isNext = item.id === nextItemId;
                  // 「해당 시」 표시가 붙는 항목은 라벨 끝의 `(해당하는 경우)` 를 뗀다.
                  // 표시가 그 말을 대신하므로 두면 같은 말이 두 번 보인다. **표시할
                  // 때만** 자르고 정본 라벨은 건드리지 않는다.
                  const shown = tag === "해당 시"
                    ? { ...item, label: labelWithoutConditionSuffix(item.label) }
                    : item;

                  return (
                    // 근거 링크는 체크박스 **밖**에 둔다. 버튼 안에 링크를 넣으면 잘못된
                    // 마크업이고, 누를 때 무엇이 실행될지도 애매해진다.
                    <div
                      key={item.id}
                      className={`flex flex-col ${
                        index === group.items.length - 1
                          ? ""
                          : "border-b border-[#E5DDC9]"
                      }`}
                    >
                      <div className="flex items-start gap-1">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={item.done}
                        aria-labelledby={`${titleId}-${item.id}-label`}
                        aria-describedby={item.note ? (isPlanning && item.done ? undefined : `${titleId}-${item.id}-note`) : undefined}
                        disabled={saving || !checklistReady || isNotApplicable}
                        onClick={() => toggleItem(item.id)}
                        className={`group flex min-h-11 min-w-0 flex-1 items-start rounded-[6px] text-left transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] disabled:cursor-not-allowed disabled:opacity-55 ${isPlanning ? "gap-[11px] px-0.5 py-[13px] md:gap-3 md:px-1 md:pt-3 md:pb-2" : "gap-3 px-1 pt-3 pb-2"}`}
                      >
                        {/*
                          동그라미 셋이 서로 다른 말을 한다 — 끝난 것(초록·체크),
                          다음에 할 것(장미 테두리·연한 바탕), 아직인 것(가는 테두리).
                          가운데 것이 없으면 스무 줄이 전부 똑같아 보여 어디부터
                          손대야 할지가 화면에 없다.
                        */}
                        <span className="mt-px flex-shrink-0">
                          {item.done ? (
                            <span className={`flex items-center justify-center rounded-full bg-[var(--color-sage-500)] ${isPlanning ? "h-[22px] w-[22px] md:h-5 md:w-5" : "h-5 w-5"}`}>
                              <Check className="h-3 w-3 text-white" strokeWidth={1.7} />
                            </span>
                          ) : (
                            <span
                              className={`block rounded-full border-[1.8px] transition-colors ${isPlanning ? "h-[22px] w-[22px] md:h-5 md:w-5" : "h-5 w-5"} ${
                                isNext
                                  ? "border-[var(--color-rose-500)] bg-[var(--color-rose-pale)]"
                                  : isPlanning ? "border-[var(--hb-text-muted)]" : "border-[#E5DDC9] group-hover:border-[var(--hb-text-muted)]"
                              }`}
                            />
                          )}
                        </span>
                        {/*
                          항목이 무엇을 할지(label)와 그 일에서 놓치기 쉬운 것(note)을 함께 보인다.
                          note가 없는 항목이 대부분이라 있을 때만 그린다 — 빈 줄을 만들지 않는다.
                          완료한 항목에서도 note는 지우지 않는다. 체크를 되돌릴지 판단할 때 필요하다.

                          note를 체크박스 이름에 섞으면 스크린 리더가 항목마다 두 문장을 읽는다.
                          이름은 label로 못박고 note는 설명(aria-describedby)으로 넘긴다.
                        */}
                        <ChecklistItemText
                          item={shown}
                          accessibleLabel={isPlanning ? item.label : undefined}
                          idPrefix={`${titleId}-${item.id}`}
                          labelClassName={`text-[14px] font-medium leading-snug ${
                            item.done
                              ? "text-[var(--hb-text-muted)] line-through decoration-[#E5DDC9]"
                              : isNext
                                ? "font-semibold text-[var(--hb-text-strong)]"
                                : "text-[var(--hb-text-strong)]"
                          }`}
                          labelSuffix={isPlanning && isNext && tag ? (
                            <span className="inline-flex flex-wrap gap-1"><ItemTag kind="다음 할 일" /><ItemTag kind={tag} /></span>
                          ) : isNext ? <ItemTag kind="다음 할 일" /> : tag ? <ItemTag kind={tag} /> : undefined}
                          // 시안 `.item-desc` — 12.5px / 행간 1.6 / 위 6px / 최대 560px.
                          noteClassName={`mt-1.5 block max-w-[560px] text-[12.5px] leading-[1.6] ${isPlanning ? "text-[var(--amora-muted)]" : "text-[#8A876F]"}`}
                          hideNoteWhenDone
                        />
                      </button>
                      {itemAmoraHref && (
                        <Link {...weddingLinkProps(itemAmoraHref)} aria-label={`${item.label} 아모라에 질문하기`} title={`${item.label} 아모라에 질문하기`} className={`${AMORA_ICON_ACTION_CLASS} mt-1`}>
                          <AmoraMark className="size-5" />
                        </Link>
                      )}
                      </div>
                      {sourceChipItemIds.has(item.id) ? (
                        <ChecklistItemSource
                          itemId={item.id}
                          variant="chip"
                          touchTarget={isPlanning}
                          indentClassName="ml-9"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </section>
            );
          })}

          {isPlanning && (
            <p className="mt-5 border-t border-[var(--amora-line)] pt-4 text-[12.5px] leading-[1.7] text-[var(--amora-soft)]">
              {template.tip}
            </p>
          )}

          {/*
            「우리는 이건 안 해요」.

            2026-09-04에 머리에서 **목록 맨 끝으로 내렸다.** 시안 여덟 장 어디에도 이
            줄이 없는데, 머리에 있으면 84px 을 먹어 첫 화면에서 「01 · …」 단계 머리가
            밀려났다. 기능은 지울 수 없다 — 함·폐백·예단처럼 우리 결혼에서 안 하는
            분야를 못 끄면 진행률 분모와 마감 알림에 영구 미완료로 남는다.

            자리를 옮겼을 뿐이라 하는 일과 문구는 그대로다.
          */}
          <button
            type="button"
            onClick={toggleNotApplicable}
            disabled={saving || !checklistReady}
            className="mt-5 w-full rounded-[11px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-4 py-3 text-left text-[12.5px] text-[var(--hb-text-body)] transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] disabled:opacity-50"
          >
            {isNotApplicable ? (
              <>
                <span className="font-semibold text-[var(--hb-text-strong)]">다시 준비 목록에 넣기</span>
                <span className={`mt-0.5 block leading-[1.6] ${isPlanning ? "text-[var(--amora-muted)]" : "text-[#8A876F]"}`}>
                  지금은 진행률과 마감 알림에서 빠져 있어요.
                </span>
              </>
            ) : (
              <>
                <span className="font-semibold text-[var(--hb-text-strong)]">우리는 이건 안 해요</span>
                <span className={`mt-0.5 block leading-[1.6] ${isPlanning ? "text-[var(--amora-muted)]" : "text-[#8A876F]"}`}>
                  진행률과 마감 알림에서 빼드릴게요. 언제든 되돌릴 수 있어요.
                </span>
              </>
            )}
          </button>
        </div>

        {/* 팁 */}
        <div className={isPlanning ? "max-h-[35dvh] shrink-0 overflow-y-auto border-t border-[var(--amora-line)] bg-[var(--amora-warm)] px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] md:px-7 md:py-3" : "border-t border-[#E5DDC9] bg-[var(--color-ivory-warm)] px-7 py-4"}>
          {error && (
            <p
              role="alert"
              className="mb-3 rounded-[6px] border border-[#E5B8B8] bg-[#FFF6F6] px-3 py-2 text-sm leading-5 text-[#8C3E3E]"
            >
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="mb-3 rounded-[6px] border border-[#d9e2d3] bg-[#f6faf4] px-3 py-2 text-sm leading-5 text-[#506747]">
              {notice}
            </p>
          )}
          {/* 긴 팁은 본문에서 읽고, 시트 하단에는 이어서 할 수 있는 행동만 둔다. */}
          <div className={isPlanning ? "flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4" : "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"}>
            {!isPlanning && <p className="flex items-start gap-2.5 text-[12.5px] leading-[1.6] text-[var(--hb-text-body)]">
              <Sparkle className="mt-px h-4 w-4 flex-shrink-0 text-[var(--color-gold)]" aria-hidden="true" strokeWidth={1.7} />
              <span>{template.tip}</span>
            </p>}

            {isPlanning && <p className="text-[12px] leading-[1.6] text-[var(--amora-muted)] md:max-w-[280px]">질문 초안을 확인한 뒤 직접 보내요. 체크 상태는 바뀌지 않아요.</p>}

            <div className={isPlanning ? "flex min-w-0 items-stretch gap-2 md:shrink-0" : "flex min-w-0 items-stretch gap-2 md:max-w-[50%] md:shrink-0"}>
            {relatedGuide && <Link
              {...weddingLinkProps(relatedGuide.href)}
              className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[10px] border border-[var(--hb-hairline)] bg-white px-3 py-2 text-[12.5px] font-medium text-[var(--hb-text-strong)] transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] ${isPlanning ? "min-h-11" : ""}`}
            >
              <BookOpen className="h-[15px] w-[15px] flex-shrink-0" aria-hidden="true" />
              {/*
                시안의 버튼 글자는 「첫인사 예절 보기」·「본식 당일 예절 보기」처럼
                편 제목 뒤에 `보기` 가 붙는다. 편 제목 25개를 대조해 보니 네 시안이
                가리키는 편의 제목 + ` 보기` 가 시안 문구와 글자까지 같다.

                폴백(`아모라에게 물어보기`)에는 안 붙인다 — 이미 `보기` 로 끝나서
                「…물어보기 보기」 가 된다.
              */}
              <span className={isPlanning ? "text-center" : "whitespace-nowrap"}>
                {`${relatedGuide.title} 보기`}
              </span>
            </Link>}
            {amoraHref && (
              <Link {...weddingLinkProps(amoraHref)} aria-label={`${template.label} 아모라에 질문하기`} className={`${AMORA_ACTION_CLASS} shrink-0 text-center`}>
                <AmoraMark className="size-5 shrink-0" />아모라 질문
              </Link>
            )}
            </div>
          </div>
          {!isPlanning && <p className="mt-2 text-[11.5px] leading-[1.6] text-[var(--amora-muted)]">질문 초안을 확인한 뒤 직접 보내요. 체크 상태는 바뀌지 않아요.</p>}
          <p className="sr-only" aria-live="polite">{saving ? "체크리스트 저장 중" : ""}</p>
        </div>
      </div>
    </>
  );
  return isPlanning
    ? (portalReady ? createPortal(<div className="planning-workspace">{content}</div>, document.body) : null)
    : content;
}
