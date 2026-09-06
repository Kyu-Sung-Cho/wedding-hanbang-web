"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, CircleHelp, Link2, Pencil, RefreshCw, Search } from "lucide-react";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import Button from "@/components/ui/Button";
import { useAmoraPreparationActions, type AmoraPreparationActionUpdate } from "@/hooks/useAmoraPreparationActions";
import type { AmoraActionItem, AmoraActionStatus } from "@/lib/amora/actions";
import { filterPreparationActions, preparationActionHref, preparationCategory, preparationDate, PREPARATION_COLUMNS, PREPARATION_SOURCES } from "@/lib/amora/preparationBoard";
import { weddingPath } from "@/lib/weddingPaths";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]";
const button = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focus}`;
const outlineButton = `${button} border border-[var(--color-paper-outline)] bg-[var(--amora-surface)] text-[var(--amora-soft)] hover:bg-[var(--amora-warm)]`;
const sharedButtonShape = "rounded-full! px-3.5! text-[12px]! font-medium!";
const sharedOutlineButton = `${outlineButton} ${sharedButtonShape} border-[var(--color-paper-outline)]! bg-[var(--amora-surface)]! text-[var(--amora-soft)]! hover:bg-[var(--amora-warm)]!`;

function PreparationCard({ action, busy, update }: {
  action: AmoraActionItem;
  busy: boolean;
  update: (id: string, updates: AmoraPreparationActionUpdate) => Promise<boolean>;
}) {
  const [categoryChoice, setCategoryChoice] = useState("");
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState("");
  const selectId = useId();
  const titleId = useId();
  const editCategoryId = useId();
  const category = preparationCategory(action.categoryKey);
  const date = preparationDate(action.updatedAt);
  const href = preparationActionHref(action.href);
  const disabled = busy;
  return (
    <article aria-label={action.title} aria-busy={busy} className={`min-w-0 rounded-[14px] border bg-[var(--amora-surface)] px-4 py-4 lg:px-[17px] ${category ? "border-[var(--amora-line)]" : "border-[var(--amora-rose)]"} ${action.status === "dismissed" ? "border-dashed" : ""}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        {category ? (
          <Link href={weddingPath(`/checklist?category=${encodeURIComponent(category.key)}`)} className={`inline-flex min-h-11 max-w-full items-center rounded-full text-[11px] font-semibold text-[var(--amora-soft)] ${focus}`} aria-label={`${category.label} 체크리스트 보기`}><span className="rounded-full bg-[var(--amora-low)] px-[9px] py-[3px]">{category.label}</span></Link>
        ) : <span className="rounded-full bg-[var(--amora-rose-pale)] px-[9px] py-1 text-[11px] font-semibold text-[var(--amora-rose-deep)]">분야 확인 필요</span>}
        {date && <time dateTime={action.updatedAt} title="최근 변경일" className="shrink-0 pt-1 text-[11px] text-[var(--amora-muted)]">{date}</time>}
      </div>
      <div className="mb-[9px] flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-[14.5px] leading-[1.5] font-semibold text-[var(--amora-ink)]">{action.title}</h3>
        {!editing && <Button type="button" variant="icon" label={`${action.title} 수정`} disabled={disabled} onClick={() => {
          setTitleDraft(action.title); setCategoryDraft(action.categoryKey ?? ""); setEditing(true);
        }} className={`-mt-2 min-h-11 min-w-11 shrink-0 rounded-lg! text-[var(--amora-accent)]! disabled:opacity-40! ${focus}`}><Pencil aria-hidden="true" className="h-3.5 w-3.5" /></Button>}
      </div>
      {editing && <form className="mb-3 space-y-2 rounded-[9px] bg-[var(--amora-warm)] p-3" onSubmit={async event => {
        event.preventDefault();
        if (disabled || !titleDraft.trim() || titleDraft.length > 120) return;
        const updates: AmoraPreparationActionUpdate = {};
        if (titleDraft.trim() !== action.title) updates.title = titleDraft.trim();
        if (categoryDraft !== (action.categoryKey ?? "")) updates.category_key = categoryDraft;
        if (Object.keys(updates).length === 0 || await update(action.id, updates)) setEditing(false);
      }}>
        <label htmlFor={titleId} className="block text-[12px]">할 일 제목</label>
        <input id={titleId} value={titleDraft} onChange={event => setTitleDraft(event.target.value)} maxLength={120} disabled={disabled} className={`min-h-11 w-full rounded-[9px] border border-[var(--color-paper-outline)] bg-[var(--amora-surface)] px-3 text-[13px] ${focus}`} />
        <label htmlFor={editCategoryId} className="block text-[12px]">분야</label>
        <select id={editCategoryId} value={categoryDraft} onChange={event => setCategoryDraft(event.target.value)} disabled={disabled} className={`min-h-11 w-full rounded-[9px] border border-[var(--color-paper-outline)] bg-[var(--amora-surface)] px-2 text-[12px] ${focus}`}>
          <option value="">분야 미지정</option>
          {!category && action.categoryKey && <option value={action.categoryKey}>기존 분야 유지</option>}
          {CATEGORY_CHECKLISTS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={disabled || !titleDraft.trim() || titleDraft.length > 120} className={`${button} ${sharedButtonShape} bg-[var(--amora-ink)]! text-white!`}>수정 저장</Button>
          <Button type="button" disabled={disabled} onClick={() => setEditing(false)} className={sharedOutlineButton}>취소</Button>
        </div>
      </form>}
      {action.description && <p className="mb-[10px] rounded-[9px] bg-[var(--amora-warm)] px-[11px] py-[9px] text-[12.5px] leading-[1.55] break-words whitespace-pre-wrap text-[var(--amora-muted)]">{action.description}</p>}
      {!category && !editing && (
        <form className="mb-3" onSubmit={(event) => { event.preventDefault(); if (categoryChoice) void update(action.id, { category_key: categoryChoice }); }}>
          <label htmlFor={selectId} className="mb-2 block text-[11.5px] font-semibold text-[var(--amora-rose-deep)]">어느 분야에 넣을까요?</label>
          <div className="flex flex-wrap gap-2">
            <select id={selectId} value={categoryChoice} onChange={(event) => setCategoryChoice(event.target.value)} disabled={disabled} className={`min-h-11 min-w-0 flex-1 rounded-[9px] border border-[var(--color-paper-outline)] bg-[var(--amora-surface)] px-2 text-[12px] text-[var(--amora-soft)] ${focus}`}>
              <option value="">21개 분야에서 선택</option>
              {CATEGORY_CHECKLISTS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
            <button type="submit" disabled={disabled || !categoryChoice} className={outlineButton}>저장</button>
          </div>
        </form>
      )}
      <p className="mb-3 flex items-center gap-1.5 text-[11px] leading-relaxed text-[var(--amora-muted)]"><Link2 aria-hidden="true" className="h-3 w-3 shrink-0" />{PREPARATION_SOURCES[action.source]}</p>
      {action.dueDate && <p className="mb-3 text-[11.5px] text-[var(--amora-muted)]">예정일 {preparationDate(action.dueDate) ?? "날짜 확인 필요"}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {action.status === "open" ? (
          <>
            <button type="button" disabled={disabled} onClick={() => void update(action.id, { status: "done" })} className={`${button} bg-[var(--amora-ink)] text-white hover:bg-[var(--amora-soft)]`}><Check aria-hidden="true" className="h-3.5 w-3.5" />완료로 표시</button>
            <button type="button" disabled={disabled} onClick={() => void update(action.id, { status: "dismissed" })} className={outlineButton}>보류·숨김</button>
          </>
        ) : (
          <>
            <span className={`rounded-full px-[9px] py-1 text-[10.5px] font-semibold text-[var(--amora-soft)] ${action.status === "done" ? "bg-[var(--amora-sage-pale)]" : "bg-[var(--amora-low)]"}`}>{action.status === "done" ? "완료한 할 일" : "숨겨 둔 할 일"}</span>
            <button type="button" disabled={disabled} onClick={() => void update(action.id, { status: "open" })} className={outlineButton}>{action.status === "done" ? "다시 진행" : "다시 꺼내기"}</button>
          </>
        )}
        {busy && <span role="status" className="text-[11px] text-[var(--amora-muted)]">저장 중…</span>}
      </div>
      {href && <Link href={href} className={`mt-2 inline-flex min-h-11 items-center gap-1 text-[11.5px] text-[var(--amora-accent)] underline underline-offset-4 ${focus}`}>연결된 화면 보기<ArrowUpRight aria-hidden="true" className="h-3 w-3" /></Link>}
    </article>
  );
}

export default function AmoraDecisionBoard() {
  const { actions, loading, loadingMore, error, count, truncated, nextCursor, loadMore, refresh, update, updatingIds, updateError, isDemo } = useAmoraPreparationActions();
  const [activeStatus, setActiveStatus] = useState<AmoraActionStatus>("open");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const searchId = useId();
  const filtered = useMemo(() => filterPreparationActions(actions, category, query), [actions, category, query]);
  const categories = CATEGORY_CHECKLISTS.filter((item) => actions.some((action) => action.categoryKey === item.key));
  const unsortedCount = actions.filter((action) => !preparationCategory(action.categoryKey)).length;
  const activeColumn = PREPARATION_COLUMNS.find((column) => column.status === activeStatus)!;
  const statusCount = (status: AmoraActionStatus) => filtered.filter((action) => action.status === status).length;
  const categoryButton = (value: string, label: string, amount: number) => (
    <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)} className={`${button} shrink-0 border ${category === value ? "border-[var(--amora-ink)] bg-[var(--amora-ink)] text-white" : "border-[var(--color-paper-outline)] bg-[var(--amora-surface)] text-[var(--amora-soft)]"} ${value === "unsorted" ? "border-dashed" : ""}`}>
      {label}<span className="text-[11px] tabular-nums">{amount}</span>
    </button>
  );

  return (
    <div className="min-w-0 bg-[var(--amora-bg)] px-[18px] pt-[14px] pb-8 text-[var(--amora-soft)] lg:px-9 lg:pt-6 lg:pb-9">
      <nav aria-label="아모라 화면 이동" className="mb-3 flex flex-wrap gap-x-4 xl:hidden">
        <Link href={weddingPath("/chat/missions")} className={`inline-flex min-h-11 items-center gap-1 text-[12px] text-[var(--amora-muted)] ${focus}`}><ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />오늘의 미션</Link>
        <Link href={weddingPath("/chat")} className={`inline-flex min-h-11 items-center gap-1 text-[12px] text-[var(--amora-accent)] ${focus}`}>대화로 이동<ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" /></Link>
      </nav>
      <Link href={weddingPath("/saved")} className={`mb-3 inline-flex min-h-11 items-center gap-1 text-[12px] text-[var(--amora-accent)] underline underline-offset-4 ${focus}`}>저장한 아모라 이야기 보기<ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" /></Link>
      <div className="mb-5 hidden items-start gap-[14px] rounded-[14px] border border-[var(--amora-line)] bg-[var(--amora-warm)] px-[18px] py-4 lg:flex">
        <CircleHelp aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--amora-rose-deep)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] leading-relaxed font-medium text-[var(--amora-ink)]">카드의 상태는 직접 바꿉니다 — 완료한 일과 남은 일을 한눈에.</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--amora-muted)]">저장된 할 일을 모았어요. 완료 표시는 한 분이 할 수 있고, 체크리스트와 같은 21개 분야로 정리할 수 있어요.</p>
        </div>
        <details className="max-w-[230px] text-[11.5px] text-[var(--amora-muted)]"><summary className={`flex min-h-11 cursor-pointer items-center rounded-full border border-[var(--color-paper-outline)] px-3 ${focus}`}>분류 방식 자세히</summary><p className="pt-2 leading-relaxed">카드에 저장된 분야를 그대로 보여줘요. 분야가 없거나 체크리스트와 연결되지 않으면 직접 선택할 수 있어요. 완료는 할 일의 상태이며 두 사람의 합의 여부를 뜻하지 않아요.</p></details>
      </div>
      {isDemo && <p role="note" className="mb-4 rounded-[9px] bg-[var(--amora-warm)] px-3 py-2 text-[12px] text-[var(--amora-rose-deep)]">체험용 샘플 데이터예요. 상태와 분야 변경은 이 화면에서만 유지되고 실제 준비 기록에 저장되지 않아요.</p>}
      <div className="mb-3 flex rounded-[11px] bg-[var(--amora-low)] p-[3px] lg:hidden" role="group" aria-label="할 일 상태">
        {PREPARATION_COLUMNS.map((column) => <button key={column.status} type="button" aria-pressed={activeStatus === column.status} onClick={() => setActiveStatus(column.status)} className={`flex min-h-[58px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[9px] text-[12.5px] ${focus} ${activeStatus === column.status ? "bg-[var(--amora-surface)] font-semibold text-[var(--amora-ink)] shadow-sm" : "text-[var(--amora-muted)]"}`}><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${column.dot}`} />{column.label}<span className="text-[11px] tabular-nums">{statusCount(column.status)}</span></button>)}
      </div>
      <p className="border-b border-[var(--amora-line)] pb-3 text-[11.5px] leading-[1.5] text-[var(--amora-muted)] lg:hidden">{activeColumn.rule}</p>
      <div className="flex min-w-0 flex-col gap-3 py-3 lg:flex-row lg:items-start lg:pt-0">
        <div aria-label="분야 필터" className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 lg:flex-wrap">
          {categoryButton("all", "전체", actions.length)}
          {categories.map((item) => categoryButton(item.key, item.label, actions.filter((action) => action.categoryKey === item.key).length))}
          {unsortedCount > 0 && categoryButton("unsorted", "분야 확인 필요", unsortedCount)}
        </div>
        <div className="relative shrink-0 lg:w-[200px]">
          <label htmlFor={searchId} className="sr-only">불러온 카드 검색</label>
          <Search aria-hidden="true" className="pointer-events-none absolute top-3.5 left-3 h-4 w-4 text-[var(--amora-muted)]" />
          <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="카드 검색" className={`min-h-11 w-full rounded-full border border-[var(--color-paper-outline)] bg-[var(--amora-surface)] pr-3 pl-9 text-[12px] placeholder:text-[var(--amora-muted)] ${focus}`} />
        </div>
      </div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-3 text-[11.5px] leading-relaxed text-[var(--amora-muted)]">
        <p>{truncated ? `전체 ${count}개 중 ${actions.length}개를 불러왔어요. 아래 숫자와 검색은 불러온 카드 기준이에요.` : `불러온 카드 ${actions.length}개 · 카드의 분야를 누르면 해당 체크리스트로 이어져요.`}</p>
        <button type="button" onClick={() => void refresh()} disabled={loading || loadingMore || updatingIds.size > 0 || isDemo} className={`${button} px-0 text-[var(--amora-accent)]`}><RefreshCw aria-hidden="true" className="h-3 w-3" />새로고침</button>
      </div>
      {error && <div role="alert" className="mb-4 rounded-[9px] border border-[var(--amora-rose)] bg-[var(--amora-warm)] p-4 text-[13px]"><p>{error}</p>{actions.length > 0 && <p className="mt-1 text-[12px]">마지막으로 불러온 기록이에요. 최신 상태를 다시 확인해 주세요.</p>}<button type="button" onClick={() => void refresh()} disabled={loading} className={`${outlineButton} mt-2`}>다시 불러오기</button></div>}
      {updateError && <p role="alert" className="mb-4 rounded-[9px] bg-[var(--amora-rose-pale)] p-3 text-[13px] text-[var(--amora-rose-deep)]">{updateError}</p>}
      {loading && <p role="status" className="py-5 text-center text-[13px] text-[var(--amora-muted)]">준비 기록을 불러오는 중…</p>}
      {!loading && !error && actions.length === 0 ? <div className="rounded-[14px] border border-dashed border-[var(--amora-line)] bg-[var(--amora-surface)] px-5 py-10 text-center"><h2 className="amora-display text-[19px] text-[var(--amora-ink)]">아직 저장된 할 일이 없어요</h2><p className="mt-2 text-[13px] text-[var(--amora-muted)]">아모라와 준비할 일을 정리하고, 제안 카드에서 직접 추가해 보세요.</p><Link href={weddingPath("/chat")} className={`${button} mt-4 bg-[var(--amora-ink)] text-white`}>아모라와 이야기하기</Link></div> : actions.length > 0 && (
        <div className="grid min-w-0 gap-5 lg:grid-cols-3">
          {PREPARATION_COLUMNS.map((column) => {
            const columnActions = filtered.filter((action) => action.status === column.status);
            return <section key={column.status} aria-label={`${column.label} 할 일`} className={`min-w-0 ${activeStatus === column.status ? "block" : "hidden lg:block"}`}>
              <div className="lg:mb-3 lg:border-b lg:border-[var(--amora-line)] lg:pb-3"><h2 className="sr-only items-center gap-2 text-[14.5px] font-semibold text-[var(--amora-ink)] lg:not-sr-only lg:flex"><span aria-hidden="true" className={`h-[9px] w-[9px] rounded-full ${column.dot}`} />{column.label}<span className="text-[12px] font-normal text-[var(--amora-muted)]">{columnActions.length}</span></h2><p className="mt-1 hidden text-[11.5px] leading-relaxed text-[var(--amora-muted)] lg:block">{column.rule}</p></div>
              <div className="space-y-[10px] lg:space-y-3">{columnActions.length ? columnActions.map((action) => <PreparationCard key={action.id} action={action} busy={updatingIds.has(action.id)} update={update} />) : <p className="rounded-[14px] border border-dashed border-[var(--amora-line)] p-5 text-center text-[12px] leading-relaxed text-[var(--amora-muted)]">{query || category !== "all" ? "이 조건에 맞는 카드가 없어요." : "이 상태의 할 일이 없어요."}</p>}</div>
            </section>;
          })}
        </div>
      )}
      {nextCursor && <div className="mt-5 text-center">
        <p className="mb-2 text-[12px] text-[var(--amora-muted)]">최근에 등록한 순서예요. 더 불러오면 이전 카드도 검색하고 분류할 수 있어요.</p>
        <Button type="button" onClick={() => void loadMore()} disabled={loading || loadingMore || updatingIds.size > 0} className={sharedOutlineButton}>{loadingMore ? "이전 기록을 불러오는 중…" : "이전 기록 더 보기"}</Button>
      </div>}
    </div>
  );
}
