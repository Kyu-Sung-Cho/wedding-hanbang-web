// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoadFailureNoticeCleaner from "@/components/common/LoadFailureNoticeCleaner";
import LoadStallHint from "@/components/wedding-code/LoadStallHint";
import IntroScreen from "@/components/wedding-code/v40/IntroScreen";
import {
  LATE_RELOAD_HINT_CSS,
  LATE_RELOAD_HINT_DELAY_SECONDS,
  LATE_RELOAD_HINT_TEXT,
  LATE_RELOAD_LINK_ATTRIBUTE,
  LATE_RELOAD_LINK_TEXT,
  LOAD_FAILURE_HYDRATED_ATTRIBUTE,
  LOAD_FAILURE_NOTICE_SNIPPET,
  LOAD_FAILURE_NOTICE_TEXT,
  NO_SCRIPT_HINT_TEXT,
  markHydratedAndClearLoadFailureNotice,
} from "@/lib/browserStorageFallback";
import WeddingCodeLoading from "../wedding-code/loading";
import WeddingCodeV31Client from "../wedding-code/WeddingCodeV31Client";
import RootError from "../error";

/**
 * 화면 조각(자바스크립트 파일) 하나가 못 내려와 시작 단추가 영영 꺼져 있는 경우의 복구(감사 A17, A59, A69, A70, A65).
 *
 * 리액트 타이머로는 풀 수 없다: 실패한 번들이 그 타이머를 돌리는 번들이다. 그래서 세 겹으로 막는다.
 * (1) 번들보다 먼저 도는 head 인라인 스크립트가 /_next/static/ 스크립트의 로딩 실패를 듣고 새로고침 안내를 띄운다.
 * (2) 서버 HTML 의 "확인 중" 구간에 CSS 지연 애니메이션으로 12초 뒤에 보이는 새로고침 한 줄과 noscript 줄을 둔다.
 * (3) 앱 공통 오류 화면은 청크 오류에서 reset() 이 아니라 새로고침을 하고(한 번은 알아서), 웨딩코드에서는 웨딩코드 답 기준으로 말한다.
 * 안내 막대는 하이드레이션이 실패했을 때만 맞는 말이다. 하이드레이션이 돼서 화면이 살아 있으면(서버 HTML 의 "확인 중" 구간이 있던 화면에서 그 구간이 사라지면) 걷고 다시 띄우지 않는다.
 * 그 구간이 처음부터 없는 화면에서는 루트 레이아웃이 마운트됐다는 것이 본문이 살아났다는 증거가 아니므로(둘은 따로 하이드레이션된다) 막대를 걷지 않는다.
 * 오류 화면이 같은 안내를 하므로 오류 화면이 뜨면 막대도 걷는다. 12초 줄에는 「다시 불러오기」 링크가 있고(앱 웹뷰는 당겨서 새로고침이 막혀 있다),
 * 웨딩코드 로딩 화면이 자바스크립트가 꺼진 브라우저에서도 보이는 noscript 줄과 12초 줄을 맡는다.
 * 개발 서버에서 /_next/static/ 의 js 를 막고 연 실측은 이 변경의 REPORT 에 있다.
 */
vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn() }));
const pathname = vi.hoisted(() => ({ value: "/" as string | null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => pathname.value }));
vi.mock("@/lib/observability/clientErrorReport", () => ({ reportClientError: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const srcRoot = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(srcRoot, relative), "utf8");

describe("head 인라인 스크립트: /_next/static/ 스크립트 로딩 실패를 알린다", () => {
  const run = () => new Function(LOAD_FAILURE_NOTICE_SNIPPET)();
  let added: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]>;
  const realAdd = window.addEventListener.bind(window);
  const realDocumentAdd = document.addEventListener.bind(document);
  let addedToDocument: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]>;

  beforeEach(() => {
    document.body.innerHTML = "";
    added = [];
    addedToDocument = [];
    // 시험마다 새로 단 리스너를 거두려고 기록한다(스니펫은 매번 새 리스너를 단다).
    window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      added.push([type, listener, options]);
      realAdd(type, listener, options);
    }) as typeof window.addEventListener;
    document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      addedToDocument.push([type, listener, options]);
      realDocumentAdd(type, listener, options);
    }) as typeof document.addEventListener;
  });
  afterEach(() => {
    for (const [type, listener, options] of added) window.removeEventListener(type, listener, options);
    window.addEventListener = realAdd;
    for (const [type, listener, options] of addedToDocument) document.removeEventListener(type, listener, options);
    document.addEventListener = realDocumentAdd;
    document.body.innerHTML = "";
  });

  const failScript = (src: string) => {
    const script = document.createElement("script");
    script.setAttribute("src", src);
    document.head.appendChild(script);
    script.dispatchEvent(new Event("error")); // 로딩 실패 이벤트는 위로 올라가지 않는다. capture 로만 잡힌다.
    script.remove();
  };
  const notice = () => document.querySelector<HTMLElement>("[data-load-failure-notice]");

  it("/_next/static/ 의 SCRIPT 가 실패하면 안내와 새로고침 단추를 보인다", () => {
    run();
    failScript("/_next/static/chunks/app-abc.js");
    expect(notice()).not.toBeNull();
    expect(notice()!.getAttribute("role")).toBe("alert");
    expect(notice()!.textContent).toContain(LOAD_FAILURE_NOTICE_TEXT);
    expect([...notice()!.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["새로고침", "닫기"]);
  });

  it("같은 출처의 절대 주소로 실패해도 같다", () => {
    run();
    failScript(`${window.location.origin}/_next/static/chunks/other.js`);
    expect(notice()).not.toBeNull();
  });

  it("한 번만 보인다", () => {
    run();
    failScript("/_next/static/chunks/a.js");
    notice()!.remove();
    failScript("/_next/static/chunks/b.js");
    expect(notice()).toBeNull();
  });

  it("닫기를 누르면 사라진다(앱이 멀쩡히 열리는데 선택 파일만 막힌 경우)", () => {
    run();
    failScript("/_next/static/chunks/a.js");
    notice()!.querySelectorAll("button")[1].click();
    expect(notice()).toBeNull();
  });

  it("오탐을 만들지 않는다: 다른 경로의 스크립트, 이미지, 스크립트 실행 중 오류는 안내하지 않는다", () => {
    run();
    failScript("https://example.com/ads.js");
    failScript("/other/static/a.js");
    const image = document.createElement("img");
    image.setAttribute("src", "/_next/static/media/a.png");
    document.body.appendChild(image);
    image.dispatchEvent(new Event("error"));
    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));
    expect(notice()).toBeNull();
  });

  it("던지지 않는다: 이상한 이벤트가 와도 첫 화면을 깨뜨리지 않는다", () => {
    run();
    expect(() => window.dispatchEvent(new Event("error"))).not.toThrow();
  });

  it("스니펫 안에는 템플릿 문자열을 깨뜨리는 백슬래시, 백틱, 달러 중괄호가 없다", () => {
    expect(LOAD_FAILURE_NOTICE_SNIPPET).not.toMatch(/[`\\]|\$\{/u);
  });

  describe("하이드레이션이 돼서 화면이 살아 있으면 막대를 걷고 다시 띄우지 않는다", () => {
    afterEach(() => document.documentElement.removeAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE));

    it("표시와 걷기: 떠 있던 막대가 사라지고 html 에 표시가 남는다", () => {
      run();
      failScript("/_next/static/chunks/a.js");
      expect(notice()).not.toBeNull();
      markHydratedAndClearLoadFailureNotice();
      expect(notice()).toBeNull();
      expect(document.documentElement.hasAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE)).toBe(true);
    });

    it("표시가 있으면 이후에 다른 파일(하이드레이션 뒤에 따로 받는 모니터링 파일 등)이 일시적으로 실패해도 막대를 띄우지 않는다", () => {
      run();
      markHydratedAndClearLoadFailureNotice();
      failScript("/_next/static/chunks/sentry-late.js");
      expect(notice()).toBeNull();
    });

    it("막대를 예약만 해 둔 사이(본문이 아직 없을 때)에 하이드레이션이 끝나도 막대는 만들어지지 않는다", () => {
      const realBody = Object.getOwnPropertyDescriptor(Document.prototype, "body")!;
      Object.defineProperty(document, "body", { configurable: true, get: () => null });
      try {
        run();
        failScript("/_next/static/chunks/a.js");
      } finally {
        delete (document as unknown as { body?: unknown }).body;
        Object.defineProperty(Document.prototype, "body", realBody);
      }
      markHydratedAndClearLoadFailureNotice();
      document.dispatchEvent(new Event("DOMContentLoaded"));
      expect(notice()).toBeNull();
    });

    it("하이드레이션이 안 됐으면(표시가 없으면) 막대가 그대로 남는다", () => {
      run();
      failScript("/_next/static/chunks/a.js");
      expect(document.documentElement.hasAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE)).toBe(false);
      expect(notice()).not.toBeNull();
    });

    describe("루트 레이아웃의 작은 컴포넌트", () => {
      let host: HTMLDivElement;
      let hostRoot: Root;
      beforeEach(() => {
        host = document.createElement("div");
        document.body.appendChild(host);
        hostRoot = createRoot(host);
      });
      afterEach(() => {
        act(() => hostRoot.unmount());
        host.remove();
      });
      const mountCleaner = async () => { await act(async () => { hostRoot.render(<LoadFailureNoticeCleaner />); }); };
      const pendingHint = () => {
        const hint = document.createElement("p");
        hint.setAttribute("data-late-reload-hint", "");
        document.body.appendChild(hint);
        return hint;
      };

      it("확인 중 구간이 서버 HTML 에 처음부터 없는 화면(함께 보기, 취향, 개인정보 처리방침)에서는 마운트돼도 막대를 걷지 않는다: 레이아웃이 마운트됐다는 것은 화면 본문이 하이드레이션됐다는 증거가 아니다(렌더 결과는 없다)", async () => {
        run();
        failScript("/_next/static/chunks/a.js");
        await mountCleaner();
        expect(host.innerHTML).toBe("");
        expect(notice()).not.toBeNull();
        expect(document.documentElement.hasAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE)).toBe(false);
        // 이후 문서가 바뀌어도(본문이 살아났다고 읽을 신호가 없으므로) 그대로다.
        document.body.appendChild(document.createElement("section"));
        await act(async () => { await Promise.resolve(); });
        expect(notice()).not.toBeNull();
        expect(document.documentElement.hasAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE)).toBe(false);
      });

      it("그 화면에서 막대가 닫기 전까지 남고, 닫기는 여전히 된다", async () => {
        run();
        failScript("/_next/static/chunks/a.js");
        await mountCleaner();
        notice()!.querySelectorAll("button")[1].click();
        expect(notice()).toBeNull();
      });

      it("마운트가 풀린 뒤에는 구간이 사라져도 걷지 않는다(기다림을 멈춘다)", async () => {
        run();
        failScript("/_next/static/chunks/a.js");
        const hint = pendingHint();
        await mountCleaner();
        await act(async () => { hostRoot.render(null); });
        hint.remove();
        await act(async () => { await Promise.resolve(); });
        expect(notice()).not.toBeNull();
        expect(document.documentElement.hasAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE)).toBe(false);
      });

      it("확인 중 구간이 남아 있는 동안에는 막대를 그대로 둔다: 레이아웃은 화면 본문보다 먼저 마운트되므로 마운트만으로는 화면이 살아났다고 말할 수 없다", async () => {
        run();
        failScript("/_next/static/chunks/a.js");
        const hint = pendingHint();
        await mountCleaner();
        expect(notice()).not.toBeNull();
        expect(document.documentElement.hasAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE)).toBe(false);
        hint.remove();
        await act(async () => { await Promise.resolve(); });
        expect(document.documentElement.hasAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE)).toBe(true);
      });

      it("확인 중 구간이 서버 HTML 에 있던 화면(웨딩코드 입구)은 본문이 하이드레이션돼야 걷힌다: 레이아웃이 먼저 마운트된 동안에는 막대가 남는다", async () => {
        window.localStorage.clear();
        window.history.replaceState(null, "", "/wedding-code");
        vi.spyOn(window, "scrollTo").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        const page = document.createElement("div");
        document.body.appendChild(page);
        const element = <WeddingCodeV31Client shareOrigin="https://hanbang.ai" />;
        page.innerHTML = renderToString(element);
        let pageRoot: Root | null = null;
        try {
          run();
          failScript("/_next/static/chunks/a.js");
          await mountCleaner();
          expect(page.querySelector("[data-late-reload-hint]")).not.toBeNull();
          expect(notice()).not.toBeNull();
          expect(document.documentElement.hasAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE)).toBe(false);
          await act(async () => { pageRoot = hydrateRoot(page, element); });
          await act(async () => { await Promise.resolve(); });
          expect(page.querySelector("[data-late-reload-hint]")).toBeNull();
          expect(notice()).toBeNull();
          expect(document.documentElement.hasAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE)).toBe(true);
        } finally {
          act(() => pageRoot?.unmount());
          page.remove();
          vi.restoreAllMocks();
        }
      });

      it("화면이 하이드레이션돼 확인 중 구간이 사라지면 그때 막대를 걷는다", async () => {
        run();
        failScript("/_next/static/chunks/a.js");
        const hint = pendingHint();
        await mountCleaner();
        expect(notice()).not.toBeNull();
        hint.remove();
        await act(async () => { await Promise.resolve(); });
        expect(notice()).toBeNull();
        expect(document.documentElement.hasAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE)).toBe(true);
      });

      it("확인 중 구간이 영영 안 사라지면(화면이 못 살아남) 막대는 그대로다", async () => {
        run();
        failScript("/_next/static/chunks/a.js");
        pendingHint();
        await mountCleaner();
        document.body.appendChild(document.createElement("div")); // 관계없는 문서 변화
        await act(async () => { await Promise.resolve(); });
        expect(notice()).not.toBeNull();
        expect(document.documentElement.hasAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE)).toBe(false);
      });
    });
  });

  describe("12초 줄의 「다시 불러오기」 링크는 눌림을 location.reload() 로 바꾼다(주소의 # 뒤를 잃지 않으려고)", () => {
    const reloadSpy = vi.fn();
    beforeEach(() => {
      reloadSpy.mockClear();
      vi.stubGlobal("location", { reload: reloadSpy });
    });
    afterEach(() => vi.unstubAllGlobals());
    const link = (inner = false) => {
      const anchor = document.createElement("a");
      anchor.setAttribute("href", "");
      anchor.setAttribute(LATE_RELOAD_LINK_ATTRIBUTE, "");
      if (inner) {
        const span = document.createElement("span");
        anchor.appendChild(span);
        document.body.appendChild(anchor);
        return span;
      }
      document.body.appendChild(anchor);
      return anchor;
    };
    const click = (element: HTMLElement) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event;
    };

    it("링크를 누르면 기본 이동은 막고 새로고침한다", () => {
      run();
      const event = click(link());
      expect(event.defaultPrevented).toBe(true);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("링크 안쪽 요소를 눌러도 같다", () => {
      run();
      click(link(true));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("다른 링크는 건드리지 않는다", () => {
      run();
      const other = document.createElement("a");
      other.setAttribute("href", "/privacy");
      document.body.appendChild(other);
      const event = click(other);
      expect(event.defaultPrevented).toBe(false);
      expect(reloadSpy).not.toHaveBeenCalled();
    });
  });
});

describe("루트 레이아웃은 번들보다 먼저 이 스크립트와 지연 규칙을 head 에 싣는다", () => {
  const layout = read("app/layout.tsx");
  it("로딩 실패 스크립트가 head 안에 있고 저장소 스니펫처럼 인라인이다", () => {
    expect(layout).toContain("LOAD_FAILURE_NOTICE_SNIPPET");
    expect(layout).toMatch(/<head>[\s\S]*__html: LOAD_FAILURE_NOTICE_SNIPPET[\s\S]*<\/head>/u);
    expect(layout).toMatch(/<style dangerouslySetInnerHTML=\{\{ __html: LATE_RELOAD_HINT_CSS \}\} \/>/u);
  });

  it("하이드레이션이 되면 막대를 걷는 작은 컴포넌트가 body 안에 있다", () => {
    expect(layout).toMatch(/<body[^>]*>[\s\S]*<LoadFailureNoticeCleaner \/>[\s\S]*\{children\}[\s\S]*<\/body>/u);
  });
});

describe("서버 HTML 의 확인 중 구간: 12초 뒤 새로고침 한 줄과 noscript", () => {
  it("규칙은 스크립트 없이 CSS 만으로 지연 뒤에 보이게 한다", () => {
    expect(LATE_RELOAD_HINT_DELAY_SECONDS).toBeGreaterThanOrEqual(8);
    expect(LATE_RELOAD_HINT_DELAY_SECONDS).toBeLessThanOrEqual(20);
    expect(LATE_RELOAD_HINT_CSS).toMatch(/\.hb-late-hint\{visibility:hidden;opacity:0;animation:hb-late-reveal 0s linear 12s forwards\}/u);
    expect(LATE_RELOAD_HINT_CSS).toContain("@keyframes hb-late-reveal{to{visibility:visible;opacity:1}}");
  });

  it("안내 컴포넌트는 지연 한 줄과 noscript 한 줄을 그린다", () => {
    const html = renderToString(<LoadStallHint className="x" />);
    expect(html).toContain('class="hb-late-hint x"');
    expect(html).toContain(LATE_RELOAD_HINT_TEXT);
    // 오류 이벤트가 안 오는 실패(응답 멈춤, 깨진 파일)에는 위쪽 막대가 없고 앱 웹뷰는 당겨서 새로고침이 막혀 있다: 줄 끝 링크가 유일한 길이다.
    expect(html).toMatch(new RegExp(`<a href="" ${LATE_RELOAD_LINK_ATTRIBUTE}="" [^>]*>${LATE_RELOAD_LINK_TEXT}</a>`, "u"));
    expect(html).toMatch(/<noscript>[\s\S]*<\/noscript>/u);
    expect(html).toContain(NO_SCRIPT_HINT_TEXT);
  });

  it("v4 시작 화면의 대기 구간에만 있고, 풀리면 없다", () => {
    const base = { embedded: false, autosave: "on" as const, onAutosaveChange: () => undefined, onStart: () => undefined, notice: null };
    expect(renderToString(<IntroScreen {...base} pending />)).toContain("data-late-reload-hint");
    expect(renderToString(<IntroScreen {...base} />)).not.toContain("data-late-reload-hint");
  });

  describe("v3.1 소개: 서버 HTML 에 있고 하이드레이션 경고 없이 저장 확인이 끝나면 사라진다", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;
    beforeEach(() => {
      window.localStorage.clear();
      window.history.replaceState(null, "", "/wedding-code");
      vi.spyOn(window, "scrollTo").mockImplementation(() => {});
      container = document.createElement("div");
      document.body.appendChild(container);
    });
    afterEach(() => {
      act(() => root?.unmount());
      root = null;
      container.remove();
      vi.restoreAllMocks();
    });

    it("서버 HTML 에 안내가 있고 하이드레이션 뒤에는 없다", async () => {
      const element = <WeddingCodeV31Client shareOrigin="https://hanbang.ai" />;
      container.innerHTML = renderToString(element);
      expect(container.querySelector("[data-late-reload-hint]")?.textContent).toBe(`${LATE_RELOAD_HINT_TEXT} ${LATE_RELOAD_LINK_TEXT}`);
      expect(container.querySelector("noscript")).not.toBeNull();
      const onRecoverableError = vi.fn();
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      await act(async () => { root = hydrateRoot(container, element, { onRecoverableError }); });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(container.querySelector("[data-late-reload-hint]")).toBeNull();
    });
  });

  it("웨딩코드 로딩 화면은 스트리밍 컨테이너 밖에서 보이는 12초 줄과 noscript 줄을 그린다(자바스크립트가 꺼지면 본문은 div[hidden] 안에 갇힌다)", () => {
    const html = renderToString(<WeddingCodeLoading />);
    expect(html).toContain("animate-spin");
    expect(html).toContain(LATE_RELOAD_HINT_TEXT);
    expect(html).toContain(LATE_RELOAD_LINK_TEXT);
    expect(html).toMatch(/<noscript>[\s\S]*<\/noscript>/u);
    expect(html).toContain(NO_SCRIPT_HINT_TEXT);
    // 웨딩코드 밖 화면에 자바스크립트 없음 안내가 새로 뜨지 않게 루트 로딩과 루트 레이아웃에는 이 안내가 없다.
    expect(read("app/loading.tsx")).not.toMatch(/noscript|LoadStallHint/u);
    expect(read("app/layout.tsx")).not.toMatch(/<noscript|<LoadStallHint/u);
  });
});

describe("앱 공통 오류 화면: 청크 오류는 새로고침으로, 웨딩코드는 웨딩코드 답 기준으로", () => {
  const MARK = "hb:chunk-error-auto-reload-at";
  let container: HTMLDivElement;
  let root: Root;
  const reset = vi.fn();
  const mount = async (error: Error & { digest?: string }) => {
    await act(async () => { root.render(<RootError error={error} reset={reset} />); });
  };
  const chunkError = () => Object.assign(new Error("Failed to load chunk /_next/static/chunks/abc.js from module 123"), { name: "ChunkLoadError" });
  const buttonLabels = () => [...container.querySelectorAll("button")].map((button) => button.textContent);
  // jsdom 의 location.reload 는 바꿀 수 없어서 location 자체를 reload 만 있는 가짜로 바꿔 시도 횟수를 센다.
  const reloadSpy = vi.fn();
  const reloadAttempts = () => reloadSpy.mock.calls.length;

  beforeEach(() => {
    window.sessionStorage.clear();
    reset.mockClear();
    pathname.value = "/";
    // 새로고침을 시도했는지는 가짜 location.reload 의 호출 수(reloadAttempts)와 표시(MARK)로 본다.
    reloadSpy.mockClear();
    vi.stubGlobal("location", { reload: reloadSpy });
    vi.spyOn(console, "error").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("오류 화면이 뜨면 head 스크립트의 안내 막대는 걷는다(오류 화면이 같은 안내를 한다), 청크 오류든 일반 오류든", async () => {
    for (const error of [chunkError(), new Error("boom")]) {
      const bar = document.createElement("div");
      bar.setAttribute("data-load-failure-notice", "");
      document.body.appendChild(bar);
      await mount(error);
      expect(document.querySelector("[data-load-failure-notice]"), error.message).toBeNull();
      expect(container.textContent).toContain("화면을 불러오지 못했어요");
    }
    document.documentElement.removeAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE);
  });

  it("일반 오류는 이전처럼 다시 시도하기가 reset 을 부르고 자동 새로고침은 없다", async () => {
    await mount(new Error("boom"));
    expect(buttonLabels()).toEqual(["다시 시도하기"]);
    container.querySelector("button")!.click();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(MARK)).toBeNull();
    expect(reloadAttempts()).toBe(0);
    expect(container.textContent).toContain("저장된 일정·예산·대화 내용은 그대로예요");
  });

  it("청크 오류는 한 번 자동으로 새로고침하고(표시를 남김) 단추는 새로고침이며 reset 을 부르지 않는다", async () => {
    await mount(chunkError());
    expect(window.sessionStorage.getItem(MARK)).not.toBeNull();
    expect(reloadAttempts()).toBe(1);
    expect(buttonLabels()).toEqual(["새로고침"]);
    container.querySelector("button")!.click();
    expect(reset).not.toHaveBeenCalled();
    expect(reloadAttempts()).toBe(2);
  });

  it("메시지만 청크 계열이어도(이름이 Error) 같다", async () => {
    for (const message of ["Loading chunk 12 failed.", "Failed to fetch dynamically imported module: https://hanbang.ai/_next/static/a.js", "Importing a module script failed."]) {
      window.sessionStorage.clear();
      await mount(new Error(message));
      expect(window.sessionStorage.getItem(MARK), message).not.toBeNull();
      expect(buttonLabels(), message).toEqual(["새로고침"]);
    }
  });

  it("자동 새로고침은 한 번뿐이다: 최근에 했다면 다시 하지 않고 단추로만 풀 수 있다", async () => {
    const recent = String(Date.now() - 5_000);
    window.sessionStorage.setItem(MARK, recent);
    await mount(chunkError());
    expect(window.sessionStorage.getItem(MARK)).toBe(recent);
    expect(reloadAttempts()).toBe(0);
    expect(buttonLabels()).toEqual(["새로고침"]);
  });

  it("표시를 남길 수 없는 브라우저에서는 되풀이될 수 있으므로 자동으로 새로고침하지 않는다", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await mount(chunkError());
    expect(setItem).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(MARK)).toBeNull();
    // 표시를 못 남기면 같은 오류가 되풀이될 때 새로고침이 끝없이 돈다. 시도 자체가 없어야 한다.
    expect(reloadAttempts()).toBe(0);
    expect(buttonLabels()).toEqual(["새로고침"]);
  });

  it("웨딩코드 경로의 문구는 일정·예산·대화가 아니라 웨딩코드 답을 말한다", async () => {
    for (const path of ["/wedding-code", "/wedding-code/together"]) {
      pathname.value = path;
      await mount(new Error("boom"));
      expect(container.textContent, path).not.toMatch(/일정|예산|대화/u);
      expect(container.textContent, path).toContain("저장된 답은 이 브라우저에 그대로 있어요");
      expect(container.querySelector("a")?.getAttribute("href"), path).toBe("/wedding-code");
    }
  });

  it("웨딩코드 밖(루트와 닮은 경로 포함)은 그대로다", async () => {
    for (const path of ["/", "/wedding-codex", "/wedding", null]) {
      pathname.value = path;
      await mount(new Error("boom"));
      expect(container.textContent, String(path)).toContain("저장된 일정·예산·대화 내용은 그대로예요");
      expect(container.querySelector("a")?.getAttribute("href"), String(path)).toBe("/wedding");
    }
  });
});
