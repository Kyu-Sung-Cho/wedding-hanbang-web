/**
 * 쉬지 않고 쓰는 사람에게 자동 저장이 **실제로 도는가.**
 *
 * 형제 파일 `__tests__/autoSaveSurvivesTyping.test.ts` 는 소스를 정규식으로 본다.
 * 적대적 감사가 그것으로는 부족함을 실측으로 보여줬다 — ref 갱신 effect 의 의존성을
 * `[persistDraft]` → `[]` 로 바꾸면 **자동 저장이 100% 죽는데** 그 파일 4개가 전부
 * 초록이었다. 같은 effect 를 통째로 지워도 초록이었다.
 *
 * 그 파일 머리말에 "컴포넌트 전체를 띄우는 대신 정규식으로 보는 이유는 렌더 하네스가
 * 이 결함보다 훨씬 크기 때문" 이라고 적었는데 **확인하지 않고 쓴 말이었다.** 같은
 * 디렉터리의 `page.test.tsx` 가 이미 이 컴포넌트를 `createRoot` + `act` 로 띄우고
 * 있었다. 이 파일은 그 하네스를 그대로 쓴다.
 *
 * 여기서 재는 것은 **결과**다 — 25초 간격으로 계속 입력해도 localStorage 에 초안이
 * 남는가. 배선이 어떻게 되어 있든 상관없다.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  authUserId: "11111111-1111-4111-8111-111111111111" as string | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }),
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
  useCommunityStore: Object.assign(
    () => ({ createPost: vi.fn(), updatePost: vi.fn() }),
    { getState: () => ({ errorMessage: null }) },
  ),
}));

vi.mock("@/components/community/ImageUploader", () => ({ default: () => <div>images</div> }));
vi.mock("@/components/community/SlideBuilder", () => ({ default: () => <div>slides</div> }));
vi.mock("@/components/community/TagInput", () => ({ default: () => <div>tags</div> }));
vi.mock("@/components/community/VendorTagPicker", () => ({ default: () => <div>vendors</div> }));
vi.mock("@/components/community/PriceQuestionForm", () => ({ default: () => <div>price</div> }));
vi.mock("@/components/community/PollEditor", () => ({ default: () => <div>poll</div> }));

import PostWritePage from "./page";
import { useAuthStore } from "@/stores/authStore";
import { communityPostDraftKey } from "@/lib/community/viewerPrivacyCache";

const USER = "11111111-1111-4111-8111-111111111111";
const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

/** React 가 제어하는 입력에 값을 넣는다. 직접 `.value =` 하면 리액트가 못 본다. */
function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const readDraft = () => localStorage.getItem(communityPostDraftKey(USER));

describe("자동 저장이 실제로 돈다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authUserId = USER;
    useAuthStore.setState({ user: { id: USER } as never, profile: null, isInitialized: true });
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/wedding/community/post/write?category=is_normal");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  });

  afterEach(async () => {
    await act(async () => {
      for (const { root } of mountedRoots.splice(0)) root.unmount();
    });
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("25초마다 계속 입력해도 저장된다 — 30초 이상 쉬지 않는 사람이 잃지 않는다", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(<PostWritePage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const titleInput = container.querySelector("input[type='text']") as HTMLInputElement | null;
    const body = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(titleInput, "제목 입력란을 찾지 못했다 — 하네스가 화면을 못 띄운 것이다").toBeTruthy();
    expect(body, "본문 입력란을 찾지 못했다").toBeTruthy();

    // 손을 30초 이상 멈추지 않는 사람. 이 조건에서 예전 코드는 한 번도 저장하지 않았다.
    for (let i = 1; i <= 6; i += 1) {
      await act(async () => {
        typeInto(titleInput!, `예식장 후기 ${i}`);
        typeInto(body!, `본문을 계속 쓰는 중입니다 ${i}`);
        vi.advanceTimersByTime(25_000);
        await Promise.resolve();
      });
    }

    const saved = readDraft();
    expect(saved, "150초 동안 쉬지 않고 썼는데 초안이 한 번도 저장되지 않았다").not.toBeNull();
    expect(saved).toContain("예식장 후기 6");
  });

  it("신원이 바뀌면 언마운트 저장이 이전 사용자의 글을 되살리지 않는다", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(<PostWritePage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const body = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(body).toBeTruthy();
    await act(async () => {
      typeInto(body!, "로그아웃 직전에 쓰던 글");
      await Promise.resolve();
    });

    // 로그아웃·세션 만료가 하는 일: purge 가 돌고 authStore 의 사용자가 사라진다.
    localStorage.removeItem(communityPostDraftKey(USER));
    useAuthStore.setState({ user: null, profile: null, isInitialized: true });

    await act(async () => {
      for (const { root: r } of mountedRoots.splice(0)) r.unmount();
    });

    expect(
      readDraft(),
      "로그아웃으로 지워진 초안을 언마운트 저장이 다시 써 넣었다",
    ).toBeNull();
  });
});
