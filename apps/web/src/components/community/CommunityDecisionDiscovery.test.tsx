import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CommunityDecisionDiscovery from "./CommunityDecisionDiscovery";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    as,
    prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    as?: string;
    prefetch?: boolean;
  }) => {
    void prefetch;
    return <a href={String(as ?? href)} {...props}>{children}</a>;
  },
}));

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const OUTCOME_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

function decisionItem(overrides: Record<string, unknown> = {}) {
  return {
    threadId: THREAD_ID,
    postId: POST_ID,
    state: "answered",
    version: 2,
    kind: "experience_question",
    topicCategory: "contract_extra_cost",
    experienceScope: "extra_charge",
    coarseRegion: "서울",
    preparationStage: "contract_review",
    contractPhase: "before_contract",
    desiredAnswer: "계약서에서 어떤 문구를 다시 확인했는지 궁금해요.",
    title: "계약 전인데 예상하지 못한 추가금이 생겼어요",
    content: "계약서를 다시 보기 전에 비슷한 상황을 겪은 분의 경험을 듣고 싶어요.",
    contentOrigin: "member",
    commercialRelationship: "none",
    sponsorshipDetail: null,
    author: { nickname: "준비중인둘", badge: "계약 경험" },
    qualifiedPeerAnswerCount: 2,
    qualifiedProfessionalAnswerCount: 1,
    viewer: { isAuthor: false, canAnswer: false },
    outcome: null,
    createdAt: "2026-08-04T00:00:00.000Z",
    sortAt: "2026-08-04T01:00:00.000Z",
    ...overrides,
  };
}

function feed(mode: "for_you" | "needs_help" | "outcomes", items: unknown[]) {
  return { items, nextCursor: null, hasMore: false, mode };
}

function jsonResponse(payload: unknown, ok = true) {
  return { ok, json: async () => payload };
}

async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("CommunityDecisionDiscovery", () => {
  let root: Root;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("mode=outcomes")) {
        return Promise.resolve(jsonResponse(feed("outcomes", [
          decisionItem({
            state: "completed",
            version: 5,
            outcome: {
              id: OUTCOME_ID,
              revision: 1,
              actionTaken: "계약서 특약을 다시 요청했어요.",
              resultSummary: "업체와 확인해 추가금 조건을 계약서에 분리해 적었어요.",
              applicableConditions: "본계약 전에 특약을 수정할 수 있었던 경우",
              commercialRelationship: "paid",
              sponsorshipDetail: "결과 작성 뒤 업체로부터 원고료를 받았어요.",
              createdAt: "2026-08-04T02:00:00.000Z",
            },
          }),
        ])));
      }
      if (url.includes("mode=needs_help")) {
        return Promise.resolve(jsonResponse(feed("needs_help", [])));
      }
      return Promise.resolve(jsonResponse(feed("for_you", [decisionItem()])));
    });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("shows honest discovery tabs and orders source, conditions, and state before response counts", async () => {
    await act(async () => {
      root.render(<CommunityDecisionDiscovery viewerId={null} />);
      await flushEffects();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/community/decision-threads?mode=for_you&limit=5",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
    expect(container.textContent).toContain("둘러보기");
    expect(container.textContent).toContain("내 경험 필요");
    expect(container.textContent).toContain("결과");
    expect(container.textContent).not.toContain("나에게");

    const text = container.textContent ?? "";
    const metricsIndex = text.indexOf("경험 답변 2개");
    expect(text.indexOf("회원이 직접 작성")).toBeLessThan(metricsIndex);
    expect(text.indexOf("추가금")).toBeLessThan(metricsIndex);
    expect(text.indexOf("사람 답변 도착")).toBeLessThan(metricsIndex);
    expect(container.querySelector("a")?.getAttribute("href"))
      .toBe(`/wedding/community/post/${POST_ID}`);
  });

  it("loads the outcomes tab from its own endpoint and labels only the reviewed projection", async () => {
    await act(async () => {
      root.render(<CommunityDecisionDiscovery viewerId={null} />);
      await flushEffects();
    });

    const outcomesButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "결과",
    );
    await act(async () => {
      outcomesButton?.click();
      await flushEffects();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/community/decision-threads?mode=outcomes&limit=5",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
    expect(container.textContent).toContain("작성자가 돌아와 남긴 결과");
    expect(container.textContent).toContain("추가금 조건을 계약서에 분리해 적었어요");
    expect(container.textContent).toContain("결과 관계 공개 · 유료 협업");
    expect(container.textContent).toContain("결과 작성 뒤 업체로부터 원고료를 받았어요");
    expect(container.textContent).not.toContain("정답");
    expect(container.textContent).not.toContain("대표 결과");
  });

  it("shows one factual inbox line only for an authenticated viewer with actual items", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/community/decision-threads/inbox")) {
        return Promise.resolve(jsonResponse({
          waitingReplies: {
            count: 2,
            targetQuestionId: "55555555-5555-4555-8555-555555555555",
            targetStatus: "open",
          },
          experienceNeeded: {
            count: 1,
            targetThreadId: THREAD_ID,
          },
          returnedOutcomes: {
            count: 3,
            targetThreadId: THREAD_ID,
          },
        }));
      }
      return Promise.resolve(jsonResponse(feed("for_you", [])));
    });

    await act(async () => {
      root.render(<CommunityDecisionDiscovery viewerId={USER_ID} />);
      await flushEffects();
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe(
      "내 결정함 · 답변을 기다리는 내 질문 2개 · 내 경험이 필요한 질문 1개 · 돌아온 결과 3개",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/community/decision-threads/inbox",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("does not request or invent an inbox for a guest", async () => {
    await act(async () => {
      root.render(<CommunityDecisionDiscovery viewerId={null} />);
      await flushEffects();
    });

    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/inbox")))
      .toBe(false);
    expect(container.textContent).not.toContain("내 결정함");
  });

  it("does not render a late decision response after the authenticated viewer changes", async () => {
    let resolveFirstFeed: ((value: unknown) => void) | null = null;
    let feedRequestCount = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/community/decision-threads/inbox")) {
        return Promise.resolve(jsonResponse({
          waitingReplies: { count: 0, targetQuestionId: null, targetStatus: null },
          experienceNeeded: { count: 0, targetThreadId: null },
          returnedOutcomes: { count: 0, targetThreadId: null },
        }));
      }
      feedRequestCount += 1;
      if (feedRequestCount === 1) {
        return new Promise((resolve) => {
          resolveFirstFeed = resolve;
        });
      }
      return Promise.resolve(jsonResponse(feed("for_you", [decisionItem({
        title: "새 계정에서 볼 수 있는 질문",
      })])));
    });

    await act(async () => {
      root.render(<CommunityDecisionDiscovery viewerId={USER_ID} />);
      await Promise.resolve();
    });
    await act(async () => {
      root.render(
        <CommunityDecisionDiscovery viewerId="66666666-6666-4666-8666-666666666666" />,
      );
      await flushEffects();
    });
    expect(container.textContent).toContain("새 계정에서 볼 수 있는 질문");

    await act(async () => {
      resolveFirstFeed?.(jsonResponse(feed("for_you", [decisionItem({
        title: "이전 계정에서만 보이던 질문",
      })])));
      await flushEffects();
    });

    expect(container.textContent).toContain("새 계정에서 볼 수 있는 질문");
    expect(container.textContent).not.toContain("이전 계정에서만 보이던 질문");
  });

  it("removes the whole panel after an initial API failure so the existing feed can lead", async () => {
    let resolveRequest: ((value: unknown) => void) | null = null;
    fetchMock.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    await act(async () => {
      root.render(<CommunityDecisionDiscovery viewerId={null} />);
    });
    expect(container.querySelector('[data-decision-feed-state="loading"]')).not.toBeNull();

    await act(async () => {
      resolveRequest?.(jsonResponse({ code: "unavailable" }, false));
      await flushEffects();
    });

    expect(container.querySelector("[data-community-decision-discovery]")).toBeNull();
  });

  it("abandons a stalled initial request so the existing feed is not held behind loading", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("request timed out", "AbortError"));
        }, { once: true });
      })
    ));

    await act(async () => {
      root.render(<CommunityDecisionDiscovery viewerId={null} />);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-decision-feed-state="loading"]')).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
      await flushEffects();
    });

    expect(container.querySelector("[data-community-decision-discovery]")).toBeNull();
  });
});
