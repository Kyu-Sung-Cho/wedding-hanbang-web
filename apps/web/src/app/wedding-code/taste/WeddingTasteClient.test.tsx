// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import WeddingTasteClient from "./WeddingTasteClient";
import { useAuthStore } from "@/stores/authStore";
import { CONTACT } from "@/lib/constants/contact";
import { buildWeddingTasteShareUrl, createEmptyWeddingTasteDraft, decodeWeddingTasteShareHash, type WeddingTasteDraftV1 } from "@/lib/weddingCode/taste";
import { MOBILE_WEB_API_NONCE_PROPERTY } from "@/lib/mobile/mobileAuthenticatedFetch";

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
// 분위기 그림 칸은 라벨 아래에 설명 줄을 함께 담는다. 그래서 칸은 버튼 전체 글자가 아니라 라벨 요소로 찾는다.
const buttonLabel = (el: Element) => (el.querySelector("[data-choice-label]") ?? el).textContent?.trim();
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(el => buttonLabel(el) === label);
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
    expect([...host.querySelectorAll("button")].find(b => b.textContent === "링크 복사하기")?.disabled).toBe(true);
    await click("전달할 내용 확인하기");
    expect(host.querySelector("[data-taste-amora-text]")?.textContent).toContain("둘이 같이 정한 건 아니에요");
    expect(push).not.toHaveBeenCalled();
  });
  it("먼저 답한 사람과 나를 비교해도 기본 공유와 아모라 초안에는 내 선택만 담는다", async () => {
    const url = buildWeddingTasteShareUrl({ origin: window.location.origin, first: first() });
    await render(new URL(url).hash); await click("내 취향도 고르기"); await completePhoto();
    expect(host.querySelector('[data-taste-pair="detail:photo"]')?.textContent).toContain("준비한 포즈와 장면");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const ownConsent = [...host.querySelectorAll("label")].find(label => label.textContent?.includes("위의 내 선택을"))!.querySelector<HTMLInputElement>("input")!;
    await act(async () => ownConsent.click()); await click("링크 복사하기");
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
    expect(host.textContent).not.toContain("링크 복사하기");
  });
  it("클립보드가 없어도 예외로 멈추지 않고 실패를 알린다", async () => {
    await render(); await click("내 취향 고르기"); await completePhoto();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    await click("링크 복사하기");
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
    await click("‘나만 상담’에 초안으로 열기");
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

/**
 * **앱 웹뷰에서는 끝을 못 보는 단락을 보여주지 않는다.**
 *
 * 2026-09-16 에 앱에 웨딩코드 입구를 넣으면서, 결과 화면의 아모라 단락이 사람을
 * 네이티브 설정으로 튕겨내고 결과까지 지우는 것이 잡혔다. 그것을 고치고 나서
 * 적대 검토가 **바로 한 칸 아래 있는 쌍둥이**를 찾았다 — 이 화면의 "내 선택으로
 * 아모라와 이야기하기" 다.
 *
 * 앱 웹뷰에는 앱의 세션이 없다. 그래서 `canChat` 이 늘 false 이고 버튼은
 * `/login?redirect=…` 으로 간다 — 앱에 이미 로그인한 사람에게 웹 로그인 폼이다.
 * `canChat` 이 참이 되는 길로 가더라도 `/chat` 은 앱이 네이티브로 되돌리는 경로라
 * 이 탭에 담아둔 초안이 버려진다.
 *
 * 취향 고르기와 링크 공유는 앱에서도 끝까지 되므로 그대로 둔다.
 */
describe("앱 웹뷰에서 연 취향 화면", () => {
  const NONCE = "8f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

  function markAsInsideApp() {
    // 앱이 문서보다 먼저 심는 두 가지. 웹뷰 다리와 그 다리의 nonce.
    vi.stubGlobal("ReactNativeWebView", { postMessage: () => undefined });
    vi.stubGlobal(MOBILE_WEB_API_NONCE_PROPERTY, NONCE);
  }

  it("이어가기 단락을 내리고, 취향 요약과 공유는 그대로 둔다", async () => {
    markAsInsideApp();
    await render(); await click("내 취향 고르기"); await completePhoto();

    expect(host.querySelector("[data-taste-amora]")).toBeNull();
    // 단락을 여는 문과 그 안의 버튼이 둘 다 없어야 한다.
    expect(host.textContent).not.toContain("내 선택으로 아모라와 이야기하기");
    expect(host.textContent).not.toContain("전달할 내용 확인하기");

    // 입구를 넣은 이유 자체가 이것이다. 단락 하나를 내리느라 본래 기능을 깨면 안 된다.
    expect(host.querySelector("[data-taste-own]")?.textContent).toContain("자연스러운 순간");
  });

  it("브라우저에서는 이어가기 버튼까지 그대로 나온다", async () => {
    await render(); await click("내 취향 고르기"); await completePhoto();

    expect(host.querySelector("[data-taste-amora]")).not.toBeNull();
    // 앱에서 막다른 길이 되는 바로 그 버튼. 브라우저에서는 살아 있어야 한다.
    await click("전달할 내용 확인하기");
    expect(host.textContent).toContain("로그인하고 내 선택 이어가기");
  });

  it("남의 iframe 이 앱인 척해도 내리지 않는다", async () => {
    // 표식은 최상위 문서에만 들어온다. 서브프레임의 값을 믿으면, 이 화면을 품은
    // 아무 페이지나 이어가기 단락을 지울 수 있게 된다.
    markAsInsideApp();
    const original = Object.getOwnPropertyDescriptor(window, "top");
    Object.defineProperty(window, "top", { value: {} as Window, configurable: true });
    try {
      await render(); await click("내 취향 고르기"); await completePhoto();
      expect(host.querySelector("[data-taste-amora]")).not.toBeNull();
    } finally {
      if (original) Object.defineProperty(window, "top", original);
      else delete (window as unknown as Record<string, unknown>).top;
    }
  });

  it("웹뷰 다리만 있고 앱이 심은 표식이 없으면 앱으로 보지 않는다", async () => {
    // `ReactNativeWebView` 는 우리 앱이 아닌 다른 앱의 웹뷰에도 있다. 우리 앱이라는
    // 증거는 문서보다 먼저 심는 nonce 뿐이다. 없으면 브라우저와 똑같이 다룬다.
    vi.stubGlobal("ReactNativeWebView", { postMessage: () => undefined });
    await render(); await click("내 취향 고르기"); await completePhoto();

    expect(host.querySelector("[data-taste-amora]")).not.toBeNull();
  });
});
