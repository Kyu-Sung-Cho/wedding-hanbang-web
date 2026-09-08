"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Check, ChevronRight, HeartHandshake, ListChecks, MessageCircle, Plane, RefreshCw, Sparkles, Ticket, Users } from "lucide-react";
import { useAmoraPreparationActions } from "@/hooks/useAmoraPreparationActions";
import { buildAmoraMissionModel, type AmoraMissionCard, type MissionGroup } from "@/lib/amora/missions";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";
import Button from "@/components/ui/Button";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--amora-accent)]";
const BUTTON_FOCUS = `${FOCUS} focus-visible:!outline-solid focus-visible:!ring-0 focus-visible:!ring-offset-0`;
const GROUP_ICONS = [HeartHandshake, Building2, Ticket, Sparkles, Plane];

function PreparationPath({ groups, available, selectedGroupId, expanded, onSelect, pathRef, children }: {
  groups: MissionGroup[]; available: boolean; selectedGroupId: string; onSelect(groupId: string): void;
  expanded: boolean; children?: ReactNode;
  pathRef: RefObject<HTMLElement | null>;
}) {
  const currentIndex = groups.findIndex((group) => group.state === "current");
  return (
    <section ref={pathRef} aria-labelledby="mission-path-title" className="mb-4 rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] px-4 pb-3.5 pt-4 md:mb-7 md:rounded-[18px] md:px-8 md:py-[26px]">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2 md:mb-[22px]">
        <h2 id="mission-path-title" className="text-sm font-semibold md:font-normal">
          <span className="md:hidden">{groups[currentIndex]?.label ?? "결혼 준비 단계"}</span>
          <span className="amora-display hidden text-[21px] md:inline">결혼 준비 단계</span>
        </h2>
        <span className="text-[11.5px] text-[var(--amora-muted)] md:text-[13px]">
          {currentIndex >= 0 ? `${groups.length}단계 중 ${currentIndex + 1}번째` : available ? "모든 단계를 다시 살펴볼 수 있어요" : "준비 정보 확인이 필요해요"}
        </span>
      </div>
      <ol className="relative grid grid-cols-5 gap-[5px] md:gap-3">
        <li aria-hidden="true" className="absolute left-[10%] right-[10%] top-6 hidden h-0.5 bg-[var(--amora-line)] md:block" />
        {groups.map((group, index) => {
          const Icon = GROUP_ICONS[index];
          const isCurrent = group.state === "current";
          const isDone = group.state === "done";
          return (
            <li key={group.id} className="relative min-w-0">
              <button type="button" disabled={!available} onClick={() => onSelect(group.id)} aria-label={`${group.label} 단계 보기`} aria-pressed={selectedGroupId === group.id} aria-expanded={expanded && selectedGroupId === group.id} aria-controls={expanded ? "selected-mission-stage" : undefined} aria-current={isCurrent ? "step" : undefined} className={`flex min-h-11 w-full flex-col items-center rounded-lg text-center disabled:opacity-60 ${expanded && selectedGroupId === group.id ? "underline decoration-[var(--amora-rose)] underline-offset-4" : ""} ${FOCUS}`}>
                <span aria-hidden="true" className={`mb-2.5 h-1.5 w-full rounded-full md:hidden ${isDone ? "bg-[var(--amora-sage)]" : isCurrent ? "bg-[var(--amora-rose)]" : "bg-[var(--amora-low)]"}`} />
                <span aria-hidden="true" className={`mb-3 hidden size-12 items-center justify-center rounded-full border-2 md:flex ${isDone ? "border-[var(--amora-sage)] bg-[var(--amora-sage-pale)] text-[var(--amora-soft)]" : isCurrent ? "border-[var(--amora-ink)] bg-[var(--amora-ink)] text-white ring-[6px] ring-[var(--amora-rose-pale)]" : "border-[var(--amora-line)] bg-[var(--amora-surface)] text-[var(--amora-muted)]"}`}>
                  {isDone ? <Check size={22} strokeWidth={1.8} /> : <Icon size={22} strokeWidth={1.6} />}
                </span>
                <span className={`text-[10.5px] leading-4 md:hidden ${isCurrent ? "font-bold text-[var(--amora-rose-deep)]" : "text-[var(--amora-muted)]"}`}>{group.shortLabel}</span>
                <span className="hidden text-[13px] font-semibold leading-5 md:block">{group.label}</span>
                <span className="mt-0.5 hidden text-[11.5px] leading-5 text-[var(--amora-muted)] md:block">
                  {!available ? "기록 확인 전" : group.state === "skipped" ? "해당 없음으로 표시" : `${group.completedCategories} / ${group.applicableCategories}개 분야 완료`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {children}
    </section>
  );
}

const CATEGORY_STATUS = { completed: "완료", in_progress: "진행 중", not_started: "시작 전", not_applicable: "해당 없음" };

function MissionStage({ group, recommendation, onOpen, onRecommended, onClose }: {
  group: MissionGroup;
  recommendation: ReturnType<typeof buildAmoraMissionModel>["recommendation"];
  onOpen(categoryKey: string): void;
  onRecommended(): void;
  onClose(): void;
}) {
  const target = group.categories.find(category => category.status === "in_progress")
    ?? group.categories.find(category => category.status === "not_started");
  const isRecommended = group.id === recommendation?.groupId;
  return (
    <section id="selected-mission-stage" aria-labelledby="selected-mission-stage-title" className="mt-4 border-t border-[var(--amora-line)] pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="selected-mission-stage-title" className="amora-display text-[19px] leading-[1.5] md:text-[21px]">{group.label}</h3>
          <p className="mt-1 text-[12px] leading-5 text-[var(--amora-muted)]">{group.completedCategories} / {group.applicableCategories}개 분야 완료{group.excludedCategories > 0 ? ` · 해당 없음 ${group.excludedCategories}개` : ""}</p>
        </div>
        <Button variant="ghost" type="button" onClick={onClose} aria-label="단계 상세 접기" className={`shrink-0 !rounded-lg !px-3 !text-xs !text-[var(--amora-muted)] ${BUTTON_FOCUS}`}>접기</Button>
      </div>
      {isRecommended && <p className="mt-2 text-[12.5px] leading-5 text-[var(--amora-soft)]">{recommendation.reason}</p>}
      {target ? <>
        <p className="mt-3 text-[14px] font-semibold leading-6">{target.label}</p>
        {target.nextItem && <p className="mt-1 text-[12.5px] leading-5 text-[var(--amora-muted)]">다음에 확인할 항목: {target.nextItem}</p>}
        <Button variant="primary" size="lg" type="button" onClick={() => onOpen(target.key)} aria-label={`${target.label} 미션 ${target.status === "in_progress" ? "이어하기" : "시작"}`} className={`mt-3 w-full !whitespace-normal !rounded-[11px] !bg-[var(--amora-ink)] !px-[18px] !text-[14px] !text-white hover:!bg-[var(--amora-ink)] md:w-auto ${BUTTON_FOCUS}`}>
          {target.status === "in_progress" ? "미션 이어하기" : "미션 시작"}<ArrowRight size={15} aria-hidden="true" />
        </Button>
      </> : <p role="status" className="mt-3 text-[13px] leading-6 text-[var(--amora-soft)]">{group.state === "skipped" ? "이 단계는 모두 해당 없음으로 표시했어요. 아래에서 언제든 다시 준비 목록에 넣을 수 있어요." : "이 단계의 적용 분야를 모두 완료했어요. 확인·수정에서 체크를 해제하면 다시 진행 중으로 바뀌어요."}</p>}
      {!isRecommended && recommendation && <Button variant="ghost" type="button" onClick={onRecommended} className={`mt-2 !flex !justify-start !gap-1 !whitespace-normal !rounded-lg !bg-transparent !px-0 !text-[12.5px] !text-[var(--amora-accent)] hover:!bg-transparent ${BUTTON_FOCUS}`}>추천 단계로 돌아가기<ChevronRight size={15} aria-hidden="true" /></Button>}
      <details className="mt-3 border-t border-[var(--amora-line)] pt-1">
        <summary className={`flex min-h-11 cursor-pointer items-center rounded-lg text-[12.5px] font-semibold text-[var(--amora-soft)] ${FOCUS}`}>이 단계의 분야 모두 보기 · {group.categories.length}개</summary>
        <ul className="divide-y divide-[var(--amora-line)]">
          {group.categories.map(category => <li key={category.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-5">{category.label}</p>
              <p className="mt-0.5 text-[11.5px] leading-5 text-[var(--amora-muted)]">{category.declared ? `분야를 ${CATEGORY_STATUS[category.status]}로 표시` : CATEGORY_STATUS[category.status]}{category.status !== "not_applicable" && !category.declared ? ` · ${category.done} / ${category.total}개 체크` : ""}</p>
            </div>
            <Button variant="secondary" type="button" aria-label={`${category.label} 체크리스트 열기`} onClick={() => onOpen(category.key)} className={`shrink-0 !whitespace-normal !rounded-lg !border-[var(--amora-line)] !bg-transparent !px-3 !text-[12px] !text-[var(--amora-accent)] hover:!bg-transparent ${BUTTON_FOCUS}`}>{category.status === "not_applicable" ? "다시 살펴보기" : category.status === "completed" ? "확인·수정" : "열기"}</Button>
          </li>)}
        </ul>
      </details>
      {group.declaredCompleted > 0 && <p className="mt-3 text-xs leading-5 text-[var(--amora-muted)]">분야 전체를 완료로 표시한 기록은 개별 항목의 체크 수에 포함하지 않아요.</p>}
      <p className="mt-3 text-xs leading-5 text-[var(--amora-muted)]">준비 기록에 따라 추천해요. 단계는 자유롭게 열고, 체크를 해제하거나 제외한 분야를 다시 넣을 수 있어요.</p>
      <Link {...weddingLinkProps(group.href)} className={`mt-1 inline-flex min-h-11 items-center gap-1 rounded-lg text-[11.5px] text-[var(--amora-muted)] underline underline-offset-4 ${FOCUS}`}>전체 체크리스트에서 보기<ChevronRight size={13} aria-hidden="true" /></Link>
    </section>
  );
}

function MissionCard({ card, highlighted = false, completed = false, onOpen }: { card: AmoraMissionCard; highlighted?: boolean; completed?: boolean; onOpen(categoryKey: string): void }) {
  const Icon = completed ? Check : card.kind === "checklist" ? ListChecks : card.categoryKey === "venue" ? Building2 : MessageCircle;
  const counts = card.counts;
  return (
    <article className={`rounded-2xl border bg-[var(--amora-surface)] p-[18px] md:px-[22px] md:py-5 ${highlighted ? "border-[var(--amora-rose)] shadow-[0_10px_26px_-16px_rgba(167,123,116,0.5)]" : "border-[var(--amora-line)]"}`}>
      <div className="flex items-start gap-3 md:gap-4">
        <span aria-hidden="true" className={`flex size-[38px] shrink-0 items-center justify-center rounded-[10px] md:size-[42px] md:rounded-[11px] ${completed ? "bg-[var(--amora-sage-pale)] text-[var(--amora-soft)]" : "bg-[var(--amora-warm)] text-[var(--amora-rose-deep)]"}`}><Icon size={21} strokeWidth={1.6} /></span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-x-2.5 gap-y-1.5">
            <h3 className="break-words text-[15px] font-semibold leading-[1.45] md:text-[15.5px]">{card.title}</h3>
            <span className="hidden shrink-0 rounded-full bg-[var(--amora-low)] px-[9px] py-[3px] text-[11px] leading-4 text-[var(--amora-soft)] md:inline-flex">{card.badge}</span>
          </div>
          <p className="text-[11.5px] leading-5 text-[var(--amora-muted)] md:hidden">{card.badge}{counts ? ` · ${counts.done} / ${counts.total}개 체크` : ""}</p>
          <p className="mb-3 mt-2 hidden break-words text-[13.5px] leading-[1.6] text-[var(--amora-soft)] md:block">{card.description}</p>
          <div className="hidden md:block"><MissionCardAction card={card} highlighted={highlighted} completed={completed} onOpen={onOpen} /></div>
        </div>
      </div>
      <p className="mb-3.5 mt-2.5 break-words text-[13px] leading-[1.65] text-[var(--amora-soft)] md:hidden">{card.description}</p>
      {counts && <span className="sr-only">{counts.total}개 중 {counts.done}개 완료</span>}
      <div className="md:hidden"><MissionCardAction card={card} highlighted={highlighted} completed={completed} onOpen={onOpen} /></div>
    </article>
  );
}

function MissionCardAction({ card, highlighted, completed, onOpen }: { card: AmoraMissionCard; highlighted: boolean; completed: boolean; onOpen(categoryKey: string): void }) {
  const counts = card.counts;
  return (
    <>
      {counts && <progress aria-label={`${card.title} 체크 진행률`} value={counts.done} max={counts.total || 1} className="mb-3.5 block h-[5px] w-full overflow-hidden rounded-full border-0 bg-[var(--amora-low)] text-[var(--amora-rose)] [&::-moz-progress-bar]:bg-[var(--amora-rose)] [&::-webkit-progress-bar]:bg-[var(--amora-low)] [&::-webkit-progress-value]:bg-[var(--amora-rose)]" />}
      <div className={`flex flex-wrap items-center gap-3 ${completed || counts ? "justify-between" : "justify-end"}`}>
        {(completed || counts) && <span className="hidden text-xs text-[var(--amora-muted)] md:inline">
          {completed ? "공유 할 일에서 완료로 표시했어요" : counts ? `${counts.done} / ${counts.total}개 체크 완료` : null}
        </span>}
        {!completed && card.kind === "checklist" && card.categoryKey ? <Button variant={highlighted ? "primary" : "secondary"} size="lg" type="button" onClick={() => onOpen(card.categoryKey!)} aria-label={`${card.title} 체크리스트 열기`} className={`w-full !gap-[7px] !whitespace-normal !rounded-[11px] !px-[18px] py-[9px] !text-[14.5px] md:min-h-11 md:w-auto md:!rounded-lg md:!text-[13.5px] ${highlighted ? "!border-[var(--amora-ink)] !bg-[var(--amora-ink)] !text-white hover:!bg-[var(--amora-soft)]" : "!border-[var(--amora-muted)] !bg-[var(--amora-surface)] !text-[var(--amora-ink)] hover:!bg-[var(--amora-warm)]"} ${BUTTON_FOCUS}`}>{card.cta}<ArrowRight size={15} aria-hidden="true" /></Button> : <Link {...weddingLinkProps(completed ? "/chat/board?view=tasks" : card.href)} className={`inline-flex min-h-12 w-full items-center justify-center gap-[7px] rounded-[11px] px-[18px] py-[9px] text-[14.5px] font-semibold md:min-h-11 md:w-auto md:rounded-lg md:text-[13.5px] ${completed || !highlighted ? "border border-[var(--amora-muted)] bg-[var(--amora-surface)] text-[var(--amora-ink)] hover:bg-[var(--amora-warm)]" : "bg-[var(--amora-ink)] text-white hover:bg-[var(--amora-soft)]"} ${FOCUS}`}>
          {completed ? "준비 기록 보기" : card.cta}<ArrowRight size={15} aria-hidden="true" />
        </Link>}
      </div>
    </>
  );
}

export default function AmoraMissions() {
  const { user, profile, isDemo } = useAuthStore();
  // 연결이 돌아와도 이전 창·초점·선택을 복원하지 않도록 소유권 변경마다 새 뷰를 만든다.
  const ownerKey = JSON.stringify([user?.id, profile?.id, profile?.couple_id, isDemo]);
  return <AmoraMissionsView key={ownerKey} />;
}

function AmoraMissionsView() {
  const { user, profile, partner, journey, isInitialized, isLoading: authLoading, isDemo } = useAuthStore();
  const { actions, loading, error, refresh, open_count: openCount, truncated } = useAmoraPreparationActions();
  const scopeReady = Boolean(user && profile?.id === user.id && profile.couple_id);
  const matchingJourney = scopeReady && journey?.couple_id === profile?.couple_id ? journey : null;
  const partnerLinked = Boolean(scopeReady && partner && partner.id !== profile?.id && partner.couple_id === profile?.couple_id);
  const model = buildAmoraMissionModel(matchingJourney?.progress ?? null, scopeReady && !error ? actions : []);
  const viewScope = scopeReady ? `${user!.id}:${profile!.couple_id}` : null;
  const [selection, setSelection] = useState<{ scope: string; groupId: string } | null>(null);
  const [stageExpanded, setStageExpanded] = useState(false);
  const [openedCategory, setOpenedCategory] = useState<{ scope: string; key: string } | null>(null);
  const pathRef = useRef<HTMLElement>(null);
  const checklistTriggerRef = useRef<HTMLElement | null>(null);
  const sheetWasOpen = useRef(false);
  const checklistAvailable = model.hasChecklistData && isInitialized && !authLoading;
  const visibleCategory = checklistAvailable && openedCategory?.scope === viewScope ? openedCategory?.key : null;
  useEffect(() => {
    if (sheetWasOpen.current && !visibleCategory && openedCategory === null) {
      const original = checklistTriggerRef.current;
      // 단계 완료로 시작 버튼이 사라졌으면 같은 단계 선택 버튼으로 돌아온다.
      if (original?.isConnected) original.focus();
      else pathRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
    }
    sheetWasOpen.current = Boolean(visibleCategory);
  }, [visibleCategory, openedCategory]);
  const selectedGroup = model.groups.find(group => group.id === (selection?.scope === viewScope ? selection?.groupId : model.currentGroupId)) ?? model.groups[0];
  const closeStage = () => {
    setStageExpanded(false);
    pathRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
  };
  const openCategory = (categoryKey: string) => {
    if (!viewScope || !checklistAvailable) return;
    const group = model.groups.find(item => item.categories.some(category => category.key === categoryKey));
    if (!group) return;
    checklistTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 저장 후 추천이 바뀌어도 닫기 전의 진입 버튼을 남겨 초점과 수정 흐름을 지킨다.
    setSelection({ scope: viewScope, groupId: group.id });
    setOpenedCategory({ scope: viewScope, key: categoryKey });
  };
  const busy = !isInitialized || authLoading || loading;
  const actionsAvailable = scopeReady && !busy && !error;
  const totalChecked = model.groups.reduce((sum, group) => sum + group.done, 0);
  const totalItems = model.groups.reduce((sum, group) => sum + group.total, 0);
  const cards = model.cards;

  return (
    <div className="mx-auto max-w-[1440px] px-[18px] pb-7 pt-4 text-[var(--amora-ink)] md:px-9 md:py-8">
      <PreparationPath groups={model.groups} available={checklistAvailable} selectedGroupId={selectedGroup.id} expanded={checklistAvailable && stageExpanded} pathRef={pathRef} onSelect={groupId => {
        if (!viewScope || !checklistAvailable) return;
        setSelection({ scope: viewScope, groupId });
        setStageExpanded(true);
      }}>
        {checklistAvailable && stageExpanded && <MissionStage group={selectedGroup} recommendation={model.recommendation} onOpen={openCategory} onRecommended={() => setSelection(null)} onClose={closeStage} />}
      </PreparationPath>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="missions-heading" aria-busy={busy}>
          <p className="mb-1.5 hidden text-[13px] font-semibold text-[var(--amora-rose-deep)] md:block">
            {model.groups.find(group => group.id === model.currentGroupId)?.label ?? "아모라의 제안"}{model.currentGroupId ? " 단계" : ""}
          </p>
          <h2 id="missions-heading" className="amora-display mb-3.5 text-[20px] leading-[1.4] md:mb-5 md:text-[23px]">
            <span className="md:hidden">오늘 이어갈 준비</span>
            <span className="hidden md:inline">오늘 이어서 정할 것</span>
          </h2>

          {busy ? <p role="status" className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-5 text-sm text-[var(--amora-muted)]">우리의 준비 기록을 불러오고 있어요.</p> : (
            <>
              {error && <div role="alert" className="mb-3 rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-[18px]">
                <p className="text-sm font-semibold">공유 할 일을 불러오지 못했어요.</p>
                <p className="mt-1 text-xs leading-5 text-[var(--amora-muted)]">기록이 없는 상태와는 달라요. 잠시 뒤 다시 확인해 주세요.</p>
                <button type="button" onClick={() => void refresh()} className={`mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-[var(--amora-accent)] ${FOCUS}`}><RefreshCw size={15} aria-hidden="true" />다시 불러오기</button>
              </div>}
              {!model.hasChecklistData && <div role="status" className="mb-3 rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-[18px]">
                <p className="text-sm font-semibold">준비 정보를 아직 확인할 수 없어요.</p>
                <p className="mt-1 text-[13px] leading-6 text-[var(--amora-muted)]">준비 정보를 확인하면 체크리스트에서 이어갈 항목을 함께 보여드려요.</p>
                <Link {...weddingLinkProps("/settings")} className={`mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold text-[var(--amora-accent)] ${FOCUS}`}>준비 정보 확인하기<ChevronRight size={15} aria-hidden="true" /></Link>
              </div>}
              {actionsAvailable && openCount === 0 && cards.length > 0 && <p className="mb-3 text-xs leading-5 text-[var(--amora-muted)]">저장된 공유 할 일은 없어요. 체크리스트에서 이어갈 항목을 제안해요.</p>}
              {cards.length > 0 ? <div className="space-y-3 md:space-y-3.5">{cards.map((card, index) => <MissionCard key={card.id} card={card} highlighted={index === 0} onOpen={openCategory} />)}</div> : actionsAvailable && <div className="rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-5">
                <p className="text-sm font-semibold">지금 이어갈 공유 할 일이 없어요.</p>
                <p className="mt-2 text-[13px] leading-6 text-[var(--amora-muted)]">새로 고민되는 준비가 있다면 아모라와 이야기해 보세요.</p>
                <Link {...weddingLinkProps("/chat")} className={`mt-3 inline-flex min-h-12 items-center gap-2 rounded-[11px] bg-[var(--amora-ink)] px-[18px] text-sm font-semibold text-white ${FOCUS}`}>아모라와 이야기하기<ArrowRight size={15} aria-hidden="true" /></Link>
              </div>}
              {actionsAvailable && openCount > cards.filter((card) => card.kind === "action").length && <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3">
                <p className="text-xs leading-5 text-[var(--amora-muted)]">공유 할 일 {openCount}개 남았어요</p>
                <Link {...weddingLinkProps("/chat/board?view=tasks")} className={`inline-flex min-h-11 items-center gap-1 rounded-lg text-[13px] font-semibold text-[var(--amora-accent)] ${FOCUS}`}>모든 공유 할 일 보기<ChevronRight size={15} aria-hidden="true" /></Link>
              </div>}
              {model.completedCard && actionsAvailable && <div className="mt-3 hidden md:mt-3.5 md:block"><MissionCard card={model.completedCard} completed onOpen={openCategory} /></div>}
              {truncated && actionsAvailable && <p className="mt-3 text-xs leading-5 text-[var(--amora-muted)]">공유 할 일이 많아 불러온 목록 중 일부를 보여드려요. 전체 진행 중 수와 보이는 카드 수는 다를 수 있어요.</p>}
            </>
          )}
        </section>

        <aside aria-label="함께하는 준비 요약" className="space-y-4">
          <section className="hidden rounded-2xl border border-[var(--amora-line)] bg-[var(--amora-surface)] p-5 lg:block">
            <h2 className="mb-3.5 text-[13.5px] font-semibold">함께 남긴 공유 할 일</h2>
            {actionsAvailable ? <>
              <p className="amora-display text-[30px] leading-tight text-[var(--amora-rose-deep)]">{model.loadedDoneCount}개 완료</p>
              <p className="mt-2 text-[12.5px] leading-5 text-[var(--amora-muted)]">{truncated ? "불러온 목록에서 완료로 표시한 수예요." : "공유 할 일에서 완료로 표시한 기록이에요."}</p>
              <p className="mt-3 text-[13px] text-[var(--amora-soft)]">진행 중인 공유 할 일 <strong className="font-semibold">{openCount}개</strong></p>
            </> : <p className="text-[13px] leading-6 text-[var(--amora-muted)]">{busy ? "준비 기록을 확인하고 있어요." : "공유 할 일 상태를 확인하지 못했어요."}</p>}
            {model.hasChecklistData && <p className="mt-3 border-t border-[var(--amora-line)] pt-3 text-xs leading-5 text-[var(--amora-muted)]">체크리스트는 {totalItems}개 중 {totalChecked}개를 체크했어요. 공유 할 일 완료와 별도로 집계해요.</p>}
          </section>
          <section className="rounded-[14px] border border-[var(--amora-line)] bg-[var(--amora-warm)] px-4 py-3.5 lg:rounded-2xl lg:bg-[var(--amora-surface)] lg:p-5">
            <h2 className="mb-3.5 hidden text-[13.5px] font-semibold lg:block">같이 준비하고 있어요</h2>
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--amora-rose-pale)] text-[var(--amora-rose-deep)]"><Users size={17} strokeWidth={1.7} /></span>
              <div className="min-w-0 text-[12.5px] leading-[1.55]">
                <p className="break-words font-semibold">{partnerLinked ? `${partner?.name || "파트너"}님과 연결되어 있어요` : "각자의 속도로 준비해도 괜찮아요"}</p>
                <p className="mt-1 text-[var(--amora-muted)]">{partnerLinked ? "공유 할 일과 체크리스트를 함께 볼 수 있어요." : "파트너를 연결하면 같은 준비 기록을 함께 볼 수 있어요."}</p>
              </div>
            </div>
            <Link {...weddingLinkProps(partnerLinked ? "/chat/board" : "/settings")} className={`mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg text-[12.5px] font-semibold text-[var(--amora-accent)] ${FOCUS}`}>{partnerLinked ? "준비 기록 함께 보기" : "파트너 연결 확인하기"}<ChevronRight size={14} aria-hidden="true" /></Link>
          </section>
          <div className="hidden rounded-[14px] bg-[var(--amora-ink)] px-[18px] py-4 text-white lg:block">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-white/15"><ListChecks size={18} strokeWidth={1.6} /></span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold">확인한 준비를 한곳에서</p>
                <p className="mt-1 text-xs leading-[1.65] text-white/80">미션의 체크는 준비 기록에 저장돼요. 체크를 해제하거나 제외한 분야를 복구하면 단계도 다시 계산해요.</p>
              </div>
            </div>
            <Link {...weddingLinkProps("/chat/board")} className={`mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg text-[13px] font-semibold ${FOCUS}`}>준비 기록 보기<ArrowRight size={14} aria-hidden="true" /></Link>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
            <Link {...weddingLinkProps("/chat/board")} className={`inline-flex min-h-11 items-center gap-1 rounded-lg text-[13px] font-semibold text-[var(--amora-accent)] lg:hidden ${FOCUS}`}>준비 기록 보기<ChevronRight size={14} aria-hidden="true" /></Link>
            <Link {...weddingLinkProps("/chat")} className={`inline-flex min-h-11 items-center gap-2 rounded-lg text-[13px] font-semibold text-[var(--amora-accent)] ${FOCUS}`}><MessageCircle size={16} aria-hidden="true" />아모라와 이야기하기</Link>
          </div>
        </aside>
      </div>
      {isDemo && <p role="note" className="mt-4 text-xs leading-5 text-[var(--amora-muted)]">예시 화면 · 준비 상태와 공유 할 일은 데모 데이터예요.</p>}
      {visibleCategory && <CategoryChecklistModal key={`${viewScope}:${visibleCategory}`} categoryKey={visibleCategory} isOpen onClose={() => setOpenedCategory(null)} presentation="planning" />}
    </div>
  );
}
