"use client";

/**
 * 양측 분담 — 신부 측이 얼마, 신랑 측이 얼마, 함께가 얼마.
 *
 * ## 왜 새 값을 만들지 않았나
 *
 * 항목마다 이미 `payer` 가 붙어 있다(`두 사람`·`예비 신부 가족`·`예비 신랑 가족`·
 * `두 가족`). 이 화면은 그 넷을 **세 기둥으로 접어서** 보여줄 뿐 새 분담 값을
 * 만들지 않는다.
 *
 * 값을 늘리는 길은 막혀 있다 — `payer` 는 세 곳이 같은 목록을 들고 있고 그중 하나가
 * DB 트리거다(`supabase/migrations/20260802200000_journey_budget_progress_integrity.sql`,
 * 목록에 없는 값이면 `COUPLE_PLAN_CHANGE_INVALID_BUDGET_PROGRESS` 로 저장을 거절한다).
 * 화면에만 새 값을 넣으면 **사용자가 고르는 순간 저장이 실패한다.** 늘리려면
 * 마이그레이션 + 릴리스 매니페스트 재핀 + Vercel 서명까지 한 묶음이다.
 *
 * ## 접는 규칙
 *
 *   신부 측 ← `bride_parents`
 *   신랑 측 ← `groom_parents`
 *   함께   ← `couple` + `both_parents`
 *
 * `couple` 과 `both_parents` 를 한 기둥에 넣지만 **뜻이 다르다**(두 사람의 돈 vs 두
 * 가족의 돈). 그래서 이 화면 아래에 원래의 네 칸이 그대로 남아 있다 — 접은 것을
 * 펴서 볼 자리가 없으면 이 화면이 정보를 지우는 셈이 된다.
 *
 * ## 색은 뜻을 지지 않는다
 *
 * 어느 기둥이 어느 색인지는 임의다. 뜻은 **글자**가 진다(이름·금액·비중이 모두
 * 글자로 나간다). 색만 보고 신부/신랑을 읽게 만들지 마라.
 */

import { formatPercentCell, withPercents } from "./shareMath";
import { formatWon } from "@/lib/formatWon";

type SideKey = "bride" | "shared" | "groom";

const SIDE_COLORS: Record<SideKey, string> = {
  bride: "var(--color-rose-500)",
  shared: "var(--color-paper-stem)",
  groom: "var(--color-sage-500)",
};

export default function BudgetSideSplit({
  brideSide,
  groomSide,
  shared,
}: {
  brideSide: number;
  groomSide: number;
  shared: number;
}) {
  const total = brideSide + groomSide + shared;
  if (total <= 0) return null;

  const rows = withPercents(
    [
      { key: "bride" as const, label: "신부 측", amount: brideSide },
      { key: "shared" as const, label: "함께", amount: shared },
      { key: "groom" as const, label: "신랑 측", amount: groomSide },
    ],
    total,
  );

  return (
    <div className="mb-5">
      {/* 막대는 읽어주지 않는다 — 바로 아래 목록이 세 기둥을 이름·금액·비중으로
          말한다. 여기에도 요약을 달면 같은 말을 두 번 듣는다. */}
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-paper-rule)]"
        aria-hidden="true"
      >
        {rows.map((row) =>
          row.amount > 0 ? (
            <div
              key={row.key}
              // 어느 기둥의 조각인지 마크업에 남긴다. 검사가 `aria-hidden` 이나
              // 클래스 순서로 조각을 찾으면, 접근성이나 스타일을 손대는 순간
              // 상관없는 검사가 빨간불이 된다.
              data-side={row.key}
              // 폭을 비중이 아니라 **금액 비율**로 준다. 반올림한 비중으로 그리면
              // `1% 미만` 조각이 0% 라 사라지는데, 목록에는 금액이 남아 있어
              // "있다는데 안 보인다" 가 된다.
              style={{
                width: `${(row.amount / total) * 100}%`,
                backgroundColor: SIDE_COLORS[row.key],
              }}
            />
          ) : null,
        )}
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rows.map((row) => (
          <li key={row.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 sm:block">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: SIDE_COLORS[row.key] }}
              />
              <span className="truncate text-[12px] font-medium text-[var(--hb-text-body)]">
                {row.label}
              </span>
            </div>
            {/* 원 단위 금액을 자르지 않도록 작은 화면에서는 분담별 한 행을 쓴다. */}
            <p className="font-serif-kr whitespace-nowrap text-[16px] font-medium leading-none text-[var(--hb-text-strong)] sm:mt-1.5 sm:text-[18px]">
              {formatWon(row.amount)}
            </p>
            <p className="col-span-2 text-right text-[12px] text-[var(--hb-text-muted)] tabular-nums sm:mt-1 sm:text-left">
              {formatPercentCell(row.percent, row.amount)}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[12px] leading-5 text-[var(--hb-text-muted)]">
        ‘함께’는 두 사람과 두 가족이 함께 내는 몫이라 어느 한쪽으로 세지 않았어요.
        분담을 아직 정하지 않은 항목은 ‘두 사람’으로 셉니다.
      </p>
    </div>
  );
}
