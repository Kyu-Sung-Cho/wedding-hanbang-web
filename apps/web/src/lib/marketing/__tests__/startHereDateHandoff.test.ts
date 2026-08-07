// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  START_HERE_DATE_HANDOFF_KEY,
  clearStartHereDateHandoff,
  readStartHereDateHandoff,
} from "../startHereDateHandoff";

/**
 * 히어로 → `/start-here` 날짜 인계 계약.
 *
 * 이 모듈은 한동안 **쓰는 쪽만** 있었다. 히어로가 sessionStorage에 넣고 넘겼는데
 * 도착 화면에 읽는 코드가 없어서, 방금 날짜를 넣고 결과까지 본 사람이 다음 화면에서
 * 같은 날짜를 다시 입력해야 했다. 죽은 배선은 조용해서 아무도 눈치채지 못한다 —
 * 여기서 읽기·소비·검증을 전부 묶어 둔다.
 */

const ymdAfter = (days: number): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const setHash = (hash: string) => {
  window.history.replaceState(null, "", `/start-here${hash}`);
};

beforeEach(() => {
  window.sessionStorage.clear();
  setHash("");
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("readStartHereDateHandoff", () => {
  it("hands the hero's date to the next screen", () => {
    const date = ymdAfter(200);
    window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, date);

    expect(readStartHereDateHandoff()).toBe(date);
  });

  it("also accepts the fragment the hero uses when storage is blocked", () => {
    const date = ymdAfter(120);
    setHash(`#date=${encodeURIComponent(date)}`);

    expect(readStartHereDateHandoff()).toBe(date);
  });

  it("consumes the handoff so a refresh does not resurrect it", () => {
    const date = ymdAfter(90);
    window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, date);
    setHash(`#date=${encodeURIComponent(date)}`);

    expect(readStartHereDateHandoff()).toBe(date);
    // 두 번째 호출은 빈손이어야 한다 — 넣지도 않은 날짜로 계산되면 안 된다.
    expect(readStartHereDateHandoff()).toBeNull();
    expect(window.sessionStorage.getItem(START_HERE_DATE_HANDOFF_KEY)).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("refuses anything that is not a usable future date", () => {
    for (const bad of ["", "어제", "2026-13-40", "<script>", "2020-01-01", ymdAfter(-1)]) {
      window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, bad);
      expect(readStartHereDateHandoff(), bad).toBeNull();
    }
  });

  it("returns nothing when the hero never handed anything over", () => {
    expect(readStartHereDateHandoff()).toBeNull();
  });

  it("clearStartHereDateHandoff removes the pending date", () => {
    window.sessionStorage.setItem(START_HERE_DATE_HANDOFF_KEY, ymdAfter(30));
    clearStartHereDateHandoff();
    expect(window.sessionStorage.getItem(START_HERE_DATE_HANDOFF_KEY)).toBeNull();
  });
});

describe("the receiving screen actually calls the reader", () => {
  it("StartHereClient consumes the handoff", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(process.cwd(), "src/components/community/StartHereClient.tsx"),
      "utf8",
    );
    // 배선이 다시 끊기면 여기서 먼저 깨진다.
    //
    // 처음엔 `setDateText(handed)`라는 **정확한 문자열**을 검사했는데, 같은 동작을
    // 다른 모양으로 쓰자마자 깨졌다(lint 때문에 함수형 updater로 바꿨다). 가드가
    // 문법에 붙으면 리팩터링마다 거짓 경보를 낸다 — 읽은 값이 날짜 상태로
    // 흘러가는지만 본다.
    expect(source).toContain("readStartHereDateHandoff");
    const effect = /readStartHereDateHandoff\(\)[\s\S]{0,400}?setDateText/u;
    expect(effect.test(source), "인계 결과가 날짜 상태로 이어지지 않는다").toBe(true);
  });
});
