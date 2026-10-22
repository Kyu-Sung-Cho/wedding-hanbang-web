import Link from "next/link";
import { useState } from "react";
import Button from "@/components/ui/Button";
import { ArrowRight, BookOpen, CalendarDays, Check, ChevronRight, ClipboardCheck, FileCheck2, Split } from "lucide-react";
import AmoraMark from "@/components/ui/AmoraMark";
import { AMORA_ACTION_CLASS } from "@/components/ui/amoraActionStyles";
import type { MissionGroup } from "@/lib/amora/missions";
import { formatLoungeWon } from "@/lib/amora/loungeSummary";
import { mannersPartForCategory } from "@/lib/manners/categoryMap";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { ITEMS as WEDDING_CODE_ITEMS } from "@/constants/weddingCode36";
import { isValidScheduleTime } from "@/utils/scheduleEvents";
import { daysUntilLoungeEvent, type LoungePriorityItem } from "./hubModel";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)]";
const progressClass = "block h-1 w-full overflow-hidden rounded-full border-0 bg-[var(--amora-low)] [&::-moz-progress-bar]:bg-[var(--amora-rose)] [&::-webkit-progress-bar]:bg-[var(--amora-low)] [&::-webkit-progress-value]:bg-[var(--amora-rose)]";

export function PreparationStageRail({ groups }: { groups: readonly MissionGroup[] }) {
  return <section aria-label="결혼 준비 단계" className="min-w-0 lg:rounded-[18px] lg:border lg:border-[var(--amora-line)] lg:bg-white lg:p-5">
    <h2 className="mb-3 hidden text-[14px] font-semibold lg:block">준비 여정 한눈에</h2>
    <div className="flex gap-1 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
      {groups.map((group, index) => <Link key={group.id} {...weddingLinkProps(group.href)} aria-current={group.state === "current" ? "step" : undefined} className={`group flex min-w-[70px] flex-1 flex-col items-center gap-2 rounded-xl px-1 py-2 text-center lg:flex-row lg:gap-3 lg:px-2 lg:text-left ${group.state === "current" ? "lg:bg-[var(--amora-warm)]" : "hover:bg-[var(--amora-warm)]"} ${focus}`}>
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${group.state === "done" ? "bg-[var(--amora-sage-pale)] text-noir-800" : group.state === "current" ? "bg-[var(--amora-ink)] text-white" : "border border-[var(--amora-line)] bg-white text-[var(--amora-muted)]"}`}>
          {group.state === "done" ? <Check size={15} aria-hidden="true" /> : index + 1}
        </span>
        <span className="min-w-0">
          <span className={`block whitespace-nowrap text-[10.5px] lg:text-[12px] ${group.state === "current" ? "font-semibold text-[var(--amora-ink)]" : "text-[var(--amora-soft)]"}`}>{group.shortLabel}</span>
          <span className="mt-0.5 hidden text-[10px] text-[var(--amora-muted)] lg:block">{group.state === "unknown" ? "기록 확인 전" : group.state === "skipped" ? "이번 준비에서 제외" : `${group.completedCategories}/${group.applicableCategories}개 분야 완료`}{group.state === "current" && " · 진행 단계"}</span>
        </span>
        {group.state === "current" && <ChevronRight size={13} className="ml-auto hidden text-[var(--amora-muted)] lg:block" aria-hidden="true" />}
      </Link>)}
    </div>
  </section>;
}

export function LoungePriorityFeed({ items }: { items: readonly LoungePriorityItem[] }) {
  const [showAll, setShowAll] = useState(false);
  return <>
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2 lg:mb-4">
      <div><p className="text-[10.5px] font-medium text-[var(--amora-rose-deep)] lg:text-[12px]">체크리스트 · 일정 한곳에서</p><h2 id="lounge-priority-title" className="amora-display mt-1 text-[19px] lg:text-[22px]">오늘 먼저 확인할 준비</h2></div>
      <Link {...weddingLinkProps("/checklist")} className={`inline-flex min-h-11 items-center gap-1 text-[11px] text-[var(--amora-soft)] ${focus}`}>전체 체크리스트<ChevronRight size={13} aria-hidden="true" /></Link>
    </div>
    <div className="space-y-2.5 lg:space-y-0 lg:rounded-[18px] lg:border lg:border-[var(--amora-line)] lg:bg-white lg:px-6 lg:py-1">
      {items.length === 0 ? <div className="rounded-[14px] border border-[var(--amora-line)] bg-white p-5 lg:border-0 lg:px-0"><Check size={22} className="text-[var(--amora-sage)]" aria-hidden="true" /><h3 className="mt-3 text-[14px] font-semibold">열려 있는 준비 항목이 없어요</h3><p className="mt-1 text-[12px] leading-5 text-[var(--amora-soft)]">완료하거나 제외한 상태를 반영했어요. 새로운 할 일과 일정은 언제든 추가할 수 있어요.</p><Link {...weddingLinkProps("/schedule")} className={`mt-2 inline-flex min-h-11 items-center gap-1 text-[12px] font-semibold text-[var(--amora-accent)] ${focus}`}>일정 확인하기<ArrowRight size={13} aria-hidden="true" /></Link></div> : items.map((item, index) => {
        const checklist = item.kind === "checklist" ? item : null;
        const event = item.kind === "schedule" ? item.event : null;
        const category = checklist?.category;
        const imminent = checklist?.imminent;
        const title = category ? `${category.label} 준비` : event?.title;
        const href = category ? `/checklist?category=${encodeURIComponent(category.key)}` : "/schedule";
        const tag = event ? "다음 일정" : imminent ? "확인 추천" : category?.status === "in_progress" ? "진행 중" : "시작 전";
        const days = event ? daysUntilLoungeEvent(event.date) : null;
        return <article key={category?.key ?? event?.id} className={`${index >= 3 && !showAll ? "hidden lg:grid" : "lg:grid"} rounded-[14px] border border-[var(--amora-line)] bg-white p-[15px] lg:grid-cols-[76px_minmax(0,1fr)] lg:gap-5 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:p-0 lg:py-5 lg:last:border-b-0`}>
          <div className="mb-2 flex items-center gap-2 lg:mb-0 lg:block">
            <span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-medium ${event ? "bg-[var(--amora-sage-pale)] text-noir-800" : imminent ? "bg-[var(--amora-rose-pale)] text-[var(--amora-rose-deep)]" : "bg-[var(--amora-warm)] text-[var(--amora-muted)]"}`}>{tag}</span>
            {event && <span className="text-[10px] text-[var(--amora-muted)] lg:mt-2 lg:block">{days === null ? "날짜 미정" : days === 0 ? "오늘" : `${days}일 후`}</span>}
            {category && <span className="text-[10px] text-[var(--amora-muted)] lg:mt-2 lg:block">체크리스트</span>}
          </div>
          <div className="min-w-0">
            <h3 className="break-words text-[13.5px] font-semibold leading-6 lg:text-[14.5px]">{title}</h3>
            <p className="mt-1 break-words text-[11.5px] leading-[1.7] text-[var(--amora-soft)] lg:text-[12.5px]">{event ? `${event.date.replaceAll("-", ".")} · ${isValidScheduleTime(event.time) ? event.time : "시간 미정"}` : category?.declared ? "준비 상태를 표시해 두었어요. 항목별 체크를 확인해 보세요." : category?.nextItem ?? "체크리스트에서 준비 내용을 확인해 보세요."}</p>
            {imminent && <p aria-label={index === 0 ? "기본 확인 시점 안내" : undefined} className="mt-1.5 text-[10.5px] leading-[1.65] text-[var(--amora-muted)]">
              {imminent.deadlineDaysLeft < 0 ? `기본 확인 시점에서 ${Math.abs(imminent.deadlineDaysLeft)}일 지남` : `기본 확인 시점까지 ${imminent.deadlineDaysLeft}일`} · 실제 일정·완료 여부를 확인해 주세요.
            </p>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              {category ? <div className="min-w-[80px] max-w-[240px] flex-1"><div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] text-[var(--amora-muted)]"><span>직접 체크</span><span>{category.done}/{category.total}</span></div><progress aria-label={`${category.label} 체크 진행`} max={Math.max(1, category.total)} value={category.done} className={progressClass} /></div> : <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[var(--amora-muted)]"><CalendarDays size={13} aria-hidden="true" />등록한 일정</span>}
              <Link {...weddingLinkProps(href)} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[11px] font-medium ${index === 0 ? "bg-[var(--amora-action)] text-white hover:bg-[var(--amora-action-hover)]" : "bg-[var(--amora-warm)] text-[var(--amora-soft)] hover:bg-[var(--amora-low)]"} ${focus}`}>{event ? "일정 확인" : "체크리스트 열기"}<ArrowRight size={12} aria-hidden="true" /></Link>
            </div>
          </div>
        </article>;
      })}
    </div>
    {items.length > 3 && <Button variant="ghost" type="button" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll} className="mt-2 !flex w-full !gap-1 !rounded-none !px-0 !text-[11px] !font-normal !text-[var(--amora-soft)] hover:!bg-transparent lg:!hidden">{showAll ? "3개만 보기" : `${items.length}개 모두 보기`}<ChevronRight size={12} aria-hidden="true" /></Button>}
    {items.some((item) => item.kind === "checklist" && item.imminent) && <p className="mt-2.5 px-1 text-[10px] leading-4 text-[var(--amora-muted)]">기본 확인 시점은 예식일을 기준으로 한 준비 참고값이에요. 직접 정한 일정이 우선해요.</p>}
  </>;
}

export function PreparationRecordPanel({ checked, completed, upcoming }: { checked: number; completed: number; upcoming: number }) {
  return <section className="rounded-[16px] border border-[var(--amora-line)] bg-white p-[18px] lg:p-5">
    <div className="flex items-center justify-between gap-3"><h2 className="text-[14px] font-semibold">준비 기록 모아보기</h2><ClipboardCheck size={16} className="text-[var(--amora-rose)]" aria-hidden="true" /></div>
    <p className="mt-1.5 text-[11px] leading-5 text-[var(--amora-muted)]">지금 계획에 남아 있는 기록이에요.</p>
    <div className="mt-4 divide-y divide-[var(--amora-line)]">
      {[{ label: "직접 체크한 항목", value: `${checked}개`, href: "/checklist" }, { label: "완료로 표시된 분야", value: `${completed}개`, href: "/checklist" }, { label: "등록한 앞으로의 일정", value: `${upcoming}개`, href: "/schedule" }].map((row) => <Link key={row.label} {...weddingLinkProps(row.href)} className={`flex min-h-11 items-center justify-between gap-3 text-[12px] ${focus}`}><span className="text-[var(--amora-soft)]">{row.label}</span><span className="inline-flex items-center gap-2 font-medium">{row.value}<ChevronRight size={12} className="text-[var(--amora-muted)]" aria-hidden="true" /></span></Link>)}
    </div>
  </section>;
}

export function LoungeReferencePanels({ categoryKey, allocated }: { categoryKey: string; allocated: number }) {
  const guide = mannersPartForCategory(categoryKey);
  return <>
    <section className="rounded-[16px] border border-[var(--amora-line)] bg-[var(--amora-warm)] p-[18px]">
      <p className="inline-flex items-center gap-1.5 text-[10px] font-medium text-[var(--amora-rose-deep)]"><FileCheck2 size={13} aria-hidden="true" />계약 전 체크</p>
      <h2 className="mt-2 text-[14px] font-semibold">견적서의 포함 항목부터</h2>
      <p className="mt-2 text-[11.5px] leading-[1.75] text-[var(--amora-soft)]">기본 금액, 필수 추가금, 선택 옵션을 나눠서 확인해요. 스튜디오·드레스·메이크업은 원본 사진과 도우미 비용도 살펴보세요.</p>
      {allocated > 0 && <p className="mt-3 border-t border-[var(--amora-line)] pt-3 text-[11px] leading-5 text-[var(--amora-soft)]">현재 스튜디오·드레스·메이크업 배정액 <strong className="font-semibold">{formatLoungeWon(allocated)}</strong><span className="block text-[10px] text-[var(--amora-muted)]">입력한 세 분야의 합계 · 계약 여부와는 별도예요</span></p>}
      <Link {...weddingLinkProps("/community/quote-check")} className={`mt-1 inline-flex min-h-11 items-center gap-1.5 text-[11px] font-semibold ${focus}`}>견적 확인 도구 열기<ArrowRight size={12} aria-hidden="true" /></Link>
    </section>
    <section className="rounded-[16px] border border-[var(--amora-line)] bg-white p-[18px]">
      <p className="inline-flex items-center gap-1.5 text-[10px] text-[var(--amora-muted)]"><BookOpen size={13} aria-hidden="true" />지금 준비에 맞는 가이드</p>
      <h2 className="mt-2 text-[14px] font-semibold">{guide?.title ?? "결혼 준비, 하나씩 알아보기"}</h2>
      <p className="mt-2 text-[11.5px] leading-[1.75] text-[var(--amora-soft)]">처음이라 낯선 순서와 확인할 내용을 가이드에서 살펴보세요.</p>
      <Link {...weddingLinkProps(guide ? `/manners/${guide.slug}` : "/manners")} className={`mt-1 inline-flex min-h-11 items-center gap-1.5 text-[11px] font-semibold ${focus}`}>가이드 읽기<ArrowRight size={12} aria-hidden="true" /></Link>
    </section>
    {/* 라운지에서도 공개 화면과 같은 웨딩코드 문항·결과로 이어 준다. */}
    <section className="rounded-[16px] border border-[var(--amora-line)] bg-white p-[18px]" data-lounge-preparation-style="">
      <p className="inline-flex items-center gap-1.5 text-[10px] text-[var(--amora-muted)]"><Split size={13} aria-hidden="true" />고른 답으로 이야기하기</p>
      <h2 className="mt-2 text-[14px] font-semibold">웨딩코드</h2>
      <p className="mt-2 text-xs leading-[1.75] text-[var(--amora-soft)]">{WEDDING_CODE_ITEMS.length}문항으로 내가 원하는 결혼식과 준비 방식을 살펴봐요. 답하기 어려운 질문은 건너뛸 수 있어요.</p>
      <p className="mt-2 text-xs leading-[1.75] text-[var(--amora-soft)]">19문항(약 3분)으로 나의 결혼 준비 기준을 찾고 파트너와 나란히 비교해 보세요.</p>
      <Link {...weddingLinkProps("/preparation-style")} className={`mt-1 inline-flex min-h-11 items-center gap-1.5 text-[11px] font-semibold ${focus}`}>웨딩코드 보기<ArrowRight size={12} aria-hidden="true" /></Link>
    </section>
    <Link {...weddingLinkProps("/chat")} className={`block rounded-[16px] border border-[var(--hb-amora-line,#8F6662)] bg-[var(--hb-amora-surface,#FBF8F2)] p-[18px] text-[var(--hb-amora-ink,#7D5753)] transition-colors hover:bg-[var(--hb-amora-hover,#EADDD8)] ${focus}`}>
      <span className="flex items-center gap-2 text-[10px]"><AmoraMark size={13} aria-hidden="true" />AMORA</span><span className="amora-display mt-2 block text-[17px]">혼자 고민하지 않아도 괜찮아요</span><span className="mt-2 block text-[11px] leading-[1.75]">정리가 안 되는 준비, 아모라와 하나씩 이야기해 봐요.</span><span className={`${AMORA_ACTION_CLASS} mt-4`}><AmoraMark size={20} />아모라와 대화하기<ArrowRight size={12} aria-hidden="true" /></span>
    </Link>
  </>;
}
