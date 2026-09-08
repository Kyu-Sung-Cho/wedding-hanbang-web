// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ScheduleContent from "../ScheduleContent";

/**
 * 일정 화면이 **달력을 먼저** 보여주는지, 그리고 **빈 달력을 먼저 보여주지 않는지** 본다.
 *
 * ## 왜 달력이 기본인가
 *
 * 타임라인은 체크리스트 화면과 같은 것을 그린다 — 같은 상수, 같은 병합 함수, 같은 토글
 * 핸들러를 쓰고 D-day 구간으로 묶기만 한다(`TimelineView.tsx` 의 `CATEGORY_CHECKLISTS`
 * 임포트). 일정 화면이 체크리스트를 한 번 더 그릴 이유가 없다.
 *
 * ## 왜 순서가 검사 대상인가
 *
 * 달력은 **날짜를 정한 일정만** 그린다. 운영 54 커플을 실제로 세어 보니 등록한 일정이
 * 0 건인 커플이 절반이 넘었고, 3 건 이상은 3 커플뿐이었다. 그래서 기본값만 달력으로
 * 바꾸면 대부분에게 **점 하나 없는 격자**가 첫 화면이 된다.
 *
 * 그 커플에게 필요한 것은 격자가 아니라 **거기서 나가는 문**이다 — 「날짜를 정할 항목」의
 * 각 행에 붙은 `날짜 잡기`. 그래서 일정이 없으면 그 블록이 달력보다 위에 온다.
 *
 * 이 순서가 이 변경의 핵심이고, 기본값 한 줄만 남고 순서가 사라지면 화면이 죽는다.
 * 그래서 기본값과 순서를 함께 고정한다.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type MockJourney = { wedding_date: string | null; progress: Record<string, unknown> };

const authState = vi.hoisted(
  (): {
    journey: MockJourney;
    updateJourney: ReturnType<typeof vi.fn>;
    profile: { id: string; name: string };
    partner: { id: string; name: string } | null;
    isDemo: boolean;
    publish: () => void;
  } => ({
    journey: { wedding_date: null, progress: {} },
    updateJourney: vi.fn(),
    profile: { id: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2", name: "지은" },
    partner: { id: "4ed560aa-52e6-47d2-9595-612d0bfe2c7b", name: "수현" },
    isDemo: false,
    publish: () => {},
  }),
);

vi.mock("@/stores/authStore", async () => {
  const { create } = await import("zustand");
  const useAuthStore = create(() => ({ ...authState }));
  authState.publish = () => useAuthStore.setState({ ...authState }, true);
  return { useAuthStore };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

// 두 뷰를 서로 다른 표식으로 바꾼다. 어느 쪽이 그려졌는지 문구로 가리기 위해서다.
const TIMELINE_MARK = "표식-타임라인";
const CALENDAR_MARK = "표식-캘린더";
vi.mock("@/components/app/schedule/TimelineView", () => ({
  default: () => <div>{TIMELINE_MARK}</div>,
}));
vi.mock("@/components/app/schedule/CalendarView", () => ({
  default: () => <div>{CALENDAR_MARK}</div>,
}));

/** 임박 목록의 창은 `기본 확인 시점까지 60일`이고 가장 이른 기준값은 D-330이다. */
function weddingDateWithImminentCategories(): string {
  const d = new Date();
  d.setDate(d.getDate() + 350);
  return d.toISOString().slice(0, 10);
}

function futureEvent(daysAhead: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return {
    id: `event-${daysAhead}`,
    date: d.toISOString().slice(0, 10),
    title: "상견례 장소 답사",
    status: "planned" as const,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const IMMINENT_HEADING = "기본 일정 확인";
const UPCOMING_HEADING = "다가오는 일정";

/**
 * **문자열이 아니라 요소로 찾는다.**
 *
 * 첫 판은 `textContent.indexOf` 였는데 상단 통계 타일에도 `다가오는 일정` 이라는
 * 글자가 있어서(`UPCOMING` 칸의 설명문), 순서 검사가 패널이 아니라 그 타일을 가리켰다.
 * 패널 제목은 `h3` 이고 타일 설명문은 `p` 라서 태그로 가른다.
 */
function panelHeading(container: HTMLElement, text: string): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll("h3")).find(
      (node) => node.textContent?.trim() === text,
    ) ?? null
  );
}

function markNode(container: HTMLElement, mark: string): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll("div")).find(
      (node) => node.textContent?.trim() === mark,
    ) ?? null
  );
}

/** a 가 b 보다 문서에서 앞에 있는가. */
function comesBefore(a: Node | null, b: Node | null): boolean {
  if (!a || !b) return false;
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("일정 화면은 달력을 먼저 보여준다", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    authState.updateJourney.mockReset();
    authState.updateJourney.mockResolvedValue({ status: "applied" });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function mount(journey: MockJourney) {
    authState.journey = journey;
    await act(async () => {
      authState.publish();
      root.render(<ScheduleContent />);
      await Promise.resolve();
    });
    return container.textContent ?? "";
  }

  it("기본 뷰는 캘린더다 — 타임라인이 아니다", async () => {
    const text = await mount({
      wedding_date: weddingDateWithImminentCategories(),
      progress: {},
    });
    expect(text).toContain(CALENDAR_MARK);
    expect(
      text,
      "타임라인이 기본으로 돌아왔다 — 체크리스트 화면과 같은 것을 두 번 그리게 된다",
    ).not.toContain(TIMELINE_MARK);
  });

  it("타임라인은 없어지지 않았다 — 토글로 갈 수 있다", async () => {
    // 지운 것이 아니라 기본값만 옮겼다. 되돌릴 길이 남아 있는지 확인한다.
    await mount({ wedding_date: weddingDateWithImminentCategories(), progress: {} });
    const toggle = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "타임라인",
    );
    expect(toggle, "타임라인 토글이 사라졌다").toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain(TIMELINE_MARK);
  });

  it("등록한 일정이 없으면 「날짜를 정할 항목」이 달력보다 위에 온다", async () => {
    const text = await mount({
      wedding_date: weddingDateWithImminentCategories(),
      progress: {},
    });

    expect(text).toContain(CALENDAR_MARK);
    const imminent = panelHeading(container, IMMINENT_HEADING);
    const calendar = markNode(container, CALENDAR_MARK);
    expect(imminent, "「날짜를 정할 항목」이 아예 없다").not.toBeNull();
    expect(
      comesBefore(imminent, calendar),
      "일정이 0건인데 빈 달력이 먼저 온다 — 그 커플에게는 달력에서 나가는 문이 먼저여야 한다",
    ).toBe(true);
  });

  it("등록한 일정이 없으면 「다가오는 일정」 빈 블록을 띄우지 않는다", async () => {
    // 「날짜를 정할 항목」 바로 밑에 "예정된 일정이 없어요"를 또 붙이면 같은 말을 두 번 한다.
    const text = await mount({
      wedding_date: weddingDateWithImminentCategories(),
      progress: {},
    });
    expect(panelHeading(container, UPCOMING_HEADING)).toBeNull();
    expect(text).not.toContain("예정된 일정이 없어요");
  });

  it("일정이 있으면 「다가오는 일정」이 위, 「날짜를 정할 항목」이 아래다", async () => {
    const text = await mount({
      wedding_date: weddingDateWithImminentCategories(),
      progress: { __events: [futureEvent(7)] },
    });

    expect(text).toContain(CALENDAR_MARK);
    const upcoming = panelHeading(container, UPCOMING_HEADING);
    const calendar = markNode(container, CALENDAR_MARK);
    const imminent = panelHeading(container, IMMINENT_HEADING);

    expect(upcoming, "「다가오는 일정」이 없다").not.toBeNull();
    expect(imminent, "「날짜를 정할 항목」이 없다").not.toBeNull();
    expect(comesBefore(upcoming, calendar), "일정이 있는데 달력이 먼저다").toBe(true);
    expect(comesBefore(calendar, imminent), "「날짜를 정할 항목」이 달력 위로 왔다").toBe(true);
  });

  it("두 블록이 한 화면에 두 번 나오지 않는다", async () => {
    // 사이드바에서 본문으로 옮기면서 옛 자리를 안 지우면 그대로 두 번 나온다.
    const headingCount = (text: string) =>
      Array.from(container.querySelectorAll("h3")).filter(
        (node) => node.textContent?.trim() === text,
      ).length;
    for (const progress of [{}, { __events: [futureEvent(7)] }]) {
      await mount({ wedding_date: weddingDateWithImminentCategories(), progress });
      expect(headingCount(IMMINENT_HEADING)).toBeLessThanOrEqual(1);
      expect(headingCount(UPCOMING_HEADING)).toBeLessThanOrEqual(1);
      await act(async () => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }
  });
});
