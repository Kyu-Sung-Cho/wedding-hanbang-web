// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureEventSpy } = vi.hoisted(() => ({
  captureEventSpy: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  captureEvent: captureEventSpy,
}));

import WeddingCourtClient from "./WeddingCourtClient";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const CASE_ID = "11111111-1111-4111-8111-111111111901";
const SAFETY_NOTICE =
  "이 사건은 실제 커플 사연이 아닌 합성 사례예요. 의견 분포는 정답이나 판결이 아니며, 준비 계획에는 자동 반영되지 않아요.";

const baseCase = {
  id: CASE_ID,
  slug: "invitation-photo",
  docketLabel: "합성 사건 01",
  title: "모바일 청첩장 대표 사진",
  question: "어떤 사진을 모바일 청첩장 첫 화면에 두면 좋을까요?",
  opening: "두 사진 모두 이유가 있지만 첫인상은 하나만 고를 수 있어요.",
  initialFacts: [
    "자연스러운 사진에는 두 사람다운 분위기가 담겼어요.",
    "단정한 사진은 정보가 한눈에 들어와요.",
  ],
  choices: {
    a: "우리다운 자연스러운 순간",
    b: "누구나 보기 편한 단정한 컷",
  },
  reasonChips: [
    { id: "couple_style", label: "두 사람다운 분위기" },
    { id: "first_impression", label: "첫인상" },
    { id: "family_sharing", label: "가족 공유" },
    { id: "information_clarity", label: "정보 전달" },
  ],
  synthetic: true as const,
  safetyNotice: SAFETY_NOTICE,
};

const firstVoteCase = {
  ...baseCase,
  stage: "first_vote" as const,
  ownVotes: {},
};

const perspectiveA = {
  choice: "a" as const,
  label: baseCase.choices.a,
  text: "두 사람의 이야기와 분위기를 중요하게 생각하는 관점이에요.",
  signal: "more_selected" as const,
};
const perspectiveB = {
  choice: "b" as const,
  label: baseCase.choices.b,
  text: "누구나 편하게 이해하는 전달력을 중요하게 생각하는 관점이에요.",
  signal: "less_selected" as const,
};

const appealCase = {
  ...baseCase,
  stage: "appeal_vote" as const,
  ownVotes: {
    first: {
      round: 1 as const,
      choice: "a" as const,
      reasonChip: "couple_style",
      predictedMajority: "b" as const,
    },
  },
  firstRound: {
    distribution: {
      totalVotes: 3,
      lean: "a" as const,
      a: { count: 2, percent: 67 },
      b: { count: 1, percent: 33 },
      reasons: {
        a: [{ id: "couple_style", label: "두 사람다운 분위기", count: 2 }],
        b: [{ id: "first_impression", label: "첫인상", count: 1 }],
      },
    },
    predictionMatchesCurrentLean: false,
    perspectives: [perspectiveA, perspectiveB],
  },
  newEvidence: {
    title: "새 단서: 공유 방식",
    detail: "부모님도 같은 링크를 친척에게 공유할 예정이에요.",
  },
};

function jsonResponse(value: object) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("WeddingCourtClient safe fun loop", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    captureEventSpy.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("keeps results hidden, collects only chips, then opens evidence after first vote", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ cases: [firstVoteCase] }))
      .mockResolvedValueOnce(
        jsonResponse({ action: "created", case: appealCase }),
      );

    await act(async () => {
      root.render(<WeddingCourtClient />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("오늘의 웨딩 선택 법정");
    expect(captureEventSpy).toHaveBeenCalledWith("wedding_court_opened", {
      case_count: 1,
      completed_count: 0,
    });
    expect(container.textContent).toContain("먼저 고른 사람에게만 분포가 열려요");
    expect(container.textContent).not.toContain("부모님도 같은 링크");
    expect(container.textContent).not.toContain("현재 3명의 선택 분포");
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('input[type="text"]')).toBeNull();

    const groups = Array.from(
      container.querySelectorAll<HTMLElement>('[role="group"]'),
    );
    expect(groups).toHaveLength(3);
    const choiceButton = groups[0]?.querySelector<HTMLButtonElement>("button");
    const reasonButton = groups[1]?.querySelector<HTMLButtonElement>("button");
    const predictionButtons =
      groups[2]?.querySelectorAll<HTMLButtonElement>("button");
    const predictionButton = predictionButtons?.[1];
    expect(choiceButton).toBeTruthy();
    expect(reasonButton).toBeTruthy();
    expect(predictionButton).toBeTruthy();

    await act(async () => choiceButton?.click());

    const refreshedGroupsAfterChoice = Array.from(
      container.querySelectorAll<HTMLElement>('[role="group"]'),
    );
    const refreshedReasonButton =
      refreshedGroupsAfterChoice[1]?.querySelector<HTMLButtonElement>("button");
    await act(async () => refreshedReasonButton?.click());

    const refreshedGroupsAfterReason = Array.from(
      container.querySelectorAll<HTMLElement>('[role="group"]'),
    );
    const refreshedPredictionButton =
      refreshedGroupsAfterReason[2]?.querySelectorAll<HTMLButtonElement>("button")[1];
    await act(async () => refreshedPredictionButton?.click());

    const submitButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("1심 제출"));
    expect(submitButton?.disabled).toBe(false);

    await act(async () => {
      submitButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const submitCall = fetchMock.mock.calls[1];
    expect(submitCall?.[0]).toBe(
      `/api/community/wedding-court/${CASE_ID}/vote`,
    );
    const requestBody = submitCall?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    expect(String(requestBody)).not.toContain("user_id");
    expect(String(requestBody)).toContain('"reason_chip":"couple_style"');
    expect(captureEventSpy).toHaveBeenCalledWith(
      "wedding_court_first_vote_completed",
      { case_slug: "invitation-photo" },
    );
    expect(
      captureEventSpy.mock.calls.flatMap((call) =>
        Object.keys((call[1] as Record<string, unknown> | undefined) ?? {}),
      ),
    ).not.toContain("reason_chip");

    expect(container.textContent).toContain("현재 3명의 선택 분포");
    expect(container.textContent).toContain("부모님도 같은 링크");
    expect(container.textContent).toContain("항소심 제출하고 결말 보기");
    expect(container.textContent).toContain("준비 계획에는 자동 반영되지 않아요");
  });
});
