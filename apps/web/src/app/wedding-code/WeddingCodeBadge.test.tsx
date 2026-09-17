// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_AXES } from "@/constants/weddingCodeV06";
import { WEDDING_CODE_SELF_READING } from "@/constants/weddingCodeSelfReading";
import {
  WEDDING_CODE_FIRMNESS_LABEL,
  WEDDING_CODE_LETTERS,
  buildWeddingCodeLetters,
  type WeddingCodeLetters,
} from "@/lib/weddingCode/profile/letters";
import type { WeddingCodeSelfProfile } from "@/lib/weddingCode/scene/selfProfile";
import WeddingCodeBadge from "./WeddingCodeBadge";

/**
 * 배지 범례 가드 (2026-09-17).
 *
 * 팀원 피드백: 「VTFH 가 뭔지, 각 자리의 다른 글자가 뭔지 모르겠다. `I ——v— E` 처럼
 * 한눈에 보이면 좋겠다.」 그래서 범례는 네 축마다 **양쪽 글자와 이름**을 늘 보여주고,
 * 답한 장면 하나를 한 칸으로 그린다.
 *
 * 지키는 것:
 * - 모든 자리에 양쪽 칩이 있고, 칩의 글자·이름이 그 편의 정의와 같다.
 * - 칸 수는 정확히 답한 장면 수이고, 왼쪽 칸 뒤에 오른쪽 칸이 온다. 답하지 않은 장면은 칸이 없다.
 * - 배지 HTML 어디에도 `%` 가 없다 — 칸 너비를 비율로 계산하면 백분율이 생긴다.
 */
const COUNTS = [0, 1, 2, 3, 4, 5] as const;

function lettersOf(counts: readonly (readonly [number, number])[]): WeddingCodeLetters {
  const axes = WEDDING_CODE_V06_AXES.map((axis, index) => {
    const [leftCount, rightCount] = counts[index];
    const lean = leftCount === rightCount ? "mixed" : leftCount > rightCount ? "left" : "right";
    return {
      axis: axis.key,
      axisLabel: axis.labelKo,
      lean,
      title: WEDDING_CODE_SELF_READING[axis.key][lean].title,
      leftLabel: WEDDING_CODE_LETTERS[axis.key].left.short,
      rightLabel: WEDDING_CODE_LETTERS[axis.key].right.short,
      leftCount,
      rightCount,
      answered: leftCount + rightCount,
      evidence: [],
      missingPhrases: [],
      qualifiers: [],
      tellPartner: "",
      watchOut: "",
    } as const;
  });
  const answered = axes.reduce((sum, axis) => sum + axis.answered, 0);
  const profile: WeddingCodeSelfProfile = { answered, total: 20, complete: answered === 20, repeated: [], axes };
  return buildWeddingCodeLetters(profile);
}

/** 네 축에 서로 다른 셈을 돌려 넣어 0..5 × 0..5 조합을 모두 한 번 이상 그린다. */
function allSplits(): (readonly (readonly [number, number])[])[] {
  const pairs = COUNTS.flatMap((left) => COUNTS.map((right) => [left, right] as const));
  return pairs.map((_, index) => [0, 1, 2, 3].map((offset) => pairs[(index + offset * 7) % pairs.length]));
}

function render(letters: WeddingCodeLetters): { html: string; root: HTMLElement } {
  const html = renderToStaticMarkup(<WeddingCodeBadge letters={letters} />);
  const root = document.createElement("div");
  root.innerHTML = html;
  return { html, root };
}

describe("웨딩코드 배지 범례", () => {
  it("측정기가 살아 있다 — 36가지 셈이 모든 축에 한 번씩은 들어간다", () => {
    const seen = new Map<string, Set<string>>();
    for (const counts of allSplits()) {
      counts.forEach(([left, right], index) => {
        const key = WEDDING_CODE_V06_AXES[index].key;
        const set = seen.get(key) ?? new Set<string>();
        set.add(`${left}:${right}`);
        seen.set(key, set);
      });
    }
    for (const axis of WEDDING_CODE_V06_AXES) expect(seen.get(axis.key)?.size, axis.key).toBe(36);
  });

  it("모든 자리에 양쪽 글자와 양쪽 짧은 이름이 보인다", () => {
    for (const counts of allSplits()) {
      const letters = lettersOf(counts);
      const { root } = render(letters);
      const rows = root.querySelectorAll("[data-legend-axis]");
      expect(rows, JSON.stringify(counts)).toHaveLength(WEDDING_CODE_V06_AXES.length);
      for (const slot of letters.slots) {
        const row = root.querySelector(`[data-legend-axis="${slot.axis}"]`)!;
        const label = `${slot.axis} ${slot.left.count}:${slot.right.count}`;
        const pair = WEDDING_CODE_LETTERS[slot.axis];
        const left = row.querySelector('[data-pole="left"]');
        const right = row.querySelector('[data-pole="right"]');
        expect(left, label).not.toBeNull();
        expect(right, label).not.toBeNull();
        expect(left!.getAttribute("data-pole-letter"), label).toBe(pair.left.letter);
        expect(right!.getAttribute("data-pole-letter"), label).toBe(pair.right.letter);
        expect(left!.textContent, label).toBe(`${pair.left.letter}${pair.left.short}`);
        expect(right!.textContent, label).toBe(`${pair.right.letter}${pair.right.short}`);
        // 고른 쪽만 강조한다. 미정이면 둘 다 강조하지 않는다.
        expect(left!.getAttribute("data-pole-chosen"), label).toBe(String(slot.chosen === "left"));
        expect(right!.getAttribute("data-pole-chosen"), label).toBe(String(slot.chosen === "right"));
        // 뜻·셈·굳기 이름이 같은 줄 묶음에 있다.
        expect(row.textContent, label).toContain(slot.axisLabel);
        expect(row.textContent, label).toContain(WEDDING_CODE_FIRMNESS_LABEL[slot.firmness]);
        expect(row.textContent, label).toContain(slot.meaning);
        expect(row.textContent, label).toContain(slot.countLine);
        if (slot.narrowCaution) expect(row.textContent, label).toContain(slot.narrowCaution);
      }
    }
  });

  it("칸은 답한 장면 수만큼이고 왼쪽 칸이 먼저 온다, 막대는 읽어주지 않는다", () => {
    for (const counts of allSplits()) {
      const letters = lettersOf(counts);
      const { root } = render(letters);
      for (const slot of letters.slots) {
        const label = `${slot.axis} ${slot.left.count}:${slot.right.count}`;
        const bar = root.querySelector(`[data-legend-axis="${slot.axis}"] [data-count-bar]`);
        expect(bar, label).not.toBeNull();
        expect(bar!.getAttribute("aria-hidden"), label).toBe("true");
        const sides = [...bar!.querySelectorAll("[data-segment]")].map((segment) => segment.getAttribute("data-segment"));
        expect(sides, label).toEqual([
          ...Array.from({ length: slot.left.count }, () => "left"),
          ...Array.from({ length: slot.right.count }, () => "right"),
        ]);
        expect(sides, label).toHaveLength(slot.answered);
        expect(bar!.querySelectorAll("[data-bar-empty]"), label).toHaveLength(slot.answered === 0 ? 1 : 0);
      }
    }
  });

  it("배지 HTML 어디에도 퍼센트·인라인 너비가 없다", () => {
    for (const counts of allSplits()) {
      const { html, root } = render(lettersOf(counts));
      expect(html, JSON.stringify(counts)).not.toContain("%");
      expect(root.querySelectorAll("[style]"), JSON.stringify(counts)).toHaveLength(0);
    }
  });

  it("범례는 접히지 않고, 소문자 규칙과 판정 아님을 머리에서 먼저 말한다", () => {
    const { root } = render(lettersOf([[5, 0], [3, 2], [2, 2], [0, 0]]));
    const section = root.querySelector("[data-wedding-code]")!;
    expect(section.getAttribute("data-wedding-code")).toBe("Vt··");
    expect(section.querySelector("details")).toBeNull();
    expect(section.querySelector("[data-code-legend] h2")?.textContent).toBe("네 글자 읽는 법");
    expect(section.textContent).toContain("성격을 맞힌 게 아니라, 이번에 고른 답이 어느 쪽에 더 많았는지 적은 글자예요.");
    expect(section.textContent).toContain("소문자는 양쪽 답이 하나 차이일 때 나와요");
    expect(section.textContent).toContain("건너뛴 장면이나 빈 글자(·)가 있어서, 답한 만큼만 줄인 코드예요.");
    for (const slot of ["decisionCriteria", "preparationMode", "coordinationScope", "supportOrder"]) {
      expect(section.querySelector(`[data-letter="${slot}"]`)).not.toBeNull();
    }
    expect(section.querySelector('[data-letter="preparationMode"]')?.getAttribute("data-firmness")).toBe("narrow");
    expect(section.textContent).not.toMatch(/궁합|점수|등급|유형이|당신은|잘 맞/);
  });
});
