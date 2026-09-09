// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://hanbang.ai/settings" }

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "./page";
import { useAuthStore } from "@/stores/authStore";
import { CONTACT } from "@/lib/constants/contact";

vi.mock("@/components/app/TodayOnePreferenceControl", () => ({ default: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT_A = { id: "10000000-0000-4000-8000-000000000001", email: "a@example.com" };
const ACCOUNT_B = { id: "10000000-0000-4000-8000-000000000002", email: "b@example.com" };

function accountResponse(accountDeletionIntake: boolean, account = ACCOUNT_A) {
  return new Response(JSON.stringify({ user: account, capabilities: { accountDeletionIntake } }), {
    headers: { "content-type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("settings account deletion requires a current account and explicit confirmation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalState: ReturnType<typeof useAuthStore.getState>;
  let readAccount: () => Promise<Response>;
  let respondToDelete: () => Promise<Response>;
  let deleteRequests: RequestInit[];

  beforeEach(() => {
    originalState = useAuthStore.getState();
    useAuthStore.setState({
      user: ACCOUNT_A, profile: null, partner: null, couple: null, journey: null, isDemo: false,
    });
    readAccount = async () => accountResponse(false);
    respondToDelete = async () => new Response(JSON.stringify({ error: "테스트 응답" }), { status: 503 });
    deleteRequests = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/me") return readAccount();
      if (String(input) === "/api/auth/delete") {
        deleteRequests.push(init ?? {});
        // 실제 계정은 건드리지 않는다. 요청이 발생했는지만 관찰한다.
        return respondToDelete();
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState(originalState);
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function button(label: string) {
    const result = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === label);
    expect(result, `Missing button: ${label}`).toBeTruthy();
    return result!;
  }

  async function openDeletion() {
    await act(async () => root.render(<SettingsPage />));
    await act(async () => button("계정 탈퇴").click());
  }

  async function followSupportAction() {
    const action = [...container.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>("a, button")]
      .find((candidate) => ["요청 방법 확인하기", "이메일로 탈퇴 요청하기"]
        .includes(candidate.textContent?.trim() ?? ""));
    expect(action, "탈퇴 문의를 이어갈 수 있어야 한다").toBeTruthy();
    // mailto는 메일 작성 창만 여는 경로다. jsdom의 문서 이동만 막는다.
    if (action?.tagName === "A") action.addEventListener("click", (event) => event.preventDefault());
    await act(async () => action!.click());
    expect(deleteRequests, "문의 안내를 누르는 것으로 삭제가 접수되면 안 된다").toEqual([]);
    expect(action?.getAttribute("href")).toBe(`mailto:${CONTACT.email}`);
  }

  it.each(["pending", "closed", "failed", "different account"] as const)(
    "%s capability only offers support and never sends DELETE",
    async (state) => {
      if (state === "pending") readAccount = () => deferredResponse().promise;
      if (state === "closed") readAccount = async () => accountResponse(false);
      if (state === "failed") readAccount = async () => new Response("Unavailable", { status: 503 });
      if (state === "different account") readAccount = async () => accountResponse(true, ACCOUNT_B);
      await openDeletion();
      expect(container.querySelector('input[placeholder="탈퇴합니다"]')).toBeNull();
      await followSupportAction();
    },
  );

  async function fillConfirmation(value: string) {
    const input = container.querySelector<HTMLInputElement>('input[placeholder="탈퇴합니다"]');
    expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function selectReason() {
    const reason = container.querySelector<HTMLInputElement>('input[name="deleteReason"][value="privacy"]');
    expect(reason).toBeTruthy();
    await act(async () => reason!.click());
  }

  it("only submits after both a reason and the exact confirmation are supplied", async () => {
    readAccount = async () => accountResponse(true);
    await openDeletion();
    expect(button("계정 삭제 요청").disabled).toBe(true);
    await fillConfirmation("탈퇴합니다");
    expect(button("계정 삭제 요청").disabled).toBe(true);
    await selectReason();
    await fillConfirmation("탈퇴");
    expect(button("계정 삭제 요청").disabled).toBe(true);
    expect(deleteRequests).toEqual([]);
    await fillConfirmation("탈퇴합니다");
    expect(button("계정 삭제 요청").disabled).toBe(false);
    await act(async () => button("계정 삭제 요청").click());
    expect(deleteRequests).toHaveLength(1);
    expect(deleteRequests[0]?.method).toBe("DELETE");
    expect(JSON.parse(String(deleteRequests[0]?.body))).toEqual({ reason: "privacy" });
  });

  it("an old account's delayed capability cannot enable deletion after switching accounts", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    readAccount = () => first.promise;
    await openDeletion();
    readAccount = () => second.promise;
    await act(async () => useAuthStore.setState({ user: ACCOUNT_B }));
    await act(async () => first.resolve(accountResponse(true)));
    await act(async () => button("계정 탈퇴").click());
    expect(container.querySelector('input[placeholder="탈퇴합니다"]')).toBeNull();
    await followSupportAction();
    await act(async () => second.resolve(accountResponse(false, ACCOUNT_B)));
    expect(deleteRequests).toEqual([]);
  });

  it("switching accounts clears an already completed confirmation", async () => {
    readAccount = async () => accountResponse(true);
    await openDeletion();
    await selectReason();
    await fillConfirmation("탈퇴합니다");
    expect(button("계정 삭제 요청").disabled).toBe(false);
    readAccount = async () => accountResponse(true, ACCOUNT_B);
    await act(async () => useAuthStore.setState({ user: ACCOUNT_B }));
    await act(async () => button("계정 탈퇴").click());
    expect(container.querySelector<HTMLInputElement>('input[placeholder="탈퇴합니다"]')?.value).toBe("");
    expect(container.querySelector('input[name="deleteReason"]:checked')).toBeNull();
    expect(button("계정 삭제 요청").disabled).toBe(true);
    expect(deleteRequests).toEqual([]);
  });

  it("a previous account's pending deletion response cannot notify or sign out the new account", async () => {
    const pending = deferredResponse();
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const signOut = vi.fn(async () => {});
    useAuthStore.setState({ signOut });
    respondToDelete = () => pending.promise;
    readAccount = async () => accountResponse(true);
    await openDeletion();
    await selectReason();
    await fillConfirmation("탈퇴합니다");
    await act(async () => button("계정 삭제 요청").click());
    expect(deleteRequests).toHaveLength(1);
    readAccount = async () => accountResponse(true, ACCOUNT_B);
    await act(async () => useAuthStore.setState({ user: ACCOUNT_B }));
    await act(async () => pending.resolve(new Response(JSON.stringify({
      pending: true, message: "이전 계정 처리 대기",
    }), { status: 202 })));
    expect(alert).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("이전 계정 처리 대기");
    await act(async () => button("계정 탈퇴").click());
    expect(button("계정 삭제 요청").disabled).toBe(true);
    expect(deleteRequests).toHaveLength(1);
  });
});
