// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));

import CommunityReplyNotifications from "../CommunityReplyNotifications";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 로그인하지 않았다는 것을 **고장으로 그리지 않는다.**
 *
 * ## 무엇이 있었나
 *
 * 커뮤니티 첫 화면(`/wedding`)에서 헤더의 벨을 누르면 비로그인 방문자에게
 * "새 답변을 불러오지 못했어요." + [다시 시도] 가 **빨간 글씨로** 떴다.
 *
 * 실제 원인은 실패가 아니라 401 이다 — `refresh()` 가 `!response.ok` 를 한 덩어리로
 * 묶어 던지고, catch 가 네트워크 실패와 같은 문구를 세웠다. **다시 눌러도 영원히
 * 같은 401** 이라 [다시 시도] 는 아무것도 하지 않는다.
 *
 * 커뮤니티 첫 화면은 비로그인 유입의 착지점이다. 거기서 벨을 누른 사람은 전부
 * 고장난 서비스를 봤다.
 *
 * ## 왜 DOM 을 보나
 *
 * 소스에 분기를 넣었는지 grep 하는 방식은 "배선은 됐는데 안 그려지는" 상태를
 * 통과시킨다. 실제로 그려진 글자와 버튼을 본다.
 */

const OWNER_ID = "11111111-1111-4111-8111-111111111111";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  routerPush.mockClear();
});

let fetchSpy: ReturnType<typeof vi.fn>;

async function openBellWith(response: { status: number; body?: unknown }) {
  fetchSpy = vi.fn(async () => ({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.body ?? {},
  }));
  vi.stubGlobal("fetch", fetchSpy);
  await act(async () => {
    root.render(
      createElement(CommunityReplyNotifications as never, { ownerId: OWNER_ID } as never),
    );
  });
  const bell = container.querySelector("button");
  await act(async () => {
    bell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
  return container;
}

describe("비로그인은 고장이 아니다", () => {
  it("401 이면 오류가 아니라 로그인 안내가 나온다", async () => {
    const el = await openBellWith({ status: 401 });
    const text = el.textContent ?? "";
    expect(text).not.toContain("새 답변을 불러오지 못했어요");
    expect(text).toContain("로그인하면");
  });

  it("401 이면 [다시 시도] 를 주지 않는다 — 눌러도 결과가 같기 때문", async () => {
    const el = await openBellWith({ status: 401 });
    const labels = [...el.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(labels.some((l) => l.includes("다시 시도"))).toBe(false);
    expect(labels.some((l) => l.includes("로그인"))).toBe(true);
  });

  it("누르면 로그인으로 보낸다 — 라벨만 바꾸는 게 아니다", async () => {
    // 라벨만 검사하면 "로그인하기" 라고 써 놓고 재요청만 하는 상태를 통과시킨다
    // (변형 검증에서 실제로 그 구멍이 드러났다).
    const el = await openBellWith({ status: 401 });
    const before = fetchSpy.mock.calls.length;
    const button = [...el.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").includes("로그인"));
    expect(button, "로그인 버튼이 없다").toBeTruthy();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(routerPush).toHaveBeenCalledWith("/login");
    expect(fetchSpy.mock.calls.length, "다시 요청하면 안 된다").toBe(before);
  });

  it("403 도 같게 다룬다", async () => {
    const el = await openBellWith({ status: 403 });
    expect(el.textContent ?? "").toContain("로그인하면");
  });
});

describe("진짜 실패는 여전히 실패로 보인다", () => {
  it("500 이면 오류 문구와 [다시 시도] 가 나온다", async () => {
    const el = await openBellWith({ status: 500 });
    const text = el.textContent ?? "";
    expect(text).toContain("새 답변을 불러오지 못했어요");
    const labels = [...el.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(labels.some((l) => l.includes("다시 시도"))).toBe(true);
  });

  it("진짜 실패에서 누르면 다시 요청한다", async () => {
    const el = await openBellWith({ status: 500 });
    const before = fetchSpy.mock.calls.length;
    const button = [...el.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").includes("다시 시도"));
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(before);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("200 인데 모양이 어긋나면 실패로 다룬다", async () => {
    // 주인이 다른 응답이 오면 남의 알림을 그릴 수 없다 — 기존 계약이다.
    const el = await openBellWith({
      status: 200,
      body: { ownerId: "22222222-2222-4222-8222-222222222222", notifications: [] },
    });
    expect(el.textContent ?? "").toContain("새 답변을 불러오지 못했어요");
  });
});
