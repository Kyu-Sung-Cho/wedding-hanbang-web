"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, CircleHelp, Link2, Pencil, RefreshCw, Search } from "lucide-react";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import Button from "@/components/ui/Button";
import { useAmoraPreparationActions, type AmoraPreparationActionUpdate } from "@/hooks/useAmoraPreparationActions";
import CreatePreparationAction from "./CreatePreparationAction";
import AmoraActionPlanFields from "./AmoraActionPlanFields";
import type { AmoraActionItem, AmoraActionStatus } from "@/lib/amora/actions";
import { DECISION_COLUMNS, filterPreparationActions, preparationActionHref, preparationCategory, preparationDate, PREPARATION_COLUMNS, PREPARATION_SOURCES, type DecisionColumn } from "@/lib/amora/preparationBoard";
import { PREPARATION_DECISION_CATEGORIES, preparationDecisionCategory } from "@/lib/amora/preparationDecisionCategory";
import { weddingPath } from "@/lib/weddingPaths";
import { useDecisionBoard } from "./useDecisionBoard";
import SavedNotesContent from "@/components/app/saved/SavedNotesContent";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]";
const button = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;
const outlineButton = `${button} border border-[var(--color-paper-outline)] bg-[var(--amora-surface)] text-[var(--amora-soft)] hover:bg-[var(--amora-warm)]`;
const sharedButtonShape = "rounded-full! px-3.5! text-[12px]! font-medium!";
const sharedOutlineButton = `${outlineButton} ${sharedButtonShape} border-[var(--color-paper-outline)]! bg-[var(--amora-surface)]! text-[var(--amora-soft)]! hover:bg-[var(--amora-warm)]!`;
const decisionSources: Readonly<Record<string, string>> = {
  chat: "대화에서 남긴 기록", budget: "예산에서 남긴 기록", schedule: "일정에서 남긴 기록", manual: "직접 남긴 기록",
};

type BoardView = "decisions" | "tasks" | "saved";
const boardViewEvent = "amora:board-view";
function boardLocation() {
  return /^\/(?:wedding\/)?chat\/board\/?$/.test(window.location.pathname) ? window.location.pathname + window.location.search : "";
}
function subscribeBoardLocation(changed: () => void) {
  window.addEventListener("popstate", changed);
  window.addEventListener(boardViewEvent, changed);
  return () => { window.removeEventListener("popstate", changed); window.removeEventListener(boardViewEvent, changed); };
}
const serverBoardLocation = () => "";
function decisionPreview(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, "")}…` : text;
}
function focusTaskStatus(panel: HTMLElement | null, status: AmoraActionStatus) {
  const selector = window.matchMedia?.("(min-width: 1024px)").matches
    ? `[data-task-column="${status}"]` : '[aria-label="할 일 상태"] button[aria-pressed="true"]';
  panel?.querySelector<HTMLElement>(selector)?.focus();
}

/** 저장을 기다리는 동안 다른 곳으로 이동했다면 초점을 되돌리지 않는다. */
function useFocusIntent() {
  const pending = useRef(new Set<() => void>());
  useEffect(() => {
    const intents = pending.current;
    return () => { for (const cancel of intents) cancel(); intents.clear(); };
  }, []);
  return (origin: HTMLElement | null) => {
    let moved = !origin || document.activeElement !== origin;
    const onFocus = (event: FocusEvent) => { if (event.target !== origin && event.target !== document.body) moved = true; };
    const onPointer = (event: PointerEvent) => { if (!(event.target instanceof Node) || !origin?.contains(event.target)) moved = true; };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Tab") moved = true; };
    const onBlur = () => { moved = true; };
    const remove = () => {
      document.removeEventListener("focusin", onFocus, true); document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true); window.removeEventListener("blur", onBlur);
      pending.current.delete(cancel);
    };
    const cancel = () => { moved = true; remove(); };
    pending.current.add(cancel);
    document.addEventListener("focusin", onFocus, true); document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true); window.addEventListener("blur", onBlur);
    return () => {
      const restore = !moved && (document.activeElement === origin || document.activeElement === document.body);
      remove(); return restore;
    };
  };
}

function BoardSearch({ id, label, placeholder, query, onChange, mobileOpen, active }: {
  id: string; label: string; placeholder: string; query: string; onChange(value: string): void; mobileOpen: boolean; active: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mobileOpen && active) inputRef.current?.focus();
  }, [mobileOpen, active]);
  return <div id={id} className={`relative shrink-0 lg:block lg:w-[200px] ${mobileOpen ? "block" : "hidden"}`}>
    <label htmlFor={`${id}-input`} className="sr-only">{label}</label>
    <Search aria-hidden="true" className="pointer-events-none absolute top-3.5 left-3 size-4 text-[var(--amora-muted)]" />
    <input ref={inputRef} id={`${id}-input`} type="search" value={query} onChange={event => onChange(event.target.value)} placeholder={placeholder} className={`min-h-11 w-full rounded-full border border-[var(--color-paper-outline)] bg-[var(--amora-surface)] pr-3 pl-9 text-[12px] placeholder:text-[var(--amora-muted)] ${focus}`} />
  </div>;
}

function DecisionRecords({ data, searchId, query, onQueryChange, mobileSearchOpen, active }: {
  data: ReturnType<typeof useDecisionBoard>; searchId: string; query: string; onQueryChange(value: string): void; mobileSearchOpen: boolean; active: boolean;
}) {
  const { records, loading, loadingMore, error, nextCursor, available, isDemo, refresh, loadMore } = data;
  const [status, setStatus] = useState<DecisionColumn>("confirmed");
  const [category, setCategory] = useState("all");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ko");
    return records.filter(row => {
      const field = preparationDecisionCategory(row.category);
      if (category === "unsorted" ? !!field : category !== "all" && field?.key !== category) return false;
      return !needle || [row.title, row.detail, field?.label].some(value => value?.toLocaleLowerCase("ko").includes(needle));
    });
  }, [records, category, query]);
  const categories = PREPARATION_DECISION_CATEGORIES.filter(item => records.some(row => row.category === item.key));
  const unsortedCount = records.filter(row => !preparationDecisionCategory(row.category)).length;
  const activeColumn = DECISION_COLUMNS.find(column => column.status === status)!;
  const categoryButton = (value: string, label: string, amount: number) => (
    <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)} className={`${button} shrink-0 border ${category === value ? "border-[var(--amora-selected-line)] bg-[var(--amora-selected-bg)] text-[var(--amora-selected-text)]" : "border-[var(--color-paper-outline)] bg-[var(--amora-surface)] text-[var(--amora-soft)]"} ${value === "unsorted" ? "border-dashed" : ""}`}>
      {label}<span className="text-[12px] tabular-nums">{amount}</span>
    </button>
  );
  return <section aria-label="준비 결정 기록">
    <h2 className="sr-only">결정 기록</h2>
    <div className="mb-5 hidden items-start gap-[14px] rounded-[14px] border border-[var(--amora-line)] bg-[var(--amora-warm)] px-[18px] py-4 lg:flex">
      <CircleHelp aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--amora-rose-deep)]" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-[1.65] font-medium text-[var(--amora-ink)]">함께 준비하며 남긴 결정, 지금의 상태별로 모았어요.</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--amora-muted)]">저장된 상태를 보여주며, 두 사람이 모두 확인했다는 뜻은 아니에요.</p>
      </div>
      <details className="max-w-[230px] text-[12px] text-[var(--amora-muted)]"><summary className={`flex min-h-11 cursor-pointer items-center rounded-full border border-[var(--color-paper-outline)] bg-[var(--amora-surface)] px-3 ${focus}`}>기록 기준 자세히</summary><p className="pt-2 leading-relaxed">개인 상담과 자동 추출 기억은 포함하지 않아요. 할 일의 완료 여부는 공유 할 일에서 따로 관리해요.</p></details>
    </div>
    {isDemo ? <p role="note" className="py-3 text-[13px]">체험 모드에서는 실제 결정 기록을 조회하지 않아요. 공유 할 일에서 체험용 샘플을 볼 수 있어요.</p>
      : !available ? <p className="py-3 text-[13px]">로그인과 현재 커플 연결을 확인하면 공동 결정 기록을 볼 수 있어요.</p>
        : <>
          {error && <div role="alert" className="mb-4 rounded-[12px] border border-[var(--amora-rose)] bg-[var(--amora-warm)] p-4 text-[13px]"><p>{error}</p><Button type="button" onClick={() => void refresh()} disabled={loading} className={`${sharedOutlineButton} mt-2`}>결정 다시 불러오기</Button></div>}
          {loading && <p role="status" className="py-4 text-[13px]">결정 기록을 불러오는 중…</p>}
          {!loading && !error && <>
            <div className="mb-3 flex rounded-[11px] bg-[var(--amora-low)] p-[3px] lg:hidden" role="group" aria-label="결정 상태">
              {DECISION_COLUMNS.map(column => <button key={column.status} type="button" aria-pressed={status === column.status} onClick={() => setStatus(column.status)} className={`flex min-h-[46px] min-w-0 flex-1 flex-col items-center justify-center gap-[2px] rounded-[9px] py-1 text-[12.5px] ${focus} ${status === column.status ? "bg-[var(--amora-surface)] font-semibold text-[var(--amora-ink)] shadow-sm" : "text-[var(--amora-muted)]"}`}><span aria-hidden="true" className={`size-1.5 rounded-full ${column.dot}`} />{column.label}<span className="text-[12px] tabular-nums">{filtered.filter(row => row.status === column.status).length}</span></button>)}
            </div>
            <p className="border-b border-[var(--amora-line)] pb-3 text-[12px] leading-[1.5] text-[var(--amora-muted)] lg:hidden">{activeColumn.rule}</p>
            <div className="flex min-w-0 flex-col gap-2 py-2 lg:flex-row lg:items-start lg:gap-3 lg:py-3 lg:pt-0">
              <div aria-label="결정 분야 필터" className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 lg:flex-wrap">
                {categoryButton("all", "전체", records.length)}
                {categories.map(item => categoryButton(item.key, item.label, records.filter(row => row.category === item.key).length))}
                {unsortedCount > 0 && categoryButton("unsorted", "분야 미정", unsortedCount)}
              </div>
              <BoardSearch id={searchId} label="불러온 결정 검색" placeholder="결정 검색" query={query} onChange={onQueryChange} mobileOpen={mobileSearchOpen} active={active} />
            </div>
            <div className="mb-2 text-[12px] leading-relaxed text-[var(--amora-muted)] lg:mb-5">
              <p className="lg:hidden">불러온 {records.length}개 기준</p>
              <p className="hidden lg:block">불러온 결정 {records.length}개 · 숫자와 검색은 불러온 기록 기준이에요.{nextCursor ? " 이전 기록을 더 불러올 수 있어요." : ""}</p>
            </div>
            <div className="grid min-w-0 gap-5 lg:grid-cols-3">
              {DECISION_COLUMNS.map(column => {
                const rows = filtered.filter(row => row.status === column.status);
                return <section key={column.status} aria-label={`${column.label} 결정`} className={`min-w-0 ${status === column.status ? "block" : "hidden lg:block"}`}>
                  <h3 className="sr-only items-center gap-2 text-[14.5px] font-semibold text-[var(--amora-ink)] lg:not-sr-only lg:mb-1 lg:flex"><span aria-hidden="true" className={`size-[9px] rounded-full ${column.dot}`} />{column.label}<span className="text-[12px] font-normal text-[var(--amora-muted)]">{rows.length}</span></h3>
                  <p className="mb-[14px] hidden pl-[17px] text-[12px] leading-[1.5] text-[var(--amora-muted)] lg:block">{column.rule}</p>
                  <div className="space-y-[10px] lg:space-y-3">{rows.length ? rows.map(row => {
                    const category = preparationDecisionCategory(row.category);
                    const longTitle = row.title.length > 180;
                    const longDetail = (row.detail?.length ?? 0) > 400;
                    return <article key={row.id} aria-label={row.title} className={`min-w-0 rounded-[14px] border bg-[var(--amora-surface)] p-4 lg:px-[17px] ${category ? "border-[var(--amora-line)]" : "border-[var(--amora-rose)]"} ${row.status === "exploring" ? "border-dashed" : ""}`}>
                      <div className="mb-2 flex items-start justify-between gap-2 text-[12px] text-[var(--amora-muted)]"><span className="rounded-full bg-[var(--amora-low)] px-[9px] py-[3px] font-semibold text-[var(--amora-soft)]">{category?.label ?? "준비 결정 · 분야 미정"}</span><time dateTime={row.createdAt} title="기록일" className="shrink-0 pt-[3px]">{preparationDate(row.createdAt)}</time></div>
                      <h4 className="mb-[9px] break-words text-[14.5px] font-semibold leading-[1.5] text-[var(--amora-ink)]">{decisionPreview(row.title, 180)}</h4>
                      {row.detail && <p className="mb-[10px] whitespace-pre-wrap break-words rounded-[9px] bg-[var(--amora-warm)] px-[11px] py-[9px] text-[12.5px] leading-[1.55] text-[var(--amora-muted)]">{decisionPreview(row.detail, 400)}</p>}
                      {(longTitle || longDetail) && <details className="mb-3 text-[12px]">
                        <summary className={`flex min-h-11 cursor-pointer items-center rounded-lg text-[var(--amora-accent)] ${focus}`}>전체 결정 내용 보기</summary>
                        <div className="space-y-2 border-t border-[var(--amora-line)] py-3">
                          <p className="whitespace-pre-wrap break-words font-semibold text-[var(--amora-ink)]">{row.title}</p>
                          {row.detail && <p className="whitespace-pre-wrap break-words leading-relaxed text-[var(--amora-soft)]">{row.detail}</p>}
                        </div>
                      </details>}
                      <p className="mb-3 flex items-center gap-1.5 text-[12px] text-[var(--amora-muted)]"><Link2 aria-hidden="true" className="size-3 shrink-0" />{Object.hasOwn(decisionSources, row.source) ? decisionSources[row.source] : "공동 결정 기록"}</p>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={`rounded-full px-[9px] py-1 text-[12px] font-semibold text-[var(--amora-soft)] ${row.status === "confirmed" ? "bg-[var(--amora-sage-pale)]" : "bg-[var(--amora-low)]"}`}>{row.stateLabel}</span>
                        {category?.destination && <Link href={category.destination.href} className={`inline-flex min-h-11 items-center gap-1 text-[12px] text-[var(--amora-accent)] underline underline-offset-4 ${focus}`}>{category.destination.label}<ArrowUpRight aria-hidden="true" className="size-3" /></Link>}
                      </div>
                    </article>;
                  }) : <p className="rounded-[14px] border border-dashed border-[var(--amora-line)] p-5 text-[12px] leading-6 text-[var(--amora-muted)]">{query || category !== "all" ? "이 조건에 맞는 결정이 없어요." : "이 상태로 저장된 결정이 없어요."}</p>}</div>
                </section>;
              })}
            </div>
          </>}
          {nextCursor && !error && <Button type="button" onClick={() => void loadMore()} disabled={loading || loadingMore} className={`${sharedOutlineButton} mt-4`}>{loadingMore ? "이전 결정을 불러오는 중…" : "이전 결정 더 보기"}</Button>}
        </>}
    <details className="mt-3 text-[12px] text-[var(--amora-muted)] lg:hidden"><summary className={`flex min-h-11 cursor-pointer items-center ${focus}`}>결정 기록 안내</summary><p className="pb-2 leading-relaxed">불러온 결정 {records.length}개 · 숫자와 검색은 불러온 기록 기준이에요.{nextCursor ? " 이전 기록을 더 불러올 수 있어요." : ""}</p><p className="pb-3 leading-relaxed">확정은 저장된 상태이며 두 사람이 모두 확인했다는 뜻은 아니에요. 개인 상담과 자동 추출 기억은 포함하지 않아요. 할 일 완료는 공유 할 일에서 따로 관리해요.</p></details>
  </section>;
}

function PreparationCard({ action, busy, update, changeStatus }: {
  action: AmoraActionItem;
  busy: boolean;
  update: (id: string, updates: AmoraPreparationActionUpdate) => Promise<boolean>;
  changeStatus(action: AmoraActionItem, status: AmoraActionStatus, origin: HTMLButtonElement): void;
}) {
  const [categoryChoice, setCategoryChoice] = useState("");
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [dueDateDraft, setDueDateDraft] = useState("");
  const [originalPlan, setOriginalPlan] = useState({ description: "", dueDate: "" });
  const titleInputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const finishEditFocus = useRef<(() => boolean) | null>(null);
  const focusIntent = useFocusIntent();
  useLayoutEffect(() => {
    const finish = finishEditFocus.current; finishEditFocus.current = null;
    if (finish?.()) (editing ? titleInputRef.current : editButtonRef.current)?.focus();
  }, [editing]);
  const selectId = useId();
  const titleId = useId();
  const editCategoryId = useId();
  const category = preparationCategory(action.categoryKey);
  const date = preparationDate(action.updatedAt);
  const href = preparationActionHref(action.href);
  const disabled = busy;
  const validPlanDraft = (descriptionDraft === originalPlan.description || descriptionDraft.length <= 500)
    && (dueDateDraft === originalPlan.dueDate || dueDateDraft.length <= 40);
  return (
    <article data-preparation-action={action.id} aria-label={action.title} aria-busy={busy} className={`min-w-0 rounded-[14px] border bg-[var(--amora-surface)] px-4 py-4 lg:px-[17px] ${category ? "border-[var(--amora-line)]" : "border-[var(--amora-rose)]"} ${action.status === "dismissed" ? "border-dashed" : ""}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        {category ? (
          <Link href={weddingPath(`/checklist?category=${encodeURIComponent(category.key)}`)} className={`inline-flex min-h-11 max-w-full items-center rounded-full text-[12px] font-semibold text-[var(--amora-soft)] ${focus}`} aria-label={`${category.label} 체크리스트 보기`}><span className="rounded-full bg-[var(--amora-low)] px-[9px] py-[3px]">{category.label}</span></Link>
        ) : <span className="rounded-full bg-[var(--amora-rose-pale)] px-[9px] py-1 text-[12px] font-semibold text-[var(--amora-rose-deep)]">분야 확인 필요</span>}
        {date && <time dateTime={action.updatedAt} title="최근 변경일" className="shrink-0 pt-1 text-[12px] text-[var(--amora-muted)]">{date}</time>}
      </div>
      <div className="mb-[9px] flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-[14.5px] leading-[1.5] font-semibold text-[var(--amora-ink)]">{action.title}</h3>
        {!editing && <Button ref={editButtonRef} type="button" variant="icon" label={`${action.title} 수정`} disabled={disabled} onClick={event => {
          finishEditFocus.current = focusIntent(event.currentTarget);
          setTitleDraft(action.title); setCategoryDraft(action.categoryKey ?? ""); setEditing(true);
          const plan = { description: action.description ?? "", dueDate: action.dueDate ?? "" };
          setOriginalPlan(plan); setDescriptionDraft(plan.description); setDueDateDraft(plan.dueDate);
        }} className={`-mt-2 min-h-11 min-w-11 shrink-0 rounded-lg! text-[var(--amora-accent)]! disabled:opacity-40! ${focus}`}><Pencil aria-hidden="true" className="h-3.5 w-3.5" /></Button>}
      </div>
      {editing && <form className="mb-3 space-y-2 rounded-[9px] bg-[var(--amora-warm)] p-3" onSubmit={async event => {
        event.preventDefault();
        if (disabled || !titleDraft.trim() || titleDraft.length > 120 || !validPlanDraft) return;
        const updates: AmoraPreparationActionUpdate = {};
        if (titleDraft.trim() !== action.title) updates.title = titleDraft.trim();
        if (categoryDraft !== (action.categoryKey ?? "")) updates.category_key = categoryDraft;
        if (descriptionDraft !== originalPlan.description) updates.description = descriptionDraft;
        if (dueDateDraft !== originalPlan.dueDate) updates.due_date = dueDateDraft;
        const finish = focusIntent(event.currentTarget.contains(document.activeElement) && document.activeElement instanceof HTMLElement ? document.activeElement : null);
        if (Object.keys(updates).length === 0 || await update(action.id, updates)) {
          finishEditFocus.current = finish; setEditing(false);
        } else finish();
      }}>
        <label htmlFor={titleId} className="block text-[12px]">할 일 제목</label>
        <input ref={titleInputRef} id={titleId} value={titleDraft} onChange={event => setTitleDraft(event.target.value)} maxLength={120} disabled={disabled} className={`min-h-11 w-full rounded-[9px] border border-[var(--color-paper-outline)] bg-[var(--amora-surface)] px-3 text-[13px] ${focus}`} />
        <label htmlFor={editCategoryId} className="block text-[12px]">분야</label>
        <select id={editCategoryId} value={categoryDraft} onChange={event => setCategoryDraft(event.target.value)} disabled={disabled} className={`min-h-11 w-full rounded-[9px] border border-[var(--color-paper-outline)] bg-[var(--amora-surface)] px-2 text-[12px] ${focus}`}>
          <option value="">분야 미지정</option>
          {!category && action.categoryKey && <option value={action.categoryKey}>기존 분야 유지</option>}
          {CATEGORY_CHECKLISTS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <AmoraActionPlanFields description={descriptionDraft} dueDate={dueDateDraft} onDescriptionChange={setDescriptionDraft} onDueDateChange={setDueDateDraft} disabled={disabled} />
        <p className="text-[12px] leading-relaxed text-[var(--amora-muted)]">함께 준비하는 사람에게도 보이는 기록이에요.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={disabled || !titleDraft.trim() || titleDraft.length > 120 || !validPlanDraft} className={`${button} ${sharedButtonShape} bg-[var(--amora-action)]! text-white! hover:bg-[var(--amora-action-hover)]!`}>수정 저장</Button>
          <Button type="button" disabled={disabled} onClick={event => { finishEditFocus.current = focusIntent(event.currentTarget); setEditing(false); }} className={sharedOutlineButton}>취소</Button>
        </div>
      </form>}
      {action.description && <p className="mb-[10px] rounded-[9px] bg-[var(--amora-warm)] px-[11px] py-[9px] text-[12.5px] leading-[1.55] break-words whitespace-pre-wrap text-[var(--amora-muted)]">{action.description}</p>}
      {!category && !editing && (
        <form className="mb-3" onSubmit={(event) => { event.preventDefault(); if (categoryChoice) void update(action.id, { category_key: categoryChoice }); }}>
          <label htmlFor={selectId} className="mb-2 block text-[12px] font-semibold text-[var(--amora-rose-deep)]">어느 분야에 넣을까요?</label>
          <div className="flex flex-wrap gap-2">
            <select id={selectId} value={categoryChoice} onChange={(event) => setCategoryChoice(event.target.value)} disabled={disabled} className={`min-h-11 min-w-0 flex-1 rounded-[9px] border border-[var(--color-paper-outline)] bg-[var(--amora-surface)] px-2 text-[12px] text-[var(--amora-soft)] ${focus}`}>
              <option value="">21개 분야에서 선택</option>
              {CATEGORY_CHECKLISTS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
            <button type="submit" disabled={disabled || !categoryChoice} className={outlineButton}>저장</button>
          </div>
        </form>
      )}
      <p className="mb-3 flex items-center gap-1.5 text-[12px] leading-relaxed text-[var(--amora-muted)]"><Link2 aria-hidden="true" className="h-3 w-3 shrink-0" />{PREPARATION_SOURCES[action.source]}</p>
      {action.dueDate && <p className="mb-3 text-[12px] break-words text-[var(--amora-muted)]">예정일 {action.dueDate}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {action.status === "open" ? (
          <>
            <button type="button" disabled={disabled} onClick={event => changeStatus(action, "done", event.currentTarget)} className={`${button} bg-[var(--amora-action)] text-white hover:bg-[var(--amora-action-hover)]`}><Check aria-hidden="true" className="h-3.5 w-3.5" />완료로 표시</button>
            <button type="button" disabled={disabled} onClick={event => changeStatus(action, "dismissed", event.currentTarget)} className={outlineButton}>보류·숨김</button>
          </>
        ) : (
          <>
            <span className={`rounded-full px-[9px] py-1 text-[12px] font-semibold text-[var(--amora-soft)] ${action.status === "done" ? "bg-[var(--amora-sage-pale)]" : "bg-[var(--amora-low)]"}`}>{action.status === "done" ? "완료한 할 일" : "숨겨 둔 할 일"}</span>
            <button type="button" disabled={disabled} onClick={event => changeStatus(action, "open", event.currentTarget)} className={outlineButton}>{action.status === "done" ? "다시 진행" : "다시 꺼내기"}</button>
          </>
        )}
        {busy && <span role="status" className="text-[12px] text-[var(--amora-muted)]">저장 중…</span>}
      </div>
      {href && <Link href={href} className={`mt-2 inline-flex min-h-11 items-center gap-1 text-[12px] text-[var(--amora-accent)] underline underline-offset-4 ${focus}`}>연결된 화면 보기<ArrowUpRight aria-hidden="true" className="h-3 w-3" /></Link>}
    </article>
  );
}

export default function AmoraDecisionBoard() {
  const decisions = useDecisionBoard();
  const { actions, loading, loadingMore, error, count, truncated, nextCursor, loadMore, refresh, update, updatingIds, updateError, isDemo, create, cancelCreate, createLocked, creating, canCreate, ownerScope } = useAmoraPreparationActions();
  const location = useSyncExternalStore(subscribeBoardLocation, boardLocation, serverBoardLocation);
  const requestedView = new URLSearchParams(location.split("?")[1] ?? "").get("view");
  const [selectedBoard, setSelectedBoard] = useState<BoardView | null>(null);
  const board = (location ? (requestedView === "decisions" || requestedView === "tasks" || requestedView === "saved" ? requestedView : null) : selectedBoard) ?? (isDemo ? "tasks" : "decisions");
  const [hasVisitedSaved, setHasVisitedSaved] = useState(false);
  // 처음 열 때만 조회를 시작하고, 다른 보기를 오가도 메모 초안과 페이지를 유지한다.
  if (board === "saved" && !hasVisitedSaved) setHasVisitedSaved(true);
  const selectBoard = (view: BoardView) => {
    if (!boardLocation()) { setSelectedBoard(view); return; }
    const url = new URL(window.location.href);
    if (url.searchParams.get("view") === view) return;
    url.searchParams.set("view", view);
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
    window.dispatchEvent(new Event(boardViewEvent));
  };
  const decisionPanelId = useId();
  const taskPanelId = useId();
  const savedPanelId = useId();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [decisionQuery, setDecisionQuery] = useState("");
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const [activeStatus, setActiveStatus] = useState<AmoraActionStatus>("open");
  const taskPanelRef = useRef<HTMLElement>(null);
  const statusFocus = useRef<(() => boolean) | null>(null);
  const editFallbackFocus = useRef<(() => boolean) | null>(null);
  const [editCompletion, setEditCompletion] = useState<{ id: string; sequence: number } | null>(null);
  const focusIntent = useFocusIntent();
  const mounted = useRef(false);
  const [announcement, setAnnouncement] = useState({ message: "", sequence: 0 });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    const finish = statusFocus.current; statusFocus.current = null;
    if (!finish?.() || board !== "tasks") return;
    focusTaskStatus(taskPanelRef.current, activeStatus);
  }, [announcement, activeStatus, board]);
  useLayoutEffect(() => {
    const finish = editFallbackFocus.current; editFallbackFocus.current = null;
    if (!finish?.() || board !== "tasks" || !editCompletion) return;
    const remaining = Array.from(taskPanelRef.current?.querySelectorAll<HTMLElement>("[data-preparation-action]") ?? [])
      .some(card => card.dataset.preparationAction === editCompletion.id);
    if (!remaining) focusTaskStatus(taskPanelRef.current, activeStatus);
  }, [editCompletion, activeStatus, board]);
  const updateCard = async (id: string, updates: AmoraPreparationActionUpdate) => {
    const active = document.activeElement;
    const finish = focusIntent(active instanceof HTMLElement && active.closest<HTMLElement>("[data-preparation-action]")?.dataset.preparationAction === id ? active : null);
    const saved = await update(id, updates);
    if (saved && mounted.current) {
      editFallbackFocus.current?.(); editFallbackFocus.current = finish;
      setEditCompletion(previous => ({ id, sequence: (previous?.sequence ?? 0) + 1 }));
    } else finish();
    return saved;
  };
  const changeStatus = async (action: AmoraActionItem, status: AmoraActionStatus, origin: HTMLButtonElement) => {
    const finish = focusIntent(origin);
    if (await update(action.id, { status }) && mounted.current) {
      statusFocus.current?.(); statusFocus.current = finish;
      const result = status === "done" ? "완료로 표시했어요." : status === "dismissed" ? "보류·숨김으로 옮겼어요." : "진행 중으로 다시 꺼냈어요.";
      setAnnouncement(previous => ({ message: `${action.title} — ${result}`, sequence: previous.sequence + 1 }));
    } else finish();
  };
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const decisionSearchId = `${decisionPanelId}-search`;
  const taskSearchId = `${taskPanelId}-search`;
  const activeQuery = board === "decisions" ? decisionQuery : query;
  const searchAvailable = board === "tasks" || (!decisions.isDemo && decisions.available && !decisions.loading && !decisions.error);
  const searchExpanded = searchAvailable && mobileSearchOpen;
  const refreshDisabled = board === "decisions"
    ? decisions.isDemo || !decisions.available || decisions.loading || decisions.loadingMore
    : loading || loadingMore || updatingIds.size > 0 || isDemo;
  const filtered = useMemo(() => filterPreparationActions(actions, category, query), [actions, category, query]);
  const categories = CATEGORY_CHECKLISTS.filter((item) => actions.some((action) => action.categoryKey === item.key));
  const unsortedCount = actions.filter((action) => !preparationCategory(action.categoryKey)).length;
  const activeColumn = PREPARATION_COLUMNS.find((column) => column.status === activeStatus)!;
  const statusCount = (status: AmoraActionStatus) => filtered.filter((action) => action.status === status).length;
  const categoryButton = (value: string, label: string, amount: number) => (
    <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)} className={`${button} shrink-0 border ${category === value ? "border-[var(--amora-selected-line)] bg-[var(--amora-selected-bg)] text-[var(--amora-selected-text)]" : "border-[var(--color-paper-outline)] bg-[var(--amora-surface)] text-[var(--amora-soft)]"} ${value === "unsorted" ? "border-dashed" : ""}`}>
      {label}<span className="text-[12px] tabular-nums">{amount}</span>
    </button>
  );

  return (
    <div className="min-w-0 bg-[var(--amora-bg)] px-[18px] pt-[10px] pb-8 text-[var(--amora-soft)] lg:px-9 lg:pt-6 lg:pb-9">
      <p role="status" aria-live="polite" aria-atomic="true" data-board-announcement className="sr-only">{announcement.message}</p>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between lg:mb-4">
      <div role="group" aria-label="보드 보기" className="grid min-w-0 grid-cols-3 gap-1 rounded-full border border-[var(--amora-line)] bg-[var(--amora-surface)] p-[3px] sm:w-fit">
        <button type="button" aria-pressed={board === "decisions"} aria-controls={decisionPanelId} onClick={() => selectBoard("decisions")} className={`${button} ${board === "decisions" ? "bg-[var(--amora-selected-bg)] text-[var(--amora-selected-text)] ring-1 ring-inset ring-[var(--amora-selected-line)]" : "text-[var(--amora-muted)] hover:bg-[var(--amora-warm)]"}`}>결정 기록</button>
        <button type="button" aria-pressed={board === "tasks"} aria-controls={taskPanelId} onClick={() => selectBoard("tasks")} className={`${button} ${board === "tasks" ? "bg-[var(--amora-selected-bg)] text-[var(--amora-selected-text)] ring-1 ring-inset ring-[var(--amora-selected-line)]" : "text-[var(--amora-muted)] hover:bg-[var(--amora-warm)]"}`}>공유 할 일</button>
        <button type="button" aria-pressed={board === "saved"} aria-controls={savedPanelId} onClick={() => selectBoard("saved")} className={`${button} ${board === "saved" ? "bg-[var(--amora-selected-bg)] text-[var(--amora-selected-text)] ring-1 ring-inset ring-[var(--amora-selected-line)]" : "text-[var(--amora-muted)] hover:bg-[var(--amora-warm)]"}`}>저장한 답변</button>
      </div>
      {board !== "saved" && <div className="flex shrink-0 items-center justify-end gap-1">
      <button type="button" onClick={() => void (board === "decisions" ? decisions.refresh() : refresh())} disabled={refreshDisabled} aria-label={board === "decisions" ? "결정 새로고침" : "공유 할 일 새로고침"} className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full text-[12px] text-[var(--amora-accent)] disabled:cursor-not-allowed disabled:opacity-40 ${focus}`}><RefreshCw aria-hidden="true" className="size-4" /><span className="hidden lg:inline">새로고침</span></button>
      <button ref={searchToggleRef} type="button" disabled={!searchAvailable} aria-label={searchExpanded ? "보드 검색 닫기" : activeQuery.trim() ? "보드 검색 열기 · 검색 적용 중" : "보드 검색 열기"} aria-expanded={searchExpanded} aria-controls={searchAvailable ? (board === "decisions" ? decisionSearchId : taskSearchId) : undefined} onClick={() => {
        if (mobileSearchOpen) {
          setMobileSearchOpen(false);
          searchToggleRef.current?.focus();
        } else setMobileSearchOpen(true);
      }} className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--amora-line)] bg-[var(--amora-surface)] text-[var(--amora-soft)] disabled:cursor-not-allowed disabled:opacity-40 lg:hidden ${focus}`}><Search aria-hidden="true" className="size-5" /></button>
      </div>}
      </div>
      {board !== "saved" && activeQuery.trim() && <div className="mb-3 flex min-w-0 items-center justify-between gap-2 text-[12px] text-[var(--amora-muted)] lg:hidden"><p className="min-w-0 truncate">검색 적용 중: {activeQuery.trim()}</p><button type="button" onClick={() => {
        if (board === "decisions") setDecisionQuery(""); else setQuery("");
        searchToggleRef.current?.focus();
      }} className={`${button} shrink-0 px-2 text-[var(--amora-accent)]`}>검색 해제</button></div>}
      {/* 보드를 바꿔도 각 목록의 페이지·검색과 작성 중인 할 일 초안을 유지한다. */}
      <div id={decisionPanelId} hidden={board !== "decisions"}><DecisionRecords data={decisions} searchId={decisionSearchId} query={decisionQuery} onQueryChange={setDecisionQuery} mobileSearchOpen={mobileSearchOpen} active={board === "decisions"} /></div>
      <section ref={taskPanelRef} id={taskPanelId} hidden={board !== "tasks"} aria-label="공유 할 일">
      <h2 className="sr-only">공유 할 일</h2>
      <CreatePreparationAction key={ownerScope} create={create} cancelCreate={cancelCreate} locked={createLocked} busy={creating || updatingIds.size > 0} available={canCreate && !loading && !error} isDemo={isDemo} focusIntent={focusIntent} onCreated={() => {
        setActiveStatus("open"); setCategory("all"); setQuery("");
        setAnnouncement(previous => ({ message: "공유 할 일을 추가했어요.", sequence: previous.sequence + 1 }));
      }} />
      <div className="mb-5 hidden items-start gap-[14px] rounded-[14px] border border-[var(--amora-line)] bg-[var(--amora-warm)] px-[18px] py-4 lg:flex">
        <CircleHelp aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--amora-rose-deep)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] leading-relaxed font-medium text-[var(--amora-ink)]">카드의 상태는 직접 바꿉니다 — 완료한 일과 남은 일을 한눈에.</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--amora-muted)]">저장된 할 일을 모았어요. 완료 표시는 한 분이 할 수 있고, 체크리스트와 같은 21개 분야로 정리할 수 있어요.</p>
        </div>
        <details className="max-w-[230px] text-[12px] text-[var(--amora-muted)]"><summary className={`flex min-h-11 cursor-pointer items-center rounded-full border border-[var(--color-paper-outline)] px-3 ${focus}`}>분류 방식 자세히</summary><p className="pt-2 leading-relaxed">카드에 저장된 분야를 그대로 보여줘요. 분야가 없거나 체크리스트와 연결되지 않으면 직접 선택할 수 있어요. 완료는 할 일의 상태이며 두 사람의 합의 여부를 뜻하지 않아요.</p></details>
      </div>
      {isDemo && <p role="note" className="mb-4 rounded-[9px] bg-[var(--amora-warm)] px-3 py-2 text-[12px] text-[var(--amora-rose-deep)]">체험용 샘플 데이터예요. 상태와 분야 변경은 이 화면에서만 유지되고 실제 준비 기록에 저장되지 않아요.</p>}
      <div className="mb-3 flex rounded-[11px] bg-[var(--amora-low)] p-[3px] lg:hidden" role="group" aria-label="할 일 상태">
        {PREPARATION_COLUMNS.map((column) => <button key={column.status} type="button" aria-pressed={activeStatus === column.status} onClick={() => setActiveStatus(column.status)} className={`flex min-h-[46px] min-w-0 flex-1 flex-col items-center justify-center gap-[2px] rounded-[9px] py-1 text-[12.5px] ${focus} ${activeStatus === column.status ? "bg-[var(--amora-surface)] font-semibold text-[var(--amora-ink)] shadow-sm" : "text-[var(--amora-muted)]"}`}><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${column.dot}`} />{column.label}<span className="text-[12px] tabular-nums">{statusCount(column.status)}</span></button>)}
      </div>
      <p className="border-b border-[var(--amora-line)] pb-3 text-[12px] leading-[1.5] text-[var(--amora-muted)] lg:hidden">{activeColumn.rule}</p>
      <div className="flex min-w-0 flex-col gap-2 py-2 lg:flex-row lg:items-start lg:gap-3 lg:py-3 lg:pt-0">
        <div aria-label="분야 필터" className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 lg:flex-wrap">
          {categoryButton("all", "전체", actions.length)}
          {categories.map((item) => categoryButton(item.key, item.label, actions.filter((action) => action.categoryKey === item.key).length))}
          {unsortedCount > 0 && categoryButton("unsorted", "분야 확인 필요", unsortedCount)}
        </div>
        <BoardSearch id={taskSearchId} label="불러온 카드 검색" placeholder="카드 검색" query={query} onChange={setQuery} mobileOpen={mobileSearchOpen} active={board === "tasks"} />
      </div>
      <div className="mb-2 text-[12px] leading-relaxed text-[var(--amora-muted)] lg:mb-5">
        <p className="lg:hidden">불러온 {actions.length}개 기준</p>
        <p className="hidden lg:block">{truncated ? `전체 ${count}개 중 ${actions.length}개를 불러왔어요. 아래 숫자와 검색은 불러온 카드 기준이에요.` : `불러온 카드 ${actions.length}개 · 카드의 분야를 누르면 해당 체크리스트로 이어져요.`}</p>
      </div>
      {error && <div role="alert" className="mb-4 rounded-[9px] border border-[var(--amora-rose)] bg-[var(--amora-warm)] p-4 text-[13px]"><p>{error}</p>{actions.length > 0 && <p className="mt-1 text-[12px]">마지막으로 불러온 기록이에요. 최신 상태를 다시 확인해 주세요.</p>}<button type="button" onClick={() => void refresh()} disabled={loading} className={`${outlineButton} mt-2`}>다시 불러오기</button></div>}
      {updateError && <p role="alert" className="mb-4 rounded-[9px] bg-[var(--amora-rose-pale)] p-3 text-[13px] text-[var(--amora-rose-deep)]">{updateError}</p>}
      {loading && <p role="status" className="py-5 text-center text-[13px] text-[var(--amora-muted)]">준비 기록을 불러오는 중…</p>}
      {!loading && !error && actions.length === 0 ? createLocked ? <p className="py-5 text-center text-[13px] text-[var(--amora-muted)]">저장 여부는 목록을 새로고쳐 확인해 주세요.</p> : <div className="rounded-[14px] border border-dashed border-[var(--amora-line)] bg-[var(--amora-surface)] px-5 py-10 text-center"><h2 className="amora-display text-[19px] text-[var(--amora-ink)]">아직 저장된 할 일이 없어요</h2><p className="mt-2 text-[13px] text-[var(--amora-muted)]">아모라와 준비할 일을 정리하고, 제안 카드에서 직접 추가해 보세요.</p><Link href={weddingPath("/chat")} className={`${button} mt-4 bg-[var(--amora-action)] text-white hover:bg-[var(--amora-action-hover)]`}>아모라와 이야기하기</Link></div> : actions.length > 0 && (
        <div className="grid min-w-0 gap-5 lg:grid-cols-3">
          {PREPARATION_COLUMNS.map((column) => {
            const columnActions = filtered.filter((action) => action.status === column.status);
            return <section key={column.status} aria-label={`${column.label} 할 일`} className={`min-w-0 ${activeStatus === column.status ? "block" : "hidden lg:block"}`}>
              <div className="lg:mb-[14px]"><h2 data-task-column={column.status} tabIndex={-1} className={`sr-only items-center gap-2 text-[14.5px] font-semibold text-[var(--amora-ink)] lg:not-sr-only lg:flex ${focus}`}><span aria-hidden="true" className={`h-[9px] w-[9px] rounded-full ${column.dot}`} />{column.label}<span className="text-[12px] font-normal text-[var(--amora-muted)]">{columnActions.length}</span></h2><p className="mt-1 hidden pl-[17px] text-[12px] leading-[1.5] text-[var(--amora-muted)] lg:block">{column.rule}</p></div>
              <div className="space-y-[10px] lg:space-y-3">{columnActions.length ? columnActions.map((action) => <PreparationCard key={action.id} action={action} busy={creating || updatingIds.has(action.id)} update={updateCard} changeStatus={(item, nextStatus, origin) => void changeStatus(item, nextStatus, origin)} />) : <p className="rounded-[14px] border border-dashed border-[var(--amora-line)] p-5 text-center text-[12px] leading-relaxed text-[var(--amora-muted)]">{query || category !== "all" ? "이 조건에 맞는 카드가 없어요." : "이 상태의 할 일이 없어요."}</p>}</div>
            </section>;
          })}
        </div>
      )}
      {nextCursor && <div className="mt-5 text-center">
        <p className="mb-2 text-[12px] text-[var(--amora-muted)]">최근에 등록한 순서예요. 더 불러오면 이전 카드도 검색하고 분류할 수 있어요.</p>
        <Button type="button" onClick={() => void loadMore()} disabled={loading || loadingMore || updatingIds.size > 0} className={sharedOutlineButton}>{loadingMore ? "이전 기록을 불러오는 중…" : "이전 기록 더 보기"}</Button>
      </div>}
      <details className="mt-3 text-[12px] text-[var(--amora-muted)] lg:hidden"><summary className={`flex min-h-11 cursor-pointer items-center ${focus}`}>공유 할 일 안내</summary><p className="pb-2 leading-relaxed">{truncated ? `전체 ${count}개 중 ${actions.length}개를 불러왔어요. 아래 숫자와 검색은 불러온 카드 기준이에요.` : `불러온 카드 ${actions.length}개 · 숫자와 검색은 불러온 카드 기준이에요. 카드의 분야를 누르면 해당 체크리스트로 이어져요.`}</p><p className="pb-3 leading-relaxed">완료는 할 일의 상태이며 두 사람의 합의 여부를 뜻하지 않아요.</p></details>
      </section>
      <section id={savedPanelId} hidden={board !== "saved"} aria-label="저장한 답변">
        {hasVisitedSaved && <SavedNotesContent embedded />}
      </section>
    </div>
  );
}
