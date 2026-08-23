// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CalendarView from "../CalendarView";

/**
 * **빈 달력이 왜 비었는지 말하는지** 본다.
 *
 * 달력은 날짜를 정한 일정만 그린다. 운영 54 커플을 실제로 세어 보니 등록한 일정이
 * 0 건인 커플이 절반을 넘었다(중앙값 0). 그래서 달력이 기본 뷰가 된 뒤로 **첫 화면이
 * 점 하나 없는 격자**인 사람이 다수다.
 *
 * 예전에는 안내 문구를 `!weddingDate` 일 때만 띄웠다. 예식일을 넣은 커플은 일정이
 * 0 건이어도 아무 설명이 없었고, 예식일이 60 일보다 멀면 「날짜를 정할 항목」도 비어
 * (그 창이 60 일이다) **화면에 단서가 하나도 없었다.** 이 검사가 그 조합을 고정한다.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const WHY_EMPTY = "날짜를 정한 일정만 캘린더에 표시됩니다";
const WHAT_TO_DO = "위의 일정 추가 버튼으로 실제 날짜를 등록해 주세요";

/** 취소된 일정도 심어야 하므로 status 를 좁히지 않는다. */
type TestEvent = {
  id: string;
  date: string;
  title: string;
  status: "planned" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

function futureEvent(daysAhead: number): TestEvent {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return {
    id: `event-${daysAhead}`,
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    title: "상견례 장소 답사",
    status: "planned",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("빈 달력은 왜 비었는지 말한다", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function mount(props: { weddingDate: Date | null; events: TestEvent[] }) {
    await act(async () => {
      root.render(
        <CalendarView
          weddingDate={props.weddingDate}
          events={props.events as never}
          onAddEvent={vi.fn()}
          onEditEvent={vi.fn()}
        />,
      );
      await Promise.resolve();
    });
    return container.textContent ?? "";
  }

  it("예식일이 없고 일정도 없으면 말한다", async () => {
    const text = await mount({ weddingDate: null, events: [] });
    expect(text).toContain(WHY_EMPTY);
    expect(text).toContain(WHAT_TO_DO);
  });

  it("예식일은 있는데 등록한 일정이 0건이어도 말한다", async () => {
    // 여기가 새로 열린 갈래다. 예전에는 이 커플에게 격자만 보였다.
    const wedding = new Date();
    wedding.setDate(wedding.getDate() + 400);
    const text = await mount({ weddingDate: wedding, events: [] });
    expect(
      text,
      "예식일이 있고 일정이 0건인 커플에게 달력이 왜 비었는지 알려주지 않는다",
    ).toContain(WHY_EMPTY);
  });

  it("취소된 일정만 남아도 비어 있는 것으로 본다", async () => {
    // 화면에 점이 안 찍히는데 "일정이 있다"고 판정하면 안내가 사라진다.
    const cancelled: TestEvent = { ...futureEvent(10), status: "cancelled" };
    const wedding = new Date();
    wedding.setDate(wedding.getDate() + 200);
    const text = await mount({ weddingDate: wedding, events: [cancelled] });
    expect(text).toContain(WHY_EMPTY);
  });

  it("그릴 일정이 있으면 안내를 띄우지 않는다", async () => {
    // 안내가 늘 떠 있으면 그건 안내가 아니라 소음이다.
    const wedding = new Date();
    wedding.setDate(wedding.getDate() + 200);
    const text = await mount({ weddingDate: wedding, events: [futureEvent(10)] });
    expect(text).not.toContain(WHY_EMPTY);
  });
});
