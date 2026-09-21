import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import AmoraDecisionBoard from "@/components/app/amora-board/AmoraDecisionBoard";
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = "11111111-1111-4111-8111-111111111111", C = "22222222-2222-4222-8222-222222222222";
const time = "2026-09-20T00:00:00Z";
let root: Root, host: HTMLDivElement;
const transport = vi.fn();
beforeEach(async () => {
  useAuthStore.getState().reset();
  useAuthStore.setState({ user: { id: A, email: "synthetic@example.invalid" }, profile: { id: A, name: "합성", role: "bride", couple_id: C, avatar_url: null, onboarding_completed: true, onboarding_step: 5, is_admin: false, created_at: time, updated_at: time }, isInitialized: true });
  transport.mockReset().mockImplementation(async (_url, init) => {
    if (init?.method === "POST") throw new TypeError("synthetic lost response");
    return Response.json({ actions: [], count: 0, open_count: 0 });
  });
  vi.stubGlobal("fetch", transport);
  window.history.replaceState({}, "", "/chat/board?view=tasks");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<AmoraDecisionBoard />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function createUnknown() {
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "공유 할 일 추가")!.click());
  const input = host.querySelector<HTMLInputElement>('form[aria-label="공유 할 일 추가"] input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "이전 세션 비공개 초안"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(host.querySelector('button[type="submit"]')?.textContent).toBe("같은 요청 다시 확인");
}
it("control: same-owner unknown create retains the same request ID", async () => {
  await createUnknown();
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const writes = transport.mock.calls.filter(call => call[1]?.method === "POST");
  expect(writes).toHaveLength(2); expect(writes[1][1].body).toBe(writes[0][1].body);
});
it("clears the real board form across a batched A to signed-out to A transition", async () => {
  await createUnknown();
  const previous = useAuthStore.getState();
  await act(async () => { useAuthStore.getState().reset(); useAuthStore.setState(previous); });
  const input = host.querySelector<HTMLInputElement>('form[aria-label="공유 할 일 추가"] input');
  expect(input?.value ?? "").toBe("");
});
it("never turns the old unknown intent into a new request after the same batched transition", async () => {
  await createUnknown();
  const previous = useAuthStore.getState();
  await act(async () => { useAuthStore.getState().reset(); useAuthStore.setState(previous); });
  const form = host.querySelector("form");
  if (form) await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const writes = transport.mock.calls.filter(call => call[1]?.method === "POST");
  expect(writes).toHaveLength(1);
});

it("rejects a queued old form submit before React repaints the same-owner return", async () => {
  await createUnknown();
  const previous = useAuthStore.getState(); const oldForm = host.querySelector("form")!;
  await act(async () => {
    useAuthStore.getState().reset(); useAuthStore.setState(previous);
    oldForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(transport.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
  expect(host.querySelector("form")).toBeNull();
});

it("restores an unknown create on ordinary same-owner board remount and retries the identical request", async () => {
  await createUnknown();
  await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => root.render(<AmoraDecisionBoard />));
  expect(host.querySelector<HTMLInputElement>('form input')?.value).toBe("이전 세션 비공개 초안");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const writes = transport.mock.calls.filter(call => call[1]?.method === "POST");
  expect(writes).toHaveLength(2); expect(writes[1][1].body).toBe(writes[0][1].body);
});
