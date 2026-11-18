"use client";

import { useId, useSyncExternalStore } from "react";

import Button from "@/components/ui/Button";
import {
  getJoinedDashboardMarkerSnapshot,
  JOINED_PLAN_REVIEW_PROMPT,
  notifyJoinedDashboardMarkerChanged,
  removeJoinedDashboardMarker,
  subscribeJoinedDashboardMarker,
} from "@/lib/amora/dashboardCompanion";
import { formatLoungeWon } from "@/lib/amora/loungeSummary";
import { formatCalendarDate } from "@/lib/utils/weddingDate";
import { weddingPath } from "@/lib/weddingPaths";

/**
 * 파트너 합류 직후의 "이제 이 계획을 함께 봐요" 카드(옛 웨딩 라운지에서 옮겨 왔다, 2026-11-17 파운더 디자인 아티팩트
 * 원문: 이 디자인 완전 같아야해). 청첩장 홈의 알림 자리(사진 머리 아래)에 온다.
 *
 * 온보딩이 코드로 합류한 사람을 `/wedding/lounge?joined=1` 로 보내고, 이 카드는 그 표시와 상대가 실제로 들어와
 * 있다는 확인이 둘 다 있을 때만 뜬다. 지금 함께 보게 된 계획을 읽어 줄 뿐 아무것도 저장하거나 바꾸지 않는다.
 *
 * 앱의 같은 카드(`apps/mobile/src/components/lounge/JoinedPlanHandoff.tsx`)는 이 파일의 문장과 글자 그대로 같아야
 * 한다. 앱 시험(`apps/mobile/src/__tests__/joinedPlanHandoff.test.mjs`)이 웹 카드의 문장을 이 파일에서 찾는다.
 */

/** 주소의 합류 표시(`?joined=1`). 서버 그림과 하이드레이션 중에는 없는 것으로 본다. */
export function useJoinedPlanMarker(): boolean {
  return useSyncExternalStore(subscribeJoinedDashboardMarker, getJoinedDashboardMarkerSnapshot, () => false);
}

/** "이 내용 확인했어요": 주소의 표시만 지운다. 아무것도 저장하지 않고 어디로도 보내지 않는다. */
export function dismissJoinedHandoff(): void {
  const nextUrl = removeJoinedDashboardMarker(window.location.pathname, window.location.search, window.location.hash);
  window.history.replaceState(window.history.state, "", nextUrl);
  notifyJoinedDashboardMarkerChanged();
}

function formatFullDate(value: string | null | undefined): string {
  return formatCalendarDate(value, { year: "numeric", month: "long", day: "numeric" }) ?? "날짜 미정";
}

export type JoinedPlanFacts = {
  weddingDate: string | null;
  venue: string | null;
  totalBudget: number;
  /** 사람이 직접 체크한 항목 수와 전체 항목 수. */
  checked: number;
  total: number;
};

function HandoffMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[18px] bg-inv-white px-3.5 py-3 shadow-[0_0_0_1px_#EEEAE6]">
      <dt className="text-[12px] text-inv-muted">{label}</dt>
      <dd className="truncate text-[15px] font-medium text-inv-ink">{value}</dd>
      {note ? <dd className="truncate text-[12px] text-inv-muted">{note}</dd> : null}
    </div>
  );
}

export default function JoinedPlanHandoffNotice({ facts, onDismiss }: { facts: JoinedPlanFacts; onDismiss: () => void }) {
  const titleId = useId();
  const percent = facts.total > 0 ? Math.round((facts.checked / facts.total) * 100) : 0;
  const reviewHref = weddingPath(`/chat?${new URLSearchParams({ prefill: JOINED_PLAN_REVIEW_PROMPT })}`);

  return (
    <section
      data-testid="joined-plan-handoff"
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-[24px] bg-inv-paper-soft p-5 shadow-[inset_0_0_0_1px_#EEEAE6]"
    >
      <div className="flex flex-col gap-1">
        <p className="text-[12px] text-inv-muted">함께 준비 시작</p>
        <h2 id={titleId} className="font-inv-serif text-[18px] font-bold">
          이제 이 계획을 함께 봐요
        </h2>
        <p className="text-[14px] leading-[1.6] text-inv-body">
          이제 두 분이 함께 보는 현재 계획이에요. 이 화면을 열면서 새로 저장하거나 변경한 내용은 없어요.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <HandoffMetric label="결혼식 날짜" value={formatFullDate(facts.weddingDate)} />
        <HandoffMetric label="장소" value={facts.venue?.trim() || "장소 미정"} />
        <HandoffMetric label="총 예산" value={facts.totalBudget > 0 ? formatLoungeWon(facts.totalBudget) : "미입력"} />
        <HandoffMetric label="준비 진행" value={`${percent}%`} note={`${facts.checked}/${facts.total}개 체크`} />
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button href={reviewHref} variant="ink" size="pill-46" weight="bold" className="px-[22px]">
          함께 확인할 내용 찾기
        </Button>
        <Button variant="plain" size="pill-46" className="px-4" onClick={onDismiss}>
          이 내용 확인했어요
        </Button>
      </div>
    </section>
  );
}
