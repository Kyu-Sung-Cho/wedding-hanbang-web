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
import Button from "@/components/ui/Button";
import type { ImminentCategory } from "@/utils/imminentChecklist";

const ICON_MAP: Record<string, React.ElementType> = {
  FileText,
  Users, Building2, Camera, Shirt, Palette, Video, Gem, Package,
  Flower2, Plane, Home, Key, Mail, Gift,
  Sparkles, Flower, Heart, Mic, Box,
};

// 기본 일정과의 거리만 구분한다. 실제 업체·가족 일정의 긴급도를 판정하지 않는다.
const URGENCY_STYLES: Record<string, {
  stripBg: string;
  iconBox: string;
  iconColor: string;
  bar: string;
  badgeBg: string;
  badgeText: string;
}> = {
  overdue: {
    stripBg: "bg-[var(--hb-primary)]",
    iconBox: "bg-[rgba(54,83,78,0.10)]",
    iconColor: "text-[var(--hb-accent-hover)]",
    bar: "bg-[var(--hb-primary)]",
    badgeBg: "bg-[var(--hb-primary)]",
    badgeText: "text-white",
  },
  urgent: {
    stripBg: "bg-[var(--hb-primary)]",
    iconBox: "bg-[#946a6a]/10",
    iconColor: "text-[var(--hb-accent-hover)]",
    bar: "bg-[var(--hb-primary)]",
    badgeBg: "bg-[var(--hb-primary)]",
    badgeText: "text-white",
  },
  soon: {
    stripBg: "bg-[var(--hb-accent)]",
    iconBox: "bg-[rgba(54,83,78,0.12)]",
    iconColor: "text-[var(--hb-accent-hover)]",
    bar: "bg-[var(--hb-accent)]",
    badgeBg: "bg-[var(--hb-accent)]",
    badgeText: "text-white",
  },
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

  if (items.length === 0) return null;

  const needsScheduleCount = items.filter((i) => !i.hasScheduledEvent).length;

  return (
    <div
      className="overflow-hidden rounded-[6px] border border-[var(--hb-hairline)]/70 bg-[var(--hb-surface-page)] animate-fade-in"
    >
      {/* 헤더 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <Clock className="h-4 w-4 shrink-0 text-[var(--hb-text-strong)]" />
            <h3 className="min-w-0 truncate text-[14px] font-semibold text-[var(--hb-text-strong)]">
              날짜를 정할 항목
            </h3>
            <span className="shrink-0 text-[12px] font-medium text-[var(--hb-text-body)]">{items.length}건</span>
          </div>
          {/*
            이 배지가 `지남·급함이 하나라도 있을 때` 안에 중첩돼 있었다. 그래서 마감을
            아직 넘기지 않은 커플 — 즉 **일정대로 잘 가고 있어서 미리 알려줘야 할 사람** — 은
            "몇 건이 날짜가 없다"를 한 번도 못 봤다. 뒤처진 뒤에야 알려주는 셈이었다.
          */}
          {needsScheduleCount > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
              <span className="rounded-full bg-[var(--hb-primary)] px-2 py-0.5 text-[11px] font-semibold text-white">
                {needsScheduleCount} 일정 필요
              </span>
            </div>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="mt-0.5 w-5 h-5 shrink-0 text-[var(--hb-text-muted)]" />
        ) : (
          <ChevronDown className="mt-0.5 w-5 h-5 shrink-0 text-[var(--hb-text-muted)]" />
        )}
      </button>

      {/* 항목 목록 */}
      {expanded && (
        <div
          className="overflow-hidden"
        >
          <div className="divide-y divide-[#F6F3F2]">
            {items.map((item) => {
              const styles = URGENCY_STYLES[item.urgency];
              const IconComp = ICON_MAP[item.icon] ?? Clock;
              const pct = item.totalCount > 0
                ? Math.round((item.doneCount / item.totalCount) * 100)
                : 0;

              return (
                <div
                  key={item.key}
                  className="w-full flex items-stretch hover:bg-[#FAFAF8] transition-colors group"
                >
                  {/* 좌측 컬러 스트립 */}
                  <div className={`w-1 flex-shrink-0 ${styles.stripBg}`} />

                  <button
                    type="button"
                    onClick={() => onCategoryClick(item.key)}
                    className="grid flex-1 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 px-3 py-3 text-left"
                  >
                    {/* 아이콘 */}
                    <div className={`flex h-9 w-9 items-center justify-center rounded-[6px] ${styles.iconBox}`}>
                      <IconComp className={`h-4 w-4 ${styles.iconColor}`} />
                    </div>

                    {/* 카테고리 정보 */}
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-[14px] font-semibold text-[var(--hb-text-strong)]">
                          {item.label}
                        </span>
                        <span className="shrink-0 text-[12px] font-medium text-[var(--hb-text-body)]">
                          {item.doneCount}/{item.totalCount}
                        </span>
                      </div>
                      {/* 진행률 바 */}
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#efe6d7]">
                        <div
                          className={`h-full rounded-full transition-all ${styles.bar}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/*
                      이 배지는 `hasScheduledEvent` 를 보지 않고 **늘** 그려졌다. 그래서 이미
                      날짜를 잡아 둔 분야에도 "일정 필요"라고 말했다. 머리의 개수는
                      날짜 없는 것만 세므로 배지와 개수가 서로 다른 말을 하고 있었다.
                    */}
                    {!item.hasScheduledEvent && (
                      <span className={`col-start-2 w-fit rounded-full px-2.5 py-1 text-[12px] font-semibold ${styles.badgeBg} ${styles.badgeText}`}>
                        일정 필요
                      </span>
                    )}
                  </button>

                  {!item.hasScheduledEvent && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onScheduleClick(item.key)}
                      className="mr-3 shrink-0 self-center"
                    >
                      날짜 잡기
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="border-t border-[var(--hb-hairline)]/70 px-4 py-3 text-[11px] leading-5 text-[var(--hb-text-body)]">
            표시 순서는 기본 일정 기준이며, 업체나 가족과 정한 실제 날짜가 우선입니다.
          </p>
        </div>
      )}
    </div>
  );
}
