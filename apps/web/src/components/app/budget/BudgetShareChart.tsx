"use client";

/**
 * 항목별 비중 — 도넛 하나와 목록 하나.
 *
 * ## 왜 만들었나
 *
 * 예산 화면은 총 예산·기록 지출·남은 예산 세 숫자와 스물몇 개의 카테고리 줄을
 * 보여준다. "어디에 제일 많이 쓰고 있나" 는 그 줄들을 눈으로 더해야 답이 나온다.
 * 도넛은 그 덧셈을 대신한다.
 *
 * ## 숫자는 여기서 만들지 않는다
 *
 * 슬라이스는 부모(`BudgetContent`)가 **자기 합계를 만든 그대로** 넘긴다. 이 파일은
 * 정렬하고 그리기만 한다. 이유는 `lib/budgetTotals.ts` 머리말에 있다 — 2026-08-24에
 * 표면마다 따로 세다가 **한 장의 카드 안에서 숫자가 둘로 갈렸다**. 여기서 progress 를
 * 다시 읽어 세면 같은 사고가 같은 화면에서 재현된다.
 *
 * ## 색을 새로 만들지 않는다
 *
 * 이 저장소는 공유 UI 프리미티브가 없어 색이 517종으로 갈라진 적이 있다. 그래서
 * 팔레트를 **기존 토큰을 가리키는 배열 하나**로 둔다. 새 hex 를 넣지 마라 —
 * `--hb-*` 역할 토큰은 `packages/design-tokens/src/colors.ts` 에서 생성되는 블록이라
 * globals.css 에 손으로 적어도 다음 생성 때 지워진다.
 *
 * `--color-paper-mark`(#B8452F)는 일부러 뺐다. 이 제품에서 그 빨강은 "고쳐야 할 것"을
 * 뜻한다. 카테고리 한 칸에 칠하면 그 항목이 문제라는 뜻으로 읽힌다.
 */

import { formatManwon, formatPercentCell, withPercents } from "./shareMath";

type Slice = {
  key: string;
  label: string;
  amount: number;
};

/**
 * 이웃한 조각끼리 밝기가 갈리도록 늘어놓았다. 비슷한 톤을 붙여 놓으면 도넛에서
 * 경계가 사라진다. 색만으로 뜻을 지지 않게 목록에 **글자로 이름·금액·비중**이 같이 나간다.
 */
const SLICE_COLORS = [
  "var(--color-paper-ink)",
  "var(--color-sage-500)",
  "var(--color-rose-500)",
  "var(--color-paper-pen)",
  "var(--color-paper-stem)",
  "var(--color-sage-pale)",
  "var(--color-rose-light)",
] as const;

/** 상위 몇 개까지 이름을 보여주고 나머지를 묶을지. */
const NAMED_SLICE_LIMIT = 7;
/**
 * `기타` 는 이름 있는 일곱 색 **어느 것과도** 달라야 한다.
 *
 * 처음엔 `--color-paper-outline`(#8F8A7A)을 썼다가 375px 실측에서 다섯째 조각
 * `--color-paper-stem`(#A2937F)과 목록의 점이 구별되지 않았다 — 둘 다 흐린 토프다.
 * `--color-taupe-500`(#635B51)은 한 단계 어두워 여덟 색 안에서 혼자 선다.
 */
const REST_COLOR = "var(--color-taupe-500)";

const RADIUS = 48;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function BudgetShareChart({
  slices,
  basis,
}: {
  slices: readonly Slice[];
  /** 무엇을 나눠 그린 것인지. 기록 지출이 아직 없으면 배정 예산으로 그린다. */
  basis: "spent" | "budget";
}) {
  const counted = slices
    .filter((slice) => slice.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const total = counted.reduce((sum, slice) => sum + slice.amount, 0);
  if (total <= 0) return null;

  const named = counted.slice(0, NAMED_SLICE_LIMIT);
  const rest = counted.slice(NAMED_SLICE_LIMIT);
  const restAmount = rest.reduce((sum, slice) => sum + slice.amount, 0);

  const grouped: Slice[] = restAmount > 0
    ? [...named, { key: "__rest", label: `기타 ${rest.length}개`, amount: restAmount }]
    : named;

  const rows = withPercents(grouped, total).map((row, index) => ({
    ...row,
    color: row.key === "__rest" ? REST_COLOR : SLICE_COLORS[index % SLICE_COLORS.length],
  }));

  // 조각 사이를 살짝 벌려 경계를 만든다. 조각이 하나뿐이면 벌릴 곳이 없다 —
  // 그대로 두면 완전한 원에서 1.5 만큼 빠진 자리가 이가 빠진 것처럼 보인다.
  const gap = rows.length > 1 ? 1.5 : 0;

  const arcLength = (amount: number) => (amount / total) * CIRCUMFERENCE;

  const arcs = rows.map((row, index) => {
    const length = arcLength(row.amount);
    // 앞 조각들의 길이를 더한 만큼 밀어서 시작점을 잡는다.
    //
    // 누적 변수를 하나 두고 `map` 안에서 더하는 편이 짧지만, 렌더 중에 바깥 변수를
    // 바꾸는 것이라 `react-hooks/immutability` 가 막는다(실제로 push 가 막혔다).
    // 조각은 여덟 개까지라 앞을 다시 더해도 값이 같고 계산은 순수하다.
    const start = rows
      .slice(0, index)
      .reduce((sum, previous) => sum + arcLength(previous.amount), 0);
    // 아주 작은 조각은 간격을 빼면 사라진다. 최소 길이를 남겨 목록의 색과
    // 도넛의 색이 짝이 맞게 한다.
    const dash = Math.max(length - gap, 0.6);
    return {
      key: row.key,
      color: row.color,
      dash,
      remainder: CIRCUMFERENCE - dash,
      offset: -start,
    };
  });

  const basisLabel = basis === "spent" ? "기록 지출" : "배정 예산";

  return (
    <section className="rounded-[6px] border border-[var(--hb-hairline)] bg-white/90 p-4 shadow-[var(--shadow-raised)] animate-fade-in md:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--hb-text-strong)]">
        CATEGORY SHARE
      </p>
      <h3 className="mt-1 font-serif-kr text-[var(--hb-text-strong)]">항목별 비중</h3>
      <p className="mt-1 text-[13px] font-medium text-[var(--hb-text-body)]">
        {basisLabel} {formatManwon(total)}을 항목별로 나눈 비중이에요.
      </p>

      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        <div className="relative mx-auto w-[168px] shrink-0 sm:mx-0">
          {/* 도넛은 읽어주지 않는다.
              바로 아래 목록이 여덟 줄 전부를 이름·금액·비중으로 말하고, 카드 머리에
              제목과 총액 문장이 이미 있다. 그림에도 `aria-label` 을 달면 스크린리더가
              같은 요약을 한 번 더 읽어 목록에 닿기 전에 지치게 한다. */}
          <svg viewBox="0 0 120 120" className="h-[168px] w-[168px]" aria-hidden="true">
            {/* 도넛은 12시에서 시작해 시계방향으로 돈다. SVG 원은 3시에서 시작하므로
                통째로 -90도 돌린다. */}
            <g transform="rotate(-90 60 60)">
              <circle
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                stroke="var(--color-paper-rule)"
                strokeWidth="16"
              />
              {arcs.map((arc) => (
                <circle
                  key={arc.key}
                  cx="60"
                  cy="60"
                  r={RADIUS}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth="16"
                  strokeDasharray={`${arc.dash} ${arc.remainder}`}
                  strokeDashoffset={arc.offset}
                />
              ))}
            </g>
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-serif-kr text-[20px] font-medium leading-none text-[var(--hb-text-strong)]">
              {formatManwon(total)}
            </span>
            <span className="mt-1.5 text-[11px] font-medium text-[var(--hb-text-muted)]">
              {basisLabel}
            </span>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-2">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--hb-text-body)]">
                {row.label}
              </span>
              <span className="shrink-0 whitespace-nowrap text-[13px] font-medium text-[var(--hb-text-strong)] tabular-nums">
                {formatManwon(row.amount)}
              </span>
              {/* 폭을 고정해 비중 숫자가 세로로 줄을 맞춘다. `1% 미만`(가장 긴 값)이
                  13px 에서 50px 이라 54px 이 필요하다 — `w-11`(44px)이면 줄바꿈된다. */}
              <span className="w-[54px] shrink-0 whitespace-nowrap text-right text-[13px] text-[var(--hb-text-muted)] tabular-nums">
                {formatPercentCell(row.percent, row.amount)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
