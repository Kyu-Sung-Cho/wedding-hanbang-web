import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetChatComposerSession } from "@/stores/chatComposerStore";
import { useChatComposerDrafts } from "./useChatComposerDrafts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type ComposerApi = ReturnType<typeof useChatComposerDrafts>;

function ComposerProbe({ identity, onReady }: {
  identity: string;
  onReady: (api: ComposerApi) => void;
}) {
  const api = useChatComposerDrafts(identity);
  useLayoutEffect(() => { onReady(api); }, [api, onReady]);
  return <output>{api[0].private_ai.input}</output>;
}

describe("useChatComposerDrafts session-bound async setters", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestApi: ComposerApi | undefined;
  const onReady = (api: ComposerApi) => { latestApi = api; };
  const currentApi = () => {
    if (!latestApi) throw new Error("Composer did not commit");
    return latestApi;
  };
  const render = async (identity: string) => {
    await act(async () => { root.render(<ComposerProbe identity={identity} onReady={onReady} />); });
  };

  beforeEach(() => {
    resetChatComposerSession();
    latestApi = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    resetChatComposerSession();
  });

  it("does not let an old owner's delayed setter write into a new owner's private draft", async () => {
    await render("owner-a");
    const oldSetter = currentApi()[1];

    await act(async () => {
      resetChatComposerSession();
      root.render(<ComposerProbe identity="owner-b" onReady={onReady} />);
    });
    await act(async () => {
      currentApi()[1](drafts => ({
        ...drafts,
        private_ai: { ...drafts.private_ai, input: "owner-b's unsent draft", retryClientRequestId: "owner-b-request" },
      }));
    });

    await act(async () => {
      oldSetter(drafts => ({
        ...drafts,
        private_ai: { ...drafts.private_ai, input: "owner-a's late private reply", retryClientRequestId: "owner-a-request" },
      }));
    });

    expect(container.textContent).toBe("owner-b's unsent draft");
    expect(currentApi()[0].private_ai.retryClientRequestId).toBe("owner-b-request");
  });

  it("does not restore pre-reset content through an old setter when the owner is unchanged", async () => {
    await render("owner-a");
    const oldSetter = currentApi()[1];
    await act(async () => { resetChatComposerSession(); });
    await act(async () => {
      currentApi()[1](drafts => ({
        ...drafts,
        private_ai: { ...drafts.private_ai, input: "new session draft", retryClientRequestId: "new-session-request" },
      }));
    });

    await act(async () => {
      oldSetter(drafts => ({
        ...drafts,
        private_ai: { ...drafts.private_ai, input: "discarded session reply", retryClientRequestId: "discarded-request" },
      }));
    });

    expect(container.textContent).toBe("new session draft");
    expect(currentApi()[0].private_ai.retryClientRequestId).toBe("new-session-request");
  });

  it("accepts the original async setter after unmount and remount within the same owner session", async () => {
    await render("owner-a");
    const originalSetter = currentApi()[1];
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await render("owner-a");

    await act(async () => {
      originalSetter(drafts => ({
        ...drafts,
        private_ai: { ...drafts.private_ai, input: "same-session recovered draft", retryClientRequestId: "original-request" },
      }));
    });

    expect(container.textContent).toBe("same-session recovered draft");
    expect(currentApi()[0].private_ai.retryClientRequestId).toBe("original-request");
    expect(currentApi()[0].shared_ai.input).toBe("");
    expect(currentApi()[0].shared_partner.input).toBe("");
  });
});
