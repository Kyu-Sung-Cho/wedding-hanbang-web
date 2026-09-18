// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RouterContext } from "next/dist/shared/lib/router-context.shared-runtime";
import { afterEach, describe, expect, it } from "vitest";

import MannersLayout from "@/app/manners/layout";
import MannersIndexPage from "@/app/manners/page";
import MannersPartView from "@/components/manners/MannersPartView";
import { categoryKeysForMannersPart } from "@/lib/manners/categoryMap";
import { MANNERS_PARTS } from "@/lib/manners/data";
import { MOBILE_WEB_API_NONCE_PROPERTY } from "@/lib/mobile/mobileAuthenticatedFetch";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const NONCE = "5b0c9d8e-7f6a-4b5c-9d8e-7f6a5b4c3d2e";

/**
 * **앱 안 웹뷰에서 로그인 필요 화면으로 가는 링크는 문서째 이동해야 앱이 받아 넘긴다.**
 *
 * 앱 웹뷰(`apps/mobile/app/webview.tsx`)는 `/wedding/checklist?category=venue`·
 * `/wedding/lounge`·`/wedding/chat?amoraSource=…` 를 네이티브 화면으로 넘긴다. 그 판단은
 * `onShouldStartLoadWithRequest` 안에서만 하고, 그 콜백은 **문서를 새로 여는 이동**에서만
 * 불린다.
 *
 * `next/link` 는 누르면 `preventDefault` 한 뒤 클라이언트에서 옮기고 주소를 `pushState` 로
 * 바꾼다. react-native-webview 13.15 는 `pushState` 를 그 콜백에 보내지 않는다(iOS 는 history
 * 심이 `onLoadingFinish` 로, 안드로이드는 `doUpdateVisitedHistory` 가 `onLoadingStart` 로 보낸다).
 * 게다가 웹뷰에는 세션이 없어 클라이언트 라우터가 프록시의 307 을 따라가
 * `/login?redirect=…` 를 그린다. 그래서 앱에서 「체크리스트 열기」를 누르면 웹 로그인 화면이
 * 떴고, 앱은 분야 값은커녕 체크리스트로 가려 했다는 것조차 보지 못했다.
 *
 * 여기서 `RouterContext` 는 Next 클라이언트 라우터 대역이다. vitest 는 `next/link` 를
 * 페이지 라우터 판으로 풀지만, 누름을 다루는 약속은 앱 라우터 판과 같다 — 라우터가 있으면
 * `preventDefault` 하고 `as` 주소로 옮긴다(`next/dist/client/{,app-dir/}link.js` 의 `linkClicked`).
 * 브라우저 경우가 그 가로채기를 실제로 잡아내는지 먼저 보이므로, 앱 경우의 통과가 헛것이 아니다.
 */

/** 웹 프록시가 로그인 벽으로 돌리는 경로(`lib/supabase/middleware.ts` 의 `CUSTOMER_PATHS`). */
const LOGIN_ONLY_PATH = /^\/wedding\/(?:lounge|dashboard|chat|budget|checklist|schedule|settings|bookings|money|vendors|favorites|onboarding)(?:[/?#]|$)/;

let mountedRoot: Root | undefined;
let routed: string[] = [];
let clickListener: ((event: MouseEvent) => void) | undefined;

function mount(element: ReactElement): HTMLElement {
  routed = [];
  const router = {
    push(url: string) { routed.push(url); return Promise.resolve(true); },
    replace(url: string) { routed.push(url); return Promise.resolve(true); },
    prefetch() { return Promise.resolve(); },
  };
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    mountedRoot = createRoot(container);
    mountedRoot.render(<RouterContext.Provider value={router as never}>{element}</RouterContext.Provider>);
  });
  return container;
}

function markAsInsideApp(): void {
  (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage: () => undefined };
  window[MOBILE_WEB_API_NONCE_PROPERTY] = NONCE;
}

/**
 * 누른 뒤 무슨 일이 났나. `client` = Next 라우터가 가져갔다(웹뷰는 문서 이동을 못 본다).
 * `document` = 브라우저에 맡겼다(웹뷰가 `onShouldStartLoadWithRequest` 로 본다).
 */
function tap(anchor: HTMLAnchorElement): "client" | "document" {
  const before = routed.length;
  let prevented = false;
  clickListener = (event) => {
    prevented = event.defaultPrevented;
    event.preventDefault(); // jsdom 이 실제로 문서를 옮기려 하지 않게.
  };
  window.addEventListener("click", clickListener);
  try {
    act(() => { anchor.click(); });
  } finally {
    window.removeEventListener("click", clickListener);
    clickListener = undefined;
  }
  return prevented || routed.length > before ? "client" : "document";
}

function loginOnlyLinks(container: HTMLElement): HTMLAnchorElement[] {
  return [...container.querySelectorAll<HTMLAnchorElement>("a[href]")]
    .filter(anchor => LOGIN_ONLY_PATH.test(anchor.getAttribute("href") ?? ""));
}

afterEach(() => {
  act(() => mountedRoot?.unmount());
  mountedRoot = undefined;
  document.body.replaceChildren();
  delete (window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  delete window[MOBILE_WEB_API_NONCE_PROPERTY];
});

// 체크리스트 분야가 붙은 편. 편 끝 「… 체크리스트 열기」가 이 분야로 간다.
const partWithCategory = MANNERS_PARTS.find(part => categoryKeysForMannersPart(part.slug).length > 0)!;
const partCategory = categoryKeysForMannersPart(partWithCategory.slug)[0];

function checklistLink(container: HTMLElement): HTMLAnchorElement {
  const link = [...container.querySelectorAll<HTMLAnchorElement>("a")]
    .find(anchor => anchor.textContent?.includes("체크리스트 열기"));
  expect(link, "편 끝 「체크리스트 열기」가 없다").toBeDefined();
  return link!;
}

describe("브라우저 방문자 — 지금처럼 Next 라우터가 옮긴다", () => {
  it("편 끝 「체크리스트 열기」는 분야를 들고 클라이언트 이동한다", () => {
    expect(partCategory).toBeTruthy();
    const link = checklistLink(mount(<MannersPartView part={partWithCategory} />));
    expect(link.getAttribute("href")).toBe(`/wedding/checklist?category=${partCategory}`);
    expect(tap(link)).toBe("client");
    expect(routed).toEqual([`/wedding/checklist?category=${partCategory}`]);
  });

  it("예절 안내의 로그인 필요 링크는 전부 클라이언트 이동이다(대역이 가로채기를 잡아낸다)", () => {
    const container = mount(
      <MannersLayout>
        <MannersIndexPage />
        <MannersPartView part={partWithCategory} />
      </MannersLayout>,
    );
    const links = loginOnlyLinks(container);
    expect(links.length).toBeGreaterThan(5);
    expect(links.map(link => [link.getAttribute("href"), tap(link)]))
      .toEqual(links.map(link => [link.getAttribute("href"), "client"]));
  });
});

describe("앱 웹뷰 — 문서째 이동해 앱이 네이티브 화면으로 넘긴다", () => {
  it("편 끝 「체크리스트 열기」는 분야를 그대로 들고 문서 이동한다", () => {
    markAsInsideApp();
    const link = checklistLink(mount(<MannersPartView part={partWithCategory} />));
    expect(link.getAttribute("href")).toBe(`/wedding/checklist?category=${partCategory}`);
    expect(tap(link)).toBe("document");
    expect(routed).toEqual([]);
  });

  it("넓은 화면 사이드바의 로고는 라운지로 문서 이동한다", () => {
    markAsInsideApp();
    const container = mount(<MannersLayout><p>본문</p></MannersLayout>);
    const logo = container.querySelector<HTMLAnchorElement>('aside a[aria-label="웨딩한방 홈으로 이동"]');
    expect(logo?.getAttribute("href")).toBe("/wedding/lounge");
    expect(tap(logo!)).toBe("document");
  });

  it("아모라에 질문하기는 준비 안내 ID 를 그대로 들고 문서 이동한다", () => {
    markAsInsideApp();
    const container = mount(<MannersPartView part={partWithCategory} />);
    const ask = container.querySelector<HTMLAnchorElement>(`a[aria-label="${partWithCategory.title} 아모라에 질문하기"]`);
    expect(ask?.getAttribute("href")).toBe(`/wedding/chat?amoraSource=g.${partWithCategory.slug}`);
    expect(tap(ask!)).toBe("document");
  });

  it("예절 안내의 로그인 필요 링크는 하나도 클라이언트 이동하지 않는다", () => {
    markAsInsideApp();
    const container = mount(
      <MannersLayout>
        <MannersIndexPage />
        <MannersPartView part={partWithCategory} />
      </MannersLayout>,
    );
    const links = loginOnlyLinks(container);
    expect(links.length).toBeGreaterThan(5);
    expect(links.map(link => [link.getAttribute("href"), tap(link)]))
      .toEqual(links.map(link => [link.getAttribute("href"), "document"]));
  });

  it("공개 편끼리의 이동(이전·다음 편)은 그대로 Next 라우터가 옮긴다", () => {
    markAsInsideApp();
    const container = mount(<MannersPartView part={partWithCategory} />);
    const neighbour = container.querySelector<HTMLAnchorElement>('nav[aria-label="다른 편"] a');
    expect(neighbour?.getAttribute("href")).toMatch(/^\/wedding\/manners\//);
    expect(tap(neighbour!)).toBe("client");
  });
});
