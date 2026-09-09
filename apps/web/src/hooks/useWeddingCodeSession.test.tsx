// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import { useWeddingCodeSession } from "./useWeddingCodeSession";

function SessionProbe() { useWeddingCodeSession(); return <p>{useAuthStore(state => state.isInitialized) ? "확인됨" : "확인 전"}</p>; }
function StatusProbe() { const session = useWeddingCodeSession(); return <><p data-session-status="">{session.status}</p><button onClick={session.retry}>다시 확인</button></>; }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("공개 화면의 빈 로그인 상태를 읽기로 초기화하고 StrictMode와 언마운트 뒤 중복 읽기를 막는다", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAuthStore.setState({ user: null, profile: null, couple: null, isInitialized: false, isLoading: false, isDemo: false });
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ user: null }), { status: 200 }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<StrictMode><SessionProbe /></StrictMode>));
  expect(host.textContent).toBe("확인됨");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("/api/auth/me");
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
  window.dispatchEvent(new Event("focus"));
  expect(fetch).toHaveBeenCalledTimes(2);
  host.remove();
});
it("force 초기화가 store loading을 바꾸지 않아도 상태를 노출하고 focus·재시도 중복 요청을 막는다", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAuthStore.setState({ user: null, profile: null, couple: null, isInitialized: false, isLoading: false, isDemo: false });
  let finish!: (value: Response) => void;
  const fetch = vi.spyOn(globalThis, "fetch").mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<StrictMode><StatusProbe /></StrictMode>));
  expect(host.querySelector("[data-session-status]")?.textContent).toBe("loading");
  await act(async () => { window.dispatchEvent(new Event("focus")); host.querySelector("button")!.click(); window.dispatchEvent(new Event("focus")); });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => finish(new Response(JSON.stringify({ user: null }), { status: 200 })));
  expect(host.querySelector("[data-session-status]")?.textContent).toBe("ready");
  await act(async () => root.unmount()); host.remove();
});
it("공개 auth 실패를 error로 남기고 현재 탭에서 다시 확인할 수 있다", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAuthStore.setState({ user: null, profile: null, couple: null, isInitialized: false, isLoading: false, isDemo: false });
  const fetch = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ user: null }), { status: 200 }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<StatusProbe />));
  expect(host.querySelector("[data-session-status]")?.textContent).toBe("error");
  await act(async () => { host.querySelector("button")!.click(); host.querySelector("button")!.click(); });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(host.querySelector("[data-session-status]")?.textContent).toBe("ready");
  await act(async () => root.unmount()); host.remove();
});
