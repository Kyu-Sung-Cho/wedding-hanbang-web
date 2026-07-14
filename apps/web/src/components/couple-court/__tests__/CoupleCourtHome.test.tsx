import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourtCase, PublicCourtCase } from "../types";

const mocks = vi.hoisted(() => ({
  captureCourtEvent: vi.fn(),
  listCases: vi.fn(),
  listPublicCases: vi.fn(),
}));

vi.mock("../api", () => ({
  listCases: mocks.listCases,
  listPublicCases: mocks.listPublicCases,
}));

vi.mock("../analytics", () => ({
  captureCourtEvent: mocks.captureCourtEvent,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, as, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { as?: string }) => (
    <a href={as ?? String(href)} {...props}>{children}</a>
  ),
}));

import CoupleCourtHome from "../CoupleCourtHome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function courtCase(id: string, title: string): CourtCase {
  return {
    id,
    title,
    category: "budget",
    mode: "solo",
    tone: "gentle",
    status: "draft",
    applicantStatementSubmitted: false,
    partnerJoined: false,
    partnerStatementSubmitted: false,
    canJudge: false,
    verdictReady: false,
    safetyLevel: "normal",
  };
}

function publicCase(id: string, title: string): PublicCourtCase {
  return {
    id,
    title,
    summary: "공개용 안전 요약",
    category: "budget",
    mode: "solo",
    commentsEnabled: true,
    safetyLevel: "normal",
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(label));
}

describe("CoupleCourtHome returning-user journey", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listCases.mockResolvedValue({ cases: [], nextCursor: null });
    mocks.listPublicCases.mockResolvedValue({
      posts: [], total: 0, page: 1, limit: 3, totalPages: 1, hasMore: false,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("places a returning user's private cases before discovery content", async () => {
    mocks.listCases.mockResolvedValue({
      cases: [courtCase("case-1", "계속 작성할 예산 사건")],
      nextCursor: null,
    });

    await act(async () => root.render(<CoupleCourtHome publicEnabled />));
    await settle();

    const ownCases = container.querySelector("#my-cases");
    const popular = container.querySelector('[aria-labelledby="popular-cases-title"]');
    const examples = container.querySelector('[aria-labelledby="frequent-cases-title"]');
    expect(ownCases?.textContent).toContain("계속 작성할 예산 사건");
    expect(ownCases?.compareDocumentPosition(popular!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(popular?.compareDocumentPosition(examples!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("shows loading and a retryable error instead of falsely claiming the popular feed is empty", async () => {
    let rejectPopular: ((reason?: unknown) => void) | undefined;
    mocks.listPublicCases.mockReturnValueOnce(new Promise((_, reject) => {
      rejectPopular = reject;
    }));

    await act(async () => root.render(<CoupleCourtHome publicEnabled />));
    await settle();

    expect(container.textContent).toContain("인기 공개재판을 확인하는 중이에요.");
    expect(container.textContent).not.toContain("아직 공개 심사를 마친 인기 사건이 없어요");

    await act(async () => rejectPopular?.(new Error("공개 피드 연결이 지연되고 있어요.")));
    await settle();
    expect(container.textContent).toContain("공개 피드 연결이 지연되고 있어요.");
    expect(container.textContent).not.toContain("아직 공개 심사를 마친 인기 사건이 없어요");

    mocks.listPublicCases.mockResolvedValueOnce({
      posts: [publicCase("post-1", "다시 불러온 공개 사건")],
      total: 1, page: 1, limit: 3, totalPages: 1, hasMore: false,
    });
    const popularSection = container.querySelector<HTMLElement>('[aria-labelledby="popular-cases-title"]');
    await act(async () => button(popularSection!, "다시 시도")?.click());
    await settle();

    expect(popularSection?.textContent).toContain("다시 불러온 공개 사건");
    expect(popularSection?.textContent).not.toContain("공개 피드 연결이 지연되고 있어요.");
  });

  it("appends older private cases without duplicating an overlapping cursor row", async () => {
    mocks.listCases
      .mockResolvedValueOnce({
        cases: [courtCase("case-3", "가장 최근 사건"), courtCase("case-2", "중간 사건")],
        nextCursor: "older-cursor",
      })
      .mockResolvedValueOnce({
        cases: [courtCase("case-2", "중간 사건"), courtCase("case-1", "가장 오래된 사건")],
        nextCursor: null,
      });

    await act(async () => root.render(<CoupleCourtHome publicEnabled={false} />));
    await settle();
    await act(async () => button(container, "이전 사건 더 보기")?.click());
    await settle();

    const cards = Array.from(
      container.querySelectorAll("#my-cases article h3"),
      (heading) => heading.textContent,
    );
    expect(cards).toEqual(["가장 최근 사건", "중간 사건", "가장 오래된 사건"]);
    expect(mocks.listCases).toHaveBeenNthCalledWith(2, "older-cursor");
    expect(container.textContent).not.toContain("이전 사건 더 보기");
  });
});
