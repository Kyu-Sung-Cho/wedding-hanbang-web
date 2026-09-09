// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import WeddingTasteClient from "./WeddingTasteClient";
import { useAuthStore } from "@/stores/authStore";
import { CONTACT } from "@/lib/constants/contact";
import { buildWeddingTasteShareUrl, createEmptyWeddingTasteDraft, decodeWeddingTasteShareHash, type WeddingTasteDraftV1 } from "@/lib/weddingCode/taste";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
let root: Root, host: HTMLDivElement;
const first = (): WeddingTasteDraftV1 => ({ ...createEmptyWeddingTasteDraft(), priorityDomains: { status: "answered", values: ["photo"] }, details: { photo: { status: "answered", values: ["directed"] } } });
function account(owner = "owner-a", connected = true, completed = true) {
  return { user: { id: owner, email: owner + "@example.com" },
    profile: { id: owner, name: "내 계정", email: owner + "@example.com", couple_id: connected ? "couple-" + owner : null, role: "bride", onboarding_completed: completed },
    couple: connected ? { id: "couple-" + owner, bride_id: owner, groom_id: null } : null };
}
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(el => el.textContent?.trim() === label);
  expect(button, label).toBeTruthy();
  await act(async () => button?.click());
}
async function render(hash = "") {
  window.history.replaceState(null, "", "/wedding-code/taste" + hash);
  await act(async () => root.render(<WeddingTasteClient />));
}
async function completePhoto() {
  await click("사진"); await click("다음"); await click("간결한 분위기"); await click("다음");
  await click("자연스러운 순간"); await click("다음"); await click("특별히 피하고 싶은 것은 없어요"); await click("다음");
  await click("다른 안도 함께 볼 수 있어요"); await click("내 선택 보기");
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAuthStore.setState({ user: null, profile: null, couple: null, isDemo: false, isInitialized: true, isLoading: false });
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => response({ user: null }));
  document.cookie = "demo_mode=; path=/; max-age=0";
  window.sessionStorage.clear(); push.mockClear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.cookie = "demo_mode=; path=/; max-age=0"; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("직접 취향의 끝까지 흐름", () => {
  it("고른 취향만 요약하고 공유·개인 상담을 선택하기 전 저장하지 않는다", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await render(); await click("내 취향 고르기"); await completePhoto();
    const result = host.querySelector("[data-taste-own]");
    expect(result?.textContent).toContain("자연스러운 순간");
    expect(result?.textContent).not.toContain("뷔페");
    expect(window.sessionStorage.length).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/auth/me");
    expect([...host.querySelectorAll("button")].find(b => b.textContent === "선택 링크 복사하기")?.disabled).toBe(true);
    await click("전달할 내용 확인하기");
    expect(host.querySelector("[data-taste-amora-text]")?.textContent).toContain("공동 합의는 아니에요");
    expect(push).not.toHaveBeenCalled();
  });
  it("먼저 답한 사람과 나를 비교해도 기본 공유와 아모라 초안에는 내 선택만 담는다", async () => {
    const url = buildWeddingTasteShareUrl({ origin: window.location.origin, first: first() });
    await render(new URL(url).hash); await click("내 취향도 직접 고르기"); await completePhoto();
    expect(host.querySelector('[data-taste-pair="detail:photo"]')?.textContent).toContain("준비한 포즈와 장면");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const ownConsent = [...host.querySelectorAll("label")].find(label => label.textContent?.includes("위의 내 선택을"))!.querySelector<HTMLInputElement>("input")!;
    await act(async () => ownConsent.click()); await click("선택 링크 복사하기");
    const decoded = decodeWeddingTasteShareHash(new URL(writeText.mock.calls[0][0]).hash);
    expect(decoded?.second).toBeNull();
    expect(decoded?.first.details.photo).toEqual({ status: "answered", values: ["candid"] });
    await click("전달할 내용 확인하기");
    expect(host.querySelector("[data-taste-amora-text]")?.textContent).not.toContain("준비한 포즈와 장면");
    await click("로그인하고 내 선택 이어가기");
    const destination = new URL(push.mock.calls[0][0], window.location.origin);
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("redirect")).toMatch(/^\/wedding-code\/taste\?wcTasteReview=/);
    expect(destination.href).not.toContain("candid");
    expect(window.sessionStorage.length).toBe(1);
  });
  it("반송된 두 사람의 링크를 열었다고 나의 응답으로 저장하거나 상담에 넘기지 않는다", async () => {
    const url = buildWeddingTasteShareUrl({ origin: window.location.origin, first: first(), second: first() });
    await render(new URL(url).hash);
    expect(host.querySelector("[data-taste-comparison]")).toBeTruthy();
    expect(host.querySelector("[data-taste-own]")).toBeNull();
    expect(host.querySelector("[data-taste-amora]")).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });
  it("모든 질문을 비우면 공유나 아모라 반영을 제안하지 않는다", async () => {
    await render(); await click("내 취향 고르기"); await click("다음"); await click("다음"); await click("내 선택 보기");
    expect(host.textContent).toContain("이번에는 선택을 비워뒀어요");
    expect(host.querySelector("[data-taste-amora]")).toBeNull();
    expect(host.textContent).not.toContain("선택 링크 복사하기");
  });
  it("클립보드가 없어도 예외로 멈추지 않고 실패를 알린다", async () => {
    await render(); await click("내 취향 고르기"); await completePhoto();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    await click("선택 링크 복사하기");
    expect(host.textContent).toContain("링크를 복사하지 못했어요");
  });
  it("실제 공개 auth 조회가 끝나기 전에 폼을 열지 않고 확인된 계정에서 처음 시작한다", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; }));
    useAuthStore.setState({ isInitialized: false });
    await render();
    expect(host.textContent).toContain("로그인 상태를 확인하고 있어요");
    expect([...host.querySelectorAll("button")].find(button => button.textContent === "내 취향 고르기")).toBeUndefined();
    expect(host.querySelector("#wedding-taste-question")).toBeNull();
    await act(async () => finish(response(account())));
    await click("내 취향 고르기"); await completePhoto();
    expect(host.querySelector("[data-taste-own]")?.textContent).toContain("자연스러운 순간");
    expect(useAuthStore.getState().user?.id).toBe("owner-a");
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/auth/me");
  });
  it("공개 auth 실패는 비로그인으로 진행하지 않고 다시 확인한 뒤 입력을 허용한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ error: "unavailable" }, 503));
    useAuthStore.setState({ isInitialized: false });
    await render();
    expect(host.textContent).toContain("로그인 상태를 확인하지 못했어요");
    expect(host.querySelector("[data-taste-experience]")).toBeNull();
    expect(host.querySelector(`a[href="mailto:${CONTACT.email}"]`)).not.toBeNull();
    await click("다시 확인하기");
    await click("내 취향 고르기");
    expect(host.querySelector("#wedding-taste-question")).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("같은 계정 재조회 실패·재시도 중 선택을 유지하고 다른 계정으로 바뀌면 지운다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(account()));
    await render(); await click("내 취향 고르기"); await completePhoto();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.textContent).toContain("로그인 상태를 확인하지 못했어요");
    expect(host.querySelector("[data-taste-experience]")?.hasAttribute("hidden")).toBe(true);
    vi.mocked(fetch).mockResolvedValueOnce(response(account()));
    await click("다시 확인하기");
    expect(host.querySelector("[data-taste-experience]")?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector("[data-taste-own]")?.textContent).toContain("자연스러운 순간");
    vi.mocked(fetch).mockResolvedValueOnce(response(account("owner-b")));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector("[data-taste-own]")).toBeNull();
    expect(host.textContent).toContain("내 취향 고르기");
    expect(sessionStorage.length).toBe(0);
  });
  it("입력 중 같은 세션을 다시 확인해도 아직 제출하지 않은 문항 선택을 유지한다", async () => {
    await render(); await click("내 취향 고르기"); await click("사진");
    const photo = () => [...host.querySelectorAll("button")].find(button => button.textContent === "사진");
    expect(photo()?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(photo()?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-taste-own]")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("온보딩 완료 후 연결이 없으면 재온보딩 루프 대신 재조회와 고객지원을 제공한다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(account("owner-a", false, true)));
    await render(); await click("내 취향 고르기"); await completePhoto(); await click("전달할 내용 확인하기");
    expect(host.textContent).toContain("계정 준비는 완료됐지만");
    expect([...host.querySelectorAll("button")].find(button => button.textContent === "계정 준비하고 내 선택 이어가기")).toBeUndefined();
    expect(host.querySelector(`a[href="mailto:${CONTACT.email}"]`)).not.toBeNull();
    expect(push).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
    vi.mocked(fetch).mockResolvedValueOnce(response(account()));
    await click("계정 정보 다시 확인");
    expect(host.querySelector("[data-taste-own]")?.textContent).toContain("자연스러운 순간");
    await click("이 계정의 나만 상담에 초안 열기");
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/chat\?scope=private&wcTasteChat=/));
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
  });
  it("정상 미온보딩 계정은 고른 내용을 보관해 기존 온보딩으로 이어간다", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(account("owner-a", false, false)));
    await render(); await click("내 취향 고르기"); await completePhoto(); await click("전달할 내용 확인하기");
    await click("계정 준비하고 내 선택 이어가기");
    const destination = new URL(push.mock.calls[0][0], window.location.origin);
    expect(destination.pathname).toBe("/wedding/onboarding");
    expect(destination.searchParams.get("redirect")).toMatch(/^\/wedding-code\/taste\?wcTasteReview=/);
    expect(sessionStorage.length).toBe(1);
  });
  it("데모임을 알리고 비활성 버튼으로 막지 않고 실제 로그인에서 내 선택을 다시 확인하게 한다", async () => {
    document.cookie = "demo_mode=true; path=/";
    await render(); await click("내 취향 고르기"); await completePhoto(); await click("전달할 내용 확인하기");
    expect(host.textContent).toContain("체험 모드에서는 취향을 고르고");
    expect(host.textContent).not.toContain("현재 계정: demo");
    await click("로그인하고 내 선택 이어가기");
    const destination = new URL(push.mock.calls[0][0], window.location.origin);
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("redirect")).toMatch(/^\/wedding-code\/taste\?wcTasteReview=/);
    expect(destination.href).not.toContain("demo");
  });
});
