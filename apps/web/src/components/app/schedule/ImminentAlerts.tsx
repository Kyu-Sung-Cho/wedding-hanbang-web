"use client";

import { useState } from "react";
import {
  FileText,
  Clock,
  ChevronDown,
  ChevronUp,
  Users,
  Building2,
  Camera,
  Shirt,
  Palette,
  Gem,
  Flower2,
  Plane,
  Home,
  Key,
  Mail,
  Gift,
  Video,
  Package,
  Sparkles,
  Flower,
  Heart,
  Mic,
  Box,
} from "lucide-react";
import ScheduleProgress from "./ScheduleProgress";
import type { ImminentCategory } from "@/utils/imminentChecklist";

const ICON_MAP: Record<string, React.ElementType> = {
  FileText,
  Users, Building2, Camera, Shirt, Palette, Video, Gem, Package,
  Flower2, Plane, Home, Key, Mail, Gift,
  Sparkles, Flower, Heart, Mic, Box,
};

interface Props {
  items: ImminentCategory[];
  onCategoryClick: (key: string) => void;
  /**
   * 이 패널의 이름은 「날짜를 정할 항목」인데, 여기서 날짜를 정할 방법이 없었다.
   * 행을 누르면 체크리스트 창이 열려서, 날짜를 잡으려면 화면 위 `일정 추가`로 가
   * 분야를 다시 고르는 수밖에 없었다. 그래서 행에서 바로 날짜를 잡게 한다.
   */
  onScheduleClick: (key: string) => void;
}

export default function ImminentAlerts({ items, onCategoryClick, onScheduleClick }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);

  if (items.length === 0) return null;

  const needsScheduleCount = items.filter((i) => !i.hasScheduledEvent).length;

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-2 pb-3 text-left"
      >
        <span className="min-w-0 text-[11px] text-[var(--amora-muted)]">날짜를 정할 항목 · {items.length}건</span>
        <span className="flex shrink-0 items-center gap-2">
          {needsScheduleCount > 0 && (
            <span className="rounded-full bg-[var(--amora-ink)] px-2 py-1 text-[10px] font-medium text-white">
              {needsScheduleCount} 일정 필요
            </span>
          )}
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-[var(--amora-muted)]" /> : <ChevronDown className="h-3.5 w-3.5 text-[var(--amora-muted)]" />}
        </span>
      </button>
      {expanded && (
        <div>
          <div className="divide-y divide-[var(--amora-line)]">
            {(showAll ? items : items.slice(0, 4)).map((item) => {
              const IconComp = ICON_MAP[item.icon] ?? Clock;
              const pct = item.totalCount > 0 ? Math.round((item.doneCount / item.totalCount) * 100) : 0;
              return (
                <div key={item.key} className="flex items-center gap-2 py-3">
                  <button
                    type="button"
                    onClick={() => onCategoryClick(item.key)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-[var(--amora-warm)] text-[var(--amora-soft)]">
                      <IconComp className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[12.5px] font-semibold text-[var(--amora-ink)]">{item.label}</span>
                        <span className="text-[10.5px] text-[var(--amora-muted)]">{item.doneCount}/{item.totalCount}</span>
                      </span>
                      <ScheduleProgress value={pct} label={`${item.label} 준비 진행률`} className="mt-1.5" />
                    </span>
                  </button>
                  {!item.hasScheduledEvent && (
                    <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                      <span className="rounded-full bg-[var(--amora-rose-pale)] px-1.5 py-0.5 text-[9px] text-[var(--amora-rose-deep)]">일정 필요</span>
                      <button
                        type="button"
                        aria-label={`${item.label} 날짜 잡기`}
                        onClick={() => onScheduleClick(item.key)}
                        className="tap-area rounded-full border border-[var(--amora-line)] bg-white px-2.5 py-1 text-[10.5px] font-medium text-[var(--amora-soft)] transition-colors hover:bg-[var(--amora-warm)]"
                      >
                        날짜 잡기
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {items.length > 4 && <button type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)} className="mb-3 w-full rounded-full border border-[var(--amora-line)] py-2 text-[11px] text-[var(--amora-soft)]">{showAll ? "간단히 보기" : `${items.length}개 항목 모두 보기`}</button>}
          <p className="border-t border-[var(--amora-line)] pt-3 text-[10px] leading-[1.7] text-[var(--amora-muted)]">
            표시 순서는 기본 일정 기준이며, 업체나 가족과 정한 실제 날짜가 우선입니다.
          </p>
        </div>
      )}
    </div>
  );
}
