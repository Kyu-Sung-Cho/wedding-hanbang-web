import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TodayOneCard, {
  __resetTodayOneCardRequestCacheForTests,
} from "./TodayOneCard";
import { useAuthStore } from "@/stores/authStore";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CARD_ID = "30000000-0000-4000-8000-000000000001";
const READY = {
  available: true,
  result: {
    version: 2,
    state: "ready",
    recipientUserId: USER_ID,
    claimedForDate: "2026-08-02",
    card: {
      id: CARD_ID,
      revision: 1,
      sourceRevision: 7,
      sourceKey: "schedule:0123456789abcdef01234567:d1",
      kind: "schedule_moment",
      whyNow: "내일 상견례 일정이 있어요.",
      confirmed: ["일정: 상견례", "날짜: 2026-08-03 18:00"],
      unknown: ["가족의 최신 변경 여부는 아직 확인되지 않았어요."],
      nextAction: { label: "일정 열기", href: "/schedule" },
      impact: "확인만 하며 실제 일정이나 외부 서비스는 바꾸지 않아요.",
      choices: [
        { action: "open_source", label: "일정 열기" },
        { action: "snooze", label: "나중에" },
        { action: "dismiss", label: "오늘 닫기" },
        { action: "mute_source", label: "내용이 바뀔 때까지 숨기기" },
      ],
      expiresAt: "2026-08-03T15:00:00.000Z",
      care: {
        version: 1,
        momentType: "sanggyeonrye",
        attentionWindow: "d1",
        guidance: "내일 양쪽 부모님이 함께 만나. 필요한 것만 마지막으로 맞춰보자.",
        checklist: ["예약·참석 인원 최종 확인", "이동 시간 다시 확인"],
        script: "내일 ○시에 ○○로 예약했어요. 편하게 인사 나눠요.",
        relatedChecklist: {
          categoryKey: "meeting",
          categoryLabel: "부모님 첫 만남",
        },
        relatedBudget: {
          categoryKey: "meeting",
          categoryLabel: "부모님 첫 만남",
        },
        evidence: {
          refs: [
            { key: "canonical_schedule_event", label: "사용자가 저장한 일정" },
            { key: "canonical_checklist_category", label: "부모님 첫 만남 체크리스트" },
          ],
          limitations: ["가족마다 관습과 기대가 달라 정답으로 단정하지 않아요."],
        },
      },
    },
  },
};

const DRESS_FITTING_READY = {
  ...READY,
  result: {
    ...READY.result,
    card: {
      ...READY.result.card,
      sourceKey: "schedule:1123456789abcdef01234567:d1",
      whyNow: "내일 드레스 수선·최종 확인 일정이 있어요.",
      confirmed: ["일정: 드레스 수선·최종 확인", "날짜: 2026-08-03 18:00"],
      unknown: ["매장의 최신 변경 여부는 아직 확인되지 않았어요."],
      care: {
        version: 1,
        momentType: "dress_fitting",
        attentionWindow: "d1",
        guidance: "내일 드레스 수선 상태를 확인해. 입어보기만 하지 말고 실제로 움직여보자.",
        checklist: [
          "매장에서 요청했다면 결혼식 날 신을 높이와 비슷한 신발",
          "파트너와 함께 입는다면 전체 비율 확인",
          "앉기·걷기·팔 들기 테스트",
          "면사포·장갑 등 함께 빌릴 물품 최종 확정",
        ],
        relatedChecklist: {
          categoryKey: "dress",
          categoryLabel: "드레스·예식 정장",
        },
        evidence: {
          refs: [
            { key: "canonical_schedule_event", label: "사용자가 저장한 일정" },
            { key: "canonical_checklist_category", label: "드레스·예식 정장 체크리스트" },
            { key: "current_schedule_care_catalog", label: "현재 일정 준비 안내" },
          ],
          limitations: ["저장된 일정 밖의 최신 변경은 직접 확인해야 해요."],
        },
      },
    },
  },
};

const BUDGET_READY = {
  ...READY,
  result: {
    ...READY.result,
    card: {
      ...READY.result.card,
      care: undefined,
      sourceKey: "budget:recorded-total-over-total",
      kind: "budget_guardrail",
      whyNow: "직접 기록한 지출 합계가 설정한 총예산보다 커졌어요.",
      confirmed: [
        "설정 총예산: 30,000,000원",
        "기록 지출 합계: 31,000,000원",
      ],
      unknown: [
        "기록 지출은 결제 완료 증빙이 아님",
        "환불·취소·최종 결제 여부는 이 기록만으로 확인되지 않아요.",
      ],
      nextAction: { label: "예산 열기", href: "/budget" },
      choices: [
        { action: "open_source", label: "예산 열기" },
        { action: "snooze", label: "나중에" },
        { action: "dismiss", label: "오늘 닫기" },
        { action: "mute_source", label: "내용이 바뀔 때까지 숨기기" },
      ],
    },
  },
};

const DECISION_READY = {
  ...READY,
  result: {
    ...READY.result,
    card: {
      ...READY.result.card,
      care: undefined,
      sourceRevision: 9,
      sourceKey: "decision:50000000-0000-4000-8000-000000000001",
      kind: "decision_follow_up",
      whyNow: "직접 확인한 결정을 다시 살펴볼 때예요.",
      confirmed: ["결정: 총예산을 3천만원으로 확정"],
      unknown: [],
      nextAction: { label: "준비 현황 열기", href: "/dashboard" },
      choices: [
        { action: "open_source", label: "준비 현황 열기" },
        { action: "snooze", label: "나중에" },
        { action: "dismiss", label: "오늘 닫기" },
        { action: "mute_source", label: "내용이 바뀔 때까지 숨기기" },
      ],
    },
  },
};

function response(payload: unknown, ok = true, status = ok ? 200 : 503) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(payload),
  };
}

function deferredResponse() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("TodayOneCard", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalUser = useAuthStore.getState().user;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    push.mockReset();
    __resetTodayOneCardRequestCacheForTests();
    useAuthStore.setState({ user: { id: USER_ID, email: "today@example.com" } });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState({ user: originalUser });
    __resetTodayOneCardRequestCacheForTests();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("deduplicates StrictMode loading and shows why, source date, and current state", async () => {
    const pending = deferredResponse();
    const fetchMock = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StrictMode><TodayOneCard /></StrictMode>);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/amora/today-one",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Amora-Today-One-Contract-Version": "2",
        }),
      }),
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "오늘의 한 가지 확인 중",
    );

    await act(async () => pending.resolve(response(READY)));

    expect(container.textContent).toContain("왜 지금 보여드리나요");
    expect(container.textContent).toContain("내일 상견례 일정이 있어요.");
    expect(container.textContent).toContain("날짜: 2026-08-03 18:00");
    expect(container.textContent).toContain("2026년 8월 2일 기준");
    expect(container.textContent).toContain("현재 일정 기록 7 · 확인 전");
    expect(container.textContent).toContain("확인만 하며 실제 일정이나 외부 서비스는 바꾸지 않아요.");
    expect(container.textContent).toContain("필요한 것만 마지막으로 맞춰보자");
    expect(container.textContent).toContain("예약·참석 인원 최종 확인");
    expect(container.textContent).toContain("편하게 인사 나눠요");
    expect(container.textContent).toContain("가족마다 관습과 기대가 달라");
    expect(container.textContent).toContain("사용자가 저장한 일정");
  });

  it("opens the exact related checklist without consuming or mutating the care card", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(READY));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TodayOneCard />));

    const checklist = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "부모님 첫 만남 체크리스트 보기",
    );
    expect(checklist).toBeDefined();
    await act(async () => checklist?.click());

    expect(push).toHaveBeenCalledWith("/checklist?category=meeting");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens a related budget only when the structured care contract provides one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(READY));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TodayOneCard />));

    const budget = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "부모님 첫 만남 관련 예산 보기",
    );
    expect(budget).toBeDefined();
    await act(async () => budget?.click());

    expect(push).toHaveBeenCalledWith("/budget?category=meeting");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows dress fitting preparation without a budget or private follow-up action", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(DRESS_FITTING_READY));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TodayOneCard />));

    expect(container.textContent).toContain("입어보기만 하지 말고 실제로 움직여보자");
    expect(container.textContent).toContain("앉기·걷기·팔 들기 테스트");
    const checklist = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "드레스·예식 정장 체크리스트 보기",
    );
    expect(checklist).toBeDefined();
    await act(async () => checklist?.click());

    expect(push).toHaveBeenCalledWith("/checklist?category=dress");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/관련 예산|직원 비용|계약|추가금|해지|위약|환불/);
    expect(container.textContent).not.toContain("아모라에게 이야기하기");
  });

  it("does not claim success or hide the card until the action response is confirmed", async () => {
    const action = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(READY))
      .mockReturnValueOnce(action.promise);
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TodayOneCard />));

    const dismiss = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "오늘 숨기기",
    );
    expect(dismiss).toBeDefined();
    await act(async () => dismiss?.click());

    expect(container.textContent).toContain("내일 상견례 일정이 있어요.");
    expect(container.textContent).not.toContain("오늘은 숨겼어요");

    await act(async () => action.resolve(response({
      available: true,
      result: {
        version: 2,
        state: "none",
        recipientUserId: USER_ID,
        claimedForDate: "2026-08-02",
      },
    })));

    expect(container.textContent).not.toContain("내일 상견례 일정이 있어요.");
    expect(container.textContent).toContain("오늘은 숨겼어요");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/amora/today-one",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Amora-Today-One-Contract-Version": "2",
        }),
        body: JSON.stringify({
          cardId: CARD_ID,
          expectedRevision: 1,
          expectedSourceRevision: 7,
          action: "dismiss",
        }),
      }),
    );
  });

  it("describes mute as current-content scoped and confirms only after the server", async () => {
    const action = deferredResponse();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(BUDGET_READY))
      .mockReturnValueOnce(action.promise));
    await act(async () => root.render(<TodayOneCard />));

    const mute = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "내용이 바뀔 때까지 숨기기",
    );
    expect(mute).toBeDefined();
    await act(async () => mute?.click());
    expect(container.textContent).not.toContain("내용이 달라지면 다시 보여드려요");

    await act(async () => action.resolve(response({
      available: true,
      result: {
        version: 2,
        state: "none",
        recipientUserId: USER_ID,
        claimedForDate: "2026-08-02",
      },
    })));

    expect(container.textContent).toContain(
      "현재 내용은 숨겼어요. 내용이 달라지면 다시 보여드려요.",
    );
  });

  it("navigates to the safe schedule source only after open_source succeeds", async () => {
    const action = deferredResponse();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(READY))
      .mockReturnValueOnce(action.promise));
    await act(async () => root.render(<TodayOneCard />));

    const open = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "일정 열기",
    );
    await act(async () => open?.click());
    expect(push).not.toHaveBeenCalled();

    await act(async () => action.resolve(response({
      available: true,
      result: {
        version: 2,
        state: "none",
        recipientUserId: USER_ID,
        claimedForDate: "2026-08-02",
      },
    })));
    expect(push).toHaveBeenCalledWith("/schedule");
  });

  it("labels budget evidence separately and opens only the budget source after confirmation", async () => {
    const action = deferredResponse();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(BUDGET_READY))
      .mockReturnValueOnce(action.promise));
    await act(async () => root.render(<TodayOneCard />));

    expect(container.textContent).toContain("현재 예산 기록 7 · 확인 전");
    expect(container.textContent).toContain("현재 저장된 예산에서 확인됨");
    expect(container.textContent).toContain("기록 지출은 결제 완료 증빙이 아님");
    const open = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "예산 열기",
    );
    expect(open).toBeDefined();
    await act(async () => open?.click());
    expect(push).not.toHaveBeenCalled();

    await act(async () => action.resolve(response({
      available: true,
      result: {
        version: 2,
        state: "none",
        recipientUserId: USER_ID,
        claimedForDate: "2026-08-02",
      },
    })));
    expect(push).toHaveBeenCalledWith("/budget");
  });

  it("labels a decision follow-up as a decision instead of a schedule", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(DECISION_READY)));
    await act(async () => root.render(<TodayOneCard />));

    expect(container.textContent).toContain("현재 결정 기록 9 · 확인 전");
    expect(container.textContent).toContain("현재 저장된 결정에서 확인됨");
    expect(container.textContent).not.toContain("현재 일정 기록 9");
  });

  it("keeps the card when a nominal success cannot be verified for the owner", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response(READY))
      .mockResolvedValueOnce(response({
        available: true,
        result: {
          version: 2,
          state: "none",
          recipientUserId: "90000000-0000-4000-8000-000000000009",
          claimedForDate: "2026-08-02",
        },
      })));
    await act(async () => root.render(<TodayOneCard />));

    const dismiss = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "오늘 숨기기",
    );
    await act(async () => dismiss?.click());

    expect(container.textContent).toContain("내일 상견례 일정이 있어요.");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "응답을 확인하지 못했어요",
    );
    expect(container.textContent).not.toContain("오늘은 숨겼어요");
  });

  it("offers retry for stale and failed reads, but stays invisible when unavailable", async () => {
    const stale = {
      available: true,
      code: "TODAY_ONE_SOURCE_STALE",
      error: "준비 기록이 바뀌었어요. 최신 내용을 다시 확인해 주세요.",
      result: {
        version: 2,
        state: "source_stale",
        recipientUserId: USER_ID,
        claimedForDate: "2026-08-02",
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(stale, false, 409))
      .mockResolvedValueOnce(response(READY));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<TodayOneCard />));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "준비 기록이 바뀌었어요",
    );
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "다시 불러오기",
    );
    await act(async () => retry?.click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("내일 상견례 일정이 있어요.");

    __resetTodayOneCardRequestCacheForTests();
    fetchMock.mockResolvedValueOnce(response({ available: false }));
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(<TodayOneCard />);
    });
    expect(container.textContent).toBe("");
  });

  it("renders a quiet empty or paused state only for opted-in available users", async () => {
    const empty = {
      available: true,
      result: {
        version: 2,
        state: "none",
        recipientUserId: USER_ID,
        claimedForDate: "2026-08-02",
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(empty)));
    await act(async () => root.render(<TodayOneCard />));
    expect(container.textContent).toContain("오늘 새로 확인할 내용은 없어요");
  });
});
