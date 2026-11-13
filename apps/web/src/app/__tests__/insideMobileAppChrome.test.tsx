// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import MannersLayout from "@/app/manners/layout";
import MannersIndexPage from "@/app/manners/page";
import PriceLayout from "@/app/price/layout";
import MannersPartView from "@/components/manners/MannersPartView";
import { PriceAmoraBridge } from "@/components/price/PriceAmoraBridge";
import { MANNERS_PARTS } from "@/lib/manners/data";
import { MOBILE_WEB_API_NONCE_PROPERTY } from "@/lib/mobile/mobileAuthenticatedFetch";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const NONCE = "5b0c9d8e-7f6a-4b5c-9d8e-7f6a5b4c3d2e";

/**
 * **앱 안 웹 화면에서는 웹의 틀(머리·아래 메뉴·바닥글)과 가입 권유를 내린다.**
 *
 * 앱은 예절 안내와 공시가를 웹뷰로 연다. 그 웹뷰에는 앱의 세션이 없어서(쿠키를 넘기지
 * 않는다) 웹의 틀이 약속하는 곳 대부분이 **앱에 로그인한 사람에게 웹 로그인 화면**이다.
 *
 *   - 예절 안내의 아래 메뉴 다섯(라운지·아모라·체크리스트·일정·예산)과 모바일 머리의 「홈」
 *     (2026-09-17 85e45aead 부터 `/wedding/lounge`)은 전부 로그인 필요 경로다. 앱에는 자기
 *     아래 탭과 머리가 이미 있어 메뉴가 두 겹으로 쌓였다.
 *   - 공시가의 「아모라와 시작하기」는 웹의 보호된 채팅 경로로 간다. 앱의 세션을
 *     넘기지 않는 웹뷰에서는 이미 가입한 앱 사용자에게 다시 웹 로그인을 요구한다.
 *
 * 브라우저 방문자에게는 **아무것도 달라지지 않아야 한다.** 판정은 앱이 문서보다 먼저 심는
 * 표식(`useInsideMobileApp`)으로만 하고, 서버 렌더는 언제나 브라우저 모양이다.
 */
let mountedRoot: Root | undefined;

function mount(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    mountedRoot = createRoot(container);
    mountedRoot.render(element);
  });
  return container;
}

function markAsInsideApp(): void {
  // 앱이 문서보다 먼저 심는 두 가지. 웹뷰 다리와 그 다리의 nonce.
  (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage: () => undefined };
  window[MOBILE_WEB_API_NONCE_PROPERTY] = NONCE;
}

afterEach(() => {
  act(() => mountedRoot?.unmount());
  mountedRoot = undefined;
  document.body.replaceChildren();
  delete (window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  delete window[MOBILE_WEB_API_NONCE_PROPERTY];
  vi.restoreAllMocks();
});

const firstPart = MANNERS_PARTS[0];

function mannersChrome(container: HTMLElement) {
  return {
    bottomNav: container.querySelector('nav[aria-label="모바일 주요 기능"]'),
    footer: container.querySelector("footer"),
    mobileHeader: container.querySelector("header.md\\:hidden"),
    homeLink: container.querySelector('header a[aria-label="웨딩한방 홈으로 이동"]'),
    body: container.querySelector("#manners-main"),
  };
}

describe("예절 안내 · 브라우저 방문자", () => {
  it("아래 메뉴·바닥글·모바일 머리가 그대로 있다", () => {
    const container = mount(<MannersLayout><MannersIndexPage /></MannersLayout>);
    const chrome = mannersChrome(container);
    expect(chrome.bottomNav).not.toBeNull();
    // 2026-11-13 파운더 결정: 메인은 웨딩 라운지와 아모라 둘이라 아래 메뉴도 둘이다.
    expect(chrome.bottomNav!.querySelectorAll("a")).toHaveLength(2);
    expect(chrome.footer).not.toBeNull();
    expect(chrome.mobileHeader).not.toBeNull();
    expect(chrome.homeLink?.getAttribute("href")).toBe("/wedding/lounge");
  });

  it("편 화면의 「전체 보기」 머리도 그대로 있다", () => {
    const container = mount(<MannersPartView part={firstPart} />);
    expect(container.querySelector('header a[aria-label="예절 가이드 전체 보기"]')).not.toBeNull();
  });

  it("웹뷰 다리만 있고 앱이 심은 표식이 없으면 브라우저로 본다", () => {
    (window as { ReactNativeWebView?: unknown }).ReactNativeWebView = { postMessage: () => undefined };
    const chrome = mannersChrome(mount(<MannersLayout><MannersIndexPage /></MannersLayout>));
    expect(chrome.bottomNav).not.toBeNull();
    expect(chrome.footer).not.toBeNull();
  });

  it("서버 렌더는 표식과 무관하게 브라우저 모양이다", () => {
    markAsInsideApp();
    const html = renderToStaticMarkup(<MannersLayout><MannersIndexPage /></MannersLayout>);
    expect(html).toContain('aria-label="모바일 주요 기능"');
    expect(html).toContain("<footer");
  });
});

describe("예절 안내 · 앱 웹뷰", () => {
  it("웹의 머리·아래 메뉴·바닥글을 내리고 본문은 그대로 둔다", () => {
    markAsInsideApp();
    const container = mount(<MannersLayout><MannersIndexPage /></MannersLayout>);
    const chrome = mannersChrome(container);
    expect(chrome.bottomNav).toBeNull();
    expect(chrome.footer).toBeNull();
    expect(chrome.mobileHeader).toBeNull();
    // 로그인 벽으로 가는 「홈」·라운지 링크가 남아 있으면 안 된다(사이드바는 데스크톱 폭에서만 보인다).
    expect(container.querySelector('header a[href="/wedding/lounge"]')).toBeNull();
    expect(chrome.body).not.toBeNull();
    expect(container.querySelector("h1")?.textContent).toContain("결혼 예절 가이드");
    expect(container.querySelectorAll("[data-guide-slug]").length).toBeGreaterThan(0);
  });

  it("편 화면에서도 웹 머리를 내린다 — 앱 머리가 뒤로 가기와 제목을 이미 갖고 있다", () => {
    markAsInsideApp();
    const container = mount(<MannersPartView part={firstPart} />);
    expect(container.querySelector("header.md\\:hidden")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toContain(firstPart.title);
  });
});

describe("공시가 · 브라우저 방문자", () => {
  it("공개 머리·바닥글과 원래 목적지를 유지하는 아모라 진입이 있다", () => {
    const container = mount(<PriceLayout><PriceAmoraBridge /></PriceLayout>);
    expect(container.querySelector('header a[aria-label="웨딩한방 홈으로 이동"]')).not.toBeNull();
    expect(container.querySelector('header nav[aria-label="주요 메뉴"]')).not.toBeNull();
    expect(container.querySelector("footer")).not.toBeNull();
    expect(container.querySelector('section[aria-label="아모라 안내"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="아모라 안내"] a[href="/wedding/chat"]')?.textContent).toContain("아모라와 시작하기");
    expect(container.querySelector('a[href="/login?mode=signup"]')).toBeNull();
  });
});

describe("공시가 · 앱 웹뷰", () => {
  it("공개 머리·바닥글과 가입 권유를 내리고 가격 본문은 그대로 둔다", () => {
    markAsInsideApp();
    const container = mount(
      <PriceLayout>
        <p data-price-body>가격 본문</p>
        <PriceAmoraBridge />
      </PriceLayout>,
    );
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
    expect(container.querySelector('section[aria-label="아모라 안내"]')).toBeNull();
    expect(container.querySelector('a[href="/wedding/chat"]')).toBeNull();
    expect(container.querySelector('a[href="/login?mode=signup"]')).toBeNull();
    expect(container.textContent).not.toContain("아모라와 시작하기");
    expect(container.querySelector("[data-price-body]")?.textContent).toBe("가격 본문");
  });
});
