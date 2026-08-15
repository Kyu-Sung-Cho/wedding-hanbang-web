// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatBubble from "../ChatBubble";
import MediationCard from "../MediationCard";
import type { ChatMessage } from "@/types/database.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const MESSAGE_ID = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";
const REQUESTER_SUMMARY_DRAFT = {
  empathy: "요청자가 답답함을 느꼈다고 전했어요.",
  translation: "요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
  data: "상대방의 예산 상한은 아직 확인되지 않았어요.",
  resolution: "예산 상한선을 같이 확인해 봐요",
  origin: "user_requested" as const,
  evidenceScope: "requester_summary_only" as const,
  schemaVersion: 2 as const,
};
const CONFIRMABLE_BLOCK = {
  ...REQUESTER_SUMMARY_DRAFT,
  proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
  rosterFingerprint: "0123456789abcdef0123456789abcdef",
};

function apiResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

async function flushAsyncUpdates() {
  await act(async () => {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  });
}

describe("Amora mediation card wiring", () => {
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
    vi.unstubAllGlobals();
  });

  it("renders the confirmation card inside the AI-message branch", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/app/chat/ChatBubble.tsx"),
      "utf8",
    );
    const aiBranchStart = source.indexOf('if (sender_role === "ai")');
    const userBranchStart = source.indexOf("// 사용자 메시지", aiBranchStart);
    expect(aiBranchStart).toBeGreaterThanOrEqual(0);
    expect(userBranchStart).toBeGreaterThan(aiBranchStart);

    const aiBranch = source.slice(aiBranchStart, userBranchStart);
    expect(aiBranch).toContain("message.metadata?.mediation");
    expect(aiBranch).toContain("normalizeMediationBlock(message.metadata?.mediation)");
    expect(aiBranch).not.toContain("as MediationBlock");
    expect(aiBranch).toContain('key={`${message.id}:${mediationBlock.proposalVersion ?? "draft"}:${mediationBlock.rosterFingerprint ?? "unknown-roster"}`}');
    expect(aiBranch).toMatch(/<MediationCard[\s\S]*block=\{mediationBlock\}[\s\S]*messageId=\{message\.id\}/);
  });

  it("hides the entire stored AI body when its mediation draft fails render safety", async () => {
    const unsafeBody = "신랑은 이기적이고 신부가 더 타당해요.";
    const unsafeMessage: ChatMessage = {
      id: MESSAGE_ID,
      couple_id: "2474c6f2-29c6-4c77-8d91-d3347eef4c3f",
      sender_id: null,
      sender_role: "ai",
      content: unsafeBody,
      metadata: {
        mediation: {
          translation: unsafeBody,
          resolution: "신랑이 먼저 사과하고 양보하세요.",
        },
      },
      visibility: "bride_private",
      created_at: "2026-08-12T12:00:00.000Z",
    };

    await act(async () => {
      root.render(createElement(ChatBubble, {
        message: unsafeMessage,
        isCurrentUser: false,
      }));
    });

    expect(container.textContent).toContain("원문을 표시하지 않았어요");
    expect(container.textContent).not.toContain(unsafeBody);
    expect(container.textContent).not.toContain("먼저 사과하고 양보");
  });

  it("keeps ordinary AI and safe mediation bodies visible", async () => {
    const baseMessage: ChatMessage = {
      id: MESSAGE_ID,
      couple_id: "2474c6f2-29c6-4c77-8d91-d3347eef4c3f",
      sender_id: null,
      sender_role: "ai",
      content: "오늘 확인할 일 세 가지를 정리했어요.",
      metadata: null,
      visibility: "bride_private",
      created_at: "2026-08-12T12:00:00.000Z",
    };

    await act(async () => {
      root.render(createElement(ChatBubble, {
        message: baseMessage,
        isCurrentUser: false,
      }));
    });
    expect(container.textContent).toContain(baseMessage.content);

    const safeMediationBody = "예산 상한선을 함께 확인할 선택안을 정리했어요.";
    await act(async () => {
      root.render(createElement(ChatBubble, {
        message: {
          ...baseMessage,
          content: safeMediationBody,
          metadata: {
            mediation: {
              data: "민수는 3천만원, 지수는 2천만원을 제안했어요.",
              resolution: "서로 조정 가능한 범위를 하나씩 확인해 봐요.",
            },
          },
        },
        isCurrentUser: false,
      }));
    });

    expect(container.textContent).toContain(safeMediationBody);
    expect(container.textContent).toContain("서로 조정 가능한 범위");
    expect(container.textContent).not.toContain("원문을 표시하지 않았어요");
  });

  it("sends the displayed exact revision with every acceptance operation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/app/chat/MediationCard.tsx"),
      "utf8",
    );
    expect(source).toContain('fetch("/api/amora/mediation/accept"');
    expect(source).toContain("expectedProposalVersion");
    expect(source).toContain("expectedRosterFingerprint");
    expect(source).toContain("body: JSON.stringify({ messageId, ...exactRevision })");
    expect(source).toMatch(/useEffect\(\(\) => \{\s*void refreshAcceptance\(\);\s*\}, \[\s*expectedProposalVersion,\s*expectedRosterFingerprint,\s*refreshAcceptance,\s*\]\);/);
  });

  it("lets a person revoke only their pending confirmation through the server contract", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/app/chat/MediationCard.tsx"),
      "utf8",
    );
    expect(source).toContain('updateAcceptance("DELETE")');
    expect(source).toContain("내 확인 취소");
    expect(source).toContain("acceptance?.completed");
  });

  it("labels the draft as the requester's account and leaves the partner's view unconfirmed", async () => {
    await act(async () => {
      root.render(createElement(MediationCard, {
        block: REQUESTER_SUMMARY_DRAFT,
        messageId: MESSAGE_ID,
      }));
    });

    expect(container.textContent).toContain("요청자가 전한 상황");
    expect(container.textContent).toContain("상대방에게 확인할 점");
    expect(container.textContent).toContain("상대방의 생각은 아직 확인되지 않았어요");
    expect(container.textContent).not.toContain("두 사람이 말한 내용");
    expect(container.textContent).not.toContain("두 분의 대화");
  });

  it("lets a waiting person refresh after their partner confirms", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(apiResponse({
        accepted: true,
        acceptedCount: 1,
        requiredCount: 2,
        completed: false,
        partnerLinked: true,
      }))
      .mockResolvedValueOnce(apiResponse({
        accepted: true,
        acceptedCount: 2,
        requiredCount: 2,
        completed: true,
        partnerLinked: true,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(createElement(MediationCard, {
        block: CONFIRMABLE_BLOCK,
        messageId: MESSAGE_ID,
      }));
    });
    await flushAsyncUpdates();

    expect(container.textContent).toContain("상대방 확인을 기다리고 있어요");
    const refreshButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("확인 상태 새로고침"));
    expect(refreshButton).toBeDefined();

    await act(async () => refreshButton?.click());
    await flushAsyncUpdates();

    expect(container.textContent).toContain("두 분이 각각 확인해 공동 결정으로 저장했어요");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      `expectedProposalVersion=${CONFIRMABLE_BLOCK.proposalVersion}`,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      `expectedRosterFingerprint=${CONFIRMABLE_BLOCK.rosterFingerprint}`,
    );
  });

  it("refreshes stale server state after confirming returns a conflict", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(apiResponse({
        accepted: false,
        acceptedCount: 0,
        requiredCount: 2,
        completed: false,
        partnerLinked: true,
      }))
      .mockResolvedValueOnce(apiResponse({ error: "확인 상태가 먼저 변경됐어요." }, 409))
      .mockResolvedValueOnce(apiResponse({
        accepted: true,
        acceptedCount: 1,
        requiredCount: 2,
        completed: false,
        partnerLinked: true,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(createElement(MediationCard, {
        block: CONFIRMABLE_BLOCK,
        messageId: MESSAGE_ID,
      }));
    });
    await flushAsyncUpdates();

    const confirmButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("이 선택안을 나는 확인했어요"));
    expect(confirmButton).toBeDefined();

    await act(async () => confirmButton?.click());
    await flushAsyncUpdates();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      messageId: MESSAGE_ID,
      expectedProposalVersion: CONFIRMABLE_BLOCK.proposalVersion,
      expectedRosterFingerprint: CONFIRMABLE_BLOCK.rosterFingerprint,
    });
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/api/amora/mediation/accept?messageId=");
    expect(container.textContent).toContain("상대방 확인을 기다리고 있어요");
    expect(container.textContent).toContain("확인 상태가 먼저 변경됐어요.");
  });

  it("refreshes completed server state after cancellation returns a conflict", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(apiResponse({
        accepted: true,
        acceptedCount: 1,
        requiredCount: 2,
        completed: false,
        partnerLinked: true,
      }))
      .mockResolvedValueOnce(apiResponse({ error: "이미 공동 결정으로 저장됐어요." }, 409))
      .mockResolvedValueOnce(apiResponse({
        accepted: true,
        acceptedCount: 2,
        requiredCount: 2,
        completed: true,
        partnerLinked: true,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(createElement(MediationCard, {
        block: CONFIRMABLE_BLOCK,
        messageId: MESSAGE_ID,
      }));
    });
    await flushAsyncUpdates();

    const cancelButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("내 확인 취소"));
    expect(cancelButton).toBeDefined();

    await act(async () => cancelButton?.click());
    await flushAsyncUpdates();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      messageId: MESSAGE_ID,
      expectedProposalVersion: CONFIRMABLE_BLOCK.proposalVersion,
      expectedRosterFingerprint: CONFIRMABLE_BLOCK.rosterFingerprint,
    });
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/api/amora/mediation/accept?messageId=");
    expect(container.textContent).toContain("두 분이 각각 확인해 공동 결정으로 저장했어요");
    expect(container.textContent).toContain("이미 공동 결정으로 저장됐어요.");
  });

  it("shows a malformed legacy draft without opening confirmation or the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(createElement(MediationCard, {
        block: { resolution: "초안 내용은 계속 볼 수 있어요" },
        messageId: MESSAGE_ID,
      }));
    });
    await flushAsyncUpdates();

    expect(container.textContent).toContain("초안 내용은 계속 볼 수 있어요");
    expect(container.textContent).toContain("확인 출처가 없는 이전 조율 초안이에요");
    expect(container.textContent).not.toContain("요청자가 직접 적은 요약을 바탕으로");
    expect(container.textContent).not.toContain("이 선택안을 나는 확인했어요");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["forged v2", {
      ...CONFIRMABLE_BLOCK,
      translation: "신랑은 무책임하고 신부의 요구가 더 타당해요.",
      resolution: "신랑이 먼저 사과하고 양보하는 게 좋겠어요.",
    }],
    ["legacy", {
      empathy: "신부가 속상하다고 했어요.",
      translation: "신부는 신랑을 조종하려고 일부러 이러는 거예요.",
      resolution: "신부가 먼저 양보하세요.",
    }],
  ])("never renders unsafe original wording from a %s stored card", async (_label, block) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(createElement(MediationCard, { block, messageId: MESSAGE_ID }));
    });
    await flushAsyncUpdates();

    expect(container.textContent).toContain("원문을 표시하지 않았어요");
    for (const forbidden of ["무책임", "더 타당", "먼저 사과", "조종하려고", "먼저 양보"]) {
      expect(container.textContent).not.toContain(forbidden);
    }
    expect(container.querySelector("button")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
