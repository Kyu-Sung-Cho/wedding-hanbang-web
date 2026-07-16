// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MediationCard from "../MediationCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const MESSAGE_ID = "1474c6f2-29c6-4c77-8d91-d3347eef4c3f";
const CONFIRMABLE_BLOCK = {
  resolution: "예산 상한선을 같이 확인해 봐요",
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
    expect(container.textContent).not.toContain("이 선택안을 나는 확인했어요");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
