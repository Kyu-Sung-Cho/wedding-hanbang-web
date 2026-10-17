import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  routerBack: vi.fn(),
  routerPush: vi.fn(),
  authUserId: null as string | null,
  updatePost: vi.fn(),
  privacyEpoch: 0,
  communityListeners: new Set<() => void>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mocks.routerReplace,
    back: mocks.routerBack,
    push: mocks.routerPush,
  }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mocks.authUserId ? { id: mocks.authUserId } : null },
      })),
    },
  }),
}));

vi.mock("@/stores/communityStore", () => ({
  useCommunityStore: Object.assign(() => ({
    createPost: vi.fn(),
    updatePost: mocks.updatePost,
  }), {
    getState: () => ({ privacyEpoch: mocks.privacyEpoch, errorMessage: null }),
    subscribe: (listener: () => void) => {
      mocks.communityListeners.add(listener);
      return () => mocks.communityListeners.delete(listener);
    },
  }),
}));

vi.mock("@/components/community/ImageUploader", () => ({
  default: () => <div>images</div>,
}));
vi.mock("@/components/community/SlideBuilder", () => ({
  default: () => <div>slides</div>,
}));
vi.mock("@/components/community/TagInput", () => ({
  default: () => <div>tags</div>,
}));
vi.mock("@/components/community/VendorTagPicker", () => ({
  default: () => <div>vendors</div>,
}));
vi.mock("@/components/community/PriceQuestionForm", () => ({
  default: () => <div>price</div>,
}));
vi.mock("@/components/community/PollEditor", () => ({
  default: () => <div>poll</div>,
}));

import PostWritePage from "./page";
import { useAuthStore } from "@/stores/authStore";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

describe("community write login return", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authUserId = null;
    mocks.privacyEpoch = 0;
    mocks.communityListeners.clear();
    useAuthStore.setState({
      user: null,
      profile: null,
      isInitialized: false,
    });
    localStorage.clear();
    sessionStorage.clear();
    const query = new URLSearchParams({
      category: "is_normal",
      prefill: "community_search",
      title: "이 견적 괜찮을까요?",
      body: "추가금이 걱정돼요.",
    });
    window.history.replaceState(
      {},
      "",
      `/wedding/community/post/write?${query.toString()}#draft`,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await act(async () => {
      for (const { root } of mountedRoots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
  });

  async function mountWriter() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    await act(async () => {
      root.render(<PostWritePage />);
      await Promise.resolve();
      await Promise.resolve();
    });
    return container;
  }

  const cancelButtons = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .filter(button => button.getAttribute("aria-label") === "뒤로 가기" || button.textContent === "취소");
  const dialogButton = (container: HTMLElement, text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
    .find(button => button.textContent === text)!;

  it.each([0, 1, 2])("uses the app confirmation for dirty cancel control %s and keeps the draft on stay", async index => {
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = await mountWriter();
    const cancel = cancelButtons(container)[index];
    cancel.focus();
    await act(async () => cancel.click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.textContent).toContain("작성 중인 화면에서 나갈까요?");
    expect(document.activeElement).toBe(dialogButton(container, "계속 작성"));
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(mocks.routerBack).not.toHaveBeenCalled();
    await act(async () => dialogButton(container, "계속 작성").click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[maxlength="200"]')?.value).toBe("이 견적 괜찮을까요?");
    expect(document.activeElement).toBe(cancel);
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
  });

  it("Escape stays in the editor and returns focus to the cancel trigger", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = await mountWriter();
    const cancel = cancelButtons(container)[0];
    cancel.focus();
    await act(async () => cancel.click());
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(cancel);
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("추가금이 걱정돼요.");
    expect(mocks.routerBack).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("leaves only after explicit confirmation and preserves the current guest draft without publishing", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = await mountWriter();
    await act(async () => cancelButtons(container)[0].click());
    await act(async () => dialogButton(container, "나가기").click());
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);
    expect(mocks.routerPush).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("community:post-draft:v2:guest") ?? "{}")).toMatchObject({ title: "이 견적 괜찮을까요?", content: "추가금이 걱정돼요." });
  });

  it("keeps the editor and its text when preserving the draft fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = await mountWriter();
    await act(async () => cancelButtons(container)[0].click());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
    await act(async () => dialogButton(container, "나가기").click());
    expect(mocks.routerBack).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("임시 저장하지 못했어요");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("추가금이 걱정돼요.");
  });

  it("restores the guest text after a confirmed leave and a fresh writer mount", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = await mountWriter();
    await act(async () => cancelButtons(container)[0].click());
    await act(async () => dialogButton(container, "나가기").click());
    const mounted = mountedRoots.pop()!;
    await act(async () => mounted.root.unmount());
    window.history.replaceState({}, "", "/wedding/community/post/write?resume=1");
    const reopened = await mountWriter();
    expect(reopened.querySelector<HTMLInputElement>('input[maxlength="200"]')?.value).toBe("이 견적 괜찮을까요?");
    expect(reopened.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("추가금이 걱정돼요.");
  });

  it("leaves an unsaved edit without changing the saved post or a separate local draft", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mocks.authUserId = "user-a";
    useAuthStore.setState({ user: { id: "user-a", email: "a@example.invalid" }, isInitialized: true });
    window.history.replaceState({}, "", "/community/post/write?edit=qa-post");
    localStorage.setItem("community:post-draft:v2:user-a", "separate existing draft");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "qa-post", author_id: "user-a", category: "free", title: "수정 전", content: "합성 본문", visibility: "members", images: [], tags: [], vendor_tags: [], ad_disclosure: "general" }), { status: 200 })));
    const container = await mountWriter();
    const title = container.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "저장하지 않은 수정");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => cancelButtons(container)[0].click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("저장된 글은 그대로 유지돼요");
    await act(async () => dialogButton(container, "나가기").click());
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);
    expect(mocks.updatePost).not.toHaveBeenCalled();
    expect(localStorage.getItem("community:post-draft:v2:user-a")).toBe("separate existing draft");
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("keeps clean cancel as a direct back navigation without a confirmation", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    window.history.replaceState({}, "", "/community/post/write");
    const container = await mountWriter();
    await act(async () => cancelButtons(container)[0].click());
    expect(mocks.routerBack).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("blocks a stale confirmation after an auth owner transition before React commits", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = await mountWriter();
    await act(async () => cancelButtons(container)[0].click());
    const leave = dialogButton(container, "나가기");
    await act(async () => {
      mocks.authUserId = "user-b";
      useAuthStore.setState({ user: { id: "user-b", email: "b@example.invalid" }, isInitialized: true });
      leave.click();
      await Promise.resolve();
    });
    expect(mocks.routerBack).not.toHaveBeenCalled();
    expect(localStorage.getItem("community:post-draft:v2:guest")).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("invalidates a same-owner confirmation after the community privacy epoch changes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const container = await mountWriter();
    await act(async () => cancelButtons(container)[0].click());
    const leave = dialogButton(container, "나가기");
    await act(async () => {
      mocks.privacyEpoch += 1;
      for (const listener of mocks.communityListeners) listener();
      leave.click();
    });
    expect(mocks.routerBack).not.toHaveBeenCalled();
    expect(localStorage.getItem("community:post-draft:v2:guest")).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("blocks all cancel controls and same-render reentry while an edit submission is pending", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    mocks.authUserId = "user-a";
    useAuthStore.setState({ user: { id: "user-a", email: "a@example.invalid" }, isInitialized: true });
    window.history.replaceState({}, "", "/community/post/write?edit=qa-post");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "qa-post", author_id: "user-a", category: "free", title: "수정 전", content: "합성 본문", visibility: "members", images: [], tags: [], vendor_tags: [], ad_disclosure: "general" }), { status: 200 })));
    let finish: ((value: boolean) => void) | undefined;
    mocks.updatePost.mockReturnValue(new Promise<boolean>(resolve => { finish = resolve; }));
    const container = await mountWriter();
    const title = container.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "수정 후");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "수정하기")!;
    await act(async () => {
      submit.click();
      cancelButtons(container)[0].click();
    });
    expect(mocks.updatePost).toHaveBeenCalledTimes(1);
    expect(cancelButtons(container).every(button => button.disabled)).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.routerBack).not.toHaveBeenCalled();
    await act(async () => { finish?.(true); await Promise.resolve(); });
    expect(mocks.routerPush).toHaveBeenCalledWith("/wedding/community/post/qa-post");
  });

  it.each(["draft", "members"])("submits an explicit PATCH payload for a %s post without creation-only fields", async (visibility) => {
    mocks.authUserId = "user-a";
    mocks.updatePost.mockResolvedValue(true);
    useAuthStore.setState({ user: { id: "user-a", email: "qa-a@example.invalid" }, isInitialized: true });
    window.history.replaceState({}, "", "/community/post/write?edit=qa-post");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "qa-post", author_id: "user-a", category: "free", title: "QA 수정 전",
      content: "합성 수정 본문입니다.", visibility, images: [], tags: [],
      vendor_tags: [], ad_disclosure: "general",
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    await act(async () => {
      root.render(<PostWritePage />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const categoryButtons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .filter((button) => button.parentElement?.className.includes("sm:grid-cols-2"));
    expect(categoryButtons.length).toBeGreaterThan(1);
    expect(categoryButtons.every((button) => button.disabled)).toBe(true);
    expect(container.textContent).toContain("수정할 때는 카테고리를 바꿀 수 없어요");
    const titleInput = container.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    const contentInput = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(titleInput, "QA 수정 후");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(contentInput, "합성 수정 후 본문입니다.");
      contentInput.dispatchEvent(new Event("input", { bubbles: true }));
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "회원 공개")?.click();
    });
    const submit = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("수정하기"));
    await act(async () => { submit?.click(); await Promise.resolve(); });
    expect(mocks.updatePost).toHaveBeenCalledTimes(1);
    const payload = mocks.updatePost.mock.calls[0][1];
    expect(payload).toMatchObject({ title: "QA 수정 후", content: "합성 수정 후 본문입니다.", visibility: "members" });
    expect(payload).not.toHaveProperty("category");
    expect(payload).not.toHaveProperty("poll");
    expect(payload).not.toHaveProperty("rating");
    expect(payload.sponsorship_detail).toBeNull();
    expect(payload.price_data).toBeNull();
  });

  it("lets a guest review the question and preserves it through login at publish", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(<PostWritePage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.routerReplace).not.toHaveBeenCalled();
    expect(container.textContent).toContain("로그인은 게시할 때만 필요해요");
    expect(container.textContent).toContain(
      "건강·임신·성생활·민감한 가족관계, 계약·예약번호는 지워 주세요",
    );
    expect(container.textContent).toContain(
      "지금은 사진 없이 텍스트로만 질문할 수 있어요",
    );
    expect(container.textContent).not.toContain("사진 속 글자는 자동으로 가려지지 않아요");

    const publishButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("로그인하고 질문 올리기"),
    );
    expect(publishButton).toBeTruthy();
    const safetyCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(safetyCheckbox).not.toBeNull();

    const resumeUrl = new URL(window.location.href);
    resumeUrl.searchParams.set("resume", "1");
    const currentWritePath = `${resumeUrl.pathname}${resumeUrl.search}${resumeUrl.hash}`;

    await act(async () => {
      safetyCheckbox?.click();
    });
    await act(async () => {
      publishButton?.click();
    });

    expect(mocks.routerReplace).toHaveBeenCalledWith(
      `/login?redirect=${encodeURIComponent(currentWritePath)}`,
    );
    expect(JSON.parse(localStorage.getItem("community:post-draft:v2:guest") ?? "{}")).toMatchObject({
      category: "is_normal",
      title: "이 견적 괜찮을까요?",
      content: "추가금이 걱정돼요.",
    });
  });

  it("restores only B's scoped draft and never A's or a legacy unowned draft", async () => {
    mocks.authUserId = "user-b";
    window.history.replaceState({}, "", "/community/post/write?resume=1");
    const draft = (title: string) => JSON.stringify({
      category: "free",
      title,
      content: `${title} content`,
      visibility: "public",
      images: [],
      tags: [],
      vendorTags: [],
      savedAt: Date.now(),
    });
    localStorage.setItem("community:post-draft:v2:user-a", draft("A private draft"));
    localStorage.setItem("community:post-draft:v2:user-b", draft("B safe draft"));
    localStorage.setItem("community_post_draft", draft("legacy A draft"));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(<PostWritePage />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const titleInput = container.querySelector<HTMLInputElement>('input[maxlength="200"]');
    expect(titleInput?.value).toBe("B safe draft");
    expect(container.textContent).not.toContain("A private draft");
    expect(container.textContent).not.toContain("legacy A draft");
    expect(localStorage.getItem("community_post_draft")).toBeNull();
  });

  it("remounts the editor so an in-memory A draft cannot flash after switching to B", async () => {
    const draft = (title: string) => JSON.stringify({
      category: "free",
      title,
      content: `${title} content`,
      visibility: "public",
      images: [],
      tags: [],
      vendorTags: [],
      savedAt: Date.now(),
    });
    localStorage.setItem("community:post-draft:v2:user-a", draft("A private draft"));
    localStorage.setItem("community:post-draft:v2:user-b", draft("B safe draft"));
    window.history.replaceState({}, "", "/community/post/write?resume=1");
    mocks.authUserId = "user-a";
    useAuthStore.setState({
      user: { id: "user-a", email: "a@example.com" },
      isInitialized: true,
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    await act(async () => {
      root.render(<PostWritePage />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      container.querySelector<HTMLInputElement>('input[maxlength="200"]')?.value,
    ).toBe("A private draft");

    mocks.authUserId = "user-b";
    await act(async () => {
      useAuthStore.setState({
        user: { id: "user-b", email: "b@example.com" },
        isInitialized: true,
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    expect(
      container.querySelector<HTMLInputElement>('input[maxlength="200"]')?.value,
    ).toBe("B safe draft");
    expect(text).not.toContain("A private draft");
  });

  it("does not leave the page when the guest draft cannot be preserved", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(<PostWritePage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const safetyCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const publishButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("로그인하고 질문 올리기"),
    );
    await act(async () => {
      safetyCheckbox?.click();
    });

    const storageSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw new Error("storage blocked");
      });

    await act(async () => {
      publishButton?.click();
    });

    expect(mocks.routerReplace).not.toHaveBeenCalled();
    expect(container.textContent).toContain("작성 내용을 이 기기에 임시 저장하지 못했어요");
    storageSpy.mockRestore();
  });

  it("keeps media selection and slide affordances hidden by default", async () => {
    window.history.replaceState({}, "", "/community/post/write");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(<PostWritePage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector("textarea")?.getAttribute("placeholder"),
    ).toContain("지금은 텍스트 게시물만 작성할 수 있어요");
    expect(container.textContent).not.toContain("카드 게시물 (옆으로 넘기기)");
    expect(container.textContent).not.toContain("본문에 이미지/GIF 삽입");
    expect(container.textContent).not.toContain("images");
    expect(container.textContent).not.toContain("slides");
    expect(container.textContent).toContain("poll");
  });
});
